# Desert Bandit: design

A six-reel slot-machine race game for 2-4 players, played in online rooms like Desert Ranger, in the look of the old paper board (Anza-Borrego Desert State Park).
It follows the rules of play of *One Arm Battle* (see `~/Developer/one-arm-battle-rights/DETERMINATION.md`). Rules are mechanics; everything else here
(code, art use, text, sounds) is new. Play money only.

## Decisions (owner, Oct 6, 2026)
| Question | Decision |
|---|---|
| Players | Online rooms with a room code, 2-4 seats, any seat can be a computer, solo demo vs computers, host controls (Remove, Skip turn, Sit out) |
| Pay table | Our own, tuned by `tools/simulate.py` |
| Goal cards | Same six mechanics and odds, renamed after board squares |
| Money | Dollars; host picks the victory total, $2,500 to $15,000, default $5,000 |
| Symbols | Six hand-drawn doodle icons from the board |
| Race display | Rig pieces drive the paper board as banks grow toward the total |
| Story | The Desert Ranger rangers (R273, dispatch) chase the Bandit's loot; the machine is the bandit |
| Sound | Machine sounds plus radio lines (new wording from DETERMINATION.md, including its "meme-fresh" column) |
| Computers | One tuned sensible strategy (the exact best policy from the simulator) |
| Repo | New repo (CosmicCEO/desertbandit, private) |
| Database | Same MySQL database as Desert Ranger, new `bandit_` tables, `install.php` run once then deleted |
| Fonts | Reuse Desert Ranger's fonts |
| Art | Board art is Jeffery Price's hand-drawn work, rights reserved by Jerod Price; reuse for this client confirmed |
| One Arm Battle credit | None in the game's About page (it stays in `docs/`) |
| Goal-card names, icons | Agreed as proposed (final icon pick in the Wave 0 review page) |

## Rules
1. Each turn the player draws a **goal card** (odds below).
2. They roll the free reels (six at the start). The server rolls, so players cannot influence the result.
3. They **lock** the scoring reels they want; at least one scoring group must be locked. Locked reels stay locked and add to the turn's **stake**.
4. Then they either **bank** (the stake is added to their total, the turn ends) or **roll the free reels again**.
5. **Bust:** a roll with no scoring reel loses the whole unbanked stake and ends the turn.
6. **Sweep:** locking the last free reel gives six fresh free reels (stake kept).
7. The first player whose banked total reaches the victory total wins at once.

## Symbols and scoring
Six symbols; every reel shows each symbol with equal chance, independently. They are: Olla, Star, Water Drop, Sheep, Palm, Wrench.

| Group | Value |
|---|---|
| A lone Olla | $100 |
| A lone Star | $50 |
| Three of a kind | Olla $1,000, Star $600, Water Drop $500, Sheep $400, Palm $300, Wrench $200 |
| Four / five / six of a kind | the three-of-a-kind value x2 / x3 / x4 |
| Supersweep: one of each symbol on six reels | $1,500 |

Only the groups above score. A player may lock part of a larger set (for example three of four) when that is better.

## Goal cards
| Mechanic (original) | Card | Odds | Rule | Sim EV per turn |
|---|---|---|---|---|
| Sweep Bonus | Found an Olla | 56% | A sweep pays a bonus of $300, $400 or $500 (small, medium or large olla) | $550 |
| Out of Order | Vehicle Breaks Down | 11% | The turn is skipped | $0 |
| Grand Force | Ground Fire Report | 11% | You cannot bank under $1,000; a bank at $1,000 or more pays $500 extra | $525 |
| Bop Till Ya Drop | Off-Road Bust | 11% | No banking: you roll until a sweep or a bust; a sweep ends the turn and pays twice the stake plus $300 | $521 |
| Revenge | Subpoena | 7% | A normal turn; a bank also takes $100 from the leader (nothing if you lead) | $591 |
| Double or Nothing | Reports Overdue | 4% | You can bank only after two sweeps; a bank pays twice the stake plus $2,000; any bust pays nothing | $470 |

The odds are the 1.5.1 documentation's percentages (they add to 100).

## Tuning results (`python3 tools/simulate.py`, seed 1, 40,000 sampled turns per card)
- Bust chance of one roll by free reels, 1 to 6: 66.7%, 44.4%, 27.8%, 15.7%, 7.7%, 3.1%.
- Mean payout per turn across the deck: $483 (the Out of Order card counts as 0).
- Cards are balanced to $470-$590 per turn so no card is a trap, except the skip card, which is the one deliberate bad draw.
- A game to $5,000: about 9.3 / 8.1 / 7.3 turns each for 2 / 3 / 4 players, roughly 10 / 13 / 15 minutes at 12 seconds per roll cycle. $2,500 is a short game, $10,000 and $15,000 are long ones (shown as such in the lobby).
- All numbers are proposals until the client has played them; change the PAY block in `tools/simulate.py`, rerun, and update this table.

## Computer player
The simulator solves every card exactly (dynamic programming over free reels, unbanked stake and card state in $50 steps) and plays the best policy: which reels to lock and when to bank. The
server's computer seat uses the same policy (ported to PHP in Wave 1 as a lookup table generated from the simulator, so the live host does no heavy computing). Race-aware tweaks (a trailing computer takes more risk) are a later option.

## Race map
Reuses the Desert Ranger board image and its 52 square positions (`board/desert-ranger.json`). A player's piece stands on square `floor(bank / target x 51)`; squares are scenery. When a piece crosses onto a named square the
radio can call the place name (existing place clips). The 8 rig pictures are the pieces; this game seats up to 4.

## Originality (from DETERMINATION.md)
Used from the original: the rules of play only (six reels, locking, lost stake, goal-card odds, 2-4 players with computer seats, race to a total). Not used: its code, graphics, menu or help text, sounds, the "I LIKE IT!" cue or any film audio,
and its goal-card names. All lines spoken in this game are new wording.

## Out of scope for now
Accounts and saved games, real money, automatic skipping of stalled players, a leaderboard, the Marigold light bar, any change to the live `/desertranger/` folder.
