#!/bin/bash
# The pitch sheet needs Desert Ranger's fonts and hand-drawn art, which are gitignored binaries (they come from the assets zip).
# This links them into place. Usage: bash tools/link-pitch-art.sh [path to the Desert Ranger checkout]   (default ~/Developer/desertranger)
set -e
RANGER="${1:-$HOME/Developer/desertranger}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$RANGER/art-binaries/art/icons" ] || { echo "No art at $RANGER/art-binaries (unzip desertranger-assets-for-mac.zip there first)"; exit 1; }
mkdir -p "$ROOT/design/art" "$ROOT/design/pitch"
ln -sfn "$RANGER/art-binaries/art/icons"       "$ROOT/design/art/icons"
ln -sfn "$RANGER/art-binaries/art/pieces"      "$ROOT/design/art/pieces"
ln -sfn "$RANGER/art-binaries/pitch/fonts"     "$ROOT/design/pitch/fonts"
ln -sfn "$RANGER/art-binaries/pitch/img"       "$ROOT/design/pitch/img"
echo "Linked fonts, icons, rig pieces and pitch photos from $RANGER"
