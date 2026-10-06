# Desert Bandit, Wave 2: radio voices, place calls and the desert bed (build contract)

Wave 1 is live-ready (`docs/WAVE1.md`): the game plays, with sounds synthesized in the browser. Wave 2 adds the voices of the rangers on the radio, the place-name calls as rigs
cross the board, and the desert bed under the lobby and the game. It follows Desert Ranger's audio pipeline (`~/Developer/desertranger`, and the working area
`~/Developer/desertranger-audio` with the venvs and models). Two builders work from this file: **production** (make the clips) and **playback** (the client plays them).

## What the player hears
1. **Result calls** (new wording, `docs/audio-lines.json`): 42 lines in 12 moments, each with plain variants a and b and, for ten of them, a meme-fresh variant c. Four radio voices:
   dispatch, senior_ranger, ranger_273, r55 (the Desert Ranger cast, same references, same radio treatment: click, voice over hiss, squelch).
2. **Place-name calls**: when a bank carries a rig onto a different board square, a ranger calls the place (`pl-sr-NN` / `pl-r273-NN`, 104 clips already made for Desert Ranger, one per square 00..51).
3. **Desert bed and critters** under the lobby and the game (Desert Ranger's `amb-bed-01` loop and the CC0 critters), local to each phone, never synchronized.
4. The Wave 1 synthesized sounds stay (reel tick, stop, clink, coin, bell, buzz, fanfare); voices sit on top and duck the bed.
All new wording only: no sampled game, film or meme audio (see `docs/DESIGN.md`, "Originality"). Nothing here is the original game's text.

## Which line plays (deterministic on every phone)
The server stamps every event of one action with one `playAt`; the client lays the action's events on a timeline (durations in `docs/WAVE1.md`) and may start **at most one result call** per
action plus the **card call**. Every phone must pick the same clip from the same inputs, with no randomness: `v(ev)` below uses the triggering event's `id`.
```
variant(ev) = (ev.id % 4 == 0 && the moment has a 'c' line) ? 'c' : (ev.id % 2 == 0 ? 'a' : 'b')
```
Result call priority, highest first; the first match in the action wins and the rest of the action's result calls are dropped:
| # | Trigger (events of the action) | Moment | Starts at |
|---|---|---|---|
| 1 | `win` | win | `win` event start + 400 ms |
| 2 | `lock` with `points == 1500` and `picks.length == 6` | supersweep | after that `lock` (+450 ms) |
| 3 | `bank` with `via == "offroad"` | offroad | `bank` start + 500 ms |
| 4 | `bank` while the card is `overdue` | overdue | `bank` start + 500 ms |
| 5 | `bank` while the card is `fire` | fire | `bank` start + 500 ms |
| 6 | `bank` with `steal != null` | subpoena | `bank` start + 500 ms |
| 7 | `sweep` (not offroad) | sweep | `sweep` start + 300 ms |
| 8 | `broken` | broken | `broken` start + 200 ms |
| 9 | `bust` | bust | `bust` start + 300 ms |
| 10 | `lock` with `points >= 500`, only when `ev.id % 3 == 0` | lock | `lock` start + 100 ms |
| 11 | `bank` with `amount >= 1500` | bigbank (variants a, b only) | `bank` start + 500 ms |
| 12 | `bank` where the player's rig moves to a different square, `sq = floor(bank / target * 51)` (cap 51), before vs after | place call `pl-<sr or r273>-<NN>`, voice by `ev.id % 2` | `bank` start + 600 ms |
The card in force for a `bank` is the card of the last `turn` event the client has seen (a `turn` event carries `card`).
**Card call**: on a `turn` event whose card is not `broken`: `card-<card>-<a|b>` (dispatch), variant `ev.id % 2 == 0 ? 'a' : 'b'`; for the `sweep` card only when `ev.id % 9 == 0`
(it is 56% of turns, so it would nag). It starts at that `turn` event's start + 150 ms. A call that would overlap another voice already scheduled, or that the clip is not loaded for in time, is skipped.
Radio treatment at runtime follows `desertranger/assets/js/radio.js`: click, voice 0.1 s later over the looped hiss (gain 0.5), squelch at the end, all on the voice bus; the bed ducks -12 dB while voices play.
The place calls and result calls use the radio treatment; the voice lines' own radio chain is already baked into the MP3 (as in Desert Ranger), the click, squelch and hiss are separate clips.

## Files
```
desertbandit/audio/
  manifest.json           {"version":1,"clips":{id:{character,text,kind,treatment,qa,lufs,tp,file,sec,bytes,v}}}   (the Desert Ranger format; committed)
  calls/<id>.mp3          the 42 new voice lines (committed; mono MP3, 48 kbps, 44.1 kHz)
  radio/fx/ radio/places/ amb/    Desert Ranger's click, squelch, hiss, the 104 place calls, the bed and critters (NOT committed:
                          linked by tools/link-game-audio.sh like the fonts; the deploy script copies real files)
  CREDITS.md              Chatterbox (MIT; Perth watermark), the CC0 critters with their sources, original synthesized beds
  review.html             self-contained page for the owner to listen and mark Keep / Redo (written by production; not deployed)
docs/audio-lines.json     the lines (done, this PR)
tools/audio/              the production scripts adapted from Desert Ranger (paths for this repo)
```
`manifest.json` entries use `qa`: `"pass"` (speech check passed), `"pending-ear"` (made, not yet heard by the owner), `"owner-approved"`, or `"redo"`. The game plays any clip present in the manifest.

## Production (builder 1)
- Work in the Desert Ranger audio working area (`~/Developer/desertranger-audio`: `.venv-cb` Chatterbox, `.venv-tts` Kokoro and Whisper, `audio-work/refs` for the four voices, models cached). **One heavy model at a time** (never Chatterbox and Whisper together). Copy and adapt the scripts to this repo
  (`gen_lines.py`, `qa_check.py`, `master.py`, `pron.py`, `build_review.py`; cast from `tools/audio/cast.json`; do not change the voices) with paths: lines `docs/audio-lines.json`, work area `audio-work-bandit/` (gitignored, may live under the audio working area), output `desertbandit/audio/`.
- Respellings and rules from Desert Ranger apply (letters a-z only, no hyphens; numbers spelled out in `tts_text`). The ladder: pass 1 (3 seeds), rung 1 (seeds 4 to 6), rung 2 (7 to 9 with ex 0.6, cfg 0.65). Loudness -16 LUFS, true peak at most -1.5 dBTP, radio chain as Desert Ranger.
  Keep each clip within `max_sec`. Every line must pass the word check (0 errors for lines under 6 words, else up to 10%); if a line cannot pass after the ladder, mark `qa: "FAIL"` with the reason and report it rather than shipping a garbled line.
- `tools/link-game-audio.sh` links `radio/fx`, `radio/places` (104) and `amb` from the Desert Ranger checkout into `desertbandit/audio/` (gitignored), and the manifest includes those clips' entries (copied from Desert Ranger's manifest with their hashes).
- `audio/review.html` (self-contained, audio embedded as data URIs, phone friendly): every new line with a play button, its character, the text, what Whisper heard, and Keep / Redo buttons and a note box, saved in `localStorage`, with "Export" that produces JSON listing the ids to redo. Group by moment. Add a "play a sample action" button per moment (click, voice, squelch over the hiss) so the owner hears it as in the game.
- Budget: new clips under 600 KB in total.

## Playback (builder 2)
- `assets/js/radio.js` (new; model on Desert Ranger's): `pickCall(events, ctx)` is a **pure function** with the rules above, exported for Node tests (`module.exports`), plus the scheduling on the Wave 1 `Sound.at` and the ducking.
  Clips load lazily from `audio/manifest.json` with `?v=<hash>`; a missing clip is silence, never an error. Tier A (fx and the first calls) loads at the unlock tap; the rest preloads once the game is active and radio is on.
- `assets/js/ambience.js` (new; model on Desert Ranger's): bed loop with an equal-power crossfade, critters at random (local only), starts at the unlock tap in the lobby and the game, restarts after an audio interruption.
- The sound panel (from the existing ♪ button): master mute, radio on/off, desert sounds on/off with a volume slider, a Test sound button. `localStorage`: `bandit_muted`, `bandit_radio_on` (default 1), `bandit_amb_on` (1), `bandit_amb_vol` (20), `bandit_game_vol` (50).
- Tests: `tests/radio_pick_test.js` (Node, the pure rules: every priority row, the card call, variant by `ev.id`, no result call when the action has none, identical output for the same input) and an extension of `dev/e2e/browser_test.js`: with the real `manifest.json` (and silent placeholder MP3s made with ffmpeg where the real ones are absent) check calls are scheduled on the shared clock at the same server time on both phones, radio off silences calls, mute silences everything, no console errors, no 4xx/5xx for missing clips (a missing clip must not request a 404: skip clips absent from the manifest).
- Update `dev/verify-deploy.sh` (audio folder, manifest, mp3 MIME type `audio/mpeg`) and `.htaccess` (`AddType audio/mpeg .mp3`, cache), `dev/make-deploy-folder.sh` (copies the linked audio as real files, warns when a place call or the bed is missing), `docs/DEPLOY.md` (the audio folder is part of the upload), and `about.html` credits line for the sounds.

## Checks before it ships
Production: speech check on every new line, loudness and size budgets, the review page built; the owner listens and exports Redo ids; redo lines go back through the ladder. Playback: Node and browser tests pass, no console errors, the 390 px screens unchanged.
Nothing is uploaded from a Claude session; the owner uploads.
