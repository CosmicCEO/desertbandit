#!/usr/bin/env node
// A stand-in for desertbandit/api.php (docs/WAVE1.md contract) for client work without PHP or MySQL.
// It serves the desertbandit/ folder and answers ?a=... from memory with a JavaScript copy of the engine (lib/rules.php).
// The real tests run against the PHP server; this is for layout work and quick checks.
//   node dev/e2e/mock_server.js [port]        (default 8898)   then open http://127.0.0.1:8898/
//   dev knobs: ?a=_force&reels=0,0,0,1,2,3 (the next roll shows these)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const R = require('../../desertbandit/assets/js/scoring.js');
const ROOT = path.join(__dirname, '../../desertbandit');
const LEAD = 1500;
const VEHICLES = { 'bronco-orange': 'Marigold Bronco', 'jeep-red': 'Red Rocket', 'buggy-blue': 'Blue Buggy', 'rail-purple': 'Purple Rail',
  'cruiser-teal': 'Teal Cruiser', 'scout-butter': 'Butter Scout', 'blazer-twotone': 'Two-Tone Blazer', 'ranger-green': 'Ranger Green' };
const CARDS = [['sweep', 56], ['broken', 11], ['fire', 11], ['offroad', 11], ['subpoena', 7], ['overdue', 4]];
const NAMES = { sweep: 'Found an Olla', broken: 'Vehicle Breaks Down', fire: 'Ground Fire Report', offroad: 'Off-Road Bust', subpoena: 'Subpoena', overdue: 'Reports Overdue' };
const games = {};
let nextId = 1, nextEv = 1, forced = null;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const money = n => '$' + n.toLocaleString('en-US');

function line(e) {
  switch (e.type) {
    case 'turn': return 'New turn. Goal card: ' + NAMES[e.card] + '.';
    case 'broken': return 'The vehicle breaks down. Turn skipped.';
    case 'roll': return 'Rolled ' + e.rolled.length + ' reel' + (e.rolled.length === 1 ? '' : 's') + '.';
    case 'lock': return 'Kept ' + e.picks.length + ' reel' + (e.picks.length === 1 ? '' : 's') + ' for ' + money(e.points) + '. Stake ' + money(e.stake) + '.';
    case 'sweep': return 'Sweep!' + (e.bonus ? ' Bonus ' + money(e.bonus) + '.' : '');
    case 'bust': return 'Bust. ' + money(e.lost) + ' lost.';
    case 'bank': return 'Banked ' + money(e.amount) + '. Total ' + money(e.bank) + '.' + (e.steal ? ' Took ' + money(e.steal.amount) + ' from the leader.' : '');
    case 'win': return 'Wins with ' + money(e.bank) + '!';
    case 'skip': return 'Turn skipped by the host.';
    case 'sitout': return 'Sitting out.';
    case 'back': return 'Back in the game.';
  }
  return e.type;
}
class RuleError extends Error {}

function drawCard(allowBroken) {
  for (;;) {
    let r = rnd(1, 100), acc = 0;
    for (const [k, p] of CARDS) { acc += p; if (r <= acc) { if (k === 'broken' && !allowBroken) break; return k; } }
  }
}
function nextActive(st, from) { const n = st.players.length; for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (!st.players[i].out) return i; } return from; }
function beginTurn(st, ev, idx) {
  for (let tries = 0; ; tries++) {
    Object.assign(st, { current: idx, card: drawCard(tries < 12), phase: 'start', reels: null, locked: Array(6).fill(false), stake: 0, sweeps: 0 });
    const pid = st.players[idx].id;
    ev.push({ type: 'turn', playerId: pid, card: st.card });
    if (st.card !== 'broken') return;
    ev.push({ type: 'broken', playerId: pid });
    idx = nextActive(st, idx);
  }
}
function applyPicks(st, picks, ev) {
  if (!picks.length) throw new RuleError('Pick at least one reel that scores.');
  const seen = {}, syms = [];
  for (const p of picks) {
    if (!Number.isInteger(p) || p < 0 || p > 5 || seen[p] || st.locked[p] || st.reels[p] === null) throw new RuleError('Those reels cannot be kept.');
    seen[p] = 1; syms.push(st.reels[p]);
  }
  const pts = R.scoreSelection(syms);
  if (pts === null) throw new RuleError('Every reel you keep has to score.');
  picks = picks.slice().sort((a, b) => a - b);
  const pid = st.players[st.current].id;
  picks.forEach(p => { st.locked[p] = true; });
  st.stake += pts;
  ev.push({ type: 'lock', playerId: pid, picks, points: pts, stake: st.stake });
  if (st.locked.includes(false)) return null;
  if (st.card === 'offroad') { ev.push({ type: 'sweep', playerId: pid, bonus: 0, sweeps: st.sweeps + 1 }); return st.stake * 2 + 300; }
  let bonus = 0;
  if (st.card === 'sweep' && st.sweeps === 0) { bonus = [300, 400, 500][rnd(0, 2)]; st.stake += bonus; }
  st.sweeps = Math.min(st.sweeps + 1, 2);
  st.locked = Array(6).fill(false);
  ev.push({ type: 'sweep', playerId: pid, bonus, sweeps: st.sweeps });
  return null;
}
function payOut(st, amount, via, ev) {
  const idx = st.current, pid = st.players[idx].id;
  let steal = null;
  if (st.card === 'subpoena' && via === 'bank') {
    let leader = null;
    st.players.forEach((p, i) => { if (i !== idx && (leader === null || p.bank > st.players[leader].bank)) leader = i; });
    if (leader !== null && st.players[leader].bank > st.players[idx].bank) {
      const take = Math.min(100, st.players[leader].bank);
      st.players[leader].bank -= take; st.players[idx].bank += take;
      steal = { fromId: st.players[leader].id, amount: take };
    }
  }
  st.players[idx].bank += amount;
  ev.push({ type: 'bank', playerId: pid, amount, stake: st.stake, via, steal, bank: st.players[idx].bank });
  if (st.players[idx].bank >= st.target) {
    Object.assign(st, { status: 'finished', winner: pid, stake: 0, phase: 'start', reels: null, locked: Array(6).fill(false) });
    ev.push({ type: 'win', playerId: pid, bank: st.players[idx].bank });
    return;
  }
  beginTurn(st, ev, nextActive(st, st.current));
}
function roll(st, picks, ev) {
  const pid = st.players[st.current].id;
  if (st.phase === 'start') { if (picks.length) throw new RuleError('Roll the reels first, then pick the ones you want to keep.'); }
  else { const r = applyPicks(st, picks, ev); if (r !== null) { payOut(st, r, 'offroad', ev); st.turn++; return; } }
  const reels = st.reels ? st.reels.slice() : Array(6).fill(null), rolled = [];
  for (let i = 0; i < 6; i++) if (!st.locked[i]) { reels[i] = forced ? forced[i] : rnd(0, 5); rolled.push(i); }
  forced = null;
  st.reels = reels;
  const scoring = R.scoringReels(reels, st.locked);
  ev.push({ type: 'roll', playerId: pid, reels, rolled, scoring });
  if (!scoring.includes(true)) { ev.push({ type: 'bust', playerId: pid, lost: st.stake }); beginTurn(st, ev, nextActive(st, st.current)); }
  else st.phase = 'rolled';
  st.turn++;
}
function bank(st, picks, ev) {
  if (st.phase !== 'rolled') throw new RuleError('Roll the reels first.');
  if (st.card === 'offroad') throw new RuleError('Off-Road Bust: no banking. Keep rolling until you sweep all six reels.');
  applyPicks(st, picks, ev);
  const amt = R.bankAmount(st.card, st.stake, st.sweeps);
  if (amt === null) throw new RuleError(st.card === 'fire' ? 'Ground Fire Report: you need $1,000 to bank.' : st.card === 'overdue' ? 'Reports Overdue: you can bank only after two sweeps.' : 'You cannot bank that.');
  payOut(st, amt, 'bank', ev);
  st.turn++;
}
function botDecide(st) {
  if (st.phase === 'start') return ['roll', []];
  const sc = R.scoringReels(st.reels, st.locked), picks = [];
  sc.forEach((s, i) => { if (s) picks.push(i); });
  const pts = R.scoreSelection(picks.map(i => st.reels[i]));
  const freeAfter = st.locked.filter(x => !x).length - picks.length;
  const sweeps = freeAfter === 0 ? Math.min(st.sweeps + 1, 2) : st.sweeps;
  const amt = R.bankAmount(st.card, st.stake + pts, sweeps);
  if (amt !== null && freeAfter > 0 && (freeAfter <= 2 || st.stake + pts >= 400)) return ['bank', picks];
  return ['roll', picks];
}

function json(res, code, obj) {
  obj.serverNow = Date.now();
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function stateOf(g, meId, since) {
  const st = g.state, view = { code: g.code, status: g.status, target: g.target, turn: g.turn, hostId: g.hostId, currentId: null, winnerId: g.winnerId,
    card: null, phase: 'start', reels: Array(6).fill(null), locked: Array(6).fill(false), scoring: Array(6).fill(false), stake: 0, sweeps: 0 };
  if (st) {
    Object.assign(view, { currentId: st.players[st.current].id, card: { key: st.card, name: NAMES[st.card], text: '' }, phase: st.phase,
      reels: st.reels ? st.reels.slice() : Array(6).fill(null), locked: st.locked.slice(), stake: st.stake, sweeps: st.sweeps, winnerId: st.winner });
    view.scoring = st.reels && st.phase === 'rolled' ? R.scoringReels(st.reels, st.locked) : Array(6).fill(false);
  }
  const players = g.players.map(p => { const sp = st && st.players.find(x => x.id === p.id); return { id: p.id, name: p.name, vehicle: p.vehicle, seat: p.seat, bank: sp ? sp.bank : 0, out: sp ? sp.out : false, bot: p.bot }; });
  let events = g.events.filter(e => e.id > since);
  if (since === 0) events = events.slice(-40); else events = events.slice(0, 200);
  return { ok: true, meId, game: view, players, events };
}
function pushEvents(g, list) {
  const playAt = Date.now() + LEAD;
  list.forEach(e => { const { type, ...data } = e; g.events.push({ id: nextEv++, type, msg: line(e), data, playAt }); });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.endsWith('/api.php')) return api(req, res, u);
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(f).slice(1);
    res.writeHead(200, { 'Content-Type': { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', json: 'application/json', ttf: 'font/ttf', jpg: 'image/jpeg' }[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

function api(req, res, u) {
  const a = u.searchParams.get('a');
  if (a === 'time') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, t: Date.now() })); }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let b = {};
    if (req.method === 'POST') { try { b = JSON.parse(body || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'Bad JSON.' }); } }
    const tok = req.headers['x-player-token'] || '';
    const code = (b.code || u.searchParams.get('code') || '').toUpperCase();
    const g = games[code];
    const me = g && tok ? g.players.find(p => p.token === tok) : null;
    try {
      switch (a) {
        case 'info': return json(res, 200, { ok: true, vehicles: VEHICLES, targets: [2500, 5000, 7500, 10000, 12500, 15000], minPlayers: 2, maxPlayers: 4 });
        case 'stats': return json(res, 200, { ok: true, games: Object.values(games).filter(x => x.status !== 'finished').length });
        case '_force': forced = u.searchParams.get('reels').split(',').map(Number); return json(res, 200, { ok: true });
        case 'peek':
          if (!g) return json(res, 404, { ok: false, error: 'No game with that code.' });
          return json(res, 200, { ok: true, code, status: g.status, taken: g.players.map(p => p.vehicle), players: g.players.length });
        case 'state':
          if (!g) return json(res, 404, { ok: false, error: 'No game with that code.' });
          return json(res, 200, stateOf(g, me ? me.id : null, +u.searchParams.get('since') || 0));
        case 'create': {
          let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[rnd(0, 23)]).join(''); } while (games[c]);
          const token = crypto.randomBytes(16).toString('hex'), id = nextId++;
          games[c] = { code: c, status: 'lobby', target: 5000, turn: 0, hostId: id, winnerId: null, state: null, events: [], lastKey: null,
            players: [{ id, name: String(b.name).slice(0, 20), vehicle: b.vehicle, seat: 0, bot: false, token }] };
          return json(res, 200, { ok: true, code: c, token });
        }
      }
      if (!g) return json(res, 404, { ok: false, error: 'No game with that code.' });
      if (a === 'join') {
        if (g.status !== 'lobby') return json(res, 409, { ok: false, error: 'That game has already started.' });
        if (g.players.length >= 4) return json(res, 409, { ok: false, error: 'That game is full.' });
        if (g.players.some(p => p.vehicle === b.vehicle)) return json(res, 409, { ok: false, error: 'That rig is taken.' });
        const token = crypto.randomBytes(16).toString('hex');
        g.players.push({ id: nextId++, name: String(b.name).slice(0, 20), vehicle: b.vehicle, seat: g.players.length, bot: false, token });
        pushEvents(g, [{ type: 'join', playerId: g.players[g.players.length - 1].id }]);
        return json(res, 200, { ok: true, code, token });
      }
      if (!me) return json(res, 403, { ok: false, error: 'You are not seated in this game.' });
      const host = me.id === g.hostId;
      const needHost = () => { if (!host) throw Object.assign(new Error('Only the host can do that.'), { status: 403 }); };
      if (b.key && b.key === g.lastKey) return json(res, 200, { ok: true, duplicate: true });
      const ev = [];
      switch (a) {
        case 'setup': needHost(); g.target = b.target; break;
        case 'addbot': {
          needHost();
          if (g.players.length >= 4) throw new RuleError('The game is full.');
          const v = Object.keys(VEHICLES).find(k => !g.players.some(p => p.vehicle === k));
          g.players.push({ id: nextId++, name: 'Rival ' + (g.players.filter(p => p.bot).length + 1), vehicle: v, seat: g.players.length, bot: true, token: null });
          ev.push({ type: 'join', playerId: g.players[g.players.length - 1].id });
          break;
        }
        case 'remove': needHost(); g.players = g.players.filter(p => p.id !== b.playerId || p.id === g.hostId); g.players.forEach((p, i) => { p.seat = i; }); ev.push({ type: 'leave' }); break;
        case 'start':
          needHost();
          if (g.players.length < 2) throw new RuleError('Desert Bandit needs 2 to 4 players.');
          g.status = 'active';
          g.state = { status: 'active', target: g.target, turn: 0, current: 0, players: g.players.map(p => ({ id: p.id, name: p.name, bank: 0, out: false })), winner: null };
          ev.push({ type: 'start' });
          beginTurn(g.state, ev, 0);
          break;
        case 'roll': case 'bank': case 'botstep': case 'skip': {
          if (g.status !== 'active') throw new RuleError('The game is over.');
          if (b.turn !== g.state.turn) return json(res, 409, { ok: false, error: 'That turn already happened.' });
          const cur = g.state.players[g.state.current].id, curP = g.players.find(p => p.id === cur);
          if (a === 'skip') { needHost(); ev.push({ type: 'skip', playerId: cur, lost: g.state.stake }); beginTurn(g.state, ev, nextActive(g.state, g.state.current)); g.state.turn++; break; }
          if (a === 'botstep') { if (!curP.bot) throw new RuleError('It is not a computer\'s turn.'); const [k, p] = botDecide(g.state); (k === 'roll' ? roll : bank)(g.state, p, ev); break; }
          if (cur !== me.id) throw new RuleError('It is not your turn.');
          (a === 'roll' ? roll : bank)(g.state, b.picks || [], ev);
          break;
        }
        case 'sitout': {
          needHost();
          const sp = g.state.players.find(p => p.id === b.playerId), on = !!b.on;
          if (sp.out === on) break;
          if (on && g.state.players.filter(p => !p.out).length <= 1) throw new RuleError('At least one player has to stay in.');
          sp.out = on;
          ev.push({ type: on ? 'sitout' : 'back', playerId: sp.id });
          if (on && g.state.players[g.state.current].id === sp.id) { beginTurn(g.state, ev, nextActive(g.state, g.state.current)); g.state.turn++; }
          break;
        }
        case 'rematch':
          needHost();
          g.status = 'lobby'; g.state = null; g.winnerId = null; ev.push({ type: 'rematch' });
          break;
        default: return json(res, 404, { ok: false, error: 'No such action.' });
      }
      if (g.state) { g.turn = g.state.turn; if (g.state.status === 'finished') { g.status = 'finished'; g.winnerId = g.state.winner; } }
      if (b.key) g.lastKey = b.key;
      pushEvents(g, ev);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, e.status || 409, { ok: false, error: e.message });
    }
  });
}

if (require.main === module) {
  const port = +process.argv[2] || 8898;
  server.listen(port, '127.0.0.1', () => console.log('mock api on http://127.0.0.1:' + port + '/'));
}
module.exports = port => new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
