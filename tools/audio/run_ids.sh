#!/usr/bin/env bash
# Retake ladder for a list of line ids (Desert Bandit; adapted from Desert Ranger's run_ids.sh).
# usage: bash tools/audio/run_ids.sh [id,id,...]     (default: every line in docs/audio-lines.json)
# Env: VENVS=<dir holding .venv-cb and .venv-tts> (default ~/Developer/desertranger-audio), BANDIT_AUDIO_WORK (default audio-work-bandit),
#      FAST="--ex 0.6 --cfg 0.65" (rung 2 settings), NOMASTER=1 to skip mastering.
# One heavy model at a time: generation, then Whisper, never together. Resumable (existing takes are skipped).
# MOVE old takes of these ids out of <work>/takes/ first if you want a clean retake: qa_check picks the best passing take across ALL takes.
#   pass 1 : 3 takes (seeds 1-3)                      -> QA
#   rung 1 : FAIL ids, 3 more seeds (4-6)             -> QA
#   rung 2 : FAIL ids, seeds 7-9, faster pacing       -> QA      (9 takes per line is the cap)
# Then master.py for the ids. Leftover failures: <work>/fail-after-ladder-ids.txt (master.py marks them qa "FAIL" and ships no file).
set -u
cd "$(dirname "$0")/../.."
VENVS="${VENVS:-$HOME/Developer/desertranger-audio}"
WORK="${BANDIT_AUDIO_WORK:-audio-work-bandit}"; export BANDIT_AUDIO_WORK="$WORK"
FAST="${FAST:---ex 0.6 --cfg 0.65}"
IDS="${1:-$(python3 -c 'import json; print(",".join(l["id"] for l in json.load(open("docs/audio-lines.json"))["lines"]))')}"
export PATH=/opt/homebrew/bin:$PATH
mkdir -p "$WORK"
gen()  { "$VENVS/.venv-cb/bin/python" tools/audio/gen_lines.py "$@"; }
qa()   { "$VENVS/.venv-tts/bin/python" tools/audio/qa_check.py "$@"; }
fails() {
  python3 - "$IDS" "$WORK" <<'PY'
import json, sys
want = sys.argv[1].split(","); s = json.load(open(sys.argv[2] + "/qa/summary.json"))
print(",".join(i for i in want if s.get(i, {}).get("status") != "pass"))
PY
}
echo "== pass 1 ($(date +%T))";  gen --ids "$IDS" --takes 3 --device auto && qa --ids "$IDS"
F=$(fails)
if [ -n "$F" ]; then echo "== rung 1 (more seeds) for: $F";  gen --ids "$F" --takes 3 --seed0 4 --device auto && qa --ids "$F"; fi
F=$(fails)
if [ -n "$F" ]; then echo "== rung 2 (faster pacing: $FAST) for: $F"; gen --ids "$F" --takes 3 --seed0 7 $FAST --device auto && qa --ids "$F"; fi
F=$(fails); echo "$F" | tr ',' '\n' | sed '/^$/d' > "$WORK/fail-after-ladder-ids.txt"
echo "== FAIL-after-ladder: ${F:-none}"
if [ "${NOMASTER:-0}" != "1" ]; then python3 tools/audio/master.py --ids "$IDS"; fi
echo "== done ($(date +%T))"
