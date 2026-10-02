// The table: where every card sits, how it moves there, and picking cards up by tap or drag.
// It draws whatever state it's given and reports what the player tried to do; app.js decides what happens.

import { SUITS, RANK_LABELS, suitOf, rankOf, cardName } from './cards.js';
import { TABLEAU, FOUNDATIONS, visible, lift, canDrop, isTab } from './klondike.js';

const PILES = ['stock', 'waste', ...FOUNDATIONS, ...TABLEAU];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Table {
  // handlers: draw(), tap(pile, n), move(pile, n, to), touched()
  constructor(el, handlers) {
    this.el = el;
    this.on = handlers;
    this.state = null;
    this.left = false;
    this.locked = false;
    this.spots = {};
    this.cards = [];
    this.at = new Array(52);     // where each card is drawn: { x, y, z, up, pile, index }
    this.timers = new Array(52);
    this.drag = null;

    for (const id of PILES) {
      const s = document.createElement('div');
      s.className = 'spot';
      s.dataset.pile = id;
      if (id === 'stock') s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/></svg>';
      if (id[0] === 'f') s.textContent = 'A';
      this.spots[id] = s;
      el.append(s);
    }
    for (let c = 0; c < 52; c++) {
      const card = makeCard(c);
      this.cards.push(card);
      el.append(card);
    }

    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.moveDrag(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.up(e, true));
    el.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => { if (this.state) { this.layout(); this.render(this.state, { still: true }); } }).observe(el);
  }

  // Card size and where each pile goes, from the size of the table.
  layout() {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    const pad = clamp(W * 0.02, 6, 18);
    const gap = clamp(W * 0.012, 4, 14);
    const rowGap = clamp(gap * 1.8, 8, 22);
    // Wide enough for seven columns, and short enough that a long column still fits below the top row.
    // (Room for a long run: a few face-down cards and eleven face-up ones still showing their corners.)
    let cw = Math.min((W - 2 * pad - 6 * gap) / 7, (H - 2 * pad - rowGap) / (1.4 * 4.9), 124);
    cw = Math.max(24, Math.floor(cw));
    const ch = Math.round(cw * 1.4);
    const left = Math.round((W - (7 * cw + 6 * gap)) / 2);
    const x = i => left + i * (cw + gap);
    const m = { W, H, pad, gap, cw, ch, top: pad, tabY: pad + ch + rowGap, x: [0, 1, 2, 3, 4, 5, 6].map(x), draw: this.state?.draw };
    const L = this.left;
    m.spot = {
      stock: m.x[L ? 0 : 6],
      waste: m.x[L ? 1 : this.state?.draw === 3 ? 4 : 5],
      f0: m.x[L ? 3 : 0], f1: m.x[L ? 4 : 1], f2: m.x[L ? 5 : 2], f3: m.x[L ? 6 : 3],
    };
    TABLEAU.forEach((id, i) => { m.spot[id] = m.x[i]; });
    this.m = m;
    const st = this.el.style;
    st.setProperty('--cw', cw + 'px');
    st.setProperty('--ch', ch + 'px');
    st.setProperty('--r', Math.max(3, Math.round(cw * 0.08)) + 'px');
    for (const id of PILES) {
      const y = isTab(id) ? m.tabY : m.top;
      this.spots[id].style.transform = `translate(${m.spot[id]}px, ${y}px)`;
    }
  }

  // Where every card goes for this state.
  place(s) {
    const m = this.m, at = new Array(52);
    // Cards deep in a pile can't be seen, so they're hidden: drawn, their edges would add up to a dark outline.
    const deep = (i, n, showing) => i < n - showing;
    s.stock.forEach((c, i) => { at[c] = { x: m.spot.stock, y: m.top, z: 1 + i, up: false, pile: 'stock', index: i, deep: deep(i, s.stock.length, 2) }; });

    const fanned = s.draw === 3 ? Math.min(s.fan || 0, s.waste.length, 3) : 0;
    const fanStep = Math.round(m.cw * 0.3);
    s.waste.forEach((c, i) => {
      const k = i - (s.waste.length - fanned);
      at[c] = { x: m.spot.waste + (k > 0 ? k * fanStep : 0), y: m.top, z: 100 + i, up: true, pile: 'waste', index: i, deep: deep(i, s.waste.length, Math.max(1, fanned) + 1) };
    });

    s.found.forEach((f, fi) => f.forEach((c, i) => {
      at[c] = { x: m.spot[FOUNDATIONS[fi]], y: m.top, z: 200 + fi * 20 + i, up: true, pile: FOUNDATIONS[fi], index: i, deep: !this.showAll && deep(i, f.length, 2) };
    }));

    // Columns fan downwards, and squeeze up when they would run off the bottom.
    const room = m.H - m.pad - m.tabY - m.ch;
    s.tab.forEach((t, ti) => {
      const nd = t.down.length, nu = t.up.length;
      let dStep = m.ch * 0.13, uStep = m.ch * 0.36;
      const need = () => nd * dStep + Math.max(0, nu - 1) * uStep;
      if (need() > room) dStep = Math.max(m.ch * 0.05, nd ? (room - Math.max(0, nu - 1) * uStep) / nd : 0);
      if (need() > room && nu > 1) uStep = Math.max(m.ch * 0.2, (room - nd * dStep) / (nu - 1));
      let y = m.tabY;
      const id = TABLEAU[ti];
      t.down.forEach((c, i) => { at[c] = { x: m.spot[id], y, z: 300 + ti * 30 + i, up: false, pile: id, index: -1 }; y += dStep; });
      t.up.forEach((c, i) => { at[c] = { x: m.spot[id], y, z: 300 + ti * 30 + nd + i, up: true, pile: id, index: i }; y += uStep; });
    });
    return at;
  }

  // Draw the state. still: jump there with no movement. deal: deal the columns out of the stock one by one.
  render(s, opts = {}) {
    const first = !this.state;
    this.state = s;
    if (!this.m || this.m.draw !== s.draw) this.layout(); // drawing one, the waste sits by the stock
    this.clearHint();
    const at = this.place(s);
    if (opts.still || first) this.el.classList.add('still');

    if (opts.deal) {
      // Start every card on the stock, face down, then send each one out in dealing order.
      const m = this.m;
      this.cards.forEach((el, c) => {
        el.classList.add('down');
        el.style.transform = `translate(${m.spot.stock}px, ${m.top}px)`;
        el.style.zIndex = 1;
      });
      this.el.classList.add('still');
      void this.el.offsetWidth;
      this.el.classList.remove('still');
      const order = [];
      for (let row = 0; row < 7; row++) for (let col = row; col < 7; col++) order.push(row < col ? s.tab[col].down[row] : s.tab[col].up[0]);
      // Every card's delay is cleared afterwards, not just this deal's: a deal cut short by another
      // would otherwise leave some cards slow to move for the rest of the game.
      const undelay = () => this.cards.forEach(el => {
        el.style.transitionDelay = '';
        el.querySelector('.flip').style.transitionDelay = '';
      });
      clearTimeout(this.dealTimer);
      undelay();
      order.forEach((c, k) => {
        const el = this.cards[c];
        el.style.transitionDelay = `${k * 26}ms`;
        el.querySelector('.flip').style.transitionDelay = `${k * 26 + 120}ms`;
      });
      this.dealTimer = setTimeout(undelay, order.length * 26 + 500);
    }

    const flyers = this.flyNext || new Set();
    this.flyNext = null;
    for (let c = 0; c < 52; c++) {
      const el = this.cards[c], p = at[c], old = this.at[c];
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      el.classList.toggle('down', !p.up);
      el.classList.toggle('deep', !!p.deep);
      el.setAttribute('aria-label', p.up ? cardName(c) : 'face-down card');
      const moved = opts.deal || flyers.has(c) || (old && (old.pile !== p.pile || Math.abs(old.x - p.x) > 1 || Math.abs(old.y - p.y) > 1));
      clearTimeout(this.timers[c]);
      if (moved && !opts.still && !first) {
        // Fly over everything else on the way, then settle into the pile.
        el.style.zIndex = 1000 + p.z;
        this.timers[c] = setTimeout(() => { el.style.zIndex = p.z; }, opts.deal ? 2000 : 260);
      } else {
        el.style.zIndex = p.z;
      }
    }
    this.at = at;
    this.spots.stock.classList.toggle('gone', !s.stock.length && !s.waste.length);
    if (opts.still || first) { void this.el.offsetWidth; this.el.classList.remove('still'); }
  }

  // ---- picking cards up ----

  down(e) {
    if (this.locked || this.drag || !this.state || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.on.touched();
    const s = this.state;
    const cardEl = e.target.closest('.card'), spot = e.target.closest('.spot');
    let pile, index;
    if (cardEl) ({ pile, index } = this.at[+cardEl.dataset.c]);
    else if (spot) { pile = spot.dataset.pile; index = -1; }
    else return;

    if (pile === 'stock') { this.on.draw(); return; }
    if (pile === 'waste' || pile[0] === 'f') index = visible(s, pile).length - 1;
    if (index < 0) return;
    const cards = lift(s, pile, index);
    if (!cards) return;
    this.drag = { pile, n: cards.length, cards, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId, mouse: e.pointerType === 'mouse' };
    try { this.el.setPointerCapture(e.pointerId); } catch { /* the pointer may already be gone */ }
  }

  moveDrag(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < (d.mouse ? 4 : 8)) return;
      d.moved = true;
      this.clearHint();
      d.cards.forEach((c, i) => { this.cards[c].classList.add('drag'); this.cards[c].style.zIndex = 3000 + i; });
    }
    d.dx = dx; d.dy = dy;
    for (const c of d.cards) {
      const p = this.at[c];
      this.cards[c].style.transform = `translate(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px)`;
    }
  }

  up(e, cancelled) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (!d.moved) { if (!cancelled) this.on.tap(d.pile, d.n); return; }
    for (const c of d.cards) this.cards[c].classList.remove('drag');
    this.flyNext = new Set(d.cards);
    const to = cancelled ? null : this.dropTarget(d);
    if (to) this.on.move(d.pile, d.n, to);
    else this.render(this.state);
  }

  // The legal pile the dragged cards overlap most.
  dropTarget(d) {
    const m = this.m, p = this.at[d.cards[0]];
    const r = { x: p.x + d.dx, y: p.y + d.dy, w: m.cw, h: m.ch };
    let best = null, most = 0;
    for (const id of [...FOUNDATIONS, ...TABLEAU]) {
      if (id === d.pile || !canDrop(this.state, d.cards, id)) continue;
      const z = this.zone(id);
      const a = Math.max(0, Math.min(r.x + r.w, z.x + z.w) - Math.max(r.x, z.x)) * Math.max(0, Math.min(r.y + r.h, z.y + z.h) - Math.max(r.y, z.y));
      if (a > most) { most = a; best = id; }
    }
    return best;
  }

  // The area that counts as dropping onto a pile: a column's whole length, or a foundation's spot.
  zone(id) {
    const m = this.m, g = m.gap / 2;
    if (!isTab(id)) return { x: m.spot[id] - g, y: m.top - g, w: m.cw + 2 * g, h: m.ch + 2 * g };
    const t = this.state.tab[+id.slice(1)];
    const last = t.up.length ? t.up[t.up.length - 1] : t.down[t.down.length - 1];
    const bottom = (last !== undefined ? this.at[last].y : m.tabY) + m.ch;
    return { x: m.spot[id] - g, y: m.tabY - g, w: m.cw + 2 * g, h: bottom - m.tabY + m.ch * 0.4 + g };
  }

  // ---- showing things ----

  shake(pile, n) {
    const cards = visible(this.state, pile).slice(-n);
    for (const c of cards) {
      const el = this.cards[c];
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 400);
    }
  }

  // Light up a suggested move: the card to pick up (or the stock), and where it goes.
  showHint(h) {
    this.clearHint();
    const s = this.state, marks = [];
    if (h.draw) {
      marks.push(s.stock.length ? this.cards[s.stock[s.stock.length - 1]] : this.spots.stock);
    } else {
      const from = visible(s, h.from);
      marks.push(this.cards[from[from.length - h.n]]);
      const to = visible(s, h.to);
      marks.push(to.length ? this.cards[to[to.length - 1]] : this.spots[h.to]);
    }
    marks.forEach(el => el.classList.add('hint'));
    this.hinted = marks;
    this.hintTimer = setTimeout(() => this.clearHint(), 3200);
  }

  clearHint() {
    clearTimeout(this.hintTimer);
    if (this.hinted) this.hinted.forEach(el => el.classList.remove('hint'));
    this.hinted = null;
  }

  // Where a card is on screen, for the winning animation.
  rectOf(c) {
    const r = this.el.getBoundingClientRect(), p = this.at[c];
    return { x: r.left + p.x, y: r.top + p.y, w: this.m.cw, h: this.m.ch };
  }

  hide(c, hidden) { this.cards[c].style.visibility = hidden ? 'hidden' : ''; }

  // Show every card on the foundations, for the winning animation to lift them off one by one.
  unbury() {
    this.showAll = true;
    this.render(this.state, { still: true });
    this.showAll = false;
  }
}

function makeCard(c) {
  const el = document.createElement('div');
  const s = SUITS[suitOf(c)], r = rankOf(c), label = RANK_LABELS[r];
  el.className = `card ${s} down`;
  el.dataset.c = c;
  el.dataset.r = r;
  const sym = cls => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#suit-${s}"/></svg>`;
  const middle = r > 10 ? `<span class="court">${label}${sym('cc')}</span>` : sym('pip');
  el.innerHTML = `<div class="flip"><div class="face"><span class="ix">${label}</span>${sym('cs')}${middle}</div><div class="back"></div></div>`;
  return el;
}
