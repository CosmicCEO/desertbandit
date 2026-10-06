#!/usr/bin/env python3
"""Chatterbox venv (Python 3.11). Generate N takes per line from docs/audio-lines.json (Desert Bandit; adapted from Desert Ranger).
usage: python tools/audio/gen_lines.py [--ids call-bust-a,call-bust-b] [--moments bust,lock] [--chars r55] [--takes 3]
                                       [--seed0 1] [--device auto|mps|cpu] [--ex 0.6] [--cfg 0.65] [--force]
The voice reads the line's tts_text (else text) with the respelling table tools/audio/pronunciations.json applied.
References: <work>/refs/<character>.wav (a symlink to Desert Ranger's audio-work/refs; the voices are not remade here).
writes <work>/takes/<id>/s<seed>.wav (24 kHz mono) + <work>/takes.jsonl. Resumable: existing takes are skipped.
<work> = $BANDIT_AUDIO_WORK, default audio-work-bandit (gitignored). Run from the repo root."""
import argparse, json, os, sys, time, warnings; warnings.filterwarnings("ignore")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch, torchaudio as ta
from pron import apply as apply_pron, load_table   # respellings are a-z only (no hyphen, no capital run): Chatterbox spells capitals letter by letter and pauses at dashes
from chatterbox.tts import ChatterboxTTS
WORK = os.environ.get("BANDIT_AUDIO_WORK", "audio-work-bandit")
p = argparse.ArgumentParser()
p.add_argument("--ids"); p.add_argument("--moments"); p.add_argument("--chars")
p.add_argument("--takes", type=int, default=3); p.add_argument("--seed0", type=int, default=1)
p.add_argument("--device", default="auto")
p.add_argument("--ex", type=float); p.add_argument("--cfg", type=float); p.add_argument("--force", action="store_true")
a = p.parse_args()
L = json.load(open("docs/audio-lines.json"))["lines"]; PRON = load_table(); CAST = json.load(open("tools/audio/cast.json"))
TAKES = f"{WORK}/takes"
sel = [l for l in L if (not a.ids or l["id"] in a.ids.split(","))
       and (not a.moments or l["moment"] in a.moments.split(","))
       and (not a.chars or l["character"] in a.chars.split(","))]
torch.set_num_threads(max(4, (os.cpu_count() or 8) // 2))
def load(dev):
    return ChatterboxTTS.from_pretrained(device=dev)
dev = a.device if a.device != "auto" else ("mps" if torch.backends.mps.is_available() else "cpu")
m = load(dev); print("device", dev, "lines", len(sel), flush=True)
os.makedirs(WORK, exist_ok=True); log = open(f"{WORK}/takes.jsonl", "a")
def tts_text(l):
    return apply_pron(l.get("tts_text", l["text"]), PRON, l["character"])   # shared table value = {default, senior_ranger?, ranger_273?}: per-voice override > default
for l in sel:
    c = CAST[l["character"]]
    ref = f"{WORK}/refs/{l['character']}.wav"
    g = l.get("gen", {})   # optional per-line settings; CLI flags win
    ex = a.ex if a.ex is not None else g.get("ex", c["ex"]); cfg = a.cfg if a.cfg is not None else g.get("cfg", c["cfg"])
    cap = l.get("max_sec", 3.0) * 1.8 + 0.5           # runaway guard (Chatterbox occasionally babbles on)
    os.makedirs(f"{TAKES}/{l['id']}", exist_ok=True)
    for s in range(a.seed0, a.seed0 + a.takes):
        fn = f"{TAKES}/{l['id']}/s{s}.wav"
        if os.path.exists(fn) and not a.force: continue
        torch.manual_seed(s); t0 = time.time()
        try:
            w = m.generate(tts_text(l), audio_prompt_path=ref, exaggeration=ex, cfg_weight=cfg, temperature=c.get("temp", 0.8))
        except (RuntimeError, NotImplementedError) as e:
            if dev != "mps": raise
            print("MPS failed -> falling back to CPU:", repr(e)[:200], flush=True)
            dev = "cpu"; del m; m = load("cpu"); torch.manual_seed(s)
            w = m.generate(tts_text(l), audio_prompt_path=ref, exaggeration=ex, cfg_weight=cfg, temperature=c.get("temp", 0.8))
        w = w[:, :int(m.sr * cap)].cpu()
        ta.save(fn, w, m.sr)
        rec = dict(id=l["id"], take=f"s{s}", file=fn, ref=ref, ex=ex, cfg=cfg, seed=s, device=dev,
                   sec=round(w.shape[-1] / m.sr, 2), gen_s=round(time.time() - t0, 1), text=tts_text(l))
        log.write(json.dumps(rec) + "\n"); log.flush(); print(rec, flush=True)
