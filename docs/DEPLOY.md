# Deploy Desert Bandit to the client's Network Solutions host: runbook

Desert Bandit goes beside Desert Ranger on the same host, in its own folder, using the same database with its own tables. This follows
Desert Ranger's runbook (`docs/DEPLOY-NS.md` in that repo) with the same rules: the person at the keyboard types every credential; nobody pastes them into chat, a ticket or the repo,
and nothing is uploaded from a Claude session. Claude builds the folder and the checker; the owner uploads.

## What we know about the host (from Desert Ranger's deploy, Oct 2026)
- Debian, **PHP 7.4.10**, **MySQL 5.7.44**, **SFTP on port 2222**. A shared account: other folders under `htdocs` are other websites.
- Desert Bandit lives in **`htdocs/desertbandit/`**, a new folder. **`htdocs/desertranger/` is not touched.**
- A cache sits in front of the site (static files about 4 hours). `api.php` sends `no-store`; HTML and JSON are set to re-check; scripts use `?v=` numbers.
- A PHP file that does not exist answers **500**, not 404, on this host.
- HTTPS is already on for the site's address.

## What is different from Desert Ranger
- **Same database, new tables.** The install creates only `bandit_games`, `bandit_players` and `bandit_events`. It refuses to run if `bandit_games` already exists, and it never reads or changes Desert Ranger's `games`, `players` or `events`.
- **Same database login.** `config.php` uses the same host, database, user and password as Desert Ranger's server `config.php` (the user already has rights on that database). Copy the values by hand from your password manager or from Desert Ranger's `config.php`; do not paste them anywhere else.
- Sounds are made in the browser, so there are no audio files to upload in Wave 1.

## Steps
1. **Create the folder.** In `htdocs`, create `desertbandit` (only if it does not exist yet; if it does, stop and tell us).
2. **Build the upload folder** on the lab Mac clone (on `main`, with the art linked: `bash tools/link-game-art.sh`):
   `bash dev/make-deploy-folder.sh` makes `deploy/desertbandit/` and `deploy/DEPLOY-MANIFEST.txt`. It copies the linked art as real files, never copies `config.php` or markdown, checks PHP syntax, and warns about anything missing.
3. **Create `config.php` locally**, inside `deploy/desertbandit/` only: copy `config.sample.php` to `config.php` and fill in the same host, port (3306), database, user and password as Desert Ranger, leave `db_socket` empty and `'debug' => false`. It is never committed.
4. **Upload.** In Cyberduck (SFTP, port 2222), drag the **`desertbandit` folder itself** (from `deploy/`) onto `htdocs`. Dragging the folder, not its contents, takes the hidden `.htaccess` along. If Cyberduck asks about existing files choose **Skip**. Check the server's `desertbandit` folder shows `.htaccess` (View, Show Hidden Files) and that the file count matches the manifest (plus `config.php`).
5. **Install.** Open `https://YOURDOMAIN/desertbandit/install.php` once. It checks PHP, the driver, `config.php` and the database, then creates the three tables. Then **delete `install.php` from the server**.
6. **Check it.** `bash dev/verify-deploy.sh https://YOURDOMAIN/desertbandit` reads pages only (no game created). Fix every FAIL. Once, also run it with `--full`: it plays whole games through the live API (needs `php` on the Mac) and leaves finished test rooms (step 8). Say before running `--full`: it creates rooms in the live database.
7. **Play it.** Two phones: create a room, join with the code, play a few turns; try "Play solo" (you and two computers); try Skip turn and Sit out as host. iPhone: silent switch off for sound.
8. **Clean up.** Remove test rooms with `dev/cleanup-test-rooms.sql` (preview first). Confirm `install.php` is gone and `debug` is false.

## If something fails
| Symptom | Likely cause and fix |
|---|---|
| 500 on every page, static files too | The host rejects a directive in `.htaccess` (most likely `Options -Indexes`). On the server, comment out that line and retry. If still 500, use the fallback below. |
| 500 only on `.php` addresses | A missing PHP file also gives 500, so first check it was uploaded. If it is there: a PHP error or a bad `config.php`; set `'debug' => true` briefly. |
| `api.php?a=time` works, `a=stats` says "Server error." | Database login or host wrong, install not run, or the user lacks rights. Set `'debug' => true` briefly, read the message, then set it back to false. |
| install.php says "Already installed" | `bandit_games` exists: the tables are already there. Delete `install.php`. |
| Reel pictures missing or blank | `.svg` is not served as `image/svg+xml` (the `.htaccess` AddType was blocked): `verify-deploy.sh` says so; ask the host to allow it. |
| Game state looks frozen or stale | A cache is answering instead of PHP: `verify-deploy.sh` fails the two-calls test or shows an `Age` header. Ask the host to exclude `api.php` from caching. |
| Old files after an update | The host caches static files for hours. Hard-refresh; if `index.html` still lags, the verify script's caching lines show the cache time. |
| Polling errors or "too many connections" | Shared MySQL connection limit shared with Desert Ranger. Ask the host for `max_user_connections`. |

Fallback `.htaccess` (only if the full one gives a 500; keeps the secrets blocked):
```
DirectoryIndex index.html
AddType image/svg+xml .svg
<FilesMatch "^(config\.php|config\.sample\.php|.*\.sql|.*\.md)$">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</FilesMatch>
```

## Roll back
Delete `htdocs/desertbandit/` and drop the three tables (in phpMyAdmin, the SQL tab):
`DROP TABLE bandit_events, bandit_players, bandit_games;`
Desert Ranger and its tables are untouched.

## Updating later
Rebuild `deploy/`, upload changed files only (Cyberduck compare/sync), and never overwrite the server's `config.php`.
