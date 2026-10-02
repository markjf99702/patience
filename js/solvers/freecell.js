// A FreeCell solver, for checking deals and for the Hint button. It plays the game best first (see best-first.js).
//
// It takes the position from freecell.js:
//   tab[i]   the cards in column i, bottom to top
//   cells    the four free cells, a card or -1 when empty
//   found    how many cards of each suit are up
//
// Moves are objects with k (the kind) and:
//   'tf': the top of column a to the foundations     'cf': free cell i to the foundations
//   'ct': free cell i to column b                    'tc': the top of column a to free cell i
//   'tt': n cards from column a to column b, as many as the free cells and empty columns allow

import { BestFirst } from './best-first.js';
import { suitOf, rankOf, stacks, fits, safeUp } from '../cards.js';

const top = a => a[a.length - 1];

const rules = {
  start(p) {
    const s = { tab: p.tab.map(c => c.slice()), cells: p.cells.slice(), found: p.found.slice() };
    return { state: s, autos: settle(s) };
  },

  apply(s, m) {
    const n = { tab: s.tab.slice(), cells: s.cells.slice(), found: s.found.slice() };
    play(n, m);
    return { state: n, autos: settle(n) };
  },

  moves(s) {
    const out = [], { tab, cells, found } = s;
    const free = cells.filter(c => c < 0).length;
    const firstCell = cells.indexOf(-1);
    let empty = 0, firstEmpty = -1;
    for (let a = 0; a < 8; a++) if (!tab[a].length) { empty++; if (firstEmpty < 0) firstEmpty = a; }
    // How many cards can move at once: one per free cell plus one, doubled for each empty column not being moved into.
    const room = toEmpty => (free + 1) * 2 ** Math.max(0, empty - (toEmpty ? 1 : 0));

    for (let a = 0; a < 8; a++) if (tab[a].length && fits(top(tab[a]), found)) out.push({ k: 'tf', a, c: top(tab[a]) });
    for (let i = 0; i < 4; i++) if (cells[i] >= 0 && fits(cells[i], found)) out.push({ k: 'cf', i, c: cells[i] });

    for (let i = 0; i < 4; i++) {
      const c = cells[i];
      if (c < 0) continue;
      for (let b = 0; b < 8; b++) {
        if (tab[b].length ? stacks(c, top(tab[b])) : b === firstEmpty) out.push({ k: 'ct', i, b, c });
      }
    }

    for (let a = 0; a < 8; a++) {
      const col = tab[a], len = col.length;
      if (!len) continue;
      let run = 1;
      while (run < len && stacks(col[len - run], col[len - run - 1])) run++;
      for (let b = 0; b < 8; b++) {
        if (b === a) continue;
        if (tab[b].length) {
          // Only one length of the run can fit: the one whose bottom card is one below the target.
          const t = top(tab[b]), n = rankOf(t) - rankOf(col[len - 1]);
          if (n >= 1 && n <= run && n <= room(false) && stacks(col[len - n], t)) out.push({ k: 'tt', a, b, n });
        } else if (b === firstEmpty) {
          for (let n = Math.min(run, room(true)); n >= 1; n--) if (n < len) out.push({ k: 'tt', a, b, n });
        }
      }
    }

    if (firstCell >= 0) for (let a = 0; a < 8; a++) if (tab[a].length) out.push({ k: 'tc', a, i: firstCell, c: top(tab[a]) });
    return out;
  },

  // Columns in any order and free cells in any order play the same.
  key(s) {
    const cols = s.tab.map(col => String.fromCharCode(...col.map(c => c + 40))).sort();
    const cells = s.cells.filter(c => c >= 0).sort((x, y) => x - y);
    return String.fromCharCode(...cells.map(c => c + 40)) + '|' + cols.join('|');
  },

  // Lower is closer to won: cards still to go up, cards sitting on top of the next ones needed,
  // columns out of order, and free cells in use; empty columns help.
  score(s) {
    const { tab, cells, found } = s;
    const depth = new Map();
    let breaks = 0, empty = 0;
    for (const col of tab) {
      if (!col.length) { empty++; continue; }
      for (let i = 0; i < col.length; i++) {
        depth.set(col[i], col.length - 1 - i);
        if (i && !stacks(col[i], col[i - 1])) breaks++;
      }
    }
    let buried = 0, up = 0;
    for (let suit = 0; suit < 4; suit++) {
      up += found[suit];
      if (found[suit] < 13) buried += depth.get(suit * 13 + found[suit]) ?? 0;
    }
    const used = cells.filter(c => c >= 0).length;
    return (52 - up) * 0.6 + buried * 1.2 + breaks * 1.5 + used * 0.6 - empty * 1.2;
  },

  // Every column in order: the rest goes up by itself, the lowest card first.
  done(s) {
    for (const col of s.tab) for (let i = 1; i < col.length; i++) if (!stacks(col[i], col[i - 1])) return false;
    return true;
  },
};

function play(n, m) {
  switch (m.k) {
    case 'tf': { const col = (n.tab[m.a] = n.tab[m.a].slice()); n.found[suitOf(col.pop())]++; break; }
    case 'cf': { n.found[suitOf(n.cells[m.i])]++; n.cells[m.i] = -1; break; }
    case 'ct': { n.tab[m.b] = [...n.tab[m.b], n.cells[m.i]]; n.cells[m.i] = -1; break; }
    case 'tc': { const col = (n.tab[m.a] = n.tab[m.a].slice()); n.cells[m.i] = col.pop(); break; }
    case 'tt': {
      const src = n.tab[m.a];
      n.tab[m.b] = n.tab[m.b].concat(src.slice(src.length - m.n));
      n.tab[m.a] = src.slice(0, src.length - m.n);
      break;
    }
  }
}

// Send up every card nothing else could need, the way the table does.
function settle(n) {
  const autos = [];
  for (let again = true; again;) {
    again = false;
    for (let a = 0; a < 8; a++) {
      const col = n.tab[a];
      if (col.length && safeUp(top(col), n.found)) { const m = { k: 'tf', a, c: top(col) }; play(n, m); autos.push(m); again = true; }
    }
    for (let i = 0; i < 4; i++) {
      const c = n.cells[i];
      if (c >= 0 && safeUp(c, n.found)) { const m = { k: 'cf', i, c }; play(n, m); autos.push(m); again = true; }
    }
  }
  return autos;
}

export class FreeCellSearch extends BestFirst {
  constructor(position) { super(rules, position, { weight: 0.5 }); }
}

export { rules as freecellRules };
