// The table: where every card sits, how it moves there, and picking cards up by tap or drag.
// It draws whatever state it's given, for whichever game that is, and reports what the player tried to do;
// app.js decides what happens.

import { SUITS, RANK_LABELS, suitOf, rankOf, cardName } from './cards.js';
import { gameOf } from './games/index.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const RECYCLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/></svg>';

export class Table {
  // handlers: stock(), tap(pile, n), move(pile, n, to), touched()
  constructor(el, handlers) {
    this.el = el;
    this.on = handlers;
    this.state = null;
    this.left = false;
    this.locked = false;
    this.spots = {};
    this.cards = new Map(); // card -> element
    this.at = new Map();    // card -> where it's drawn: { x, y, z, up, pile, index, deep }
    this.timers = new Map();
    this.drag = null;
    this.dealDuration = 0;

    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.moveDrag(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.up(e, true));
    el.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => { if (this.state) { this.layout(); this.render(this.state, { still: true }); } }).observe(el);
  }

  get game() { return gameOf(this.state); }

  // New piles and a new deck when the game changes (two-deck Spider has different cards from one-deck games).
  setup(s) {
    const ids = gameOf(s).cardIds(s);
    const sig = s.v[0] + ':' + ids.join(',');
    if (sig !== this.sig) {
      for (const el of this.cards.values()) el.remove();
      this.cards = new Map();
      this.at = new Map();
      for (const c of ids) {
        const el = makeCard(c);
        this.cards.set(c, el);
        this.el.append(el);
      }
      this.sig = sig;
    }
    this.v = s.v;
    this.m = null;
  }

  // Card size and where each pile goes, from the size of the table.
  layout() {
    const s = this.state, L = gameOf(s).layout(s, this.left);
    const W = this.el.clientWidth, H = this.el.clientHeight, cols = L.cols, narrow = cols > 8;
    const pad = clamp(W * 0.02, narrow ? 4 : 6, 18);
    const gap = clamp(W * 0.012, narrow ? 3 : 4, 14);
    const rowGap = clamp(gap * 1.8, 8, 22);
    // Wide enough for every column, and short enough that a long column still fits below the top row.
    // `rows` is how many card heights that takes: in Klondike, a few face-down cards and eleven face-up ones
    // still showing their corners; Spider's columns run longer.
    let cw = Math.min((W - 2 * pad - (cols - 1) * gap) / cols, (H - 2 * pad - rowGap) / (1.4 * (L.rows || 4.9)), 124);
    cw = Math.max(20, Math.floor(cw));
    const ch = Math.round(cw * 1.4);
    const left = Math.round((W - (cols * cw + (cols - 1) * gap)) / 2);
    const x = Array.from({ length: cols }, (_, i) => left + i * (cw + gap));
    const m = { W, H, pad, gap, cw, ch, top: pad, tabY: pad + ch + rowGap, x, spot: {}, kind: {}, dir: {}, order: {}, layoutKey: layoutKey(s, this.left) };
    L.top.forEach((p, i) => { m.spot[p.id] = x[p.col]; m.kind[p.id] = p.kind; m.dir[p.id] = p.dir || 1; m.order[p.id] = i; });
    L.tableau.forEach((id, i) => { m.spot[id] = x[i]; m.kind[id] = 'column'; m.order[id] = 100 + i; });
    m.piles = [...L.top.map(p => p.id), ...L.tableau];
    m.dealFrom = L.dealFrom;
    this.m = m;

    // The empty places on the table, one per pile.
    for (const id of Object.keys(this.spots)) if (!(id in m.spot)) { this.spots[id].remove(); delete this.spots[id]; }
    for (const p of [...L.top, ...L.tableau.map(id => ({ id, kind: 'column' }))]) {
      let el = this.spots[p.id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'spot';
        el.dataset.pile = p.id;
        this.el.prepend(el);
        this.spots[p.id] = el;
      }
      el.dataset.kind = p.kind;
      if (p.kind === 'stock') el.innerHTML = RECYCLE; else el.textContent = p.label || '';
      el.style.transform = `translate(${m.spot[p.id]}px, ${p.kind === 'column' ? m.tabY : m.top}px)`;
    }

    const st = this.el.style;
    st.setProperty('--cw', cw + 'px');
    st.setProperty('--ch', ch + 'px');
    st.setProperty('--r', Math.max(3, Math.round(cw * 0.08)) + 'px');
  }

  // Where every card goes for this state.
  place(s) {
    const m = this.m, game = gameOf(s), at = new Map();
    // Cards deep in a pile can't be seen, so they're hidden: drawn, their edges would add up to a dark outline.
    const deep = (i, n, showing) => i < n - showing;
    m.piles.forEach((id, pi) => {
      const kind = m.kind[id], { down, up } = game.pile(s, id), x0 = m.spot[id], dir = m.dir[id];
      const z0 = kind === 'column' ? 2000 + pi * 100 : 200 * (pi + 1);
      const put = (c, x, y, z, faceUp, index, isDeep) => at.set(c, { x, y, z, up: faceUp, pile: id, index, deep: isDeep });

      if (kind === 'stock') {
        down.forEach((c, i) => put(c, x0, m.top, z0 + i, false, i, deep(i, down.length, 2)));
      } else if (kind === 'deals') {
        // A row to deal is ten cards; each row left shows as its own card, fanned out.
        const rows = Math.ceil(down.length / 10), step = Math.round(m.cw * 0.2);
        down.forEach((c, i) => {
          const r = (i / 10) | 0, topOfRow = i % 10 === 9 || i === down.length - 1;
          put(c, x0 + dir * (rows - 1 - r) * step, m.top, z0 + i, false, i, !(topOfRow || (r === rows - 1 && i >= down.length - 2)));
        });
      } else if (kind === 'waste') {
        const fanned = game.fan?.(s) || 0, step = Math.round(m.cw * 0.3);
        up.forEach((c, i) => {
          const k = i - (up.length - fanned);
          put(c, x0 + (k > 0 ? k * step : 0), m.top, z0 + i, true, i, deep(i, up.length, Math.max(1, fanned) + 1));
        });
      } else if (kind === 'stack') {
        up.forEach((c, i) => put(c, x0, m.top, z0 + i, true, i, !this.showAll && deep(i, up.length, 2)));
      } else if (kind === 'sets') {
        // Each cleared run is a pile of thirteen with its king on top, fanned out from the last.
        const step = Math.round(m.cw * 0.3);
        up.forEach((c, i) => put(c, x0 + dir * ((i / 13) | 0) * step, m.top, z0 + i, true, i, !this.showAll && i % 13 < 11));
      } else {
        // Columns fan downwards, and squeeze up when they would run off the bottom.
        const room = m.H - m.pad - m.tabY - m.ch;
        const nd = down.length, nu = up.length;
        let dStep = m.ch * 0.13, uStep = m.ch * 0.36;
        const need = () => nd * dStep + Math.max(0, nu - 1) * uStep;
        if (need() > room) dStep = Math.max(m.ch * 0.05, nd ? (room - Math.max(0, nu - 1) * uStep) / nd : 0);
        if (need() > room && nu > 1) uStep = Math.max(m.ch * 0.2, (room - nd * dStep) / (nu - 1));
        let y = m.tabY;
        down.forEach((c, i) => { put(c, x0, y, z0 + i, false, -1, false); y += dStep; });
        up.forEach((c, i) => { put(c, x0, y, z0 + nd + i, true, i, false); y += uStep; });
      }
    });
    return at;
  }

  // Draw the state. still: jump there with no movement. deal: deal the columns out one by one.
  render(s, opts = {}) {
    const first = !this.state || this.v !== s.v;
    this.state = s;
    if (first) this.setup(s);
    if (!this.m || this.m.layoutKey !== layoutKey(s, this.left)) this.layout();
    this.clearHint();
    const at = this.place(s), m = this.m;
    if (opts.still || (first && !opts.deal)) this.el.classList.add('still');

    // Every card's delay is cleared afterwards, not just the ones just set: a deal cut short by another
    // would otherwise leave some cards slow to move for the rest of the game.
    const undelay = () => this.cards.forEach(el => { el.style.transitionDelay = ''; el.firstChild.style.transitionDelay = ''; });
    const waits = new Map(); // card -> how long it waits before moving
    const delay = (list, step, lead = 0) => {
      clearTimeout(this.delayTimer);
      undelay();
      list.forEach((c, k) => {
        const el = this.cards.get(c);
        waits.set(c, lead + k * step);
        el.style.transitionDelay = `${lead + k * step}ms`;
        el.firstChild.style.transitionDelay = `${lead + k * step + 120}ms`;
      });
      this.delayTimer = setTimeout(undelay, lead + list.length * step + 500);
      return list.length * step + 450;
    };

    if (opts.deal) {
      // Start every card on the pile it's dealt from, face down, then send each one out in dealing order.
      const from = m.spot[m.dealFrom];
      this.cards.forEach(el => {
        el.classList.add('down');
        el.classList.remove('deep');
        el.style.transform = `translate(${from}px, ${m.top}px)`;
        el.style.zIndex = 1;
      });
      this.el.classList.add('still');
      void this.el.offsetWidth;
      this.el.classList.remove('still');
      const order = this.game.dealOrder(s);
      this.dealDuration = delay(order, order.length > 30 ? 18 : 26);
    }

    // Which cards are moving, and from where.
    const flyers = this.flyNext || new Set();
    this.flyNext = null;
    const moved = [];
    for (const [c, p] of at) {
      const old = this.at.get(c);
      if (opts.deal || flyers.has(c) || (old && (old.pile !== p.pile || Math.abs(old.x - p.x) > 1 || Math.abs(old.y - p.y) > 1))) moved.push([c, p, old]);
    }
    // A row dealt in Spider, or a run cleared away, goes one card at a time.
    if (!opts.deal && !opts.still && !first) {
      const row = moved.filter(([, p, old]) => old && m.kind[old.pile] === 'deals' && p.pile !== old.pile);
      const cleared = moved.filter(([, p, old]) => old && m.kind[p.pile] === 'sets' && old.pile !== p.pile);
      if (row.length > 1) delay(row.sort((a, b) => m.order[a[1].pile] - m.order[b[1].pile]).map(([c]) => c), 45);
      else if (cleared.length > 1) delay(cleared.sort((a, b) => a[1].index - b[1].index).map(([c]) => c), 32, 150); // the ace first
    }

    const movedSet = new Set(moved.map(([c]) => c));
    const animate = !opts.still && (!first || opts.deal);
    for (const [c, p] of at) {
      const el = this.cards.get(c);
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      el.classList.toggle('down', !p.up);
      el.classList.toggle('deep', !!p.deep && !(movedSet.has(c) && animate));
      el.setAttribute('aria-label', p.up ? cardName(c) : 'face-down card');
      clearTimeout(this.timers.get(c));
      if (movedSet.has(c) && animate) {
        // Fly over everything else on the way, then settle into the pile (and hide again if it's buried).
        el.style.zIndex = 5000 + p.z;
        const landed = opts.deal ? this.dealDuration + 300 : 300 + (waits.get(c) || 0);
        this.timers.set(c, setTimeout(() => { el.style.zIndex = p.z; el.classList.toggle('deep', !!p.deep); }, landed));
      } else {
        el.style.zIndex = p.z;
      }
    }
    this.at = at;
    for (const id of m.piles) {
      if (m.kind[id] !== 'stock') continue;
      const pile = this.game.pile(s, id), waste = this.game.pile(s, 'waste');
      this.spots[id].classList.toggle('gone', !pile.down.length && !waste.up.length);
    }
    if (opts.still || (first && !opts.deal)) { void this.el.offsetWidth; this.el.classList.remove('still'); }
  }

  // ---- picking cards up ----

  down(e) {
    if (this.locked || this.drag || !this.state || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.on.touched();
    const s = this.state, m = this.m;
    const cardEl = e.target.closest('.card'), spot = e.target.closest('.spot');
    let pile, index;
    if (cardEl) ({ pile, index } = this.at.get(+cardEl.dataset.c));
    else if (spot) { pile = spot.dataset.pile; index = -1; }
    else return;

    const kind = m.kind[pile];
    if (kind === 'stock' || kind === 'deals') { this.on.stock(); return; }
    if (kind === 'sets') return;
    if (kind !== 'column') index = this.game.pile(s, pile).up.length - 1;
    if (index < 0) return;
    const cards = this.game.lift(s, pile, index);
    if (!cards) {
      // A face-up card that can't come up with the cards on top of it.
      if (cardEl) this.shakeCards([+cardEl.dataset.c]);
      return;
    }
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
      d.cards.forEach((c, i) => { const el = this.cards.get(c); el.classList.add('drag'); el.style.zIndex = 9000 + i; });
    }
    d.dx = dx; d.dy = dy;
    for (const c of d.cards) {
      const p = this.at.get(c);
      this.cards.get(c).style.transform = `translate(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px)`;
    }
  }

  up(e, cancelled) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (!d.moved) { if (!cancelled) this.on.tap(d.pile, d.n); return; }
    for (const c of d.cards) this.cards.get(c).classList.remove('drag');
    this.flyNext = new Set(d.cards);
    const to = cancelled ? null : this.dropTarget(d);
    if (to) this.on.move(d.pile, d.n, to);
    else this.render(this.state);
  }

  // The legal pile the dragged cards overlap most.
  dropTarget(d) {
    const m = this.m, p = this.at.get(d.cards[0]);
    const r = { x: p.x + d.dx, y: p.y + d.dy, w: m.cw, h: m.ch };
    let best = null, most = 0;
    for (const id of this.game.targets(this.state)) {
      if (id === d.pile || !this.game.canDrop(this.state, d.cards, id)) continue;
      const z = this.zone(id);
      const a = Math.max(0, Math.min(r.x + r.w, z.x + z.w) - Math.max(r.x, z.x)) * Math.max(0, Math.min(r.y + r.h, z.y + z.h) - Math.max(r.y, z.y));
      if (a > most) { most = a; best = id; }
    }
    return best;
  }

  // The area that counts as dropping onto a pile: a column's whole length, or the pile's spot.
  zone(id) {
    const m = this.m, g = m.gap / 2;
    if (m.kind[id] !== 'column') return { x: m.spot[id] - g, y: m.top - g, w: m.cw + 2 * g, h: m.ch + 2 * g };
    const { down, up } = this.game.pile(this.state, id);
    const last = up.length ? up[up.length - 1] : down[down.length - 1];
    const bottom = (last !== undefined ? this.at.get(last).y : m.tabY) + m.ch;
    return { x: m.spot[id] - g, y: m.tabY - g, w: m.cw + 2 * g, h: bottom - m.tabY + m.ch * 0.4 + g };
  }

  // ---- showing things ----

  shake(pile, n) { this.shakeCards(this.game.pile(this.state, pile).up.slice(-n)); }

  shakeCards(cards) {
    for (const c of cards) {
      const el = this.cards.get(c);
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
    if (h.stock) {
      const id = this.m.piles.find(p => this.m.kind[p] === 'stock' || this.m.kind[p] === 'deals');
      const down = this.game.pile(s, id).down;
      marks.push(down.length ? this.cards.get(down[down.length - 1]) : this.spots[id]);
    } else {
      const from = this.game.pile(s, h.from).up;
      marks.push(this.cards.get(from[from.length - h.n]));
      const to = this.game.pile(s, h.to).up;
      marks.push(to.length ? this.cards.get(to[to.length - 1]) : this.spots[h.to]);
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
    const r = this.el.getBoundingClientRect(), p = this.at.get(c);
    return { x: r.left + p.x, y: r.top + p.y, w: this.m.cw, h: this.m.ch };
  }

  hide(c, hidden) { const el = this.cards.get(c); if (el) el.style.visibility = hidden ? 'hidden' : ''; }
  showAllCards() { this.cards.forEach(el => { el.style.visibility = ''; }); }

  // Show every card on the foundations, for the winning animation to lift them off one by one.
  unbury() {
    this.showAll = true;
    this.render(this.state, { still: true });
    this.showAll = false;
  }
}

// What the layout depends on, besides the size of the table.
const layoutKey = (s, left) => `${s.v}:${left ? 'L' : 'R'}`;

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
