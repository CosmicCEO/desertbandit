#!/usr/bin/env python3
"""Any Python 3. Write desertbandit/audio/review.html: ONE self-contained page (audio embedded as data URIs, plain ES5, no XHR,
no server) for the owner to listen to the new radio lines and mark Keep / Redo (Desert Bandit; replaces Desert Ranger's build_review.py).
Grouped by moment. Each line: play (as shipped), play on air (click, voice over the hiss, squelch, as the game does it),
character, text, what Whisper heard, QA result, length / loudness / size, Keep / Redo and a note (saved in localStorage).
Each moment: "Play a sample action" (cycles through the moment's variants on air). Export copies {keep:[ids], redo:[ids], notes:{id: note}}.
Needs the Desert Ranger radio fx linked (bash tools/link-game-audio.sh). Not deployed (owner's listening page only).
usage: python3 tools/audio/build_review.py"""
import base64, html, json, os
WORK = os.environ.get("BANDIT_AUDIO_WORK", "audio-work-bandit")
OUT = "desertbandit/audio"
D = json.load(open("docs/audio-lines.json")); MOMENTS = D["moments"]
man = json.load(open(f"{OUT}/manifest.json"))["clips"]
qa = json.load(open(f"{WORK}/qa/summary.json")) if os.path.exists(f"{WORK}/qa/summary.json") else {}
def b64(path): return "data:audio/mpeg;base64," + base64.b64encode(open(path, "rb").read()).decode()
FX = ["radio-click-01", "radio-squelch-01", "radio-squelch-02", "radio-squelch-03", "radio-hiss-loop"]
audio = {k: b64(f"{OUT}/{man[k]['file']}") for k in FX}
NAMES = {"dispatch": "Dispatch", "senior_ranger": "Senior Ranger", "ranger_273": "Ranger 273", "r55": "R55"}
CARDS = {"sweep": "Found an Olla", "fire": "Ground Fire Report", "offroad": "Off-Road Bust", "subpoena": "Subpoena", "overdue": "Reports Overdue"}
rows = []
for l in D["lines"]:
    e = man.get(l["id"], {}); s = qa.get(l["id"], {}); ok = bool(e.get("file")) and os.path.exists(f"{OUT}/{e.get('file', '')}")
    if ok: audio[l["id"]] = b64(f"{OUT}/{e['file']}")
    rows.append(dict(id=l["id"], moment=l["moment"], variant=l["variant"], card=l.get("card"), who=NAMES[l["character"]], text=l["text"],
                     heard=s.get("heard_plain") or s.get("heard") or "", heard_hint=s.get("heard") if s.get("heard") and s.get("heard") != s.get("heard_plain") else "", qa=e.get("qa", "not made"), reason=e.get("reason", ""),
                     sec=e.get("sec"), max_sec=l.get("max_sec"), lufs=e.get("lufs"), tp=e.get("tp"), kb=round(e["bytes"] / 1024, 1) if ok else None, has=ok))
esc = lambda t: html.escape(str(t), quote=True)
h = []
h.append("""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bandit Radio Lines</title>
<style>
:root { --cream:#F4ECD8; --paper:#fffaf0; --ink:#3A2A1E; --ink2:#6d4a2f; --terra:#C3623B; --gold:#F2B640; --sage:#7E9168; --sagel:#C9D3B4; --red:#b3261e; --redl:#f6d5d1; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --cream:#1f1912; --paper:#2a2219; --ink:#f1e6d2; --ink2:#cdb79a; --terra:#e98a63; --gold:#d9a537; --sage:#9fb38a; --sagel:#3c4a30; --red:#ff8a80; --redl:#4a2420; } }
:root[data-theme="dark"] { --cream:#1f1912; --paper:#2a2219; --ink:#f1e6d2; --ink2:#cdb79a; --terra:#e98a63; --gold:#d9a537; --sage:#9fb38a; --sagel:#3c4a30; --red:#ff8a80; --redl:#4a2420; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--cream); color: var(--ink); font: 16px/1.4 Nunito, 'Avenir Next', system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 12px 16px 40px; }
h1 { font: 800 clamp(1.5rem, 6vw, 2.2rem)/1.1 'Arial Black', Impact, system-ui, sans-serif; color: var(--terra); margin: 8px 0; }
h2 { font: 800 1.1rem 'Arial Black', Impact, system-ui, sans-serif; margin: 0; text-transform: capitalize; }
.hint { color: var(--ink2); font-size: .92rem; margin: 4px 0; }
section.moment { background: var(--paper); border: 2px solid var(--ink); border-radius: 14px; box-shadow: 3px 4px 0 var(--ink); padding: 12px; margin: 16px 0; }
.mhead { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.line { border-top: 2px dashed var(--ink2); padding: 10px 0 4px; margin-top: 10px; }
.top { display: flex; gap: 8px; align-items: flex-start; }
.txt { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.txt b { font-size: 1.05rem; }
.meta { font-size: .8rem; color: var(--ink2); }
.heard { font-size: .85rem; font-style: italic; color: var(--ink2); overflow-wrap: anywhere; }
button { font: 700 .9rem system-ui, sans-serif; background: var(--gold); color: #3A2A1E; border: 2px solid var(--ink); border-radius: 10px; padding: 7px 10px; box-shadow: 0 3px 0 var(--ink); cursor: pointer; min-height: 40px; }
button:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink); }
button:disabled { opacity: .45; cursor: default; }
button.play { min-width: 44px; }
.badge { display: inline-block; font-size: .72rem; font-weight: 800; border-radius: 6px; padding: 1px 6px; border: 1px solid var(--ink); }
.b-pending-ear { background: var(--sagel); } .b-FAIL, .b-not-made { background: var(--redl); color: var(--red); }
.choice { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.choice button.keep.on { background: var(--sage); color: #fff; }
.choice button.redo.on { background: var(--red); color: #fff; }
.choice button.keep, .choice button.redo { background: var(--paper); color: var(--ink); }
.choice input { flex: 1 1 160px; min-width: 0; min-height: 40px; border: 2px solid var(--ink); border-radius: 10px; padding: 6px 8px; font: inherit; background: var(--cream); color: var(--ink); }
.bar { position: sticky; top: 0; z-index: 2; background: var(--cream); padding: 8px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-bottom: 2px solid var(--ink); }
#tally { font-weight: 700; font-size: .9rem; }
textarea { width: 100%; min-height: 7em; border: 2px solid var(--ink); border-radius: 10px; padding: 8px; font: 600 .85rem ui-monospace, Menlo, monospace; background: var(--paper); color: var(--ink); margin-top: 8px; }
.now { font-size: .85rem; color: var(--terra); font-weight: 700; min-height: 1.2em; }
</style></head><body><main>
<h1>Desert Bandit: radio lines</h1>""")
n_ok = sum(r["has"] for r in rows); n_fail = sum(1 for r in rows if not r["has"])
h.append(f"""<p class="hint">{len(rows)} new lines in {len(MOMENTS)} moments ({n_ok} made, {n_fail} not shipped). Every line passed the speech check (Whisper) but nobody has listened yet.
Press <b>&#9654;</b> for the clip as shipped, <b>On air</b> for the clip as the game plays it (click, voice over the hiss, squelch).
Mark each line <b>Keep</b> or <b>Redo</b> (a note helps the redo), then <b>Export</b> and paste the result back. Your marks stay in this browser.</p>
<div class="bar"><button id="export" type="button">Export</button><button id="stop" type="button">Stop</button><span id="tally"></span><span class="now" id="now"></span></div>
<textarea id="out" readonly aria-label="Export result" placeholder="Export puts the JSON here and copies it."></textarea>""")
for mo, desc in MOMENTS.items():
    rs = [r for r in rows if r["moment"] == mo]
    if not rs: continue
    h.append(f'<section class="moment" data-moment="{esc(mo)}"><div class="mhead"><h2>{esc(mo)}</h2>'
             f'<button type="button" class="sample" data-ids="{esc(",".join(r["id"] for r in rs if r["has"]))}">Play a sample action</button></div>'
             f'<p class="hint">{esc(desc)}</p>')
    for r in rs:
        tag = f' &middot; card: {esc(CARDS.get(r["card"], r["card"]))}' if r["card"] else ""
        stats = (f'{r["sec"]:.2f} s (max {r["max_sec"]}) &middot; {r["lufs"]} LUFS &middot; {r["tp"]} dBTP &middot; {r["kb"]} KB') if r["has"] else esc(r["reason"] or "no clip")
        dis = "" if r["has"] else " disabled"
        h.append(f'<div class="line" data-id="{esc(r["id"])}"><div class="top">'
                 f'<button type="button" class="play" data-id="{esc(r["id"])}" aria-label="Play {esc(r["id"])}"{dis}>&#9654;</button>'
                 f'<button type="button" class="air" data-id="{esc(r["id"])}"{dis}>On air</button>'
                 f'<div class="txt"><b>&ldquo;{esc(r["text"])}&rdquo;</b><div class="meta">{esc(r["who"])} &middot; {esc(r["id"])} (variant {esc(r["variant"])}){tag} '
                 f'<span class="badge b-{esc(r["qa"].replace(" ", "-"))}">{esc(r["qa"])}</span></div>'
                 f'<div class="heard">Whisper heard: &ldquo;{esc(r["heard"])}&rdquo;'
                 + (f' (second pass, with the line&rsquo;s capitalised words as a hint: &ldquo;{esc(r["heard_hint"])}&rdquo;)' if r["heard_hint"] else "")
                 + f'</div><div class="meta">{stats}</div></div></div>'
                 f'<div class="choice"><button type="button" class="keep" data-id="{esc(r["id"])}">Keep</button><button type="button" class="redo" data-id="{esc(r["id"])}">Redo</button>'
                 f'<input type="text" class="note" data-id="{esc(r["id"])}" placeholder="Note (what to change)" aria-label="Note for {esc(r["id"])}"></div></div>')
    h.append("</section>")
h.append("<script>var AUDIO = " + json.dumps(audio) + ";\nvar IDS = " + json.dumps([r["id"] for r in rows]) + ";\n" + r"""
(function () {
  var KEY = 'bandit_radio_review_v1', st = { mark: {}, note: {} };
  try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.mark) st = s; if (!st.note) st.note = {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} tally(); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function tally() {
    var k = 0, r = 0; for (var i in st.mark) { if (st.mark[i] === 'keep') k++; else if (st.mark[i] === 'redo') r++; }
    document.getElementById('tally').textContent = k + ' keep, ' + r + ' redo, ' + (IDS.length - k - r) + ' open';
  }
  function paint() {
    $$('.keep').forEach(function (b) { b.className = 'keep' + (st.mark[b.getAttribute('data-id')] === 'keep' ? ' on' : ''); });
    $$('.redo').forEach(function (b) { b.className = 'redo' + (st.mark[b.getAttribute('data-id')] === 'redo' ? ' on' : ''); });
  }
  // ---- audio (Web Audio, decoded lazily from the embedded data URIs) ----
  var ctx = null, bufs = {}, live = [];
  function ac() { if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; ctx = new C(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  function decode(id, cb) {
    if (bufs[id]) return cb(bufs[id]);
    var s = atob(AUDIO[id].split(',')[1]), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    ac().decodeAudioData(u.buffer, function (b) { bufs[id] = b; cb(b); }, function () { now('could not decode ' + id); });
  }
  function need(ids, cb) { var left = ids.length; ids.forEach(function (id) { decode(id, function () { if (--left === 0) cb(); }); }); }
  function trim(b) {   // MP3 padding: skip leading / trailing near-silence (as the game does)
    var d = b.getChannelData(0), n = d.length, a = 0, z = n - 1, th = 0.003;
    while (a < n && Math.abs(d[a]) < th) a++; while (z > a && Math.abs(d[z]) < th) z--;
    return { off: a / b.sampleRate, dur: Math.max(0.01, (z - a + 1) / b.sampleRate) };
  }
  function src(b, at, gain, off, dur, loop) {
    var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; g.gain.value = gain; s.connect(g); g.connect(ctx.destination);
    if (loop) { s.loop = true; s.start(at); } else s.start(at, off || 0, dur); live.push(s); return { s: s, g: g };
  }
  function stop() { live.forEach(function (s) { try { s.stop(); } catch (e) {} }); live = []; now(''); }
  function now(t) { document.getElementById('now').textContent = t; }
  function playDry(id) { stop(); need([id], function () { var b = bufs[id], t = trim(b); src(b, ctx.currentTime + 0.02, 1, t.off, t.dur); now('playing ' + id); }); }
  function onAir(id, n) {   // as the game: click at 0, voice 0.1 s later over the looped hiss (gain 0.5), squelch 20 ms after the voice
    stop(); var sq = 'radio-squelch-0' + (1 + (n || 0) % 3);
    need([id, 'radio-click-01', 'radio-hiss-loop', sq], function () {
      var t0 = ctx.currentTime + 0.05, v = bufs[id], tv = trim(v), end = 0.1 + tv.dur, tc = trim(bufs['radio-click-01']);
      src(bufs['radio-click-01'], t0, 1, tc.off, tc.dur);
      var h = src(bufs['radio-hiss-loop'], t0, 0.5, 0, 0, true);
      h.g.gain.setValueAtTime(0, t0); h.g.gain.linearRampToValueAtTime(0.5, t0 + 0.03);
      h.g.gain.setValueAtTime(0.5, t0 + end - 0.03); h.g.gain.linearRampToValueAtTime(0, t0 + end); h.s.stop(t0 + end + 0.01);
      src(v, t0 + 0.1, 1, tv.off, tv.dur);
      var ts = trim(bufs[sq]); src(bufs[sq], t0 + end + 0.02, 1, ts.off, ts.dur);
      now('on air: ' + id);
    });
  }
  var turn = {};
  $$('.play').forEach(function (b) { b.onclick = function () { playDry(b.getAttribute('data-id')); }; });
  $$('.air').forEach(function (b) { b.onclick = function () { onAir(b.getAttribute('data-id'), 0); }; });
  $$('.sample').forEach(function (b) {
    var ids = (b.getAttribute('data-ids') || '').split(',').filter(function (x) { return x; });
    if (!ids.length) { b.disabled = true; return; }
    b.onclick = function () { var k = b.getAttribute('data-ids'), i = turn[k] || 0; turn[k] = i + 1; onAir(ids[i % ids.length], i); b.textContent = 'Play a sample action (next: ' + ids[(i + 1) % ids.length] + ')'; };
  });
  document.getElementById('stop').onclick = stop;
  $$('.keep, .redo').forEach(function (b) {
    b.onclick = function () { var id = b.getAttribute('data-id'), v = b.className.indexOf('keep') === 0 ? 'keep' : 'redo'; st.mark[id] = st.mark[id] === v ? null : v; if (!st.mark[id]) delete st.mark[id]; paint(); save(); };
  });
  $$('.note').forEach(function (i) {
    var id = i.getAttribute('data-id'); i.value = st.note[id] || '';
    i.oninput = function () { if (i.value) st.note[id] = i.value; else delete st.note[id]; save(); };
  });
  document.getElementById('export').onclick = function () {
    var keep = [], redo = [], notes = {};
    IDS.forEach(function (id) { if (st.mark[id] === 'keep') keep.push(id); if (st.mark[id] === 'redo') redo.push(id); if (st.note[id]) notes[id] = st.note[id]; });
    var txt = JSON.stringify({ keep: keep, redo: redo, notes: notes }), out = document.getElementById('out'); out.value = txt;
    function fallback() { try { out.focus(); out.select(); document.execCommand('copy'); now('copied'); } catch (e) { now('select the text and copy it'); } }
    try { if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(function () { now('copied'); }, fallback); else fallback(); } catch (e) { fallback(); }
  };
  paint(); tally();
})();
</script></main></body></html>""")
open(f"{OUT}/review.html", "w").write("\n".join(h))
print("wrote", f"{OUT}/review.html", len(rows), "lines,", round(os.path.getsize(f"{OUT}/review.html") / 1024), "KB")
