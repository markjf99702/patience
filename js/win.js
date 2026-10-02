// The cards bounce off the foundations one at a time, leaving trails, the way they always have.

import { SUIT_PATHS } from './suits.js';
import { SUITS, RANK_LABELS, suitOf, rankOf } from './cards.js';

// cards: in the order to launch them. rectOf(c): where a card is now. hide(c): take it off the table.
// Returns a function that stops it.
export function cascade(canvas, cards, rectOf, hide) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const css = getComputedStyle(document.documentElement);
  const v = name => css.getPropertyValue(name).trim();
  const colours = { card: v('--card'), edge: v('--card-edge'), s: v('--black'), h: v('--red'), c: v('--club'), d: v('--diamond') };
  const pace = Math.sqrt(W / 500), pull = 0.5 * (H / 800);

  let next = 0, lastLaunch = -1e9, last = performance.now(), raf = 0;
  const live = [];

  function launch(now) {
    const c = cards[next++];
    const r = rectOf(c);
    const img = drawCard(c, r.w, r.h, colours, dpr);
    hide(c);
    const dir = Math.random() < 0.5 ? -1 : 1;
    live.push({ img, x: r.x, y: r.y, w: r.w, h: r.h, vx: dir * (2 + Math.random() * 3) * pace, vy: -Math.random() * 8 * pace });
    lastLaunch = now;
  }

  function frame(now) {
    const dt = Math.min(3, (now - last) / 16.7);
    last = now;
    const gone = live.length === 0 || live[live.length - 1].out;
    if (next < cards.length && live.filter(p => !p.out).length < 3 && (gone || now - lastLaunch > 900)) launch(now);
    for (const p of live) {
      if (p.out) continue;
      p.vy += pull * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y + p.h > H) { p.y = H - p.h; p.vy = -p.vy * 0.74; }
      if (p.x + p.w < 0 || p.x > W) { p.out = true; continue; }
      ctx.drawImage(p.img, p.x, p.y, p.w, p.h);
    }
    if (next < cards.length || live.some(p => !p.out)) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// One card, drawn the way the page draws it.
function drawCard(c, w, h, colours, dpr) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const x = cv.getContext('2d');
  x.scale(dpr, dpr);
  const s = SUITS[suitOf(c)], r = rankOf(c), radius = Math.max(3, w * 0.08);
  x.beginPath();
  x.roundRect(0.5, 0.5, w - 1, h - 1, radius);
  x.fillStyle = colours.card;
  x.fill();
  x.strokeStyle = colours.edge;
  x.lineWidth = 1;
  x.stroke();

  x.fillStyle = colours[s];
  x.textBaseline = 'top';
  x.font = `640 ${w * 0.36}px Fraunces, Georgia, serif`;
  x.fillText(RANK_LABELS[r], w * 0.07, w * 0.06);
  suit(x, s, w * 0.69, w * 0.07, w * 0.24);
  if (r > 10) {
    x.beginPath();
    x.roundRect(w * 0.13, h * 0.34, w * 0.74, h * 0.59, radius * 0.6);
    x.globalAlpha = 0.09;
    x.fill();
    x.globalAlpha = 1;
    x.strokeStyle = colours[s];
    x.lineWidth = Math.max(1, w * 0.025);
    x.stroke();
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `italic 560 ${w * 0.44}px Fraunces, Georgia, serif`;
    x.fillText(RANK_LABELS[r], w / 2, h * 0.58);
    suit(x, s, w / 2 - w * 0.09, h * 0.72, w * 0.18);
  } else {
    const size = w * (r === 1 ? 0.62 : 0.5);
    suit(x, s, w / 2 - size / 2, h * 0.6 - size / 2, size);
  }
  return cv;
}

function suit(x, s, left, top, size) {
  x.save();
  x.translate(left, top);
  x.scale(size / 100, size / 100);
  x.fill(new Path2D(SUIT_PATHS[s]));
  x.restore();
}
