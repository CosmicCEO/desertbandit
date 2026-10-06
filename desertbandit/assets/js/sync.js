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
 *   Audio graph (everything behind one master gain = the Mute box):
 *     game   (Game volume slider)  -> cue    the machine sounds synthesized in sound.js      (synced)
 *                                   -> voice  the radio calls of radio.js                     (synced)
 *     ambDuck -> amb (Desert volume) the desert bed and critters of ambience.js             (local only)
 *   The ambDuck gain dips -12 dB while a voice sound is scheduled (duckApply).
 *   Clips: lazy-loaded through Sound.clip(id) from audio/manifest.json (id -> file + content hash `v` for cache busting).
 *   A clip that is not in the manifest resolves to null with NO request (silence, never a 404). Nothing is fetched before
 *   the audio-unlock tap. Settings live in localStorage: bandit_muted, bandit_game_vol (50), bandit_radio_on (1),
 *   bandit_amb_on (1), bandit_amb_vol (20).
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
  var DUCK_DB = -12, DUCK_LEAD = 0.15, DUCK_TAIL = 0.4, DUCK_TC = 0.08;   // the bed under a voice (seconds)
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: fine */ } }
  function pct(k, d) { var n = parseInt(lsGet(k, String(d)), 10); return isFinite(n) ? Math.max(0, Math.min(100, n)) : d; }
  var KEYS = { radioOn: 'bandit_radio_on', ambOn: 'bandit_amb_on', ambVol: 'bandit_amb_vol', gameVol: 'bandit_game_vol' };

  var Sound = {
    ctx: null,
    bus: {},            // master, game, cue, voice, ambDuck, amb
    master: null,       // = bus.master (the browser test reads it)
    unlocked: false,
    muted: lsGet('bandit_muted', '0') === '1',
    settings: {
      radioOn: lsGet(KEYS.radioOn, '1') === '1',
      ambOn: lsGet(KEYS.ambOn, '1') === '1',
      ambVol: pct(KEYS.ambVol, 20),
      gameVol: pct(KEYS.gameVol, 50)
    },
    listeners: [],      // called once after the first unlock (sound.js builds its buffers, radio.js loads tier A)
    stateListeners: [], // called when the audio context starts or stops running
    settingListeners: [],
    stats: { played: 0, skipped: 0, lastLateMs: null },
    log: [],            // last scheduled sounds {tag, serverMs, ok, bus} (the browser test reads it)
    wins: [],           // scheduled voice windows {start, end, bus, tag} in ctx time (ducking)
    buffers: {},        // clip id -> AudioBuffer
    clipP: {},          // clip id -> promise of AudioBuffer|null
    manifest: null,     // clip id -> {file, v, sec, kind, ...}
    manifestP: null,
    requested: [],      // every clip URL fetched (the browser test reads it)

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
      var ctx = this.ctx, self = this, wasRunning = false, bus = this.bus;
      ctx.onstatechange = function () {
        var run = ctx.state === 'running';
        if (run === wasRunning) return;
        wasRunning = run;
        self.stateListeners.forEach(function (fn) { try { fn(ctx.state); } catch (e) { console.warn('state listener', e); } });
      };
      function gain(v, to) { var g = ctx.createGain(); g.gain.value = v; g.connect(to); return g; }
      bus.master = gain(this.muted ? 0 : 1, ctx.destination);
      bus.game = gain(this.gameGain(), bus.master);
      bus.cue = gain(1, bus.game);
      bus.voice = gain(1, bus.game);
      bus.ambDuck = gain(1, bus.master);
      bus.amb = gain(this.ambGain(), bus.ambDuck);
      this.master = bus.master;
    },

    /** Game volume (machine sounds and voices): linear, 50 % = 0.6 (the Wave 1 default level). */
    gameGain: function () { return this.settings.gameVol / 100 * 1.2; },
    /** Desert sounds: 20 % = 0.28 (Desert Ranger's level). */
    ambGain: function () { return this.settings.ambVol / 100 * 1.4; },

    setMuted: function (m) {
      this.muted = !!m; lsSet('bandit_muted', m ? '1' : '0');
      if (this.bus.master) this.bus.master.gain.value = m ? 0 : 1;
      this.settingListeners.forEach(function (fn) { try { fn('muted', !!m); } catch (e) { console.warn('setting listener', e); } });
    },

    setSetting: function (key, val) {
      if (!KEYS[key]) return;
      if (key === 'ambVol' || key === 'gameVol') val = Math.max(0, Math.min(100, val | 0));
      else val = !!val;
      this.settings[key] = val;
      lsSet(KEYS[key], typeof val === 'boolean' ? (val ? '1' : '0') : String(val));
      var t = this.ctx ? this.ctx.currentTime : 0;
      if (key === 'gameVol' && this.bus.game) this.bus.game.gain.setTargetAtTime(this.gameGain(), t, 0.03);
      if (key === 'ambVol' && this.bus.amb) this.bus.amb.gain.setTargetAtTime(this.ambGain(), t, 0.05);
      this.settingListeners.forEach(function (fn) { try { fn(key, val); } catch (e) { console.warn('setting listener', e); } });
    },

    /** How many ms after server time serverMs it is now here (negative = still in the future). */
    lateBy: function (serverMs) { return localNow() - Clock.toLocal(serverMs); },

    /** Web Audio time at which the SERVER clock reads serverMs (never earlier than now). */
    ctxTimeFor: function (serverMs) {
      var delayMs = Clock.toLocal(serverMs) - localNow(), lat = this.ctx.outputLatency || 0;
      return this.ctx.currentTime + Math.max(0, delayMs / 1000 - lat);
    },

    // ---------------------------------------------------------------- clips
    manifestReady: function () {
      if (!this.manifestP) {
        var self = this;
        this.manifestP = fetch('audio/manifest.json', { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (j) { self.manifest = (j && j.clips) || {}; return self.manifest; })
          .catch(function (e) { console.warn('audio manifest unavailable', e && e.message); self.manifest = {}; return self.manifest; });
      }
      return this.manifestP;
    },

    /** True when the manifest is loaded and lists clip `id` with a file. */
    has: function (id) { var m = this.manifest; return !!(m && m[id] && m[id].file); },

    /** Seconds of clip `id` from the manifest (null when absent). */
    secOf: function (id) { var m = this.manifest; return m && m[id] && typeof m[id].sec === 'number' ? m[id].sec : null; },

    /** Promise of the decoded AudioBuffer for clip `id`, or null when it is not in the manifest (no request) or fails. Never rejects. */
    clip: function (id) {
      var self = this;
      if (!this.ctx) return Promise.resolve(null);
      if (this.buffers[id]) return Promise.resolve(this.buffers[id]);
      if (this.clipP[id]) return this.clipP[id];
      var p = this.manifestReady().then(function (man) {
        if (!man[id] || !man[id].file) return null;   // absent: silence, and no request
        var url = 'audio/' + man[id].file + (man[id].v ? '?v=' + man[id].v : '');   // v = content hash: mp3 is cached 30 days
        self.requested.push(url);
        return fetch(url).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        }).then(function (data) {
          return new Promise(function (ok, fail) { self.ctx.decodeAudioData(data, ok, fail); });   // old Safari: callback form only
        }).then(function (buf) { self.buffers[id] = buf; return buf; });
      }).catch(function (e) {
        console.warn('audio clip unavailable:', id, e && e.message);
        return null;
      });
      this.clipP[id] = p;
      return p;
    },

    /** Load many clips, n at a time. Resolves when all are done (missing ones are just null). */
    preload: function (ids, n) {
      var self = this, queue = ids.slice(), running = 0, done;
      if (!queue.length) return Promise.resolve();
      var all = new Promise(function (ok) { done = ok; });
      function next() {
        if (!queue.length) { if (!running) done(); return; }
        running++;
        self.clip(queue.shift()).then(function () { running--; next(); });
      }
      for (var i = 0; i < (n || 4); i++) next();
      return all;
    },

    /** Leading/trailing near-silence of a decoded buffer (MP3 adds encoder padding): {off, dur} in seconds. */
    trim: function (buf) {
      if (!buf) return null;
      if (buf._bTrim) return buf._bTrim;
      var d = buf.getChannelData(0), s = 0, e = d.length - 1, th = 0.003;
      while (s < e && Math.abs(d[s]) < th) s++;
      while (e > s && Math.abs(d[e]) < th) e--;
      if (s >= e) { buf._bTrim = { off: 0, dur: buf.duration }; return buf._bTrim; }   // all near-silent: keep it whole
      buf._bTrim = { off: s / buf.sampleRate, dur: Math.max(0.02, (e - s + 1) / buf.sampleRate) };
      return buf._bTrim;
    },

    // ---------------------------------------------------------------- playing
    /**
     * Play buffer `buf` when the SERVER clock reads serverMs (null = now, local only).
     * opts: bus (cue | voice | amb; default cue), gain, rate, pan (-1..1), offset and duration (buffer seconds), tag.
     * Returns {start, end} in ctx time, or null when skipped (muted, locked, too late).
     * Slightly late (<= LATE_LIMIT_MS): starts now and skips into the sound so everyone stays together.
     */
    at: function (buf, serverMs, o) {
      o = o || {};
      var busName = o.bus || 'cue';
      var entry = { tag: o.tag || '', serverMs: serverMs, ok: false, bus: busName, t: localNow() };
      this.log.push(entry);
      if (this.log.length > 400) this.log.splice(0, 100);
      if (!this.ctx || !buf || this.muted) return null;
      var ctx = this.ctx, delayMs = serverMs == null ? 0 : Clock.toLocal(serverMs) - localNow();
      if (serverMs != null) this.stats.lastLateMs = Math.round(-delayMs);
      if (delayMs < -LATE_LIMIT_MS) { this.stats.skipped++; return null; }
      if (ctx.state !== 'running') this.resumeCtx();
      var rate = o.rate || 1, off = o.offset || 0, src = ctx.createBufferSource(), node = src;
      src.buffer = buf;
      src.playbackRate.value = rate;
      if (o.gain != null && o.gain !== 1) { var g = ctx.createGain(); g.gain.value = o.gain; node.connect(g); node = g; }
      if (o.pan && ctx.createStereoPanner) { var pn = ctx.createStereoPanner(); pn.pan.value = o.pan; node.connect(pn); node = pn; }
      node.connect(this.bus[busName] || this.bus.cue);
      var lat = ctx.outputLatency || 0, when, skip = 0;
      if (delayMs >= 0) when = ctx.currentTime + Math.max(0, delayMs / 1000 - lat);
      else { when = ctx.currentTime; skip = (-delayMs / 1000) * rate; }
      var avail = (o.duration != null ? o.duration : buf.duration - off) - skip;
      if (avail <= 0) { this.stats.skipped++; return null; }
      src.start(when, off + skip, avail);
      this.stats.played++;
      entry.ok = true;
      var win = { start: when, end: when + avail / rate, bus: busName, tag: o.tag || '' };
      if (busName === 'voice') {
        var now = ctx.currentTime;
        this.wins = this.wins.filter(function (w) { return w.end > now - 2; });
        this.wins.push(win);
        this.duckApply();
      }
      return win;
    },

    /** Dip the desert bed under every scheduled voice window: merged windows, smooth ramps. */
    duckApply: function () {
      var ctx = this.ctx, t = ctx.currentTime, p = this.bus.ambDuck.gain;
      var ws = this.wins.filter(function (w) { return w.end + DUCK_TAIL > t; }).sort(function (a, b) { return a.start - b.start; });
      var merged = [];
      ws.forEach(function (w) {
        var s = Math.max(t, w.start - DUCK_LEAD), e = w.end + DUCK_TAIL, last = merged[merged.length - 1];
        if (last && s <= last.e) last.e = Math.max(last.e, e); else merged.push({ s: s, e: e });
      });
      var v = p.value;
      p.cancelScheduledValues(t);
      p.setValueAtTime(v, t);
      merged.forEach(function (m) {
        p.setTargetAtTime(dbToGain(DUCK_DB), m.s, DUCK_TC);
        p.setTargetAtTime(1, m.e, DUCK_TC);
      });
    },

    /**
     * A looping bed made of overlapping sources with an equal-power crossfade at the loop point
     * (MP3 has encoder padding, so loop=true on a raw MP3 clicks). The buffer is trimmed first.
     * opts: bus (default amb), gain, xfade (s), fadeIn (s), startAt (ctx time), endAt (ctx time, optional). Returns {stop(fadeSec)}.
     */
    loopBed: function (buf, o) {
      o = o || {};
      var ctx = this.ctx, tr = this.trim(buf);
      if (!ctx || !tr || tr.dur < 0.1) return { stop: function () {} };   // too short to loop
      var x =Math.min(o.xfade || 1.5, tr.dur / 3), fadeIn = Math.min(o.fadeIn != null ? o.fadeIn : 0.03, tr.dur / 3);
      var out = ctx.createGain(), nodes = [], done = false, timer = null, first = true;
      out.gain.value = o.gain != null ? o.gain : 1;
      out.connect(this.bus[o.bus || 'amb']);
      var nextStart = o.startAt != null ? o.startAt : ctx.currentTime + 0.05;
      function curve(up) {
        var n = 32, a = new Float32Array(n);
        for (var i = 0; i < n; i++) { var p = i / (n - 1); a[i] = up ? Math.sin(p * Math.PI / 2) : Math.cos(p * Math.PI / 2); }
        return a;
      }
      var UP = curve(true), DOWN = curve(false);
      function addSeg() {
        var st = nextStart, g = ctx.createGain(), s = ctx.createBufferSource();
        s.buffer = buf; s.connect(g); g.connect(out);
        g.gain.value = 0;
        var fin = Math.max(0.01, first ? fadeIn : x);   // the fades of one segment must never overlap (Web Audio throws)
        g.gain.setValueCurveAtTime(UP, st, fin);
        first = false;
        var segEnd = st + tr.dur;
        if (o.endAt != null && o.endAt <= segEnd) {   // last segment: fade out at endAt and stop
          var fo = Math.min(0.03, Math.max(0.01, o.endAt - st - fin));
          g.gain.setValueCurveAtTime(DOWN, Math.max(st + fin, o.endAt - fo), fo);
          s.start(st, tr.off, tr.dur);
          s.stop(o.endAt + 0.05);
          done = true;
        } else {
          g.gain.setValueCurveAtTime(DOWN, segEnd - x, x);
          s.start(st, tr.off, tr.dur);
          s.stop(segEnd + 0.05);
          nextStart = segEnd - x;
        }
        nodes.push(s);
        if (nodes.length > 6) nodes.shift();
      }
      function tick() {
        if (done) { clearInterval(timer); return; }
        while (!done && nextStart < ctx.currentTime + 6) addSeg();
        if (done) clearInterval(timer);
      }
      tick();
      if (!done) timer = setInterval(tick, 1000);
      return {
        stop: function (fade) {
          done = true; clearInterval(timer);
          var f = fade == null ? 0.4 : fade;
          out.gain.cancelScheduledValues(ctx.currentTime);
          out.gain.setTargetAtTime(0, ctx.currentTime, f / 3);
          setTimeout(function () { nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* already stopped */ } }); out.disconnect(); }, f * 1000 + 200);
        }
      };
    }
  };

  window.BanditClock = Clock;
  window.BanditSound = Sound;
})();
