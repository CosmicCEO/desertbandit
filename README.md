# Desert Bandit

A six-reel slot-machine race game for 2 to 4 players (any seat can be a computer), played in online rooms on phones, in the paper look of the Desert Ranger board
(Anza-Borrego Desert State Park). Each turn draws a goal card, you roll six reels, keep the ones that score, then roll the rest or bank. First to the victory total wins.
Play money only. It is a sibling of [Desert Ranger](https://github.com/CosmicCEO/anza-borrego-challenge): plain PHP 7.4 + MySQL 5.7 + vanilla JavaScript, no build step.

## What is where
| Path | What |
|---|---|
| `desertbandit/` | the deployable folder (uploaded as `htdocs/desertbandit/`): `index.html`, `api.php`, `install.php`, `lib/` (rules engine, computer player, server), `assets/` |
| `docs/DESIGN.md` | the rules, pay table, goal cards, tuning results |
| `docs/WAVE1.md` | the build contract: API, state and events, schema, client and sound |
| `docs/DEPLOY.md` | upload and install runbook for the host (the owner does the upload) |
| `design/creatures/` | the 16 original creature drawings, the picker page builder, provenance |
| `design/pitch/` | the pitch sheet generator (`bash design/pitch/make.sh`, PNG only) |
| `tools/simulate.py` | pay-table simulator; `tools/gen_policy.py` writes the computer player's table |
| `tests/` | rules and computer-player tests, HTTP game tests, shared vectors |
| `dev/` | deploy-folder builder, live-site checker, local MySQL, browser tests |

## Tests
```
php tests/rules_test.php                       # engine and computer player: PHP 7.4 and 8.x, no database
python3 tools/gen_policy.py --check            # the computer player's table is up to date
bash dev/local-mysql.sh                        # scratch MySQL 5.7 on 127.0.0.1:8890 for local server tests
```
Server and browser tests are described in `docs/WAVE1.md`. Binary art (fonts, rig pictures) is not in git: `bash tools/link-game-art.sh` links it from a Desert Ranger checkout.

## Rights
The board art and its doodles are Jeffery Price's hand-drawn work (all rights reserved by Jerod Price). The six creature drawings are original to this game.
The rules of play follow the 1990 game *One Arm Battle* (rules only; none of its code, art, text or sounds are used), see `docs/DESIGN.md`.
