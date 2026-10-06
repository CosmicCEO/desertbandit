#!/bin/bash
# The doodle icons are gitignored art (Jeffery Price's hand-drawn board). Link them next to the review page so it can show them.
# Usage: bash tools/link-icons.sh [path to the Desert Ranger checkout]   (default ~/Developer/desertranger)
set -e
RANGER="${1:-$HOME/Developer/desertranger}"
SRC="$RANGER/art-binaries/art/icons"
DEST="$(cd "$(dirname "$0")/.." && pwd)/design/symbols"
[ -d "$SRC" ] || { echo "No icons at $SRC (unzip desertranger-assets-for-mac.zip first)"; exit 1; }
mkdir -p "$DEST"
ln -sfn "$SRC" "$DEST/icons"
cp "$RANGER/design/art/icons/manifest.json" "$DEST/manifest.json"
echo "Linked $SRC and copied manifest.json into $DEST"
