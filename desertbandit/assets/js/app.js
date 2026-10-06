/*
 * app.js - screens, API calls, polling, and the machine on the game screen.
 *
 * Flow: home (create / join / play solo) -> lobby (host sets the total, adds computers, starts) -> game -> game over.
 * The server is the only source of truth. This page polls api.php?a=state once a second (every 4 s while hidden).
 *
 * Animation: all events of one action share playAt (server ms). Every device starts that action at playAt on its own
 * clock (BanditClock) and plays the events in order with fixed durations (DUR), so all phones show the same thing at the
 * same moment. While an action plays, the screen shows the VIEW (V), which the events move forward step by step; when the
 * newest action is done the view is set from the polled state again. Nobody can act (and no computer is moved) until then.
 *
 * Seat token: create/join return a token, kept in localStorage as bandit_token_<CODE> and sent as X-Player-Token.
 */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var POLL_MS = 1000, POLL_HIDDEN_MS = 4000;
  var DUR = { roll: 2800, lock: 450, sweep: 1400, bust: 1500, bank: 1700, turn: 900, win: 3000 };
  var SPIN_MS = 1000, STOP_GAP_MS = 360, LATE_MS = 250;
  var BOT_MIN_MS = 1400, BOT_SPREAD_MS = 1200, BOT_FALLBACK_MS = 9000;   // non-hosts move a computer only when the host's page seems away
  var MINUTES_AT_5000 = { 2: 10, 3: 13, 4: 15 };                         // docs/DESIGN.md: a $5,000 game
  var TARGETS = [2500, 5000, 7500, 10000, 12500, 15000];
  var SYMBOL_NAMES = ['Bighorn Sheep', "Gambel's Quail", 'Hairy Scorpion', 'Ocotillo', 'Chuckwalla', 'Sidewinder'];
  // each reel's paper strip has its own fixed order, so the neighbours peeking above and below are those of a real strip
  var STRIPS = [[0, 3, 1, 4, 2, 5], [1, 5, 0, 2, 4, 3], [2, 0, 5, 3, 1, 4], [3, 1, 4, 0, 5, 2], [4, 2, 3, 5, 0, 1], [5, 4, 2, 1, 3, 0]];
  var CARDS = {
    sweep: ['Found an Olla', 'Keep all six reels in one turn and an olla pays a $300, $400 or $500 bonus.'],
    broken: ['Vehicle Breaks Down', 'Your vehicle breaks down. This turn is skipped.'],
    fire: ['Ground Fire Report', 'You cannot bank under $1,000. Bank $1,000 or more and it pays $500 extra.'],
    offroad: ['Off-Road Bust', 'No banking. Keep rolling until you sweep all six reels: it pays twice the stake plus $300. A bust pays nothing.'],
    subpoena: ['Subpoena', 'A normal turn. When you bank, you take $100 from the leader (nothing if you lead).'],
    overdue: ['Reports Overdue', 'Bank only after two sweeps. A bank pays twice the stake plus $2,000. Any bust pays nothing.']
  };
  var ICON = {   // goal-card doodles (inline SVG, ink on paper)
    sweep: '<svg viewBox="0 0 48 48"><path d="M17 8h14M19 8c0 4-1 6-5 9-5 4-7 9-6 15 1 8 8 12 16 12s15-4 16-12c1-6-1-11-6-15-4-3-5-5-5-9" fill="#d98c52" stroke="#3A2A1E" stroke-width="2.4" stroke-linejoin="round"/><path d="M11 27c8 3 18 3 26 0" fill="none" stroke="#3A2A1E" stroke-width="2"/><circle cx="34" cy="13" r="3" fill="#F2B640" stroke="#3A2A1E" stroke-width="1.6"/></svg>',
    broken: '<svg viewBox="0 0 48 48"><path d="M30 6a10 10 0 0 0-9 14L7 34a4 4 0 0 0 6 6l14-14a10 10 0 0 0 14-9l-6 6-6-2-2-6z" fill="#b9b2a2" stroke="#3A2A1E" stroke-width="2.4" stroke-linejoin="round"/></svg>',
    fire: '<svg viewBox="0 0 48 48"><path d="M24 4c3 9 13 13 13 25a13 13 0 0 1-26 0c0-7 4-10 6-15 2 4 3 6 5 7 1-6 0-11 2-17z" fill="#E9A23B" stroke="#3A2A1E" stroke-width="2.4" stroke-linejoin="round"/><path d="M24 26c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 1 2 2 3 2z" fill="#C3623B"/></svg>',
    offroad: '<svg viewBox="0 0 48 48"><path d="M3 38l10-16 7 9 8-15 17 22z" fill="#c9a06a" stroke="#3A2A1E" stroke-width="2.4" stroke-linejoin="round"/><path d="M6 44c6-3 10 0 16-2s10-3 20-1" fill="none" stroke="#3A2A1E" stroke-width="2" stroke-dasharray="3 3"/></svg>',
    subpoena: '<svg viewBox="0 0 48 48"><path d="M10 4h20l8 8v32H10z" fill="#fffaf0" stroke="#3A2A1E" stroke-width="2.4" stroke-linejoin="round"/><path d="M15 16h16M15 22h16M15 28h10" stroke="#3A2A1E" stroke-width="2"/><circle cx="31" cy="36" r="5" fill="#C3623B" stroke="#3A2A1E" stroke-width="1.8"/></svg>',
    overdue: '<svg viewBox="0 0 48 48"><circle cx="24" cy="26" r="17" fill="#fffaf0" stroke="#3A2A1E" stroke-width="2.6"/><path d="M24 15v11l7 5" fill="none" stroke="#C3623B" stroke-width="3" stroke-linecap="round"/><path d="M14 6l-6 5M34 6l6 5" stroke="#3A2A1E" stroke-width="2.6" stroke-linecap="round"/></svg>'
  };

  var Clock = window.BanditClock, Sound = window.BanditSound, Sfx = window.BanditSfx, R = window.BanditScoring;
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    code: null, token: null, vehicles: {}, state: null, lastEventId: 0, firstLoad: true,
    pollTimer: null, pollP: null, pollAgain: false, stopPolling: false, inflight: false, arming: false,
    selVehicle: null, sel: {}, selTurn: null, hadSeat: false, gameShown: false,
    animEnd: 0, animTimer: null, timers: [], viewReady: false,
    botTimer: null, botBusy: false, lastChangeAt: 0, lastTurnSeen: null, race: null, reelEls: []
  };
  var V = null;   // the view: what the screen shows right now (see the header)

  // ------------------------------------------------------------------ helpers

  function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }
  function now() { return Clock.localNow(); }

  function newKey() {
    if (window.crypto && crypto.getRandomValues) {
      var a = new Uint8Array(12); crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /** Call the API. GET when body is undefined. Every response is also a clock sample. */
  function api(action, body, query) {
    var url = 'api.php?a=' + action + (query || '');
    var opt = { headers: {}, cache: 'no-store', credentials: 'same-origin' };
    if (S.token) opt.headers['X-Player-Token'] = S.token;
    if (body !== undefined) {
      opt.method = 'POST';
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    var t0 = now();
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Server error (' + r.status + ')' }; })
        .then(function (j) { j._status = r.status; return j; });
    }).then(function (j) {
      var t1 = now();
      if (j.serverNow) Clock.add(t0, j.serverNow, t1);
      if (!j.ok) { var e = new Error(j.error || 'Something went wrong'); e.data = j; throw e; }
      return j;
    });
  }

  function show(screen) {
    ['home', 'lobby', 'game'].forEach(function (s) { $('screen-' + s).hidden = (s !== screen); });
  }

  function pieceImg(vehicle) {
    var img = document.createElement('img');
    img.src = 'assets/img/pieces/' + vehicle + '.png';
    img.alt = '';
    return img;
  }

  function playerById(id) {
    var ps = S.state ? S.state.players : [];
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }
  function viewPlayer(id) {
    var ps = V ? V.players : [];
    for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return playerById(id);
  }
  function nameOf(id) { var p = viewPlayer(id); return p ? p.name : 'Someone'; }

  function rememberSeat(code, token) {
    S.code = code; S.token = token;
    lsSet('bandit_token_' + code, token);
    lsSet('bandit_last_code', code);
    history.replaceState(null, '', '?g=' + code);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------------ home

  function renderVehicles(taken) {
    var grid = $('vehicle-grid');
    grid.textContent = '';
    taken = taken || [];
    if (S.selVehicle && taken.indexOf(S.selVehicle) >= 0) S.selVehicle = null;
    Object.keys(S.vehicles).forEach(function (key) {
      var b = el('button', 'vehicle' + (S.selVehicle === key ? ' sel' : ''));
      b.type = 'button';
      b.disabled = taken.indexOf(key) >= 0;
      b.setAttribute('data-vehicle', key);
      b.setAttribute('aria-pressed', S.selVehicle === key ? 'true' : 'false');
      b.appendChild(pieceImg(key));
      b.appendChild(el('span', null, S.vehicles[key]));
      b.onclick = function () { S.selVehicle = key; lsSet('bandit_vehicle', key); renderVehicles(taken); };
      grid.appendChild(b);
    });
  }

  function cleanCode(v) { return (v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }

  function onCodeInput() {
    var code = cleanCode($('in-code').value);
    $('home-error').textContent = '';
    $('btn-join').hidden = code.length !== 4;
    $('btn-create').hidden = code.length > 0;
    $('btn-solo').hidden = code.length > 0;
    $('solo-hint').hidden = code.length > 0;
    if (code.length !== 4) { renderVehicles([]); return; }
    api('peek', undefined, '&code=' + code).then(function (j) {
      if (j.status !== 'lobby') $('home-error').textContent = 'That game has already started.';
      renderVehicles(j.taken);
    }).catch(function (e) { $('home-error').textContent = e.message; });
  }

  function homeCheck() {
    var name = $('in-name').value.trim();
    if (!name) { $('home-error').textContent = 'Please enter your name.'; return null; }
    if (!S.selVehicle) { $('home-error').textContent = 'Pick your rig.'; return null; }
    lsSet('bandit_name', name);
    return name;
  }

  function homeSubmit(kind) {
    Sound.unlock();   // this tap is the iOS audio gesture
    var name = homeCheck();
    if (!name) return;
    var code = cleanCode($('in-code').value);
    var btn = $(kind === 'create' ? 'btn-create' : 'btn-join');
    btn.disabled = true;
    api(kind, { name: name, vehicle: S.selVehicle, code: code }).then(function (j) {
      rememberSeat(j.code, j.token);
      startPolling();
    }).catch(function (e) {
      $('home-error').textContent = e.message;
      if (kind === 'join') onCodeInput();
    }).then(function () { btn.disabled = false; });
  }

  /** Play solo: create a room, add two computers and start, in one tap. */
  function playSolo() {
    Sound.unlock();
    var name = homeCheck();
    if (!name) return;
    var btn = $('btn-solo');
    btn.disabled = true;
    api('create', { name: name, vehicle: S.selVehicle }).then(function (j) {
      rememberSeat(j.code, j.token);
      return api('addbot', { code: j.code });
    }).then(function () {
      return api('addbot', { code: S.code });
    }).then(function () {
      return api('start', { code: S.code });
    }).catch(function (e) {
      $('home-error').textContent = e.message;
    }).then(function () {
      btn.disabled = false;
      if (S.code) startPolling();
    });
  }

  function showHome(prefillCode) {
    show('home');
    $('in-name').value = lsGet('bandit_name') || '';
    $('in-code').value = prefillCode || '';
    var v = lsGet('bandit_vehicle');
    if (v && S.vehicles[v]) S.selVehicle = v;
    var last = lsGet('bandit_last_code');
    if (last && lsGet('bandit_token_' + last) && last !== prefillCode) {
      $('resume-box').hidden = false;
      $('btn-resume').textContent = 'Resume game ' + last;
      $('btn-resume').onclick = function () { location.href = '?g=' + last; };
    } else {
      $('resume-box').hidden = true;
    }
    onCodeInput();
    loadStats();
  }

  function loadStats() {
    clearTimeout(S.statsTimer);
    if ($('screen-home').hidden) return;
    api('stats').then(function (j) {
      var n = j.games | 0, line = $('stats-line');
      line.textContent = n === 0 ? 'No games being played right now.' : n === 1 ? '1 game being played right now' : n + ' games being played right now';
      line.hidden = false;
    }).catch(function () { $('stats-line').hidden = true; }).then(function () { S.statsTimer = setTimeout(loadStats, 45000); });
  }

  // ------------------------------------------------------------------ polling

  function startPolling() {
    S.stopPolling = false;
    poll();
  }

  /** One poll. Never two at once: a poll asked for while one runs is done right after it. Resolves when the state is applied. */
  function poll() {
    clearTimeout(S.pollTimer);
    if (!S.code) return Promise.resolve();
    if (S.pollP) { S.pollAgain = true; return S.pollP; }
    S.pollP = api('state', undefined, '&code=' + S.code + '&since=' + S.lastEventId).then(function (j) {
      onState(j);
    }).catch(function (e) {
      if (e.data && e.data._status === 404) {   // a bad or old link
        lsDel('bandit_token_' + S.code);
        S.stopPolling = true;
        showHome('');
        $('home-error').textContent = 'No game with code ' + S.code + '.';
        S.code = null;
        return;
      }
      S.netBackoff = true;
    }).then(function () {
      S.pollP = null;
      if (S.pollAgain) { S.pollAgain = false; return poll(); }
      if (!S.stopPolling && S.code) {
        S.pollTimer = setTimeout(poll, S.netBackoff ? 3000 : document.hidden ? POLL_HIDDEN_MS : POLL_MS);
        S.netBackoff = false;
      }
    });
    return S.pollP;
  }

  function onState(j) {
    var wasFirst = S.firstLoad;
    S.state = j;

    if (!j.meId) {   // not seated: home, with the room code filled in
      var wasSeated = S.hadSeat;
      S.token = null;
      S.stopPolling = true;
      S.hadSeat = false;
      if (wasSeated) removedFromGame(j.game.code);
      else if (wasFirst) showHome(j.game.code);
      return;
    }
    S.hadSeat = true;

    var fresh = [];
    (j.events || []).forEach(function (ev) {
      if (ev.id <= S.lastEventId) return;
      S.lastEventId = ev.id;
      fresh.push(ev);
    });
    if (wasFirst) fresh.forEach(function (ev) { addLog(ev); });   // history: listed, never replayed
    S.firstLoad = false;

    var g = j.game;
    if (S.lastTurnSeen !== g.turn) { S.lastTurnSeen = g.turn; S.lastChangeAt = now(); }

    if (g.status === 'lobby') {
      if (S.gameShown) resetGameView();
      show('lobby');
      renderLobby();
    } else {
      if (!S.gameShown) { S.gameShown = true; buildReels(); }
      if (!S.viewReady) reconcile();
      show('game');
      if (!wasFirst) scheduleEvents(fresh);
      if (!animating()) reconcile();
      renderGame();
    }
    updateSoundBar();
  }

  // ------------------------------------------------------------------ lobby

  function minutesFor(n, target) {
    var m = MINUTES_AT_5000[Math.max(2, Math.min(4, n))];
    return Math.max(1, Math.round(m * target / 5000));
  }

  function renderLobby() {
    var st = S.state, me = st.meId, g = st.game, isHost = me === g.hostId, n = st.players.length;
    $('lobby-code').textContent = g.code;
    $('lobby-link').textContent = location.host + location.pathname;
    $('lobby-count').textContent = n;
    var ul = $('lobby-players');
    ul.textContent = '';
    st.players.forEach(function (p) {
      var li = el('li');
      li.appendChild(pieceImg(p.vehicle));
      li.appendChild(el('span', 'nm', p.name + (p.id === me ? ' (you)' : '')));
      if (p.id === g.hostId) li.appendChild(el('span', 'tag', 'HOST'));
      if (p.bot) li.appendChild(el('span', 'tag cpu', 'COMPUTER'));
      if (isHost && p.id !== me) {
        var rb = el('button', 'mini-btn danger', 'Remove');
        rb.type = 'button';
        rb.onclick = (function (pl) { return function () { removePlayer(pl); }; })(p);
        li.appendChild(rb);
      }
      ul.appendChild(li);
    });
    $('btn-addbot').hidden = !(isHost && n < 4);
    // victory total
    var sel = $('sel-target');
    sel.hidden = !isHost;
    $('target-fixed').hidden = isHost;
    $('target-fixed').textContent = money(g.target);
    var opts = TARGETS.slice();
    if (opts.indexOf(g.target) < 0) { opts.push(g.target); opts.sort(function (a, b) { return a - b; }); }
    if (sel.options.length !== opts.length || +sel.value !== g.target) {
      sel.textContent = '';
      opts.forEach(function (t) {
        var o = el('option', null, money(t) + (t === 5000 ? ' (usual)' : t === 2500 ? ' (short)' : t >= 10000 ? ' (long)' : ''));
        o.value = String(t);
        if (t === g.target) o.selected = true;
        sel.appendChild(o);
      });
    }
    $('game-length').textContent = n < 2
      ? 'Add a computer or wait for a friend: 2 to 4 players.'
      : 'About ' + minutesFor(n, g.target) + ' minutes for ' + n + ' players.';
    $('btn-start').hidden = !isHost;
    $('btn-start').disabled = n < 2;
    $('btn-start').textContent = n < 2 ? 'Need 2+ players' : 'Start game';
    $('lobby-wait').hidden = isHost;
  }

  function lobbyCall(action, body) {
    $('lobby-error').textContent = '';
    return api(action, body).catch(function (e) { $('lobby-error').textContent = e.message; }).then(poll);
  }
  function removePlayer(p) {
    if (!confirm('Remove ' + p.name + ' from the game?')) return;
    lobbyCall('remove', { code: S.code, playerId: p.id });
  }

  // ------------------------------------------------------------------ the view

  function blankLocks() { return [false, false, false, false, false, false]; }

  /** The view from the polled state (when nothing is animating). */
  function reconcile() {
    var st = S.state, g = st.game;
    var faces = V ? V.faces : STRIPS.map(function (s, i) { return STRIPS[i][2]; });
    V = {
      turn: g.turn, status: g.status, target: g.target, currentId: g.currentId, winnerId: g.winnerId,
      card: g.card ? g.card.key : null, phase: g.phase, stake: g.stake | 0, sweeps: g.sweeps | 0,
      reels: (g.reels || [null, null, null, null, null, null]).slice(),
      locked: (g.locked || blankLocks()).slice(),
      scoring: (g.scoring || blankLocks()).slice(),
      spinning: blankLocks(),
      faces: faces.slice(),
      players: st.players.map(function (p) { return { id: p.id, name: p.name, vehicle: p.vehicle, bank: p.bank, out: p.out, bot: p.bot }; })
    };
    for (var i = 0; i < 6; i++) if (V.reels[i] !== null && V.reels[i] !== undefined) V.faces[i] = V.reels[i];
    S.viewReady = true;
  }

  /** True from the moment an action is scheduled until the view has been set from the state again after it. */
  function animating() { return S.animPending || now() < S.animEnd; }

  /** Group fresh events by action (same playAt) and schedule each action on the shared clock. */
  function scheduleEvents(evs) {
    var groups = [], cur = null;
    evs.forEach(function (ev) {
      if (!cur || cur.playAt !== ev.playAt) { cur = { playAt: ev.playAt, events: [] }; groups.push(cur); }
      cur.events.push(ev);
    });
    groups.forEach(scheduleGroup);
  }

  function scheduleGroup(grp) {
    var t = grp.playAt ? Clock.toLocal(grp.playAt) : now();
    if (t < S.animEnd) t = S.animEnd;            // the previous action is still playing here: queue behind it
    var at = t;
    grp.events.forEach(function (ev) {
      var d = DUR[ev.type] || 0, start = at, sT = start + Clock.offset;
      at += d;
      if (start + d < now() - LATE_MS || (d === 0 && start < now() - LATE_MS)) {
        // far too late (hidden tab, slow poll): no animation, no sound, just its result
        applyEvent(ev, false);
        addLog(ev);
        return;
      }
      sounds(ev, sT);
      later(start - now(), function () { applyEvent(ev, true); addLog(ev); renderGame(); });
    });
    if (at > S.animEnd) S.animEnd = at;
    S.animPending = true;
    clearTimeout(S.animTimer);
    S.animTimer = setTimeout(animDone, Math.max(0, S.animEnd - now()) + 30);
  }

  function later(ms, fn) {
    var id = setTimeout(function () {
      S.timers = S.timers.filter(function (x) { return x !== id; });
      fn();
    }, Math.max(0, ms));
    S.timers.push(id);
    return id;
  }

  function animDone() {
    if (now() < S.animEnd) { S.animTimer = setTimeout(animDone, Math.max(0, S.animEnd - now()) + 30); return; }
    S.animPending = false;
    S.lastChangeAt = now();
    if (S.state && S.state.game.status !== 'lobby') { reconcile(); renderGame(); }
  }

  /** Sounds of one event, scheduled ahead on the shared clock (sT = the event's start, server ms). */
  function sounds(ev, sT) {
    var d = ev.data || {}, k;
    switch (ev.type) {
      case 'turn':
        Sfx.play('tick', sT, { gain: 0.5, rate: 0.7 });
        break;
      case 'roll':
        var n = (d.rolled || []).length, last = SPIN_MS + (n - 1) * STOP_GAP_MS;
        for (k = 0; k * 85 < last; k++) Sfx.play('tick', sT + k * 85, { gain: 0.35 + 0.15 * (k % 2), rate: 0.9 + 0.1 * ((k * 7) % 3) });
        for (k = 0; k < n; k++) Sfx.play('thump', sT + SPIN_MS + k * STOP_GAP_MS, { rate: 0.95 + 0.03 * k });
        break;
      case 'lock':
        (d.picks || []).forEach(function (p, i) { Sfx.play('clink', sT + i * 55, { rate: 0.9 + 0.04 * p, gain: 0.8 }); });
        break;
      case 'sweep':
        Sfx.play('bell', sT);
        if (d.bonus) Sfx.play('coin', sT + 500);
        break;
      case 'bust':
        Sfx.play('buzz', sT);
        Sfx.play('tear', sT + 120);
        break;
      case 'bank':
        for (k = 0; k < 6; k++) Sfx.play('coin', sT + 250 + k * 150, { rate: 1 + 0.06 * (k % 3) });
        break;
      case 'win':
        Sfx.play('fanfare', sT);
        break;
    }
  }

  /** Move the view one event forward. animate=false: just the result (late or reduced). */
  function applyEvent(ev, animate) {
    if (!V) return;
    var d = ev.data || {}, i;
    animate = animate && !REDUCED ? true : animate ? 'reduced' : false;
    switch (ev.type) {
      case 'turn':
        V.currentId = d.playerId; V.card = d.card; V.phase = 'start';
        V.reels = [null, null, null, null, null, null]; V.locked = blankLocks(); V.scoring = blankLocks();
        V.stake = 0; V.sweeps = 0; S.arming = false;
        if (animate) bump($('goal'), 'deal', 700);
        break;
      case 'broken':
        if (animate) flash(nameOf(d.playerId) + ' broke down!', 'bad', 900);
        break;
      case 'roll':
        S.arming = false;
        V.scoring = blankLocks();
        var rolled = d.rolled || [];
        if (!animate) {
          for (i = 0; i < 6; i++) if (d.reels && d.reels[i] !== null) { V.reels[i] = d.reels[i]; V.faces[i] = d.reels[i]; }
          V.scoring = (d.scoring || blankLocks()).slice(); V.phase = 'rolled';
          break;
        }
        V.phase = 'rolling';
        rolled.forEach(function (p) { V.spinning[p] = true; V.reels[p] = null; });
        rolled.forEach(function (p, k) {
          later(SPIN_MS + k * STOP_GAP_MS, function () {
            V.spinning[p] = false; V.reels[p] = d.reels[p]; V.faces[p] = d.reels[p];
            renderReels();
            if (animate === true) bump(S.reelEls[p].bob, 'settle', 380);
          });
        });
        later(DUR.roll, function () {
          for (i = 0; i < 6; i++) if (d.reels && d.reels[i] !== null) { V.reels[i] = d.reels[i]; V.faces[i] = d.reels[i]; V.spinning[i] = false; }
          V.scoring = (d.scoring || blankLocks()).slice(); V.phase = 'rolled';
          renderGame();
        });
        break;
      case 'lock':
        (d.picks || []).forEach(function (p) { V.locked[p] = true; if (animate) bump(S.reelEls[p].win, 'stamp', 450); });
        V.stake = d.stake; V.scoring = blankLocks();
        if (animate) pop('+' + money(d.points));
        break;
      case 'sweep':
        V.sweeps = d.sweeps; V.stake += d.bonus || 0;
        if (animate) {
          bump($('cab'), 'sweepflash', 1300);
          flash('SWEEP!', 'good', 1300, d.bonus ? 'Olla bonus +' + money(d.bonus) : 'Six fresh reels');
          later(DUR.sweep - 100, function () { V.locked = blankLocks(); renderReels(); });
        } else V.locked = blankLocks();
        break;
      case 'bust':
        if (animate) {
          bump($('cab'), animate === true ? 'bust' : 'bustr', 1400);
          flash('BUST!', 'bad', 1400, d.lost ? money(d.lost) + ' lost' : 'Nothing scored');
        }
        V.stake = 0; V.scoring = blankLocks();
        break;
      case 'bank':
        var p = viewPlayer(d.playerId);
        if (animate === true) coins(d.playerId);
        if (animate) flash('BANKED ' + money(d.amount), 'good', 1600, d.steal ? '+ ' + money(d.steal.amount) + ' from ' + nameOf(d.steal.fromId) : (d.via === 'offroad' ? 'Off-road sweep pays double' : ''));
        var setBank = function () {
          if (p) p.bank = d.bank;
          if (d.steal) { var f = viewPlayer(d.steal.fromId); if (f) f.bank -= d.steal.amount; }
          V.stake = 0;
          renderGame();
        };
        if (animate) later(700, setBank); else setBank();
        break;
      case 'win':
        V.status = 'finished'; V.winnerId = d.playerId;
        V.reels = [null, null, null, null, null, null]; V.locked = blankLocks(); V.scoring = blankLocks(); V.stake = 0;
        if (animate) { bump($('over'), 'land', 900); flash(nameOf(d.playerId) + ' WINS!', 'win', 2900); }
        break;
      case 'skip':
        V.stake = 0;
        break;
    }
  }

  /** Restart a one-shot CSS animation class on an element. */
  function bump(node, cls, ms) {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, ms);
  }

  function flash(text, kind, ms, sub) {
    var f = $('cab-flash');
    f.textContent = text;
    if (sub) f.appendChild(el('small', null, sub));
    f.className = 'cab-flash on ' + (kind || '');
    clearTimeout(S.flashTimer);
    S.flashTimer = setTimeout(function () { f.className = 'cab-flash'; }, ms);
  }

  function pop(text) {
    var p = $('stake-pop');
    p.textContent = text;
    bump(p, 'up', 900);
  }

  /** Coins fly from the stake to the player's chip and rig. */
  function coins(pid) {
    var from = $('stake-amt').getBoundingClientRect(), chip = document.querySelector('.chip[data-pid="' + pid + '"]');
    var rig = S.race && S.race.rigOf(pid), targets = [chip, rig].filter(Boolean);
    if (!targets.length) return;
    for (var k = 0; k < 7; k++) {
      (function (k) {
        var to = targets[k % targets.length].getBoundingClientRect();
        var c = el('i', 'coin');
        c.style.left = (from.left + from.width / 2 - 11) + 'px';
        c.style.top = (from.top + from.height / 2 - 11) + 'px';
        document.body.appendChild(c);
        setTimeout(function () {
          c.style.transform = 'translate(' + (to.left + to.width / 2 - from.left - from.width / 2) + 'px,' + (to.top + to.height / 2 - from.top - from.height / 2) + 'px) rotate(' + (200 + k * 40) + 'deg)';
          c.style.opacity = '0.2';
        }, 60 + k * 110);
        setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 1500 + k * 110);
      })(k);
    }
  }

  // ------------------------------------------------------------------ the machine

  function buildReels() {
    var box = $('reels');
    box.textContent = '';
    S.reelEls = [];
    for (var i = 0; i < 6; i++) {
      var win = el('div', 'win');
      win.setAttribute('role', 'button');
      win.setAttribute('tabindex', '0');
      win.setAttribute('data-i', String(i));
      win.appendChild(el('div', 'wbg'));
      var hole = el('div', 'hole'), bob = el('div', 'bob'), strip = el('div', 'strip');
      for (var c = 0; c < 18; c++) {
        var cell = el('div', 'cell'), img = document.createElement('img');
        img.src = 'assets/img/reels/' + STRIPS[i][c % 6] + '.svg';
        img.alt = '';
        img.draggable = false;
        cell.appendChild(img);
        strip.appendChild(cell);
      }
      strip.style.animationDelay = (-0.05 * i) + 's';
      bob.appendChild(strip);
      hole.appendChild(bob);
      win.appendChild(hole);
      win.appendChild(el('span', 'tp t1'));
      win.appendChild(el('span', 'tp t2'));
      var tag = el('span', 'tag');
      win.appendChild(tag);
      win.onclick = (function (i) { return function () { tapReel(i); }; })(i);
      win.onkeydown = (function (i) { return function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tapReel(i); } }; })(i);
      box.appendChild(win);
      S.reelEls.push({ win: win, bob: bob, strip: strip, tag: tag });
    }
  }

  function setFace(i, sym) {
    var k = 6 + STRIPS[i].indexOf(sym);   // the middle copy of the strip
    S.reelEls[i].strip.style.transform = 'translateY(' + (-k / 18 * 100).toFixed(4) + '%)';
  }

  /** My turn, nothing playing, nothing in flight: the controls are live. */
  function canAct() {
    var st = S.state;
    if (!st || !V) return false;
    var g = st.game, me = playerById(st.meId);
    return g.status === 'active' && g.currentId === st.meId && !!me && !me.out && !S.inflight && !animating();
  }

  function selList() {
    if (S.selTurn !== (V && V.turn)) return [];
    var out = [];
    for (var i = 0; i < 6; i++) if (S.sel[i]) out.push(i);
    return out;
  }

  function freeIdx() {
    var out = [];
    for (var i = 0; i < 6; i++) if (!V.locked[i] && V.reels[i] !== null) out.push(i);
    return out;
  }

  function tapReel(i) {
    Sound.unlock();
    var ok = canAct() && V.phase === 'rolled' && S.state.game.phase === 'rolled';
    if (!ok || V.locked[i] || !V.scoring[i]) { bump(S.reelEls[i].win, 'nope', 400); return; }
    if (S.selTurn !== V.turn) { S.sel = {}; S.selTurn = V.turn; }
    var s = V.reels[i], free = freeIdx(), group = [i];
    var same = free.filter(function (j) { return V.reels[j] === s; });
    var distinct = {};
    free.forEach(function (j) { distinct[V.reels[j]] = true; });
    var straight = free.length === 6 && Object.keys(distinct).length === 6;
    if (!R.SINGLE.hasOwnProperty(s)) group = straight ? free : same;   // a set only scores whole: hold (or drop) all of it
    var on = !S.sel[i];
    group.forEach(function (j) { if (on) S.sel[j] = true; else delete S.sel[j]; });
    if (on) Sfx.holdTap(i);
    renderGame();
  }

  /** What the current selection is worth and what the buttons would do. */
  function preview() {
    var g = S.state.game, sel = selList(), syms = sel.map(function (i) { return V.reels[i]; });
    var pts = sel.length ? R.scoreSelection(syms) : null;
    var lockedN = V.locked.filter(Boolean).length, free = 6 - lockedN;
    var completes = sel.length > 0 && lockedN + sel.length === 6;
    var stake = (g.stake | 0) + (pts || 0);
    var sweeps = completes ? Math.min((g.sweeps | 0) + 1, 2) : (g.sweeps | 0);
    var olla = completes && g.card && g.card.key === 'sweep' && (g.sweeps | 0) === 0;
    var card = g.card ? g.card.key : null;
    return {
      sel: sel, pts: pts, valid: sel.length > 0 && pts !== null, rollN: completes ? 6 : free - sel.length, completes: completes, olla: olla,
      bank: pts === null ? null : R.bankAmount(card, stake, sweeps), reason: R.bankReason(card, stake, sweeps), stake: stake, card: card
    };
  }

  function renderReels() {
    if (!V || !S.reelEls.length) return;
    var live = canAct() && V.phase === 'rolled', sel = selList();
    var hintVals = live ? hintValues(sel) : {};
    for (var i = 0; i < 6; i++) {
      var r = S.reelEls[i], w = r.win, face = V.reels[i] !== null && V.reels[i] !== undefined ? V.reels[i] : V.faces[i];
      if (face === null || face === undefined) face = STRIPS[i][2];
      if (!V.spinning[i]) setFace(i, face);
      var held = sel.indexOf(i) >= 0 && !V.locked[i];
      var hint = live && V.scoring[i] && !V.locked[i] && !held;
      w.classList.toggle('spin', !!V.spinning[i]);
      w.classList.toggle('idle', !V.spinning[i] && (V.reels[i] === null || V.reels[i] === undefined));
      w.classList.toggle('locked', !!V.locked[i]);
      w.classList.toggle('held', held);
      w.classList.toggle('hint', !!hint);
      w.classList.toggle('arm', S.arming && !V.locked[i] && !held);
      var tag = V.locked[i] ? 'LOCKED' : held ? 'HELD' : hint ? hintVals[i] : '';
      r.tag.textContent = tag;
      r.tag.className = 'tag' + (V.locked[i] ? ' locked' : held ? ' held' : hint ? ' hint' : '');
      r.tag.hidden = !tag;
      var nm = V.reels[i] !== null && V.reels[i] !== undefined ? SYMBOL_NAMES[V.reels[i]] : 'reel';
      w.setAttribute('aria-label', 'Reel ' + (i + 1) + ': ' + nm + (V.locked[i] ? ', locked' : held ? ', held' : hint ? ', scores, tap to hold' : ''));
      w.setAttribute('aria-pressed', held ? 'true' : 'false');
    }
  }

  /** The "+$" tag on each scoring reel: what holding it adds to the current selection (a set shows its whole value). */
  function hintValues(sel) {
    var out = {}, base = sel.length ? R.scoreSelection(sel.map(function (i) { return V.reels[i]; })) : 0;
    var free = freeIdx();
    for (var i = 0; i < 6; i++) {
      if (!V.scoring[i] || V.locked[i] || sel.indexOf(i) >= 0) continue;
      var s = V.reels[i], add = [i];
      if (!R.SINGLE.hasOwnProperty(s)) {   // a set: the tap holds all of it (or the whole Supersweep)
        var same = free.filter(function (j) { return V.reels[j] === s; });
        add = (same.length >= 3 ? same : free).filter(function (j) { return sel.indexOf(j) < 0; });
      }
      var v = R.scoreSelection(sel.concat(add).map(function (j) { return V.reels[j]; }));
      out[i] = v !== null && base !== null ? '+' + money(v - base) : 'SET';
    }
    return out;
  }

  function renderGoal() {
    var key = V.card, c = CARDS[key] || ['', ''], st = S.state;
    var gcard = st.game.card;
    if (gcard && gcard.key === key) c = [gcard.name || c[0], gcard.text || c[1]];
    if (V.status === 'finished') {
      c = ['The race is won', nameOf(V.winnerId) + ' reached ' + money(V.target) + ' first.'];
      key = 'sweep';
    }
    $('goal-name').textContent = c[0] ? c[0].toUpperCase() : '';
    $('goal-text').textContent = c[1];
    if ($('goal-icon').getAttribute('data-k') !== key) {
      $('goal-icon').innerHTML = ICON[key] || '';   // static markup from the ICON table above
      $('goal-icon').setAttribute('data-k', key || '');
    }
    var mine = V.currentId === st.meId;
    $('goal-kicker').textContent = V.status === 'finished' ? 'GAME OVER' : mine ? 'YOUR GOAL CARD' : (nameOf(V.currentId) + "'s goal card").toUpperCase();
    $('goal').className = 'goal card-' + (key || 'none') + (mine ? ' mine' : '');
  }

  function renderGame() {
    var st = S.state;
    if (!st || !V || $('screen-game').hidden && st.game.status === 'lobby') return;
    var g = st.game, me = st.meId, act = canAct();
    $('game-code').textContent = 'ROOM ' + g.code;

    if (S.race) S.race.render(V.players, bankMap(), V.target, V.status === 'active' ? V.currentId : null);
    var mp = viewPlayer(me), place = S.race && mp ? S.race.placeName(mp.bank, V.target) : null;
    $('race-note').textContent = !mp ? '' : mp.bank >= V.target ? 'Your rig made it: ' + money(mp.bank) + ' at the finish!'
      : 'Your rig: ' + money(mp.bank) + ' of ' + money(V.target) + (place ? ' · ' + place : '');

    renderGoal();
    renderReels();

    // stake and the message line
    var pv = act && V.phase === 'rolled' ? preview() : null;
    $('stake-amt').textContent = money(V.stake);
    $('stake-sel').hidden = !(pv && pv.valid);
    $('stake-sel').textContent = pv && pv.valid ? '+' + money(pv.pts) + ' held' : '';
    $('actions').hidden = V.status === 'finished';
    var msg = '', cur = viewPlayer(V.currentId), meP = playerById(me);
    if (V.status === 'finished') msg = nameOf(V.winnerId) + ' wins the race!';
    else if (meP && meP.out && g.status === 'active') msg = 'The host has you sitting out.';
    else if (V.currentId !== me) msg = (cur ? cur.name : 'Someone') + (cur && cur.bot ? ' (computer) is up.' : ' is up.');
    else if (animating() || S.inflight) msg = 'Your turn.';
    else if (V.phase === 'start') msg = V.card === 'offroad' ? 'Your turn. No banking this time: roll until you sweep.' : 'Your turn. Tap ROLL.';
    else if (pv && !pv.sel.length) msg = 'Tap the reels that score to hold them.';
    else if (pv && !pv.valid) msg = 'Those reels do not score together. Hold the whole set.';
    else if (pv) msg = 'Holding ' + money(pv.pts) + '. ' + (pv.bank !== null ? 'Bank now for ' + money(pv.bank) + (pv.olla ? ' + olla' : '') + '.' : 'Roll ' + (pv.completes ? 'six fresh reels' : 'the other ' + pv.rollN) + '.');
    $('stake-msg').textContent = msg;

    // ROLL and BANK
    var roll = $('btn-roll'), bank = $('btn-bank'), rsub = ' ', bsub = ' ';
    var rollOk = false, bankOk = false;
    if (act && V.phase === 'start' && g.phase === 'start') { rollOk = true; rsub = 'all six reels'; bsub = 'roll first'; }
    else if (pv) {
      if (!pv.sel.length) { rsub = 'hold a reel first'; bsub = 'hold a reel first'; }
      else if (!pv.valid) { rsub = 'not a scoring set'; bsub = 'not a scoring set'; }
      else {
        rollOk = true;
        rsub = pv.completes ? '6 fresh reels' : pv.rollN + (pv.rollN === 1 ? ' reel' : ' reels');
        if (pv.bank !== null) { bankOk = true; bsub = money(pv.bank) + (pv.olla ? ' + olla' : ''); }
        else bsub = pv.reason ? pv.reason.toLowerCase() : 'not allowed';
      }
    } else if (V.status === 'active' && V.currentId === me && V.card) {
      var reason = R.bankReason(V.card, V.stake, V.sweeps);
      bsub = V.card === 'offroad' ? 'no banking' : ' ';
      if (reason && V.card !== 'offroad' && V.phase !== 'start') bsub = reason.toLowerCase();
    }
    roll.disabled = !rollOk;
    bank.disabled = !bankOk;
    roll.querySelector('b').textContent = 'ROLL';
    $('roll-sub').textContent = rsub;
    $('bank-sub').textContent = bsub;
    roll.setAttribute('aria-label', 'Roll ' + (rsub.trim() || ''));
    bank.setAttribute('aria-label', 'Bank ' + (bsub.trim() || ''));
    $('cab-label').textContent = V.status === 'finished' ? 'GAME OVER' : V.currentId === me ? 'SIX REELS · TAP TO HOLD' : (nameOf(V.currentId) + "'S REELS").toUpperCase();

    renderChips();
    renderOver();
    renderHostTools();
    botTick();
  }

  function bankMap() {
    var m = {};
    V.players.forEach(function (p) { m[p.id] = p.bank; });
    return m;
  }

  function renderChips() {
    var box = $('chips'), me = S.state.meId;
    box.textContent = '';
    box.className = 'chips n' + V.players.length;
    V.players.forEach(function (p) {
      var c = el('div', 'chip' + (p.id === V.currentId && V.status === 'active' ? ' on' : '') + (p.out ? ' out' : '') + (p.id === V.winnerId ? ' won' : ''));
      c.setAttribute('data-pid', String(p.id));
      c.appendChild(pieceImg(p.vehicle));
      c.appendChild(el('b', null, p.name + (p.id === me ? ' (you)' : '')));
      c.appendChild(el('span', null, money(p.bank)));
      if (p.out) c.appendChild(el('small', null, 'sitting out'));
      else if (p.bot) c.appendChild(el('small', null, 'computer'));
      box.appendChild(c);
    });
  }

  function renderOver() {
    var st = S.state, g = st.game, fin = V.status === 'finished' && g.status === 'finished';
    $('over').hidden = !fin;
    if (!fin) return;
    var w = viewPlayer(V.winnerId);
    $('over-title').textContent = (V.winnerId === st.meId ? 'You win' : (w ? w.name : 'Someone') + ' wins') + ' with ' + money(w ? w.bank : 0) + '!';
    $('btn-rematch').hidden = st.meId !== g.hostId;
    $('rematch-wait').hidden = st.meId === g.hostId;
  }

  function renderHostTools() {
    var st = S.state, g = st.game, me = st.meId, box = $('host-tools');
    var on = g.status === 'active' && me === g.hostId;
    box.hidden = !on;
    if (!on) return;
    var cur = playerById(g.currentId);
    $('btn-skip').hidden = !(cur && cur.id !== me);
    $('btn-skip').textContent = cur ? 'Skip ' + cur.name + "'s turn" : 'Skip turn';
    var ul = $('host-players');
    ul.textContent = '';
    st.players.forEach(function (p) {
      if (p.id === me) return;
      var li = el('li', p.out ? 'out' : '');
      li.appendChild(pieceImg(p.vehicle));
      li.appendChild(el('span', 'nm', p.name + (p.out ? ' (sitting out)' : '')));
      var b = el('button', 'mini-btn', p.out ? 'Bring back' : 'Sit out');
      b.type = 'button';
      b.onclick = (function (pl) { return function () { sitOut(pl); }; })(p);
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  // ------------------------------------------------------------------ actions

  /** roll / bank: `turn` and a fresh `key` guard against double taps. The buttons stay off until the result has played. */
  function act(kind, picks) {
    if (S.inflight || !canAct()) return;
    S.inflight = true;
    S.arming = kind === 'roll';
    var body = { code: S.code, turn: S.state.game.turn, key: newKey(), picks: picks };
    $('game-error').textContent = '';
    renderGame();
    api(kind, body).catch(function (e) {
      $('game-error').textContent = e.message;
      S.arming = false;
    }).then(function () { return poll(); }).then(function () {
      S.inflight = false;
      renderGame();
    });
  }

  function onRoll() {
    Sound.unlock();
    var g = S.state && S.state.game;
    if (!g) return;
    if (g.phase === 'start') act('roll', []);
    else { var pv = preview(); if (pv.valid) act('roll', pv.sel); }
  }

  function onBank() {
    Sound.unlock();
    var pv = preview();
    if (pv.valid && pv.bank !== null) act('bank', pv.sel);
  }

  /** Computer seats: the host's page moves them (any seated page does when the host seems away). */
  function botTick() {
    var st = S.state;
    if (!st || S.botTimer || S.botBusy || S.inflight || animating()) return;
    var g = st.game, cur = playerById(g.currentId);
    if (g.status !== 'active' || !st.meId || !cur || !cur.bot) return;
    var isHost = st.meId === g.hostId;
    var wait = BOT_MIN_MS + Math.random() * BOT_SPREAD_MS;
    if (!isHost) wait = Math.max(0, S.lastChangeAt + BOT_FALLBACK_MS - now()) + Math.random() * 1500;
    var turn = g.turn;
    S.botTimer = setTimeout(function () {
      S.botTimer = null;
      var st2 = S.state;
      if (!st2 || st2.game.turn !== turn || animating() || S.inflight) { botTick(); return; }
      if (!isHost && now() - S.lastChangeAt < BOT_FALLBACK_MS) { botTick(); return; }
      S.botBusy = true;
      api('botstep', { code: S.code, turn: turn, key: newKey() }).catch(function () { /* someone else moved it: the poll shows it */ })
        .then(function () { return poll(); })
        .then(function () { S.botBusy = false; botTick(); });
    }, wait);
  }

  function hostCall(action, body) {
    $('game-error').textContent = '';
    return api(action, body).catch(function (e) { $('game-error').textContent = e.message; }).then(poll);
  }
  function skipTurn() {
    var g = S.state && S.state.game, cur = g && playerById(g.currentId);
    if (!g || !cur || !confirm('Skip ' + cur.name + "'s turn? Their unbanked stake is lost.")) return;
    hostCall('skip', { code: S.code, turn: g.turn });
  }
  function sitOut(p) {
    var on = !p.out;
    if (!confirm(on ? p.name + ' will sit out: their turns are passed over until you bring them back. Continue?' : 'Bring ' + p.name + ' back into the game?')) return;
    hostCall('sitout', { code: S.code, playerId: p.id, on: on });
  }
  function rematch() {
    Sound.unlock();
    $('btn-rematch').disabled = true;
    api('rematch', { code: S.code }).catch(function (e) { $('game-error').textContent = e.message; })
      .then(function () { $('btn-rematch').disabled = false; return poll(); });
  }

  function removedFromGame(code) {
    clearTimeout(S.pollTimer); clearTimeout(S.botTimer);
    lsDel('bandit_token_' + code);
    if (lsGet('bandit_last_code') === code) lsDel('bandit_last_code');
    if (S.gameShown) resetGameView();
    history.replaceState(null, '', './');
    S.code = null;
    showHome(code);
    $('home-error').textContent = 'The host removed you from this game.';
  }

  /** Back to the lobby (Play again): a clean machine and log. */
  function resetGameView() {
    S.gameShown = false; S.viewReady = false; V = null;
    clearTimeout(S.botTimer); S.botTimer = null;
    S.timers.forEach(clearTimeout); S.timers = [];
    S.animEnd = 0; S.animPending = false; clearTimeout(S.animTimer); S.sel = {}; S.selTurn = null; S.arming = false;
    $('log').textContent = '';
    $('game-error').textContent = '';
    $('over').hidden = true;
    if (S.race) { $('race').textContent = ''; S.race = new window.BanditRace($('race')); }
  }

  function addLog(ev) {
    var d = ev.data || {}, who = d.playerId ? nameOf(d.playerId) : '', text;
    if (ev.type === 'turn') text = who + "'s turn · " + ((CARDS[d.card] || [d.card])[0]);
    else if (ev.type === 'join') text = who ? who + ' joined.' : '';
    else if (ev.type === 'start') text = 'The race is on!';
    else if (ev.type === 'leave' || ev.type === 'rematch') text = '';
    else if (ev.type === 'win') text = who + ' wins with ' + money(d.bank) + '!';
    else if (ev.msg) text = (who ? who + ': ' : '') + ev.msg;
    if (!text) return;
    var li = el('li', 'ev-' + ev.type, text);
    var log = $('log');
    log.insertBefore(li, log.firstChild);
    while (log.children.length > 60) log.removeChild(log.lastChild);
  }

  // ------------------------------------------------------------------ sound UI

  function updateSoundBar() {
    var inRoom = !!S.code && (!$('screen-game').hidden || !$('screen-lobby').hidden);
    $('sound-bar').hidden = Sound.muted || !(Sound.paused() || (inRoom && !Sound.unlocked && S.state && S.state.game.status === 'active'));
  }

  function wireSoundPanel() {
    var panel = $('snd-panel');
    $('set-mute').checked = Sound.muted;
    $('set-vol').value = Sound.volume;
    $('set-vol-val').textContent = Sound.volume;
    $('btn-snd').classList.toggle('muted', Sound.muted);
    $('btn-snd').onclick = function (e) {
      e.stopPropagation();
      Sound.unlock();
      panel.hidden = !panel.hidden;
      $('btn-snd').setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    };
    panel.onclick = function (e) { e.stopPropagation(); };
    document.addEventListener('click', function () { panel.hidden = true; $('btn-snd').setAttribute('aria-expanded', 'false'); });
    $('set-mute').onchange = function () { Sound.setMuted(this.checked); $('btn-snd').classList.toggle('muted', Sound.muted); updateSoundBar(); };
    $('set-vol').oninput = function () {
      $('set-vol-val').textContent = this.value; Sound.setVolume(+this.value);
      if (Sfx.ready()) Sfx.play('clink', null, { gain: 0.6 });
    };
  }

  // ------------------------------------------------------------------ start-up

  function wireUp() {
    $('in-code').addEventListener('input', onCodeInput);
    $('btn-create').onclick = function () { homeSubmit('create'); };
    $('btn-join').onclick = function () { homeSubmit('join'); };
    $('btn-solo').onclick = playSolo;
    $('btn-addbot').onclick = function () { Sound.unlock(); lobbyCall('addbot', { code: S.code }); };
    $('sel-target').onchange = function () { lobbyCall('setup', { code: S.code, target: +this.value }); };
    $('btn-start').onclick = function () {
      Sound.unlock();
      $('btn-start').disabled = true;
      lobbyCall('start', { code: S.code });
    };
    $('btn-roll').onclick = onRoll;
    $('btn-bank').onclick = onBank;
    $('btn-skip').onclick = skipTurn;
    $('btn-rematch').onclick = rematch;
    wireSoundPanel();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { if (Sound.paused()) Sound.resumeCtx(); updateSoundBar(); }
      if (!document.hidden && S.code && !S.stopPolling) poll();
    });
    // any tap starts the sound (iOS needs a tap) and resumes it after a call or the lock screen
    ['touchend', 'click', 'keydown'].forEach(function (evn) {
      document.addEventListener(evn, function () { if (!Sound.unlocked || Sound.paused()) { Sound.unlock(); updateSoundBar(); } }, true);
    });
    $('sound-bar').onclick = function () { Sound.unlock(); updateSoundBar(); };
    Sound.stateListeners.push(updateSoundBar);
  }

  function init() {
    wireUp();
    Clock.start();
    S.race = new window.BanditRace($('race'));
    api('info').then(function (j) {
      S.vehicles = j.vehicles || {};
      var code = cleanCode(Q.get('g'));
      if (code) {
        S.code = code;
        S.token = lsGet('bandit_token_' + code);   // the cookie is the fallback
        startPolling();
      } else {
        showHome('');
      }
    }).catch(function (e) {
      document.body.textContent = 'Could not load the game: ' + e.message;
    });
  }

  // read-only hooks for the browser test and for debugging in the console
  window.BanditApp = { state: function () { return S; }, view: function () { return V; }, animating: animating, canAct: canAct,
    preview: function () { return V && S.state && S.state.game.phase === 'rolled' ? preview() : null; } };
  init();
})();
