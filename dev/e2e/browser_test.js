#!/usr/bin/env node
// Headless-Chrome test of the Desert Bandit client against a running server (the real PHP api, or dev/e2e/mock_server.js).
//   cd dev/e2e && npm install      (once; playwright-core)   or symlink node_modules
//   php -S 127.0.0.1:8899 -t desertbandit     (with desertbandit/config.php pointing at the scratch database)
//   node dev/e2e/browser_test.js [base]       (default http://127.0.0.1:8899/)
// env: CHROME (browser binary; default Chrome Canary), SHOTS (screenshot folder; default dev/e2e/shots/).
// It plays games through the UI only (taps on reels and buttons): a game against a computer to a winner, Play solo,
// and a two-phone game (the second joins by room code) with the host controls. Exit 0 = every check passed,
// with zero console errors and zero HTTP 4xx/5xx on every page.
// Wave 2 (radio calls, desert bed): needs desertbandit/audio/manifest.json and its clips. Without the real audio, make silent
// placeholders first: bash dev/e2e/make-placeholder-audio.sh (and --clean afterwards; never commit them). The server must send
// .mp3 as audio/mpeg (dev/e2e/proxy.js does: node dev/e2e/proxy.js <abs path>/desertbandit 8899 8961, then use :8961).
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('./node_modules/playwright-core');
const BASE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/?$/, '/');
const CHROME = process.env.CHROME || '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots/');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, detail) { ok ? pass++ : fail++; console.log((ok ? 'ok   ' : 'FAIL ') + name + (!ok && detail !== undefined ? '\n       ' + JSON.stringify(detail) : '')); }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const errors = [], httpErrs = [], audioReqs = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  async function open(label, opts) {
    const ctx = await browser.newContext(opts || phone), page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
    page.on('response', r => { if (r.status() >= 400) httpErrs.push(label + ' ' + r.status() + ' ' + r.url()); });
    page.on('request', r => { if (/\/audio\//.test(r.url())) audioReqs.push({ label, url: r.url(), t: Date.now() }); });
    page.on('dialog', d => d.accept());   // the host controls ask with confirm()
    page.label = label;
    return page;
  }
  const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const smallTargets = p => p.evaluate(() => [].filter.call(document.querySelectorAll('button, a, select, input, .win'), b => {
    if (b.offsetParent === null) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && (r.height < 44 || r.width < 44);
  }).map(b => (b.id || b.className || b.tagName) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)));

  async function enterHome(p, name, vehicle, code) {
    await p.goto(BASE + (code ? '?g=' + code : ''));
    await p.waitForSelector('#screen-home:not([hidden])');
    await p.fill('#in-name', name);
    if (code && !(await p.inputValue('#in-code'))) await p.fill('#in-code', code);
    await p.waitForSelector('.vehicle[data-vehicle="' + vehicle + '"]:not([disabled])');
    await p.tap('.vehicle[data-vehicle="' + vehicle + '"]');
  }

  /** One step for a page whose turn it is: hold every scoring reel by tapping the hints, then ROLL or BANK. Returns true if it acted. */
  async function step(p, shotMid) {
    const s = await p.evaluate(() => {
      const A = window.BanditApp, S = A.state();
      return { can: A.canAct(), phase: S.state && S.state.game.phase, over: !document.getElementById('over').hidden };
    });
    if (s.over || !s.can) return false;
    if (s.phase === 'start') { await p.tap('#btn-roll'); return true; }
    for (let k = 0; k < 6; k++) {
      if (!(await p.locator('#reels .win.hint').count())) break;
      await p.locator('#reels .win.hint').first().tap();
    }
    if (shotMid) await shotMid();
    const pv = await p.evaluate(() => window.BanditApp.preview());
    if (!pv || !pv.valid) throw new Error(p.label + ': no valid selection after tapping the hints ' + JSON.stringify(pv));
    const bankOk = !(await p.isDisabled('#btn-bank'));
    if (bankOk && (pv.stake >= 350 || pv.rollN <= 2)) await p.tap('#btn-bank'); else await p.tap('#btn-roll');
    return true;
  }

  /** Keep playing on page p (its own turns; its page also moves the computers) until cond() is true or limitMs passes. */
  async function playUntil(p, cond, limitMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < limitMs) {
      if (await cond()) return true;
      if (await p.isVisible('#over')) return !!(await cond());
      await step(p);
      await sleep(300);
    }
    return !!(await cond());
  }
  const radioLog = (p, since) => p.evaluate(t => window.BanditRadio.log.filter(x => x.t > t), since || 0);
  // both logs are capped (old entries drop off), so phases are told apart by the local time `t` of each entry
  const soundLog = (p, since) => p.evaluate(t => window.BanditSound.log.filter(x => x.t > t).map(x => ({ tag: x.tag, bus: x.bus, ok: x.ok, serverMs: x.serverMs, t: x.t })), since || 0);
  const mark = p => p.evaluate(() => window.BanditClock.localNow());
  const count = (log, status) => log.filter(x => x.status === status).length;
  async function panel(p, open) {
    const isOpen = await p.isVisible('#snd-panel');
    if (isOpen !== open) await p.tap('#btn-snd');
    await p.waitForSelector(open ? '#snd-panel:not([hidden])' : '#snd-panel[hidden]', { state: 'attached' });
  }
  async function setBox(p, id, on) {
    await panel(p, true);
    if ((await p.isChecked(id)) !== on) await p.tap(id);
    await panel(p, false);
  }

  /** Play until a winner is shown on every page (the host page also drives the computers). */
  async function playToWinner(pages, limitMs, onStep) {
    const t0 = Date.now(); let steps = 0;
    while (Date.now() - t0 < limitMs) {
      let overAll = true;
      for (const p of pages) {
        if (!(await p.isVisible('#over'))) overAll = false;
        if (await step(p, onStep ? () => onStep(p, steps) : null)) steps++;
      }
      if (overAll) return steps;
      await sleep(250);
    }
    throw new Error('no winner within ' + limitMs + ' ms');
  }

  // ---------------------------------------------------------------- home
  const A = await open('host');
  await A.goto(BASE);
  await A.waitForSelector('#screen-home:not([hidden])');
  await sleep(500);
  check('audio: nothing is fetched and no bed plays before the first tap', await A.evaluate(() => !window.BanditSound.ctx && !window.BanditAmbience.state.bed) &&
    audioReqs.filter(r => r.label === 'host').length === 0, audioReqs.slice(0, 3));
  check('home: eight rigs to pick from', (await A.locator('.vehicle').count()) === 8);
  check('home: about link', (await A.locator('a[href="about.html"]').count()) === 1);
  check('home: the sound button is there (top right)', await A.isVisible('#screen-home #btn-snd'));
  await A.fill('#in-name', 'Marigold');
  await A.tap('.vehicle[data-vehicle="bronco-orange"]');
  await sleep(300);
  await A.screenshot({ path: SHOTS + 'home-390.png', fullPage: true });
  check('home: no horizontal scroll at 390 px', await noHScroll(A));
  check('home: every tap target is at least 44 px', (await smallTargets(A)).length === 0, await smallTargets(A));
  check('sound bar is in the page flow and hidden on the home screen', await A.evaluate(() => { const b = document.getElementById('sound-bar'); return b.hidden && getComputedStyle(b).position !== 'fixed'; }));

  // ---------------------------------------------------------------- game 1: vs one computer, to a winner, all through the UI
  console.log('Game 1: one human vs one computer, $2,500');
  await A.tap('#btn-create');
  await A.waitForSelector('#screen-lobby:not([hidden])');
  const code1 = (await A.textContent('#lobby-code')).trim();
  check('lobby: a four-letter room code', /^[A-HJ-NP-Z]{4}$/.test(code1), code1);
  const bedOn = await A.waitForFunction(() => !!window.BanditAmbience.state.bed, null, { timeout: 8000 }).then(() => true, () => false);
  check('desert bed: starts in the lobby after the unlock tap (amb-bed-01 looping on the amb bus)', bedOn && await A.evaluate(() =>
    !!window.BanditSound.buffers['amb-bed-01'] && window.BanditAmbience.state.bedStarts === 1 && window.BanditSound.ctx.state === 'running'));
  // the bed plays in the lobby, so the sound panel is there too: mute it from the lobby
  await panel(A, true);
  await A.screenshot({ path: SHOTS + 'lobby-sound-panel-390.png', fullPage: false });
  const lobPan = await A.evaluate(() => { const r = document.getElementById('snd-panel').getBoundingClientRect();
    return { inLobby: !!document.querySelector('#screen-lobby #snd-panel'), inside: r.left >= 0 && r.right <= window.innerWidth }; });
  await A.tap('#set-mute');
  const lobMute = await A.evaluate(() => window.BanditSound.master.gain.value === 0 && localStorage.getItem('bandit_muted') === '1');
  await A.tap('#set-mute');
  await panel(A, false);
  check('lobby: the sound panel opens there, fits 390 px, and Mute silences the bed', lobPan.inLobby && lobPan.inside && lobMute && await noHScroll(A),
    { lobPan, lobMute });
  await A.tap('#btn-addbot');
  await A.waitForFunction(() => document.querySelectorAll('#lobby-players li').length === 2);
  check('lobby: Add computer seats a computer', /COMPUTER/.test(await A.textContent('#lobby-players')));
  await A.selectOption('#sel-target', '10000');
  await A.waitForFunction(() => /About 20 minutes for 2 players/.test(document.getElementById('game-length').textContent), null, { timeout: 5000 });
  check('lobby: $10,000 for 2 players is "about 20 minutes"', true);
  await A.selectOption('#sel-target', '2500');
  await A.waitForFunction(() => /About 5 minutes/.test(document.getElementById('game-length').textContent), null, { timeout: 5000 });
  check('lobby: the victory total picker sets $2,500 (about 5 minutes)', (await A.inputValue('#sel-target')) === '2500');
  await A.screenshot({ path: SHOTS + 'lobby-390.png', fullPage: true });
  check('lobby: no horizontal scroll, tap targets 44 px+', await noHScroll(A) && (await smallTargets(A)).length === 0, await smallTargets(A));
  await A.tap('#btn-start');
  await A.waitForSelector('#screen-game:not([hidden])');
  check('game: six reel windows', (await A.locator('#reels .win').count()) === 6);
  // the sound panel: mute, game volume, radio, desert sounds + volume, Test sound; stored defaults
  await panel(A, true);
  await A.screenshot({ path: SHOTS + 'sound-panel-390.png', fullPage: false });
  const pan = await A.evaluate(() => ({
    mute: document.getElementById('set-mute').checked, radio: document.getElementById('set-radio').checked, amb: document.getElementById('set-amb').checked,
    vol: +document.getElementById('set-vol').value, ambVol: +document.getElementById('set-amb-vol').value,
    small: [].filter.call(document.querySelectorAll('#snd-panel .snd-row, #snd-panel button, #snd-panel input[type=range]'), b => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map(b => b.id || b.className),
    inside: (() => { const r = document.getElementById('snd-panel').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })()
  }));
  check('sound panel: mute off, radio on, desert sounds on, game volume 50, desert volume 20 (defaults)', !pan.mute && pan.radio && pan.amb && pan.vol === 50 && pan.ambVol === 20, pan);
  check('sound panel: fits the 390 px screen, no horizontal scroll, every control 44 px+', pan.inside && pan.small.length === 0 && await noHScroll(A), pan.small);
  await A.tap('#set-amb');
  const ambOff = await A.evaluate(() => ({ ls: localStorage.getItem('bandit_amb_on'), bed: !!window.BanditAmbience.state.bed }));
  await A.tap('#set-amb');
  await A.fill('#set-amb-vol', '35');
  const ambBack = await A.evaluate(() => ({ ls: localStorage.getItem('bandit_amb_on'), vol: localStorage.getItem('bandit_amb_vol'), bed: !!window.BanditAmbience.state.bed }));
  check('Desert sounds off stops the bed, on starts it again; the volume is stored (bandit_amb_on, bandit_amb_vol)', ambOff.ls === '0' && !ambOff.bed && ambBack.ls === '1' && ambBack.bed && ambBack.vol === '35', [ambOff, ambBack]);
  await A.tap('#btn-test-snd');
  const tested = await A.waitForFunction(() => window.BanditSound.log.some(x => x.ok && x.bus === 'voice' && /^test:/.test(x.tag)), null, { timeout: 5000 }).then(() => true, () => false);
  check('Test sound plays a radio call (click, voice, squelch on the voice bus) on this phone', tested);
  await panel(A, false);
  let midShot = false;
  const steps1 = await playToWinner([A], 12 * 60000, async (p) => {
    if (midShot) return;
    const held = await p.locator('#reels .win.held').count();
    if (!held) return;
    midShot = true;
    await sleep(200);
    await p.screenshot({ path: SHOTS + 'game-mid-turn-390.png', fullPage: true });
    check('game (mid-turn): held reels show HELD and the stake line shows the selection', /HELD/.test(await p.textContent('#reels')) && /Holding \$/.test(await p.textContent('#stake-msg')));
    check('game (mid-turn): ROLL shows how many reels will roll', /reel/.test(await p.textContent('#roll-sub')));
    check('game: no horizontal scroll at 390 px, tap targets 44 px+', await noHScroll(p) && (await smallTargets(p)).length === 0, await smallTargets(p));
  });
  check('game 1 reached a winner after ' + steps1 + ' taps of ROLL/BANK', await A.isVisible('#over'));
  await sleep(3200);
  await A.screenshot({ path: SHOTS + 'game-over-390.png', fullPage: true });
  check('game over: winner banner, Play again for the host, New game', /wins? with \$/.test(await A.textContent('#over-title')) && await A.isVisible('#btn-rematch') && await A.isVisible('#btn-new'));
  const sync1 = await A.evaluate(() => window.BanditSound.log.filter(x => x.tag === 'thump').length);
  check('reel stops were scheduled on the shared clock (' + sync1 + ' thumps)', sync1 > 6);
  const rl1 = await radioLog(A), sl1 = await soundLog(A);
  const oldest = Math.min(...sl1.map(x => x.t));
  const calls1 = rl1.filter(x => x.status === 'scheduled' && x.kind && x.t >= oldest);   // the ones still in the capped sound log
  const voiced = calls1.filter(c => sl1.some(x => x.ok && x.bus === 'voice' && x.tag === c.kind + ':' + c.id && Math.abs(x.serverMs - (c.at + 100)) <= 1));
  check('radio: calls were scheduled on the shared clock in game 1 (' + calls1.length + ': ' + calls1.slice(0, 4).map(c => c.id).join(', ') + ')',
    calls1.length > 0 && voiced.length === calls1.length, { calls: calls1.length, voiced: voiced.length, statuses: rl1.map(x => x.status).join(' ').slice(0, 300) });
  check('radio: only known clip ids', rl1.every(x => /^(call-[a-z]+-[abc]|card-[a-z]+-[ab]|pl-(sr|r273)-\d\d)$/.test(x.id)), rl1.slice(0, 5));
  check('desert bed: ducks under the voices (the voice windows drive the duck gain)', await A.evaluate(() => window.BanditSound.wins.length > 0));
  // Play again: back to the lobby with the same players
  await A.tap('#btn-rematch');
  await A.waitForSelector('#screen-lobby:not([hidden])');
  check('Play again: back in the same lobby with both seats', (await A.textContent('#lobby-code')).trim() === code1 && (await A.locator('#lobby-players li').count()) === 2);

  // ---------------------------------------------------------------- Play solo: one tap makes a game with two computers
  console.log('Play solo');
  const P = await open('solo', Object.assign({ reducedMotion: 'reduce' }, phone));
  // this phone's manifest leaves out the bust and lock lines and Ranger 273's place calls: they must be skipped with no request
  const DROP = /^(call-bust-|call-lock-|pl-r273-)/;
  await P.route('**/audio/manifest.json', async route => {
    const res = await route.fetch(), j = await res.json();
    Object.keys(j.clips).forEach(id => { if (DROP.test(id)) delete j.clips[id]; });
    await route.fulfill({ response: res, json: j });
  });
  await enterHome(P, 'Solo', 'jeep-red');
  await P.tap('#btn-solo');
  await P.waitForSelector('#screen-game:not([hidden])', { timeout: 15000 });
  check('Play solo: straight into a game with two computers', (await P.locator('#chips .chip').count()) === 3 && /computer/.test(await P.textContent('#chips')));
  check('reduced motion: a spinning reel has no animation and no blur', await P.evaluate(() => {
    const w = document.querySelector('#reels .win'); w.classList.add('spin');
    const cs = getComputedStyle(w.querySelector('.strip')), ok = cs.animationName === 'none' && cs.filter === 'none';
    w.classList.remove('spin'); return ok;
  }));
  // the phone pauses the audio (a call, the lock screen): the in-flow bar appears and covers no button
  await P.evaluate(() => { const S = window.BanditSound; S.unlock(); window.__f = 'interrupted'; Object.defineProperty(S.ctx, 'state', { get: () => window.__f, configurable: true }); S.ctx.onstatechange(); });
  await sleep(200);
  const bar = await P.evaluate(() => { const b = document.getElementById('sound-bar'), br = b.getBoundingClientRect();
    const hit = [].filter.call(document.querySelectorAll('button:not(#sound-bar), a'), x => x.offsetParent !== null).filter(x => { const r = x.getBoundingClientRect(); return r.top < br.bottom && r.bottom > br.top && r.left < br.right && r.right > br.left; }).map(x => x.id || x.textContent.trim());
    return { shown: !b.hidden, pos: getComputedStyle(b).position, hit }; });
  check('sound paused: the bar shows, in the page flow, covering no button', bar.shown && bar.pos !== 'fixed' && bar.hit.length === 0, bar);
  await P.evaluate(() => { window.__f = 'running'; window.BanditSound.ctx.onstatechange(); });
  await sleep(200);
  check('sound running again: the bar hides', await P.evaluate(() => document.getElementById('sound-bar').hidden));
  check('desert bed: restarted after the audio interruption', await P.evaluate(() => window.BanditAmbience.state.bedStarts >= 2 && !!window.BanditAmbience.state.bed));
  // radio on: calls play; clips missing from the manifest are skipped without a request
  const gotAbsent = await playUntil(P, async () => { const l = await radioLog(P); return count(l, 'scheduled') > 0 && count(l, 'absent') > 0; }, 150000);
  const absentIds = (await radioLog(P)).filter(x => x.status === 'absent').map(x => x.id);
  const droppedReqs = audioReqs.filter(r => r.label === 'solo' && /\/(call-bust-|call-lock-|pl-r273-)/.test(r.url));
  check('missing clips: skipped (' + absentIds.slice(0, 3).join(', ') + ') with no request for them', gotAbsent && absentIds.every(id => DROP.test(id)) && droppedReqs.length === 0, { absentIds, droppedReqs: droppedReqs.slice(0, 3) });
  check('every clip request carries ?v=<hash> from the manifest', audioReqs.filter(r => /\.mp3/.test(r.url)).every(r => /\.mp3\?v=[0-9a-f]{6,}$/.test(r.url)), audioReqs.filter(r => /\.mp3/.test(r.url) && !/\?v=/.test(r.url)).slice(0, 3));
  // radio off: no calls (the log notes the ones that would have played); the machine sounds go on
  await setBox(P, '#set-radio', false);
  let m0 = await mark(P);
  await playUntil(P, async () => count(await radioLog(P, m0), 'radio off') >= 2, 150000);
  let r1 = await radioLog(P, m0), s1 = await soundLog(P, m0);
  check('radio off: no calls scheduled, ' + count(r1, 'radio off') + ' would have played; machine sounds still play',
    count(r1, 'radio off') >= 2 && count(r1, 'scheduled') === 0 &&
      !s1.some(x => x.bus === 'voice') && s1.some(x => x.ok && x.bus === 'cue') && await P.evaluate(() => localStorage.getItem('bandit_radio_on') === '0'),
    { calls: r1.map(x => x.status), voice: s1.filter(x => x.bus === 'voice').length });
  await setBox(P, '#set-radio', true);
  // mute: nothing plays at all
  await setBox(P, '#set-mute', true);
  m0 = await mark(P);
  await playUntil(P, async () => (await radioLog(P, m0)).length >= 2 && (await soundLog(P, m0)).length >= 8, 150000);
  r1 = await radioLog(P, m0); s1 = await soundLog(P, m0);
  const masterGain = await P.evaluate(() => window.BanditSound.master.gain.value);
  check('mute: every sound and call after it is silent (' + s1.length + ' sounds, ' + r1.length + ' call decisions), master gain 0',
    s1.length >= 8 && r1.length >= 2 && s1.every(x => !x.ok) && r1.every(x => x.status !== 'scheduled') && masterGain === 0,
    { sounds: s1.length, okSounds: s1.filter(x => x.ok).length, calls: r1.map(x => x.status), masterGain });
  await setBox(P, '#set-mute', false);
  await P.close();

  // ---------------------------------------------------------------- game 2: two phones, the second joins by room code
  console.log('Game 2: two phones');
  const H = await open('phone-1'), G = await open('phone-2');
  await enterHome(H, 'Ann', 'buggy-blue');
  await H.tap('#btn-create');
  await H.waitForSelector('#screen-lobby:not([hidden])');
  const code2 = (await H.textContent('#lobby-code')).trim();
  await G.goto(BASE);
  await G.waitForSelector('#screen-home:not([hidden])');
  await G.fill('#in-name', 'Bob');
  await G.fill('#in-code', code2.toLowerCase());
  await G.waitForSelector('#btn-join:not([hidden])');
  await G.waitForSelector('.vehicle[data-vehicle="buggy-blue"][disabled]');
  check('join form: the host\'s rig is taken', true);
  await G.tap('.vehicle[data-vehicle="rail-purple"]');
  await G.tap('#btn-join');
  await G.waitForSelector('#screen-lobby:not([hidden])');
  await H.waitForFunction(() => document.querySelectorAll('#lobby-players li').length === 2);
  check('both phones see two players; only the host has Start and the picker', (await G.locator('#lobby-players li').count()) === 2 && !(await G.isVisible('#btn-start')) && !(await G.isVisible('#sel-target')) && await H.isVisible('#btn-start'));
  await H.selectOption('#sel-target', '2500');
  await G.waitForFunction(() => /2,500/.test(document.getElementById('target-fixed').textContent), null, { timeout: 5000 });
  check('the guest sees the total the host picked', true);
  await H.tap('#btn-start');
  await H.waitForSelector('#screen-game:not([hidden])');
  await G.waitForSelector('#screen-game:not([hidden])');
  // host controls: Skip turn (when Bob is up) and Sit out / Bring back
  check('host tools are on the host phone only', await H.isVisible('#host-tools') && !(await G.isVisible('#host-tools')));
  let skipped = false, satOut = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && !(skipped && satOut)) {
    const st = await H.evaluate(() => { const S = window.BanditApp.state(); return { cur: S.state.game.currentId, me: S.state.meId, anim: window.BanditApp.animating() }; });
    if (!st.anim && st.cur !== st.me && !skipped) {
      await H.waitForSelector('#btn-skip:not([hidden])');
      check('host sees "Skip Bob\'s turn"', /Skip Bob/.test(await H.textContent('#btn-skip')));
      await H.tap('#btn-skip');
      await H.waitForFunction(() => { const S = window.BanditApp.state(); return S.state.game.currentId === S.state.meId; }, null, { timeout: 10000 });
      await G.waitForFunction(() => /skipped by the host/.test(document.getElementById('log').textContent), null, { timeout: 10000 });
      check('Skip turn: the turn passes to the host and Bob\'s log says so', true);
      skipped = true;
    } else if (skipped && !satOut && !st.anim) {
      await H.locator('#host-players li', { hasText: 'Bob' }).locator('.mini-btn').tap();
      await G.waitForFunction(() => /sitting out/.test(document.getElementById('stake-msg').textContent + document.getElementById('chips').textContent), null, { timeout: 10000 });
      check('Sit out: Bob\'s phone shows he is sitting out', true);
      await H.locator('#host-players li', { hasText: 'Bob' }).locator('.mini-btn', { hasText: 'Bring back' }).tap();
      await H.waitForFunction(() => window.BanditApp.state().state.players.every(p => !p.out), null, { timeout: 10000 });
      check('Bring back: nobody is sitting out', true);
      satOut = true;
    } else {
      await step(H) || await step(G);
      await sleep(250);
    }
  }
  await playToWinner([H, G], 12 * 60000);
  const w1 = (await H.textContent('#over-title')).trim(), w2 = (await G.textContent('#over-title')).trim();
  check('both phones show the same winner', w1.replace(/^You win/, 'X') !== '' && w1.match(/\$[\d,]+/)[0] === w2.match(/\$[\d,]+/)[0], [w1, w2]);
  check('only the host has Play again; the guest waits', await H.isVisible('#btn-rematch') && !(await G.isVisible('#btn-rematch')) && await G.isVisible('#rematch-wait'));
  // the same action plays at the same server time on both phones: compare the scheduled reel-stop times
  const thumps = async p => (await p.evaluate(() => window.BanditSound.log.filter(x => x.tag === 'thump').map(x => Math.round(x.serverMs))));
  const ta = await thumps(H), tb = await thumps(G);
  const common = ta.filter(x => tb.indexOf(x) >= 0).length;
  check('both phones scheduled the same reel stops at the same server times (' + common + ' of ' + Math.min(ta.length, tb.length) + ')', common >= Math.min(ta.length, tb.length) * 0.9 && common > 3, { a: ta.length, b: tb.length, common });
  // the radio: both phones pick the same call for the same action and schedule it at the same server time
  const callsOf = async p => (await radioLog(p)).filter(x => x.status === 'scheduled');
  const ca = await callsOf(H), cb = await callsOf(G);
  const same = ca.filter(x => cb.some(y => y.id === x.id && Math.abs(y.at - x.at) <= 25));
  const diffMs = same.map(x => Math.abs(cb.find(y => y.id === x.id && Math.abs(y.at - x.at) <= 25).at - x.at));
  check('radio: both phones scheduled the same calls at the same server times (' + same.length + ' of ' + Math.min(ca.length, cb.length) + ', at most ' + Math.max(0, ...diffMs) + ' ms apart)',
    same.length > 0 && same.length >= Math.min(ca.length, cb.length) * 0.9, { a: ca.map(x => x.id + '@' + x.at).slice(0, 12), b: cb.map(x => x.id + '@' + x.at).slice(0, 12) });
  const decided = async p => (await radioLog(p)).filter(x => x.status === 'scheduled' || x.status === 'busy').map(x => x.id + '@' + Math.round(x.at / 50));
  const da = await decided(H), db = await decided(G);
  check('radio: the call decisions (played, or skipped because another voice was on) agree on both phones (' + da.filter(x => db.indexOf(x) >= 0).length + ' of ' + Math.min(da.length, db.length) + ')',
    da.length > 0 && da.filter(x => db.indexOf(x) >= 0).length >= Math.min(da.length, db.length) * 0.9, { a: da.slice(0, 10), b: db.slice(0, 10) });

  // ---------------------------------------------------------------- errors
  check('zero console errors / page errors on all pages', errors.length === 0, errors.slice(0, 8));
  check('zero HTTP 4xx/5xx responses on all pages', httpErrs.length === 0, httpErrs.slice(0, 8));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(2); });
