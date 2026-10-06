#!/usr/bin/env python3
"""Any Python 3. Copy Desert Ranger's manifest entries for the clips this game plays from the linked folders
(radio/fx/*, radio/places/*, amb/*) into desertbandit/audio/manifest.json, verbatim (with their hashes), so one manifest
describes everything the game plays. Only entries whose MP3 exists in the Desert Ranger audio folder are copied, and the
script checks each file's size and sha1 prefix against the entry (a mismatch is reported, the entry is still copied as is).
The new voice lines (calls/*, written by master.py) are kept, in docs/audio-lines.json order after the Desert Ranger entries.
usage: python3 tools/audio/import_dr_manifest.py [path to the Desert Ranger checkout]   (default ~/Developer/desertranger)"""
import hashlib, json, os, sys
RANGER = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Developer/desertranger")
SRC = f"{RANGER}/desertranger/audio"; MAN = "desertbandit/audio/manifest.json"
dr = json.load(open(f"{SRC}/manifest.json"))["clips"]
man = json.load(open(MAN)) if os.path.exists(MAN) else {"version": 1, "clips": {}}
PREFIX = ("radio/fx/", "radio/places/", "amb/")
take, bad = {}, []
for cid, e in dr.items():
    f = e.get("file", "")
    if not f.startswith(PREFIX) or not os.path.exists(f"{SRC}/{f}"): continue
    b = open(f"{SRC}/{f}", "rb").read()
    if len(b) != e.get("bytes") or hashlib.sha1(b).hexdigest()[:8] != e.get("v"): bad.append(cid)
    take[cid] = e
order = sorted(take, key=lambda c: (PREFIX.index(next(p for p in PREFIX if take[c]["file"].startswith(p))), take[c]["file"]))
lines = [l["id"] for l in json.load(open("docs/audio-lines.json"))["lines"]]
own = {c: e for c, e in man["clips"].items() if not e.get("file", "").startswith(PREFIX)}
own_order = [c for c in lines if c in own] + [c for c in own if c not in lines]
man = {"version": 1, "clips": {**{c: take[c] for c in order}, **{c: own[c] for c in own_order}}}
os.makedirs(os.path.dirname(MAN), exist_ok=True)
json.dump(man, open(MAN, "w"), indent=1, ensure_ascii=False); open(MAN, "a").write("\n")
n = lambda p: sum(1 for c in order if take[c]["file"].startswith(p))
print(f"copied {len(order)} Desert Ranger entries (fx {n('radio/fx/')}, places {n('radio/places/')}, amb {n('amb/')}); kept {len(own)} own entries")
print("hash/size mismatches:", bad or "none")
