#!/usr/bin/env node
// The radio rules (docs/WAVE2.md, "Which line plays") against desertbandit/assets/js/radio.js pickCall(), in plain Node (no dependencies).
//   node tests/radio_pick_test.js        exit code 0 = every check passed
'use strict';
var path = require('path'), fs = require('fs');
var R = require(path.join(__dirname, '../desertbandit/assets/js/radio.js'));
var LINES = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/audio-lines.json'), 'utf8'));
var pass = 0, fail = 0;
function eq(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log('FAIL ' + name + '\n     got  ' + JSON.stringify(got) + '\n     want ' + JSON.stringify(want));
}

// ---- event makers (the shapes of docs/WAVE1.md "Events") ----
var P1 = 11, P2 = 12;
function ev(id, type, data) { return { id: id, type: type, data: data || {} }; }
var roll = function (id) { return ev(id, 'roll', { playerId: P1, reels: [0, 1, 2, 3, 4, 5], rolled: [0, 1, 2, 3, 4, 5], scoring: [true, true, false, false, false, false] }); };
var lock = function (id, points, n) { var picks = []; for (var i = 0; i < (n || 1); i++) picks.push(i); return ev(id, 'lock', { playerId: P1, picks: picks, points: points, stake: points }); };
var sweep = function (id) { return ev(id, 'sweep', { playerId: P1, bonus: 0, sweeps: 1 }); };
var bust = function (id) { return ev(id, 'bust', { playerId: P1, lost: 300 }); };
var turn = function (id, card) { return ev(id, 'turn', { playerId: P2, card: card }); };
var broken = function (id) { return ev(id, 'broken', { playerId: P2 }); };
var win = function (id, bank) { return ev(id, 'win', { playerId: P1, bank: bank }); };
function bank(id, amount, after, o) {
  o = o || {};
  return ev(id, 'bank', { playerId: P1, amount: amount, stake: amount, via: o.via || 'bank', steal: o.steal || null, bank: after });
}
function pick(events, ctx) { return R.pickCall(events, Object.assign({ target: 5000, card: 'sweep' }, ctx || {})); }
function ids(res) { return res.calls.map(function (c) { return c.id; }); }
function first(res) { return res.calls[0] || { id: null, moment: null }; }
function brief(c) { return c && { id: c.id, kind: c.kind, offset: c.offset }; }

// ---- the tables match docs/audio-lines.json ----
var moments = {};
LINES.lines.forEach(function (l) { if (l.moment !== 'card') (moments[l.moment] = moments[l.moment] || {})[l.variant] = l.id; });
eq('HAS_C lists exactly the moments that have a c line', Object.keys(R.HAS_C).sort(), Object.keys(moments).filter(function (m) { return moments[m].c; }).sort());
eq('every result moment has a and b', Object.keys(moments).filter(function (m) { return !moments[m].a || !moments[m].b; }), []);
eq('CARD_CALLS == the cards with card-* lines', Object.keys(R.CARD_CALLS).sort(),
   LINES.lines.filter(function (l) { return l.moment === 'card'; }).map(function (l) { return l.card; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).sort());
eq('42 lines in docs/audio-lines.json', LINES.lines.length, 42);
// every id pickCall can produce for a result or card call exists in audio-lines.json
var lineIds = {}; LINES.lines.forEach(function (l) { lineIds[l.id] = 1; });
var produced = {};
['bust', 'lock', 'sweep', 'supersweep', 'fire', 'subpoena', 'broken', 'offroad', 'overdue', 'win', 'bigbank'].forEach(function (m) {
  [0, 1, 2, 3].forEach(function (id) { var v = R.variant({ id: id }, m); if (m === 'bigbank' && v === 'c') return; produced['call-' + m + '-' + v] = 1; });
});
eq('every call id the variant rule can produce is a line', Object.keys(produced).filter(function (id) { return !lineIds[id]; }), []);

// ---- variant(ev) ----
eq('variant: id%4==0 and the moment has c -> c', R.variant({ id: 8 }, 'bust'), 'c');
eq('variant: id%4==2 -> a', R.variant({ id: 6 }, 'bust'), 'a');
eq('variant: odd id -> b', R.variant({ id: 7 }, 'bust'), 'b');
eq('variant: odd id (id%4==1) -> b', R.variant({ id: 9 }, 'win'), 'b');
eq('variant: bigbank has no c: id%4==0 -> a', R.variant({ id: 8 }, 'bigbank'), 'a');
eq('variant: bigbank odd -> b', R.variant({ id: 5 }, 'bigbank'), 'b');
eq('variant: card has no c: id%4==0 -> a', R.variant({ id: 12 }, 'card'), 'a');

// ---- priority rows, each on its own (offsets from the action start, WAVE1 durations) ----
// 1 win: bank (lock 450 then bank 1700) then win at 2150 -> +400
var winAct = [lock(100, 1000, 3), bank(101, 1000, 5200), win(102, 5200)];
eq('row 1 win: the win line at win start + 400', brief(first(pick(winAct))), { id: 'call-win-a', kind: 'result', offset: 450 + 1700 + 400 });
eq('row 1 win beats the bigbank and the lock', ids(pick([lock(100, 1500, 6), bank(101, 1600, 5100), win(103, 5100)])), ['call-win-b']);
// 2 supersweep: a lock of 1500 with six picks (then the sweep): lock start + 450
eq('row 2 supersweep: lock 1500 x6 picks, at lock start + 450 (after a roll)', brief(first(pick([roll(200), lock(201, 1500, 6), sweep(202)]))),
   { id: 'call-supersweep-b', kind: 'result', offset: 2800 + 450 });
eq('row 2 needs six picks (1500 with 5 picks is a lock, row 10)', ids(pick([lock(210, 1500, 5)])), ['call-lock-a']);
eq('row 2 beats the sweep row', first(pick([lock(204, 1500, 6), sweep(205)])).moment, 'supersweep');
// 3 offroad: bank via offroad, bank start + 500 (lock 450, sweep 1400 before it)
var offAct = [lock(300, 300, 2), sweep(301), bank(302, 2900, 4000, { via: 'offroad' }), turn(303, 'broken'), broken(304), turn(305, 'sweep')];
eq('row 3 offroad: bank via offroad at bank start + 500', brief(first(pick(offAct, { card: 'offroad' }))), { id: 'call-offroad-a', kind: 'result', offset: 450 + 1400 + 500 });
eq('row 3 offroad beats broken in the same action and the sweep', ids(pick(offAct, { card: 'offroad' })).slice(0, 1), ['call-offroad-a']);
// 4 overdue / 5 fire: the card in force for the bank
eq('row 4 overdue: a bank while the card is overdue', brief(first(pick([lock(400, 500, 3), bank(401, 6000, 6000)], { card: 'overdue', target: 10000 }))),
   { id: 'call-overdue-b', kind: 'result', offset: 950 });
eq('row 5 fire: a bank while the card is fire', ids(pick([lock(500, 1000, 3), bank(501, 1500, 1500)], { card: 'fire' })).slice(0, 1), ['call-fire-b']);
eq('row 5 fire: id%4==0 bank -> fire c', ids(pick([lock(503, 1000, 3), bank(504, 1500, 1500)], { card: 'fire' })).slice(0, 1), ['call-fire-c']);
eq('row 4 overdue beats fire? (card decides: overdue card -> overdue)', first(pick([bank(402, 2500, 2500)], { card: 'overdue' })).moment, 'overdue');
// 6 subpoena: steal != null
eq('row 6 subpoena: a bank with a steal', ids(pick([lock(600, 300, 1), bank(601, 300, 900, { steal: { fromId: P2, amount: 100 } })], { card: 'subpoena' })).slice(0, 1), ['call-subpoena-b']);
eq('row 6: a Subpoena bank with no steal (leader) is not a subpoena call', first(pick([lock(602, 300, 1), bank(603, 1600, 1600)], { card: 'subpoena' })).moment, 'bigbank');
eq('row 5 fire beats subpoena-like steal (card fire)', first(pick([bank(604, 1500, 1500, { steal: { fromId: P2, amount: 100 } })], { card: 'fire' })).moment, 'fire');
// 7 sweep (not offroad): sweep start + 300
eq('row 7 sweep: sweep start + 300', brief(first(pick([lock(700, 500, 3), sweep(702)]))), { id: 'call-sweep-a', kind: 'result', offset: 450 + 300 });
eq('row 7 sweep under the offroad card (no bank in the action) is not a sweep call', pick([sweep(703)], { card: 'offroad' }).calls.length, 0);
eq('row 7 sweep beats broken, bust and lock', first(pick([lock(702, 600, 3), sweep(703), bust(704)])).moment, 'sweep');
// 8 broken: broken start + 200 (after the turn's 900)
var brokenAct = [bust(800), turn(801, 'broken'), broken(802), turn(803, 'sweep')];
eq('row 8 broken: broken start + 200 (bust 1500 + turn 900)', brief(first(pick(brokenAct))), { id: 'call-broken-a', kind: 'result', offset: 1500 + 900 + 200 });
eq('row 8 broken beats bust', first(pick(brokenAct)).moment, 'broken');
// 9 bust: bust start + 300
eq('row 9 bust: bust start + 300 (after the roll)', brief(first(pick([roll(900), bust(901), turn(902, 'sweep')]))), { id: 'call-bust-b', kind: 'result', offset: 2800 + 300 });
eq('row 9 bust beats a lock of 500 (id%3==0)', first(pick([lock(903, 500, 3), roll(904), bust(905)])).moment, 'bust');
// 10 lock: points >= 500, only even ids, lock start + 100
eq('row 10 lock: id%3==0 (even), 500 points, at lock start + 100', brief(first(pick([lock(1002, 500, 3), roll(1003)]))), { id: 'call-lock-a', kind: 'result', offset: 100 });
eq('row 10 lock: id%3==0 and id%4==0 -> lock c', ids(pick([lock(1008, 600, 3), roll(1009)])), ['call-lock-c']);
eq('row 10 lock: id%3==0 and odd -> lock b', ids(pick([lock(1005, 600, 3), roll(1006)])), ['call-lock-b']);
eq('row 10 lock: id%3 != 0 -> no lock call', [1000, 1001, 1003, 1004].map(function (id) { return pick([lock(id, 1000, 3), roll(id + 1)]).calls.length; }), [0, 0, 0, 0]);
eq('row 10 lock: 450 points -> no call', pick([lock(1006, 450, 3), roll(1007)]).calls.length, 0);
eq('row 10 lock beats bigbank and place', first(pick([lock(1011, 500, 3), bank(1012, 1500, 3000)])).moment, 'lock');
// 11 bigbank: amount >= 1500, variants a/b only
eq('row 11 bigbank: amount 1500 at bank start + 500', brief(first(pick([lock(1101, 300, 1), bank(1102, 1500, 1500)]))), { id: 'call-bigbank-a', kind: 'result', offset: 950 });
eq('row 11 bigbank: id%4==0 still a (no c)', ids(pick([lock(1103, 300, 1), bank(1104, 1600, 1600)])), ['call-bigbank-a']);
eq('row 11 bigbank: odd id -> b', ids(pick([lock(1103, 300, 1), bank(1105, 1600, 1600)])), ['call-bigbank-b']);
eq('row 11 bigbank beats place', first(pick([bank(1106, 2000, 2000)])).moment, 'bigbank');
eq('row 11: 1450 is not a bigbank', first(pick([lock(1107, 300, 1), bank(1108, 1450, 1450)])).moment, 'place');
// 12 place: the square changes; voice by id%2
eq('row 12 place: 0 -> 1000 of 5000 is square 10, even id -> sr, at bank start + 600', brief(first(pick([lock(1201, 300, 1), bank(1202, 1000, 1000)]))),
   { id: 'pl-sr-10', kind: 'result', offset: 450 + 600 });
eq('row 12 place: odd id -> r273', ids(pick([lock(1201, 300, 1), bank(1203, 1000, 1000)])), ['pl-r273-10']);
eq('row 12 place: the same square before and after -> no call (900 -> 950 of 5000: 9 -> 9)', pick([lock(1205, 50, 1), bank(1206, 50, 950)]).calls.length, 0);
eq('row 12 place: the square is floor(bank / target * 51): 2500 of 5000 -> 25', first(pick([bank(1208, 300, 2500)])).id, 'pl-sr-25');
eq('row 12 place: capped at 51 (a bank past the target with no win event)', first(pick([bank(1210, 1000, 5500)])).id, 'pl-sr-51');
eq('row 12 place: before = after - amount - steal (subpoena steal counted)', first(pick([bank(1212, 100, 1100, { steal: { fromId: P2, amount: 100 } })], { card: 'subpoena' })).moment, 'subpoena');
eq('row 12 place: target 10000, 300 -> 1300: 1 -> 6', first(pick([bank(1214, 1000, 1300)], { target: 10000 })).id, 'pl-sr-06');
eq('row 12 place: square() helper', [R.square(0, 5000), R.square(98, 5000), R.square(99, 5000), R.square(4999, 5000), R.square(5000, 5000), R.square(7000, 5000)], [0, 0, 1, 50, 51, 51]);

// ---- one result call per action ----
var busy = [lock(1300, 1500, 6), sweep(1301), lock(1302, 500, 3), bank(1303, 2000, 2000), turn(1304, 'fire')];
var r1 = pick(busy);
eq('one result call per action (several rows match)', r1.calls.filter(function (c) { return c.kind === 'result'; }).length, 1);
eq('the highest row wins (supersweep over sweep, lock, bigbank)', first(r1).moment, 'supersweep');
eq('no result call when the action has none (a plain roll)', pick([roll(1400)]).calls.length, 0);
eq('no result call for skip, sitout, join', pick([ev(1401, 'skip', { playerId: P1, lost: 0 }), ev(1402, 'sitout', { playerId: P1 }), ev(1403, 'join', { playerId: P1 })]).calls.length, 0);

// ---- the card call ----
eq('card call: turn with fire, even id -> card-fire-a at turn start + 150', brief(pick([turn(1500, 'fire')]).calls[0]), { id: 'card-fire-a', kind: 'card', offset: 150 });
eq('card call: odd id -> b', ids(pick([turn(1501, 'subpoena')])), ['card-subpoena-b']);
eq('card call: each card', ['fire', 'offroad', 'subpoena', 'overdue'].map(function (c) { return ids(pick([turn(1502, c)]))[0]; }),
   ['card-fire-a', 'card-offroad-a', 'card-subpoena-a', 'card-overdue-a']);
eq('card call: broken card -> none (the broken result call instead)', ids(pick([turn(1504, 'broken'), broken(1505)])), ['call-broken-b']);
eq('card call: sweep card only when id%9==0', [1600, 1601, 1602, 1611, 1620, 1629, 1603].map(function (id) { return ids(pick([turn(id, 'sweep')])).join(); }),
   ['', '', 'card-sweep-a', 'card-sweep-b', 'card-sweep-a', 'card-sweep-b', '']);
// every variant can be picked for some id (the gates do not share parity with the variant rule)
var lockIds = {}, sweepIds = {};
for (var n = 1; n <= 200; n++) {
  ids(pick([lock(n, 600, 3)])).forEach(function (id) { lockIds[id] = 1; });
  ids(pick([turn(n, 'sweep')])).forEach(function (id) { sweepIds[id] = 1; });
}
eq('reachable: call-lock-a, -b and -c each play for some id', Object.keys(lockIds).sort(), ['call-lock-a', 'call-lock-b', 'call-lock-c']);
eq('reachable: card-sweep-a and -b each play for some id', Object.keys(sweepIds).sort(), ['card-sweep-a', 'card-sweep-b']);
eq('card call after the result call, at its own time (bust 3100, card at 2800+1500+150)', pick([roll(1700), bust(1701), turn(1702, 'offroad')]).calls.map(brief),
   [{ id: 'call-bust-b', kind: 'result', offset: 3100 }, { id: 'card-offroad-a', kind: 'card', offset: 2800 + 1500 + 150 }]);
eq('a broken chain: the card call is for the turn that is played', ids(pick([bank(1800, 300, 5300 - 4900), turn(1801, 'broken'), broken(1802), turn(1803, 'offroad')])),
   ['call-broken-a', 'card-offroad-b']);   // broken (row 8) beats the place call (row 12)

// ---- the card in force ----
var r2 = pick([lock(1900, 300, 1), bank(1902, 1000, 2000), turn(1903, 'fire')], { card: 'overdue' });
eq('the bank uses the card before the next turn (overdue), not the new card', first(r2).moment, 'overdue');
eq('pickCall returns the card in force after the action', r2.card, 'fire');
eq('no turn in the action: the card stays', pick([roll(1904)], { card: 'subpoena' }).card, 'subpoena');
eq('the card from a turn inside the action applies to a later bank in it', first(pick([turn(1905, 'overdue'), bank(1906, 2200, 2200)], { card: 'sweep' })).moment, 'overdue');

// ---- absent clips, radio off, start time, determinism ----
var hasNone = function () { return false; };
var r3 = pick([roll(2000), bust(2001), turn(2002, 'fire')], { has: hasNone });
eq('absent clips are skipped (no calls)', r3.calls.length, 0);
eq('absent clips are reported', r3.absent, ['call-bust-b', 'card-fire-a']);
eq('an absent result clip does not fall through to a lower row', ids(pick([lock(2004, 500, 3), bank(2006, 300, 1300)], { has: { 'pl-sr-13': 1 } })), []);
eq('a present card clip still plays when the result clip is absent', ids(pick([roll(2000), bust(2001), turn(2002, 'fire')], { has: { 'card-fire-a': 1 } })), ['card-fire-a']);
eq('has as an object map', ids(pick([roll(2000), bust(2001)], { has: { 'call-bust-b': true } })), ['call-bust-b']);
var r4 = pick([roll(2100), bust(2101), turn(2102, 'fire')], { radioOn: false });
eq('radio off yields no calls', r4.calls.length, 0);
eq('radio off still tracks the card', r4.card, 'fire');
eq('ctx.start: at = start + offset', pick([roll(2200), bust(2201)], { start: 1700000000000 }).calls[0].at, 1700000000000 + 3100);
var act = [roll(2300), lock(2301, 500, 3), roll(2302), bust(2303), turn(2304, 'overdue')];
eq('same input gives the same output', JSON.stringify(pick(act, { start: 5 })), JSON.stringify(pick(act, { start: 5 })));
eq('the input events are not changed', JSON.stringify(act), JSON.stringify([roll(2300), lock(2301, 500, 3), roll(2302), bust(2303), turn(2304, 'overdue')]));
eq('empty action', pick([]).calls.length, 0);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
