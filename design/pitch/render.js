// Renders the Desert Bandit pitch sheet with Playwright (macOS or any machine with Node + a Chromium-based browser).
//   CHROME=/path/to/browser node design/pitch/render.js [outBase]      (needs `cd dev/e2e && npm install` once)
// Runs build.py first. Writes <outBase>.pdf (all pages), <outBase>.png (page 1), <outBase>-look.png (the mock-up page) and <outBase>-status.png (the plan),
// then prints a layout check (text past a card, a card over the footer, a card left mostly empty).
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const { chromium } = require('../../dev/e2e/node_modules/playwright-core');
(async () => {
  const dir = __dirname;
  execFileSync('python3', [path.join(dir, 'build.py')], { cwd: dir, stdio: 'inherit' });
  const out = process.argv[2] || path.join(dir, 'desert-bandit-pitch');
  const chrome = process.env.CHROME || '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary';
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--allow-file-access-from-files', '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2.7 });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(dir, 'desert-bandit-pitch.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const problems = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.sheet').forEach((sh, si) => {
      const footer = sh.querySelector('.footer'); const ft = footer ? footer.getBoundingClientRect().top : 1e9;
      sh.querySelectorAll('.card, .tech').forEach((c) => {
        const cr = c.getBoundingClientRect(); const ul = c.querySelector('ul'); const name = ((c.querySelector('h2, h3') || {}).textContent || '?').trim();
        if (ul && c.classList.contains('card')) {
          const note = c.querySelector('.p2note');
          const used = ul.getBoundingClientRect().bottom; const limit = (note ? note.getBoundingClientRect().top : cr.bottom) - 6;
          if (used > limit) out.push('page ' + (si + 1) + ' card "' + name + '": text runs ' + Math.round(used - limit) + 'px past its box');
          else if (cr.bottom - used > 95) out.push('page ' + (si + 1) + ' card "' + name + '": ' + Math.round(cr.bottom - used) + 'px empty at the bottom (loose)');
        }
        if (cr.bottom > ft - 4) out.push('page ' + (si + 1) + ' "' + name + '": overlaps the footer');
      });
      // anything in the page layer wider or lower than the sheet
      sh.querySelectorAll('.page *').forEach((e) => {
        const r = e.getBoundingClientRect(); const s = sh.getBoundingClientRect();
        if (e.className && typeof e.className === 'string' && /^(bal|photo|stamp)/.test(e.className)) return;
        if (r.width && (r.right > s.right - 20 || r.left < s.left + 20)) out.push('page ' + (si + 1) + ' element ' + (e.className || e.tagName) + ' touches the page edge');
      });
    });
    return out;
  });
  console.log(problems.length ? 'LAYOUT WARNINGS:\n  ' + problems.join('\n  ') : 'layout check: no overflow, no overlap');
  const sheets = await page.$$('.sheet');
  // page 1 -> <out>.png; a sheet with data-png="look" -> <out>-look.png; data-png="status" -> <out>-status.png
  for (let i = 0; i < sheets.length; i++) {
    const tag = await sheets[i].getAttribute('data-png');
    await sheets[i].screenshot({ path: tag ? out + '-' + tag + '.png' : out + '.png' });
  }
  await page.pdf({ path: out + '.pdf', width: '8.5in', height: '11in', printBackground: true, preferCSSPageSize: true });
  console.log('rendered', sheets.length, 'page(s) ->', out + '.{png,pdf}');
  await browser.close();
})();
