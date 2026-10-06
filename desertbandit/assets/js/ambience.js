/*
 * ambience.js - the desert under the game: a quiet looping bed and critters at random (modelled on Desert Ranger's ambience.js).
 * Local to each phone, never synchronized. Starts at the audio-unlock tap once the page is in a lobby or a game (default
 * volume 20 %), keeps playing after a win and back in the lobby, and stops only with the Desert sounds switch or the page.
 *   bed       the manifest's amb-bed-01 (Desert Ranger's 90 s wind bed), crossfade-looped (1.5 s equal-power) on the amb bus;
 *             it ducks -12 dB under the radio voices (sync.js)
 *   critters  the manifest's kind "critter" clips: one every CRITTER_MIN..CRITTER_MAX s, -8..0 dB, random pan, never the same
 *             twice in a row, the rattle rarer
 * If the phone pauses the audio (a call, the lock screen, another app) and it runs again, the bed is restarted.
 */
(function () {
  'use strict';
  var Sound = window.BanditSound;
  var BED = 'amb-bed-01';
  var CRITTER_MIN = 15, CRITTER_MAX = 45;
  var WEIGHT = { 'amb-rattle': 0.3 };   // id stem -> weight (default 1)

  var st = { active: false, started: false, paused: false, bed: null, critterTimer: null, lastCritter: null, critterCount: 0, bedStarts: 0 };
  function rand(a, b) { return a + Math.random() * (b - a); }
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function ready() { return !!(Sound.ctx && Sound.unlocked); }

  function bedId() {
    var m = Sound.manifest || {};
    if (m[BED] && m[BED].file) return BED;
    var other = Object.keys(m).filter(function (id) { return m[id].kind === 'amb' && m[id].file; }).sort();
    return other.length ? other[0] : null;
  }
  function critters() {
    var m = Sound.manifest || {};
    return Object.keys(m).filter(function (id) { return m[id].kind === 'critter' && Sound.buffers[id]; }).sort()
      .map(function (id) { return { id: id, w: WEIGHT[id.replace(/-\d+$/, '')] || 1 }; });
  }

  function startBed() {
    var id = bedId();
    if (st.bed || !ready() || !Sound.settings.ambOn || !id || !Sound.buffers[id]) return;
    st.bed = Sound.loopBed(Sound.buffers[id], { bus: 'amb', gain: 1, xfade: 1.5, fadeIn: 1.5 });
    st.bedStarts++;
    scheduleCritter();
  }
  function stopBed() {
    if (st.bed) { st.bed.stop(0.6); st.bed = null; }
    clearTimeout(st.critterTimer); st.critterTimer = null;
  }

  function scheduleCritter() {
    clearTimeout(st.critterTimer);
    if (!st.bed) return;
    st.critterTimer = setTimeout(playCritter, rand(CRITTER_MIN, CRITTER_MAX) * 1000);
  }
  function playCritter() {
    if (!ready() || !st.bed) return;
    if (!document.hidden && !Sound.muted) {
      var pool = critters().filter(function (c) { return c.id !== st.lastCritter; });
      var total = pool.reduce(function (a, c) { return a + c.w; }, 0);
      if (total > 0) {
        var r = Math.random() * total, pick = pool[pool.length - 1];
        for (var i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) { pick = pool[i]; break; } }
        st.lastCritter = pick.id;
        st.critterCount++;
        Sound.at(Sound.buffers[pick.id], null, { bus: 'amb', gain: dbToGain(rand(-8, 0)), pan: rand(-0.8, 0.8), tag: 'critter' });
      }
    }
    scheduleCritter();
  }

  /** The bed first (one clip), start it at once, then the critters behind it. */
  function maybeStart() {
    if (!ready() || !st.active || st.started) return;
    st.started = true;   // set at once: every poll calls setActive, and it must not stack work
    Sound.manifestReady().then(function () {
      var id = bedId();
      return id ? Sound.clip(id) : null;
    }).then(function () {
      startBed();
      var m = Sound.manifest || {};
      return Sound.preload(Object.keys(m).filter(function (id) { return m[id].kind === 'critter' && m[id].file; }), 2);
    });
  }

  function setActive(on) {
    st.active = !!on;
    if (on) maybeStart();
  }

  /** The phone paused the audio and it is running again: restart the bed (its timer may have been frozen). */
  function resume() {
    if (!st.bed) { startBed(); return; }
    st.bed.stop(0.15); st.bed = null;
    clearTimeout(st.critterTimer); st.critterTimer = null;
    startBed();
  }

  Sound.listeners.push(maybeStart);
  Sound.stateListeners.push(function (state) {
    if (state !== 'running') { st.paused = true; return; }
    if (st.paused) resume();   // back from a pause (call, lock screen, another app)
    st.paused = false;
  });
  Sound.settingListeners.push(function (k, v) {
    if (k !== 'ambOn') return;
    if (v) { if (st.started) startBed(); else maybeStart(); } else stopBed();
  });

  window.BanditAmbience = { setActive: setActive, resume: resume, state: st };
})();
