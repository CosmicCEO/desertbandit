/*
 * radio.js - the rangers on the radio: result calls, goal-card calls and place calls (docs/WAVE2.md, "Which line plays").
 * Modelled on Desert Ranger's radio.js. Plain ES5; loads in the browser (window.BanditRadio) and in Node (module.exports,
 * the pure part only: tests/radio_pick_test.js).
 *
 * PURE: pickCall(events, ctx) decides, from the events of ONE action and shared inputs only, which calls play and when:
 *   - at most one RESULT call per action: the priority table below, the first matching row wins, the rest are dropped;
 *   - plus the CARD call of a `turn` event (not for `broken`; for `sweep` only when ev.id % 9 == 0).
 *   Every phone gets the same answer: the variant comes from the triggering event's id (variant(ev)), never from chance.
 *   Times: the action starts at ctx.start (server ms, its playAt); its events follow each other with the WAVE1 durations (DUR).
 *
 * BROWSER: onAction() feeds pickCall the card in force, the target and the manifest, then for each call (result first, then card):
 *   1. reserves its window [at, at + click/voice/squelch length] from the manifest's `sec` (the same on every phone);
 *      a call whose window overlaps a voice already reserved is skipped ('busy');
 *   2. loads the clips (lazy, from audio/manifest.json with ?v=<hash>) and plays the radio treatment on the voice bus:
 *      click at `at`, the voice 0.1 s later over the looped hiss (gain 0.5), the squelch after the voice;
 *      more than LATE_LIMIT_MS late (or not loaded in time) -> skipped ('late'). The bed ducks -12 dB under it (sync.js).
 *   Tier A (radio fx and the card calls) loads at the unlock tap; tier B (every result and place call) once a game is
 *   active and the radio is on. A clip that is not in the manifest is never requested.
 */
(function (root) {
  'use strict';

  // Durations of the events of one action (docs/WAVE1.md; the same table as app.js).
  var DUR = { roll: 2800, lock: 450, sweep: 1400, bust: 1500, bank: 1700, turn: 900, win: 3000 };
  // Result moments that have a meme-fresh 'c' line (docs/audio-lines.json). bigbank and the card calls have only a and b.
  var HAS_C = { bust: 1, lock: 1, sweep: 1, supersweep: 1, fire: 1, subpoena: 1, broken: 1, offroad: 1, overdue: 1, win: 1 };
  var CARD_CALLS = { sweep: 1, fire: 1, offroad: 1, subpoena: 1, overdue: 1 };   // a goal card with a card-<card>-<a|b> line
  var LAST_SQUARE = 51;

  function pad2(n) { return ('0' + n).slice(-2); }

  /** The deterministic variant of a moment for the triggering event. */
  function variant(ev, moment) {
    return (ev.id % 4 === 0 && HAS_C[moment]) ? 'c' : (ev.id % 2 === 0 ? 'a' : 'b');
  }

  /** The board square a bank reaches: floor(bank / target * 51), 0..51 (the race strip's place name uses the same). */
  function square(bank, target) {
    if (!target) return 0;
    return Math.min(LAST_SQUARE, Math.floor(Math.max(0, Math.min(1, bank / target)) * LAST_SQUARE));
  }

  /** The banker's bank before this bank event (data.bank is after; it includes the amount and a Subpoena steal). */
  function bankBefore(d) { return (d.bank | 0) - (d.amount | 0) - (d.steal ? d.steal.amount | 0 : 0); }

  /**
   * Which result row (1..12) does event `ev` match, with `card` the card in force? -> {row, moment, delay, id} | null
   */
  function matchRow(ev, card, target) {
    var d = ev.data || {};
    switch (ev.type) {
      case 'win': return { row: 1, moment: 'win', delay: 400 };
      case 'lock':
        if (d.points === 1500 && (d.picks || []).length === 6) return { row: 2, moment: 'supersweep', delay: 450 };
        if (d.points >= 500 && ev.id % 3 === 0) return { row: 10, moment: 'lock', delay: 100 };
        return null;
      case 'bank':
        if (d.via === 'offroad') return { row: 3, moment: 'offroad', delay: 500 };
        if (card === 'overdue') return { row: 4, moment: 'overdue', delay: 500 };
        if (card === 'fire') return { row: 5, moment: 'fire', delay: 500 };
        if (d.steal != null) return { row: 6, moment: 'subpoena', delay: 500 };
        if (d.amount >= 1500) return { row: 11, moment: 'bigbank', delay: 500 };
        var from = square(bankBefore(d), target), to = square(d.bank | 0, target);
        if (from !== to) return { row: 12, moment: 'place', delay: 600, id: 'pl-' + (ev.id % 2 === 0 ? 'sr' : 'r273') + '-' + pad2(to), square: to };
        return null;
      case 'sweep': return card !== 'offroad' ? { row: 7, moment: 'sweep', delay: 300 } : null;
      case 'broken': return { row: 8, moment: 'broken', delay: 200 };
      case 'bust': return { row: 9, moment: 'bust', delay: 300 };
    }
    return null;
  }

  /**
   * PURE. events: the events of one action, in order ({id, type, data}). ctx:
   *   card     the card in force before the action (the card of the last `turn` event seen; null if none)
   *   target   the victory total (for the place squares)
   *   has      function(id) -> bool, or an object {id: anything}: whether the clip is in the manifest (omitted = all present)
   *   radioOn  false -> no calls at all (default true)
   *   start    server ms at which the action starts (default 0: `at` is then the offset)
   * Returns {calls: [{kind: 'result'|'card', id, moment, row, at, offset, evId, card?, square?}], card, absent: [ids]}
   *   calls: the result call first (if any), then the card call (if any); card: the card in force after the action.
   */
  function pickCall(events, ctx) {
    ctx = ctx || {};
    var card = ctx.card == null ? null : ctx.card, target = ctx.target | 0, start = +ctx.start || 0;
    var has = typeof ctx.has === 'function' ? ctx.has : ctx.has ? function (id) { return !!ctx.has[id]; } : function () { return true; };
    var radioOn = ctx.radioOn !== false;
    var best = null, cardCall = null, t = 0;
    (events || []).forEach(function (ev) {
      var d = ev.data || {}, m = matchRow(ev, card, target);
      if (m && (!best || m.row < best.row)) {
        best = m;
        best.ev = ev;
        best.offset = t + m.delay;
      }
      if (ev.type === 'turn') {
        card = d.card == null ? null : d.card;
        if (!cardCall && CARD_CALLS[card] && (card !== 'sweep' || ev.id % 9 === 0)) {
          cardCall = { kind: 'card', id: 'card-' + card + '-' + (ev.id % 2 === 0 ? 'a' : 'b'), moment: 'card', row: 0,
                       offset: t + 150, evId: ev.id, card: card };
        }
      }
      t += DUR[ev.type] || 0;
    });
    var out = { calls: [], card: card, absent: [] };
    if (!radioOn) return out;
    if (best) {
      var r = { kind: 'result', id: best.id || ('call-' + best.moment + '-' + variant(best.ev, best.moment)), moment: best.moment, row: best.row,
                offset: best.offset, evId: best.ev.id };
      if (best.square != null) r.square = best.square;
      if (has(r.id)) out.calls.push(r); else out.absent.push(r.id);
    }
    if (cardCall) { if (has(cardCall.id)) out.calls.push(cardCall); else out.absent.push(cardCall.id); }
    out.calls.forEach(function (c) { c.at = start + c.offset; });
    return out;
  }

  var api = { DUR: DUR, HAS_C: HAS_C, CARD_CALLS: CARD_CALLS, variant: variant, square: square, pickCall: pickCall };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.BanditSound) { if (root) root.BanditRadio = api; return; }

  // ================================================================== browser side
  var Sound = root.BanditSound, Clock = root.BanditClock;
  var LATE_LIMIT_MS = 250;
  var VOICE_AT = 0.1, SQ_GAP = 0.02, HISS_GAIN = 0.5, SQ_DEFAULT = 0.22;
  var CLICK = 'radio-click-01', HISS = 'radio-hiss-loop';
  function squelchFor(evId) { return 'radio-squelch-0' + (1 + evId % 3); }

  var R = {
    card: null,      // the card in force (the last `turn` event seen)
    wins: [],        // reserved voice windows [startMs, endMs] in server ms
    log: [],         // decisions {id, kind, moment, at, status}: scheduled | busy | late | muted | locked | absent | radio off
    active: false, tierBStarted: false
  };

  function note(c, status) {
    R.log.push({ id: c.id, kind: c.kind, moment: c.moment, at: Math.round(c.at), status: status, t: Clock.localNow() });
    if (R.log.length > 300) R.log.splice(0, 100);
  }

  /** Seconds of a whole call (click, voice, squelch) from the manifest lengths: the same on every phone. */
  function callSec(c) {
    var v = Sound.secOf(c.id) || 2.4, sq = Sound.secOf(squelchFor(c.evId)) || SQ_DEFAULT;
    return VOICE_AT + v + SQ_GAP + sq;
  }

  /** Reserve the call's window unless it overlaps a voice already reserved. */
  function reserve(c) {
    var s = c.at, e = c.at + callSec(c) * 1000, now = Clock.serverNow();
    R.wins = R.wins.filter(function (w) { return w[1] > now - 5000; });
    for (var i = 0; i < R.wins.length; i++) if (R.wins[i][0] < e && R.wins[i][1] > s) return false;
    R.wins.push([s, e]);
    return true;
  }

  /** Click, voice over the looped hiss, squelch; all on the voice bus, starting when the server clock reads atMs. */
  function playCall(id, atMs, evId, tag) {
    var voice = Sound.buffers[id];
    if (!voice) return false;
    var tr = Sound.trim(voice), sqId = squelchFor(evId), click = Sound.buffers[CLICK], sq = Sound.buffers[sqId], hiss = Sound.buffers[HISS];
    var voiceEnd = VOICE_AT + tr.dur;
    if (!Sound.at(voice, atMs + VOICE_AT * 1000, { bus: 'voice', offset: tr.off, duration: tr.dur, tag: tag || id })) return false;
    if (click) { var ct = Sound.trim(click); Sound.at(click, atMs, { bus: 'voice', offset: ct.off, duration: ct.dur, tag: 'radio-click' }); }
    if (sq) { var st = Sound.trim(sq); Sound.at(sq, atMs + (voiceEnd + SQ_GAP) * 1000, { bus: 'voice', offset: st.off, duration: st.dur, tag: 'radio-squelch' }); }
    if (hiss && !Sound.muted) {
      var t0 = Sound.ctxTimeFor(atMs);
      Sound.loopBed(hiss, { bus: 'voice', gain: HISS_GAIN, xfade: 0.2, fadeIn: 0.03, startAt: t0, endAt: t0 + voiceEnd });
    }
    return true;
  }

  function schedule(c) {
    if (!reserve(c)) { note(c, 'busy'); return; }
    if (!Sound.ctx || !Sound.unlocked) { note(c, 'locked'); return; }
    if (Sound.muted) { note(c, 'muted'); return; }
    if (Sound.lateBy(c.at) > LATE_LIMIT_MS) { note(c, 'late'); return; }
    var ids = [c.id, CLICK, squelchFor(c.evId), HISS];
    function go() {
      if (Sound.muted) { note(c, 'muted'); return; }
      if (!Sound.buffers[c.id] || Sound.lateBy(c.at) > LATE_LIMIT_MS) { note(c, 'late'); return; }   // not loaded in time
      note(c, playCall(c.id, c.at, c.evId, c.kind + ':' + c.id) ? 'scheduled' : 'late');
    }
    if (ids.every(function (id) { return Sound.buffers[id] || !Sound.has(id); })) go();
    else Promise.all(ids.map(function (id) { return Sound.clip(id); })).then(go);
  }

  /**
   * app.js calls this for every new action (events with one playAt) in order, also for actions too late to animate.
   * startMs = the server ms at which this phone starts the action (its playAt, or later when queued behind the previous one).
   */
  function onAction(events, startMs, target) {
    var before = R.card;
    var res = pickCall(events, { card: before, target: target, start: startMs, radioOn: Sound.settings.radioOn,
                                 has: function (id) { return Sound.has(id); } });
    R.card = res.card;
    res.absent.forEach(function (id) { note({ id: id, kind: '', moment: '', at: startMs }, 'absent'); });
    if (!Sound.settings.radioOn) {   // radio off: nothing plays; the log says what would have
      pickCall(events, { card: before, target: target, start: startMs, has: function (id) { return Sound.has(id); } })
        .calls.forEach(function (c) { note(c, 'radio off'); });
      return res;
    }
    res.calls.forEach(schedule);
    return res;
  }

  /** The card in force when a page loads in the middle of a game (history events are never played). */
  function setCard(card) { R.card = card == null ? null : card; }

  // ---- loading: tier A at the unlock tap, tier B once a game is active and the radio is on ----
  function tierA() {
    Sound.manifestReady().then(function () {
      var ids = [CLICK, 'radio-squelch-01', 'radio-squelch-02', 'radio-squelch-03', HISS];
      Object.keys(CARD_CALLS).forEach(function (k) { ids.push('card-' + k + '-a', 'card-' + k + '-b'); });
      return Sound.preload(ids.filter(function (id) { return Sound.has(id); }), 4);
    });
  }
  function tierB() {
    if (R.tierBStarted || !R.active || !Sound.ctx || !Sound.unlocked || !Sound.settings.radioOn) return;
    R.tierBStarted = true;
    Sound.manifestReady().then(function (m) {
      var ids = Object.keys(m).filter(function (id) { return /^(call|card)-/.test(id); }).sort();
      for (var i = 0; i <= LAST_SQUARE; i++) ids.push('pl-sr-' + pad2(i), 'pl-r273-' + pad2(i));
      return Sound.preload(ids.filter(function (id) { return Sound.has(id); }), 4);
    });
  }
  function setActive(on) { R.active = !!on; tierB(); }

  /** The Test sound button: a radio call right now on this phone only (or a coin chime when the radio is off). */
  function test() {
    if (!Sound.ctx) return;
    var Sfx = root.BanditSfx;
    if (!Sound.settings.radioOn) { if (Sfx) Sfx.play('coin', null, { gain: 0.8 }); return; }
    Sound.manifestReady().then(function () {
      var pool = ['card-sweep-b', 'call-lock-a', 'call-sweep-a', 'call-bigbank-a', 'pl-sr-12'].filter(function (id) { return Sound.has(id); });
      if (!pool.length) { if (Sfx) Sfx.play('coin', null, { gain: 0.8 }); return; }
      var id = pool[Math.floor(Math.random() * pool.length)];
      return Promise.all([id, CLICK, squelchFor(0), HISS].map(function (x) { return Sound.clip(x); })).then(function () {
        playCall(id, Clock.serverNow() + 120, 0, 'test:' + id);
      });
    });
  }

  Sound.listeners.push(tierA);
  Sound.listeners.push(tierB);
  Sound.settingListeners.push(function (k, v) { if (k === 'radioOn' && v) tierB(); });

  api.onAction = onAction;
  api.setCard = setCard;
  api.setActive = setActive;
  api.test = test;
  api.state = R;
  api.log = R.log;
  root.BanditRadio = api;
})(typeof window !== 'undefined' ? window : null);
