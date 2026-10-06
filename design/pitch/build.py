# Desert Bandit pitch sheet, 2 pages (8.5 x 11 in): page 1 the concept, page 2 the plan.
# Same look as the Desert Ranger sheets (palette, fonts, hand-drawn edges, comic burst, stamp, milestone tracker).
# Run via design/pitch/make.sh (renders to new dated files). Art and fonts are gitignored: run tools/link-pitch-art.sh once.
import math, random, pathlib
random.seed(7)
HERE = pathlib.Path(__file__).parent
A = "../art"
FOOT = "Based on the Desert Ranger board by Jeffery Price, R273. &nbsp;·&nbsp; © 2026 Jerod Price. All rights reserved. As of Oct 6, 2026."
CHECK = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M4 11.5 L9 16.5 L18 5.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
FRAME = '''<div class="paper"></div>
<svg class="grain" width="816" height="1056"><rect width="100%" height="100%" filter="url(#noise)"/></svg>
<div class="frame"></div><div class="frame2"></div>'''


def path(pts):
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z"


def starburst(left, top, w, h, html, rot=0, fs=22):
    cx, cy = w / 2, h / 2
    pts = []
    n = 26
    for i in range(n):
        t = 2 * math.pi * i / n
        r = 1.0 if i % 2 == 0 else 0.70
        r *= random.uniform(0.9, 1.0) if i % 2 == 0 else random.uniform(0.95, 1.05)
        pts.append((cx + (w / 2 - 5) * r * math.cos(t), cy + (h / 2 - 5) * r * math.sin(t)))
    d = path(pts)
    return f'''<div class="bal" style="left:{left}px;top:{top}px;width:{w}px;height:{h}px;transform:rotate({rot}deg)">
<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}"><path d="{d}" fill="#C3623B" transform="translate(5,6)"/><path d="{d}" fill="#F2B640" stroke="#1d1712" stroke-width="3.5" stroke-linejoin="round"/></svg>
<div class="baltxt burst" style="font-size:{fs}px">{html}</div></div>'''


def miles(items):
    out = ""
    for i, (done, t, t2) in enumerate(items):
        dot = CHECK if done else str(i + 1)
        out += f'<div class="m{" done" if done else ""}"><div class="dot">{dot}</div><div class="t">{t}</div>' + (f'<div class="t2">{t2}</div>' if t2 else "") + '</div>'
    return f'<div class="miles"><div class="track"></div><div class="mrow">{out}</div></div>'


# the owner's six reel symbols (icon file, caption, what three of a kind pays)
REELS = [("olla", "Olla", "$1,000"), ("sunset-mountain", "Sunset Mountain", "$600"), ("numeral-17-palms", "17 Palms", "$500"),
         ("sheep", "Sheep", "$400"), ("palm-trees", "Palm Trees", "$300"), ("dos-cabezas", "Dos Cabezas", "$200")]
reel_html = "".join(f'<div class="reel"><div class="face"><img src="{A}/icons/{s}-color.png"></div><b>{n}</b><span>3 of a kind: {v}</span></div>' for s, n, v in REELS)

# four rigs racing the old board: (piece, name, percent along the road)
RACERS = [("bronco-orange", "Marigold", 74), ("jeep-red", "Red Rocket", 52), ("buggy-blue", "Blue Buggy", 33), ("rail-purple", "Purple Rail", 12)]
racer_html = "".join(f'<div class="racer" style="left:calc({p}% - 40px)"><img src="{A}/pieces/{s}.png"><span>{n}</span></div>' for s, n, p in RACERS)

page1 = f'''<section class="sheet">
{FRAME}
<div class="page">
  <div class="kicker">A NEW GAME · SAME DESERT · ANZA-BORREGO</div>
  <h1>DESERT<br>BANDIT</h1>
  <div class="sub">A six-reel slot machine you race on the old paper board.</div>
  {starburst(344, -2, 190, 150, "PULL!<br>LOCK!<br>BANK!", rot=-4, fs=24)}
  <div class="photo"><div class="tape"></div><img src="img/board-thumb.jpg"><div class="cap">The old paper board is the race track</div></div>
  <div class="intro">The rangers of Desert Ranger are after the <b>Bandit's loot</b>. Six reels spin, you keep the symbols that score, and your rig drives from <b>Start</b> toward <b>Finish</b> as your bank grows. The same <b>52 real places</b>, the same hand-drawn doodles, the same radio crackle: <i>"R TWO SEVEN THREE, the machine is down."</i></div>

  <div class="tech machine"><div class="bg"></div>
    <h3>THE MACHINE · SIX REELS, SIX DOODLES FROM YOUR BOARD</h3>
    <div class="reels">{reel_html}</div>
  </div>

  <div class="cols">
    <div class="card plays"><div class="bg"></div>
      <h2><img src="{A}/icons/dice-color.png">How a turn plays</h2>
      <ul>
        <li><b>Draw a goal card,</b> then roll all six reels.</li>
        <li><b>Lock what scores,</b> then roll the rest again for more, or <b>bank</b> it.</li>
        <li><b>Roll nothing that scores</b> and the turn's stake is gone.</li>
        <li><b>Race to a total you pick,</b> $2,500 to $15,000. Play money only.</li>
        <li><b>2 to 4 players,</b> each on their own phone. Any seat can be a computer.</li>
      </ul>
    </div>
    <div class="card special"><div class="bg"></div>
      <h2><img src="{A}/icons/star-color.png">Six goal cards</h2>
      <ul>
        <li class="lead">Named for squares on your board. Each turn draws one.</li>
        <li><b>Found an Olla:</b> a sweep earns a $300 to $500 bonus.</li>
        <li><b>Vehicle Breaks Down:</b> your turn is skipped.</li>
        <li><b>Ground Fire Report:</b> bank $1,000 or more for a bonus.</li>
        <li><b>Off-Road Bust:</b> no banking; a sweep pays double.</li>
        <li><b>Subpoena:</b> your bank takes $100 from the leader.</li>
        <li><b>Reports Overdue:</b> two sweeps in a row pay big.</li>
      </ul>
    </div>
  </div>

  <div class="racezone">
    <div class="rigtitle">YOUR RIG DRIVES THE BOARD AS YOUR BANK GROWS</div>
    <div class="road"></div>
    <div class="flag"><b>START</b></div><div class="flag fin"><b>FINISH</b></div>
    <div class="racers">{racer_html}</div>
  </div>

  <div class="bottom">
    <div class="tech"><div class="bg"></div>
      <h3>UNDER THE HOOD</h3>
      <ul>
        <li><b>Web app,</b> no download. Just open a link.</li>
        <li>Your existing <b>Apache / MySQL / PHP</b> hosting, in its own folder.</li>
        <li><b>No sign-up:</b> a name and a room code.</li>
      </ul>
    </div>
    <div class="tech"><div class="bg"></div>
      <h3>THE PLAN · DESIGN DONE</h3>
      {miles([(True, "Design", "rules, symbols"), (False, "Wave 1", "playable game"), (False, "Wave 2", "voices, polish"), (False, "Launch!", None)])}
    </div>
  </div>
  <div class="footer">{FOOT}</div>
</div>
</section>'''

page2 = f'''<section class="sheet">
{FRAME}
<div class="page">
  <div class="kicker">THE ROAD AHEAD</div>
  <h1>HOW WE<br>GET THERE</h1>
  <div class="sub">Two small waves, each one checked on your own hosting before the next.</div>
  <div class="stamp" style="top:6px"><b>DESIGN DONE</b><span>NOT BUILT YET</span></div>
  <div class="tech p2plan"><div class="bg"></div>
    <h3>THE ORDER · EACH WAVE IS ITS OWN UPDATE</h3>
    {miles([(True, "Design", "rules, symbols, pay table"), (False, "Wave 1 &middot; Playable game", "rooms, reels, board race"), (False, "Wave 2 &middot; Voices, polish", "radio calls, tuning"), (False, "Launch!", None)])}
  </div>
  <div class="p2cols">
    <div class="card done"><div class="bg"></div>
      <h2><img src="{A}/icons/court-gavel-color.png">Calls already made</h2>
      <ul>
        <li><b>Online rooms</b> with a room code, like Desert Ranger: 2 to 4 players, any seat a computer, plus a solo demo.</li>
        <li><b>Play money,</b> race to a total you pick: $2,500 to $15,000, with $5,000 as the usual.</li>
        <li><b>Your six symbols:</b> Olla, Sunset Mountain, 17 Palms, Sheep, Palm Trees and Dos Cabezas.</li>
        <li><b>Goal cards</b> named after board squares; the radio rangers call the action.</li>
      </ul>
    </div>
    <div class="card chg"><div class="bg"></div>
      <h2><img src="{A}/icons/signpost-color.png">What we need from you</h2>
      <ul>
        <li><b>Your OK for a new folder</b> next to Desert Ranger on your host, with a few new database tables (the install runs once, as before).</li>
        <li><b>Play-tests on your phones</b> after each update, iPhone first.</li>
        <li><b>A look at the pay table and goal cards</b> once it plays; we tune from your games.</li>
        <li><b>Your ears</b> for the radio lines in Wave 2.</li>
      </ul>
    </div>
    <div class="card chk"><div class="bg"></div>
      <h2><img src="{A}/icons/dice-color.png">How we keep it safe</h2>
      <ul>
        <li><b>Own folder, own tables:</b> Desert Ranger is not touched.</li>
        <li><b>Fair by design:</b> the server rolls the reels, so nothing can be tampered with from a phone.</li>
        <li><b>The same checks as Desert Ranger:</b> rule tests, full computer-played games, browser tests, and the live-site check with zero failures.</li>
        <li><b>Sounds</b> are free to use or made for the game, and credited.</li>
      </ul>
      <div class="p2note">Not confirmed yet: Android phones, and Safari on a computer.</div>
    </div>
    <div class="card nxt"><div class="bg"></div>
      <h2><img src="{A}/icons/olla-color.png">After Wave 2</h2>
      <ul>
        <li><b>Tune from your play:</b> payouts and game length (we expect about 10 to 15 minutes for a $5,000 game).</li>
        <li><b>Maybe:</b> computer rivals with personalities, and places for second and third.</li>
        <li><b>All along:</b> Desert Ranger keeps running, untouched, while this is built.</li>
        <li><b>Then:</b> launch.</li>
      </ul>
    </div>
  </div>
  <div class="footer">{FOOT}</div>
</div>
</section>'''

CSS = '''
@font-face{font-family:Bungee;src:url(fonts/Bungee-Regular.ttf)}
@font-face{font-family:BungeeShade;src:url(fonts/BungeeShade-Regular.ttf)}
@font-face{font-family:Nunito;src:url(fonts/Nunito.ttf);font-weight:200 1000}
@font-face{font-family:Caveat;src:url(fonts/Caveat.ttf);font-weight:400 700}
@font-face{font-family:Bangers;src:url(fonts/Bangers-Regular.ttf)}
@page{size:8.5in 11in;margin:0}
:root{--cream:#F4ECD8;--ink:#3A2A1E;--terra:#C3623B;--mari:#E9A23B;--sage:#7E9168;--sagel:#C9D3B4;--sand:#E8D7B4}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:816px}
body{background:var(--cream);font-family:Nunito,sans-serif;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.paper{position:absolute;inset:0;background:
 radial-gradient(ellipse at 15% 10%,rgba(255,250,235,.7),transparent 55%),
 radial-gradient(ellipse at 90% 95%,rgba(214,186,140,.35),transparent 60%);}
.grain{position:absolute;inset:0;opacity:.18;mix-blend-mode:multiply}
.frame{position:absolute;inset:14px;border:2.5px solid var(--ink);border-radius:14px;filter:url(#rough)}
.frame2{position:absolute;inset:20px;border:1.2px solid var(--terra);border-radius:10px;filter:url(#rough)}
.page{position:absolute;inset:36px;}
.sheet{position:relative;width:816px;height:1056px;overflow:hidden;break-after:page}
.sheet:last-of-type{break-after:auto}
.kicker{font-family:Bungee;font-size:11px;letter-spacing:3px;color:var(--sage)}
h1{font-family:Bungee;font-size:56px;line-height:.9;color:var(--terra);text-shadow:3px 3px 0 var(--mari),5.5px 5.5px 0 var(--ink);letter-spacing:1px;margin-top:6px}
.sub{font-family:Nunito;font-weight:800;font-size:16.5px;line-height:1.25;margin-top:13px;color:var(--ink);max-width:330px}
.intro{position:absolute;top:214px;left:0;right:0;font-size:12.6px;line-height:1.5}
.intro b{color:var(--terra)}
.intro i{font-family:Caveat;font-style:normal;font-weight:700;font-size:16px;color:#6d4a2f}
.photo{position:absolute;right:4px;top:6px;width:212px;transform:rotate(2.5deg);background:#fffaf0;padding:8px 8px 30px;box-shadow:2px 4px 10px rgba(60,40,20,.28);}
.photo img{width:100%;display:block;border-radius:3px}
.photo .cap{position:absolute;bottom:5px;left:0;right:0;text-align:center;font-family:Caveat;font-weight:700;font-size:15px;color:#5a3d26}
.tape{position:absolute;width:64px;height:20px;background:rgba(233,162,59,.55);top:-10px;left:74px;transform:rotate(-4deg)}
.bal{position:absolute;transform-origin:50% 50%}
.bal svg{position:absolute;left:0;top:0;overflow:visible}
.baltxt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;font-family:Bangers;letter-spacing:.8px;line-height:1.02;color:#1d1712}
.burst{color:#1d1712;transform:rotate(-2deg)}
.card{position:relative;padding:16px 16px 12px 18px;border-radius:12px}
.card .bg{position:absolute;inset:0;border:2px solid var(--ink);border-radius:12px;filter:url(#rough)}
.card.plays .bg,.card.done .bg{background:rgba(201,211,180,.45)}
.card.special .bg,.card.chg .bg{background:rgba(233,162,59,.16)}
.card.chk .bg{background:rgba(214,227,230,.55)}
.card.nxt .bg{background:rgba(255,250,238,.8)}
h2{font-family:Bungee;font-size:17px;letter-spacing:.5px;color:var(--ink);display:flex;align-items:center;gap:8px;position:relative}
h2 img{height:30px}
ul{list-style:none;margin-top:9px;position:relative}
li{font-size:12.4px;line-height:1.38;padding-left:22px;position:relative;margin-bottom:7px}
li::before{content:"";position:absolute;left:2px;top:4px;width:11px;height:11px;border-radius:50%;background:var(--terra);box-shadow:inset -2px -2px 0 rgba(0,0,0,.18)}
.plays li::before,.done li::before{background:var(--sage)}
.card.chk li::before{background:#5f8693}
.card.nxt li::before{background:var(--mari)}
li b{font-weight:800}
.tech{position:relative;padding:13px 16px}
.tech .bg{position:absolute;inset:0;border:2px solid var(--ink);border-radius:12px;background:rgba(255,250,238,.75);filter:url(#rough)}
h3{font-family:Bungee;font-size:13.5px;position:relative;color:var(--sage);letter-spacing:.4px}
.tech ul{margin-top:7px}
.tech li{font-size:11.6px;margin-bottom:4px}
.tech li::before{background:var(--mari);width:9px;height:9px;top:4px}
.miles{position:relative;margin-top:14px}
.track{position:absolute;left:18px;right:18px;top:17px;border-top:3px dashed var(--terra)}
.mrow{display:grid;grid-template-columns:repeat(4,1fr);position:relative}
.m{text-align:center}
.m .dot{width:36px;height:36px;margin:0 auto;border-radius:50%;background:var(--mari);border:2.5px solid var(--ink);font-family:Bungee;font-size:15px;line-height:31px;color:var(--ink)}
.m:last-child .dot{background:var(--terra);color:#fff}
.m div.t{font-size:11.2px;font-weight:800;line-height:1.2;margin-top:6px}
.m.done .dot{background:var(--sage);font-size:0}
.m.done .dot svg{display:block;margin:5px auto 0}
.m .t2{font-family:Caveat;font-weight:700;font-size:13.5px;line-height:1;color:var(--terra);margin-top:2px}
.footer{position:absolute;left:0;right:0;bottom:-8px;text-align:center;font-size:10px;color:#6d5a48;letter-spacing:.3px}
.stamp{position:absolute;right:14px;top:-9px;transform:rotate(4deg);border:2.5px solid var(--terra);border-radius:9px;padding:3px 10px 4px;color:var(--terra);font-family:Bungee;text-align:center;line-height:1.1;background:rgba(244,236,216,.55);box-shadow:inset 0 0 0 2px rgba(195,98,59,.22);filter:url(#rough)}
.stamp b{display:block;font-size:11.5px;letter-spacing:.8px;font-weight:normal}
.stamp span{font-size:8px;letter-spacing:1.6px}
.p2note{font-family:Caveat;font-weight:700;font-size:15px;color:#6d4a2f;position:absolute;left:19px;right:12px;bottom:9px;line-height:1.05}
/* page 1: machine, columns, race, bottom */
.machine{position:absolute;top:296px;left:0;right:0;height:158px}
.reels{position:relative;display:grid;grid-template-columns:repeat(6,1fr);gap:9px;margin-top:9px}
.reel{background:#fff;border:2px solid var(--ink);border-radius:11px;text-align:center;padding:4px 2px 5px;box-shadow:0 3px 0 var(--ink)}
.reel .face{height:62px;display:flex;align-items:center;justify-content:center}
.reel img{max-width:84%;max-height:60px;object-fit:contain}
.reel b{display:block;font-family:Bungee;font-size:9.4px;letter-spacing:.2px;font-weight:normal;margin-top:1px}
.reel span{display:block;font-size:9.4px;color:#6d4a2f;font-weight:700}
.cols{position:absolute;top:468px;left:0;right:0;display:grid;grid-template-columns:1fr 1fr;gap:22px}
.cols .card{height:238px}
.cols h2{font-size:15.5px}
.cols li{font-size:12.2px;line-height:1.32;margin-bottom:6px}
.cols li.lead{font-family:Caveat;font-weight:700;font-size:15px;color:#6d4a2f;padding-left:2px;margin-bottom:5px}
.cols li.lead::before{display:none}
.racezone{position:absolute;top:714px;left:0;right:0;height:112px}
.rigtitle{position:absolute;left:0;top:0;font-family:Bungee;font-size:14px;color:var(--terra)}
.road{position:absolute;left:-6px;right:-6px;top:56px;height:40px;background:var(--sand);border-radius:20px;filter:url(#rough);border:2px dashed rgba(58,42,30,.35)}
.racers{position:absolute;left:44px;right:60px;top:24px;height:80px}
.racer{position:absolute;top:0;width:80px;text-align:center}
.racer img{width:80px;height:56px;object-fit:contain;filter:drop-shadow(1px 2px 0 rgba(58,42,30,.25))}
.racer span{display:block;font-family:Bungee;font-size:8.6px;margin-top:2px}
.flag{position:absolute;top:60px;font-family:Bungee;font-size:10px;color:var(--terra);left:6px}
.flag.fin{left:auto;right:6px}
.bottom{position:absolute;top:834px;left:0;right:0;height:108px;display:grid;grid-template-columns:1fr 1fr;gap:22px}
/* page 2 */
.p2plan{position:absolute;top:226px;left:0;right:0;height:134px}
.p2plan .m div.t{font-size:11px}
.p2cols{position:absolute;top:372px;left:0;right:0;display:grid;grid-template-columns:1fr 1fr;gap:18px 22px}
.p2cols .card{height:282px;padding:15px 15px 10px 17px}
.p2cols li{font-size:13.5px;line-height:1.38;margin-bottom:8px}
.p2cols h2{font-size:16.5px}
'''

DEFS = '''<svg width="0" height="0" style="position:absolute"><defs>
<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter>
<filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="5"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.35  0 0 0 0 0.2  0 0 0 1.2 -0.35"/></filter>
</defs></svg>'''

html = f'<!doctype html><html><head><meta charset="utf-8"><title>Desert Bandit pitch</title><style>{CSS}</style></head><body>\n{DEFS}\n{page1}\n{page2}\n</body></html>'
(HERE / "desert-bandit-pitch.html").write_text(html)
print("wrote desert-bandit-pitch.html")
