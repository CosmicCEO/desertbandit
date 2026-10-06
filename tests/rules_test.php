<?php
/**
 * Desert Bandit rules engine and computer player tests. No database, no server.
 *
 *   php tests/rules_test.php                 run everything (about 20 s)
 *   php tests/rules_test.php --write-vectors write tests/vectors/scoring.json (shared with the browser tests)
 *
 * Exits 0 when everything passes. Works on PHP 7.4 and 8.x.
 */
if (PHP_SAPI !== 'cli') {
    exit("CLI only\n");
}
require_once __DIR__ . '/../desertbandit/lib/rules.php';
require_once __DIR__ . '/../desertbandit/lib/bot.php';

$GLOBALS['ok'] = 0;
$GLOBALS['fail'] = 0;

function check($cond, $msg)
{
    if ($cond) {
        $GLOBALS['ok']++;
    } else {
        $GLOBALS['fail']++;
        echo "FAIL: $msg\n";
    }
}

function same($got, $want, $msg)
{
    check($got === $want, $msg . ' (got ' . json_encode($got) . ', want ' . json_encode($want) . ')');
}

function throwsRule(callable $fn, $msg)
{
    try {
        $fn();
    } catch (BanditRuleError $e) {
        $GLOBALS['ok']++;
        return $e->getMessage();
    }
    $GLOBALS['fail']++;
    echo "FAIL: $msg (no BanditRuleError)\n";
    return '';
}

/** A scripted $rand: hands out the given values in order and checks each is inside the asked range. */
function seq(array $vals)
{
    return function ($min, $max) use (&$vals) {
        if (!$vals) {
            throw new Exception('scripted rand ran out');
        }
        $v = array_shift($vals);
        if ($v < $min || $v > $max) {
            throw new Exception("scripted rand value $v outside [$min, $max]");
        }
        return $v;
    };
}

// card deal values (rand 1..100): 1-56 sweep, 57-67 broken, 68-78 fire, 79-89 offroad, 90-96 subpoena, 97-100 overdue
const C_SWEEP = 1;
const C_BROKEN = 60;
const C_FIRE = 70;
const C_OFFROAD = 80;
const C_SUBPOENA = 92;
const C_OVERDUE = 98;

function players($n = 2)
{
    $names = array('Ana', 'Ben', 'Cy', 'Di');
    $out = array();
    for ($i = 0; $i < $n; $i++) {
        $out[] = array('id' => 10 + $i, 'name' => $names[$i]);
    }
    return $out;
}

function newGame($card, $target = 5000, $n = 2, $extraRand = array())
{
    $r = BanditRules::newGameState(players($n), $target, seq(array_merge(array($card), $extraRand)));
    return $r['state'];
}

function types(array $events)
{
    $t = array();
    foreach ($events as $e) {
        $t[] = $e['type'];
    }
    return $t;
}

// ---------------------------------------------------------------- scoring
$cases = array(
    array(array(0), 100), array(array(1), 50), array(array(0, 0), 200), array(array(1, 1), 100), array(array(2), null),
    array(array(2, 2), null), array(array(2, 2, 2), 500), array(array(0, 0, 0), 1000), array(array(0, 0, 0, 0), 2000),
    array(array(0, 0, 0, 0, 0), 3000), array(array(0, 0, 0, 0, 0, 0), 4000), array(array(3, 3, 3, 3), 800),
    array(array(1, 1, 1, 1, 1, 1), 2400), array(array(0, 0, 0, 1), 1050), array(array(0, 0, 0, 2), null),
    array(array(0, 1, 2, 3, 4, 5), 1500), array(array(0, 1, 2, 3, 4), null), array(array(0, 1), 150),
    array(array(5, 5, 5), 200), array(array(4, 4, 4, 4, 4), 900), array(array(), null), array(array(6), null),
    array(array(0, 0, 1, 1, 5), null), array(array(2, 2, 2, 3, 3, 3), 900),
);
foreach ($cases as $c) {
    same(BanditRules::scoreSelection($c[0]), $c[1], 'score ' . json_encode($c[0]));
}
same(BanditRules::scoringReels(array(0, 2, 3, 4, 5, 1), array_fill(0, 6, false)), array_fill(0, 6, true), 'a straight scores on every reel');
same(BanditRules::scoringReels(array(2, 2, 3, 3, 4, 5), array_fill(0, 6, false)), array_fill(0, 6, false), 'no scoring reels');
same(BanditRules::scoringReels(array(2, 2, 2, 3, 4, 5), array_fill(0, 6, false)), array(true, true, true, false, false, false), 'three of a kind scores');
same(BanditRules::scoringReels(array(0, 2, 2, 3, 4, 1), array(false, false, false, false, false, true)), array(true, false, false, false, false, false), 'a locked reel never scores again');
same(BanditRules::bankAmount('sweep', 300, 0), 300, 'plain bank');
same(BanditRules::bankAmount('fire', 950, 0), null, 'fire: under the minimum');
same(BanditRules::bankAmount('fire', 1000, 0), 1500, 'fire: the bonus');
same(BanditRules::bankAmount('overdue', 800, 1), null, 'overdue: needs two sweeps');
same(BanditRules::bankAmount('overdue', 800, 2), 3600, 'overdue pays double plus 2000');
same(BanditRules::bankAmount('offroad', 800, 0), null, 'offroad never banks');
same(BanditRules::bankAmount('sweep', 0, 0), null, 'nothing to bank');
same(BanditRules::cleanTarget('5000'), 5000, 'target 5000');
throwsRule(function () { BanditRules::cleanTarget(2000); }, 'target too low');
throwsRule(function () { BanditRules::cleanTarget(5100); }, 'target not a multiple of 500');

// ---------------------------------------------------------------- the deck
mt_srand(11);
$deal = array();
$N = 200000;
$rand = function ($a, $b) { return mt_rand($a, $b); };
$g = BanditRules::newGameState(players(2), 5000, $rand);
for ($i = 0; $i < $N; $i++) {
    $r = BanditRules::skipTurn($g['state'], $rand);       // every skip deals a fresh card
    $g = $r;
    foreach ($r['events'] as $e) {
        if ($e['type'] === 'turn') {
            $deal[$e['card']] = (isset($deal[$e['card']]) ? $deal[$e['card']] : 0) + 1;
        }
    }
}
$total = array_sum($deal);
foreach (BanditRules::$CARDS as $c) {
    $share = 100.0 * $deal[$c[0]] / $total;
    check(abs($share - $c[1]) < 0.8, sprintf('card %s is dealt %.1f%% of the time (want %d%%)', $c[0], $share, $c[1]));
}

// ---------------------------------------------------------------- scripted turns
// 1. a bust ends the turn and loses nothing banked
$s = newGame(C_SWEEP);
same($s['current'], 0, 'Ana starts');
same($s['card'], 'sweep', 'first card');
$r = BanditRules::roll($s, array(), seq(array(2, 3, 4, 5, 2, 3, C_SWEEP)));
same(types($r['events']), array('roll', 'bust', 'turn'), 'bust events');
same($r['state']['current'], 1, 'Ben is next after a bust');
same($r['state']['turn'], 1, 'turn counter');
same($r['state']['players'][0]['bank'], 0, 'bust banks nothing');
same($r['state']['phase'], 'start', 'next turn starts clean');

// 2. keep one reel and roll on, then bank
$s = newGame(C_SWEEP);
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
same($r['state']['phase'], 'rolled', 'a scoring roll waits for picks');
same($r['events'][0]['scoring'], array(true, false, false, false, false, false), 'scoring flags');
$r2 = BanditRules::roll($r['state'], array(0), seq(array(2, 2, 2, 3, 5)));
same(types($r2['events']), array('lock', 'roll'), 'lock then roll');
same($r2['state']['stake'], 100, 'stake after one sheep');
same($r2['state']['locked'], array(true, false, false, false, false, false), 'locked reel');
same($r2['state']['reels'], array(0, 2, 2, 2, 3, 5), 'kept reel stays, others rerolled');
$r3 = BanditRules::bank($r2['state'], array(1, 2, 3), seq(array(C_SWEEP)));
same($r3['state']['players'][0]['bank'], 600, 'three 17 Palms plus a sheep banked');
same(types($r3['events']), array('lock', 'bank', 'turn'), 'bank events');
same($r3['state']['current'], 1, 'turn passes');

// 3. sweep bonus, then bank; the win ends the game
$s = newGame(C_SWEEP, 2500);
$r = BanditRules::roll($s, array(), seq(array(0, 0, 0, 0, 0, 0)));
$r2 = BanditRules::bank($r['state'], array(0, 1, 2, 3, 4, 5), seq(array(1)));        // medium olla: $400
same(types($r2['events']), array('lock', 'sweep', 'bank', 'win'), 'sweep bank win events');
same($r2['events'][1]['bonus'], 400, 'sweep bonus');
same($r2['state']['players'][0]['bank'], 4400, 'six sheep ($4,000) plus a $400 bonus');
same($r2['state']['status'], 'finished', 'game over');
same($r2['state']['winner'], 10, 'winner');
throwsRule(function () use ($r2) { BanditRules::roll($r2['state'], array(), seq(array(0, 0, 0, 0, 0, 0))); }, 'no play after the win');

// 4. a sweep and roll on: fresh six, bonus only on the first sweep
$s = newGame(C_SWEEP, 15000);
$r = BanditRules::roll($s, array(), seq(array(0, 0, 0, 0, 0, 0)));
$r2 = BanditRules::roll($r['state'], array(0, 1, 2, 3, 4, 5), seq(array(2, 4, 4, 4, 4, 4, 4)));     // bonus index 2 = $500, then six new reels
same($r2['state']['stake'], 4500, 'stake after the first sweep');
same($r2['state']['sweeps'], 1, 'one sweep');
same($r2['state']['locked'], array_fill(0, 6, false), 'fresh six');
same(types($r2['events']), array('lock', 'sweep', 'roll'), 'sweep then roll events');
$r3 = BanditRules::roll($r2['state'], array(0, 1, 2, 3, 4, 5), seq(array(4, 4, 4, 4, 4, 4)));       // six chuckwallas: $300 x 4 = $1,200
same($r3['state']['stake'], 4500 + 1200, 'no second bonus');

// 5. Ground Fire Report
$s = newGame(C_FIRE);
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
$msg = throwsRule(function () use ($r) { BanditRules::bank($r['state'], array(0), seq(array(1))); }, 'fire: cannot bank under $1,000');
check(strpos($msg, '$1,000') !== false, 'fire message');
$r = BanditRules::roll($s, array(), seq(array(0, 0, 0, 2, 3, 4)));
$r2 = BanditRules::bank($r['state'], array(0, 1, 2), seq(array(C_SWEEP)));
same($r2['state']['players'][0]['bank'], 1500, 'fire pays $500 extra');

// 6. Off-Road Bust
$s = newGame(C_OFFROAD, 15000);
$r = BanditRules::roll($s, array(), seq(array(0, 0, 0, 2, 3, 4)));
throwsRule(function () use ($r) { BanditRules::bank($r['state'], array(0, 1, 2), seq(array(1))); }, 'offroad: no banking');
$r = BanditRules::roll($s, array(), seq(array(0, 0, 0, 0, 0, 0)));
$r2 = BanditRules::roll($r['state'], array(0, 1, 2, 3, 4, 5), seq(array(C_SWEEP)));
same(types($r2['events']), array('lock', 'sweep', 'bank', 'turn'), 'offroad sweep pays out and ends the turn');
same($r2['state']['players'][0]['bank'], 8300, 'offroad pays twice the stake plus $300');
same($r2['events'][2]['via'], 'offroad', 'offroad via');
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
$r2 = BanditRules::roll($r['state'], array(0), seq(array(2, 3, 4, 2, 3, C_SWEEP)));
same(types($r2['events']), array('lock', 'roll', 'bust', 'turn'), 'offroad bust');
same($r2['state']['players'][0]['bank'], 0, 'offroad bust pays nothing');

// 7. Subpoena: take $100 from the leader, nothing if you lead
$s = newGame(C_SUBPOENA);
$s['players'][1]['bank'] = 500;
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
$r2 = BanditRules::bank($r['state'], array(0), seq(array(C_SWEEP)));
same($r2['state']['players'][0]['bank'], 200, 'subpoena: stake plus $100');
same($r2['state']['players'][1]['bank'], 400, 'subpoena: the leader pays $100');
same($r2['events'][1]['steal'], array('fromId' => 11, 'amount' => 100), 'steal event');
$s['players'][0]['bank'] = 900;
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
$r2 = BanditRules::bank($r['state'], array(0), seq(array(C_SWEEP)));
same($r2['state']['players'][0]['bank'], 1000, 'subpoena: the leader steals nothing');
same($r2['state']['players'][1]['bank'], 500, 'subpoena: the others keep theirs');
$s['players'][1]['bank'] = 50;
$s['players'][0]['bank'] = 0;
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
$r2 = BanditRules::bank($r['state'], array(0), seq(array(C_SWEEP)));
same($r2['state']['players'][1]['bank'], 0, 'subpoena never takes more than the leader has');
same($r2['state']['players'][0]['bank'], 150, 'subpoena: only what was there');

// 8. Reports Overdue
$s = newGame(C_OVERDUE, 15000);
$r = BanditRules::roll($s, array(), seq(array(0, 0, 0, 2, 3, 4)));
throwsRule(function () use ($r) { BanditRules::bank($r['state'], array(0, 1, 2), seq(array(1))); }, 'overdue: no bank before two sweeps');
$r = BanditRules::roll($s, array(), seq(array(0, 0, 0, 0, 0, 0)));
$r2 = BanditRules::roll($r['state'], array(0, 1, 2, 3, 4, 5), seq(array(0, 0, 0, 0, 0, 0)));
same($r2['state']['sweeps'], 1, 'overdue: first sweep');
same($r2['state']['stake'], 4000, 'overdue: no sweep bonus');
$r3 = BanditRules::bank($r2['state'], array(0, 1, 2, 3, 4, 5), seq(array(C_SWEEP)));
same($r3['state']['players'][0]['bank'], 8000 * 2 + 2000, 'overdue pays double plus $2,000 after two sweeps');
same($r3['state']['status'], 'finished', 'overdue bank reaches the total');
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
$r2 = BanditRules::roll($r['state'], array(0), seq(array(2, 2, 3, 3, 4, C_SWEEP)));
same(types($r2['events']), array('lock', 'roll', 'bust', 'turn'), 'overdue bust');

// 9. a broken-down vehicle skips the turn
$g = BanditRules::newGameState(players(3), 5000, seq(array(C_BROKEN, C_BROKEN, C_FIRE)));
same(types($g['events']), array('turn', 'broken', 'turn', 'broken', 'turn'), 'two skipped turns in a row');
same($g['state']['current'], 2, 'Cy gets the first playable card');
same($g['state']['card'], 'fire', 'her card');

// 10. host skip and sit out
$s = newGame(C_SWEEP, 5000, 3);
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
$r2 = BanditRules::skipTurn($r['state'], seq(array(C_SWEEP)));
same(types($r2['events']), array('skip', 'turn'), 'skip events');
same($r2['events'][0]['lost'], 0, 'skip');
same($r2['state']['current'], 1, 'skip passes the turn');
same($r2['state']['turn'], 2, 'skip counts as an action');
$r3 = BanditRules::sitOut($r2['state'], 11, true, seq(array(C_SWEEP)));
same($r3['state']['current'], 2, 'sitting out the player on turn passes the turn');
same($r3['state']['players'][1]['out'], true, 'out flag');
$r4 = BanditRules::skipTurn($r3['state'], seq(array(C_SWEEP)));
same($r4['state']['current'], 0, 'an away player is passed over');
$r5 = BanditRules::sitOut($r4['state'], 11, false, seq(array()));
same($r5['state']['players'][1]['out'], false, 'back in');
$r6 = BanditRules::sitOut($r5['state'], 11, false, seq(array()));
same($r6['events'], array(), 'sitting back in twice is harmless');
$r7 = BanditRules::sitOut($r5['state'], 12, true, seq(array()));
throwsRule(function () use ($r7) { BanditRules::sitOut($r7['state'], 10, true, seq(array(C_SWEEP))); $x = BanditRules::sitOut($r7['state'], 11, true, seq(array(C_SWEEP))); BanditRules::sitOut($x['state'], 10, true, seq(array(C_SWEEP))); }, 'someone has to stay in');
throwsRule(function () use ($s) { BanditRules::sitOut($s, 99, true, seq(array())); }, 'unknown player');

// 11. refused picks
$s = newGame(C_SWEEP);
throwsRule(function () use ($s) { BanditRules::roll($s, array(0), seq(array(0, 0, 0, 0, 0, 0))); }, 'no picks before the first roll');
throwsRule(function () use ($s) { BanditRules::bank($s, array(), seq(array())); }, 'cannot bank before rolling');
$r = BanditRules::roll($s, array(), seq(array(0, 2, 3, 4, 2, 5)));
throwsRule(function () use ($r) { BanditRules::roll($r['state'], array(), seq(array(0, 0, 0, 0, 0))); }, 'picks needed after a roll');
throwsRule(function () use ($r) { BanditRules::roll($r['state'], array(1), seq(array(0, 0, 0, 0, 0))); }, 'a reel that does not score');
throwsRule(function () use ($r) { BanditRules::roll($r['state'], array(0, 0), seq(array(0, 0, 0, 0, 0))); }, 'the same reel twice');
throwsRule(function () use ($r) { BanditRules::roll($r['state'], array(9), seq(array(0, 0, 0, 0, 0))); }, 'a reel that is not there');
throwsRule(function () use ($r) { BanditRules::roll($r['state'], array('0'), seq(array(0, 0, 0, 0, 0))); }, 'picks must be integers');
$r2 = BanditRules::roll($r['state'], array(0), seq(array(0, 0, 0, 3, 5)));
throwsRule(function () use ($r2) { BanditRules::roll($r2['state'], array(0), seq(array(0, 0, 0, 0, 0))); }, 'a kept reel cannot be kept again');
same(BanditRules::roll($r['state'], array(0), seq(array(2, 2, 3, 3, 4, C_SWEEP)))['state']['turn'], 2, 'turn counter after two actions');
// a refused action changes nothing
$before = json_encode($r['state']);
try { BanditRules::roll($r['state'], array(1), seq(array(0, 0, 0, 0, 0))); } catch (BanditRuleError $e) { }
same(json_encode($r['state']), $before, 'a refused action leaves the state alone');

// ---------------------------------------------------------------- the computer player
$bot = new BanditBot(__DIR__ . '/../desertbandit/lib/policy.json');
same($bot->decide(newGame(C_SWEEP)), array('kind' => 'roll', 'picks' => array()), 'bot rolls first');
// three sheep at the start of a turn: keep them and bank? (a sweep card with $1,000 stake rolls on: the policy decides, but it must keep the triple)
$s = newGame(C_SWEEP);
$r = BanditRules::roll($s, array(), seq(array(0, 0, 0, 2, 3, 4)));
$m = $bot->decide($r['state']);
same($m['picks'], array(0, 1, 2), 'bot keeps the three sheep');
$r = BanditRules::roll($s, array(), seq(array(2, 2, 3, 3, 4, 0)));
same($bot->decide($r['state'])['picks'], array(5), 'bot keeps the lone sheep');
// every move the bot makes is legal and worth what the engine says
$illegal = 0;
mt_srand(5);
for ($game = 0; $game < 400; $game++) {
    $card = array(C_SWEEP, C_FIRE, C_OFFROAD, C_SUBPOENA, C_OVERDUE)[$game % 5];
    $st = BanditRules::newGameState(players(2), 15000, function ($a, $b) use (&$card) { static $first = true; if ($first) { $first = false; return $card; } return mt_rand($a, $b); })['state'];
    for ($step = 0; $step < 200 && $st['status'] === 'active'; $step++) {
        $m = $bot->decide($st);
        try {
            $out = $m['kind'] === 'roll' ? BanditRules::roll($st, $m['picks'], 'mt_rand') : BanditRules::bank($st, $m['picks'], 'mt_rand');
        } catch (BanditRuleError $e) {
            $illegal++;
            echo 'illegal bot move: ' . json_encode($m) . ' ' . $e->getMessage() . ' ' . json_encode($st) . "\n";
            break;
        }
        $st = $out['state'];
    }
}
same($illegal, 0, 'the bot never makes an illegal move');

// the bot earns what the solver says it should, card by card
$tol = array('sweep' => 0.04, 'fire' => 0.04, 'offroad' => 0.06, 'subpoena' => 0.04, 'overdue' => 0.10);
foreach (array('sweep', 'fire', 'offroad', 'subpoena', 'overdue') as $kind) {
    $turns = $kind === 'overdue' ? 40000 : 15000;
    $sum = 0;
    for ($t = 0; $t < $turns; $t++) {
        $st = newGame(C_SWEEP, 15000, 2);
        $st['card'] = $kind;
        $st['players'][1]['bank'] = 3000;                 // the opponent leads, so a Subpoena steals
        $gain = 0;
        for ($step = 0; $step < 300; $step++) {
            $m = $bot->decide($st);
            $before = $st['players'][0]['bank'];
            $out = $m['kind'] === 'roll' ? BanditRules::roll($st, $m['picks'], 'mt_rand') : BanditRules::bank($st, $m['picks'], 'mt_rand');
            $st = $out['state'];
            $ended = $st['status'] === 'finished';
            foreach ($out['events'] as $e) {
                if ($e['type'] === 'turn') {
                    $ended = true;
                }
            }
            if ($ended) {
                $gain = $st['players'][0]['bank'] - $before;
                break;
            }
        }
        $sum += $gain;
    }
    $mean = $sum / $turns;
    $ev = $bot->expectedTurn($kind);
    check(abs($mean - $ev) / $ev < $tol[$kind], sprintf('bot on %s averages $%.0f, solver says $%.0f', $kind, $mean, $ev));
    printf("  bot %-9s mean \$%4.0f vs solver \$%4.0f\n", $kind, $mean, $ev);
}

// ---------------------------------------------------------------- fuzz: random games to the finish
function randomMove(array $st, BanditBot $bot, $dice)
{
    if ($st['phase'] === 'start') {
        return array('roll', array());
    }
    if ($dice % 3 === 0) {
        $m = $bot->decide($st);
        return array($m['kind'], $m['picks']);
    }
    // a random legal pick: shuffle the scoring reels and keep a random scoring subset
    $score = BanditRules::scoringReels($st['reels'], $st['locked']);
    $idx = array();
    foreach ($score as $i => $v) {
        if ($v) {
            $idx[] = $i;
        }
    }
    shuffle($idx);
    for ($k = count($idx); $k >= 1; $k--) {
        $try = array_slice($idx, 0, $k);
        if (BanditRules::scoreSelection(array_map(function ($i) use ($st) { return $st['reels'][$i]; }, $try)) !== null) {
            return array($dice % 2 ? 'roll' : 'bank', $try);
        }
    }
    $m = $bot->decide($st);
    return array($m['kind'], $m['picks']);
}

mt_srand(99);
$games = 1500;
$finished = 0;
$actionsTotal = 0;
for ($g = 0; $g < $games; $g++) {
    $n = 2 + ($g % 3);
    $target = array(2500, 5000, 7500)[$g % 3];
    $st = BanditRules::newGameState(players($n), $target, 'mt_rand')['state'];
    $actions = 0;
    while ($st['status'] === 'active' && $actions < 6000) {
        $actions++;
        list($kind, $picks) = randomMove($st, $bot, mt_rand(0, 5));
        $before = $st;
        try {
            if ($kind === 'bank') {
                $out = BanditRules::bank($st, $picks, 'mt_rand');
            } else {
                $out = BanditRules::roll($st, $picks, 'mt_rand');
            }
        } catch (BanditRuleError $e) {
            $out = BanditRules::roll($st, $st['phase'] === 'start' ? array() : $bot->decide($st)['picks'], 'mt_rand');   // a random bank the card refused: roll on
        }
        $st = $out['state'];
        if ($st['turn'] !== $before['turn'] + 1) {
            check(false, 'fuzz: turn counter jumped');
            break;
        }
        if ($st['stake'] < 0 || $st['current'] < 0 || $st['current'] >= $n) {
            check(false, 'fuzz: bad stake or current');
            break;
        }
        foreach ($st['players'] as $p) {
            if ($p['bank'] < 0) {
                check(false, 'fuzz: negative bank');
                break 2;
            }
        }
        if ($st['status'] === 'active' && $st['phase'] === 'start' && ($st['reels'] !== null || $st['stake'] !== 0)) {
            check(false, 'fuzz: dirty start of turn');
            break;
        }
        if ($st['status'] === 'active' && $st['phase'] === 'rolled') {
            $sc = BanditRules::scoringReels($st['reels'], $st['locked']);
            if (!in_array(true, $sc, true)) {
                check(false, 'fuzz: waiting on a roll with nothing to keep');
                break;
            }
        }
    }
    if ($st['status'] === 'finished') {
        $finished++;
        $top = 0;
        $winner = null;
        foreach ($st['players'] as $p) {
            if ($p['bank'] >= $st['target']) {
                $top++;
            }
            if ($p['id'] === $st['winner']) {
                $winner = $p;
            }
        }
        check($winner !== null && $winner['bank'] >= $st['target'] && $top >= 1, 'fuzz: the winner reached the total');
    }
    $actionsTotal += $actions;
}
same($finished, $games, 'every fuzz game reaches a winner');
printf("  fuzz: %d games finished, %.0f actions per game\n", $finished, $actionsTotal / $games);

// host controls under fuzz: skip and sit out at random never leave the game stuck
mt_srand(7);
for ($g = 0; $g < 600; $g++) {
    $st = BanditRules::newGameState(players(4), 2500, 'mt_rand')['state'];
    for ($a = 0; $a < 2000 && $st['status'] === 'active'; $a++) {
        $dice = mt_rand(0, 9);
        if ($dice === 0) {
            $st = BanditRules::skipTurn($st, 'mt_rand')['state'];
        } elseif ($dice === 1) {
            $pid = 10 + mt_rand(0, 3);
            try {
                $st = BanditRules::sitOut($st, $pid, (bool)mt_rand(0, 1), 'mt_rand')['state'];
            } catch (BanditRuleError $e) {
            }
        } else {
            list($kind, $picks) = randomMove($st, $bot, mt_rand(0, 5));
            try {
                $st = ($kind === 'bank' ? BanditRules::bank($st, $picks, 'mt_rand') : BanditRules::roll($st, $picks, 'mt_rand'))['state'];
            } catch (BanditRuleError $e) {
                $st = BanditRules::roll($st, $st['phase'] === 'start' ? array() : $bot->decide($st)['picks'], 'mt_rand')['state'];
            }
        }
        $active = 0;
        foreach ($st['players'] as $i => $p) {
            if (!$p['out']) {
                $active++;
            }
        }
        if ($st['status'] === 'active' && ($active < 1 || $st['players'][$st['current']]['out'])) {
            check(false, 'host fuzz: an away player is on turn');
            break;
        }
    }
    check($st['status'] === 'finished' || $a >= 2000, 'host fuzz game ended or ran long');
}

// ---------------------------------------------------------------- vectors for the browser
if (in_array('--write-vectors', $argv)) {
    mt_srand(2026);
    $vec = array('scoring' => array(), 'scoringReels' => array());
    for ($i = 0; $i < 400; $i++) {
        $n = mt_rand(1, 6);
        $sym = array();
        for ($j = 0; $j < $n; $j++) {
            $sym[] = mt_rand(0, 5);
        }
        $vec['scoring'][] = array('symbols' => $sym, 'points' => BanditRules::scoreSelection($sym));
    }
    $vec['scoring'][] = array('symbols' => array(5, 3, 2, 4, 1, 0), 'points' => 1500);
    for ($i = 0; $i < 300; $i++) {
        $reels = array();
        $locked = array();
        for ($j = 0; $j < 6; $j++) {
            $reels[] = mt_rand(0, 5);
            $locked[] = mt_rand(0, 4) === 0;
        }
        $vec['scoringReels'][] = array('reels' => $reels, 'locked' => $locked, 'scoring' => BanditRules::scoringReels($reels, $locked));
    }
    $vec['bank'] = array();
    foreach (array('sweep', 'broken', 'fire', 'offroad', 'subpoena', 'overdue') as $card) {
        foreach (array(0, 50, 100, 950, 1000, 2300) as $stake) {
            foreach (array(0, 1, 2) as $sweeps) {
                $vec['bank'][] = array('card' => $card, 'stake' => $stake, 'sweeps' => $sweeps, 'amount' => BanditRules::bankAmount($card, $stake, $sweeps));
            }
        }
    }
    @mkdir(__DIR__ . '/vectors');
    file_put_contents(__DIR__ . '/vectors/scoring.json', json_encode($vec) . "\n");
    echo "wrote tests/vectors/scoring.json\n";
}

echo "\n" . $GLOBALS['ok'] . ' checks passed, ' . $GLOBALS['fail'] . " failed\n";
echo $GLOBALS['fail'] === 0 ? "ALL PASSED\n" : "SOME FAILED\n";
exit($GLOBALS['fail'] === 0 ? 0 : 1);
