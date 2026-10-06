<?php
/**
 * Config and database connection helpers for Desert Bandit. Plain PDO, no framework.
 * PHP 7.4 compatible.
 */

/** Load config.php once. Throws a clear message if it is missing. */
function bandit_config()
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/../config.php';
        if (!is_file($file)) {
            throw new RuntimeException('config.php is missing. Copy config.sample.php to config.php and edit it.');
        }
        $loaded = require $file;
        if (!is_array($loaded)) {
            throw new RuntimeException('config.php must return an array.');
        }
        $cfg = $loaded + array('db_host' => 'localhost', 'db_port' => 3306, 'db_socket' => '', 'db_name' => '',
            'db_user' => '', 'db_pass' => '', 'cue_lead_ms' => 1500, 'debug' => false);
    }
    return $cfg;
}

/** Shared PDO connection (one per request). */
function bandit_db()
{
    static $pdo = null;
    if ($pdo === null) {
        $c = bandit_config();
        if (!empty($c['db_socket'])) {
            // Unix socket (for example MAMP: /Applications/MAMP/tmp/mysql/mysql.sock). Host and port are ignored.
            $dsn = 'mysql:unix_socket=' . $c['db_socket'];
        } else {
            // TCP. Use 127.0.0.1 rather than "localhost" with a non-standard port: PHP turns "localhost"
            // into "use the default socket" and silently ignores the port.
            $dsn = 'mysql:host=' . $c['db_host'] . ';port=' . (int)$c['db_port'];
        }
        $dsn .= ';dbname=' . $c['db_name'] . ';charset=utf8mb4';
        $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], array(
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ));
        // DATETIMEs are stored in UTC whatever the host's time zone is.
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

/** Server clock in integer milliseconds since the Unix epoch (clock sync and cue times). */
function bandit_now_ms()
{
    return (int)round(microtime(true) * 1000);
}

/** UTC timestamp string for DATETIME columns. */
function bandit_now_sql()
{
    return gmdate('Y-m-d H:i:s');
}
