// A Spider solver, for checking deals and for the Hint button. It plays the game best first (see best-first.js),
// seeing the face-down cards and the order the stock will come out in.
//
// It takes the position from spider.js:
//   tab[i]   the cards in column i, bottom to top; the first down[i] of them are face down
//   stock    the cards still to deal, the last ten being the next row
//   sets     how many king-to-ace runs have been cleared away
//
// Moves are { a, i, b }: the cards from position i of column a up to its top, onto column b.
// Or { deal: true }: a row from the stock, one card on each column.

import { BestFirst } from './best-first.js';
import { suitOf, rankOf } from '../cards.js';

const top = a => a[a.length - 1];
const follows = (c, under) => suitOf(c) === suitOf(under) && rankOf(under) === rankOf(c) + 1;

const rules = {
  start(p) {
    const s = { tab: p.tab.map(c => c.slice()), down: p.down.slice(), stock: p.stock.slice(), sets: p.sets };
    for (let a = 0; a < 10; a++) clear(s, a);
    return { state: s, autos: [] };
  },

  apply(s, m) {
    const n = { tab: s.tab.slice(), down: s.down.slice(), stock: s.stock, sets: s.sets };
    if (m.deal) {
      n.stock = s.stock.slice(0, -10);
      for (let a = 0; a < 10; a++) n.tab[a] = [...s.tab[a], s.stock[s.stock.length - 1 - a]];
      for (let a = 0; a < 10; a++) clear(n, a);
    } else {
      const src = s.tab[m.a];
      n.tab[m.b] = s.tab[m.b].concat(src.slice(m.i));
      n.tab[m.a] = src.slice(0, m.i);
      if (n.down[m.a] && n.tab[m.a].length === n.down[m.a]) n.down[m.a]--;
      clear(n, m.b);
    }
    return { state: n, autos: [] };
  },

  // The whole suited run at the top of a column moves, and only somewhere that usually helps:
  // off a face-down card, off a card it doesn't belong on, or onto a card of its own suit.
  // Moving a run from one card of the wrong suit to another, or only part of a run, seldom helps, so neither is tried.
  moves(s) {
    const out = [], { tab, down } = s;
    let firstEmpty = -1;
    for (let a = 0; a < 10; a++) if (!tab[a].length) { firstEmpty = a; break; }
    for (let a = 0; a < 10; a++) {
      const t = tab[a], len = t.length;
      if (!len) continue;
      let i = len - 1;
      while (i > down[a] && follows(t[i], t[i - 1])) i--;
      const base = t[i];
      const onParent = i > down[a] && rankOf(t[i - 1]) === rankOf(base) + 1; // of another suit, or the run would be longer
      for (let b = 0; b < 10; b++) {
        if (b === a) continue;
        const tb = tab[b];
        if (!tb.length) {
          if (b === firstEmpty && i > 0) out.push({ a, i, b });
        } else if (rankOf(top(tb)) === rankOf(base) + 1 && (!onParent || suitOf(top(tb)) === suitOf(base))) {
          out.push({ a, i, b });
        }
      }
    }
    if (s.stock.length && firstEmpty < 0) out.push({ deal: true });
    return out;
  },

  key(s) {
    // Columns in any order play the same; the stock only matters by how much is left.
    const cols = s.tab.map((t, a) => String.fromCharCode(s.down[a] + 33, ...t.map(c => (c % 52) + 40))).sort();
    return s.stock.length + '|' + cols.join('|');
  },

  // Lower is closer to won: runs cleared, cards still face down, places where a column changes suit or breaks order,
  // and rows left in the stock; empty columns help.
  score(s) {
    let downs = 0, breaks = 0, empty = 0;
    for (let a = 0; a < 10; a++) {
      const t = s.tab[a];
      if (!t.length) { empty++; continue; }
      downs += s.down[a];
      for (let i = s.down[a] + 1; i < t.length; i++) if (!follows(t[i], t[i - 1])) breaks++;
    }
    return -s.sets * 60 + downs * 5 + breaks * 3 - empty * 4 + s.stock.length * 0.6;
  },

  done(s) { return s.sets === 8; },
};

// The same, but trying every move the table allows: any part of the run at the top of a column, onto any card
// one higher or into an empty column. Far slower to win with, so it's only for making sure, before saying
// a position can't be won, that none of the moves left out above was the way through.
const everyMove = {
  ...rules,
  moves(s) {
    const out = [], { tab, down } = s;
    let firstEmpty = -1;
    for (let a = 0; a < 10; a++) if (!tab[a].length) { firstEmpty = a; break; }
    for (let a = 0; a < 10; a++) {
      const t = tab[a], len = t.length;
      if (!len) continue;
      let i = len - 1;
      while (i > down[a] && follows(t[i], t[i - 1])) i--;
      for (let j = i; j < len; j++) {
        for (let b = 0; b < 10; b++) {
          if (b === a) continue;
          const tb = tab[b];
          if (!tb.length) {
            if (b === firstEmpty && j > 0) out.push({ a, i: j, b }); // a whole column into an empty one changes nothing
          } else if (rankOf(top(tb)) === rankOf(t[j]) + 1) {
            out.push({ a, i: j, b });
          }
        }
      }
    }
    if (s.stock.length && firstEmpty < 0) out.push({ deal: true });
    return out;
  },
};

// Nothing to do but move cards back and forth: no move, or string of moves, turns a card over, clears a run or
// empties a column. Tries every move, splitting runs too. Gives up and says no after `cap` positions.
export function stuck(position, cap = 400) {
  const { state } = rules.start(position);
  const downs = s => s.down.reduce((a, b) => a + b, 0), empties = s => s.tab.filter(t => !t.length).length;
  const sets = state.sets, d0 = downs(state), e0 = empties(state);
  const seen = new Set([rules.key(state)]), todo = [state];
  while (todo.length) {
    const s = todo.pop();
    for (const m of everyMove.moves(s)) {
      if (m.deal) return false;
      const next = rules.apply(s, m).state;
      if (next.sets > sets || downs(next) < d0 || empties(next) > e0) return false;
      const k = rules.key(next);
      if (seen.has(k)) continue;
      if (seen.size >= cap) return false;
      seen.add(k);
      todo.push(next);
    }
  }
  return true;
}

// Take away a finished king-to-ace run of one suit from the top of column a.
function clear(s, a) {
  const t = s.tab[a], len = t.length;
  if (len - s.down[a] < 13) return;
  for (let i = len - 13; i < len; i++) if (i > len - 13 && !follows(t[i], t[i - 1])) return;
  if (rankOf(t[len - 13]) !== 13) return;
  s.tab[a] = t.slice(0, len - 13);
  s.sets++;
  if (s.down[a] && s.tab[a].length === s.down[a]) s.down[a]--;
}

// every: try every move (see everyMove), not just the ones that usually help.
export class SpiderSearch extends BestFirst {
  constructor(position, { every = false } = {}) { super(every ? everyMove : rules, position, { weight: 0.2 }); }
}

export { rules as spiderRules };
