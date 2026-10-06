#!/usr/bin/env python3
"""Leading-artifact check and fix for TTS takes (issue #28). Pure numpy: the caller supplies the audio and the first spoken word's onset
(faster-whisper word_timestamps), so this runs in either venv and in the self-test without any model.

What the owner heard on some clips is SOMETHING BEFORE THE WORD: a click/pop, a breath or noise burst, a stray "uh", a lead-in that eats the first
sound. word_metrics.py's per-word checks never look at the start of the clip. check_lead() flags, with a reason:
  burst    a separate non-speech event before the word: an energy event (>= -42 dBFS, events split at >= 25 ms quiet) that ends before the word's
           event, peaks above -35 dBFS and is short (< 40 ms) or noise-like (zero-crossing rate > 0.12), or is voiced but separated from the word by >= 100 ms
  click    a derivative spike (sample-to-sample step) in the first 100 ms that is large (> 0.08 and > 6x the 99th percentile of the word's own steps)
  stray    the unprompted transcript starts with a hesitation/letter token that is not part of the script's first word, or the first script word is missing
  lead_in  more than 150 ms of low-level sound (between -45 and -42 dBFS) before the word's onset, i.e. what the master trim (-45 dB) would leave in
  hard     the clip starts already loud (first 10 ms peak > -40 dBFS): the onset is clipped
  early    the first sound above -45 dBFS begins within 30 ms of the clip start (EARLY_S): the first phoneme may be cut off
fix_lead() cuts the clip to start 35 ms before the word's onset (never later than the gap before the word allows) with an 8 ms fade-in.
usage: python3 tools/audio/word_lead.py --selftest"""
import sys
import numpy as np

EARLY_S = 0.03     # widened from 15 ms after the owner's Not-OK clips (senior_ranger) all began 15-25 ms in while the OK senior_ranger clips began >= 80 ms in
EV_DB = -42.0; BURST_DB = -35.0; MASTER_DB = -45.0; GAP_MIN = 0.025; HOP = 0.005
HES = {"uh", "um", "oh", "ah", "er", "eh", "hm", "hmm", "huh", "ha", "ooh", "aah", "uhh", "umm", "a"}

def _db(x): return 20 * np.log10(np.maximum(x, 1e-9))
def frames(y, sr):
    """RMS in dBFS over 10 ms windows, hop 5 ms -> (db, t_start_of_each_frame)."""
    w = max(1, int(0.01 * sr)); h = max(1, int(HOP * sr)); n = max(0, (len(y) - w) // h + 1)
    db = np.array([_db(float(np.sqrt(np.mean(y[i * h:i * h + w] ** 2)))) for i in range(n)]); return db, np.arange(n) * h / sr
def events(y, sr, thr=EV_DB, gap=GAP_MIN):
    """-> [(start_s, end_s)] runs above thr; runs closer than `gap` seconds are merged."""
    db, t = frames(y, sr); on = db > thr; runs = []; s = None
    for i, v in enumerate(list(on) + [False]):
        if v and s is None: s = i
        if not v and s is not None: runs.append([t[s], t[i - 1] + 0.01]); s = None
    out = []
    for r in runs:
        if out and r[0] - out[-1][1] < gap: out[-1][1] = r[1]
        else: out.append(r)
    return [(a, b) for a, b in out]
def peak_db(y, sr, a, b): seg = y[int(a * sr):int(b * sr) + 1]; return float(_db(np.max(np.abs(seg)))) if len(seg) else -120.0
def zcr(y, sr, a, b):
    seg = y[int(a * sr):int(b * sr) + 1]; return float(np.mean(np.abs(np.diff(np.sign(seg))) > 0)) if len(seg) > 2 else 0.0

def find_word_event(ev, t0):
    """The energy event that is the spoken word: the first one that ends after the recogniser's first-word start (minus 30 ms)."""
    if not ev: return None
    if t0 is None: return 0
    for i, (a, b) in enumerate(ev):
        if b > t0 - 0.03: return i
    return len(ev) - 1

def check_lead(y, sr, t0, stray=None):
    """y = raw take (any sample rate, float -1..1), t0 = first word start in seconds from the file start (None if nothing was heard),
    stray = reason string from stray_token() or None.  -> dict(ok, flags=[...], word_start, lead_start, events, details)."""
    y = np.asarray(y, dtype=np.float64); flags = []; det = {}
    ev = events(y, sr); wi = find_word_event(ev, t0)
    db, t = frames(y, sr); above = np.where(db > MASTER_DB)[0]; lead_start = float(t[above[0]]) if len(above) else None
    if wi is None: return dict(ok=False, flags=["empty: no sound in the clip"], word_start=None, lead_start=None, events=[], details={})
    ws = ev[wi][0]
    for i in range(wi):                                   # non-speech events before the word
        a, b = ev[i]; pk = peak_db(y, sr, a, b); z = zcr(y, sr, a, b); nxt = ev[i + 1][0] - b
        if pk > BURST_DB and ((b - a) < 0.04 or z > 0.12): flags.append(f"burst at {a:.3f}s ({(b - a) * 1000:.0f} ms, peak {pk:.0f} dBFS, {'noise' if z > 0.12 else 'click'}-like)")
        elif pk > BURST_DB and nxt >= 0.10: flags.append(f"stray sound at {a:.3f}s ({(b - a) * 1000:.0f} ms, peak {pk:.0f} dBFS) {nxt * 1000:.0f} ms before the word")
    if lead_start is not None and not flags and ws - lead_start > 0.15: flags.append(f"lead_in: {(ws - lead_start) * 1000:.0f} ms of low-level sound before the word")
    if lead_start is not None and lead_start < 0.01 and peak_db(y, sr, 0, 0.01) > -40: flags.append("hard start: the clip begins already loud (clipped onset)")
    elif lead_start is not None and lead_start < EARLY_S and not any(f.startswith("burst") for f in flags):
        flags.append(f"early onset: sound starts {lead_start * 1000:.0f} ms into the clip (< {EARLY_S * 1000:.0f} ms), the first sound may be clipped")
    a0 = max(0.0, (lead_start if lead_start is not None else 0) - 0.005); a1 = min(a0 + 0.105, ev[wi][1])
    seg = y[int(a0 * sr):int(a1 * sr) + 1]; body = y[int(ws * sr):int(ev[wi][1] * sr) + 1]
    if len(seg) > 3 and len(body) > 3:
        step = float(np.max(np.abs(np.diff(seg)))); p99 = float(np.percentile(np.abs(np.diff(body)), 99)); det.update(step=round(step, 3), body_p99=round(p99, 4))
        if step > 0.08 and step > 6 * p99: flags.append(f"click: sample step {step:.2f} in the first 100 ms (word body p99 {p99:.3f})")
    if stray: flags.append("stray: " + stray)
    return dict(ok=not flags, flags=flags, word_start=round(ws, 3), lead_start=None if lead_start is None else round(lead_start, 3), events=[(round(a, 3), round(b, 3)) for a, b in ev[:4]], details=det)

def stray_token(heard_tokens, ref_tokens, align, lev):
    """Reason string if the transcript starts with a hesitation/letter that is not part of the script's first word, or the first script word is missing."""
    if not ref_tokens: return None
    if not heard_tokens: return "nothing heard"
    # Desert Bandit: Whisper may join two script words into one token ("goalcard" for "goal card"); split it so the first word is not reported missing
    pairs = {ref_tokens[k] + ref_tokens[k + 1]: [ref_tokens[k], ref_tokens[k + 1]] for k in range(len(ref_tokens) - 1)}
    heard_tokens = [x for t in heard_tokens for x in (pairs[t] if t in pairs and t not in ref_tokens else [t])]
    spans = align(ref_tokens, heard_tokens); s0 = spans[0]; r0 = ref_tokens[0]
    if not s0: return f"first script word '{r0}' missing (clipped?)"
    first = heard_tokens[s0[0]]
    if (first in HES or (len(first) == 1 and first != "a")) and r0 not in HES and len(s0) >= 2:
        rest = "".join(heard_tokens[j] for j in s0[1:])
        if lev(rest, r0) <= max(1, len(r0) // 4): return f"leading '{first}' before '{r0}'"
    if len(s0) >= 2 and not r0.startswith(first[:2]) and first not in HES and "".join(heard_tokens[j] for j in s0[1:]) == r0 and len(first) >= 2:
        return f"extra word '{first}' before '{r0}'"       # e.g. "Gah, the olla site": a stray syllable the voice added in front of the script's first word
    if first in HES and r0 not in HES and len(s0) == 1 and len(heard_tokens) > 1 and lev(first, r0) > 1: return f"leading '{first}' replaces '{r0}'"
    return None

def fix_lead(y, sr, t0, pre=0.035, fade=0.008):
    """-> (y2, info). Start the clip `pre` s before the word's onset (not into a preceding event), 8 ms linear fade-in. Never touches the word itself."""
    y = np.asarray(y, dtype=np.float64); ev = events(y, sr); wi = find_word_event(ev, t0)
    if wi is None: return y, dict(changed=False)
    ws = ev[wi][0]; prev_end = ev[wi - 1][1] if wi > 0 else 0.0
    cut = max(0.0, ws - pre, prev_end + 0.005); cut = min(cut, ws - 0.012) if ws - 0.012 > 0 else 0.0
    i0 = int(cut * sr); y2 = y[i0:].copy(); n = int(fade * sr); y2[:n] *= np.linspace(0, 1, n, endpoint=False)[:len(y2[:n])]
    def onset_rms(sig, start): seg = sig[int(start * sr):int((start + 0.06) * sr)]; return float(_db(np.sqrt(np.mean(seg ** 2)))) if len(seg) else -120.0
    return y2, dict(changed=cut > 0.0, cut=round(cut, 3), word_start=round(ws, 3), onset_rms_before=round(onset_rms(y, ws), 2), onset_rms_after=round(onset_rms(y2, ws - cut), 2))

# ---- self-test ----------------------------------------------------------------------------------------------------------------------------------
def _word(sr, dur=0.45, f=170, amp=0.35):
    t = np.arange(int(dur * sr)) / sr; rng = np.random.default_rng(1)
    env = np.minimum(1, np.minimum(t, t[::-1]) / 0.03) * (0.6 + 0.4 * np.sin(2 * np.pi * 5 * t) ** 2)
    return amp * env * (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2.1 * f * t)) + 0.01 * rng.standard_normal(len(t))
def build(sr, kind):
    rng = np.random.default_rng(2); w = _word(sr); z = lambda s: np.zeros(int(s * sr))
    if kind == "clean": return np.concatenate([z(0.15), w, z(0.1)]), 0.15
    if kind == "click15":    # a 15 ms broadband click 80 ms before the word
        c = rng.uniform(-1, 1, int(0.015 * sr)) * np.hanning(int(0.015 * sr)) * 0.7; return np.concatenate([z(0.05), c, z(0.09), w, z(0.1)]), 0.155
    if kind == "burst120":   # a 120 ms noise burst (breath/hiss) then a gap then the word
        b = rng.standard_normal(int(0.12 * sr)) * 0.08 * np.hanning(int(0.12 * sr)); return np.concatenate([z(0.02), b, z(0.15), w, z(0.1)]), 0.29
    if kind == "hard": return np.concatenate([w, z(0.1)]), 0.0
    if kind == "leadin":     # 200 ms of soft hiss (about -43.5 dBFS) glued to the word
        h = rng.standard_normal(int(0.2 * sr)) * 0.0066; return np.concatenate([z(0.02), h, w, z(0.1)]), 0.22
def selftest():
    bad = 0; sr = 24000
    def case(kind, expect_ok, want=None):
        nonlocal bad
        y, t0 = build(sr, kind); r = check_lead(y, sr, t0); ok = r["ok"] == expect_ok and (want is None or any(want in f for f in r["flags"])); bad += not ok
        print("ok  " if ok else "FAIL", f"{kind}: ok={r['ok']} flags={r['flags']}")
        return y, t0, r
    case("clean", True); case("click15", False, "burst"); case("burst120", False, "burst"); case("hard", False, "hard start"); case("leadin", False, "lead_in")
    for kind in ("click15", "burst120"):          # the fix removes the artifact and leaves the word's onset untouched
        y, t0 = build(sr, kind); y2, info = fix_lead(y, sr, t0); r = check_lead(y2, sr, t0 - info["cut"]); ok = r["ok"] and abs(info["onset_rms_before"] - info["onset_rms_after"]) < 0.5
        bad += not ok; print("ok  " if ok else "FAIL", f"fix {kind}: after-fix ok={r['ok']} {r['flags']} cut={info['cut']}s onset RMS {info['onset_rms_before']} -> {info['onset_rms_after']} dBFS")
    y, t0 = build(sr, "clean"); y2, info = fix_lead(y, sr, t0); ok = abs(info["onset_rms_before"] - info["onset_rms_after"]) < 0.5; bad += not ok
    print("ok  " if ok else "FAIL", f"fix on a clean clip keeps the onset: {info}")
    # stray token
    import difflib
    sys.path.insert(0, __file__.rsplit("/", 1)[0]); import word_metrics as wm
    for heard, ref, expect in ((["uh", "ocotillo", "wells"], ["ocotillo", "wells"], True), (["ocotillo", "wells"], ["ocotillo", "wells"], False), (["wells"], ["ocotillo", "wells"], True)):
        s = stray_token(heard, ref, wm.align, wm.lev); ok = bool(s) == expect; bad += not ok; print("ok  " if ok else "FAIL", f"stray_token {heard} vs {ref}: {s}")
    print("selftest", "FAIL" if bad else "OK"); return 1 if bad else 0

if __name__ == "__main__":
    if "--selftest" in sys.argv: sys.exit(selftest())
    print(__doc__)
