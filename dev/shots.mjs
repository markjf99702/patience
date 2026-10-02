// Quick looks while building:  node dev/shots.mjs [out dir]
// Opens the game at phone and desktop sizes, plays a few moves, and saves pictures.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playInto } from './play.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dev/out');
await mkdir(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const body = await readFile(join(root, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await pw.chromium.launch();

for (const [name, vp, scheme] of [['phone', { width: 390, height: 844 }, 'light'], ['desk', { width: 1280, height: 800 }, 'light'], ['phone-dark', { width: 390, height: 844 }, 'dark'], ['land', { width: 844, height: 390 }, 'light']]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, colorScheme: scheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { let a = 7; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
  await page.goto(base);
  await page.waitForFunction(() => window.patience?.state && document.querySelector('.table:not(.still)'));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(out, `${name}-0.png`) });
  // Draw a few times.
  for (let i = 0; i < 3; i++) { await page.click('.spot[data-pile="stock"]', { force: true }); await page.waitForTimeout(300); }
  await page.screenshot({ path: join(out, `${name}-1.png`) });
  // Part way through a draw-three game.
  await page.evaluate(playInto, { n: 11705, draw: 3, steps: 45 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, `${name}-2.png`) });
  await page.click('#b-hint');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${name}-hint.png`) });
  if (name === 'phone') {
    await page.click('#b-menu'); await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${name}-menu.png`) });
    await page.click('#sheet-menu .close'); await page.click('#b-new'); await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${name}-new.png`) });
    await page.click('#sheet-new [data-close].plain');
    // Nearly won: play all but the last few moves, then finish by hand.
    await page.evaluate(playInto, { n: 11705, draw: 3, steps: 9999 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(out, `${name}-won.png`) });
    await page.mouse.click(200, 400);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${name}-won2.png`) });
  }
  console.log(name, errors.length ? errors : 'ok');
  await ctx.close();
}
await browser.close();
server.close();
