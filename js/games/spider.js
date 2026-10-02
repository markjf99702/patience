// The rules of Spider, as the table plays them. Two decks, ten columns, and fifty cards in the stock
// to deal out a row at a time. Build down in any suit, but only a run of one suit moves together,
// and a whole run from king to ace of one suit clears away. Clear eight to win.
//
// Piles are 'stock', 'sets' (the cleared runs) and 't0'..'t9'.
// One suit plays with eight sets of spades, two suits with four each of spades and hearts, four suits with two of each.

import { suitOf, rankOf } from '../cards.js';
import { shuffle } from '../rng.js';
import { SpiderSearch, spiderRules } from '../solvers/spider.js';

const T = Array.from({ length: 10 }, (_, i) => 't' + i);
const SUITS = { s1: [0], s2: [0, 1], s4: [0, 1, 2, 3] };
const top = a => a[a.length - 1];
const col = id => +id.slice(1);
const follows = (c, under) => suitOf(c) === suitOf(under) && rankOf(under) === rankOf(c) + 1;

// The 104 cards for a way of playing, each one distinct (see cards.js).
function deck(v) {
  const suits = SUITS[v], copies = 8 / suits.length, out = [];
  for (let k = 0; k < copies; k++) for (const s of suits) for (let r = 0; r < 13; r++) out.push(k * 52 + s * 13 + r);
  return out;
}

export function deal(n, v) {
  const cards = shuffle(deck(v), n * 2654435761 + 7919 * v.charCodeAt(1));
  const tab = T.map(() => ({ down: [], up: [] }));
  // Six cards in each of the first four columns and five in the rest, the top one face up.
  for (let k = 0; k < 54; k++) tab[k % 10].down.push(cards[k]);
  for (const t of tab) t.up.push(t.down.pop());
  return { v, deal: n, tab, stock: cards.slice(54), sets: [], moves: 0 };
}

function clone(s) {
  return { ...s, stock: s.stock.slice(), sets: s.sets.map(x => x.slice()), tab: s.tab.map(t => ({ down: t.down.slice(), up: t.up.slice() })) };
}

// A column whose face-up cards are gone turns its next card over.
function flip(t) {
  if (!t.up.length && t.down.length) t.up.push(t.down.pop());
}

// A finished king-to-ace run of one suit on top of a column goes away to the sets.
function clear(s, t) {
  const up = t.up, n = up.length;
  if (n < 13 || rankOf(up[n - 13]) !== 13) return;
  for (let i = n - 12; i < n; i++) if (!follows(up[i], up[i - 1])) return;
  s.sets.push(up.splice(n - 13, 13).reverse()); // ace at the bottom of its pile, king on top
  flip(t);
}

const isRun = cards => cards.every((c, i) => i === 0 || follows(c, cards[i - 1]));

export const spider = {
  deal,

  layout(s, left) {
    return {
      cols: 10,
      rows: 6.6,
      top: [
        { id: 'sets', col: left ? 9 : 0, kind: 'sets', dir: left ? -1 : 1, label: 'K' },
        { id: 'stock', col: left ? 0 : 9, kind: 'deals', dir: left ? 1 : -1 },
      ],
      tableau: T,
      dealFrom: 'stock',
    };
  },

  pile(s, id) {
    if (id === 'stock') return { down: s.stock, up: [] };
    if (id === 'sets') return { down: [], up: s.sets.flat() };
    return s.tab[col(id)];
  },

  cardIds(s) { return deck(s.v); },

  // Only a run of one suit, in order, comes off a column together.
  lift(s, id, index) {
    if (id[0] !== 't') return null;
    const cards = s.tab[col(id)].up.slice(index);
    return cards.length && isRun(cards) ? cards : null;
  },

  targets() { return T; },

  canDrop(s, cards, to) {
    if (!cards?.length || to[0] !== 't' || !isRun(cards)) return false;
    const t = s.tab[col(to)];
    if (!t.up.length && !t.down.length) return true;
    return t.up.length > 0 && rankOf(top(t.up)) === rankOf(cards[0]) + 1;
  },

  move(s, from, n, to) {
    if (from === to || from[0] !== 't') return null;
    const src = s.tab[col(from)].up;
    const cards = spider.lift(s, from, src.length - n);
    if (!cards || !spider.canDrop(s, cards, to)) return null;
    const next = clone(s);
    next.tab[col(from)].up.splice(src.length - n, n);
    next.tab[col(to)].up.push(...cards);
    flip(next.tab[col(from)]);
    clear(next, next.tab[col(to)]);
    next.moves++;
    return next;
  },

  // Deal a row: one card face up on every column. Not while a column is empty.
  stock(s) {
    if (!s.stock.length || s.tab.some(t => !t.up.length && !t.down.length)) return null;
    const next = clone(s);
    for (const t of next.tab) t.up.push(next.stock.pop());
    for (const t of next.tab) clear(next, t);
    next.moves++;
    return next;
  },

  stockNote(s) {
    if (!s.stock.length) return null;
    return s.tab.some(t => !t.up.length && !t.down.length) ? 'Put a card in every empty column before dealing a new row.' : null;
  },

  // A tap sends a run onto a card one higher of its own suit if there is one, then any card one higher,
  // then an empty column (unless the run is the whole column already).
  tapTarget(s, from, n) {
    const cards = spider.lift(s, from, s.tab[col(from)].up.length - n);
    if (!cards) return null;
    const base = cards[0], src = s.tab[col(from)];
    const whole = !src.down.length && src.up.length === n;
    const start = col(from);
    const order = T.map((id, i) => ({ id, i, t: s.tab[i] }))
      .filter(x => x.id !== from && spider.canDrop(s, cards, x.id))
      .map(x => {
        const empty = !x.t.up.length && !x.t.down.length;
        return { ...x, empty, rank: empty ? 2 : suitOf(top(x.t.up)) === suitOf(base) ? 0 : 1 };
      })
      .filter(x => !(x.empty && whole));
    order.sort((a, b) => a.rank - b.rank || ((a.i - start + 10) % 10) - ((b.i - start + 10) % 10));
    return order[0]?.id ?? null;
  },

  autoStep() { return null; },
  won: s => s.sets.length === 8,
  finishable: () => false,
  finishStep: () => null,

  position(s) {
    return { tab: s.tab.map(t => [...t.down, ...t.up]), down: s.tab.map(t => t.down.length), stock: s.stock.slice(), sets: s.sets.length };
  },
  search(s) { return new SpiderSearch(spider.position(s)); },

  fromSolver(s, m) {
    if (m.deal) return { stock: true };
    const t = s.tab[m.a];
    return { from: T[m.a], n: t.down.length + t.up.length - m.i, to: T[m.b] };
  },

  // Nothing useful left: no row to deal and no run that can go anywhere it helps.
  outOfMoves(s) {
    if (s.stock.length) return false;
    return spiderRules.moves(spiderRules.start(spider.position(s)).state).length === 0;
  },

  // The cleared runs come down off the table kings first, the last one cleared first.
  bounceOrder(s) {
    const out = [];
    for (let i = s.sets.length - 1; i >= 0; i--) for (let k = 12; k >= 0; k--) out.push(s.sets[i][k]);
    return out;
  },

  dealOrder(s) {
    const out = [];
    for (let k = 0; k < 54; k++) {
      const t = s.tab[k % 10], all = [...t.down, ...t.up];
      out.push(all[(k / 10) | 0]);
    }
    return out;
  },

  randomDeal: () => 1 + Math.floor(Math.random() * 999999),
  budget: { deal: 120000, hint: 80000 },
};
