#!/usr/bin/env python3
"""Any Python 3 + ffmpeg. Turn QA-picked takes into shipped MP3s and keep desertbandit/audio/manifest.json current
(Desert Bandit; adapted from Desert Ranger's master.py, same radio chain and loudness method).
usage: python3 tools/audio/master.py [--ids ...|--moments bust,lock] [--qa pending-ear]
Reads <work>/qa/<id>.json (qa_check.py's pick), writes desertbandit/audio/calls/<id>.mp3 and the manifest entry.
Every line here is a radio voice: band-pass 300-3000 Hz + compression + presence + light tanh overdrive + mild bit grit,
then -16 LUFS integrated, true peak <= -1.5 dBTP, mono MP3 48 kbps 44.1 kHz. The click, hiss and squelch are NOT baked in
(they are Desert Ranger's radio/fx clips, added at runtime). A line whose QA is FAIL is not encoded: its manifest entry gets
qa "FAIL" and the reason, and no file (nothing garbled ships)."""
import argparse, hashlib, json, os, re, subprocess
WORK = os.environ.get("BANDIT_AUDIO_WORK", "audio-work-bandit")
OUT = "desertbandit/audio"; MWORK = f"{WORK}/master"; os.makedirs(MWORK, exist_ok=True)
TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse")
RADIO = ("highpass=f=300:poles=2,highpass=f=300:poles=2,lowpass=f=3000:poles=2,lowpass=f=3000:poles=2,"
         "acompressor=threshold=-20dB:ratio=4:attack=5:release=90:makeup=2,equalizer=f=1700:t=q:w=1.0:g=4,"
         "volume=8dB,asoftclip=type=tanh,volume=-8dB,acrusher=bits=12:mix=0.25:mode=log,highpass=f=300,lowpass=f=3200")
TARGET, TP, KBPS = -16.0, -1.5, 48   # the radio chain band-limits to ~3 kHz, so 48 kbps mono is transparent and keeps the budget
PAD = 0.06                           # MP3 encoder padding: aim the trimmed voice this much under max_sec so the shipped clip fits
def sh(*a): subprocess.run(a, check=True)
def ff(*a): sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *a)
def meas(f):
    o = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", f, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    s = o[o.rfind("Summary"):]
    return float(re.search(r"I:\s+(-?[\d.]+)", s).group(1)), float(re.search(r"Peak:\s+(-?[\d.inf]+)", s).group(1))
def dur(f):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
                                capture_output=True, text=True).stdout.strip())
def norm_mp3(src, out, tgt, kbps=48, tp=TP):
    """Static gain -> 4x oversampled limiter -> MP3, re-measure the MP3, iterate (Desert Ranger's crowd_norm.py recipe)."""
    os.makedirs(os.path.dirname(out), exist_ok=True)
    I0, P0 = meas(src)
    if I0 < -60:   # shorter than the 400 ms LUFS gate: peak-normalise instead
        ff("-i", src, "-af", f"volume={tp - 4.5 - P0:.2f}dB", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", out)
        return dict(mode="peak", tp=meas(out)[1])
    g, lim = tgt - I0, tp - 0.5
    for it in range(10):
        ff("-i", src, "-af", f"volume={g:.2f}dB,aresample=176400,alimiter=limit={lim}dB:attack=1:release=50:level=false,aresample=44100",
           "-ac", "1", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", out)
        I, P = meas(out)
        if abs(I - tgt) <= 0.3 and P <= tp: break
        if P > tp: lim -= 0.3
        g += tgt - I
    return dict(lufs=I, tp=P)
MAN = f"{OUT}/manifest.json"
man = json.load(open(MAN)) if os.path.exists(MAN) else {"version": 1, "clips": {}}
def save(): json.dump(man, open(MAN, "w"), indent=1, ensure_ascii=False); open(MAN, "a").write("\n")
def register(cid, rel, **kw):
    f = f"{OUT}/{rel}"
    kw.update(file=rel, sec=round(dur(f), 3), bytes=os.path.getsize(f), v=hashlib.sha1(open(f, "rb").read()).hexdigest()[:8])
    man["clips"][cid] = kw; save()          # client fetches  audio/<file>?v=<v>
    print(cid, kw, flush=True)
p = argparse.ArgumentParser(); p.add_argument("--ids"); p.add_argument("--moments")
p.add_argument("--qa", default="pending-ear", help="manifest qa value for a line that passed the speech check (the owner has not listened yet)")
a = p.parse_args()
L = {l["id"]: l for l in json.load(open("docs/audio-lines.json"))["lines"]}
ids = a.ids.split(",") if a.ids else [i for i, l in L.items() if not a.moments or l["moment"] in a.moments.split(",")]
for i in ids:
    qf = f"{WORK}/qa/{i}.json"
    if not os.path.exists(qf): print("skip (no QA yet)", i); continue
    q = json.load(open(qf)); l = L[i]; rel = f"calls/{i}.mp3"
    base = dict(character=l["character"], text=l["text"], kind="card" if l["moment"] == "card" else "call", treatment="radio")
    if q["status"] != "pass":
        if os.path.exists(f"{OUT}/{rel}"): os.remove(f"{OUT}/{rel}")
        man["clips"][i] = dict(base, qa="FAIL", reason=f"speech check failed after the retake ladder ({q.get('fail_reason')}); best take heard as: {q['takes'] and min(q['takes'], key=lambda r: r['errors'])['heard']!r}")
        save(); print(i, "FAIL: not shipped", flush=True); continue
    tmp = f"{MWORK}/{i}.wav"
    ff("-i", q["pick"], "-af", f"aresample=48000,{TRIM}", "-ac", "1", f"{MWORK}/{i}.trim.wav")
    d0 = dur(f"{MWORK}/{i}.trim.wav"); mx = l.get("max_sec", 9) - PAD
    tempo = f"atempo={min(1.15, d0 / mx):.3f}," if d0 > mx else ""      # pitch-preserving speed-up, max +15 %
    ff("-i", f"{MWORK}/{i}.trim.wav", "-af", f"{tempo}{RADIO}", "-ac", "1", tmp)
    r = norm_mp3(tmp, f"{OUT}/{rel}", TARGET, KBPS)
    register(i, rel, **base, qa=a.qa, take=os.path.basename(q["pick"]), **({"tempo": float(tempo[7:-1])} if tempo else {}), **r)
