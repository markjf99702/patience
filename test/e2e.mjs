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
assert.match(await page.textContent('#status'), /Klondike, draw one · Deal [\d,]+/);

// A known deal from here on.
await page.evaluate(() => window.patience.newGame('k1', 11705));
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

// Space presses a button reached by keyboard, and otherwise uses the deck, even after a button was clicked.
await page.click('#b-menu');
await page.keyboard.press('Escape');
await page.keyboard.press(' ');
assert.equal(await page.isHidden('#sheet-menu'), false, 'Space pressed the Menu button');
assert.equal((await state()).stock.length, 24, 'and left the deck alone');
await page.keyboard.press('Escape');
await page.click('#b-hint');
await page.waitForSelector('.hint', { timeout: 10000 });
await page.keyboard.press(' ');
await step();
assert.equal((await state()).stock.length, 23, 'Space used the deck');
await page.click('#b-undo');
await step();

// The menu keeps the keyboard to itself, and closing it gives focus back to Menu.
const behind = () => page.evaluate(() => !!document.activeElement.closest('#game, #toast'));
await page.click('#b-menu');
for (let i = 0; i < 16; i++) { await page.keyboard.press('Tab'); assert.equal(await behind(), false, 'Tab left the menu'); }
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => document.activeElement.id), 'b-menu', 'focus back on Menu');

// Find a card that can move somewhere, drawing until there is one.
async function findMove() {
  for (let i = 0; i < 40; i++) {
    const m = await page.evaluate(async () => {
      const k = await import('./js/games/klondike.js');
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
  const k = await import('./js/games/klondike.js');
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
await page.click('[data-v="k3"]');
await page.waitForTimeout(1500);
await settled();
s = await state();
assert.equal(s.draw, 3);
assert.match(await page.textContent('#status'), /Klondike, draw three/);
await page.waitForTimeout(800);
assert.equal(await page.evaluate(() => [...document.querySelectorAll('.card, .card .flip')].filter(el => el.style.transitionDelay).length), 0,
  'no card is left with a dealing delay');
await page.click('.spot[data-pile="stock"]', { force: true });
await step();
s = await state();
assert.ok(s.waste.length === 3 || s.found.some(f => f.length), 'three cards turned over');

// Win a game: the record counts it.
const before = await page.evaluate(() => ({ ...window.patience.stats.k3 }));
await page.evaluate(playInto, { v: 'k3', n: 11705, steps: 9999 });
await page.waitForSelector('#won:not([hidden])', { timeout: 20000 });
await page.mouse.click(30, 300);
await page.waitForSelector('#won .panel:not([hidden])');
assert.match(await page.textContent('#won-line'), /Klondike, draw three, deal 11,705/);
const afterWin = await page.evaluate(() => window.patience.stats.k3);
assert.equal(afterWin.won, before.won + 1);
assert.equal(afterWin.streak, 1);
await page.click('#b-again');
await page.waitForTimeout(1500);
await settled();
assert.equal(await page.isHidden('#won'), true);
s = await state();
assert.equal(s.moves, 0);
assert.equal(await page.locator('.card[style*="visibility: hidden"]').count(), 0, 'every card is back on the table');

// FreeCell: every card face up, and a card with nowhere else to go goes to a free cell.
await page.click('#b-new');
await page.click('[data-v="fc"]');
await page.waitForTimeout(2000);
await settled();
s = await state();
assert.equal(s.v, 'fc');
assert.match(await page.textContent('#status'), /FreeCell · Deal [\d,]+/);
assert.equal(await page.locator('.card').count(), 52);
assert.equal(await page.locator('.card.down').count(), 0, 'all face up');
await page.evaluate(() => window.patience.newGame('fc', 617));
await page.waitForTimeout(2000);
await settled();
// A jack, queen or king with a card on it doesn't show the edge of its frame under that card (617 has six).
const peeks = await page.evaluate(() => window.patience.state.tab.flatMap(t => t.slice(0, -1).flatMap((c, i) => {
  if (c % 13 < 10) return [];
  const frame = document.querySelector(`.card[data-c="${c}"] .court`).getBoundingClientRect();
  return [document.querySelector(`.card[data-c="${t[i + 1]}"]`).getBoundingClientRect().top - frame.top];
})));
assert.equal(peeks.length, 6);
assert.ok(peeks.every(d => d <= 0), `a frame shows ${Math.max(...peeks).toFixed(1)}px under the next card`);
// New game opens on the game being played, so Enter deals another of the same.
await page.keyboard.press('n');
assert.equal(await page.evaluate(() => document.activeElement.dataset.v), 'fc', 'FreeCell has focus');
await page.keyboard.press('Escape');
// In deal 617 the 4 of hearts on top of the fourth column has nowhere to go but a free cell.
s = await state();
const four = s.tab[3][s.tab[3].length - 1];
await page.click(`.card[data-c="${four}"]`, { position: { x: 12, y: 10 } });
await step();
s = await state();
assert.equal(s.cells.filter(c => c !== null).length, 1, 'the card went to a free cell');
await page.click('#b-undo');
await step();
assert.equal((await state()).cells.filter(c => c !== null).length, 0);
await page.click('#b-hint');
await page.waitForSelector('.hint', { timeout: 15000 });
await page.evaluate(playInto, { v: 'fc', n: 617, steps: 9999 });
await page.waitForSelector('#won:not([hidden])', { timeout: 30000 });
await page.mouse.click(30, 300);
await page.waitForSelector('#won .panel:not([hidden])');
assert.match(await page.textContent('#won-line'), /FreeCell, deal 617/);
assert.equal(await page.evaluate(() => window.patience.stats.fc.won), 1);

// Spider: two decks; the deck deals a row onto every column, but not while one is empty.
await page.click('#b-pick');
await page.waitForSelector('#sheet-new:not([hidden])');
await page.click('[data-v="s1"]');
await page.waitForTimeout(2200);
await settled();
s = await state();
assert.equal(s.v, 's1');
assert.equal(await page.locator('.card').count(), 104);
assert.equal(s.stock.length, 50);
await page.click('.spot[data-pile="stock"]', { force: true });
await page.waitForTimeout(900);
await settled();
s = await state();
assert.equal(s.stock.length, 40, 'a row was dealt');
await page.evaluate(() => {
  const s = structuredClone(window.patience.state);
  s.tab[9] = { down: [], up: [] };
  window.patience.load(s);
});
await page.click('.spot[data-pile="stock"]', { force: true });
await page.waitForSelector('#toast:not([hidden])');
assert.match(await page.textContent('#toast'), /empty column/);
assert.equal((await state()).stock.length, 40, 'no row while a column is empty');

// Win a Spider game: the cleared runs bounce off.
await page.evaluate(() => window.patience.newGame('s1', 3));
await page.waitForTimeout(2200);
await settled();
await page.evaluate(playInto, { v: 's1', n: 3, steps: 99999 });
await page.waitForSelector('#won:not([hidden])', { timeout: 30000 });
assert.equal(await page.evaluate(() => window.patience.stats.s1.won), 1);
await page.mouse.click(30, 300);
await page.click('#b-again');
await page.waitForTimeout(2200);
await settled();
assert.equal(await page.locator('.card[style*="visibility: hidden"]').count(), 0, 'every card is back on the table');

// A Spider game is still there after a reload, and each game's record has its own place in the menu.
await page.evaluate(() => window.patience.newGame('s2', 5));
await page.waitForTimeout(2200);
await settled();
await page.click('.spot[data-pile="stock"]', { force: true });
await page.waitForTimeout(900);
await settled();
s = await state();
await page.reload();
await settled();
const sp = await state();
assert.equal(sp.v, 's2');
assert.deepEqual(sp.tab, s.tab);
await page.click('#b-menu');
assert.equal(await page.inputValue('#stats-for'), 's2');
await page.selectOption('#stats-for', 'fc');
assert.match(await page.textContent('#stats'), /Won\s*1/);
await page.click('#sheet-menu .close');

// The install sheet and package.json describe it the way the link preview does, all three games.
const og = await page.getAttribute('meta[property="og:description"]', 'content');
const manifest = await page.evaluate(async () => (await (await fetch('manifest.webmanifest')).json()).description);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).description;
assert.deepEqual([manifest, pkg], [og, og]);

// The deal's name and the clock at the top read clearly on the felt, at least 4.5:1, in both palettes.
for (const colorScheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme });
  const ratio = await page.evaluate(() => {
    const felt = getComputedStyle(document.documentElement).getPropertyValue('--felt').trim();
    const bg = [1, 3, 5].map(i => parseInt(felt.slice(i, i + 2), 16));
    const [r, g, b, a = 1] = getComputedStyle(document.getElementById('status')).color.match(/[\d.]+/g).map(Number);
    const fg = [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));
    const lum = c => c.map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return (lum(fg) + 0.05) / (lum(bg) + 0.05);
  });
  assert.ok(ratio >= 4.5, `the header text is ${ratio.toFixed(2)}:1 on the ${colorScheme} felt`);
}
await page.emulateMedia({ colorScheme: 'light' });

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
await settled();
assert.equal(await page.locator('.card').count(), 104, 'the Spider game did not load offline');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while playing');
// A phone with the first version's game and record on it carries both over.
{
  const old = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p2 = await old.newPage();
  await p2.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    // A Klondike game part way, drawing three, saved the way the first version saved it (no `v`).
    const tab = Array.from({ length: 7 }, (_, i) => ({ down: Array.from({ length: i }, (_, k) => 12 + i * 4 + k), up: [i] }));
    localStorage.setItem('patience.v1', JSON.stringify({
      settings: { draw: 3, winnable: true, auto: true, clock: true, four: false, left: false },
      stats: { 1: { played: 9, won: 6, streak: 2, best: 4, fastest: 200000 }, 3: { played: 4, won: 1, streak: 0, best: 1, fastest: 400000 } },
      next: { 1: 1234, 3: 5678 },
      game: { state: { deal: 777, draw: 3, stock: [7, 8, 9], waste: [10, 11], fan: 2, found: [[], [], [], []], tab, moves: 12 }, history: [], elapsed: 60000, counted: true },
    }));
  });
  await p2.goto(base);
  await p2.waitForFunction(() => window.patience?.state && !window.patience.busy, null, { timeout: 15000 });
  const kept = await p2.evaluate(() => ({ s: window.patience.state, stats: window.patience.stats, v: window.patience.settings.variant }));
  assert.equal(kept.s.v, 'k3');
  assert.equal(kept.s.deal, 777);
  assert.equal(kept.v, 'k3');
  assert.equal(kept.stats.k1.won, 6);
  assert.equal(kept.stats.k3.played, 4);
  assert.match(await p2.textContent('#status'), /Klondike, draw three · Deal 777/);
  await old.close();
}

// Choosing another game before the last one has landed: only the last choice is dealt, and nothing breaks.
{
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p3 = await c3.newPage();
  const errors = [];
  p3.on('pageerror', e => errors.push(e.message));
  const ready = () => p3.waitForFunction(() => window.patience?.state && !window.patience.busy, null, { timeout: 15000 });
  await p3.goto(base);
  await ready();
  // Deal 2 starts with an ace that goes up by itself; the first deal's timer mustn't try to send it up again.
  await p3.evaluate(() => { window.patience.newGame('k1', 1); setTimeout(() => window.patience.newGame('k1', 2), 50); });
  await p3.waitForTimeout(3000);
  await ready();
  const two = await p3.evaluate(() => window.patience.state);
  assert.equal(two.deal, 2);
  assert.ok(two.found.some(f => f.length), 'the ace went up');
  // Klondike chosen while four-suit Spider is still coming: Klondike stays, and so does its name at the top.
  await p3.evaluate(() => { window.patience.newGame('s4'); window.patience.newGame('k1', 5); });
  await p3.waitForTimeout(2500);
  await ready();
  const five = await p3.evaluate(() => ({ s: window.patience.state, v: window.patience.settings.variant }));
  assert.deepEqual([five.s.v, five.s.deal, five.v], ['k1', 5, 'k1']);
  assert.match(await p3.textContent('#status'), /Klondike, draw one · Deal 5/);

  // A won game is finished. Back at the table from Choose a game, it can't be played on, undone or hinted.
  const wonPanel = async () => {
    await p3.waitForSelector('#won:not([hidden])', { timeout: 30000 });
    await p3.mouse.click(30, 300);
    await p3.waitForSelector('#won .panel:not([hidden])');
  };
  const backToTable = async () => {
    await wonPanel();
    await p3.click('#b-pick');
    await p3.click('#sheet-new button[data-close]');
  };
  // FreeCell with everything up but the king and queen of diamonds, the king on the queen: tap the king to win.
  await p3.evaluate(() => {
    const D = 3, card = (suit, rank) => suit * 13 + rank - 1;
    window.patience.load({
      v: 'fc', deal: 617, cells: [null, null, null, null], moves: 90,
      tab: [[card(D, 12), card(D, 13)], [], [], [], [], [], [], []],
      found: [0, 1, 2, 3].map(suit => Array.from({ length: suit === D ? 11 : 13 }, (_, i) => card(suit, i + 1))),
    });
  });
  const tapKing = async () => { await p3.click('.card[data-c="51"]', { position: { x: 12, y: 10 } }); };
  await tapKing();
  await wonPanel();
  // The won panel keeps the keyboard to itself too: no starting a game under it.
  for (let i = 0; i < 6; i++) {
    await p3.keyboard.press('Tab');
    assert.equal(await p3.evaluate(() => !!document.activeElement.closest('#game, #toast')), false, 'Tab left the won panel');
  }
  await p3.click('#b-pick');
  await p3.click('#sheet-new button[data-close]');
  const fcWin = await p3.evaluate(() => ({ ...window.patience.stats.fc }));
  assert.equal(fcWin.won, 1);
  assert.equal(await p3.isDisabled('#b-undo'), true, 'no undoing a won game');
  await p3.keyboard.press('z');
  await p3.click('#b-undo', { force: true });
  await p3.waitForTimeout(400);
  assert.equal((await p3.evaluate(() => window.patience.state)).found.flat().length, 52, 'still won');
  // A king dragged back down from its foundation in won Klondike doesn't win it a second time.
  await p3.evaluate(playInto, { v: 'k3', n: 11705, steps: 9999 });
  await backToTable();
  const kWin = await p3.evaluate(() => ({ ...window.patience.stats.k3 }));
  const king = await p3.evaluate(() => window.patience.state.found[0][12]);
  const from = await p3.locator(`.card[data-c="${king}"]`).boundingBox(), to = await p3.locator('.spot[data-pile="t0"]').boundingBox();
  await p3.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await p3.mouse.down();
  await p3.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await p3.mouse.up();
  await p3.waitForTimeout(1500);
  assert.equal(await p3.isHidden('#won'), true, 'not won again');
  // Hint on won Spider says nothing and stays ready.
  await p3.evaluate(playInto, { v: 's1', n: 3, steps: 99999 });
  await backToTable();
  await p3.click('#b-hint');
  await p3.waitForTimeout(600);
  assert.equal(await p3.evaluate(() => document.getElementById('b-hint').classList.contains('busy')), false, 'Hint is ready');
  assert.deepEqual(await p3.evaluate(() => [window.patience.stats.fc, window.patience.stats.k3]), [fcWin, kWin], 'each win counts once');
  // Start this deal again while another game is still being shuffled: the game started again is the one remembered.
  await p3.evaluate(() => window.patience.newGame('k1', 5));
  await p3.waitForTimeout(2000);
  await ready();
  await p3.click('.spot[data-pile="stock"]', { force: true });
  await ready();
  await p3.evaluate(() => { window.patience.newGame('s2'); document.getElementById('b-restart').click(); });
  await p3.waitForTimeout(2500);
  await ready();
  const again = await p3.evaluate(() => [window.patience.state.v, window.patience.state.deal, window.patience.state.moves, window.patience.settings.variant]);
  assert.deepEqual(again, ['k1', 5, 0, 'k1'], 'Klondike deal 5 started again, and remembered');
  assert.deepEqual(errors, [], 'errors while switching games or after winning');
  await c3.close();
}

// Saved values the page never writes, as from a damaged store, don't stop it starting: it deals a game,
// and keeps the settings and the record when only the game is damaged.
{
  const c4 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p4 = await c4.newPage();
  const errors = [];
  p4.on('pageerror', e => errors.push(e.message));
  await p4.addInitScript(() => {
    const v = sessionStorage.getItem('seed');
    if (v !== null) { localStorage.setItem('patience.v1', v); sessionStorage.removeItem('seed'); }
  });
  await p4.goto(base);
  for (const value of [
    '{"stats":"xx"}',
    '{"game":{"state":null,"history":"x"}}',
    '{"game":{"state":{"v":"k1","deal":5}}}',
    '{"next":"abc"}',
    '{"settings":{"four":true},"stats":{"fc":{"played":3,"won":2,"streak":1,"best":2,"fastest":90000}},"game":{"state":{"v":"fc","deal":5},"history":[null]}}',
  ]) {
    await p4.evaluate(v => sessionStorage.setItem('seed', v), value);
    await p4.reload();
    await p4.waitForFunction(() => window.patience?.state, null, { timeout: 20000 });
    assert.match(await p4.textContent('#status'), /· Deal \d[\d,]*$/, value);
    assert.equal(await p4.locator('.card').count(), 52, value);
  }
  assert.equal(await p4.evaluate(() => document.documentElement.hasAttribute('data-four')), true, 'settings kept');
  assert.equal(await p4.evaluate(() => window.patience.stats.fc.played), 3, 'record kept');
  assert.deepEqual(errors, [], 'errors starting from a damaged save');
  await c4.close();
}

// A long game: after the page is closed, Undo still goes all the way back to the deal (it used to stop 500 moves back).
// And starting a deal again keeps its clock, so a fastest win counts all the time spent on the deal, until it's won.
{
  const c5 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p5 = await c5.newPage();
  const errors = [];
  p5.on('pageerror', e => errors.push(e.message));
  const ready = () => p5.waitForFunction(() => window.patience?.state && !window.patience.busy, null, { timeout: 15000 });
  const press = (key, times) => p5.evaluate(([key, times]) => {
    for (let i = 0; i < times; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key }));
  }, [key, times]);
  await p5.goto(base);
  await ready();
  await p5.evaluate(() => window.patience.newGame('k1', 11705));
  await p5.waitForTimeout(1500);
  await ready();
  await press('d', 600);
  await ready();
  assert.equal((await p5.evaluate(() => window.patience.state)).moves, 600);
  await p5.reload();
  await ready();
  await press('z', 600);
  await ready();
  const dealt = await p5.evaluate(() => window.patience.state);
  assert.deepEqual([dealt.moves, dealt.stock.length, dealt.waste.length], [0, 24, 0], 'Undo went all the way back to the deal');
  assert.equal(await p5.isDisabled('#b-undo'), true);

  await p5.evaluate(() => { const s = structuredClone(window.patience.state); s.moves = 3; window.patience.load(s, 65000); });
  await p5.click('#b-new');
  await p5.click('#b-restart');
  await p5.waitForTimeout(1500);
  await ready();
  assert.equal((await p5.evaluate(() => window.patience.state)).moves, 0, 'started again');
  assert.equal(await p5.textContent('#time'), '1:05', 'and the clock carries on from where it was');

  // Once the deal is won, starting it again is a new game, with a new clock.
  await p5.evaluate(() => {
    const card = (suit, rank) => suit * 13 + rank - 1;
    window.patience.load({
      v: 'k1', deal: 11705, draw: 1, stock: [], waste: [], fan: 0, moves: 140,
      found: [0, 1, 2, 3].map(suit => Array.from({ length: suit === 0 ? 12 : 13 }, (_, i) => card(suit, i + 1))),
      tab: [{ down: [], up: [card(0, 13)] }, ...Array.from({ length: 6 }, () => ({ down: [], up: [] }))],
    }, 65000);
  });
  await p5.waitForSelector('#won:not([hidden])', { timeout: 30000 });
  await p5.mouse.click(30, 300);
  await p5.waitForSelector('#won .panel:not([hidden])');
  await p5.click('#b-pick');
  await p5.click('#b-restart');
  await p5.waitForTimeout(1500);
  await ready();
  assert.equal((await p5.evaluate(() => window.patience.state)).moves, 0, 'the won deal started again');
  assert.equal(await p5.textContent('#time'), '0:00', 'with a new clock');
  assert.deepEqual(errors, [], 'errors in a long game');
  await c5.close();
}

// On a keyboard alone, H lights up a move and Enter plays it. A button the keyboard brought focus to still takes
// Enter itself; a button that kept focus after a click leaves it to the move, as it leaves Space to the deck.
{
  const c6 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p6 = await c6.newPage();
  const errors = [];
  p6.on('pageerror', e => errors.push(e.message));
  const ready = () => p6.waitForFunction(() => window.patience?.state && !window.patience.busy, null, { timeout: 15000 });
  const now = () => p6.evaluate(() => window.patience.state);
  const lit = () => p6.waitForSelector('.hint', { timeout: 20000 });
  await p6.goto(base);
  await ready();
  // Klondike deal 11705 after 18 cards drawn: Hint's move is the 8 of hearts (20) onto the 9 of clubs (34) in the third column.
  await p6.evaluate(async () => {
    const k = await import('./js/games/klondike.js');
    const settle = s => { for (let st; (st = k.autoStep(s));) s = k.move(s, st.from, st.n, st.to); return s; };
    let s = settle(k.deal(11705, 1));
    for (let i = 0; i < 18; i++) s = settle(k.draw(s));
    window.patience.load(s);
  });
  await ready();
  const start = await now();
  assert.equal(start.tab[2].up.at(-1), 34);
  await p6.keyboard.press('Enter');
  await p6.waitForTimeout(300);
  assert.deepEqual(await now(), start, 'with no move lit up, Enter leaves the cards alone');
  await p6.keyboard.press('h');
  await lit();
  assert.equal(await p6.isHidden('#toast'), true, 'a move lit up on the table needs no note');
  await p6.keyboard.press('Enter');
  await ready();
  assert.deepEqual((await now()).tab[2].up.slice(-2), [34, 20], 'H then Enter put the 8 of hearts on the 9 of clubs');
  assert.equal(await p6.locator('.hint').count(), 0, 'and the move is no longer lit up');
  await p6.keyboard.press('z');
  await ready();
  await p6.keyboard.press('Tab');
  assert.equal(await p6.evaluate(() => document.activeElement.id), 'b-new');
  await p6.keyboard.press('h');
  await lit();
  await p6.keyboard.press('Enter');
  assert.equal(await p6.isHidden('#sheet-new'), false, 'Enter pressed New, which the keyboard had brought focus to');
  assert.deepEqual((await now()).tab, start.tab, 'and left the cards alone');
  await p6.keyboard.press('Escape');
  await p6.click('#b-hint');
  await lit();
  await p6.keyboard.press('Enter');
  await ready();
  assert.deepEqual((await now()).tab[2].up.slice(-2), [34, 20], 'after Hint was clicked, Enter played its move');

  // Drawing for a card further down the deck, where only the deck lights up, Hint says which card, until the draw.
  // In deal 11705 the ace of hearts is the top card of the deck, and the ace of spades the 18th.
  await p6.evaluate(() => window.patience.newGame('k1', 11705));
  await p6.waitForTimeout(1500);
  await ready();
  await p6.keyboard.press('h');
  await lit();
  assert.equal(await p6.textContent('#toast'), 'Draw for the ace of hearts.');
  await p6.keyboard.press('Enter');
  await ready();
  assert.equal(await p6.isHidden('#toast'), true, 'the note went with the draw');
  assert.ok((await now()).found.some(f => f[0] === 13), 'and the ace of hearts went up by itself');
  await p6.keyboard.press('h');
  await lit();
  assert.equal(await p6.textContent('#toast'), 'Draw for the ace of spades.');
  assert.deepEqual(errors, [], 'errors playing from the keyboard');
  await c6.close();
}

// Offline, checked the junkdrawer house kit's way, from a server that answers like GitHub Pages: a browser may keep
// each file for ten minutes, and asks again by its ETag. `net` is the connection: 'up', 'down' (the server drops every
// connection) or 'stalled' (a plane's or a train's wifi: it takes each request and holds on to it). With `release`
// set it serves the next release. The server's own switches are needed because the browser's offline switch can't
// make a stall, and in some Chromium builds it doesn't stop the service worker's own requests.
{
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { join, extname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createHash } = await import('node:crypto');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  let net = 'up', release = false;
  const held = [];
  const server = createServer((req, res) => {
    if (net === 'down') { req.socket.destroy(); return; }
    if (net === 'stalled') { held.push([req, res]); return; }
    serve(req, res);
  }).listen(0);
  async function serve(req, res) {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    let body;
    try { body = await readFile(join(root, path)); } catch { res.writeHead(404); res.end(); return; }
    if (release && path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
    if (release && path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    const head = { etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
    res.writeHead(200, head);
    res.end(body);
  }
  const base = `http://localhost:${server.address().port}/`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  const title = await page.title();

  // Works offline once it has been opened.
  net = 'down';
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await page.title(), title, 'the page did not open offline');
  await ctx.setOffline(false);

  // On a connection that's up but not answering, it opens from the copy too, after the worker's few seconds' wait for
  // the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't open).
  net = 'stalled';
  const t0 = Date.now();
  await page.reload({ timeout: 10000 }).catch(() => {});
  const took = Date.now() - t0;
  assert.ok(took < 8000, `the page took ${took} ms to open on a stalled connection`);
  assert.equal(await page.title(), title, 'the page did not open on a stalled connection');
  net = 'up';
  for (const [req, res] of held.splice(0)) serve(req, res);

  // A new release: every file in the new copy comes from the server, though the browser still has its own copies of
  // the old ones for ten minutes. (The next release changes index.html, and so FILES in sw.js, as a real one does.)
  release = true;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  for (const end = Date.now() + 10000; !(await page.evaluate(async () => !!(await (await caches.match('index.html'))?.text())?.includes('<!-- the next release -->')));) {
    assert.ok(Date.now() < end, "the new release's offline copy kept the old index.html");
    await new Promise(r => setTimeout(r, 100));
  }
  assert.deepEqual(problems, [], 'problems while offline or on a stalled connection');
  await ctx.close();
  server.close();

  // sw.js changes whenever a file it keeps does, so a release replaces the whole offline copy at once: FILES in sw.js
  // is a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read as its
  // index.html; the first 8 hex of the sha1 of those).
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const shell = [...sw.match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);
  const all = createHash('sha1');
  for (const f of shell) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
  const files = all.digest('hex').slice(0, 8);
  assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
}

await browser.close();
server.close();
console.log('all good');
