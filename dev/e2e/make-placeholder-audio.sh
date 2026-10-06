#!/usr/bin/env bash
# Silent placeholder MP3s for the browser test, where the real clips are absent. NEVER commit what this makes.
#   bash dev/e2e/make-placeholder-audio.sh            fill the gaps
#   bash dev/e2e/make-placeholder-audio.sh --clean    remove everything it made (listed in desertbandit/audio/.placeholders)
# With a real desertbandit/audio/manifest.json (production's, see tools/link-game-audio.sh) it only makes the files that
# manifest lists and that are missing, each as long as its `sec`. Without one it writes a placeholder manifest.json too,
# with the 42 lines of docs/audio-lines.json, the radio fx, the 104 place calls, the bed and two critters.
# Needs ffmpeg (FFMPEG=..., default /opt/homebrew/bin/ffmpeg or the one on the PATH) and python3.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AUDIO="$ROOT/desertbandit/audio"; LIST="$AUDIO/.placeholders"
FFMPEG=${FFMPEG:-$( [ -x /opt/homebrew/bin/ffmpeg ] && echo /opt/homebrew/bin/ffmpeg || command -v ffmpeg || true)}

if [ "${1:-}" = "--clean" ]; then
  [ -f "$LIST" ] || { echo "nothing to clean ($LIST not found)"; exit 0; }
  n=0; while IFS= read -r f; do [ -n "$f" ] && [ -f "$AUDIO/$f" ] && [ ! -L "$AUDIO/$f" ] && rm -f "$AUDIO/$f" && n=$((n + 1)); done < "$LIST"
  rm -f "$LIST"; find "$AUDIO" -type d -empty -delete 2>/dev/null || true
  echo "removed $n placeholder files"; exit 0
fi
[ -n "$FFMPEG" ] || { echo "ERROR: no ffmpeg (set FFMPEG=/path/to/ffmpeg)" >&2; exit 1; }
mkdir -p "$AUDIO"

python3 - "$ROOT" "$AUDIO" "$LIST" "$FFMPEG" <<'PY'
import json, os, subprocess, sys, hashlib, shutil
root, audio, listf, ffmpeg = sys.argv[1:5]
man_path = os.path.join(audio, 'manifest.json')
made = []
if os.path.exists(listf):
    made = [l.strip() for l in open(listf) if l.strip()]
own_manifest = 'manifest.json' in made
if os.path.exists(man_path) and not own_manifest:
    man = json.load(open(man_path)); write_manifest = False
    print('real manifest.json: filling only the missing files it lists')
else:
    lines = json.load(open(os.path.join(root, 'docs/audio-lines.json')))['lines']
    clips = {}
    for l in lines:
        clips[l['id']] = {'character': l['character'], 'text': l['text'], 'kind': 'card' if l['moment'] == 'card' else 'call',
                          'treatment': 'radio', 'qa': 'placeholder', 'file': 'calls/%s.mp3' % l['id'], 'sec': round(min(1.6, l['max_sec'] * 0.6), 2)}
    clips['radio-click-01'] = {'kind': 'fx', 'file': 'radio/fx/radio-click-01.mp3', 'sec': 0.06}
    for n in (1, 2, 3):
        clips['radio-squelch-0%d' % n] = {'kind': 'fx', 'file': 'radio/fx/radio-squelch-0%d.mp3' % n, 'sec': 0.22}
    clips['radio-hiss-loop'] = {'kind': 'fx', 'file': 'radio/fx/radio-hiss-loop.mp3', 'sec': 4.0}
    for v in ('sr', 'r273'):
        for sq in range(52):
            i = '%s-%02d' % (v, sq)
            clips['pl-' + i] = {'kind': 'place', 'square': sq, 'treatment': 'radio', 'file': 'radio/places/pl-%s.mp3' % i, 'sec': 1.2}
    clips['amb-bed-01'] = {'kind': 'amb', 'file': 'amb/amb-bed-01.mp3', 'sec': 8.0}
    for c in ('amb-crow-01', 'amb-coyote-01'):
        clips[c] = {'kind': 'critter', 'file': 'amb/%s.mp3' % c, 'sec': 0.6}
    man = {'version': 1, 'placeholder': True, 'note': 'SILENT PLACEHOLDERS for the browser test (dev/e2e/make-placeholder-audio.sh); never commit', 'clips': clips}
    write_manifest = True

cache = {}
def silent(sec, out):
    key = round(sec, 2)
    if key not in cache:
        tmp = os.path.join(audio, '.ph-%s.mp3' % key)
        subprocess.check_call([ffmpeg, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', str(key),
                               '-codec:a', 'libmp3lame', '-b:a', '48k', tmp])
        cache[key] = tmp
    shutil.copyfile(cache[key], out)

n = 0
for cid, c in sorted(man['clips'].items()):
    f = c.get('file')
    if not f: continue
    out = os.path.join(audio, f)
    if os.path.exists(out):
        if write_manifest: c['v'] = hashlib.md5(open(out, 'rb').read()).hexdigest()[:8]
        continue
    os.makedirs(os.path.dirname(out), exist_ok=True)
    silent(float(c.get('sec') or 1.0), out)
    if write_manifest: c['v'] = hashlib.md5(open(out, 'rb').read()).hexdigest()[:8]
    made.append(f); n += 1
for tmp in cache.values(): os.remove(tmp)
if write_manifest:
    json.dump(man, open(man_path, 'w'), indent=1)
    if 'manifest.json' not in made: made.append('manifest.json')
open(listf, 'w').write('\n'.join(sorted(set(made))) + '\n')
print('made %d silent placeholder files (%d clips in the manifest); list: %s' % (n, len(man['clips']), listf))
PY
