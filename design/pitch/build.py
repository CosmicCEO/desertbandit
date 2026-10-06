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


# the owner's six reel creatures (drawing in design/creatures/svg, caption, what three of a kind pays); picked Oct 6, 2026
REELS = [("bighorn-sheep", "Bighorn Sheep", "$1,000"), ("gambels-quail", "Gambel's Quail", "$600"), ("desert-hairy-scorpion", "Hairy Scorpion", "$500"),
         ("ocotillo", "Ocotillo", "$400"), ("chuckwalla", "Chuckwalla", "$300"), ("sidewinder", "Sidewinder", "$200")]
reel_html = "".join(f'<div class="reel"><div class="face"><img src="../creatures/svg/{s}.svg"></div><b>{n}</b><span>3 of a kind: {v}</span></div>' for s, n, v in REELS)

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
  <div class="intro">The rangers of Desert Ranger are after the <b>Bandit's loot</b>. Six reels spin, you keep the symbols that score, and your rig drives from <b>Start</b> toward <b>Finish</b> as your bank grows. The same <b>52 real places</b>, the same radio crackle, and reels full of the <b>real creatures of Anza-Borrego</b>: <i>"R TWO SEVEN THREE, the machine is down."</i></div>

  <div class="tech machine"><div class="bg"></div>
    <h3>THE MACHINE · SIX REELS, SIX CREATURES OF THE DESERT</h3>
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

# ---- the look page: one turn on a phone, all paper (cardboard, tape, paper strips) ----
CRE = "../creatures/svg"


def win(main, above, below, state="", tag=""):
    """One reel window: a cardboard frame with a cutout; the paper strip shows its face and peeks of its neighbours."""
    shift = 27 if state == "spin" else 0
    top = 16 + shift
    imgs = [(above, top - 74, "f"), (main, top, "f"), (below, top + 74, "f")]
    blur = " blur" if state == "spin" else ""
    faces = "".join(f'<img class="{c}{blur}" style="top:{y}px" src="{CRE}/{n}.svg">' for n, y, c in imgs)
    cuts = "".join(f'<i class="cut" style="top:{y + shift}px"></i>' for y in (14, 88))
    streaks = '<i class="streak" style="left:10px"></i><i class="streak" style="left:30px"></i><i class="streak" style="left:55px"></i>' if state == "spin" else ""
    tagh = f'<span class="tag {state}">{tag}</span>' if tag else ""
    return (f'<div class="win {state}"><div class="wbg"></div><div class="hole">{faces}{cuts}{streaks}</div>'
            f'<span class="tp t1"></span><span class="tp t2"></span>{tagh}</div>')


def zig(x0, x1, y, amp, step=7, flip=1):
    pts, x, k = [], x0, 0
    while x <= x1:
        pts.append((x, y + (amp if k % 2 else 0) * flip))
        x += step
        k += 1
    return pts


# close-up of one reel: a paper strip taped behind a cutout in the cardboard
tp = zig(108, 228, 6, 5)
bt = zig(108, 228, 262, 5, flip=-1)
strip_pts = tp + list(reversed(bt))
strip_poly = " ".join(f"{x},{y}" for x, y in strip_pts)
closeup = f'''<svg class="closeup" width="336" height="268" viewBox="0 0 336 268">
<defs>
 <clipPath id="stripclip"><polygon points="{strip_poly}"/></clipPath>
 <pattern id="kraft" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#c4975d"/><rect width="2" height="6" fill="#b3854c" opacity=".55"/></pattern>
 <linearGradient id="hs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b230a" stop-opacity=".45"/><stop offset=".25" stop-color="#3b230a" stop-opacity="0"/><stop offset=".75" stop-color="#3b230a" stop-opacity="0"/><stop offset="1" stop-color="#3b230a" stop-opacity=".4"/></linearGradient>
</defs>
<g clip-path="url(#stripclip)">
 <rect x="104" y="0" width="128" height="268" fill="#f6ecd0"/>
 <image href="{CRE}/chuckwalla.svg" x="118" y="-44" width="100" height="100"/>
 <image href="{CRE}/bighorn-sheep.svg" x="118" y="64" width="100" height="100"/>
 <image href="{CRE}/gambels-quail.svg" x="118" y="172" width="100" height="100"/>
 <line x1="108" y1="60" x2="228" y2="60" stroke="#3A2A1E" stroke-width="1.4" stroke-dasharray="5 4"/>
 <line x1="108" y1="168" x2="228" y2="168" stroke="#3A2A1E" stroke-width="1.4" stroke-dasharray="5 4"/>
</g>
<polygon points="{strip_poly}" fill="none" stroke="#3A2A1E" stroke-width="1.8" stroke-linejoin="round"/>
<rect x="114" y="50" width="108" height="126" fill="url(#hs)"/>
<path d="M38,40 H298 V236 H38 Z M114,50 H222 V176 H114 Z" fill-rule="evenodd" fill="url(#kraft)" stroke="#3A2A1E" stroke-width="2.6" stroke-linejoin="round" filter="url(#rough)"/>
<rect x="88" y="14" width="150" height="20" fill="#E9A23B" fill-opacity=".62" stroke="#9a6a1c" stroke-opacity=".5" transform="rotate(-3 163 24)"/>
<rect x="98" y="238" width="150" height="20" fill="#E9A23B" fill-opacity=".62" stroke="#9a6a1c" stroke-opacity=".5" transform="rotate(3 173 248)"/>
<text x="44" y="96" font-family="Caveat" font-weight="700" font-size="16" fill="#3A2A1E">cardboard</text>
<text x="48" y="113" font-family="Caveat" font-weight="700" font-size="16" fill="#3A2A1E">window</text>
<text x="228" y="96" font-family="Caveat" font-weight="700" font-size="16" fill="#3A2A1E">paper strip</text>
<text x="228" y="113" font-family="Caveat" font-weight="700" font-size="16" fill="#3A2A1E">scrolls</text>
<text x="228" y="130" font-family="Caveat" font-weight="700" font-size="16" fill="#3A2A1E">up &amp; down</text>
<path d="M260,140 L260,170 M254,148 L260,140 L266,148 M254,162 L260,170 L266,162" fill="none" stroke="#3A2A1E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<text x="246" y="24" font-family="Caveat" font-weight="700" font-size="17" fill="#C3623B">taped in</text>
<path d="M243,22 C236,22 234,22 230,24" fill="none" stroke="#C3623B" stroke-width="1.8" stroke-linecap="round"/>
<text x="250" y="258" font-family="Caveat" font-weight="700" font-size="17" fill="#C3623B">torn edge</text>
<path d="M247,255 C240,254 236,254 232,252" fill="none" stroke="#C3623B" stroke-width="1.8" stroke-linecap="round"/>
</svg>'''

# the phone screen
PH_RIGS = [("bronco-orange", "Marigold", 68, "$3,400"), ("jeep-red", "Red Rocket", 47, "$2,350"),
           ("buggy-blue", "Blue Buggy", 26, "$1,300"), ("rail-purple", "Purple Rail", 5, "$250")]
# a rig's place along the road is its bank / $5,000 (road runs 22 px to 240 px across the screen)
ph_race = "".join(f'<img class="ph-rig" style="left:{22 + p * 2.18:.0f}px" src="{A}/pieces/{s}.png">' for s, n, p, v in PH_RIGS)
ph_score = "".join(f'<div class="chip{" on" if i == 0 else ""}"><img src="{A}/pieces/{s}.png"><b>{n}</b><span>{v}</span></div>' for i, (s, n, p, v) in enumerate(PH_RIGS))
ph_wins = "".join([
    win("bighorn-sheep", "chuckwalla", "sidewinder", "held", "HELD"),
    win("gambels-quail", "ocotillo", "chuckwalla", "hint", "+$50"),
    win("bighorn-sheep", "desert-hairy-scorpion", "ocotillo", "held", "HELD"),
    win("chuckwalla", "sidewinder", "gambels-quail", ""),
    win("bighorn-sheep", "gambels-quail", "chuckwalla", "held", "HELD"),
    win("ocotillo", "sidewinder", "bighorn-sheep", "spin"),
])

page_look = f'''<section class="sheet" data-png="look">
{FRAME}
<div class="page">
  <div class="kicker">WHAT IT WILL LOOK LIKE</div>
  <h1>SEE THE<br>MACHINE</h1>
  <div class="sub">A mock-up of one turn on a phone. Everything is paper: cardboard, tape and paper strips.</div>
  <div class="closewrap">{closeup}</div>
  <div class="lcards">
    <div class="card plays"><div class="bg"></div>
      <h2><img src="{A}/icons/dice-color.png">Paper strips, taped in</h2>
      <ul>
        <li>Each reel is a strip of paper taped behind a window cut in the cardboard.</li>
        <li>The reels roll, then stop one after another, left to right.</li>
      </ul>
    </div>
    <div class="card special"><div class="bg"></div>
      <h2><img src="{A}/icons/star-color.png">Tap a reel to hold it</h2>
      <ul>
        <li>A reel that scores shows a hint. Tap it and it is held with a paper label.</li>
        <li>Then roll the rest, or bank. The server rolls, so every roll is fair.</li>
      </ul>
    </div>
    <div class="card chk"><div class="bg"></div>
      <h2><img src="{A}/icons/signpost-color.png">All on one screen</h2>
      <ul>
        <li>The goal card, the stake, the race and the scores sit around the machine.</li>
        <li>Two big paper buttons: ROLL and BANK.</li>
      </ul>
    </div>
  </div>
  <div class="phone">
    <div class="bz"></div>
    <div class="scr">
      <div class="paper" style="position:absolute;inset:0"></div>
      <svg class="grain" width="336" height="756"><rect width="100%" height="100%" filter="url(#noise)"/></svg>
      <div class="pill"></div>
      <div class="ph-top"><span class="room">ROOM 7QK2</span><b>DESERT BANDIT</b><span class="snd">&#9835;</span></div>
      <div class="ph-race">{ph_race}<div class="ph-road"><span>START</span><span class="fin">$5,000</span></div></div>
      <div class="gcard"><span class="tp gt"></span>
        <img src="{A}/icons/star-color.png">
        <div><div class="gk">YOUR GOAL CARD</div><b>GROUND FIRE REPORT</b><p>You can't bank under $1,000. Bank $1,000 or more and it pays +$500.</p></div>
      </div>
      <div class="cab"><div class="cbg"></div><div class="clabel">SIX REELS &middot; TAP TO HOLD</div><div class="wins">{ph_wins}</div></div>
      <div class="stake"><div class="st"><small>THIS TURN</small><b>$1,000</b></div><p>Marigold is up.<br>Bank now for <b>$1,500</b>.</p></div>
      <div class="btn roll"><b>ROLL</b><span>3 reels</span></div>
      <div class="btn bank"><b>BANK</b><span>$1,500</span></div>
      <div class="chips">{ph_score}</div>
    </div>
  </div>
  <div class="mocknote">Mock-up: the real screen will change as we build it.</div>
  <div class="footer">{FOOT}</div>
</div>
</section>'''

page2 = f'''<section class="sheet" data-png="status">
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
        <li><b>Your six reels:</b> bighorn sheep, Gambel's quail, hairy scorpion, ocotillo, chuckwalla and sidewinder, newly drawn.</li>
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
.reel .face{height:62px;display:flex;align-items:center;justify-content:center;background:#f6ecd0;border:2px double #3A2A1E}
.reel img{max-width:100%;max-height:58px;object-fit:contain}
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
.racer img{width:80px;height:56px;object-fit:contain;transform:scaleX(-1);filter:drop-shadow(-1px 2px 0 rgba(58,42,30,.25))}
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
/* page 2 (the look): the phone mock-up and the reel close-up */
[data-png=look] h1{font-size:50px}
.closewrap{position:absolute;left:0;top:196px;width:336px;height:268px}
.closeup{display:block;overflow:visible}
.lcards{position:absolute;left:0;top:478px;width:336px;display:grid;gap:10px}
.lcards .card{height:140px;padding:13px 13px 8px 15px}
.lcards h2{font-size:14.5px}
.lcards h2 img{height:26px}
.lcards li{font-size:12.4px;line-height:1.33;margin-bottom:6px}
.phone{position:absolute;right:0;top:78px;width:360px;height:780px}
.phone .bz{position:absolute;inset:0;background:#2a1e15;border:3px solid var(--ink);border-radius:48px;filter:url(#rough);box-shadow:5px 7px 0 rgba(58,42,30,.28)}
.scr{position:absolute;left:12px;top:12px;width:336px;height:756px;border-radius:36px;overflow:hidden;background:var(--cream)}
.scr .pill{position:absolute;left:123px;top:8px;width:90px;height:20px;border-radius:10px;background:#2a1e15;z-index:3}
.ph-top{position:absolute;left:14px;right:14px;top:36px;height:26px;display:flex;align-items:center;justify-content:space-between}
.ph-top b{font-family:Bungee;font-size:14px;color:var(--terra);font-weight:normal;text-shadow:1.5px 1.5px 0 var(--mari)}
.ph-top .room{font-family:Bungee;font-size:8.5px;background:#fffaf0;border:1.8px solid var(--ink);border-radius:7px;padding:3px 6px}
.ph-top .snd{width:24px;height:24px;border-radius:50%;background:var(--mari);border:2px solid var(--ink);text-align:center;line-height:20px;font-size:13px}
.ph-race{position:absolute;left:0;right:0;top:68px;height:68px}
.ph-road{position:absolute;left:14px;right:14px;top:36px;height:26px;background:var(--sand);border-radius:13px;border:2px dashed rgba(58,42,30,.35);display:flex;align-items:center;justify-content:space-between;padding:0 8px}
.ph-road span{font-family:Bungee;font-size:7.5px;color:var(--terra)}
.ph-rig{position:absolute;z-index:2;top:12px;width:44px;height:30px;object-fit:contain;transform:scaleX(-1);filter:drop-shadow(-1px 2px 0 rgba(58,42,30,.28))}
.gcard{position:absolute;left:14px;right:14px;top:144px;height:80px;background:#fffaf0;border:2px solid var(--ink);border-radius:8px;transform:rotate(-1.2deg);box-shadow:2px 3px 6px rgba(60,40,20,.3);display:flex;align-items:center;gap:10px;padding:6px 10px}
.gcard img{width:44px;height:44px;object-fit:contain;flex:none}
.gcard .gk{font-family:Caveat;font-weight:700;font-size:13px;color:var(--terra);line-height:1}
.gcard b{display:block;font-family:Bungee;font-weight:normal;font-size:12px;line-height:1.1}
.gcard p{font-size:10px;line-height:1.25;margin-top:2px;font-weight:700;color:#5a3d26}
.tp{position:absolute;background:rgba(233,162,59,.62);border:1px solid rgba(154,106,28,.35)}
.gcard .gt{width:46px;height:14px;top:-8px;left:40%;transform:rotate(-4deg)}
.cab{position:absolute;left:14px;right:14px;top:236px;height:296px}
.cab .cbg{position:absolute;inset:0;border:2.5px solid var(--ink);border-radius:12px;background:repeating-linear-gradient(90deg,rgba(120,80,35,.16) 0 2px,transparent 2px 6px),#b78a52;filter:url(#rough)}
.cab .clabel{position:absolute;left:50%;top:8px;transform:translateX(-50%) rotate(-1deg);background:#fffaf0;border:1.8px solid var(--ink);padding:3px 9px;font-family:Bungee;font-size:8.5px;white-space:nowrap;box-shadow:1px 2px 0 rgba(58,42,30,.3)}
.wins{position:absolute;left:12px;top:36px;display:grid;grid-template-columns:repeat(3,90px);grid-auto-rows:118px;gap:9px 7px}
.win{position:relative;width:90px;height:118px}
.win .wbg{position:absolute;inset:0;border:2.2px solid var(--ink);border-radius:10px;background:repeating-linear-gradient(90deg,rgba(120,80,35,.16) 0 2px,transparent 2px 6px),#c9a06a;filter:url(#rough)}
.win.held .wbg{background:repeating-linear-gradient(90deg,rgba(60,90,40,.16) 0 2px,transparent 2px 6px),#a9bd8c}
.win .hole{position:absolute;left:6px;top:6px;width:78px;height:106px;overflow:hidden;background:#f6ecd0 repeating-linear-gradient(0deg,rgba(150,120,70,.08) 0 1px,transparent 1px 4px);border:2px solid var(--ink);border-radius:4px}
.win .hole::after{content:"";position:absolute;inset:0;background:linear-gradient(rgba(60,35,10,.42),transparent 24%,transparent 72%,rgba(60,35,10,.34));pointer-events:none}
.win .f{position:absolute;left:2px;width:70px;height:70px}
.win .f.blur{filter:url(#vblur)}
.win .cut{position:absolute;left:0;right:0;border-top:1.2px dashed rgba(58,42,30,.7)}
.win .streak{position:absolute;top:0;bottom:0;width:2px;background:rgba(58,42,30,.14)}
.win .tp{width:26px;height:10px}
.win .t1{left:-7px;top:-2px;transform:rotate(-38deg)}
.win .t2{right:-7px;bottom:-2px;transform:rotate(-38deg)}
.win .tag{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%) rotate(-3deg);background:#fffaf0;border:1.6px solid var(--ink);padding:1px 6px;font-family:Bungee;font-size:8px;white-space:nowrap;box-shadow:1px 2px 0 rgba(58,42,30,.3)}
.win.hint::before{content:"";position:absolute;inset:-5px;border:3px dashed var(--mari);border-radius:14px}
.win .tag.hint{background:var(--mari);font-family:Bangers;font-size:14px;letter-spacing:.6px;padding:0 7px;bottom:-9px}
.stake{position:absolute;left:14px;right:14px;top:542px;height:50px;display:flex;align-items:center;gap:14px}
.stake .st{background:#fffaf0;border:2.2px solid var(--ink);border-radius:9px;padding:2px 12px 3px;transform:rotate(-1.5deg);box-shadow:2px 3px 0 rgba(58,42,30,.3)}
.stake small{display:block;font-family:Bungee;font-size:7.5px;color:var(--sage);letter-spacing:.6px}
.stake .st b{font-family:Bangers;font-weight:normal;font-size:30px;line-height:.95;letter-spacing:.8px}
.stake p{font-size:10.5px;line-height:1.3;font-weight:700;color:#5a3d26}
.stake p b{color:var(--terra)}
.btn{position:absolute;top:600px;height:68px;width:148px;border:2.6px solid var(--ink);border-radius:15px;text-align:center;box-shadow:0 5px 0 var(--ink);padding-top:7px}
.btn b{display:block;font-family:Bungee;font-weight:normal;font-size:21px;line-height:1}
.btn span{display:block;font-family:Caveat;font-weight:700;font-size:17px;line-height:1.1;margin-top:3px}
.btn.roll{left:14px;background:var(--mari)}
.btn.bank{right:14px;background:#b7c99c}
.chips{position:absolute;left:14px;right:14px;top:682px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.chip{background:#fffaf0;border:1.8px solid var(--ink);border-radius:8px;text-align:center;padding:2px 1px 3px;height:62px}
.chip.on{border-color:var(--terra);border-width:2.6px;background:#fff1d4}
.chip img{width:42px;height:28px;object-fit:contain;display:block;margin:0 auto}
.chip b{display:block;font-family:Bungee;font-weight:normal;font-size:7px;line-height:1.1}
.chip span{display:block;font-weight:800;font-size:10.5px}
.mocknote{position:absolute;right:0;top:876px;width:360px;text-align:center;font-family:Caveat;font-weight:700;font-size:15px;color:#6d4a2f}
'''

DEFS = '''<svg width="0" height="0" style="position:absolute"><defs>
<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter>
<filter id="vblur" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="0 3.2"/></filter>
<filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="5"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.35  0 0 0 0 0.2  0 0 0 1.2 -0.35"/></filter>
</defs></svg>'''

html = f'<!doctype html><html><head><meta charset="utf-8"><title>Desert Bandit pitch</title><style>{CSS}</style></head><body>\n{DEFS}\n{page1}\n{page_look}\n{page2}\n</body></html>'
(HERE / "desert-bandit-pitch.html").write_text(html)
print("wrote desert-bandit-pitch.html")
