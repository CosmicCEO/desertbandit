#!/usr/bin/env python3
"""Any Python 3 + ffmpeg. Re-measure every shipped voice line (independently of master.py) and check the Wave 2 budgets:
-16 LUFS +-1 LU (ebur128 on the final MP3), true peak <= -1.5 dBTP, mono, 44.1 kHz, 48 kbps MP3, length <= max_sec,
manifest bytes / hash match the file, qa is set, total size of calls/ under 600 KB. Exit 1 on any failure.
usage: python3 tools/audio/verify_calls.py"""
import hashlib, json, os, re, subprocess, sys
OUT = "desertbandit/audio"
L = json.load(open("docs/audio-lines.json"))["lines"]; man = json.load(open(f"{OUT}/manifest.json"))["clips"]
bad, total, qa = [], 0, {}
for l in L:
    i = l["id"]; e = man.get(i)
    if not e: bad.append(f"{i}: not in manifest"); continue
    qa[e["qa"]] = qa.get(e["qa"], 0) + 1
    if not e.get("file"): bad.append(f"{i}: no file (qa {e['qa']}: {e.get('reason')})"); continue
    f = f"{OUT}/{e['file']}"; b = open(f, "rb").read(); total += len(b)
    o = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", f, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    s = o[o.rfind("Summary"):]; I = float(re.search(r"I:\s+(-?[\d.]+)", s).group(1)); P = float(re.search(r"Peak:\s+(-?[\d.inf]+)", s).group(1))
    pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,channels,sample_rate,bit_rate:format=duration", "-of", "json", f], capture_output=True, text=True).stdout)
    st = pr["streams"][0]; sec = float(pr["format"]["duration"])
    probs = []
    if abs(I + 16) > 1: probs.append(f"LUFS {I}")
    if P > -1.5: probs.append(f"TP {P}")
    if st["codec_name"] != "mp3" or st["channels"] != 1 or st["sample_rate"] != "44100" or int(st["bit_rate"]) != 48000: probs.append(f"format {st}")
    if sec > l["max_sec"]: probs.append(f"{sec:.3f} s > max {l['max_sec']}")
    if len(b) != e["bytes"] or hashlib.sha1(b).hexdigest()[:8] != e["v"]: probs.append("manifest bytes/hash stale")
    print(f"{i:20s} {I:6.1f} LUFS {P:5.1f} dBTP {sec:5.2f}/{l['max_sec']} s {len(b) / 1024:5.1f} KB {e['qa']:12s} {'OK' if not probs else 'BAD ' + '; '.join(probs)}")
    if probs: bad.append(f"{i}: " + "; ".join(probs))
print(f"total calls: {total / 1024:.1f} KB (budget 600 KB); qa: {qa}")
if total > 600 * 1024: bad.append("over the 600 KB budget")
print("FAILURES:", bad or "none"); sys.exit(1 if bad else 0)
