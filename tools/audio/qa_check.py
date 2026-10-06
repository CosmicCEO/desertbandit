#!/usr/bin/env python3
"""Whisper venv (faster-whisper). Word-check every take against its script line and pick a keeper (Desert Bandit; adapted from Desert Ranger).
usage: python tools/audio/qa_check.py [--ids ...] [--moments bust,lock] [--model small.en]
reads <work>/takes/<id>/*.wav, writes <work>/qa/<id>.json and <work>/qa/summary.json (<work> = $BANDIT_AUDIO_WORK, default audio-work-bandit).
The reference is the line's "qa_text" when present, else its "tts_text" (what the voice was asked to read), else its "text".
Bandit change: a compound split or joined by Whisper ("screen shot" for "screenshot") counts as the same word (merge_compounds).
A leading [bracketed phrase] in qa_text (e.g. "[R five five], ten-twenty?") is a loose lead-in: Whisper cannot reliably transcribe
a deliberately drawn-out word ("fiiive" is heard as "phi, I've"), so 1-10 heard words before the rest of the line are accepted
instead of the bracketed words (something must be heard there); everything after the bracket is checked as usual.
Words in the shared tools/audio/pronunciations.json table are respelled for the TTS, so the check accepts either the
written word or something close to the respelling (a run of 1-4 heard words that sounds like it) for them.
STRICT PRONUNCIATION GATE (no "loose" passes): for every table word in a line, the UNPROMPTED Whisper transcript is aligned to the script word by word
and the heard word(s) at that position must be within 1 character of EITHER the real word (ocotillo) OR the intended respelling (ocotiyo) and have the
same syllable count; "oto", "ocoteel", "kaya shito", "yeah see toe" fail. Spelled-out letters ("O T O", "L-A-H") fail too. The evidence (what was heard,
which one it matched) is stored per take and in the summary ("pron").
TABLE-WORD LINES also get word_metrics.py's checks per table word (no fragmentation, no silence inside the word, no spelled-out letters / caps tokens) and
word_lead.py's leading-artifact check (burst/click/stray sound/long lead-in/early onset <30 ms/stray first token). They are folded into "strict": a take with a pause inside
the word or an artifact before it cannot pass. A fixable artifact (burst, click, lead-in) also gets a trimmed copy <take>_lf.wav (8 ms fade-in, starts 35 ms before the word)
that is scored as one more take. Per-take evidence: wm_fail, lead_flags.
A take PASSES when (after trimming silence) word errors <= allowed, the strict gate holds and duration <= max_sec.
NEVER run this while gen_lines.py (Chatterbox) is running: one heavy model at a time."""
import argparse, glob, json, os, re, unicodedata, warnings; warnings.filterwarnings("ignore")
import difflib, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from pron import spelling, load_table   # shared table value -> respelling for a voice (per-voice override > default)
import numpy as np, librosa
from faster_whisper import WhisperModel
import word_metrics as wm, word_lead   # issue #28: timing checks (pause inside a word, fragments, spelled letters) and the leading-artifact check, for lines with table words
WORK = os.environ.get("BANDIT_AUDIO_WORK", "audio-work-bandit")
p = argparse.ArgumentParser(); p.add_argument("--ids"); p.add_argument("--moments")
p.add_argument("--model", default="small.en")
p.add_argument("--takes-dir", default=f"{WORK}/takes"); p.add_argument("--qa-dir", default=f"{WORK}/qa")
a = p.parse_args()
D = json.load(open("docs/audio-lines.json")); L = {l["id"]: l for l in D["lines"]}; PRON = load_table()
for l in L.values():
    if "qa_text" not in l and l.get("tts_text"): l["qa_text"] = l["tts_text"]   # Whisper reference = what the voice was asked to read
ids = a.ids.split(",") if a.ids else [i for i, l in L.items() if not a.moments or l["moment"] in a.moments.split(",")]
ids = [i for i in ids if glob.glob(f"{a.takes_dir}/{i}/*.wav")]
m = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=max(4, (os.cpu_count() or 8) // 2))
TEMPO_MAX = 1.15   # master.py may speed a clip up by at most this (pitch-preserving atempo) to fit max_sec
def hint(l):      # SHORT prompt with only this line's proper nouns; a long vocabulary prompt makes Whisper hallucinate
    ref_t = LEAD.sub("", l.get("qa_text", l["text"]), count=1)
    w = re.findall(r"\b[A-Z][a-z]+(?:'s)?\b", ref_t) + list(l.get("pronounce", {})) + [k for k in PRON if re.search(r"\b" + k + r"\b", ref_t, re.I)]
    return ", ".join(dict.fromkeys(w)) + "." if w else None
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
def n2w(n):
    n = int(n)
    if n < 20: return ONES[n]
    if n < 100: return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    return ONES[n // 100] + " " + ("" if n % 100 == 0 else n2w(n % 100))
DROP = {"hundred", "and", "uh", "um"}
def norm(t, ignore=(), digits=False):    # digits=True reads digit runs one by one ("273" = two seven three) instead of as a number
    t = re.sub("[\u2012-\u2015\u2212]", " ", t)   # em/en dashes separate words ("westward\u2014please"); folding them away would merge the words
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\d+", lambda x: " " + (" ".join(ONES[int(c)] for c in x.group()) if digits else n2w(x.group())) + " ", t)
    t = re.sub(r"[^a-z' ]+", " ", t.replace("-", " ")).replace("'", "")
    toks = [w for w in t.split() if w not in DROP and w not in ignore]
    out, run = [], False   # spelled-out letters ("V I P", "H R") are heard by Whisper as one word ("VIP", "HR"): merge runs of single letters
    for w in toks:
        if len(w) == 1 and w not in ("a", "i") or (len(w) == 1 and run):
            if run: out[-1] += w
            else: out.append(w)
            run = True
        else:
            out.append(w); run = False
    return out
def collapse(h, r, ign, voice=None):
    """Shared-table words: if the reference has such a word and Whisper heard something that sounds like the word or its
    respelling (1-4 consecutive tokens, joined, similarity >= 0.6), count it as the written word."""
    h = list(h)
    for k, v in PRON.items():
        wt = "".join(norm(k)); sp = "".join(norm(spelling(v, voice)))
        if not wt or wt in ign: continue
        for _ in range(max(0, r.count(wt) - h.count(wt))):
            best = None
            for n in (1, 2, 3, 4):
                for i in range(len(h) - n + 1):
                    seg = h[i:i + n]
                    if wt in seg: continue
                    j = "".join(seg); sc = max(difflib.SequenceMatcher(None, j, wt).ratio(), difflib.SequenceMatcher(None, j, sp).ratio())
                    if sc >= 0.6 and (best is None or sc > best[0] + 1e-9): best = (sc, i, n)
            if best: h[best[1]:best[1] + best[2]] = [wt]
            else: break
    return h
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
    """spans[i] = the hyp tokens aligned to ref token i (insertions after a ref token are attached to it)."""
    n, m_ = len(r), len(h); D = [[0] * (m_ + 1) for _ in range(n + 1)]
    for i in range(n + 1): D[i][0] = i
    for j in range(m_ + 1): D[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m_ + 1): D[i][j] = min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (r[i - 1] != h[j - 1]))
    spans = [[] for _ in range(n)]; i, j = n, m_
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i][j] == D[i - 1][j - 1] + (r[i - 1] != h[j - 1]): spans[i - 1].insert(0, h[j - 1]); i -= 1; j -= 1
        elif j > 0 and (i == 0 or D[i][j] == D[i][j - 1] + 1):
            if i > 0: spans[i - 1].append(h[j - 1])
            j -= 1
        else: i -= 1
    return spans
def spelled(text, hyp_t):
    run = lambda t: re.search(r"(?<![A-Za-z0-9'])[A-Za-z](?:[^A-Za-z0-9']+[A-Za-z](?![A-Za-z0-9'])){1,}", t)
    return bool(run(hyp_t)) and not run(text)       # a script that itself spells letters ("V I P") is exempt
def pron_gate(text, hyp_t, voice=None):
    """-> (ok, evidence) for every table word of the script line."""
    r = norm(text); h = norm(hyp_t); sp_ = align(r, h); ev = []
    for k, v in PRON.items():
        if not re.search(r"\b" + k + r"\b", text, re.I): continue
        wt, sp = "".join(norm(k)), "".join(norm(spelling(v, voice)))
        for idx in [x for x, t in enumerate(r) if t == wt]:
            span = sp_[idx]; j = "".join(span); sy = sum(syl(t) for t in span); m_ = None
            for cand, label in ((wt, "written"), (sp, "respelling")):
                if span and lev(j, cand) <= 1 and sy == syl(cand): m_ = label; break
            ev.append(dict(word=k, heard=" ".join(span), match=m_, ok=m_ is not None))
    return all(e["ok"] for e in ev), ev
LEAD = re.compile(r"^\s*\[[^\]]*\]\s*[,.;:]?\s*")
def merge_compounds(h, r):
    """Whisper writes some compounds split or joined ("screen shot" / "screenshot"): if two adjacent heard tokens joined equal a
    script word that was not heard as such, merge them; if one heard token equals two adjacent script words joined, split it."""
    h = list(h); rs = set(r); i = 0
    while i < len(h) - 1:
        j = h[i] + h[i + 1]
        if j in rs and j not in h: h[i:i + 2] = [j]
        i += 1
    pairs = {r[k] + r[k + 1]: [r[k], r[k + 1]] for k in range(len(r) - 1)}
    out = []
    for t in h: out += pairs[t] if t in pairs and t not in rs else [t]
    return out
def errors(text, hyp_t, ign, voice=None):
    lead = LEAD.match(text); text = text[lead.end():] if lead else text
    best = None
    for dg in (False, True):          # numbers heard as a number or digit by digit: accept whichever reading matches
        r = norm(text, ign, dg); h = merge_compounds(collapse(norm(hyp_t, ign, dg), r, ign, voice), r)
        e = min(edits(r, h[k:]) for k in range(1, 11)) if lead else edits(r, h)
        best = e if best is None else min(best, e)
    return best
def edits(r, h):
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1])); prev, d[j] = d[j], cur
    return d[len(h)]
os.makedirs(a.qa_dir, exist_ok=True)
summ = json.load(open(f"{a.qa_dir}/summary.json")) if os.path.exists(f"{a.qa_dir}/summary.json") else {}
for i in ids:
    l = L[i]; voice = l["character"]; ign = set(l.get("whisper_ignore", [])); ref_text = l.get("qa_text", l["text"]); ref = norm(LEAD.sub("", ref_text, count=1), ign)
    allowed = 0 if len(ref) < 6 else max(1, len(ref) // 10)
    res = []
    tw = [k for k in PRON if re.search(r"\b" + k + r"\b", ref_text, re.I)]
    files = sorted(glob.glob(f"{a.takes_dir}/{i}/*.wav")); fi = 0
    while fi < len(files):
        f = files[fi]; fi += 1
        y, sr = librosa.load(f, sr=16000); yt, _ = librosa.effects.trim(y, top_db=40); dur = len(yt) / sr
        x = np.pad(yt, (4000, 4000)).astype(np.float32)
        plain = None
        for prompt in (None, hint(l)):          # pass 1: no prompt; pass 2 (only if needed): proper-noun hint
            segs, _ = m.transcribe(x, beam_size=5, language="en", initial_prompt=prompt, condition_on_previous_text=False)
            hyp_t = "".join(s.text for s in segs).strip(); e = errors(ref_text, hyp_t, ign, voice)
            if plain is None: plain = hyp_t     # the unprompted transcript (the hint pass biases Whisper towards the written word)
            if e <= allowed or not hint(l): break
        if tw: e = errors(ref_text, plain, ign, voice)   # table-word lines: judged on the UNPROMPTED transcript only (the hint can hide stray words)
        pok, ev = pron_gate(LEAD.sub("", ref_text, count=1), plain, voice); sp_ = spelled(ref_text, plain)
        strict = pok and not sp_ and not spelled(ref_text, hyp_t); wm_fail = []; lead_flags = []
        if tw:                                  # timing + leading-artifact checks (word timestamps from the same model)
            words = wm.whisper_words(yt, m); sil = wm.silences(yt); plain_ref = " ".join(norm(LEAD.sub("", ref_text, count=1), ign))
            for k in tw:
                mm = wm.measure(words, sil, plain_ref, "".join(norm(k)), [], spelling(PRON[k], voice), dur); vv = wm.verdict(mm, dur, l.get("max_sec", 9), None)
                wm_fail += [f"{k}: {n}" for key, n in (("b_frag", "fragmented"), ("c_nosilence", "pause inside the word"), ("d_noletters", "spelled-out letters")) if not vv[key]]
            ld = wm.lead_of(f, words, plain_ref); lead_flags = ld["flags"]
            if lead_flags and not f.endswith("_lf.wav") and any(fl.split()[0].rstrip(":") in ("burst", "lead_in", "click") for fl in lead_flags):
                yn, srn = librosa.load(f, sr=None, mono=True); y2, info = word_lead.fix_lead(yn, srn, ld["word_start"])
                lf = f[:-4] + "_lf.wav"; wm.write_wav(lf, y2, srn); files.append(lf)
            strict = strict and not wm_fail and not lead_flags
        ok = e <= allowed and strict and 0.3 <= dur <= l.get("max_sec", 9) * TEMPO_MAX and float(np.abs(y).max()) > 0.02
        res.append(dict(file=f, heard=hyp_t, heard_plain=plain, errors=e, allowed=allowed, sec=round(dur, 2), ok=ok, strict_ok=strict, pron=ev, spelled=sp_, wm_fail=wm_fail, lead_flags=lead_flags))
    good = [r for r in res if r["ok"]]
    if good:
        med = float(np.median([r["sec"] for r in good]))
        pick = min(good, key=lambda r: (r["errors"], abs(r["sec"] - med)))
    else:       # nothing passes: prefer takes whose words AND pronunciation are right (length-only failures), shortest first
        lenonly = [r for r in res if r["errors"] <= r["allowed"] and r["strict_ok"]]
        pick = min(lenonly, key=lambda r: r["sec"]) if lenonly else min(res, key=lambda r: (r["errors"], not r["strict_ok"], r["sec"]))
    reason = None if good else ("length only" if any(r["errors"] <= r["allowed"] and r["strict_ok"] for r in res) else "pronunciation/words")
    out = dict(id=i, text=ref_text, status="pass" if good else "FAIL", fail_reason=reason, pick=pick["file"], takes=res)
    json.dump(out, open(f"{a.qa_dir}/{i}.json", "w"), indent=1)
    summ[i] = dict(status=out["status"], fail_reason=reason, pick=pick["file"], heard=pick["heard"], heard_plain=pick.get("heard_plain"), errors=pick["errors"], sec=pick["sec"], pron=pick.get("pron", []))
    print(i, out["status"], reason or "", pick["errors"], pick["sec"], "|", pick["heard"], "|", "; ".join(f"{e['word']}: heard '{e['heard']}' -> {e['match'] or 'NO MATCH'}" for e in pick.get("pron", [])), flush=True)
json.dump(summ, open(f"{a.qa_dir}/summary.json", "w"), indent=1)
print("FAILS:", [k for k, v in summ.items() if v["status"] != "pass"])
