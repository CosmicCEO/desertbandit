#!/bin/bash
# The game plays Desert Ranger's radio click / squelch / hiss, its 104 place-name calls and its desert bed and critters.
# Those MP3s are not committed here: this symlinks the folders into desertbandit/audio/ for local development
# (like tools/link-game-art.sh does for the fonts); the deploy script copies real files.
# The manifest entries for these clips are in desertbandit/audio/manifest.json (tools/audio/import_dr_manifest.py).
# Usage: bash tools/link-game-audio.sh [path to the Desert Ranger checkout]   (default ~/Developer/desertranger)
set -e
RANGER="${1:-$HOME/Developer/desertranger}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$RANGER/desertranger/audio"
[ -d "$SRC/radio/fx" ] || { echo "No Desert Ranger audio at $SRC"; exit 1; }
DEST="$ROOT/desertbandit/audio"
mkdir -p "$DEST/radio"
ln -sfn "$SRC/radio/fx" "$DEST/radio/fx"
ln -sfn "$SRC/radio/places" "$DEST/radio/places"
ln -sfn "$SRC/amb" "$DEST/amb"
n=$(ls "$DEST/radio/places/" | grep -c '\.mp3$' || true)
[ "$n" = "104" ] || echo "warning: $n place calls in $SRC/radio/places (expected 104)"
[ -f "$DEST/amb/amb-bed-01.mp3" ] || echo "warning: no amb/amb-bed-01.mp3 in $SRC"
echo "Linked radio/fx, radio/places ($n calls) and amb from $SRC into $DEST"
