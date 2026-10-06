#!/usr/bin/env node
// Headless-Chrome test of the Desert Bandit client against a running server (the real PHP api, or dev/e2e/mock_server.js).
//   cd dev/e2e && npm install      (once; playwright-core)   or symlink node_modules
//   php -S 127.0.0.1:8899 -t desertbandit     (with desertbandit/config.php pointing at the scratch database)
//   node dev/e2e/browser_test.js [base]       (default http://127.0.0.1:8899/)
// env: CHROME (browser binary; default Chrome Canary), SHOTS (screenshot folder; default dev/e2e/shots/).
// It plays games through the UI only (taps on reels and buttons): a game against a computer to a winner, Play solo,
// and a two-phone game (the second joins by room code) with the host controls. Exit 0 = every check passed,
// with zero console errors and zero HTTP 4xx/5xx on every page.
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
  const errors = [], httpErrs = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  async function open(label, opts) {
    const ctx = await browser.newContext(opts || phone), page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
    page.on('response', r => { if (r.status() >= 400) httpErrs.push(label + ' ' + r.status() + ' ' + r.url()); });
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
  check('home: eight rigs to pick from', (await A.locator('.vehicle').count()) === 8);
  check('home: about link', (await A.locator('a[href="about.html"]').count()) === 1);
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
  // Play again: back to the lobby with the same players
  await A.tap('#btn-rematch');
  await A.waitForSelector('#screen-lobby:not([hidden])');
  check('Play again: back in the same lobby with both seats', (await A.textContent('#lobby-code')).trim() === code1 && (await A.locator('#lobby-players li').count()) === 2);

  // ---------------------------------------------------------------- Play solo: one tap makes a game with two computers
  console.log('Play solo');
  const P = await open('solo', Object.assign({ reducedMotion: 'reduce' }, phone));
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

  // ---------------------------------------------------------------- errors
  check('zero console errors / page errors on all pages', errors.length === 0, errors.slice(0, 8));
  check('zero HTTP 4xx/5xx responses on all pages', httpErrs.length === 0, httpErrs.slice(0, 8));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(2); });
