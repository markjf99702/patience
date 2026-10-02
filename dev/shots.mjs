// Quick looks while building:  node dev/shots.mjs [out dir]
// Opens each game at phone and desktop sizes, part way through, and saves pictures.
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
const only = process.argv[3];

for (const [name, vp, scheme] of [['phone', { width: 390, height: 844 }, 'light'], ['desk', { width: 1280, height: 800 }, 'light'], ['dark', { width: 390, height: 844 }, 'dark']]) {
  if (only && !only.split(',').includes(name)) continue;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, colorScheme: scheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.patience?.state && !window.patience.busy, null, { timeout: 20000 });
  for (const [v, n, steps] of [['k3', 11705, 45], ['fc', 617, 40], ['s2', 5, 60], ['s4', 2, 0]]) {
    await page.evaluate(([v, n]) => window.patience.newGame(v, n), [v, n]);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(out, `${name}-${v}-deal.png`) });
    if (steps) {
      await page.evaluate(playInto, { v, n, steps, ms: 200000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(out, `${name}-${v}-mid.png`) });
    }
  }
  console.log(name, errors.length ? errors : 'ok');
  await ctx.close();
}
await browser.close();
server.close();
