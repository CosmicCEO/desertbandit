#!/usr/bin/env python3
"""Per-word take metrics for issue #28 (Whisper venv, .venv-tts). NEVER run while Chatterbox (word_lab.py / gen_lines.py) is running.

qa_check.py's strict gate glues the heard fragments of a word back together, so it passes "Vaya see toe" / "O co tee yo" even when the voice
paused between the pieces.  This tool looks at TIMING as well.  Per take and per target word (faster-whisper small.en, word_timestamps=True, the
clip trimmed at 40 dB and padded 0.25 s as in qa_check; ffmpeg silencedetect -35 dB d=0.08 on the trimmed clip), a take PASSES only if ALL hold:
  a  strict word match      the heard span aligned to the word is within 1 character of the real word OR the respelling, same syllable count (qa_check pron_gate)
  b  no fragmentation       the word is heard as 1 token, or every gap between its fragments is < 120 ms
  c  no silence inside      no silencedetect interval lies fully inside the word's time span (a pause in the middle of the word)
  d  no spelled-out letters no run of single letters / ALL-CAPS token ("V A Y A", "O.Y.A.", "OTO") in the transcript unless the script has it
  e  duration               word duration <= 1.3x the median across all candidates for that word/voice/clip (stretched = slow detached syllables)
  f  clip length            trimmed clip <= max_sec * 1.15 (the tempo qa_check/master.py may apply)
A take is WORD-CLEAN when a-e hold (the word itself reads cleanly) and PASSES when a-f hold; the lab ranks by word-clean first because length is a pacing
problem the regeneration step can still fix (retake ladder / tempo), while a pause or letters inside the word cannot be fixed afterwards.
usage:
  .venv-tts/bin/python tools/audio/word_metrics.py --lab  [--dir audio-work/wordlab]     # score every take in <dir>/manifest.jsonl -> metrics.jsonl
  .venv-tts/bin/python tools/audio/word_metrics.py --old                                 # old Wave 2 takes of q12a and pl-sr-18 vs the old strict gate
  .venv-tts/bin/python tools/audio/word_metrics.py --old-pass                            # every old take the OLD strict gate passed for Ocotillo/Vallecito, re-scored
  .venv-tts/bin/python tools/audio/word_metrics.py --report [--dir audio-work/wordlab]   # report.md + winners (writes the table in docs/audio-lines.json)
  .venv-tts/bin/python tools/audio/word_metrics.py --selftest                            # synthetic clips: 200 ms gap inside a word is flagged, clean passes"""
import argparse, collections, json, os, re, subprocess, sys, tempfile, unicodedata, wave, warnings; warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import difflib
import numpy as np

SR = 16000; PAD = 0.25; TEMPO_MAX = 1.15; FRAG_GAP = 0.12; DUR_RATIO = 1.3; SIL_DB = -35; SIL_D = 0.08

# ---- text helpers: same rules as tools/audio/qa_check.py (that file runs on import, so they are repeated here; keep them identical) -------------
def syl(w):
    v = lambda i: w[i] in "aeiou" or (w[i] == "y" and i > 0 and not (i + 1 < len(w) and w[i + 1] in "aeiou"))
    return sum(1 for i in range(len(w)) if v(i) and not (i > 0 and v(i - 1)))
def lev(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1])); prev, d[j] = d[j], cur
    return d[len(b)]
def align(r, h):
    """spans[i] = indexes of the hyp tokens aligned to ref token i (insertions after a ref token are attached to it)."""
    n, m_ = len(r), len(h); D = [[0] * (m_ + 1) for _ in range(n + 1)]
    for i in range(n + 1): D[i][0] = i
    for j in range(m_ + 1): D[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m_ + 1): D[i][j] = min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (r[i - 1] != h[j - 1]))
    spans = [[] for _ in range(n)]; i, j = n, m_
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i][j] == D[i - 1][j - 1] + (r[i - 1] != h[j - 1]): spans[i - 1].insert(0, j - 1); i -= 1; j -= 1
        elif j > 0 and (i == 0 or D[i][j] == D[i][j - 1] + 1):
            if i > 0: spans[i - 1].append(j - 1)
            elif n: spans[0].insert(0, j - 1)       # insertions before the first ref token belong to it (qa_check.py drops them)
            j -= 1
        else: i -= 1
    return spans
def toks(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z' ]+", " ", t.replace("-", " ")).replace("'", "").split()
def letters(s): return re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())
SPELLED = re.compile(r"(?<![A-Za-z0-9'])[A-Za-z](?:[^A-Za-z0-9']+[A-Za-z](?![A-Za-z0-9'])){1,}")

# ---- timing helpers ----------------------------------------------------------------------------------------------------------------------------
def silences(y, sr=SR):
    """-> [(start, end)] of silence (< -35 dB, >= 80 ms) in y, via ffmpeg silencedetect (librosa-free RMS fallback when ffmpeg is missing)."""
    try:
        with tempfile.TemporaryDirectory() as td:
            fn = os.path.join(td, "x.wav"); write_wav(fn, y, sr)
            r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", fn, "-af", f"silencedetect=noise={SIL_DB}dB:d={SIL_D}", "-f", "null", "-"], capture_output=True, text=True)
        st = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", r.stderr)]; en = [float(x) for x in re.findall(r"silence_end: (-?[\d.]+)", r.stderr)]
        out = [(max(0.0, s), e) for s, e in zip(st, en)]
        if len(st) > len(en): out.append((max(0.0, st[-1]), len(y) / sr))     # silence runs to the end of the file
        return out
    except FileNotFoundError:
        hop = int(0.01 * sr); n = len(y) // hop; rms = np.sqrt((y[:n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12); low = 20 * np.log10(rms) < SIL_DB
        out, s = [], None
        for i, v in enumerate(list(low) + [False]):
            if v and s is None: s = i
            if not v and s is not None:
                if (i - s) * 0.01 >= SIL_D: out.append((s * 0.01, i * 0.01))
                s = None
        return out
def write_wav(fn, y, sr=SR):
    with wave.open(fn, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())
def internal_silence(sil, start, end, clip_len=None, tol=0.03):
    """Silences lying fully inside the word span [start, end] = a pause in the middle of the word. A silence that runs on past the word end is just the
    pause after it, one that starts before the word is the pause before it, and one touching the clip edge is trimming noise, so none of those count."""
    return [(s, e) for s, e in sil if s >= start and e <= end + tol and e > s and s > 0.02 and (clip_len is None or e < clip_len - 0.02)]

def load_trim(f):
    import librosa
    y, _ = librosa.load(f, sr=SR); yt, _ = librosa.effects.trim(y, top_db=40)
    return y, yt

def trim_offset(f):
    """Seconds the 40 dB trim removed from the start of the 16 kHz clip (Whisper times are relative to the trimmed clip)."""
    import librosa
    y, _ = librosa.load(f, sr=SR); _, idx = librosa.effects.trim(y, top_db=40); return idx[0] / SR
def lead_of(f, words, ref_text):
    """Leading-artifact check (word_lead.py) for one take file. words = whisper_words() of its trimmed clip. -> check_lead() dict."""
    import librosa, word_lead
    y, sr = librosa.load(f, sr=None, mono=True); off = trim_offset(f)
    t0 = words[0][1] + off if words else None
    ht = [t for w, _, _ in words for t in toks(w)]
    return word_lead.check_lead(y, sr, t0, word_lead.stray_token(ht, toks(ref_text), align, lev))

_MODEL = None
def whisper_words(yt, model=None):
    """-> [(word, start, end)] in trimmed-clip seconds (the 0.25 s pad is removed)."""
    global _MODEL
    if model is not None: _MODEL = model
    if _MODEL is None:
        from faster_whisper import WhisperModel
        _MODEL = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=max(4, (os.cpu_count() or 8) // 2))
    x = np.pad(yt, (int(PAD * SR),) * 2).astype(np.float32)
    segs, _ = _MODEL.transcribe(x, beam_size=5, language="en", word_timestamps=True, condition_on_previous_text=False)
    return [(w.word.strip(), round(w.start - PAD, 3), round(w.end - PAD, 3)) for s in segs for w in s.words]

def measure(words, sil, ref_text, target, written_forms, resp, clip_len=None):
    """Everything about one take that does not need the other takes. words=[(word,start,end)]; ref_text = the clip's plain script text;
    target = the target word(s) in the ref, e.g. "ocotillo" or "burro bend"; resp = the respelling that was sent for the FIRST target word.
    -> dict with per-target-word results; the take-level flags are combined by verdict()."""
    ref = toks(ref_text); tw = target.split()
    ht, owner = [], []                           # heard tokens, and which whisper word each came from
    for wi, (w, s, e) in enumerate(words):
        for t in toks(w): ht.append(t); owner.append(wi)
    spans = align(ref, ht); res = []
    for ti, t in enumerate(tw):
        idxs = [x for x, r in enumerate(ref) if r == t]
        if not idxs: res.append(dict(word=t, error="target not in script")); continue
        span = spans[idxs[0]]; heard = [ht[j] for j in span]; j_ = "".join(heard); sy = sum(syl(x) for x in heard)
        forms = [t] + ([letters(resp)] if ti == 0 and resp else [])
        match = next((c for c in forms if heard and lev(j_, c) <= 1 and sy == syl(c)), None)
        soft = max([difflib.SequenceMatcher(None, j_, c).ratio() for c in forms] or [0.0]) if heard else 0.0
        wis = sorted({owner[j] for j in span}); frags = [words[i] for i in wis]
        if frags:
            st, en = frags[0][1], frags[-1][2]
            gaps = [round(frags[k + 1][1] - frags[k][2], 3) for k in range(len(frags) - 1)]
            ins = internal_silence(sil, st, en, clip_len)
        else: st = en = None; gaps = []; ins = []
        res.append(dict(word=t, heard=" ".join(heard), match="written" if match == t else ("respelling" if match else None), soft=round(soft, 3),
                        n_frag=len(frags), gaps=gaps, start=st, end=en, dur=round(en - st, 3) if frags else None, silence_inside=[(round(a, 3), round(b, 3)) for a, b in ins]))
    # d: spelled-out letters anywhere in the heard transcript (unless the script itself spells letters)
    txt = " ".join(w for w, _, _ in words); script_spells = bool(SPELLED.search(ref_text))
    single = [i for i, (w, _, _) in enumerate(words) if len(toks(w)) == 1 and len(toks(w)[0]) == 1 and toks(w)[0] not in ("a", "i")]
    run = any(single[k + 1] == single[k] + 1 for k in range(len(single) - 1))
    capstok = [w for w, _, _ in words if re.fullmatch(r"[A-Z]{2,}\.?,?", w) and w.rstrip(".,").lower() not in ref and w.rstrip(".,") != "OK"]
    spelled = (bool(SPELLED.search(txt)) or run or bool(capstok)) and not script_spells
    return dict(words=res, spelled=spelled, capstok=capstok, transcript=txt)

def verdict(m, trimmed_sec, max_sec, med_dur):
    """Combine measure() with the group median duration (e) and the clip length (f). -> dict of flags + ok (all of a-f)."""
    ws = m["words"]; real = [w for w in ws if "error" not in w]
    a = bool(real) and all(w["match"] for w in real)
    b = bool(real) and all(w["n_frag"] == 1 or (w["n_frag"] > 1 and all(g < FRAG_GAP for g in w["gaps"])) for w in real)
    c = bool(real) and all(w["n_frag"] > 0 and not w["silence_inside"] for w in real)
    d = not m["spelled"]
    durs = [w["dur"] for w in real if w["dur"]]; dur = sum(durs) if durs else None
    e = bool(dur) and med_dur is not None and dur <= DUR_RATIO * med_dur      # stretched (slow, detached syllables) is the defect; a short word is caught by (a)
    f = trimmed_sec <= max_sec * TEMPO_MAX and trimmed_sec >= 0.3
    return dict(a_match=a, b_frag=b, c_nosilence=c, d_noletters=d, e_dur=e, f_len=f, clean=all((a, b, c, d, e)), ok=all((a, b, c, d, e, f)), word_dur=dur,
                heard=" | ".join(w["heard"] for w in real), soft=round(min([w["soft"] for w in real] or [0]), 3))

# ---- self-test ---------------------------------------------------------------------------------------------------------------------------------
def synth(gap_ms=0, sr=SR):
    """A fake 3-syllable word: three 0.22 s tone bursts (180/220/260 Hz + noise) with 20 ms edges, optionally a silent gap after syllable 1."""
    rng = np.random.default_rng(0); out = [np.zeros(int(0.1 * sr))]
    for k, f in enumerate((180, 220, 260)):
        t = np.arange(int(0.22 * sr)) / sr; seg = (0.5 * np.sin(2 * np.pi * f * t) + 0.05 * rng.standard_normal(len(t))) * np.minimum(1, np.minimum(t, t[::-1]) / 0.02)
        out.append(seg)
        if k == 0 and gap_ms: out.append(np.zeros(int(gap_ms / 1000 * sr)))
    out.append(np.zeros(int(0.1 * sr))); return np.concatenate(out).astype(np.float32)
def selftest():
    bad = 0
    def case(name, gap_ms, expect_ok, frag=False):
        nonlocal bad
        y = synth(gap_ms); sil = silences(y); dur = len(y) / SR; st, en = 0.1, dur - 0.1
        # the transcript a recogniser would give for this audio: the word heard whole (Whisper often spans the pause) or as two fragments around the gap
        if frag: words = [("Valle", st, st + 0.22), ("cito", st + 0.22 + gap_ms / 1000, en)]
        else: words = [("Vallecito", st, en)]
        m = measure(words, sil, "Vallecito", "vallecito", ["vallecito"], "vayaseetoe", dur); v = verdict(m, dur, 1.2, med_dur=en - st)
        ok = v["ok"] == expect_ok; bad += not ok
        print("ok  " if ok else "FAIL", f"{name}: gap={gap_ms} ms silences={[(round(a, 2), round(b, 2)) for a, b in sil]} -> ok={v['ok']} c_nosilence={v['c_nosilence']} b_frag={v['b_frag']}")
    case("clean word passes", 0, True)
    case("200 ms gap inside the word (heard whole) is flagged", 200, False)
    case("200 ms gap inside the word (heard as 2 fragments) is flagged", 200, False, frag=True)
    case("60 ms gap (below silencedetect d=0.08) is not a pause", 60, True)
    # d: spelled letters / caps tokens
    m = measure([("V", 0.1, 0.2), ("A", 0.2, 0.3), ("Y", 0.3, 0.4), ("A", 0.4, 0.5)], [], "Vallecito", "vallecito", [], "vayaseetoe"); ok = m["spelled"]; bad += not ok
    print("ok  " if ok else "FAIL", "spelled-out letters 'V A Y A' flagged:", m["spelled"])
    m = measure([("OTO", 0.1, 0.5), ("wells", 0.5, 0.8)], [], "Ocotillo Wells", "ocotillo", [], "ocotiyo"); ok = m["spelled"]; bad += not ok
    print("ok  " if ok else "FAIL", "caps token 'OTO' flagged:", m["capstok"])
    # b: fragments with a 150 ms hole between them fail even without a silence interval
    m = measure([("Valle", 0.1, 0.4), ("cito", 0.55, 0.9)], [], "Vallecito", "vallecito", [], "vayaseetoe"); v = verdict(m, 1.0, 1.2, 0.8)
    ok = not v["b_frag"]; bad += not ok; print("ok  " if ok else "FAIL", "fragments 150 ms apart flagged: b_frag =", v["b_frag"])
    print("selftest", "FAIL" if bad else "OK"); return 1 if bad else 0

# ---- scoring the lab ---------------------------------------------------------------------------------------------------------------------------
def plain_text(man, it):
    for x in man:
        if x["word"] == it["word"] and x["voice"] == it["voice"] and x["clip"] == it["clip"] and x["cand"] == "plain": return x["text"]
    return it["text"]
def run_lab(d):
    import numpy as np
    man = [json.loads(x) for x in open(f"{d}/manifest.jsonl")]; out_path = f"{d}/metrics.jsonl"
    done = {json.loads(x)["file"]: json.loads(x) for x in open(out_path)} if os.path.exists(out_path) else {}
    out = open(out_path, "a"); n = 0
    for it in man:
        if it["file"] in done: continue
        f = f"{d}/takes/{it['file']}"; y, yt = load_trim(f); words = whisper_words(yt); sil = silences(yt)
        m = measure(words, sil, plain_text(man, it), it["target"], [], it["spelling"] if it["cand"] != "plain" else None, len(yt) / SR)
        rec = dict(file=it["file"], word=it["word"], voice=it["voice"], clip=it["clip"], kind=it["kind"], cand=it["cand"], fmt=it["fmt"], spelling=it["spelling"], seed=it["seed"],
                   max_sec=it["max_sec"], trimmed_sec=round(len(yt) / SR, 2), silences=[(round(a, 2), round(b, 2)) for a, b in sil], **m)
        out.write(json.dumps(rec) + "\n"); out.flush(); n += 1
        print(n, it["file"], "|", m["transcript"], "|", [(w.get("match"), w.get("n_frag"), w.get("silence_inside")) for w in m["words"]], "spelled" if m["spelled"] else "", flush=True)
    print("DONE", n, "scored")
def run_lead(d):
    """Leading-artifact check over every take in <d>/manifest.jsonl -> <d>/lead.jsonl (needs Whisper for the first word's onset)."""
    man = [json.loads(x) for x in open(f"{d}/manifest.jsonl")]; out_path = f"{d}/lead.jsonl"
    done = {json.loads(x)["file"] for x in open(out_path)} if os.path.exists(out_path) else set(); out = open(out_path, "a"); n = 0
    for it in man:
        if it["file"] in done: continue
        f = f"{d}/takes/{it['file']}"; y, yt = load_trim(f); words = whisper_words(yt); r = lead_of(f, words, plain_text(man, it)); n += 1
        out.write(json.dumps(dict(file=it["file"], word=it["word"], voice=it["voice"], clip=it["clip"], cand=it["cand"], fmt=it["fmt"], spelling=it["spelling"], seed=it["seed"],
                                  lead_ok=r["ok"], flags=r["flags"], word_start=r["word_start"], lead_start=r["lead_start"], details=r["details"], first_words=words[:3], heard=" ".join(w for w, _, _ in words))) + "\n"); out.flush()
        if not r["ok"] or n % 50 == 0: print(n, it["file"], r["flags"], flush=True)
    print("DONE", n, "checked")
def load_metrics(d):
    rows = [json.loads(x) for x in open(f"{d}/metrics.jsonl")]
    groups = collections.defaultdict(list)
    for r in rows:
        ds = [w["dur"] for w in r["words"] if "error" not in w and w.get("dur")]
        if ds: groups[(r["word"], r["voice"], r["clip"])].append(sum(ds))
    med = {k: float(np.median(v)) for k, v in groups.items()}
    for r in rows: r["v"] = verdict(r, r["trimmed_sec"], r["max_sec"], med.get((r["word"], r["voice"], r["clip"])))
    return rows

def run_old():
    """Run the new metrics on the old Wave 2 takes of q12a and pl-sr-18 (local audio-work only) next to what the old strict gate said."""
    D = json.load(open("docs/audio-lines.json")); L = {l["id"]: l for l in D["lines"]}
    jobs = [("q12a", "ocotillo", "ocotiyo"), ("pl-sr-18", "vallecito", "vayaseetoe")]
    rows = []
    for lid, target, resp in jobs:
        qa = {os.path.basename(t["file"]): t for t in json.load(open(f"audio-work/qa/{lid}.json"))["takes"]} if os.path.exists(f"audio-work/qa/{lid}.json") else {}
        for dirname in ("takes-old", "takes"):
            for f in sorted(os.listdir(f"audio-work/{dirname}/{lid}")):
                if not f.endswith(".wav"): continue
                y, yt = load_trim(f"audio-work/{dirname}/{lid}/{f}"); words = whisper_words(yt); sil = silences(yt)
                m = measure(words, sil, L[lid].get("tts_text", L[lid]["text"]), target, [], resp, len(yt) / SR)
                rows.append(dict(id=lid, dir=dirname, take=f, trimmed_sec=round(len(yt) / SR, 2), max_sec=L[lid]["max_sec"], m=m, old=qa.get(f) if dirname == "takes" else None,
                                 silences=[(round(a, 2), round(b, 2)) for a, b in sil]))
                print(lid, dirname, f, m["transcript"], flush=True)
    for lid in {r["id"] for r in rows}:
        ds = [sum(w["dur"] for w in r["m"]["words"] if w.get("dur")) for r in rows if r["id"] == lid]; ds = [x for x in ds if x]; med = float(np.median(ds)) if ds else None
        for r in rows:
            if r["id"] == lid: r["v"] = verdict(r["m"], r["trimmed_sec"], r["max_sec"], med)
    os.makedirs("audio-work/wordlab", exist_ok=True); json.dump(rows, open("audio-work/wordlab/old-takes-metrics.json", "w"), indent=1, default=str)
    print("\nid       dir       take     old_gate(strict/ok)  new:ok a b c d e f   heard   silence_inside")
    for r in rows:
        o = r["old"]; v = r["v"]; og = f"{o['strict_ok']}/{o['ok']}" if o else "-"
        print(f"{r['id']:9} {r['dir']:9} {r['take']:8} old={og:12} new={v['ok']!s:5} {''.join('Y' if v[k] else 'n' for k in ('a_match','b_frag','c_nosilence','d_noletters','e_dur','f_len'))} {v['heard']!r} {[w.get('silence_inside') for w in r['m']['words']]}")

def run_old_pass():
    """Every old take (Wave 2 and the Spanish-option runs, local audio-work only) that the old strict gate passed for Ocotillo or Vallecito, re-scored with the new metrics."""
    import glob
    D = json.load(open("docs/audio-lines.json")); L = {l["id"]: l for l in D["lines"]}; RESP = {"Ocotillo": "ocotiyo", "Vallecito": "vayaseetoe"}; rows = []
    for qf in sorted(glob.glob("audio-work/qa*/*.json")):
        if qf.endswith("summary.json"): continue
        d = json.load(open(qf)); lid = d["id"]
        for t in d["takes"]:
            hit = [e["word"] for e in t.get("pron", []) if e["word"] in RESP]
            if not (t.get("strict_ok") and hit) or not os.path.exists(t["file"]): continue
            word = hit[0]; y, yt = load_trim(t["file"]); words = whisper_words(yt); sil = silences(yt)
            m = measure(words, sil, L[lid].get("tts_text", L[lid]["text"]), word.lower(), [], RESP[word], len(yt) / SR)
            rows.append(dict(id=lid, dir=t["file"].split("/")[1], take=os.path.basename(t["file"]), word=word, trimmed_sec=round(len(yt) / SR, 2), max_sec=L[lid]["max_sec"], m=m, old=t))
            print(lid, t["file"], m["transcript"], flush=True)
    for r in rows:
        r["v"] = verdict(r["m"], r["trimmed_sec"], r["max_sec"], r["v_med"] if "v_med" in r else (r["m"]["words"][0].get("dur") or None))   # (e) needs a group median; a single take is compared with itself, i.e. (e) is neutral here
    json.dump(rows, open("audio-work/wordlab/old-passed-metrics.json", "w"), indent=1, default=str)
    print("\nold gate passed (strict_ok) -> new verdict")
    for r in rows:
        v = r["v"]; print(f"{r['id']:11} {r['dir']:12} {r['take']:12} old ok={r['old']['ok']!s:5} new ok={v['ok']!s:5} {''.join('Y' if v[k] else 'n' for k in ('a_match','b_frag','c_nosilence','d_noletters','e_dur','f_len'))} {v['heard']!r} {[w.get('silence_inside') for w in r['m']['words']]}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--lab", action="store_true"); ap.add_argument("--lead", action="store_true"); ap.add_argument("--old", action="store_true"); ap.add_argument("--report", action="store_true")
    ap.add_argument("--selftest", action="store_true"); ap.add_argument("--old-pass", action="store_true"); ap.add_argument("--dir", default="audio-work/wordlab"); a = ap.parse_args()
    if a.selftest:
        import word_lead; sys.exit(selftest() or word_lead.selftest())
    if a.lead: run_lead(a.dir)
    if a.lab: run_lab(a.dir)
    if a.old: run_old()
    if a.old_pass: run_old_pass()
    if a.report:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import word_report; word_report.main(a.dir, load_metrics(a.dir))
