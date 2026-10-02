// The rules of Klondike, as the table plays them. Every function returns a new state and leaves the old one alone,
// so the old ones can be kept for undo.
//
// Piles are named 'stock', 'waste', 'f0'..'f3' (foundations) and 't0'..'t6' (tableau).

import { suitOf, rankOf, stacks, fits, safeUp } from './cards.js';
import { shuffled } from './rng.js';

export const TABLEAU = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
export const FOUNDATIONS = ['f0', 'f1', 'f2', 'f3'];

export function deal(n, draw) {
  const deck = shuffled(n);
  const tab = Array.from({ length: 7 }, () => ({ down: [], up: [] }));
  let k = 0;
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) {
      const c = deck[k++];
      if (col === row) tab[col].up.push(c); else tab[col].down.push(c);
    }
  }
  // What's left is the stock; the last card in the array is the top one, drawn first.
  // `fan` is how many of the waste's top cards are spread out to see: the ones the last draw turned over,
  // less any played since.
  return { deal: n, draw, stock: deck.slice(k), waste: [], fan: 0, found: [[], [], [], []], tab, moves: 0 };
}

export function clone(s) {
  return {
    ...s,
    stock: s.stock.slice(),
    waste: s.waste.slice(),
    found: s.found.map(f => f.slice()),
    tab: s.tab.map(t => ({ down: t.down.slice(), up: t.up.slice() })),
  };
}

const col = id => +id.slice(1);
export const isTab = id => id[0] === 't';
export const isFound = id => id[0] === 'f';

// How many of each suit are up: what fits() and safeUp() want.
export function foundCounts(s) {
  const n = [0, 0, 0, 0];
  for (const f of s.found) if (f.length) n[suitOf(f[0])] = f.length;
  return n;
}

// The face-up cards you can see on a pile, bottom to top.
export function visible(s, id) {
  if (id === 'waste') return s.waste;
  if (id === 'stock') return [];
  if (isFound(id)) return s.found[col(id)];
  return s.tab[col(id)].up;
}

const top = a => a[a.length - 1];

// The cards that would be lifted by picking up the card at `index` on pile `id`.
// Only the top card comes off the waste or a foundation; any face-up run comes off the tableau.
export function lift(s, id, index) {
  const cards = visible(s, id);
  if (index < 0 || index >= cards.length) return null;
  if (!isTab(id) && index !== cards.length - 1) return null;
  return cards.slice(index);
}

export function canDrop(s, cards, to) {
  if (!cards || !cards.length) return false;
  const c = cards[0];
  if (isFound(to)) {
    if (cards.length !== 1) return false;
    const f = s.found[col(to)];
    if (!f.length) return rankOf(c) === 1;
    return suitOf(top(f)) === suitOf(c) && rankOf(top(f)) === rankOf(c) - 1;
  }
  if (isTab(to)) {
    const t = s.tab[col(to)];
    if (!t.up.length && !t.down.length) return rankOf(c) === 13;
    return t.up.length > 0 && stacks(c, top(t.up));
  }
  return false;
}

// Move the top `n` cards from one pile to another. Returns the new state, or null if the rules say no.
export function move(s, from, n, to) {
  if (from === to) return null;
  const cards = lift(s, from, visible(s, from).length - n);
  if (!cards || !canDrop(s, cards, to)) return null;
  const next = clone(s);
  const src = visible(next, from);
  src.splice(src.length - n, n);
  visible(next, to).push(...cards);
  if (isTab(from)) flip(next.tab[col(from)]);
  if (from === 'waste') next.fan = next.waste.length ? Math.max(1, s.fan - 1) : 0;
  next.moves++;
  return next;
}

// A column whose face-up cards are gone turns its next card over.
function flip(t) {
  if (!t.up.length && t.down.length) t.up.push(t.down.pop());
}

// Tap the stock: turn over one or three cards, or, when it's empty, turn the waste back over.
export function draw(s) {
  if (!s.stock.length && !s.waste.length) return null;
  const next = clone(s);
  if (next.stock.length) {
    let n = 0;
    while (n < s.draw && next.stock.length) { next.waste.push(next.stock.pop()); n++; }
    next.fan = n;
  } else {
    next.stock = next.waste.reverse();
    next.waste = [];
    next.fan = 0;
  }
  next.moves++;
  return next;
}

// Where a single tap should send these cards: up to the foundations if it can go,
// otherwise onto a column, preferring one with cards to an empty one.
// A card already up stays put when tapped; taking one back down is done by dragging it.
export function bestTarget(s, from, n) {
  if (isFound(from)) return null;
  const cards = lift(s, from, visible(s, from).length - n);
  if (!cards) return null;
  if (cards.length === 1) {
    const f = foundationFor(s, cards[0]);
    if (f) return f;
  }
  const order = TABLEAU.map((id, i) => ({ id, i, empty: !s.tab[i].up.length && !s.tab[i].down.length }))
    .filter(t => t.id !== from && canDrop(s, cards, t.id));
  // Don't shuffle a king from one empty column to another.
  const fromTab = isTab(from) ? s.tab[col(from)] : null;
  const kingAlone = fromTab && !fromTab.down.length && fromTab.up.length === n;
  const start = isTab(from) ? col(from) : 0;
  order.sort((a, b) => (a.empty - b.empty) || ((a.i - start + 7) % 7) - ((b.i - start + 7) % 7));
  const pick = order.find(t => !(t.empty && kingAlone));
  return pick ? pick.id : null;
}

// The foundation this card would go to: the pile of its suit, or the first empty one for an ace.
export function foundationFor(s, c) {
  for (let i = 0; i < 4; i++) {
    const f = s.found[i];
    if (f.length && suitOf(f[0]) === suitOf(c)) return rankOf(top(f)) === rankOf(c) - 1 ? FOUNDATIONS[i] : null;
  }
  if (rankOf(c) !== 1) return null;
  return FOUNDATIONS[s.found.findIndex(f => !f.length)];
}

// One card that can safely go up on its own (nothing could still need it), or null.
export function autoStep(s) {
  const counts = foundCounts(s);
  const tops = [['waste', top(s.waste)], ...TABLEAU.map((id, i) => [id, top(s.tab[i].up)])];
  for (const [from, c] of tops) {
    if (c !== undefined && safeUp(c, counts)) return { from, n: 1, to: foundationFor(s, c) };
  }
  return null;
}

export const won = s => s.found.every(f => f.length === 13);

// Every card is face up and nothing is left to draw: the rest plays itself.
export const finishable = s => !won(s) && !s.stock.length && !s.waste.length && s.tab.every(t => !t.down.length);

// The next card up when finishing: the lowest one that fits, which is always on top of a column.
export function finishStep(s) {
  const counts = foundCounts(s);
  let best = null;
  TABLEAU.forEach((id, i) => {
    const c = top(s.tab[i].up);
    if (c !== undefined && fits(c, counts) && (!best || rankOf(c) < best.rank)) best = { from: id, rank: rankOf(c), c };
  });
  return best && { from: best.from, n: 1, to: foundationFor(s, best.c) };
}

// The same position the way the solver sees it.
// Its talon is the stock and waste as one line in the order the cards come off the stock;
// `pos` cards of it have been drawn, so the waste's top card is talon[pos - 1].
export function forSolver(s) {
  return {
    draw: s.draw,
    tab: s.tab.map(t => [...t.down, ...t.up]),
    down: s.tab.map(t => t.down.length),
    found: foundCounts(s),
    talon: [...s.waste, ...s.stock.slice().reverse()],
    pos: s.waste.length,
  };
}

// Turn a solver move back into one the table understands. A card deeper in the stock comes back as a draw.
export function fromSolver(s, m) {
  const counts = foundCounts(s);
  switch (m.k) {
    case 0: return { from: TABLEAU[m.a], n: 1, to: foundationFor(s, top(s.tab[m.a].up)) };
    case 1: return { from: TABLEAU[m.a], n: m.n, to: TABLEAU[m.b] };
    case 2:
    case 3:
      if (m.j !== s.waste.length - 1) return { draw: true };
      return { from: 'waste', n: 1, to: m.k === 2 ? foundationFor(s, top(s.waste)) : TABLEAU[m.b] };
    case 4: {
      const i = s.found.findIndex(f => f.length && suitOf(f[0]) === m.s && f.length === counts[m.s]);
      return { from: FOUNDATIONS[i], n: 1, to: TABLEAU[m.b] };
    }
  }
  return null;
}
