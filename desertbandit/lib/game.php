<?php
/**
 * Game service: everything that touches the database for a game.
 * The rules live in rules.php (pure) and the computer player in bot.php (pure); this file loads the state from MySQL,
 * calls them, and saves the result in ONE transaction with the game row locked FOR UPDATE.
 * PHP 7.4 compatible. Every function is prefixed bandit_.
 *
 * The engine state (bandit_games.state_json) is the authority while a game runs; bandit_players.bank and out_flag mirror it
 * after every action. games.turn_number equals the engine's `turn` (it counts accepted actions).
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/rules.php';
require_once __DIR__ . '/bot.php';

/** Errors safe to show to the player (bad code, vehicle taken...). $status = HTTP status. */
class BanditApiError extends Exception
{
    public $status;

    public function __construct($message, $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

const BANDIT_MAX_PLAYERS = 4;
const BANDIT_MIN_PLAYERS = 2;

/** The 8 pieces (same as Desert Ranger). Key = art file name (assets/img/pieces/<key>.png), value = display label. */
function bandit_vehicles()
{
    return array(
        'bronco-orange'  => 'Marigold',
        'scout-butter'   => 'Butter Scout',
        'jeep-red'       => 'Red Rocket',
        'ranger-green'   => 'Ranger Green',
        'buggy-blue'     => 'Blue Buggy',
        'rail-purple'    => 'Purple Rail',
        'cruiser-teal'   => 'Teal Cruiser',
        'blazer-twotone' => 'Two-Tone',
    );
}

/** The victory totals the host can pick: 2,500 to 15,000 in steps of 500. */
function bandit_targets()
{
    $t = array();
    for ($v = BanditRules::MIN_TARGET; $v <= BanditRules::MAX_TARGET; $v += 500) {
        $t[] = $v;
    }
    return $t;
}

/** The ONLY source of randomness (reels, cards, olla bonuses). */
function bandit_rand($min, $max)
{
    return random_int($min, $max);
}

/** The computer player, with its policy table loaded once per request. */
function bandit_bot()
{
    static $bot = null;
    if ($bot === null) {
        $bot = new BanditBot(__DIR__ . '/policy.json');
    }
    return $bot;
}

/** Clean up a display name: trim, collapse spaces, 1-20 characters. */
function bandit_clean_name($name)
{
    $name = is_scalar($name) ? (string)$name : '';
    $name = preg_replace('/[\x00-\x1F\x7F]+/u', '', $name);
    $name = trim(preg_replace('/\s+/u', ' ', (string)$name));
    if ($name === '') {
        throw new BanditApiError('Please enter a name.');
    }
    return bandit_substr($name, 20);
}

function bandit_substr($s, $len)
{
    return function_exists('mb_substr') ? mb_substr($s, 0, $len, 'UTF-8') : substr($s, 0, $len);
}

function bandit_check_vehicle($vehicle)
{
    $v = bandit_vehicles();
    if (!is_string($vehicle) || !isset($v[$vehicle])) {
        throw new BanditApiError('Pick a vehicle.');
    }
    return $vehicle;
}

function bandit_normalize_code($code)
{
    return strtoupper(preg_replace('/[^A-Za-z]/', '', is_scalar($code) ? (string)$code : ''));
}

/** Random 4-letter room code (no I or O, they look like 1 and 0). */
function bandit_random_code()
{
    $letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    $code = '';
    for ($i = 0; $i < 4; $i++) {
        $code .= $letters[random_int(0, strlen($letters) - 1)];
    }
    return $code;
}

/** New secret seat token. The client keeps the token; the DB only keeps its sha256. */
function bandit_new_token()
{
    return bin2hex(random_bytes(24));
}

function bandit_hash_token($token)
{
    return hash('sha256', (string)$token);
}

/** Run $fn in one transaction; roll back on any failure. */
function bandit_tx(PDO $db, $fn)
{
    $db->beginTransaction();
    try {
        $result = call_user_func($fn);
        $db->commit();
        return $result;
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

/** Find a game by code, or throw 404. $lock = true adds FOR UPDATE (call inside a transaction). */
function bandit_find_game(PDO $db, $code, $lock = false)
{
    $st = $db->prepare('SELECT * FROM bandit_games WHERE code = ?' . ($lock ? ' FOR UPDATE' : ''));
    $st->execute(array(bandit_normalize_code($code)));
    $g = $st->fetch();
    if (!$g) {
        throw new BanditApiError('No game with that room code.', 404);
    }
    return $g;
}

/** All players of a game in seat (= turn) order. */
function bandit_players(PDO $db, $gameId)
{
    $st = $db->prepare('SELECT * FROM bandit_players WHERE game_id = ? ORDER BY seat');
    $st->execute(array($gameId));
    return $st->fetchAll();
}

/** Which seated human does this token belong to (in this game)? null if none. Computer seats have no token. */
function bandit_player_for_token(array $players, $token)
{
    if (!$token) {
        return null;
    }
    $h = bandit_hash_token($token);
    foreach ($players as $p) {
        if ($p['token_hash'] !== null && hash_equals($p['token_hash'], $h)) {
            return $p;
        }
    }
    return null;
}

/** The host's row, or a 403 with $msg. */
function bandit_require_host(array $g, array $players, $token, $msg)
{
    $me = bandit_player_for_token($players, $token);
    if (!$me || (int)$me['id'] !== (int)$g['host_player_id']) {
        throw new BanditApiError($msg, 403);
    }
    return $me;
}

function bandit_find_player(array $players, $playerId)
{
    foreach ($players as $p) {
        if ((int)$p['id'] === (int)$playerId) {
            return $p;
        }
    }
    return null;
}

/** The shared time every device starts one action's animations at. */
function bandit_play_at()
{
    return bandit_now_ms() + (int)bandit_config()['cue_lead_ms'];
}

/** Append an event. $data is any array (stored as JSON), or null. */
function bandit_add_event(PDO $db, $gameId, $turn, $type, $message, $data, $playAt)
{
    $st = $db->prepare('INSERT INTO bandit_events (game_id, turn_number, type, message, payload, play_at_ms, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)');
    $st->execute(array($gameId, (int)$turn, $type, bandit_substr((string)$message, 500),
        ($data === null || $data === array()) ? null : json_encode($data), $playAt, bandit_now_sql()));
}

/** Store engine events (with their log lines) as bandit_events, all with one play_at. */
function bandit_add_engine_events(PDO $db, $gameId, $turn, array $res, $playAt)
{
    foreach ($res['events'] as $n => $e) {
        $type = $e['type'];
        unset($e['type']);
        bandit_add_event($db, $gameId, $turn, $type, $res['log'][$n], $e, $playAt);
    }
}

// ===========================================================================
//  LOBBY ACTIONS
// ===========================================================================

/** Insert a player row; returns array(plain token or null, new player id). Computer seats get no token. */
function bandit_player_insert(PDO $db, $gameId, $seat, $name, $vehicle, $isBot)
{
    $token = $isBot ? null : bandit_new_token();
    $now = bandit_now_sql();
    $st = $db->prepare('INSERT INTO bandit_players (game_id, seat, display_name, vehicle, token_hash, is_bot, bank, out_flag, joined_at, last_seen_at)
                        VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)');
    $st->execute(array($gameId, $seat, $name, $vehicle, $token === null ? null : bandit_hash_token($token), $isBot ? 1 : 0, $now, $now));
    return array($token, (int)$db->lastInsertId());
}

/** The first seat number nobody uses (not count: after a Remove the seats must not clash). */
function bandit_free_seat(array $players)
{
    $used = array();
    foreach ($players as $p) {
        $used[(int)$p['seat']] = true;
    }
    $seat = 0;
    while (isset($used[$seat])) {
        $seat++;
    }
    return $seat;
}

/** Create a game with the caller as host (seat 0). Returns array(code, token). */
function bandit_create_game(PDO $db, $name, $vehicle)
{
    $name = bandit_clean_name($name);
    bandit_check_vehicle($vehicle);
    return bandit_tx($db, function () use ($db, $name, $vehicle) {
        $now = bandit_now_sql();
        for ($try = 0; ; $try++) {              // an unused code (retry on the rare collision)
            $code = bandit_random_code();
            try {
                $db->prepare("INSERT INTO bandit_games (code, status, target, turn_number, created_at, updated_at) VALUES (?, 'lobby', ?, 0, ?, ?)")
                   ->execute(array($code, BanditRules::DEFAULT_TARGET, $now, $now));
                break;
            } catch (PDOException $e) {
                if ($try > 20) {
                    throw $e;
                }
            }
        }
        $gameId = (int)$db->lastInsertId();
        list($token, $playerId) = bandit_player_insert($db, $gameId, 0, $name, $vehicle, false);
        $db->prepare('UPDATE bandit_games SET host_player_id = ? WHERE id = ?')->execute(array($playerId, $gameId));
        $vs = bandit_vehicles();
        bandit_add_event($db, $gameId, 0, 'join', $name . ' created the game (' . $vs[$vehicle] . ').', array('playerId' => $playerId), bandit_play_at());
        return array($code, $token);
    });
}

/** Join an existing game that is still in the lobby. Returns the token. */
function bandit_join_game(PDO $db, $code, $name, $vehicle)
{
    $name = bandit_clean_name($name);
    bandit_check_vehicle($vehicle);
    return bandit_tx($db, function () use ($db, $code, $name, $vehicle) {
        $g = bandit_find_game($db, $code, true);       // lock: two people joining at once get different seats
        if ($g['status'] !== 'lobby') {
            throw new BanditApiError('That game has already started.', 409);
        }
        $players = bandit_players($db, $g['id']);
        if (count($players) >= BANDIT_MAX_PLAYERS) {
            throw new BanditApiError('That game is full (' . BANDIT_MAX_PLAYERS . ' players).', 409);
        }
        foreach ($players as $p) {
            if ($p['vehicle'] === $vehicle) {
                throw new BanditApiError('Someone already picked that vehicle.', 409);
            }
        }
        list($token, $playerId) = bandit_player_insert($db, $g['id'], bandit_free_seat($players), $name, $vehicle, false);
        $vs = bandit_vehicles();
        bandit_add_event($db, $g['id'], 0, 'join', $name . ' joined (' . $vs[$vehicle] . ').', array('playerId' => $playerId), bandit_play_at());
        $db->prepare('UPDATE bandit_games SET updated_at = ? WHERE id = ?')->execute(array(bandit_now_sql(), $g['id']));
        return $token;
    });
}

/** Host sets the victory total (lobby only). */
function bandit_setup(PDO $db, $code, $token, $target)
{
    bandit_tx($db, function () use ($db, $code, $token, $target) {
        $g = bandit_find_game($db, $code, true);
        $players = bandit_players($db, $g['id']);
        bandit_require_host($g, $players, $token, 'Only the host can change the game.');
        if ($g['status'] !== 'lobby') {
            throw new BanditApiError('The victory total can only be changed in the lobby.', 409);
        }
        try {
            $t = BanditRules::cleanTarget($target);
        } catch (BanditRuleError $e) {
            throw new BanditApiError($e->getMessage(), 400);
        }
        $db->prepare('UPDATE bandit_games SET target = ?, updated_at = ? WHERE id = ?')->execute(array($t, bandit_now_sql(), $g['id']));
    });
}

/** Host adds a computer seat (lobby only): "Rival n", the first free vehicle, no token. */
function bandit_add_bot(PDO $db, $code, $token)
{
    bandit_tx($db, function () use ($db, $code, $token) {
        $g = bandit_find_game($db, $code, true);
        $players = bandit_players($db, $g['id']);
        bandit_require_host($g, $players, $token, 'Only the host can add a computer.');
        if ($g['status'] !== 'lobby') {
            throw new BanditApiError('Computers can only be added in the lobby.', 409);
        }
        if (count($players) >= BANDIT_MAX_PLAYERS) {
            throw new BanditApiError('That game is full (' . BANDIT_MAX_PLAYERS . ' players).', 409);
        }
        $names = array();
        $takenVehicles = array();
        foreach ($players as $p) {
            $names[$p['display_name']] = true;
            $takenVehicles[$p['vehicle']] = true;
        }
        $n = 1;
        while (isset($names['Rival ' . $n])) {
            $n++;
        }
        $vehicle = null;
        foreach (array_keys(bandit_vehicles()) as $key) {
            if (!isset($takenVehicles[$key])) {
                $vehicle = $key;
                break;
            }
        }
        if ($vehicle === null) {
            throw new BanditApiError('No vehicle is free.', 409);
        }
        list($ignored, $playerId) = bandit_player_insert($db, $g['id'], bandit_free_seat($players), 'Rival ' . $n, $vehicle, true);
        $vs = bandit_vehicles();
        bandit_add_event($db, $g['id'], 0, 'join', 'Rival ' . $n . ' (computer) joined (' . $vs[$vehicle] . ').', array('playerId' => $playerId), bandit_play_at());
        $db->prepare('UPDATE bandit_games SET updated_at = ? WHERE id = ?')->execute(array(bandit_now_sql(), $g['id']));
    });
}

/**
 * Host removes a human or computer seat from the LOBBY. Frees the vehicle, kills the seat token and renumbers the seats so they stay
 * 0..n-1. Refuses once the game has started and for the host. Removing someone who is already gone is a harmless no-op.
 */
function bandit_remove_player(PDO $db, $code, $token, $playerId)
{
    bandit_tx($db, function () use ($db, $code, $token, $playerId) {
        $g = bandit_find_game($db, $code, true);
        $players = bandit_players($db, $g['id']);
        bandit_require_host($g, $players, $token, 'Only the host can remove a player.');
        if ($g['status'] !== 'lobby') {
            throw new BanditApiError('Players can only be removed before the game starts. During a game use Skip turn or Sit out.', 409);
        }
        $target = bandit_find_player($players, $playerId);
        if (!$target) {
            return;                              // already gone (double tap)
        }
        if ((int)$target['id'] === (int)$g['host_player_id']) {
            throw new BanditApiError('The host cannot be removed.', 409);
        }
        $db->prepare('DELETE FROM bandit_players WHERE id = ? AND game_id = ?')->execute(array($target['id'], $g['id']));
        // ORDER BY seat: MySQL checks the unique key row by row, so the lowest seat must move first.
        $db->prepare('UPDATE bandit_players SET seat = seat - 1 WHERE game_id = ? AND seat > ? ORDER BY seat')
           ->execute(array($g['id'], (int)$target['seat']));
        bandit_add_event($db, $g['id'], 0, 'leave', $target['display_name'] . ' was removed by the host.', array('playerId' => (int)$target['id']), bandit_play_at());
        $db->prepare('UPDATE bandit_games SET updated_at = ? WHERE id = ?')->execute(array(bandit_now_sql(), $g['id']));
    });
}

// ===========================================================================
//  GAME ACTIONS
// ===========================================================================

/** DB state_json -> engine state array. */
function bandit_engine_state(array $g)
{
    $state = $g['state_json'] === null ? null : json_decode($g['state_json'], true);
    if (!is_array($state)) {
        throw new RuntimeException('The game has no engine state.');
    }
    return $state;
}

/**
 * Save the result of an engine action: mirror banks and out flags into bandit_players, update the game row, and store the
 * events (the server's own $lead events first, then the engine's) with one shared play_at.
 * $key = the idempotency key to remember, or null to leave it alone.
 */
function bandit_save_result(PDO $db, array $g, array $oldState, array $res, $key, array $lead = array())
{
    $new = $res['state'];
    $up = $db->prepare('UPDATE bandit_players SET bank = ?, out_flag = ? WHERE id = ? AND game_id = ?');
    foreach ($new['players'] as $i => $p) {
        $o = $oldState['players'][$i];
        if ($p['bank'] !== $o['bank'] || $p['out'] !== $o['out']) {
            $up->execute(array($p['bank'], $p['out'] ? 1 : 0, $p['id'], $g['id']));
        }
    }
    $db->prepare('UPDATE bandit_games SET status = ?, turn_number = ?, state_json = ?, winner_player_id = ?,
                         last_action_key = ?, updated_at = ? WHERE id = ?')
       ->execute(array($new['status'], $new['turn'], json_encode($new), $new['winner'],
           $key === null ? $g['last_action_key'] : $key, bandit_now_sql(), $g['id']));
    $playAt = bandit_play_at();
    foreach ($lead as $e) {
        bandit_add_event($db, $g['id'], $oldState['turn'], $e[0], $e[1], $e[2], $playAt);
    }
    bandit_add_engine_events($db, $g['id'], $oldState['turn'], $res, $playAt);
}

/**
 * Host starts the game: needs 2 to 4 players (computers count). Makes the engine state and deals the first card.
 * Returns true, or false when the game was already running (a double tap is harmless).
 */
function bandit_start_game(PDO $db, $code, $token)
{
    return bandit_tx($db, function () use ($db, $code, $token) {
        $g = bandit_find_game($db, $code, true);
        $players = bandit_players($db, $g['id']);
        bandit_require_host($g, $players, $token, 'Only the host can start the game.');
        if ($g['status'] === 'active') {
            return false;
        }
        if ($g['status'] !== 'lobby') {
            throw new BanditApiError('That game is over. Use Play again.', 409);
        }
        if (count($players) < BANDIT_MIN_PLAYERS) {
            throw new BanditApiError('Need at least 2 players. Add a computer to play solo.', 409);
        }
        $list = array();
        foreach ($players as $p) {
            $list[] = array('id' => (int)$p['id'], 'name' => $p['display_name']);
        }
        $res = BanditRules::newGameState($list, (int)$g['target'], 'bandit_rand');
        $empty = array('turn' => 0, 'players' => $res['state']['players']);
        bandit_save_result($db, $g, $empty, $res, null, array(
            array('start', 'Game on! First to $' . number_format((int)$g['target']) . ' wins.', array('target' => (int)$g['target'])),
        ));
        return true;
    });
}

/**
 * Host sends a FINISHED game back to the lobby with the same players, seats, tokens and target. Banks reset, the old log goes.
 * Returns false when the room is already in the lobby (a double tap).
 */
function bandit_rematch(PDO $db, $code, $token)
{
    return bandit_tx($db, function () use ($db, $code, $token) {
        $g = bandit_find_game($db, $code, true);
        $players = bandit_players($db, $g['id']);
        bandit_require_host($g, $players, $token, 'Only the host can start a rematch.');
        if ($g['status'] === 'lobby') {
            return false;
        }
        if ($g['status'] !== 'finished') {
            throw new BanditApiError('The game is not over yet.', 409);
        }
        $db->prepare('UPDATE bandit_players SET bank = 0, out_flag = 0 WHERE game_id = ?')->execute(array($g['id']));
        $db->prepare('DELETE FROM bandit_events WHERE game_id = ?')->execute(array($g['id']));
        $db->prepare("UPDATE bandit_games SET status = 'lobby', turn_number = 0, state_json = NULL, winner_player_id = NULL,
                             last_action_key = NULL, updated_at = ? WHERE id = ?")->execute(array(bandit_now_sql(), $g['id']));
        bandit_add_event($db, $g['id'], 0, 'rematch', 'Rematch: back in the lobby with the same players.', null, bandit_play_at());
        return true;
    });
}

/** The picks of a roll or bank request: a list of reel positions (absent = none). */
function bandit_clean_picks($in)
{
    if (!isset($in['picks'])) {
        return array();
    }
    if (!is_array($in['picks'])) {
        throw new BanditApiError('Bad picks.');
    }
    $picks = array();
    foreach ($in['picks'] as $p) {
        if (!is_int($p)) {
            throw new BanditApiError('Bad picks.');
        }
        $picks[] = $p;
    }
    return $picks;
}

/**
 * Roll, bank or a computer step. ONE transaction, game row locked with FOR UPDATE.
 *
 * Double-tap protection:
 *   - $turn must equal games.turn_number (the client sends the turn it saw); a second tap carries the old number: 409.
 *   - $key is a random id per tap. If the same request is retried, last_action_key === $key and we report a duplicate
 *     without acting.
 *
 * $kind = 'roll' | 'bank' | 'botstep'. Returns array('duplicate' => bool).
 */
function bandit_take_action(PDO $db, $code, $token, $kind, $turn, $key, array $in = array())
{
    $key = substr(preg_replace('/[^A-Za-z0-9_-]/', '', is_scalar($key) ? (string)$key : ''), 0, 64);
    if ($key === '') {
        throw new BanditApiError('Missing request key.');
    }
    $picks = ($kind === 'botstep') ? array() : bandit_clean_picks($in);
    return bandit_tx($db, function () use ($db, $code, $token, $kind, $turn, $key, $picks) {
        $g = bandit_find_game($db, $code, true);
        $players = bandit_players($db, $g['id']);
        $me = bandit_player_for_token($players, $token);
        if (!$me) {
            throw new BanditApiError('You are not in this game.', 403);
        }
        if ($g['last_action_key'] === $key) {
            return array('duplicate' => true);
        }
        if ($g['status'] !== 'active') {
            throw new BanditApiError('The game is not in progress.', 409);
        }
        if (!is_numeric($turn) || (int)$turn !== (int)$g['turn_number']) {
            throw new BanditApiError('That turn already happened.', 409);
        }
        $state = bandit_engine_state($g);
        $current = $state['players'][$state['current']]['id'];
        $cur = bandit_find_player($players, $current);
        if ($kind === 'botstep') {
            if (!$cur || (int)$cur['is_bot'] !== 1) {
                throw new BanditApiError("It is not a computer's turn.", 409);
            }
            $move = bandit_bot()->decide($state);
            $kind = $move['kind'];
            $picks = $move['picks'];
        } elseif ((int)$current !== (int)$me['id']) {
            throw new BanditApiError("It's not your turn.", 409);
        }
        if ($kind === 'roll') {
            $res = BanditRules::roll($state, $picks, 'bandit_rand');
        } else {
            $res = BanditRules::bank($state, $picks, 'bandit_rand');
        }
        bandit_save_result($db, $g, $state, $res, $key);
        return array('duplicate' => false);
    });
}

/** Host skips the current player's turn: they lose the stake and the next player starts. Needs the turn the host saw. */
function bandit_skip_turn(PDO $db, $code, $token, $turn)
{
    bandit_tx($db, function () use ($db, $code, $token, $turn) {
        $g = bandit_find_game($db, $code, true);
        $players = bandit_players($db, $g['id']);
        bandit_require_host($g, $players, $token, 'Only the host can skip a turn.');
        if ($g['status'] !== 'active') {
            throw new BanditApiError('The game is not in progress.', 409);
        }
        if (!is_numeric($turn) || (int)$turn !== (int)$g['turn_number']) {
            throw new BanditApiError('That turn already happened.', 409);
        }
        $state = bandit_engine_state($g);
        $res = BanditRules::skipTurn($state, 'bandit_rand');
        bandit_save_result($db, $g, $state, $res, null);
    });
}

/** Host makes a player sit out (their turns pass) or brings them back. Never the last one in (the engine refuses: 409). */
function bandit_sit_out(PDO $db, $code, $token, $playerId, $on)
{
    return bandit_tx($db, function () use ($db, $code, $token, $playerId, $on) {
        $g = bandit_find_game($db, $code, true);
        $players = bandit_players($db, $g['id']);
        bandit_require_host($g, $players, $token, 'Only the host can make a player sit out.');
        if ($g['status'] !== 'active') {
            throw new BanditApiError('The game is not in progress.', 409);
        }
        if (!bandit_find_player($players, $playerId)) {
            throw new BanditApiError('No such player.', 404);
        }
        $state = bandit_engine_state($g);
        $res = BanditRules::sitOut($state, (int)$playerId, (bool)$on, 'bandit_rand');
        if (count($res['events']) === 0) {
            return false;                        // already in that state (double tap)
        }
        bandit_save_result($db, $g, $state, $res, null);
        return true;
    });
}

// ===========================================================================
//  READ ACTIONS
// ===========================================================================

/**
 * Games being played right now, for the homepage: lobby or active, last touched within a day, with a human who has polled in
 * the last two minutes. Only a count: no codes, names or players.
 */
function bandit_stats(PDO $db)
{
    $seenCut = gmdate('Y-m-d H:i:s', time() - 120);
    $dayCut = gmdate('Y-m-d H:i:s', time() - 86400);
    $st = $db->prepare("SELECT COUNT(DISTINCT g.id) FROM bandit_games g JOIN bandit_players p ON p.game_id = g.id
                        WHERE g.status IN ('lobby', 'active') AND g.updated_at >= ? AND p.is_bot = 0 AND p.last_seen_at >= ?");
    $st->execute(array($dayCut, $seenCut));
    return array('games' => (int)$st->fetchColumn());
}

/** What the join form needs: status, the vehicles already taken, the number of players. */
function bandit_peek(PDO $db, $code)
{
    $g = bandit_find_game($db, $code);
    $taken = array();
    $players = bandit_players($db, $g['id']);
    foreach ($players as $p) {
        $taken[] = $p['vehicle'];
    }
    return array('code' => $g['code'], 'status' => $g['status'], 'taken' => $taken, 'players' => count($players));
}

/**
 * The polling endpoint's data: game, players, and events after $since (at most 200; the last 40 when $since is 0).
 * Read-only except a cheap "last seen" touch at most every 20 s per player.
 */
function bandit_state(PDO $db, $code, $since, $token)
{
    $g = bandit_find_game($db, $code);
    $players = bandit_players($db, $g['id']);
    $me = bandit_player_for_token($players, $token);

    if ($me && strtotime($me['last_seen_at'] . ' UTC') < time() - 20) {
        $db->prepare('UPDATE bandit_players SET last_seen_at = ? WHERE id = ?')->execute(array(bandit_now_sql(), $me['id']));
    }

    $since = max(0, (int)$since);
    if ($since > 0) {
        $st = $db->prepare('SELECT * FROM bandit_events WHERE game_id = ? AND id > ? ORDER BY id LIMIT 200');
        $st->execute(array($g['id'], $since));
        $rows = $st->fetchAll();
    } else {
        // First load: just the most recent history (the client does not animate or play these).
        $st = $db->prepare('SELECT * FROM bandit_events WHERE game_id = ? ORDER BY id DESC LIMIT 40');
        $st->execute(array($g['id']));
        $rows = array_reverse($st->fetchAll());
    }
    $events = array();
    foreach ($rows as $r) {
        $data = $r['payload'] ? json_decode($r['payload'], true) : null;
        $events[] = array(
            'id'     => (int)$r['id'],
            'type'   => $r['type'],
            'msg'    => $r['message'],
            'data'   => is_array($data) && count($data) > 0 ? $data : new stdClass(),
            'playAt' => $r['play_at_ms'] === null ? null : (int)$r['play_at_ms'],
        );
    }

    $pl = array();
    foreach ($players as $p) {
        $pl[] = array(
            'id'      => (int)$p['id'],
            'name'    => $p['display_name'],
            'vehicle' => $p['vehicle'],
            'seat'    => (int)$p['seat'],
            'bank'    => (int)$p['bank'],
            'out'     => (int)$p['out_flag'] === 1,
            'bot'     => (int)$p['is_bot'] === 1,
        );
    }

    $none = array_fill(0, BanditRules::REELS, null);
    $off = array_fill(0, BanditRules::REELS, false);
    $game = array(
        'code' => $g['code'], 'status' => $g['status'], 'target' => (int)$g['target'], 'turn' => (int)$g['turn_number'],
        'hostId' => (int)$g['host_player_id'], 'currentId' => null,
        'winnerId' => $g['winner_player_id'] === null ? null : (int)$g['winner_player_id'],
        'card' => null, 'phase' => 'start', 'reels' => $none, 'locked' => $off, 'scoring' => $off, 'stake' => 0, 'sweeps' => 0,
    );
    if ($g['status'] === 'active' && $g['state_json'] !== null) {
        $s = bandit_engine_state($g);
        $game['currentId'] = (int)$s['players'][$s['current']]['id'];
        $game['card'] = array('key' => $s['card'], 'name' => BanditRules::cardName($s['card']), 'text' => BanditRules::cardText($s['card']));
        $game['phase'] = $s['phase'];
        $game['reels'] = $s['reels'] === null ? $none : $s['reels'];
        $game['locked'] = $s['locked'];
        $game['scoring'] = ($s['phase'] === 'rolled' && $s['reels'] !== null) ? BanditRules::scoringReels($s['reels'], $s['locked']) : $off;
        $game['stake'] = (int)$s['stake'];
        $game['sweeps'] = (int)$s['sweeps'];
    }

    return array('game' => $game, 'players' => $pl, 'meId' => $me ? (int)$me['id'] : null, 'events' => $events);
}
