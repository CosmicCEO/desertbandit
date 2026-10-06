# Desert Bandit, Wave 1: the playable game (build contract)

The shared contract for the server and the client. The rules engine (`desertbandit/lib/rules.php`) and the computer player
(`desertbandit/lib/bot.php`) are done and tested (`php tests/rules_test.php`, 2,227 checks, PHP 7.4 and 8.3). Rules and numbers: `docs/DESIGN.md`.
Everything copies the Desert Ranger pattern (`~/Developer/desertranger`, read-only reference): PHP 7.4, MySQL 5.7, polling, plain ES5, no build step.

## Repository layout
```
desertbandit/            the deployable folder, uploaded as htdocs/desertbandit/
  index.html about.html api.php install.php config.sample.php .htaccess
  lib/    rules.php bot.php policy.json   (done)    game.php db.php schema.sql   (server)
  assets/ js/ css/ fonts/ img/ ...                  (client; fonts and board art are gitignored, see "Assets")
  board/desert-ranger.json                          (copy of the Desert Ranger master, committed)
tests/   rules_test.php, vectors/scoring.json (done), HTTP and browser tests (server, client)
dev/     verify-deploy.sh, make-deploy-folder.sh, e2e/, local scripts
docs/    DESIGN.md, WAVE1.md (this file), DEPLOY.md
tools/   simulate.py, gen_policy.py, link-*.sh
```
Local dev: PHP 7.4.33 and 8.3.30 at `/Applications/MAMP/bin/php/php<ver>/bin/php`; scratch MySQL 5.7.44 at `127.0.0.1:8890`, user `root`, no password,
database `desertbandit_dev` (started by `dev/local-mysql.sh`). `php -S 127.0.0.1:8899 -t desertbandit` serves the app for dev (it ignores `.htaccess`).
Use `127.0.0.1`, never `localhost`, with a port. Local `desertbandit/config.php` (gitignored) points at that database; never commit it.

## Game flow (what the engine does)
1. A turn starts by dealing a goal card (`sweep` 56%, `broken` 11%, `fire` 11%, `offroad` 11%, `subpoena` 7%, `overdue` 4%). `broken` skips the turn by itself.
2. `phase: "start"`: the player taps ROLL (`roll` with no picks). All six reels roll. No scoring reel is a bust: the stake is lost and the next turn begins.
3. `phase: "rolled"`: the player picks the reels to keep (tap to hold; every kept reel must score, see `scoreSelection`), then either ROLL (keep them and roll the
   rest) or BANK (keep them and bank). Keeping all six is a sweep: six fresh reels. Picks are required after every roll.
4. Banking adds the stake (card rules: `bankAmount`) to the player's bank. The first bank at or above the target wins at once.
The server rolls (`random_int`), so players cannot influence results. Reel symbols are numbers 0..5:
0 bighorn sheep, 1 Gambel's quail, 2 giant desert hairy scorpion, 3 ocotillo, 4 chuckwalla, 5 sidewinder (art: `design/creatures/svg/`, the six picked are copied to `desertbandit/assets/img/reels/<n>.svg`).

## HTTP API (`desertbandit/api.php`, `?a=<action>`)
Same shape as Desert Ranger: JSON in and out, `Cache-Control: no-store`, every response (except `a=time`) carries `serverNow` (ms). `a=time` answers before
any include or DB: `{"ok":true,"t":<ms>}`. Failure is `{"ok":false,"error":"...","serverNow":...}` with status 400 (bad input), 403 (not host / not seated),
404 (no such game or action), 405 (not POST), 409 (rule refused, stale turn, game full or started), 415 (POST without `application/json`), 429, 500.

Identity: `create` and `join` return a random seat `token`; the DB stores only its sha256. The client sends it as `X-Player-Token` (kept in `localStorage`
as `bandit_token_<CODE>`); fallback cookie `bandit_<CODE>` (httponly, SameSite=Lax). Spectators send no token and see `meId: null`.

| Action | Method | Body / query | Notes |
|---|---|---|---|
| `time` | GET | | clock sample |
| `info` | GET | | `{vehicles:{key:label}, targets:[2500,...,15000], minPlayers:2, maxPlayers:4}` |
| `stats` | GET | | `{games:n}` (live games) |
| `peek` | GET | `code` | `{code, status, taken:[vehicle keys], players:n}` for the join form |
| `state` | GET | `code`, `since` | the poll, below |
| `create` | POST | `{name, vehicle}` | room code is 4 letters (no I or O); the creator is the host, seat 0; returns `{code, token}` |
| `join` | POST | `{code, name, vehicle}` | first free seat (not `count`); 409 if started, full, or vehicle taken |
| `setup` | POST | `{code, target}` | host, lobby only: sets the victory total (2,500 to 15,000 in steps of 500; default 5,000) |
| `addbot` | POST | `{code}` | host, lobby only: adds a computer seat (name "Rival 1".., a free vehicle); no token |
| `remove` | POST | `{code, playerId}` | host, lobby only: removes a human or computer seat, renumbers seats with `ORDER BY seat`, never the host |
| `start` | POST | `{code}` | host; needs 2 to 4 players (computers count); makes the engine state, deals the first card |
| `roll` | POST | `{code, turn, key, picks?}` | the player on turn; `picks` is a list of reel positions 0..5 (empty at the start of a turn) |
| `bank` | POST | `{code, turn, key, picks}` | the player on turn |
| `botstep` | POST | `{code, turn, key}` | any seated human: plays ONE computer move (`BanditBot::decide`) when the player on turn is a computer; else 409 |
| `skip` | POST | `{code, turn}` | host, active game: the player on turn loses the stake and the next player starts |
| `sitout` | POST | `{code, playerId, on}` | host, active game: pass over an away player (`out`); never the last one in |
| `rematch` | POST | `{code}` | host, finished game: back to the lobby with the same players, tokens and target |

Action responses: `{"ok":true}` or `{"ok":true,"duplicate":true}`. Every state-changing action runs in one transaction with the game row locked `FOR UPDATE`.
Two layers against double taps: `turn` must equal `games.turn_number` (else 409 "That turn already happened.") and a repeated `key` (random per tap, sanitized to 64 chars,
stored in `games.last_action_key`) returns `duplicate` without acting. A rule refusal (`BanditRuleError`) is 409 with the engine's message.

### `GET ?a=state&code=ABCD&since=N`
```
{ ok, serverNow, meId,                       // meId: your player id or null
  game: { code, status: "lobby"|"active"|"finished", target, turn, hostId, currentId, winnerId,
          card: null | {key, name, text},     // the goal card of the current turn
          phase: "start"|"rolled",            // meaningful while active
          reels: [6 x 0..5|null], locked: [6 x bool], scoring: [6 x bool],   // scoring = which free reels can be kept right now
          stake, sweeps },
  players: [ {id, name, vehicle, seat, bank, out, bot} ],     // ordered by seat
  events: [ {id, type, msg, data, playAt} ] }                  // events with id > since, at most 200
```
With `since=0` the poll returns only the last 40 events and clients must not animate or play those. `lobby` states carry no card or reels.
`last_seen_at` is touched at most every 20 s.

### Events (`data` is the engine event without `type`; `msg` is the engine's plain-English line)
`turn {playerId, card}`, `broken {playerId}`, `roll {playerId, reels, rolled:[positions], scoring}`, `lock {playerId, picks, points, stake}`,
`sweep {playerId, bonus, sweeps}`, `bust {playerId, lost}`, `bank {playerId, amount, stake, via:"bank"|"offroad", steal:null|{fromId,amount}, bank}`,
`win {playerId, bank}`, `skip {playerId, lost}`, `sitout {playerId}`, `back {playerId}`; and from the server: `join {playerId}`, `leave`, `start`, `rematch`.
All events of one action share one `playAt`: `T = serverNow + config.cue_lead_ms` (default 1500 ms). Each device starts that action's animations at `T` on its own clock
(offset from `a=time` and every poll, exactly as Desert Ranger's `sync.js`) and plays the action's events in order, each with a fixed duration, so all devices stay together:
`roll` 2,800 ms (spin 1,000 ms then the reels stop one by one, 360 ms apart), `lock` 450, `sweep` 1,400, `bust` 1,500, `bank` 1,700, `turn` 900, `win` 3,000, others 0.
Players cannot act, and the host's browser does not call `botstep`, until the local animations of the newest action are done.

## Computer seats
Rows in `bandit_players` with `is_bot = 1` and `token_hash` NULL. The host's browser (any seated human's, in fact) drives them: when `game.currentId` is a bot and nothing is animating,
wait 1.4 to 2.6 s, then `POST botstep {code, turn, key}`. The server computes the move with `BanditBot::decide` and applies it with the same engine call a human would use.
A stalled game (no browser open) is moved on with Skip turn. Solo play is "create, add 1 to 3 computers, start" (the client has a one-tap "Play solo" for it).

## Database (new tables only, `bandit_` prefix, utf8mb4, InnoDB, no JSON columns)
Statements in `lib/schema.sql` are separated by a line containing only `;`; `install.php` splits on that and strips `--` comment lines. It refuses to run when `bandit_games` exists
(so it cannot wipe a live game) and does not delete itself: the owner deletes it from the server by hand (`verify-deploy.sh` warns while it answers 200).
```
bandit_games   id, code CHAR(4) UNIQUE, status VARCHAR(10), host_player_id, target INT, turn_number INT, state_json TEXT (the engine state, null in the lobby),
               winner_player_id, last_action_key VARCHAR(64), created_at, updated_at
bandit_players id, game_id FK ON DELETE CASCADE, seat, display_name, vehicle, token_hash CHAR(64) UNIQUE NULL, is_bot TINYINT, bank INT, out_flag TINYINT,
               joined_at, last_seen_at;   UNIQUE (game_id, seat), UNIQUE (game_id, vehicle)
bandit_events  id BIGINT, game_id FK ON DELETE CASCADE, turn_number, type, message VARCHAR(500), payload TEXT (json), play_at_ms BIGINT NULL, created_at;  INDEX (game_id, id)
```
`state_json` is the authority; `bandit_players.bank` and `out_flag` mirror it after every action. Config is `config.php` (gitignored, never copied by the deploy script):
`db_host, db_port, db_socket, db_name, db_user, db_pass, cue_lead_ms (1500), debug (false)`. `config.sample.php` is committed.

## Client (plain ES5, one page, three screens)
`index.html` with `#sound-bar` (in flow, never fixed), home / lobby / game sections, scripts loaded in order with `?v=N`: `sync.js`, `sound.js`, `race.js`, `app.js`.
- Home: name, room code, vehicle picker (8 rigs from `assets/img/pieces/`), Join, Create, and "Play solo" (create + 2 computers + start). `?g=CODE` joins from a link.
- Lobby: room code, the players (host controls: Remove), victory total picker (host), Add computer, Start; shows the expected game length.
- Game: the phone screen of the pitch mock-up (`design/pitch/build.py`, the "look" page): race strip with the rigs (position = bank / target), goal card,
  the cardboard cabinet with six paper-strip windows (two rows of three), stake, ROLL and BANK buttons, scoreboard, event log, host controls (Skip turn, Sit out).
  Tap a scoring reel to hold it (HELD label); the stake line shows the points of the selection; ROLL shows how many reels will roll; BANK shows what it would pay (greyed with the
  card's reason when the card forbids it). Game over: winner banner, "Play again" (host), "New game".
- Paper look: kraft cardboard, tape, torn paper strips, soft shadows; every paper effect is CSS or inline SVG (no extra image files except the six reel faces and the Desert Ranger rigs and fonts).
- Sound: synthesized in the browser with Web Audio (no audio files): reel tick, reel stop thump, held clink, coin chimes for a bank, bell for a sweep, buzz for a bust, fanfare for a win.
  Scheduled on the shared clock (`Sound.at`). The in-flow sound bar resumes a suspended audio context with one tap (iOS). Mute and volume in `localStorage`. Radio voice lines are Wave 2.
- Scoring in the browser (`scoreSelection`, `scoringReels`, `bankAmount`) is a port of `rules.php`; `tests/vectors/scoring.json` (written by the PHP tests) must pass in the browser tests.
- Mobile first: 390 px wide, 16 px gutters, no horizontal scroll, tap targets at least 44 px.

## Assets
Binary art is not committed (as in Desert Ranger): `tools/link-game-art.sh` symlinks fonts (Bungee, Nunito, Caveat, Bangers), the board image and the rig pieces from `~/Developer/desertranger`
into `desertbandit/assets/` (gitignored); the deploy script copies real files. Committed: `assets/img/reels/*.svg` (original drawings), `board/desert-ranger.json`, all code and CSS.

## Tests and checks
`php tests/rules_test.php` (done); `php tests/http_game.php <base>` plays full games over HTTP (several players, computers, double-tap race, host controls, stale turns, wrong tokens);
a Playwright browser test against the real server (`dev/e2e/`); `dev/verify-deploy.sh <base> [--full]`; `dev/make-deploy-folder.sh`. PHP 7.4 and 8.3, MySQL 5.7.
The owner uploads the deploy folder and runs `install.php` himself; nothing is deployed from this session.
