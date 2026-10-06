#!/usr/bin/env bash
# One command: build the Desert Bandit pitch sheet, render it to NEW dated PNG files and run the layout check.
#   design/pitch/make.sh          -> <out>/desert-bandit-pitch-YYYY-MM-DD[-N]{,-look,-status}.png
# PNG only by default (the owner prefers PNGs; a 3-page PDF is about 58 MB). PITCH_PDF=1 also writes the PDF.
# Env: PITCH_OUT (output folder), CHROME (browser path), PITCH_PDF. Never overwrites: if the name exists it adds -2, -3 ...
# Needs: playwright-core (cd dev/e2e && npm install), and the linked art (bash tools/link-pitch-art.sh).
# Exit 2 if the layout check finds overflow or overlap.
set -eu
cd "$(dirname "$0")/../.."
export PATH=/opt/homebrew/bin:$PATH
DATE=$(date +%Y-%m-%d)
[ -d dev/e2e/node_modules/playwright-core ] || { echo "need playwright-core: cd dev/e2e && npm install"; exit 1; }
[ -f design/pitch/fonts/Bungee-Regular.ttf ] && [ -d design/art/icons ] || { echo "fonts/art missing: bash tools/link-pitch-art.sh"; exit 1; }
# output folder: explicit, else the main checkout's art-binaries/pitch (survives a throw-away worktree)
COMMON="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
OUTDIR="${PITCH_OUT:-$COMMON/art-binaries/pitch}"; mkdir -p "$OUTDIR"
BASE="$OUTDIR/desert-bandit-pitch-$DATE"; N=2; OUT="$BASE"
while [ -e "$OUT.png" ]; do OUT="$BASE-$N"; N=$((N+1)); done
LOG=$(mktemp); node design/pitch/render.js "$OUT" | tee "$LOG"
HTML="design/pitch/desert-bandit-pitch.html"
SECTIONS=$(grep -o '<section class="sheet"' "$HTML" | wc -l | tr -d ' ')
if [ -f "$OUT.pdf" ]; then
  PAGES=$(python3 -c "import re,sys;print(len(re.findall(rb'/Type\s*/Page(?![a-zA-Z])',open(sys.argv[1],'rb').read())))" "$OUT.pdf")
  echo "pdf pages: $PAGES (sheets in html: $SECTIONS)  size: $(du -h "$OUT.pdf" | cut -f1)"
  [ "$PAGES" = "$SECTIONS" ] || { echo "PAGE COUNT MISMATCH"; exit 1; }
fi
for f in "$OUT.png" "$OUT-look.png" "$OUT-status.png"; do [ -f "$f" ] && echo "$f  $(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/{printf "%s ", $2}')"; done
echo "NEXT: Read each PNG above and look at it; fix and re-run if anything is off."
if grep -q 'past its box\|overlaps\|touches the page edge' "$LOG"; then echo "LAYOUT PROBLEMS: fix before sending"; exit 2; fi
