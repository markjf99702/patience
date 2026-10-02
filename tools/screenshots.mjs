// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded and the deals are fixed, so the same pictures come out every time.
// Needs Playwright, and upng-js from `npm install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playInto } from '../dev/play.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
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
const SEED = 4;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// Save a screenshot squeezed to a 256-colour palette, which keeps the files small.
async function save(shot, path) {
  const img = UPNG.decode(shot);
  await writeFile(path, Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
}

async function open(viewport, deviceScaleFactor, scheme = 'light') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block', colorScheme: scheme });
  const page = await ctx.newPage();
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    localStorage.setItem('patience.v1', JSON.stringify({ stats: { 1: { played: 23, won: 17, streak: 4, best: 6, fastest: 171000 }, 3: { played: 9, won: 5, streak: 1, best: 2, fastest: 263000 } } }));
  }, SEED);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.patience?.state && !window.patience.busy);
  return page;
}
const settle = page => page.waitForTimeout(700);

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await page.evaluate(playInto, { n: 52817, draw: 1, steps: 34, ms: 151000 });
  await settle(page);
  await page.click('.spot[data-pile="stock"]', { force: true });
  await page.waitForTimeout(500);
  await page.click('#b-hint');
  await page.waitForSelector('.hint');
  await page.waitForTimeout(400);
  await save(await page.screenshot(), join(root, 'docs/phone-play.png'));

  await page.click('#b-menu');
  await page.waitForTimeout(400);
  await save(await page.screenshot(), join(root, 'docs/phone-menu.png'));
  await page.click('#sheet-menu .close');

  await page.evaluate(playInto, { n: 52817, draw: 1, steps: 9999, ms: 281000 });
  await page.waitForSelector('#won:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(3800);
  await save(await page.screenshot(), join(root, 'docs/phone-won.png'));
  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left, the cards coming down off the foundations on the right.
{
  const page = await open({ width: 620, height: 630 }, 1);
  await page.addStyleTag({ content: '.top, .bar { visibility: hidden } .won .panel { display: none !important }' });
  await page.evaluate(playInto, { n: 52817, draw: 1, steps: 9999 });
  await page.waitForSelector('#won:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(5200);
  const shot = (await page.screenshot()).toString('base64');
  await page.context().close();

  const font = f => readFile(join(root, 'fonts', f)).then(b => b.toString('base64'));
  const [fraunces, figtree] = await Promise.all([font('fraunces.woff2'), font('figtree.woff2')]);
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await card.setContent(`<!doctype html><style>
    @font-face { font-family: Fraunces; src: url(data:font/woff2;base64,${fraunces}); font-weight: 400 800; }
    @font-face { font-family: Figtree; src: url(data:font/woff2;base64,${figtree}); font-weight: 400 700; }
    body { margin: 0; width: 1200px; height: 630px; display: grid; grid-template-columns: 580px 620px; background: radial-gradient(120% 100% at 30% 30%, #2f7656, #1c523c); color: #f4f0e3; overflow: hidden; }
    .words { padding: 0 20px 0 72px; display: flex; flex-direction: column; justify-content: center; }
    h1 { margin: 0; font: 600 104px/1 Fraunces; font-variation-settings: 'opsz' 144; letter-spacing: -0.01em; }
    p { margin: 26px 0 0; font: 500 33px/1.32 Figtree; color: rgba(244, 240, 227, 0.86); max-width: 460px; }
    img { width: 620px; height: 630px; display: block; -webkit-mask-image: linear-gradient(90deg, transparent, #000 60px); }
  </style>
  <div class="words"><h1>Patience</h1><p>Solitaire with no ads. Every deal can be won, and it works offline.</p></div>
  <img src="data:image/png;base64,${shot}">`);
  await card.evaluate(() => document.fonts.ready);
  await save(await card.screenshot(), join(root, 'og.png'));
  await card.close();
}

await browser.close();
server.close();
console.log('screenshots written');
