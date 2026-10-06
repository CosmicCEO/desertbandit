#!/usr/bin/env python3
"""Pronunciation helpers shared by gen_lines.py, qa_check.py and word_lab.py (pure Python, no torch).

Copied from Desert Ranger (issue #28 there). Desert Bandit keeps the shared respelling table in tools/audio/pronunciations.json
(the Desert Ranger entries these lines need; load_table()). It maps a written word to
    {"default": "ocotiyo", "senior_ranger": "...", "ranger_273": "..."}      (voice keys optional)
and the spelling sent to the voice is: per-voice override, else default.  (A bare string is accepted as a default-only entry, which is also the
shape of the per-line "pronounce" dicts.)

FORMAT RULES, enforced by --check: a respelling is letters a-z only, either all lowercase ("ocotiyo") or Title-case ("Ocotiyo").
No hyphens, no capitals beyond the first letter, no digits, no apostrophes, no spaces.  Reason (see tools/audio/word_lab.py report): Chatterbox's
tokenizer spells a capital run letter by letter ("VAYA" -> V A Y A) and treats "-" as a punctuation token, i.e. a pause inside the word.
Syllables are expressed by spelling ("vayaseetoe"), not by punctuation or capitals.  speak() is therefore a pass-through.

usage: python3 tools/audio/pron.py --check      # exit 1 if any respelling or any generated TTS substitution breaks the rules
                                                # (--check --lines also checks the legacy per-line "pronounce" retake dicts)
       python3 tools/audio/pron.py --selftest   # proves the check really fails on bad entries (hyphen, caps, digit, apostrophe, space, non-ASCII)"""
import json, os, re, sys

TABLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pronunciations.json")

def load_table():
    """The shared respelling table (keys starting with '_' are comments)."""
    return {k: v for k, v in json.load(open(TABLE)).items() if not k.startswith("_")}

VOICES = ("senior_ranger", "ranger_273")           # voices that may carry a per-voice override (the two place-name voices)
GOOD = re.compile(r"^(?:[a-z]+|[A-Z][a-z]+)$")      # lowercase or Title-case, letters a-z only

def speak(v):
    """Pass-through: respellings are already in a form Chatterbox reads as one word (no hyphen splitting, no case folding)."""
    return v

def entry(v):
    """-> {'default': str, <voice>: str ...} for a table value (dict or bare string)."""
    return {"default": v} if isinstance(v, str) else dict(v)

def spelling(v, voice=None):
    """The respelling to send for this table value and voice: per-voice override > default."""
    e = entry(v)
    return speak(e.get(voice) or e["default"])

def spellings(v):
    """Every distinct respelling an entry can produce (default plus overrides)."""
    return list(dict.fromkeys(speak(s) for s in entry(v).values()))

def apply(text, table, voice=None):
    for k, v in table.items():
        s = spelling(v, voice)
        text = re.sub(r"\b" + re.escape(k) + r"\b", lambda m: s, text, flags=re.I)
    return text

def bad_spelling(s):
    """-> reason string if s breaks the format rules, else None."""
    if not isinstance(s, str) or not s: return "empty or not a string"
    if "-" in s: return "hyphen"
    if re.search(r"\d", s): return "digit"
    if "'" in s or "’" in s: return "apostrophe"
    if re.search(r"[A-Z]{2,}", s): return "capital run"
    if re.search(r"[^A-Za-z]", s): return "non-letter"
    if not GOOD.match(s): return "capitals beyond the first letter"
    return None

def check(D, lines=False):
    """-> (n_respellings_checked, [problems]) for a loaded audio-lines document.
    Always checked: the shared table (and pronunciation_alternatives), and the text gen_lines.py sends for every line (table applied per voice).
    lines=True (--lines) also checks the legacy per-line "pronounce" retake dicts; those are only sent with gen_lines.py --pron, which skips any
    entry that fails bad_spelling(), so a bad one can never reach the voice."""
    bad = []; n = 0
    table = D.get("pronunciations", {})
    sets = [("pronunciations", table)]
    if D.get("pronunciation_alternatives"): sets.append(("pronunciation_alternatives", D["pronunciation_alternatives"]))
    if lines: sets += [(l["id"] + ".pronounce", l["pronounce"]) for l in D.get("lines", []) if l.get("pronounce")]
    for name, t in sets:
        for k, v in t.items():
            if not isinstance(v, str) and (not isinstance(v, dict) or "default" not in v):
                bad.append((name, k, v, "entry must be a string or {default, senior_ranger?, ranger_273?}")); continue
            if isinstance(v, dict):
                for vk in v:
                    if vk != "default" and vk not in VOICES: bad.append((name, k, vk, "unknown voice key"))
            for voice, s in entry(v).items():
                n += 1
                r = bad_spelling(speak(s))
                if r: bad.append((name, k + "." + voice, s, r))
    for l in D.get("lines", []):     # the text that would really reach the TTS
        base = l.get("tts_text", l["text"])
        for t, how in [(apply(base, table, l["character"]), "shared table")] + ([(apply(base, l.get("pronounce", {}), l["character"]), "line pronounce")] if lines else []):
            for m in re.finditer(r"\b[A-Z]{2,}\b", t):
                if m.group() != "OK": bad.append((l["id"], "tts " + how, m.group(), t))   # acronyms like VIP are spelled "V I P" on purpose
        for k, v in table.items():           # every substituted word in this line must be the clean spelling that was checked above
            if re.search(r"\b" + re.escape(k) + r"\b", base, re.I):
                s = spelling(v, l["character"]); r = bad_spelling(s)
                if r: bad.append((l["id"], "tts substitution " + k, s, r))
    return n, bad

def selftest():
    good = {"Ocotillo": {"default": "ocotiyo", "senior_ranger": "Ocotiyo"}, "Olla": "oya"}
    bads = {"hyphen": "vaya-see-toe", "capital run": "VAYASEETOE", "digit": "ranger2", "apostrophe": "o'ya", "mixed caps": "vayaSeeToe",
            "space": "vaya see toe", "non-ascii": "café", "title with hyphen": "Vaya-See-Toe", "empty": ""}
    fails = 0
    for name, s in bads.items():
        r = bad_spelling(s); ok = r is not None; fails += not ok
        print(("ok  " if ok else "FAIL"), f"bad entry {name!r}: {s!r} -> {r}")
    for s in ("ocotiyo", "Ocotiyo", "yacky", "a"):
        ok = bad_spelling(s) is None; fails += not ok; print(("ok  " if ok else "FAIL"), f"good entry {s!r} accepted")
    doc = lambda tbl: {"pronunciations": tbl, "lines": [{"id": "x", "character": "senior_ranger", "text": "Ocotillo Wells"}]}
    n, p = check(doc(good)); ok = not p; fails += not ok; print(("ok  " if ok else "FAIL"), "good table passes check()", p)
    for name, tbl in (("hyphen in default", {"Ocotillo": {"default": "oco-tiyo"}}), ("caps in per-voice", {"Ocotillo": {"default": "ocotiyo", "ranger_273": "OCOTIYO"}}),
                      ("digit", {"Ocotillo": "oco2yo"}), ("unknown voice key", {"Ocotillo": {"default": "ocotiyo", "dispatch": "ocotiyo"}})):
        n, p = check(doc(tbl)); ok = bool(p); fails += not ok; print(("ok  " if ok else "FAIL"), f"bad table ({name}) fails check()", len(p), "problem(s)")
    assert apply("Ocotillo Wells", {"Ocotillo": {"default": "ocotiyo", "ranger_273": "Ocotiyo"}}, "ranger_273") == "Ocotiyo Wells"
    assert apply("Ocotillo Wells", {"Ocotillo": {"default": "ocotiyo", "ranger_273": "Ocotiyo"}}, "senior_ranger") == "ocotiyo Wells"
    assert speak("vaya-see-toe") == "vaya-see-toe"
    print("selftest", "FAIL" if fails else "OK"); return 1 if fails else 0

if __name__ == "__main__":
    if "--selftest" in sys.argv: sys.exit(selftest())
    D = json.load(open("docs/audio-lines.json")); D["pronunciations"] = load_table(); n, bad = check(D, "--lines" in sys.argv)
    print(n, "respellings checked;", "FAIL" if bad else "OK")
    for b in bad: print("  ", b)
    sys.exit(1 if bad else 0)
