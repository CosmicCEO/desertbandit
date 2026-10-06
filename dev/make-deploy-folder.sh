#!/usr/bin/env bash
# Build a clean, upload-ready copy of desertbandit/ for the web host (runbook: docs/DEPLOY.md).
#   bash dev/make-deploy-folder.sh [SRC=desertbandit] [OUT=deploy/desertbandit]
# Run it in a checkout that has the binary assets (bash tools/link-game-art.sh links them from the Desert Ranger checkout).
#  - Symlinked assets are copied as real files (rsync -L), so the upload folder is self-contained.
#  - NEVER copies config.php (it holds the database login) or markdown files; the tests live outside desertbandit/ and are not copied.
#  - Refuses to overwrite an existing OUT folder. Writes OUT plus DEPLOY-MANIFEST.txt next to it (every file and its size).
set -euo pipefail
SRC=${1:-desertbandit}; OUT=${2:-deploy/desertbandit}
warn=0; w() { echo "WARNING: $*"; warn=$((warn + 1)); }
[ -f "$SRC/api.php" ] || { echo "ERROR: $SRC/api.php not found; run from the repo root (or pass the folder)." >&2; exit 1; }
[ ! -e "$OUT" ] || { echo "ERROR: $OUT already exists; remove it or pass another folder." >&2; exit 1; }

# Everything the game needs that is NOT in git must be present (and not a dangling link) in SRC.
[ "$(ls "$SRC"/assets/img/pieces/*.png 2>/dev/null | wc -l)" -ge 8 ] || w "fewer than 8 rig pictures in assets/img/pieces (bash tools/link-game-art.sh)"
[ "$(ls "$SRC"/assets/fonts/*.ttf 2>/dev/null | wc -l)" -ge 4 ] || w "fewer than 4 fonts in assets/fonts (bash tools/link-game-art.sh)"
for n in 0 1 2 3 4 5; do [ -f "$SRC/assets/img/reels/$n.svg" ] || w "assets/img/reels/$n.svg missing (a reel face)"; done
for f in index.html about.html api.php install.php config.sample.php .htaccess lib/rules.php lib/bot.php lib/game.php lib/db.php lib/schema.sql lib/policy.json; do
  [ -f "$SRC/$f" ] || w "$f missing"; done
find -L "$SRC" -type l 2>/dev/null | grep -q . && w "dangling symlinks in $SRC: $(find -L "$SRC" -type l | head -3 | tr '\n' ' ')"

excl=(--exclude 'config.php' --exclude 'tests/' --exclude '*.md' --exclude '.DS_Store' --exclude '._*' --exclude '*.log' --exclude '.git*')
mkdir -p "$OUT"
rsync -aL "${excl[@]}" "$SRC"/ "$OUT"/

# Safety nets: the database login must not be in the upload.
[ ! -e "$OUT/config.php" ] || { echo "ERROR: config.php ended up in $OUT; aborting." >&2; rm -f "$OUT/config.php"; exit 1; }
if grep -rIlE "db_pass'[[:space:]]*=>[[:space:]]*'[^']+'" "$OUT" 2>/dev/null | grep -v 'config.sample.php' | grep -q .; then
  echo "ERROR: a file in $OUT looks like it contains a database password; aborting." >&2; exit 1; fi
[ -f "$OUT/.htaccess" ] || w ".htaccess did not make it into $OUT (it protects config.php and the lib folder)"

# PHP syntax check with whatever php is on the PATH (set PHP=/path/to/php to pick one, e.g. MAMP's 7.4).
PHPBIN=${PHP:-$(command -v php || true)}
if [ -n "$PHPBIN" ]; then bad=0; while IFS= read -r f; do "$PHPBIN" -l "$f" >/dev/null 2>&1 || { echo "PHP syntax error: $f"; bad=1; }; done < <(find "$OUT" -name '*.php'); [ $bad -eq 0 ] || exit 1; echo "PHP syntax OK ($("$PHPBIN" -r 'echo PHP_VERSION;'))"; else w "no php found: syntax not checked"; fi

(cd "$OUT" && find . -type f | sort | sed 's|^\./||' | while IFS= read -r f; do printf '%10d  %s\n' "$(wc -c < "$f")" "$f"; done) > "$(dirname "$OUT")/DEPLOY-MANIFEST.txt"
n=$(find "$OUT" -type f | wc -l | tr -d ' '); kb=$(du -sk "$OUT" | cut -f1)
echo "Upload folder: $OUT  ($n files, $((kb / 1024)) MB)   manifest: $(dirname "$OUT")/DEPLOY-MANIFEST.txt"
echo "Top level: $(ls -A "$OUT" | tr '\n' ' ')"
[ $warn -eq 0 ] && echo "All checks passed." || echo "$warn warning(s): fix them before uploading."
