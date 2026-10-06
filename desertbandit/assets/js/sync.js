/*
 * sync.js - the shared clock and the sound scheduler (adapted from Desert Ranger's sync.js).
 *
 * CLOCK (NTP-style): for each request we note the local send time t0, the receive time t1 and the server's time ts.
 *     rtt = t1 - t0,   offset = ts - (t0 + t1) / 2   (server clock minus ours)
 *   The last 40 samples are kept; the offset is the median of the 5 lowest-RTT ones. Samples come from a burst of
 *   ?a=time pings at start-up, one every 30 s, and every API response (each carries serverNow).
 *
 * SOUND: every event of one action carries the same playAt (server ms). Sound.at(buffer, serverMs) converts that to
 *   the Web Audio clock so every device plays it at the same wall-clock moment. More than LATE_LIMIT_MS late: skipped.
 *   The buffers themselves are synthesized in sound.js (no audio files). Mute and volume live in localStorage.
 */
(function () {
  'use strict';

  // Monotonic local clock in epoch ms (Date.now can jump when the OS adjusts the time).
  var perf = window.performance && performance.now ? performance : { now: function () { return Date.now(); } };
  var base = Date.now() - perf.now();
  function localNow() { return base + perf.now(); }

  var Clock = {
    samples: [],
    offset: 0,          // server - local, ms
    rtt: null,
    ready: false,
    localNow: localNow,
    serverNow: function () { return localNow() + this.offset; },
    /** Local (epoch ms) time at which the server clock reads serverMs. */
    toLocal: function (serverMs) { return serverMs - this.offset; },

    add: function (t0, ts, t1) {
      if (typeof ts !== 'number' || !isFinite(ts)) return;
      var rtt = t1 - t0;
      if (rtt < 0 || rtt > 10000) return;
      this.samples.push({ rtt: rtt, offset: ts - (t0 + t1) / 2 });
      if (this.samples.length > 40) this.samples.shift();
      var best = this.samples.slice().sort(function (a, b) { return a.rtt - b.rtt; }).slice(0, 5);
      var offs = best.map(function (s) { return s.offset; }).sort(function (a, b) { return a - b; });
      this.offset = offs[Math.floor(offs.length / 2)];
      this.rtt = best[0].rtt;
      this.ready = this.samples.length >= 3;
    },

    ping: function () {
      var self = this, t0 = localNow();
      return fetch('api.php?a=time&_=' + Math.random(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) { self.add(t0, j.t, localNow()); })
        .catch(function () { /* the next poll is a sample too */ });
    },

    start: function () {
      var self = this, n = 6;
      (function next() { self.ping().then(function () { if (--n > 0) setTimeout(next, 150); }); })();
      setInterval(function () { self.ping(); }, 30000);
    }
  };

  var LATE_LIMIT_MS = 250;
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: fine */ } }

  var Sound = {
    ctx: null,
    master: null,       // mute
    vol: null,          // volume slider
    unlocked: false,
    muted: lsGet('bandit_muted', '0') === '1',
    volume: Math.max(0, Math.min(100, parseInt(lsGet('bandit_volume', '70'), 10) || 0)),
    listeners: [],      // called once after the first unlock (sound.js builds its buffers then)
    stateListeners: [], // called when the audio context starts or stops running
    stats: { played: 0, skipped: 0, lastLateMs: null },
    log: [],            // last scheduled sounds {tag, serverMs, ok} (the browser test reads it)

    /** Must be called from a tap (iOS rule). Safe to call repeatedly. */
    unlock: function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var first = false;
      if (!this.ctx) {
        try { this.ctx = new AC(); } catch (e) { return; }
        this.build();
        first = true;
      }
      if (this.ctx.state !== 'running') this.resumeCtx();
      try {   // one silent sample: some iOS versions only unlock on a real start()
        var b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
        s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      } catch (e) { /* ignore */ }
      this.unlocked = true;
      if (first) this.listeners.forEach(function (fn) { try { fn(); } catch (e) { console.warn('unlock listener', e); } });
    },

    resumeCtx: function () {
      try { var p = this.ctx.resume(); if (p && p.catch) p.catch(function () { /* needs a tap: the next tap retries */ }); } catch (e) { /* ignore */ }
    },

    /** True when sound was started but the phone is not playing it (suspended, or 'interrupted' by a call / lock screen). */
    paused: function () { return !!(this.ctx && this.unlocked && this.ctx.state !== 'running'); },

    build: function () {
      var ctx = this.ctx, self = this, wasRunning = false;
      ctx.onstatechange = function () {
        var run = ctx.state === 'running';
        if (run === wasRunning) return;
        wasRunning = run;
        self.stateListeners.forEach(function (fn) { try { fn(ctx.state); } catch (e) { console.warn('state listener', e); } });
      };
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(ctx.destination);
      this.vol = ctx.createGain();
      this.vol.gain.value = this.volGain();
      this.vol.connect(this.master);
    },

    volGain: function () { var v = this.volume / 100; return v * v * 1.2; },   // a squared curve feels even on a slider

    setMuted: function (m) {
      this.muted = !!m; lsSet('bandit_muted', m ? '1' : '0');
      if (this.master) this.master.gain.value = m ? 0 : 1;
    },

    setVolume: function (v) {
      this.volume = Math.max(0, Math.min(100, v | 0)); lsSet('bandit_volume', String(this.volume));
      if (this.vol) this.vol.gain.setTargetAtTime(this.volGain(), this.ctx.currentTime, 0.03);
    },

    /** How many ms after server time serverMs it is now here (negative = still in the future). */
    lateBy: function (serverMs) { return localNow() - Clock.toLocal(serverMs); },

    /**
     * Play buffer `buf` when the SERVER clock reads serverMs (null = now, local only).
     * opts: gain, rate, pan (-1..1), tag. Returns {start, end} in ctx time, or null when skipped (muted, locked, too late).
     * Slightly late (<= LATE_LIMIT_MS): starts now and skips into the sound so everyone stays together.
     */
    at: function (buf, serverMs, o) {
      o = o || {};
      var entry = { tag: o.tag || '', serverMs: serverMs, ok: false };
      this.log.push(entry);
      if (this.log.length > 400) this.log.splice(0, 100);
      if (!this.ctx || !buf || this.muted) return null;
      var ctx = this.ctx, delayMs = serverMs == null ? 0 : Clock.toLocal(serverMs) - localNow();
      if (serverMs != null) this.stats.lastLateMs = Math.round(-delayMs);
      if (delayMs < -LATE_LIMIT_MS) { this.stats.skipped++; return null; }
      if (ctx.state !== 'running') this.resumeCtx();
      var rate = o.rate || 1, src = ctx.createBufferSource(), node = src;
      src.buffer = buf;
      src.playbackRate.value = rate;
      if (o.gain != null && o.gain !== 1) { var g = ctx.createGain(); g.gain.value = o.gain; node.connect(g); node = g; }
      if (o.pan && ctx.createStereoPanner) { var pn = ctx.createStereoPanner(); pn.pan.value = o.pan; node.connect(pn); node = pn; }
      node.connect(this.vol);
      var lat = ctx.outputLatency || 0, when, skip = 0;
      if (delayMs >= 0) when = ctx.currentTime + Math.max(0, delayMs / 1000 - lat);
      else { when = ctx.currentTime; skip = (-delayMs / 1000) * rate; }
      var avail = buf.duration - skip;
      if (avail <= 0) { this.stats.skipped++; return null; }
      src.start(when, skip, avail);
      this.stats.played++;
      entry.ok = true;
      return { start: when, end: when + avail / rate };
    }
  };

  window.BanditClock = Clock;
  window.BanditSound = Sound;
})();
