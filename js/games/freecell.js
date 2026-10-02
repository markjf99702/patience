// The rules of FreeCell, as the table plays them. All 52 cards are dealt face up into eight columns.
// Build down in alternating colours, use the four free cells to hold one card each, and build the
// foundations up from ace to king. A run moves as one if there's room to do it a card at a time:
// one card per free cell plus one, doubled for each empty column.
//
// Piles are 'c0'..'c3' (free cells), 'f0'..'f3' (foundations) and 't0'..'t7' (columns).

import { suitOf, rankOf, stacks, fits, safeUp } from '../cards.js';
import { freecellDeal } from '../rng.js';
import { FreeCellSearch, freecellRules } from '../solvers/freecell.js';

const T = Array.from({ length: 8 }, (_, i) => 't' + i);
const C = ['c0', 'c1', 'c2', 'c3'];
const F = ['f0', 'f1', 'f2', 'f3'];
const top = a => a[a.length - 1];
const col = id => +id.slice(1);
const isRun = cards => cards.every((c, i) => i === 0 || stacks(c, cards[i - 1]));

export function deal(n) {
  const tab = T.map(() => []);
  freecellDeal(n).forEach((c, k) => tab[k % 8].push(c));
  return { v: 'fc', deal: n, tab, cells: [null, null, null, null], found: [[], [], [], []], moves: 0 };
}

function clone(s) {
  return { ...s, tab: s.tab.map(t => t.slice()), cells: s.cells.slice(), found: s.found.map(f => f.slice()) };
}

export function foundCounts(s) {
  const n = [0, 0, 0, 0];
  for (const f of s.found) if (f.length) n[suitOf(f[0])] = f.length;
  return n;
}

// How many cards can move together: one per empty free cell plus one, doubled for each empty column
// (not counting the one they're moving into).
export function room(s, toEmpty) {
  const free = s.cells.filter(c => c === null).length;
  const empty = s.tab.filter(t => !t.length).length;
  return (free + 1) * 2 ** Math.max(0, empty - (toEmpty ? 1 : 0));
}

function foundationFor(s, c) {
  for (let i = 0; i < 4; i++) {
    const f = s.found[i];
    if (f.length && suitOf(f[0]) === suitOf(c)) return rankOf(top(f)) === rankOf(c) - 1 ? F[i] : null;
  }
  return rankOf(c) === 1 ? F[s.found.findIndex(f => !f.length)] : null;
}

export const freecell = {
  deal,

  layout() {
    return {
      cols: 8,
      top: [...C.map((id, i) => ({ id, col: i, kind: 'stack' })), ...F.map((id, i) => ({ id, col: 4 + i, kind: 'stack', label: 'A' }))],
      tableau: T,
      dealFrom: 'f3',
    };
  },

  pile(s, id) {
    if (id[0] === 'c') { const c = s.cells[col(id)]; return { down: [], up: c === null ? [] : [c] }; }
    if (id[0] === 'f') return { down: [], up: s.found[col(id)] };
    return { down: [], up: s.tab[col(id)] };
  },

  cardIds() { return Array.from({ length: 52 }, (_, i) => i); },

  // A run in order comes off a column; a free cell gives up its card. Cards on the foundations stay there.
  lift(s, id, index) {
    if (id[0] === 'c') return index === 0 && s.cells[col(id)] !== null ? [s.cells[col(id)]] : null;
    if (id[0] !== 't') return null;
    const cards = s.tab[col(id)].slice(index);
    return cards.length && isRun(cards) ? cards : null;
  },

  targets() { return [...C, ...F, ...T]; },

  canDrop(s, cards, to) {
    if (!cards?.length) return false;
    if (to[0] === 'c') return cards.length === 1 && s.cells[col(to)] === null;
    if (to[0] === 'f') {
      if (cards.length !== 1) return false;
      const f = s.found[col(to)], c = cards[0];
      return f.length ? suitOf(top(f)) === suitOf(c) && rankOf(top(f)) === rankOf(c) - 1 : rankOf(c) === 1;
    }
    const t = s.tab[col(to)];
    if (!isRun(cards)) return false;
    if (!t.length) return cards.length <= room(s, true);
    return stacks(cards[0], top(t)) && cards.length <= room(s, false);
  },

  move(s, from, n, to) {
    if (from === to) return null;
    const src = freecell.pile(s, from).up;
    const cards = freecell.lift(s, from, src.length - n);
    if (!cards || !freecell.canDrop(s, cards, to)) return null;
    const next = clone(s);
    if (from[0] === 'c') next.cells[col(from)] = null;
    else next.tab[col(from)].splice(src.length - n, n);
    if (to[0] === 'c') next.cells[col(to)] = cards[0];
    else if (to[0] === 'f') next.found[col(to)].push(cards[0]);
    else next.tab[col(to)].push(...cards);
    next.moves++;
    return next;
  },

  stock: () => null,
  stockNote: () => null,

  // A tap sends a card up if it can go, otherwise onto a column (one with cards first),
  // otherwise into a free cell.
  tapTarget(s, from, n) {
    const cards = freecell.lift(s, from, freecell.pile(s, from).up.length - n);
    if (!cards) return null;
    if (n === 1) { const f = foundationFor(s, cards[0]); if (f) return f; }
    const whole = from[0] === 't' && s.tab[col(from)].length === n;
    const start = from[0] === 't' ? col(from) : 0;
    const cols = T.map((id, i) => ({ id, i, empty: !s.tab[i].length }))
      .filter(x => x.id !== from && !(x.empty && whole) && freecell.canDrop(s, cards, x.id))
      .sort((a, b) => (a.empty - b.empty) || ((a.i - start + 8) % 8) - ((b.i - start + 8) % 8));
    if (cols.length) return cols[0].id;
    if (n === 1 && from[0] === 't') { const i = s.cells.indexOf(null); if (i >= 0) return C[i]; }
    return null;
  },

  autoStep(s) {
    const counts = foundCounts(s);
    const tops = [...C.map((id, i) => [id, s.cells[i]]), ...T.map((id, i) => [id, top(s.tab[i])])];
    for (const [from, c] of tops) if (c !== null && c !== undefined && safeUp(c, counts)) return { from, n: 1, to: foundationFor(s, c) };
    return null;
  },

  won: s => s.found.every(f => f.length === 13),

  // Every column in order: the rest goes up by itself, the lowest card first.
  finishable: s => !freecell.won(s) && s.tab.every(t => isRun(t)),

  finishStep(s) {
    const counts = foundCounts(s);
    let best = null;
    for (const [from, c] of [...C.map((id, i) => [id, s.cells[i]]), ...T.map((id, i) => [id, top(s.tab[i])])]) {
      if (c === null || c === undefined || !fits(c, counts)) continue;
      if (!best || rankOf(c) < rankOf(best.c)) best = { from, c };
    }
    return best && { from: best.from, n: 1, to: foundationFor(s, best.c) };
  },

  easyHint(s) { return freecell.finishStep(s); },

  position(s) {
    return { tab: s.tab.map(t => t.slice()), cells: s.cells.map(c => (c === null ? -1 : c)), found: foundCounts(s) };
  },
  search(s) { return new FreeCellSearch(freecell.position(s)); },

  fromSolver(s, m) {
    switch (m.k) {
      case 'tf': return { from: T[m.a], n: 1, to: foundationFor(s, m.c) };
      case 'cf': return { from: C[m.i], n: 1, to: foundationFor(s, m.c) };
      case 'ct': return { from: C[m.i], n: 1, to: T[m.b] };
      case 'tc': return { from: T[m.a], n: 1, to: C[m.i] };
      case 'tt': return { from: T[m.a], n: m.n, to: T[m.b] };
    }
    return null;
  },

  // No move of any kind is left.
  outOfMoves(s) {
    const { state, autos } = freecellRules.start(freecell.position(s));
    return !autos.length && freecellRules.moves(state).length === 0;
  },

  bounceOrder(s) {
    const out = [];
    for (let r = 13; r >= 1; r--) for (const f of s.found) if (f[r - 1] !== undefined) out.push(f[r - 1]);
    return out;
  },

  dealOrder(s) {
    return Array.from({ length: 52 }, (_, k) => s.tab[k % 8][(k / 8) | 0]);
  },

  // The deals numbered 1 to 32,000, as Windows numbered them.
  randomDeal: () => 1 + Math.floor(Math.random() * 32000),
  budget: { deal: 100000, hint: 200000 },
};
