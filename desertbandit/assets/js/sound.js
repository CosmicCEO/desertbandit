/*
 * sound.js - the machine's sounds, synthesized in the browser (no audio files).
 * The buffers are built once, right after the first audio-unlock tap, and played with BanditSound.at on the shared clock,
 * so every phone hears a reel stop at the same moment it sees it.
 *   tick   one click of a spinning reel          thump  a reel stops
 *   clink  a reel is held / locked               coin   one coin of a bank (several make the chime)
 *   bell   a sweep                               buzz   a bust
 *   fanfare a win                                tear   paper tearing (bust)
 */
(function () {
  'use strict';
  var Sound = window.BanditSound;
  var B = {};          // name -> AudioBuffer

  function make(ctx, dur, fn) {
    var sr = ctx.sampleRate, n = Math.max(1, Math.floor(dur * sr)), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = fn(i / sr, i);
    // soft clip and a 3 ms fade-out so nothing clicks
    var fade = Math.min(n, Math.floor(0.003 * sr));
    for (var k = 0; k < n; k++) {
      var v = d[k];
      d[k] = v > 1 ? 1 : v < -1 ? -1 : v;
      if (k > n - fade) d[k] *= (n - k) / fade;
    }
    return buf;
  }
  var TAU = Math.PI * 2;
  function env(t, a, dcy) { return t < a ? t / a : Math.exp(-(t - a) / dcy); }
  function tri(p) { p = p - Math.floor(p); return p < 0.5 ? 4 * p - 1 : 3 - 4 * p; }

  function build() {
    var ctx = Sound.ctx;
    if (!ctx) return;
    // a one-pole low-passed noise source shared by the percussive sounds
    var lp = 0;
    function noise(k) { lp += k * ((Math.random() * 2 - 1) - lp); return lp; }

    B.tick = make(ctx, 0.035, function (t) {
      return 0.55 * env(t, 0.001, 0.006) * (Math.random() * 2 - 1) + 0.25 * env(t, 0.001, 0.01) * Math.sin(TAU * 2600 * t);
    });
    B.thump = make(ctx, 0.28, function (t) {
      var ph = TAU * (55 * t + 70 * 0.03 * (1 - Math.exp(-t / 0.03)));   // pitch falls from 125 Hz to 55 Hz
      return 0.9 * env(t, 0.002, 0.07) * Math.sin(ph) + 0.35 * env(t, 0.001, 0.012) * noise(0.5);
    });
    B.clink = make(ctx, 0.45, function (t) {
      var e = env(t, 0.001, 0.09);
      return e * (0.32 * Math.sin(TAU * 2093 * t) + 0.22 * Math.sin(TAU * 3220 * t) + 0.12 * Math.sin(TAU * 5310 * t)) +
        0.2 * env(t, 0.0005, 0.004) * (Math.random() * 2 - 1);
    });
    B.coin = make(ctx, 0.5, function (t) {
      var a = env(t, 0.001, 0.08), b = t < 0.07 ? 0 : env(t - 0.07, 0.001, 0.16);
      return a * 0.3 * (Math.sin(TAU * 1975 * t) + 0.4 * Math.sin(TAU * 3951 * t)) +
        b * 0.32 * (Math.sin(TAU * 2637 * t) + 0.4 * Math.sin(TAU * 5274 * t));
    });
    B.bell = make(ctx, 1.6, function (t) {
      var f = 784, p = [[1, 0.5, 0.9], [2.0, 0.28, 0.6], [2.76, 0.22, 0.45], [5.4, 0.12, 0.25], [8.93, 0.06, 0.14]], s = 0;
      for (var i = 0; i < p.length; i++) s += p[i][1] * env(t, 0.002, p[i][2]) * Math.sin(TAU * f * p[i][0] * t);
      return 0.75 * s;
    });
    B.buzz = make(ctx, 0.75, function (t) {
      var e = (t < 0.01 ? t / 0.01 : 1) * (t > 0.6 ? Math.max(0, (0.75 - t) / 0.15) : 1);
      var s = tri(98 * t) + tri(103.5 * t) + 0.5 * (2 * ((146 * t) % 1) - 1);
      return 0.26 * e * s * (0.75 + 0.25 * Math.sin(TAU * 11 * t));
    });
    B.tear = make(ctx, 0.5, function (t) {
      var e = env(t, 0.02, 0.18), grit = Math.random() < 0.25 ? 1 : 0.3;
      return 0.45 * e * grit * noise(0.35);
    });
    var notes = [[0, 523.25, 0.16], [0.16, 659.25, 0.16], [0.32, 783.99, 0.16], [0.5, 1046.5, 0.5], [1.05, 783.99, 0.14], [1.2, 1046.5, 1.0]];
    B.fanfare = make(ctx, 2.4, function (t) {
      var s = 0;
      for (var i = 0; i < notes.length; i++) {
        var n = notes[i], u = t - n[0];
        if (u < 0 || u > n[2] + 0.35) continue;
        var e = (u < 0.015 ? u / 0.015 : 1) * (u > n[2] ? Math.exp(-(u - n[2]) / 0.08) : 0.85 + 0.15 * Math.exp(-u / 0.1));
        var f = n[1] * (1 + 0.004 * Math.sin(TAU * 5.5 * u));
        s += e * (0.5 * Math.sin(TAU * f * u) + 0.25 * Math.sin(TAU * 2 * f * u) + 0.14 * Math.sin(TAU * 3 * f * u) + 0.07 * Math.sin(TAU * 4 * f * u));
      }
      return 0.42 * s;
    });
  }

  var Sfx = {
    buffers: B,
    /** Play sound `name` when the server clock reads serverMs (null = now). */
    play: function (name, serverMs, o) {
      o = o || {};
      o.tag = name;
      return Sound.at(B[name] || null, serverMs, o);
    },
    /** A held reel: a clink, slightly different per reel position (local tap feedback, not synced). */
    holdTap: function (pos) { this.play('clink', null, { rate: 0.9 + 0.04 * pos, gain: 0.7 }); },
    ready: function () { return !!B.tick; }
  };

  Sound.listeners.push(build);
  window.BanditSfx = Sfx;
})();
