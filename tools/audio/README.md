# Radio voice lines: how to make them

Adapted from Desert Ranger's `tools/audio/` (its `docs/HANDOFF-CLAUDE-AUDIO.md`, sections 4 to 10, explains the method).
Run everything from the repo root. The heavy tools use the Desert Ranger audio working area's venvs and cached models.

| What | Where |
|---|---|
| Lines (final wording, `tts_text` is what the voice reads) | `docs/audio-lines.json` |
| Voices (the four Desert Ranger radio voices, unchanged) | `tools/audio/cast.json` |
| Respellings (a-z only, no hyphens) | `tools/audio/pronunciations.json` (check: `python3 tools/audio/pron.py --check`) |
| Venvs: `.venv-cb` Chatterbox (Py 3.11, MPS), `.venv-tts` Kokoro + faster-whisper (Py 3.12) | `~/Developer/desertranger-audio` (`VENVS=` to change) |
| Scratch: takes, QA, masters (gitignored) | `audio-work-bandit/` (`BANDIT_AUDIO_WORK=` to change) |
| Reference clips (Kokoro presets, already made; never a real person's voice) | `audio-work-bandit/refs` = symlink to `~/Developer/desertranger-audio/audio-work/refs` |
| Output (committed) | `desertbandit/audio/calls/<id>.mp3`, `desertbandit/audio/manifest.json`, `desertbandit/audio/review.html` |

## Steps
0. Once: `mkdir -p audio-work-bandit && ln -s ~/Developer/desertranger-audio/audio-work/refs audio-work-bandit/refs`
   and `bash tools/link-game-audio.sh` (links Desert Ranger's `radio/fx`, `radio/places`, `amb` into `desertbandit/audio/`, gitignored).
1. Generate and check, with the retake ladder: `NOMASTER=1 bash tools/audio/run_ids.sh [id,id,...]` (default: all lines).
   Pass 1 = seeds 1-3; failing ids get rung 1 (seeds 4-6), then rung 2 (seeds 7-9 with `--ex 0.6 --cfg 0.65`). Nine takes per line at most.
   It runs `gen_lines.py` (Chatterbox) and `qa_check.py` (Whisper `small.en`) one after the other: **never run the two models at the same time.**
   Leftover failures: `audio-work-bandit/fail-after-ladder-ids.txt`. For a clean retake of a line, move its old takes out of `audio-work-bandit/takes/<id>/` first.
2. Master: `python3 tools/audio/master.py [--ids ...]` (radio chain, -16 LUFS, true peak <= -1.5 dBTP, mono MP3 48 kbps 44.1 kHz, sped up at most 15 % to fit `max_sec`).
   Passing lines get `qa: "pending-ear"`; a line still failing gets `qa: "FAIL"` and a reason and no file.
3. Desert Ranger entries: `python3 tools/audio/import_dr_manifest.py` copies the fx, place-call and ambience entries verbatim into the manifest (checks their hashes).
   Check: `python3 tools/audio/verify_calls.py` re-measures every MP3 (ebur128 / ffprobe: loudness, true peak, format, length, manifest hash, 600 KB budget).
4. Review page: `python3 tools/audio/build_review.py` writes `desertbandit/audio/review.html` (self-contained; not deployed).
   The owner's Export gives `{"keep":[...],"redo":[...],"notes":{...}}`. Redo ids go back through step 1 (move their takes aside first), then 2 and 4.
   Lines the owner keeps: set their manifest `qa` to `"owner-approved"` (`master.py --ids ... --qa owner-approved`).

## Pass rule (`qa_check.py`)
Whisper's transcript is compared word by word with the line's `tts_text`: 0 errors for lines under 6 words, else up to 10 %; trimmed length 0.3 s to `max_sec` x 1.15; not near-silent.
Respelled words (Olla) must be heard as the word or its respelling with the right syllable count (Desert Ranger's strict gate).

## Changes from Desert Ranger's scripts
- Paths: `audio-work/` -> `audio-work-bandit/` (env `BANDIT_AUDIO_WORK`), output `desertbandit/audio/`, venvs from `~/Developer/desertranger-audio`.
- Lines are selected by `--ids` or `--moments` (no phases); the respelling table moved to `tools/audio/pronunciations.json`.
- `gen_lines.py`: one reference per voice, no `--alt` / `--pron` / `--pron-alt` (voices are fixed; respellings always apply).
- `qa_check.py`: reference text is `tts_text`; a compound Whisper splits or joins ("screen shot", "goalcard") counts as the same word
  (also in `word_lead.py`'s first-word check); among passing takes, one that also passes Whisper's unprompted pass is preferred
  (Desert Ranger's second, hinted pass can hide a slurred first word: "poll six" for "All six").
- `verify_calls.py`, `review_test.js` (Playwright, Chrome Canary: `node tools/audio/review_test.js [playwright-core path] [shots dir]`): new.
- `master.py`: radio chain only, no `--fx` (the fx come from Desert Ranger); file `calls/<id>.mp3`, kind `call` or `card`;
  aims 60 ms under `max_sec` to leave room for MP3 padding; FAIL lines are not encoded.
- `build_review.py`: new page (moments, on-air playback, Keep / Redo, Export JSON).
- `word_metrics.py`, `word_lead.py`: copied (qa_check imports them for lines with respelled words); only the compound split above is new.
