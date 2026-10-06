#!/bin/bash
# The game needs Desert Ranger's fonts and rig pieces (and its board image), which are gitignored binaries.
# This symlinks them into desertbandit/assets/ for local development; the deploy script copies real files.
# Usage: bash tools/link-game-art.sh [path to the Desert Ranger checkout]   (default ~/Developer/desertranger)
set -e
RANGER="${1:-$HOME/Developer/desertranger}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$RANGER/desertranger/assets"
[ -d "$SRC/fonts" ] || { echo "No Desert Ranger assets at $SRC"; exit 1; }
DEST="$ROOT/desertbandit/assets"
mkdir -p "$DEST/fonts" "$DEST/img/pieces"
for f in Bungee-Regular.ttf BungeeShade-Regular.ttf Nunito.ttf Caveat.ttf; do
  ln -sfn "$SRC/fonts/$f" "$DEST/fonts/$f"
done
# Bangers is only in the pitch fonts of the assets zip
BANGERS="$RANGER/art-binaries/pitch/fonts/Bangers-Regular.ttf"
if [ -f "$BANGERS" ]; then ln -sfn "$BANGERS" "$DEST/fonts/Bangers-Regular.ttf"; else echo "warning: no $BANGERS (Bangers falls back to Bungee)"; fi
for p in blazer-twotone bronco-orange buggy-blue cruiser-teal jeep-red rail-purple ranger-green scout-butter; do
  ln -sfn "$SRC/img/pieces/$p.png" "$DEST/img/pieces/$p.png"
done
[ -f "$SRC/img/board-2000.jpg" ] && ln -sfn "$SRC/img/board-2000.jpg" "$DEST/img/board-2000.jpg"
echo "Linked fonts, rig pieces and the board image from $RANGER into $DEST"
