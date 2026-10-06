<?php
/**
 * End-to-end test over HTTP: lobby rules, host controls, token checks, double taps, and full games played to a winner through the
 * real API (humans driven by a simple strategy, computer seats through botstep). No browser.
 *
 *   php tests/http_game.php http://127.0.0.1:8899 [N] [--no-race]
 *
 * N = players in the headline game (2 to 4, default 4). The matrix of 2, 3 and 4 player games, and games with computer seats, always runs.
 * --no-race skips the truly parallel tests (they need a server that handles requests at once: `PHP_CLI_SERVER_WORKERS=4 php -S ...` on
 * PHP 8.3, or Apache). The parallel tests use curl processes. Exit code 0 = all good ("ALL PASSED"), 1 = something failed.
 * It creates test rooms in the database, like the Desert Ranger tests do.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../desertbandit/lib/rules.php';   // pure engine: used only to choose sensible moves for the test humans

$BASE = 'http://127.0.0.1:8899';
$N = 4;
$RACE = true;
$posn = 0;
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--no-race') { $RACE = false; continue; }
    if ($posn === 0) { $BASE = rtrim($a, '/'); }
    if ($posn === 1) { $N = max(2, min(4, (int)$a)); }
    $posn++;
}
$fails = 0;
$passes = 0;

function req($method, $action, $body = null, $token = null, $query = '', $extraHeaders = '')
{
    global $BASE;
    $headers = "Accept: application/json\r\n" . $extraHeaders;
    if ($token) $headers .= "X-Player-Token: $token\r\n";
    $opts = array('http' => array('method' => $method, 'ignore_errors' => true, 'header' => $headers, 'timeout' => 20));
    if ($body !== null) {
        $opts['http']['header'] .= "Content-Type: application/json\r\n";
        $opts['http']['content'] = is_string($body) ? $body : json_encode($body);
    }
    $raw = file_get_contents("$BASE/api.php?a=$action$query", false, stream_context_create($opts));
    $status = 0;
    $hdrs = isset($http_response_header) ? $http_response_header : array();
    if (isset($hdrs[0]) && preg_match('/\s(\d{3})\s/', $hdrs[0], $m)) $status = (int)$m[1];
    $j = json_decode($raw, true);
    if (!is_array($j)) $j = array('ok' => false, 'error' => 'non-JSON: ' . substr((string)$raw, 0, 200));
    $j['_status'] = $status;
    $j['_headers'] = $hdrs;
    return $j;
}
function check($cond, $label) { global $fails, $passes; echo ($cond ? '  ok   ' : '  FAIL ') . $label . "\n"; if ($cond) $passes++; else $fails++; }
function state($code, $token = null, $since = 0) { return req('GET', 'state', null, $token, "&code=$code&since=$since"); }
function key_() { return bin2hex(random_bytes(8)); }
function post($action, $body, $token = null) { return req('POST', $action, $body, $token); }
function refused($r, $status) { return !$r['ok'] && $r['_status'] === $status; }

$NAMES = array('Marigold', 'Jeff', 'Jerod', 'Rosa');
$VEHICLES = array('bronco-orange', 'scout-butter', 'jeep-red', 'ranger-green', 'buggy-blue', 'rail-purple', 'cruiser-teal', 'blazer-twotone');

/** New room with $humans humans (the host first) and $bots computer seats. Returns array(code, tokens by player id (list in seat order), host token, ids). */
function make_room($humans, $bots, $target = null)
{
    global $NAMES, $VEHICLES;
    $c = post('create', array('name' => $NAMES[0], 'vehicle' => $VEHICLES[0]));
    $code = $c['code'];
    $tokens = array($c['token']);
    for ($i = 1; $i < $humans; $i++) {
        $j = post('join', array('code' => $code, 'name' => $NAMES[$i], 'vehicle' => $VEHICLES[$i]));
        $tokens[] = $j['token'];
    }
    for ($i = 0; $i < $bots; $i++) post('addbot', array('code' => $code), $tokens[0]);
    if ($target !== null) post('setup', array('code' => $code, 'target' => $target), $tokens[0]);
    $byId = array();
    foreach ($tokens as $t) { $byId[state($code, $t)['meId']] = $t; }
    return array($code, $tokens, $byId);
}

/** A sensible human move for the state: array(action, extra body). Always a legal move. */
function human_move($st, $threshold)
{
    $g = $st['game'];
    if ($g['phase'] === 'start') return array('roll', array());
    $picks = array(); $symbols = array(); $free = 0;
    foreach ($g['reels'] as $i => $s) {
        if (!$g['locked'][$i]) $free++;
        if ($g['scoring'][$i]) { $picks[] = $i; $symbols[] = $s; }
    }
    $pts = BanditRules::scoreSelection($symbols);
    $new = $g['stake'] + $pts;
    if ($g['card']['key'] === 'offroad' || count($picks) === $free) return array('roll', array('picks' => $picks));
    $amount = BanditRules::bankAmount($g['card']['key'], $new, $g['sweeps']);
    if ($amount !== null && $new >= $threshold) return array('bank', array('picks' => $picks));
    return array('roll', array('picks' => $picks));
}

/** Fire $n curl processes at once; returns their decoded JSON answers. */
function parallel($n, $action, array $bodies, $token)
{
    global $BASE;
    $procs = array();
    for ($k = 0; $k < $n; $k++) {
        $body = escapeshellarg(json_encode($bodies[$k]));
        $tok = $token[$k];
        $hdr = $tok ? "-H " . escapeshellarg("X-Player-Token: $tok") : '';
        $cmd = "curl -s -m 20 -H 'Content-Type: application/json' $hdr -d $body " . escapeshellarg("$BASE/api.php?a=$action");
        $procs[] = popen($cmd, 'r');
    }
    $out = array();
    foreach ($procs as $p) { $out[] = json_decode(stream_get_contents($p), true); pclose($p); }
    return $out;
}

// ===========================================================================
echo "Basics against $BASE\n";
$t = req('GET', 'time');
check($t['ok'] && is_int($t['t']) && abs($t['t'] - (int)round(microtime(true) * 1000)) < 5000 && !isset($t['serverNow']), 'a=time answers {ok, t} (no serverNow)');
$i = req('GET', 'info');
check($i['ok'] && count($i['vehicles']) === 8 && $i['targets'][0] === 2500 && end($i['targets']) === 15000 && count($i['targets']) === 26
    && $i['minPlayers'] === 2 && $i['maxPlayers'] === 4 && isset($i['serverNow']), 'info: 8 vehicles, targets 2500..15000, 2 to 4 players, serverNow');
$s = req('GET', 'stats');
check($s['ok'] && is_int($s['games']), 'stats: {games}');
check(refused(req('GET', 'nonsense'), 404), 'unknown action: 404');
check(refused(req('GET', 'state', null, null, '&code=ZZZZ'), 404), 'unknown room: 404');
check(refused(req('GET', 'create'), 405), 'GET on create: 405');
$r = req('POST', 'create', 'name=x&vehicle=jeep-red');
check(refused($r, 415) || refused($r, 400), 'POST without a JSON body: refused (415/400)');
$ctx = stream_context_create(array('http' => array('method' => 'POST', 'ignore_errors' => true, 'header' => "Content-Type: application/x-www-form-urlencoded\r\n", 'content' => 'name=x')));
$raw = file_get_contents("$BASE/api.php?a=create", false, $ctx);
check(strpos($http_response_header[0], '415') !== false, 'a form POST (content-type not JSON): 415');
check(refused(post('create', array('name' => '   ', 'vehicle' => $VEHICLES[0])), 400), 'create: empty name 400');
check(refused(post('create', array('name' => 'X', 'vehicle' => 'tank')), 400), 'create: unknown vehicle 400');
check(refused(post('create', '{bad json'), 400), 'create: broken JSON 400');

// ===========================================================================
echo "\nLobby ($N players)\n";
$c = post('create', array('name' => $NAMES[0], 'vehicle' => $VEHICLES[0]));
check($c['ok'] && preg_match('/^[A-HJ-NP-Z]{4}$/', $c['code']) && strlen($c['token']) >= 32, 'create: 4-letter room code (no I or O) and a token ' . (isset($c['code']) ? $c['code'] : '?'));
$code = $c['code'];
$hostTok = $c['token'];
$setCookie = '';
foreach ($c['_headers'] as $h) if (stripos($h, 'Set-Cookie:') === 0) $setCookie = $h;
check(strpos($setCookie, 'bandit_' . $code . '=') !== false && stripos($setCookie, 'HttpOnly') !== false && stripos($setCookie, 'SameSite=Lax') !== false, 'create sets the bandit_<CODE> cookie (HttpOnly, SameSite=Lax)');
$st = state($code, $hostTok);
check($st['ok'] && $st['meId'] > 0 && $st['game']['status'] === 'lobby' && $st['game']['target'] === 5000 && $st['game']['hostId'] === $st['meId'] && $st['game']['card'] === null
    && $st['game']['currentId'] === null && isset($st['serverNow']), 'state: lobby, host is me, target 5000, no card');
check(count($st['players']) === 1 && $st['players'][0]['seat'] === 0 && $st['players'][0]['bank'] === 0 && $st['players'][0]['bot'] === false && $st['players'][0]['out'] === false, 'one player at seat 0');
$st2 = req('GET', 'state', null, null, "&code=$code", "Cookie: bandit_$code=$hostTok\r\n");
check($st2['meId'] === $st['meId'], 'the cookie fallback identifies the seat when there is no header');
$st3 = state($code);
check($st3['meId'] === null, 'a spectator (no token) sees meId null');
$pk = req('GET', 'peek', null, null, "&code=" . strtolower($code));
check($pk['ok'] && $pk['code'] === $code && $pk['status'] === 'lobby' && $pk['taken'] === array($VEHICLES[0]) && $pk['players'] === 1, 'peek (lower-case code): status, taken vehicles, players');
check(refused(post('join', array('code' => $code, 'name' => 'Dupe', 'vehicle' => $VEHICLES[0])), 409), 'join: vehicle taken 409');
check(refused(post('join', array('code' => 'ZZZZ', 'name' => 'Lost', 'vehicle' => $VEHICLES[1])), 404), 'join: unknown room 404');
check(refused(post('join', array('code' => $code, 'name' => '', 'vehicle' => $VEHICLES[1])), 400), 'join: empty name 400');
$tokens = array($hostTok);
for ($k = 1; $k < $N; $k++) {
    $j = post('join', array('code' => strtolower($code), 'name' => $NAMES[$k], 'vehicle' => $VEHICLES[$k]));
    check($j['ok'] && $j['code'] === $code, "join {$NAMES[$k]} ({$VEHICLES[$k]})");
    $tokens[] = $j['token'];
}
$st = state($code, $hostTok);
$ids = array(); $byId = array();
foreach ($st['players'] as $k => $p) { $ids[] = $p['id']; $byId[$p['id']] = $tokens[$k]; }
check(count($ids) === $N && array_column($st['players'], 'seat') === range(0, $N - 1), "seats 0..$N in join order");
check(refused(post('setup', array('code' => $code, 'target' => 3000), $tokens[$N - 1]), 403), 'setup: a guest cannot (403)');
check(refused(post('setup', array('code' => $code, 'target' => 3000)), 403), 'setup: no token 403');
check(refused(post('setup', array('code' => $code, 'target' => 2600), $hostTok), 400), 'setup: 2,600 is not a step of 500 (400)');
check(refused(post('setup', array('code' => $code, 'target' => 20000), $hostTok), 400), 'setup: 20,000 is too high (400)');
check(refused(post('setup', array('code' => $code, 'target' => 2000), $hostTok), 400), 'setup: 2,000 is too low (400)');
check(post('setup', array('code' => $code, 'target' => 3000), $hostTok)['ok'] && state($code)['game']['target'] === 3000, 'setup: host sets 3,000');
check(refused(post('addbot', array('code' => $code), $tokens[$N - 1]), 403), 'addbot: a guest cannot (403)');
check(refused(post('start', array('code' => $code), $tokens[$N - 1]), 403), 'start: a guest cannot (403)');
check(refused(post('start', array('code' => $code)), 403), 'start: no token 403');
check(refused(post('start', array('code' => $code), 'f' . str_repeat('0', 47)), 403), 'start: a made-up token 403');
// the room fills: add computers up to 4
$room = $N;
while ($room < 4) {
    $a = post('addbot', array('code' => $code), $hostTok);
    check($a['ok'], 'addbot: a computer takes seat ' . $room);
    $room++;
}
$st = state($code, $hostTok);
$bots = array_values(array_filter($st['players'], function ($p) { return $p['bot']; }));
check(count($st['players']) === 4 && (4 - $N === count($bots)), 'four seats, ' . (4 - $N) . ' of them computers');
if ($bots) check(strpos($bots[0]['name'], 'Rival') === 0 && $bots[0]['vehicle'] !== '' && $bots[0]['bank'] === 0, 'a computer seat is called Rival n and has a vehicle');
check(refused(post('addbot', array('code' => $code), $hostTok), 409), 'addbot: full room 409');
check(refused(post('join', array('code' => $code, 'name' => 'Late', 'vehicle' => $VEHICLES[7])), 409), 'join: full room 409');
// remove: guests and strangers refused, host protected, a middle seat removed, seats renumbered, free seat reused
$mid = $st['players'][1];
check(refused(post('remove', array('code' => $code, 'playerId' => $mid['id']), $tokens[$N > 2 ? 2 : 1]), 403), 'remove: a guest cannot (403)');
check(refused(post('remove', array('code' => $code, 'playerId' => $mid['id'])), 403), 'remove: no token 403');
check(refused(post('remove', array('code' => $code, 'playerId' => $st['players'][0]['id']), $hostTok), 409), 'remove: the host cannot be removed (409)');
check(post('remove', array('code' => $code, 'playerId' => $mid['id']), $hostTok)['ok'], 'remove: the host removes the player at seat 1');
$st = state($code, $hostTok);
check(count($st['players']) === 3 && array_column($st['players'], 'seat') === array(0, 1, 2), 'seats renumbered 0..2, no gap');
check(post('remove', array('code' => $code, 'playerId' => $mid['id']), $hostTok)['ok'] && post('remove', array('code' => $code, 'playerId' => 999999), $hostTok)['ok'], 'removing someone already gone, or unknown, is harmless');
$lv = array_values(array_filter($st['events'], function ($e) { return $e['type'] === 'leave'; }));
check(count($lv) === 1 && strpos($lv[0]['msg'], 'removed') !== false, 'a leave event is logged');
if ($N > 1) check(state($code, $tokens[1])['meId'] === null, "the removed human's token has no seat any more");
$j = post('join', array('code' => $code, 'name' => 'Fresh', 'vehicle' => $mid['vehicle']));
check($j['ok'], 'the freed vehicle can be picked again; the next join takes the first free seat (no clash)');
$st = state($code, $hostTok);
check(array_column($st['players'], 'seat') === array(0, 1, 2, 3), 'four seats again, 0..3 all different');
// rebuild the room into exactly $N humans + computers: simplest is a fresh room for the games below
check(refused(post('start', array('code' => 'ZZZZ'), $hostTok), 404), 'start: unknown room 404');
$solo = post('create', array('name' => 'Solo', 'vehicle' => $VEHICLES[2]));
check(refused(post('start', array('code' => $solo['code']), $solo['token']), 409), 'start: one player on their own is refused (409)');

// ===========================================================================
echo "\nHeadline game: $N humans, token checks, double taps, rule refusals\n";
list($code, $tokens, $byId) = make_room($N, 0, 5000);
$ids = array_keys($byId);
$st = state($code, $tokens[0]);
check(refused(post('roll', array('code' => $code, 'turn' => 0, 'key' => key_()), $tokens[0]), 409), 'roll in the lobby: 409 (not in progress)');
check(post('start', array('code' => $code), $tokens[0])['ok'], 'host starts');
$d = post('start', array('code' => $code), $tokens[0]);
check($d['ok'] && !empty($d['duplicate']), 'start twice: harmless duplicate');
check(refused(post('join', array('code' => $code, 'name' => 'Late', 'vehicle' => $VEHICLES[7])), 409), 'join after start: 409');
check(refused(post('addbot', array('code' => $code), $tokens[0]), 409) && refused(post('setup', array('code' => $code, 'target' => 4000), $tokens[0]), 409), 'addbot and setup after start: 409');
check(refused(post('remove', array('code' => $code, 'playerId' => $ids[1]), $tokens[0]), 409), 'remove after start: 409');
$pk = req('GET', 'peek', null, null, "&code=$code");
check($pk['status'] === 'active', 'peek shows active');
$st = state($code, $tokens[0]);
$g = $st['game'];
check($g['status'] === 'active' && $g['target'] === 5000 && $g['turn'] === 0 && $g['phase'] === 'start' && $g['reels'] === array_fill(0, 6, null)
    && $g['card'] !== null && isset($g['card']['key'], $g['card']['name'], $g['card']['text']) && in_array($g['currentId'], $ids), 'state: active, card dealt, phase start, empty reels');
$types = array_column($st['events'], 'type');
check(in_array('broken', $types) || $g['currentId'] === $ids[0], 'the host (first seat) is first on turn unless a broken-down card passed the turn');
check(in_array('start', $types) && in_array('turn', $types), 'the log has a start and a turn event');
$pa = array();
foreach ($st['events'] as $e) if ($e['type'] === 'start' || $e['type'] === 'turn') $pa[$e['playAt']] = true;
check(count($pa) === 1 && key($pa) > 0, 'start and turn events share one playAt');
$cur = array_search($g['currentId'], $ids);
$other = ($cur + 1) % $N;
$turn = $g['turn'];

echo "  tokens and turns\n";
check(refused(post('roll', array('code' => $code, 'turn' => $turn, 'key' => key_())), 403), 'roll with no token: 403');
check(refused(post('roll', array('code' => $code, 'turn' => $turn, 'key' => key_()), 'deadbeef'), 403), 'roll with a wrong token: 403');
check(refused(post('roll', array('code' => $code, 'turn' => $turn, 'key' => key_()), $solo['token']), 403), 'roll with a token from another room: 403');
check(refused(post('roll', array('code' => $code, 'turn' => $turn, 'key' => key_()), $tokens[$other]), 409), 'roll out of turn: 409');
check(refused(post('roll', array('code' => $code, 'turn' => $turn), $tokens[$cur]), 400), 'roll without a key: 400');
check(refused(post('roll', array('code' => $code, 'turn' => $turn + 5, 'key' => key_()), $tokens[$cur]), 409), 'roll with a wrong turn number: 409');
check(refused(post('roll', array('code' => $code, 'key' => key_()), $tokens[$cur]), 409), 'roll with no turn number: 409');
check(refused(post('roll', array('code' => $code, 'turn' => $turn, 'key' => key_(), 'picks' => array(0)), $tokens[$cur]), 409), 'picks at the start of a turn: 409 (roll first)');
check(refused(post('bank', array('code' => $code, 'turn' => $turn, 'key' => key_(), 'picks' => array()), $tokens[$cur]), 409), 'bank before rolling: 409');
check(refused(post('roll', array('code' => $code, 'turn' => $turn, 'key' => key_(), 'picks' => 'x'), $tokens[$cur]), 400), 'picks that are not a list: 400');
check(refused(post('botstep', array('code' => $code, 'turn' => $turn, 'key' => key_()), $tokens[$cur]), 409), 'botstep when a human is on turn: 409');
check(refused(post('botstep', array('code' => $code, 'turn' => $turn, 'key' => key_())), 403), 'botstep with no token: 403');
check(state($code)['game']['turn'] === $turn, 'none of the refusals moved the turn');

if ($RACE) {
    echo "  parallel taps (curl processes)\n";
    $key = key_();
    $res = parallel(4, 'roll', array_fill(0, 4, array('code' => $code, 'turn' => $turn, 'key' => $key)), array_fill(0, 4, $tokens[$cur]));
    $accepted = 0; $dups = 0;
    foreach ($res as $o) { if (!empty($o['ok'])) { if (!empty($o['duplicate'])) $dups++; else $accepted++; } }
    check($accepted === 1 && $dups === 3, "four parallel taps with the same key: one accepted, three duplicates ($accepted/$dups)");
    $st2 = state($code, $tokens[0]);
    check($st2['game']['turn'] === $turn + 1, 'the turn advanced by exactly 1');
    $rolls = array_filter($st2['events'], function ($e) { return $e['type'] === 'roll'; });
    check(count($rolls) === 1, 'exactly one roll event was logged');
    // different keys, same turn
    $g2 = $st2['game'];
    $cur2 = array_search($g2['currentId'], $ids);
    $mv = human_move($st2, 300);
    $bodies = array();
    for ($k = 0; $k < 4; $k++) $bodies[] = array('code' => $code, 'turn' => $g2['turn'], 'key' => key_()) + $mv[1];
    $res = parallel(4, $mv[0], $bodies, array_fill(0, 4, $tokens[$cur2]));
    $accepted = 0; $stale = 0;
    foreach ($res as $o) { if (!empty($o['ok'])) $accepted++; else $stale++; }
    check($accepted === 1 && $stale === 3, "four parallel taps with different keys: one accepted, three refused 409 ($accepted/$stale)");
    $st3 = state($code, $tokens[0]);
    check($st3['game']['turn'] === $g2['turn'] + 1, 'the turn advanced by exactly 1 again');
    // parallel joins get different seats
    $pc = post('create', array('name' => 'PHost', 'vehicle' => $VEHICLES[0]));
    $bodies = array();
    for ($k = 1; $k <= 3; $k++) $bodies[] = array('code' => $pc['code'], 'name' => "P$k", 'vehicle' => $VEHICLES[$k]);
    $res = parallel(3, 'join', $bodies, array(null, null, null));
    $okj = 0; foreach ($res as $o) if (!empty($o['ok'])) $okj++;
    $seats = array_column(state($pc['code'])['players'], 'seat');
    sort($seats);
    check($okj === 3 && $seats === array(0, 1, 2, 3), 'three joins at the same moment get seats 0..3, all different');
} else {
    echo "  parallel taps: skipped (single-threaded dev server)\n";
    check(true, 'parallel tests skipped (single-threaded dev server)');
}

echo "  sequential double taps\n";
$st = state($code, $tokens[0]);
$g = $st['game']; $cur = array_search($g['currentId'], $ids);
$mv = human_move($st, 300);
$k1 = key_();
$body = array('code' => $code, 'turn' => $g['turn'], 'key' => $k1) + $mv[1];
$r1 = post($mv[0], $body, $tokens[$cur]);
$r1b = post($mv[0], $body, $tokens[$cur]);
check($r1['ok'] && empty($r1['duplicate']) && $r1b['ok'] && $r1b['duplicate'] === true, 'a retry with the same key is a duplicate, no second move');
$r2 = post($mv[0], array('key' => key_()) + $body, $tokens[$cur]);
check(refused($r2, 409), 'a second tap with the old turn number: 409');
check(state($code)['game']['turn'] === $g['turn'] + 1, 'the state advanced exactly once');

echo "  rule refusals inside a roll\n";
// play until a 'rolled' state, then probe it
$probed = false;
for ($n = 0; $n < 60 && !$probed; $n++) {
    $st = state($code, $tokens[0]); $g = $st['game'];
    $cur = array_search($g['currentId'], $ids);
    if ($g['phase'] === 'rolled') {
        $probed = true;
        $t0 = $g['turn'];
        check(refused(post('roll', array('code' => $code, 'turn' => $t0, 'key' => key_(), 'picks' => array()), $tokens[$cur]), 409), 'roll with no picks after a roll: 409');
        check(refused(post('bank', array('code' => $code, 'turn' => $t0, 'key' => key_(), 'picks' => array()), $tokens[$cur]), 409), 'bank with no picks: 409');
        check(refused(post('roll', array('code' => $code, 'turn' => $t0, 'key' => key_(), 'picks' => array(7)), $tokens[$cur]), 409), 'picks outside 0..5: 409');
        check(refused(post('roll', array('code' => $code, 'turn' => $t0, 'key' => key_(), 'picks' => array('a')), $tokens[$cur]), 400), 'picks that are not numbers: 400');
        $nonScoring = array();
        foreach ($g['scoring'] as $i => $sc) if (!$sc && !$g['locked'][$i]) $nonScoring[] = $i;
        if ($nonScoring) check(refused(post('roll', array('code' => $code, 'turn' => $t0, 'key' => key_(), 'picks' => array($nonScoring[0])), $tokens[$cur]), 409), 'keeping a reel that does not score: 409');
        $sc = array();
        foreach ($g['scoring'] as $i => $s2) if ($s2) $sc[] = $i;
        check(refused(post('roll', array('code' => $code, 'turn' => $t0, 'key' => key_(), 'picks' => array($sc[0], $sc[0])), $tokens[$cur]), 409), 'the same reel twice: 409');
        check(state($code)['game']['turn'] === $t0, 'the refusals did not move the turn');
    } else {
        $mv = human_move($st, 300);
        post($mv[0], array('code' => $code, 'turn' => $g['turn'], 'key' => key_()) + $mv[1], $tokens[$cur]);
    }
}
check($probed, 'reached a rolled state to probe');

echo "  host skip and sit out (mid-game)\n";
$st = state($code, $tokens[0]); $g = $st['game'];
$cur = array_search($g['currentId'], $ids);
$guest = $tokens[$N - 1];
check(refused(post('skip', array('code' => $code, 'turn' => $g['turn']), $guest), 403), 'skip: a guest cannot (403)');
check(refused(post('skip', array('code' => $code, 'turn' => $g['turn'])), 403), 'skip: no token 403');
check(refused(post('skip', array('code' => $code, 'turn' => $g['turn'] + 9), $tokens[0]), 409), 'skip: a stale turn number is refused (409)');
$r = post('skip', array('code' => $code, 'turn' => $g['turn']), $tokens[0]);
$st = state($code, $tokens[0], 0); $g2 = $st['game'];
check($r['ok'] && $g2['turn'] === $g['turn'] + 1 && $g2['currentId'] !== $g['currentId'], 'host skip: turn +1 and the next player is up');
$sk = array_values(array_filter($st['events'], function ($e) { return $e['type'] === 'skip'; }));
check(count($sk) >= 1 && strpos($sk[count($sk) - 1]['msg'], 'skipped by the host') !== false && isset($sk[count($sk) - 1]['data']['lost']), 'the skip is logged with the stake lost');
check(refused(post('skip', array('code' => $code, 'turn' => $g['turn'])), 403) && refused(post('skip', array('code' => $code, 'turn' => $g['turn']), $tokens[0]), 409), 'tapping Skip twice with the old turn skips once (409)');
// sit out
$victim = $ids[$N - 1];
check(refused(post('sitout', array('code' => $code, 'playerId' => $victim, 'on' => true), $guest), 403), 'sitout: a guest cannot (403)');
check(refused(post('sitout', array('code' => $code, 'playerId' => 999999, 'on' => true), $tokens[0]), 404), 'sitout: unknown player 404');
$r = post('sitout', array('code' => $code, 'playerId' => $victim, 'on' => true), $tokens[0]);
$st = state($code, $tokens[0]);
$vp = null; foreach ($st['players'] as $p) if ($p['id'] === $victim) $vp = $p;
check($r['ok'] && $vp['out'] === true, 'host sits a player out: out is true');
$d = post('sitout', array('code' => $code, 'playerId' => $victim, 'on' => true), $tokens[0]);
check($d['ok'] && !empty($d['duplicate']), 'sitting out someone already sitting out: harmless duplicate');
$never = true; $acts = 0;
for ($n = 0; $n < 12; $n++) {
    $st = state($code, $tokens[0]); $g = $st['game'];
    if ($g['status'] !== 'active') break;
    if ($g['currentId'] === $victim) { $never = false; break; }
    $cur = array_search($g['currentId'], $ids);
    $mv = human_move($st, 400);
    post($mv[0], array('code' => $code, 'turn' => $g['turn'], 'key' => key_()) + $mv[1], $tokens[$cur]);
    $acts++;
}
check($never && $acts >= 4, "a player sitting out is never on turn over $acts actions");
if ($N >= 2 && $g['status'] === 'active') {
    $r = post('sitout', array('code' => $code, 'playerId' => $victim, 'on' => false), $tokens[0]);
    $st = state($code, $tokens[0]);
    $vp = null; foreach ($st['players'] as $p) if ($p['id'] === $victim) $vp = $p;
    check($r['ok'] && $vp['out'] === false, 'bring them back: out is false');
    // sit out the player on turn: the turn moves on at once
    $g = $st['game'];
    if ($g['currentId'] !== $ids[0]) {
        $r = post('sitout', array('code' => $code, 'playerId' => $g['currentId'], 'on' => true), $tokens[0]);
        $st2 = state($code, $tokens[0]);
        check($r['ok'] && $st2['game']['currentId'] !== $g['currentId'] && $st2['game']['turn'] === $g['turn'] + 1, 'sitting out the player on turn moves the turn on at once');
        $cur = array_search($g['currentId'], $ids);
        check(refused(post('roll', array('code' => $code, 'turn' => $g['turn'], 'key' => key_()), $tokens[$cur]), 409), 'their old tap is refused (409)');
        post('sitout', array('code' => $code, 'playerId' => $g['currentId'], 'on' => false), $tokens[0]);
    }
    // never the last one in
    $allOut = true;
    $stNow = state($code, $tokens[0]);
    foreach ($ids as $pid) {
        if ($pid === $ids[0]) continue;
        $r = post('sitout', array('code' => $code, 'playerId' => $pid, 'on' => true), $tokens[0]);
        if (!$r['ok']) $allOut = false;
    }
    $r = post('sitout', array('code' => $code, 'playerId' => $ids[0], 'on' => true), $tokens[0]);
    check(refused($r, 409), 'sitout: never the last one in (409)');
    foreach ($ids as $pid) post('sitout', array('code' => $code, 'playerId' => $pid, 'on' => false), $tokens[0]);
}

echo "  the rest of the game to a winner (and a rematch)\n";
if (state($code, $tokens[0])['game']['status'] === 'active') {     // (a lucky big bank can end the game early)
    check(refused(post('rematch', array('code' => $code), $tokens[0]), 409), 'rematch while the game is running: 409');
    play_game($code, $byId, $tokens[0], 'headline');
} else {
    check(true, 'the headline game ended during the host-control checks (lucky bank); rematch-while-running not probed this run');
}

// rematch
$fin = state($code, $tokens[0]);
$g = $fin['game'];
check(refused(post('roll', array('code' => $code, 'turn' => $g['turn'], 'key' => key_()), $tokens[0]), 409), 'no moves after the finish (409)');
check(refused(post('skip', array('code' => $code, 'turn' => $g['turn']), $tokens[0]), 409), 'no skipping after the finish (409)');
check(refused(post('rematch', array('code' => $code), $tokens[$N - 1]), 403), 'rematch: a guest cannot (403)');
check(refused(post('start', array('code' => $code), $tokens[0]), 409), 'start on a finished game: 409');
$r = post('rematch', array('code' => $code), $tokens[0]);
$st = state($code, $tokens[0]); $g = $st['game'];
check($r['ok'] && $g['status'] === 'lobby' && $g['target'] === 5000 && $g['winnerId'] === null && $g['card'] === null && $g['turn'] === 0, 'rematch: back to the lobby, same target, no winner');
check(count($st['players']) === $N && array_sum(array_column($st['players'], 'bank')) === 0 && $st['meId'] === $ids[0], 'same players, banks reset, same host token still works');
for ($k = 0; $k < $N; $k++) {
    if (state($code, $tokens[$k])['meId'] !== $ids[$k]) { check(false, "token $k still has its seat after the rematch"); break; }
    if ($k === $N - 1) check(true, 'every seat token still works after the rematch');
}
$d = post('rematch', array('code' => $code), $tokens[0]);
check($d['ok'] && !empty($d['duplicate']), 'rematch twice: harmless duplicate');
check(refused(post('roll', array('code' => $code, 'turn' => 5, 'key' => key_()), $tokens[0]), 409), 'an old tap after the rematch is refused (409)');
check(post('start', array('code' => $code), $tokens[0])['ok'], 'the rematch starts again');
check(state($code, $tokens[0])['game']['status'] === 'active', 'and is active');
play_game($code, $byId, $tokens[0], 'rematch');

// ===========================================================================
echo "\nFull games: 2, 3 and 4 players, with computers\n";
$scenarios = array(
    array('humans' => 2, 'bots' => 0, 'target' => 2500),
    array('humans' => 3, 'bots' => 0, 'target' => 2500),
    array('humans' => 4, 'bots' => 0, 'target' => 3000),
    array('humans' => 1, 'bots' => 1, 'target' => 2500),
    array('humans' => 1, 'bots' => 3, 'target' => 3000),
    array('humans' => 2, 'bots' => 1, 'target' => 5000),
    array('humans' => 2, 'bots' => 2, 'target' => 2500),
);
foreach ($scenarios as $sc) {
    $label = $sc['humans'] . ' human' . ($sc['humans'] > 1 ? 's' : '') . ' + ' . $sc['bots'] . ' computer' . ($sc['bots'] === 1 ? '' : 's') . ', to $' . $sc['target'];
    echo "  $label\n";
    list($code, $tokens, $byId) = make_room($sc['humans'], $sc['bots'], $sc['target']);
    $total = $sc['humans'] + $sc['bots'];
    check(count(state($code)['players']) === $total, "room of $total players");
    check(post('start', array('code' => $code), $tokens[0])['ok'], 'start');
    play_game($code, $byId, $tokens[0], $label);
}

echo "\nComputer seats\n";
$onBot = false;
for ($attempt = 0; $attempt < 8 && !$onBot; $attempt++) {     // a game can end before the computer is up: try another room
    list($code, $tokens, $byId) = make_room(2, 1, 5000);
    $botId = null; foreach (state($code)['players'] as $p) if ($p['bot']) $botId = $p['id'];
    if ($attempt === 0) check(refused(post('remove', array('code' => $code, 'playerId' => 999999), $tokens[1]), 403), 'remove: a guest cannot (403)');
    post('start', array('code' => $code), $tokens[0]);
    // walk the game until the computer is on turn, then probe botstep
    for ($n = 0; $n < 200 && !$onBot; $n++) {
        $st = state($code, $tokens[0]); $g = $st['game'];
        if ($g['status'] !== 'active') break;
        if ($g['currentId'] === $botId) { $onBot = true; break; }
        $hid = $g['currentId'];
        $mv = human_move($st, 300);
        post($mv[0], array('code' => $code, 'turn' => $g['turn'], 'key' => key_()) + $mv[1], $byId[$hid]);
    }
}
if ($onBot) {
    $t0 = $g['turn'];
    check(refused(post('roll', array('code' => $code, 'turn' => $t0, 'key' => key_()), $tokens[0]), 409), "a human cannot roll for a computer (409)");
    check(refused(post('botstep', array('code' => $code, 'turn' => $t0, 'key' => key_())), 403), 'botstep with no token: 403');
    check(refused(post('botstep', array('code' => $code, 'turn' => $t0 + 3, 'key' => key_()), $tokens[1]), 409), 'botstep with a stale turn: 409');
    $k = key_();
    $r = post('botstep', array('code' => $code, 'turn' => $t0, 'key' => $k), $tokens[1]);
    $r2 = post('botstep', array('code' => $code, 'turn' => $t0, 'key' => $k), $tokens[1]);
    check($r['ok'] && empty($r2['duplicate']) === false && $r2['ok'], 'botstep: one computer move, and a repeat of the key is a duplicate');
    $st = state($code, $tokens[0]);
    check($st['game']['turn'] === $t0 + 1, 'the computer move advanced the turn by exactly 1');
    $mine = array_filter($st['events'], function ($e) use ($botId) { return isset($e['data']['playerId']) && $e['data']['playerId'] === $botId; });
    check(count($mine) >= 1, "the computer's move is in the log under its own player id");
} else {
    check(false, 'the computer got a turn to probe');
}

// ===========================================================================
echo "\nEvents and state shape\n";
$st = state($code, $tokens[0]);
$all = $st['events'];
check(count($all) <= 40, 'since=0 returns at most the last 40 events (' . count($all) . ')');
$lastId = $all ? $all[count($all) - 1]['id'] : 0;
check(count(state($code, $tokens[0], $lastId)['events']) === 0, 'since=<last id>: no events');
check(count(state($code, $tokens[0], max(0, $lastId - 2))['events']) <= 2, 'since filters to newer events only');
$ok = true;
foreach ($all as $e) {
    if (!isset($e['id'], $e['type'], $e['msg']) || !array_key_exists('data', $e) || !array_key_exists('playAt', $e) || $e['msg'] === '') $ok = false;
}
check($ok, 'every event has id, type, msg, data, playAt');
$ok = true; $prev = 0;
foreach ($all as $e) { if ($e['id'] <= $prev) $ok = false; $prev = $e['id']; }
check($ok, 'event ids increase');

echo "\n" . ($fails ? "$fails FAILED ($passes passed)" : "ALL PASSED ($passes checks)") . "\n";
exit($fails ? 1 : 0);

// ===========================================================================
/**
 * Play a game that is already started to its end through the API. Humans use human_move() (token from $byId), computers move through
 * botstep sent by a seated human. Checks, along the way: the turn goes up by exactly 1 per action, the events of one action share one
 * playAt, banks in the state match the bank events, and the winner has reached the target. Returns the number of actions.
 */
function play_game($code, array $byId, $hostTok, $label)
{
    $since = 0; $actions = 0; $botsteps = 0; $counts = array();
    $turnOk = true; $playAtOk = true; $mirrorOk = true; $order = true; $dupOk = true; $log = array();
    $humanTokens = array_values($byId);
    $thresholds = array(300, 600, 1000, 400);
    $prevTurn = null; $winEvents = 0; $winnerBank = null; $bustSeen = false;
    $st = state($code, $hostTok, 0);
    $since = 0;
    foreach ($st['events'] as $e) $since = max($since, $e['id']);
    while ($actions < 3000) {
        $g = $st['game'];
        if ($g['status'] === 'finished') break;
        $cur = $g['currentId'];
        $pl = array();
        foreach ($st['players'] as $p) $pl[$p['id']] = $p;
        $base = array('code' => $code, 'turn' => $g['turn'], 'key' => key_());
        if ($pl[$cur]['bot']) {
            $tok = $humanTokens[$actions % count($humanTokens)];
            $r = post('botstep', $base, $tok);
            $botsteps++;
            $body = $base; $action = 'botstep';
        } else {
            $mv = human_move($st, $thresholds[array_search($cur, array_keys($byId)) % 4]);
            $action = $mv[0];
            $body = $base + $mv[1];
            $tok = $byId[$cur];
            $r = post($action, $body, $tok);
        }
        if (!$r['ok']) { check(false, "$label: $action failed: " . $r['error']); return $actions; }
        $actions++;
        if ($actions % 9 === 1) {                // a retry of the same tap is a duplicate and changes nothing
            $d = post($action, $body, $tok);
            if (empty($d['duplicate'])) $dupOk = false;
        }
        $st = state($code, $hostTok, $since);
        if ($prevTurn !== null && $st['game']['turn'] !== $prevTurn + 1) $turnOk = false;
        if ($st['game']['turn'] !== $g['turn'] + 1) $turnOk = false;
        $prevTurn = $st['game']['turn'];
        $at = array();
        foreach ($st['events'] as $e) {
            if ($e['id'] <= $since) $order = false;
            $since = $e['id'];
            $counts[$e['type']] = (isset($counts[$e['type']]) ? $counts[$e['type']] : 0) + 1;
            $at[$e['playAt']] = true;
            $log[] = $e['msg'];
            if ($e['type'] === 'bank') {
                $pid = $e['data']['playerId'];
                foreach ($st['players'] as $p) if ($p['id'] === $pid && $p['bank'] !== $e['data']['bank']) $mirrorOk = false;
            }
            if ($e['type'] === 'win') { $winEvents++; $winnerBank = $e['data']['bank']; }
        }
        if (count($at) !== 1 || key($at) === null) $playAtOk = false;
    }
    $g = $st['game'];
    $winner = null;
    foreach ($st['players'] as $p) if ($p['id'] === $g['winnerId']) $winner = $p;
    check($g['status'] === 'finished' && $winner !== null && $winner['bank'] >= $g['target'], "$label: finished after $actions actions ($botsteps computer moves); winner {$winner['name']} with \${$winner['bank']} of \${$g['target']}");
    check($winEvents === 1 && $winnerBank === $winner['bank'], "$label: exactly one win event, matching the winner's bank");
    check($turnOk, "$label: the turn went up by exactly 1 per action");
    check($playAtOk, "$label: the events of each action share one playAt");
    check($order, "$label: poll results only had newer event ids");
    check($mirrorOk, "$label: banks in the state match the bank events");
    check($dupOk, "$label: a repeated key was always a duplicate");
    echo '       events: ' . json_encode($counts) . "\n";
    return $actions;
}
