#!/usr/bin/env python3
"""Build design/creatures/review.html: one self-contained page (drawings embedded as data URIs)
so the owner can open it straight from Finder, Safari or a phone with no server.

    python3 design/creatures/build_review.py [out_dir ...]

Writes review.html next to this script, and a copy into each extra out_dir.
"""
import base64, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(HERE, 'manifest.json')))

creatures = []
for c in manifest['creatures']:
    path = os.path.join(HERE, 'svg', c['id'] + '.svg')
    c = dict(c)
    if os.path.exists(path):
        c['img'] = 'data:image/svg+xml;base64,' + base64.b64encode(open(path, 'rb').read()).decode('ascii')
    else:
        c['img'] = ''
    creatures.append(c)

data = {
    'categories': manifest['categories'],
    'creatures': creatures,
    'defaults': manifest['defaults'],
    'tiers': manifest['tiers'],
}

PAGE = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desert Bandit: pick the six reel creatures</title>
<link rel="icon" href="data:,">
<style>
  :root { --cream:#F4ECD8; --paper:#fffaf0; --plate:#f6ecd0; --ink:#3A2A1E; --ink2:#6d4a2f; --terra:#C3623B; --mari:#E9A23B; --gold:#F2B640; --sage:#7E9168; --sagel:#C9D3B4; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--cream); color: var(--ink); font: 16px/1.4 Nunito, 'Avenir Next', system-ui, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 16px; }
  h1 { font: 400 clamp(1.6rem, 5vw, 2.4rem)/1.1 Bungee, 'Arial Black', Impact, sans-serif; color: var(--terra); margin: 8px 0; }
  h2 { font: 400 1.15rem Bungee, 'Arial Black', Impact, sans-serif; margin: 24px 0 8px; }
  p { margin: 6px 0; }
  .card { background: var(--paper); border: 2px solid var(--ink); border-radius: 16px; box-shadow: 3px 4px 0 var(--ink); padding: 14px; }
  .reels { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
  @media (max-width: 640px) { .reels { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .slot { background: var(--paper); border: 2px solid var(--ink); border-radius: 12px; padding: 6px 4px 8px; text-align: center; cursor: pointer; font: inherit; color: inherit; }
  .slot.sel { outline: 4px solid var(--mari); background: #fff4d6; }
  .plate { background: var(--plate); border: 3px double var(--ink); padding: 3px; }
  .plate img { width: 100%; aspect-ratio: 1; object-fit: contain; display: block; }
  .plate.empty { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: .75rem; color: var(--ink2); }
  .slot b { display: block; font: 400 .72rem Bungee, 'Arial Black', Impact, sans-serif; margin-top: 4px; overflow-wrap: anywhere; }
  .slot span { display: block; font-size: .74rem; color: var(--ink2); }
  .tier { font-weight: 800; color: var(--terra); }
  .grey .plate img { filter: grayscale(1); }
  .tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0 0; }
  .tools button, button.act { font: 400 .9rem Bungee, 'Arial Black', Impact, sans-serif; background: var(--gold); border: 2px solid var(--ink); border-radius: 12px; padding: 8px 12px; box-shadow: 0 3px 0 var(--ink); cursor: pointer; color: var(--ink); }
  .tools button:active, button.act:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink); }
  .detail { margin-top: 10px; padding-top: 8px; border-top: 2px dashed var(--ink2); }
  .strip { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-top: 10px; }
  .strip .plate { flex: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
  .cand { background: var(--paper); border: 2px solid var(--ink); border-radius: 12px; padding: 6px; text-align: center; cursor: pointer; font: inherit; color: inherit; }
  .cand.used { background: var(--sagel); }
  .cand b { display: block; font-size: .8rem; line-height: 1.15; margin-top: 4px; }
  .cand small { display: block; font-size: .7rem; line-height: 1.15; color: var(--ink2); font-style: italic; }
  .hint { color: var(--ink2); font-size: .92rem; }
  textarea { width: 100%; min-height: 8em; border: 2px solid var(--ink); border-radius: 10px; padding: 8px; font: 600 .9rem ui-monospace, Menlo, monospace; background: #fff; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Pick the six reel creatures</h1>
  <p>Six reels, six creatures. The machine below starts with one per category. Tap a slot, then tap any creature to put it there (tapping one already on a reel swaps the two). The order sets the pay: the first reel pays the most, the last the least. Copy the list at the bottom and send it back.</p>

  <h2>The machine</h2>
  <div class="card" id="machine">
    <div class="reels" id="reels"></div>
    <div class="tools">
      <button type="button" id="up">Pays more</button>
      <button type="button" id="down">Pays less</button>
      <button type="button" id="gray">Grey test</button>
    </div>
    <div class="detail"><b id="dname"></b> <i id="dlatin"></i><p id="dfact"></p></div>
    <p class="hint">How the six look at the sizes the game will use (a face on a phone reel is about the smallest one):</p>
    <div class="strip" id="strip"></div>
  </div>

  <h2>All the creatures</h2>
  <p class="hint">Fish: the desert pupfish is the only native fish in the region, so that reel has one choice. A creature that is not drawn yet shows an empty plate.</p>
  <div id="groups"></div>

  <h2>Your pick</h2>
  <div class="card">
    <textarea id="out" readonly></textarea>
    <button class="act" id="copy" type="button">Copy the list</button>
    <span class="hint" id="msg"></span>
  </div>
</div>
<script>
(function () {
  var DATA = __DATA__;
  var byId = {}; DATA.creatures.forEach(function (c) { byId[c.id] = c; });
  var picks = DATA.defaults.slice(), sel = 0;

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
  function plate(c, px) {
    var p = el('div', 'plate' + (c.img ? '' : ' empty'));
    if (c.img) { var im = el('img'); im.src = c.img; im.alt = c.name; if (px) { im.style.width = px + 'px'; im.style.height = px + 'px'; } p.appendChild(im); }
    else { p.textContent = 'not drawn yet'; if (px) { p.style.width = (px + 10) + 'px'; } }
    return p;
  }
  function draw() {
    var reels = document.getElementById('reels'); reels.innerHTML = '';
    picks.forEach(function (id, i) {
      var c = byId[id];
      var b = el('button', 'slot' + (i === sel ? ' sel' : '')); b.type = 'button';
      b.appendChild(plate(c));
      b.appendChild(el('b', '', c.name));
      b.appendChild(el('span', 'tier', DATA.tiers[i] + ' x3'));
      b.appendChild(el('span', '', c.category));
      b.onclick = function () { sel = i; draw(); };
      reels.appendChild(b);
    });
    var cur = byId[picks[sel]];
    document.getElementById('dname').textContent = cur.name;
    document.getElementById('dlatin').textContent = cur.latin;
    document.getElementById('dfact').textContent = cur.fact;
    var strip = document.getElementById('strip'); strip.innerHTML = '';
    [96, 64, 48].forEach(function (px) { picks.forEach(function (id) { strip.appendChild(plate(byId[id], px)); }); strip.appendChild(el('div')); strip.lastChild.style.flexBasis = '100%'; });
    var groups = document.getElementById('groups'); groups.innerHTML = '';
    DATA.categories.forEach(function (cat) {
      groups.appendChild(el('h2', '', cat));
      var g = el('div', 'grid');
      DATA.creatures.filter(function (c) { return c.category === cat; }).forEach(function (c) {
        var b = el('button', 'cand' + (picks.indexOf(c.id) >= 0 ? ' used' : '')); b.type = 'button';
        b.appendChild(plate(c));
        b.appendChild(el('b', '', c.name));
        b.appendChild(el('small', '', c.latin));
        b.onclick = function () {
          var at = picks.indexOf(c.id);
          if (at >= 0) { picks[at] = picks[sel]; }
          picks[sel] = c.id; draw();
        };
        g.appendChild(b);
      });
      groups.appendChild(g);
    });
    document.getElementById('out').value = picks.map(function (id, i) {
      var c = byId[id]; return (i + 1) + '. ' + c.name + ' (' + id + ') - ' + DATA.tiers[i] + ' for three of a kind';
    }).join('\n');
  }
  function move(d) {
    var j = sel + d; if (j < 0 || j > 5) return;
    var t = picks[sel]; picks[sel] = picks[j]; picks[j] = t; sel = j; draw();
  }
  document.getElementById('up').onclick = function () { move(-1); };
  document.getElementById('down').onclick = function () { move(1); };
  document.getElementById('gray').onclick = function () { document.getElementById('machine').classList.toggle('grey'); };
  document.getElementById('copy').onclick = function () {
    var t = document.getElementById('out'); t.select();
    try { document.execCommand('copy'); document.getElementById('msg').textContent = ' Copied.'; } catch (e) { document.getElementById('msg').textContent = ' Select the text and copy it.'; }
  };
  draw();
})();
</script>
</body>
</html>
'''

html = PAGE.replace('__DATA__', json.dumps(data))
out = os.path.join(HERE, 'review.html')
open(out, 'w').write(html)
print('wrote', out, '(%d KB)' % (len(html) // 1024),
      '; drawn: %d of %d' % (sum(1 for c in creatures if c['img']), len(creatures)))
for d in sys.argv[1:]:
    os.makedirs(d, exist_ok=True)
    shutil.copy(out, os.path.join(d, 'creature-review.html'))
    print('copied to', d)
