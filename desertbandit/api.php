<?php
/**
 * Desert Bandit JSON API.  One file, routed by ?a=<action>. (No URL rewriting needed, so it works on any Apache/PHP host.)
 * The contract is docs/WAVE1.md.
 *
 *   GET  api.php?a=time                      -> {t}            clock-sync ping (no includes, no DB)
 *   GET  api.php?a=info                      -> {vehicles, targets, minPlayers, maxPlayers}
 *   GET  api.php?a=stats                     -> {games}        games being played now (homepage counter)
 *   GET  api.php?a=peek&code=ABCD            -> {code, status, taken[], players}   (for the join form)
 *   GET  api.php?a=state&code=ABCD&since=N   -> game, players, events after N      (polled ~1/s)
 *   POST api.php?a=create  {name, vehicle}                -> {code, token}
 *   POST api.php?a=join    {code, name, vehicle}          -> {code, token}
 *   POST api.php?a=setup   {code, target}                 host, lobby: the victory total
 *   POST api.php?a=addbot  {code}                         host, lobby: add a computer seat
 *   POST api.php?a=remove  {code, playerId}               host, lobby: remove a seat
 *   POST api.php?a=start   {code}                         host: 2 to 4 players
 *   POST api.php?a=roll    {code, turn, key, picks?}      the player on turn
 *   POST api.php?a=bank    {code, turn, key, picks}       the player on turn
 *   POST api.php?a=botstep {code, turn, key}              any seated human: one computer move
 *   POST api.php?a=skip    {code, turn}                   host: skip the player on turn
 *   POST api.php?a=sitout  {code, playerId, on}           host: pass over an away player (or bring them back)
 *   POST api.php?a=rematch {code}                         host: a finished game back to the lobby, same players
 *
 * Who am I?  The seat token is sent in the X-Player-Token header (from localStorage). If that is missing we fall back to the
 * bandit_<CODE> cookie. POSTs must be Content-Type: application/json, which a cross-site HTML form cannot send, so the cookie
 * fallback is not a CSRF hole.
 *
 * Every response (except a=time) includes "serverNow" (ms) so polls double as clock-sync samples.
 * Failures: {"ok":false,"error":"...","serverNow":...} with 400 bad input, 403 not host / not seated, 404 no such game or action,
 * 405 not POST, 409 rule refused / stale turn / full or started, 415 POST without application/json, 429, 500.
 */

$bandit_action = isset($_GET['a']) ? (string)$_GET['a'] : '';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// Fast path for clock sync: no includes, no DB, as little work as possible.
if ($bandit_action === 'time') {
    echo '{"ok":true,"t":' . (int)round(microtime(true) * 1000) . '}';
    exit;
}

require __DIR__ . '/lib/game.php';

/** Send JSON and stop. */
function bandit_out(array $data, $status = 200)
{
    http_response_code($status);
    $data['serverNow'] = bandit_now_ms();
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function bandit_require_post()
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        throw new BanditApiError('Use POST.', 405);
    }
}

/** Remember the seat token in a cookie too (survives localStorage being cleared). */
function bandit_set_token_cookie($code, $token)
{
    $path = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\') . '/';
    setcookie('bandit_' . $code, $token, array(
        'expires'  => time() + 60 * 60 * 24 * 60, // 60 days
        'path'     => $path,
        'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax',
    ));
}

function bandit_token_for($code)
{
    if (!empty($_SERVER['HTTP_X_PLAYER_TOKEN'])) {
        return (string)$_SERVER['HTTP_X_PLAYER_TOKEN'];
    }
    $c = 'bandit_' . bandit_normalize_code($code);
    return isset($_COOKIE[$c]) && is_string($_COOKIE[$c]) ? $_COOKIE[$c] : null;
}

try {
    $in = array();
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $ctype = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
        if (stripos($ctype, 'application/json') !== 0) {
            throw new BanditApiError('JSON body required.', 415);
        }
        $in = json_decode(file_get_contents('php://input'), true);
        if (!is_array($in)) {
            throw new BanditApiError('Bad JSON.');
        }
    }
    $code = bandit_normalize_code(isset($in['code']) ? $in['code'] : (isset($_GET['code']) ? $_GET['code'] : ''));
    $db = bandit_db();

    switch ($bandit_action) {
        case 'info':
            bandit_out(array('ok' => true, 'vehicles' => bandit_vehicles(), 'targets' => bandit_targets(),
                'minPlayers' => BANDIT_MIN_PLAYERS, 'maxPlayers' => BANDIT_MAX_PLAYERS));

        case 'stats':
            bandit_out(array('ok' => true) + bandit_stats($db));

        case 'peek':
            bandit_out(array('ok' => true) + bandit_peek($db, $code));

        case 'state':
            $since = isset($_GET['since']) ? (int)$_GET['since'] : 0;
            bandit_out(array('ok' => true) + bandit_state($db, $code, $since, bandit_token_for($code)));

        case 'create':
            bandit_require_post();
            list($code, $token) = bandit_create_game($db, isset($in['name']) ? $in['name'] : '', isset($in['vehicle']) ? $in['vehicle'] : '');
            bandit_set_token_cookie($code, $token);
            bandit_out(array('ok' => true, 'code' => $code, 'token' => $token));

        case 'join':
            bandit_require_post();
            $token = bandit_join_game($db, $code, isset($in['name']) ? $in['name'] : '', isset($in['vehicle']) ? $in['vehicle'] : '');
            bandit_set_token_cookie($code, $token);
            bandit_out(array('ok' => true, 'code' => $code, 'token' => $token));

        case 'setup':
            bandit_require_post();
            bandit_setup($db, $code, bandit_token_for($code), isset($in['target']) ? $in['target'] : 0);
            bandit_out(array('ok' => true));

        case 'addbot':
            bandit_require_post();
            bandit_add_bot($db, $code, bandit_token_for($code));
            bandit_out(array('ok' => true));

        case 'remove':
            bandit_require_post();
            bandit_remove_player($db, $code, bandit_token_for($code), isset($in['playerId']) ? $in['playerId'] : 0);
            bandit_out(array('ok' => true));

        case 'start':
            bandit_require_post();
            $started = bandit_start_game($db, $code, bandit_token_for($code));
            bandit_out($started ? array('ok' => true) : array('ok' => true, 'duplicate' => true));

        case 'rematch':
            bandit_require_post();
            $done = bandit_rematch($db, $code, bandit_token_for($code));
            bandit_out($done ? array('ok' => true) : array('ok' => true, 'duplicate' => true));

        case 'skip':
            bandit_require_post();
            bandit_skip_turn($db, $code, bandit_token_for($code), isset($in['turn']) ? $in['turn'] : -1);
            bandit_out(array('ok' => true));

        case 'sitout':
            bandit_require_post();
            $changed = bandit_sit_out($db, $code, bandit_token_for($code), isset($in['playerId']) ? $in['playerId'] : 0, !empty($in['on']));
            bandit_out($changed ? array('ok' => true) : array('ok' => true, 'duplicate' => true));

        case 'roll':
        case 'bank':
        case 'botstep':
            bandit_require_post();
            $r = bandit_take_action($db, $code, bandit_token_for($code), $bandit_action,
                isset($in['turn']) ? $in['turn'] : -1, isset($in['key']) ? $in['key'] : '', $in);
            bandit_out($r['duplicate'] ? array('ok' => true, 'duplicate' => true) : array('ok' => true));

        default:
            throw new BanditApiError('Unknown action.', 404);
    }
} catch (BanditApiError $e) {
    bandit_out(array('ok' => false, 'error' => $e->getMessage()), $e->status);
} catch (BanditRuleError $e) {
    bandit_out(array('ok' => false, 'error' => $e->getMessage()), 409);
} catch (Throwable $e) {
    error_log('Desert Bandit API error: ' . $e);
    $debug = false;
    try {
        $c = bandit_config();
        $debug = !empty($c['debug']);
    } catch (Throwable $ignored) {
    }
    bandit_out(array('ok' => false, 'error' => $debug ? $e->getMessage() : 'Server error.'), 500);
}
