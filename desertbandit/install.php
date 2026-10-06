<?php
/**
 * Desert Bandit one-time installer: creates the three bandit_ tables (bandit_games, bandit_players, bandit_events).
 *
 *   1. Copy config.sample.php to config.php and fill in the database details (the same database as Desert Ranger is fine:
 *      only tables whose names start with bandit_ are created, nothing else is touched).
 *   2. Open https://your-site/desertbandit/install.php once.
 *   3. DELETE install.php from the server by hand. It does NOT delete itself.
 *
 * It REFUSES to run when bandit_games already exists, so it can never wipe a live game.
 * Self-contained on purpose: it needs only lib/db.php and lib/schema.sql, and answers a clear page when either is missing.
 */
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
$checks = array();
$ok = true;

function bandit_row($label, $good, $detail = '')
{
    global $checks, $ok;
    $checks[] = array($label, $good, $detail);
    if (!$good) {
        $ok = false;
    }
}

bandit_row('PHP version ' . PHP_VERSION . ' (need 7.4+)', version_compare(PHP_VERSION, '7.4.0', '>='));
bandit_row('PDO MySQL driver (pdo_mysql)', extension_loaded('pdo_mysql'));
bandit_row('JSON extension', function_exists('json_encode'));
bandit_row('mbstring (optional, nicer name trimming)', true, extension_loaded('mbstring') ? 'present' : 'missing - OK');
bandit_row('lib/db.php present', is_file(__DIR__ . '/lib/db.php'));
bandit_row('lib/schema.sql present', is_file(__DIR__ . '/lib/schema.sql'));
bandit_row('config.php present', is_file(__DIR__ . '/config.php'), 'copy config.sample.php to config.php');

$message = '';
$installed = false;
if ($ok) {
    require __DIR__ . '/lib/db.php';
    try {
        $db = bandit_db();
        $ver = $db->query('SELECT VERSION()')->fetchColumn();
        bandit_row('Database connection', true, 'server ' . htmlspecialchars($ver));
        $st = $db->prepare('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $st->execute(array('bandit_games'));
        if ((int)$st->fetchColumn() > 0) {
            $message = 'Already installed: bandit_games exists. Refusing to run again, so a live game cannot be wiped. '
                . 'Delete install.php from the server (it does not delete itself).';
            $ok = false;
        } else {
            $sql = file_get_contents(__DIR__ . '/lib/schema.sql');
            // Strip "--" comment lines, then split on lines that contain only ";".
            $sql = preg_replace('/^\s*--.*$/m', '', $sql);
            foreach (preg_split('/^\s*;\s*$/m', $sql) as $stmt) {
                if (trim($stmt) !== '') {
                    $db->exec($stmt);
                }
            }
            $installed = true;
            $message = 'Installed! The tables bandit_games, bandit_players and bandit_events were created. '
                . 'Next: delete install.php from the server (this page does not delete itself), then open the game: <a href="./">Desert Bandit</a>.';
        }
    } catch (Exception $e) {
        bandit_row('Database connection or install', false, htmlspecialchars($e->getMessage()));
        $message = 'Fix config.php (or the database) and reload this page. Nothing was installed if a step failed before the tables were created.';
    }
} else {
    $message = 'Fix the items marked X and reload this page.';
}
?>
<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Desert Bandit installer</title>
<style>body{font-family:system-ui,sans-serif;background:#F4ECD8;color:#3A2A1E;max-width:640px;margin:2rem auto;padding:0 1rem}
td{padding:.3rem .6rem;border-bottom:1px solid #E8D7B4}.g{color:#5c7a3e}.b{color:#C3623B;font-weight:bold}
.msg{margin-top:1.5rem;padding:1rem;background:#fffaf0;border:2px solid #E9A23B;border-radius:12px}</style></head>
<body><h1>Desert Bandit installer</h1>
<table><?php foreach ($checks as $c): ?>
<tr><td class="<?php echo $c[1] ? 'g' : 'b'; ?>"><?php echo $c[1] ? 'OK' : 'X'; ?></td>
<td><?php echo $c[0]; ?></td><td><?php echo $c[2]; ?></td></tr>
<?php endforeach; ?></table>
<div class="msg"><?php echo $message; ?></div>
<p>This installer does not delete itself. Once the tables exist, delete <code>install.php</code> from the server by hand.</p>
</body></html>
