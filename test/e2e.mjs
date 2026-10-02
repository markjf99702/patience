// Plays the game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { playInto } from '../dev/play.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

const settled = () => page.waitForFunction(() => window.patience?.state && !window.patience.busy, null, { timeout: 15000 });
const state = () => page.evaluate(() => window.patience.state);
const step = async () => { await page.waitForTimeout(260); await settled(); };

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
await settled();

// A winnable deal comes up on its own.
let s = await state();
assert.equal(await page.locator('.card').count(), 52);
assert.equal(s.stock.length, 24);
assert.match(await page.textContent('#status'), /Draw one · Deal [\d,]+/);

// A known deal from here on.
await page.evaluate(() => window.patience.newGame(1, 11705));
await page.waitForTimeout(1200);
await settled();

// Tap the stock to turn a card over, and Undo puts it back.
await page.click('.spot[data-pile="stock"]', { force: true });
await step();
s = await state();
assert.equal(s.stock.length, 23);
assert.equal(s.waste.length + s.found.flat().length, 1, 'the card is on the waste, or went up if it was an ace');
assert.equal(s.moves, 1);
await page.click('#b-undo');
await step();
s = await state();
assert.equal(s.waste.length, 0);
assert.equal(s.stock.length, 24);

// Find a card that can move somewhere, drawing until there is one.
async function findMove() {
  for (let i = 0; i < 40; i++) {
    const m = await page.evaluate(async () => {
      const k = await import('./js/klondike.js');
      const s = window.patience.state;
      for (const id of ['waste', ...k.TABLEAU]) {
        const v = k.visible(s, id);
        if (!v.length) continue;
        const to = k.bestTarget(s, id, 1);
        if (to) return { id, to, c: v[v.length - 1] };
      }
      return null;
    });
    if (m) return m;
    await page.click('.spot[data-pile="stock"]', { force: true });
    await step();
  }
  throw new Error('no move found');
}
const where = c => page.evaluate(c => {
  const s = window.patience.state;
  if (s.waste.includes(c)) return 'waste';
  const f = s.found.findIndex(f => f.includes(c));
  if (f >= 0) return 'f' + f;
  const t = s.tab.findIndex(t => t.up.includes(c));
  return t >= 0 ? 't' + t : 'stock';
}, c);

// Tap a card: it goes to the best place.
let m = await findMove();
await page.click(`.card[data-c="${m.c}"]`, { position: { x: 12, y: 10 } });
await step();
const after = await where(m.c);
assert.ok(after === m.to || after[0] === 'f', `tapped card went to ${after}, expected ${m.to}`);

// Drag a card onto a column it fits.
const drag = await page.evaluate(async () => {
  const k = await import('./js/klondike.js');
  const s = window.patience.state;
  for (const id of ['waste', ...k.TABLEAU]) {
    const v = k.visible(s, id);
    if (!v.length) continue;
    for (const to of k.TABLEAU) if (to !== id && k.canDrop(s, [v[v.length - 1]], to) && s.tab[+to.slice(1)].up.length) return { id, to, c: v[v.length - 1] };
  }
  return null;
});
if (drag) {
  const from = await page.locator(`.card[data-c="${drag.c}"]`).boundingBox();
  const target = await page.evaluate(to => {
    const s = window.patience.state, t = s.tab[+to.slice(1)];
    return t.up[t.up.length - 1];
  }, drag.to);
  const onto = await page.locator(`.card[data-c="${target}"]`).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + from.width / 2 + ((onto.x - from.x) * i) / 8, from.y + 10 + ((onto.y + 30 - from.y) * i) / 8);
  await page.mouse.up();
  await step();
  assert.equal(await where(drag.c), drag.to, 'dragged card landed');
} else {
  console.log('(no drag move on this deal at this point; skipped the drag check)');
}

// Dropping a card where it doesn't fit sends it back.
s = await state();
const lone = s.tab.findIndex(t => t.up.length);
const card0 = s.tab[lone].up[s.tab[lone].up.length - 1];
const box = await page.locator(`.card[data-c="${card0}"]`).boundingBox();
await page.mouse.move(box.x + 10, box.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + 10, box.y + 400, { steps: 6 });
await page.mouse.up();
await step();
assert.equal(await where(card0), 't' + lone, 'a bad drop goes back');

// Hint lights up a move.
await page.click('#b-hint');
await page.waitForSelector('.hint', { timeout: 10000 });

// The game is still there after a reload.
s = await state();
await page.reload();
await settled();
const back = await state();
assert.equal(back.deal, s.deal);
assert.deepEqual(back.tab, s.tab);
assert.equal(await page.isDisabled('#b-undo'), false, 'undo survives a reload');

// Settings stick.
await page.click('#b-menu');
await page.click('label:has(#o-four)');
assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-four')), true);
await page.click('#sheet-menu .close');
await page.reload();
await settled();
assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-four')), true);

// New game, drawing three.
await page.click('#b-new');
assert.equal(await page.isVisible('#new-note'), true, 'leaving a game part way is a loss');
await page.click('[data-draw="3"]');
await page.waitForTimeout(1500);
await settled();
s = await state();
assert.equal(s.draw, 3);
assert.match(await page.textContent('#status'), /Draw three/);
await page.waitForTimeout(800);
assert.equal(await page.evaluate(() => [...document.querySelectorAll('.card, .card .flip')].filter(el => el.style.transitionDelay).length), 0,
  'no card is left with a dealing delay');
await page.click('.spot[data-pile="stock"]', { force: true });
await step();
s = await state();
assert.ok(s.waste.length === 3 || s.found.some(f => f.length), 'three cards turned over');

// Win a game: the record counts it.
const before = await page.evaluate(() => ({ ...window.patience.stats[3] }));
await page.evaluate(playInto, { n: 11705, draw: 3, steps: 9999 });
await page.waitForSelector('#won:not([hidden])', { timeout: 20000 });
await page.mouse.click(30, 300);
await page.waitForSelector('#won .panel:not([hidden])');
assert.match(await page.textContent('#won-line'), /Deal 11,705, drawing three/);
const afterWin = await page.evaluate(() => window.patience.stats[3]);
assert.equal(afterWin.won, before.won + 1);
assert.equal(afterWin.streak, 1);
await page.click('#b-again');
await page.waitForTimeout(1500);
await settled();
assert.equal(await page.isHidden('#won'), true);
s = await state();
assert.equal(s.moves, 0);
assert.equal(await page.locator('.card[style*="visibility: hidden"]').count(), 0, 'every card is back on the table');

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
await settled();
assert.equal(await page.locator('.card').count(), 52, 'the game did not load offline');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while playing');
await browser.close();
server.close();
console.log('all good');
