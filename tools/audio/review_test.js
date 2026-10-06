// Playwright check of desertbandit/audio/review.html (Chrome Canary, 390 px phone viewport).
// usage: node tools/audio/review_test.js [path to playwright-core] [shots dir]
// Loads the page by file path, plays a clip, plays one on air, a sample action, marks Keep / Redo with a note,
// reloads (marks must persist), exports and parses the JSON, and fails on any console error or page error.
const path = require('path');
const PW = process.argv[2] || '/Users/jerodprice/Developer/desertbandit/.claude/worktrees/wave0-design/dev/e2e/node_modules/playwright-core';
const SHOTS = process.argv[3] || '';
const { chromium } = require(PW);
const PAGE = 'file://' + path.resolve(__dirname, '../../desertbandit/audio/review.html');
(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const fail = [];
  const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fail.push(what); };
  await p.goto(PAGE);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  const lines = await p.$$eval('.line', x => x.length), samples = await p.$$eval('.sample', x => x.length);
  check(lines === 42, `42 lines (${lines})`); check(samples === 12, `12 moments with a sample button (${samples})`);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 390, `no horizontal scroll at 390 px (scrollWidth ${sw})`);
  const enabled = await p.$$eval('.play:not([disabled])', x => x.length);
  check(enabled === 42, `42 play buttons enabled (${enabled})`);
  await p.click('.play >> nth=0'); await p.waitForTimeout(400);
  check(/playing call-/.test(await p.textContent('#now')), 'play shows "playing"');
  await p.click('.air >> nth=5'); await p.waitForTimeout(400);
  check(/on air: /.test(await p.textContent('#now')), 'on air shows "on air"');
  const before = await p.textContent('.sample >> nth=11');
  await p.click('.sample >> nth=11'); await p.waitForTimeout(400);
  const after = await p.textContent('.sample >> nth=11');
  check(after !== before && /next: card-/.test(after), `sample action cycles (${after})`);
  check(/on air: card-/.test(await p.textContent('#now')), 'sample action plays on air');
  await p.click('#stop');
  const id0 = await p.getAttribute('.line >> nth=0', 'data-id'), id1 = await p.getAttribute('.line >> nth=1', 'data-id');
  await p.click(`.keep[data-id="${id0}"]`); await p.click(`.redo[data-id="${id1}"]`);
  await p.fill(`.note[data-id="${id1}"]`, 'slower, please');
  await p.reload();
  check(await p.getAttribute(`.keep[data-id="${id0}"]`, 'class') === 'keep on', 'Keep persists after reload');
  check(await p.getAttribute(`.redo[data-id="${id1}"]`, 'class') === 'redo on', 'Redo persists after reload');
  check(await p.inputValue(`.note[data-id="${id1}"]`) === 'slower, please', 'note persists after reload');
  await p.click('#export');
  const out = await p.inputValue('#out'); let j = null;
  try { j = JSON.parse(out); } catch (e) {}
  check(j && Array.isArray(j.keep) && Array.isArray(j.redo) && typeof j.notes === 'object', 'Export gives valid JSON {keep, redo, notes}: ' + out);
  check(j && j.keep[0] === id0 && j.redo[0] === id1 && j.notes[id1] === 'slower, please', 'Export lists the marks and the note');
  check(/1 keep, 1 redo, 40 open/.test(await p.textContent('#tally')), 'tally counts');
  if (SHOTS) {
    await p.screenshot({ path: SHOTS + '/review-390.png' });
    await p.setViewportSize({ width: 1000, height: 900 }); await p.screenshot({ path: SHOTS + '/review-1000.png' });
  }
  await p.evaluate(() => localStorage.clear());
  check(errs.length === 0, 'no console or page errors ' + JSON.stringify(errs));
  await b.close();
  console.log(fail.length ? `${fail.length} FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})();
