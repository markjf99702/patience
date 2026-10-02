// A Klondike solver. It looks for a way to win from a position, seeing the face-down cards,
// and is used for two things: dealing only games that can be won, and the Hint button.
//
// It takes the position from forSolver() in klondike.js:
//   tab[i]   the cards in column i, bottom to top; the first down[i] of them are face down
//   found    how many cards of each suit are up
//   talon    the stock and waste as one line, in the order the cards come off the stock
//   pos      how many of those have been drawn: the waste's top card is talon[pos - 1]
//   draw     1 or 3, with as many passes through the stock as you like
//
// It searches depth first, most promising move first, and never looks at the same position twice.
// Drawing is never a move of its own: every card the stock can reach is offered directly,
// so the search doesn't go round in circles turning cards over.
//
// Moves are objects with k (the kind) and:
//   k 0: column a to the foundations        k 1: n cards from column a to column b
//   k 2: talon card j to the foundations    k 3: talon card j to column b
//   k 4: the top card of suit s back down from the foundations to column b

import { suitOf, rankOf, isRed, stacks, fits, safeUp } from './cards.js';

const top = a => a[a.length - 1];

export class Search {
  constructor(p) {
    this.tab = p.tab.map(c => c.slice());
    this.down = p.down.slice();
    this.found = p.found.slice();
    this.talon = p.talon.slice();
    this.pos = p.pos;
    this.draw = p.draw;
    this.seen = new Set();
    this.nodes = 0;
    this.stack = [];
    this.result = null; // 'won', 'lost' (looked everywhere) or null while still looking
    this.path = null;   // the moves that win, when there are some

    this.rootAutos = this.autos();
    if (this.done()) { this.finish(); return; }
    this.seen.add(this.key());
    this.stack.push({ moves: this.moves(), i: 0, via: null, autos: null });
  }

  // Look at up to `budget` more positions. Returns the result, or null if there's more to look at.
  step(budget) {
    if (this.result) return this.result;
    const stop = this.nodes + budget;
    const stack = this.stack;
    while (stack.length) {
      if (this.nodes >= stop) return null;
      const f = stack[stack.length - 1];
      if (f.i >= f.moves.length) {
        stack.pop();
        if (f.via) { this.undoAll(f.autos); this.undo(f.via); }
        continue;
      }
      const m = f.moves[f.i++];
      this.apply(m);
      const autos = this.autos();
      const k = this.key();
      if (this.seen.has(k)) { this.undoAll(autos); this.undo(m); continue; }
      this.seen.add(k);
      this.nodes++;
      if (this.done()) {
        stack.push({ moves: [], i: 0, via: m, autos });
        this.finish();
        return this.result;
      }
      stack.push({ moves: this.moves(), i: 0, via: m, autos });
    }
    this.result = 'lost';
    return this.result;
  }

  // Look until it knows, or until `max` positions have been seen ('unknown').
  run(max) {
    while (!this.result) {
      if (this.nodes >= max) return 'unknown';
      this.step(Math.min(5000, max - this.nodes));
    }
    return this.result;
  }

  finish() {
    this.result = 'won';
    const path = this.rootAutos.map(plain);
    for (const f of this.stack) if (f.via) path.push(plain(f.via), ...f.autos.map(plain));
    this.path = path;
    this.stack = [];
  }

  // Won, or as good as: every card is face up and nothing is left in the stock.
  // Drawing one at a time, every card in the stock can be reached, so face up is enough:
  // the lowest card still needed is then always on top of a column or somewhere in the stock.
  done() {
    for (let i = 0; i < 7; i++) if (this.down[i]) return false;
    return this.draw === 1 || this.talon.length === 0;
  }

  // Send up every card that nothing else could need. These aren't choices, so they ride along with the move before.
  autos() {
    const out = [];
    for (let again = true; again;) {
      again = false;
      for (let a = 0; a < 7; a++) {
        const t = this.tab[a];
        if (t.length > this.down[a] && safeUp(top(t), this.found)) {
          const m = { k: 0, a };
          this.apply(m); out.push(m); again = true;
        }
      }
      // Drawing one at a time, any card in the stock is as good as on top.
      const t = this.talon;
      if (this.draw === 1) {
        for (let j = 0; j < t.length; j++) {
          if (safeUp(t[j], this.found)) { const m = { k: 2, j }; this.apply(m); out.push(m); again = true; j--; }
        }
      } else if (this.pos > 0 && safeUp(t[this.pos - 1], this.found)) {
        const m = { k: 2, j: this.pos - 1 };
        this.apply(m); out.push(m); again = true;
      }
    }
    return out;
  }

  apply(m) {
    const { tab, found, talon } = this;
    switch (m.k) {
      case 0: { const c = tab[m.a].pop(); m.c = c; found[suitOf(c)]++; m.flip = this.flip(m.a); break; }
      case 1: { const t = tab[m.a]; tab[m.b].push(...t.splice(t.length - m.n, m.n)); m.flip = this.flip(m.a); break; }
      case 2: { const c = talon.splice(m.j, 1)[0]; m.c = c; m.pos = this.pos; this.pos = m.j; found[suitOf(c)]++; break; }
      case 3: { const c = talon.splice(m.j, 1)[0]; m.c = c; m.pos = this.pos; this.pos = m.j; tab[m.b].push(c); break; }
      case 4: { m.c = m.s * 13 + found[m.s] - 1; tab[m.b].push(m.c); found[m.s]--; break; }
    }
  }

  undo(m) {
    const { tab, down, found, talon } = this;
    switch (m.k) {
      case 0: if (m.flip) down[m.a]++; tab[m.a].push(m.c); found[suitOf(m.c)]--; break;
      case 1: { if (m.flip) down[m.a]++; const t = tab[m.b]; tab[m.a].push(...t.splice(t.length - m.n, m.n)); break; }
      case 2: found[suitOf(m.c)]--; talon.splice(m.j, 0, m.c); this.pos = m.pos; break;
      case 3: tab[m.b].pop(); talon.splice(m.j, 0, m.c); this.pos = m.pos; break;
      case 4: tab[m.b].pop(); found[m.s]++; break;
    }
  }

  undoAll(list) { for (let i = list.length - 1; i >= 0; i--) this.undo(list[i]); }

  // A column whose face-up cards are gone turns its next card over.
  flip(a) {
    if (this.down[a] && this.tab[a].length === this.down[a]) { this.down[a]--; return true; }
    return false;
  }

  // The positions in the talon that drawing can bring to the top of the waste, nearest first.
  reach() {
    const len = this.talon.length, d = this.draw;
    if (!len) return [];
    const out = [], seen = new Uint8Array(len + 1);
    let p = this.pos;
    if (p > 0) { out.push(p); seen[p] = 1; }
    for (let guard = 0; guard <= 2 * len + 2; guard++) {
      if (p === len) p = 0;
      p = Math.min(p + d, len);
      if (seen[p]) break;
      seen[p] = 1;
      out.push(p);
    }
    return out;
  }

  // Every move worth trying from here, best first.
  moves() {
    const { tab, down, found, talon } = this;
    const out = [];
    const add = (score, m) => { m.score = score; out.push(m); };
    const reach = this.reach();

    // Cards that could be moved onto something: reachable stock cards, column tops and the bottoms of face-up runs.
    const free = new Uint8Array(52);
    for (const p of reach) free[talon[p - 1]] = 1;
    let firstEmpty = -1;
    for (let a = 0; a < 7; a++) {
      const t = tab[a];
      if (!t.length) { if (firstEmpty < 0) firstEmpty = a; continue; }
      free[top(t)] = 1;
      free[t[down[a]]] = 1;
    }
    // Would uncovering card e be useful because another free card, other than c, could then go on it?
    const wanted = (e, c) => free[(suitOf(c) ^ 2) * 13 + rankOf(c) - 1] === 1;

    for (let a = 0; a < 7; a++) {
      const t = tab[a], len = t.length;
      if (!len) continue;
      const d = down[a];
      if (fits(top(t), found)) add(len - 1 === d && d > 0 ? 100 + d : 60, { k: 0, a });

      // The whole face-up run: worth it if it turns a card over or empties the column.
      const base = t[d];
      for (let b = 0; b < 7; b++) {
        if (b === a) continue;
        const tb = tab[b];
        if (!tb.length) {
          if (rankOf(base) === 13 && d > 0 && b === firstEmpty) add(85 + d, { k: 1, a, b, n: len - d });
        } else if (stacks(base, top(tb))) {
          add(d > 0 ? 90 + d : 40, { k: 1, a, b, n: len - d });
        }
      }

      // Part of a run: only if the card it uncovers can go up, or can take another card that's free.
      for (let i = d + 1; i < len; i++) {
        const c = t[i], e = t[i - 1];
        if (!fits(e, found) && !wanted(e, c)) continue;
        for (let b = 0; b < 7; b++) {
          if (b !== a && tab[b].length && stacks(c, top(tab[b]))) add(10, { k: 1, a, b, n: len - i });
        }
      }
    }

    // Cards from the stock, the one already showing first.
    reach.forEach((p, n) => {
      const j = p - 1, c = talon[j], now = p === this.pos;
      if (fits(c, found)) add(now ? 70 : 50 - n, { k: 2, j });
      for (let b = 0; b < 7; b++) {
        const tb = tab[b];
        if (tb.length ? stacks(c, top(tb)) : rankOf(c) === 13 && b === firstEmpty) add(now ? 65 : 45 - n, { k: 3, j, b });
      }
    });

    // Taking a card back down, when it could then hold a free card.
    for (let s = 0; s < 4; s++) {
      const r = found[s];
      if (r < 3) continue;
      const c = s * 13 + r - 1;
      const other = isRed(c) ? [0, 2] : [1, 3];
      if (!free[other[0] * 13 + r - 2] && !free[other[1] * 13 + r - 2]) continue;
      for (let b = 0; b < 7; b++) if (tab[b].length && stacks(c, top(tab[b]))) add(5, { k: 4, s, b });
    }

    out.sort((x, y) => y.score - x.score);
    return out;
  }

  // A fingerprint of the position, the same however the columns are ordered.
  // Drawing one at a time, the order of the stock and how far into it you are don't matter either.
  key() {
    const f = this.found, t = this.talon;
    let a = f[0] | (f[1] << 4) | (f[2] << 8) | (f[3] << 12);
    let b = a ^ 0x5bd1e995;
    if (this.draw === 1) {
      let sa = 0, sb = 0;
      for (let i = 0; i < t.length; i++) { sa = (sa + mix(t[i] + 101)) | 0; sb = (sb + mix(t[i] * 7919 + 13)) | 0; }
      a = mix(a ^ sa); b = mix(b ^ sb);
    } else {
      for (let i = 0; i < t.length; i++) {
        a = Math.imul(a ^ (t[i] + 1), 0x01000193);
        b = Math.imul(b + t[i] + 7, 0x9e3779b1) ^ (b >>> 15);
      }
      a = mix(a ^ (this.pos << 20)); b = mix(b + this.pos * 7919);
    }
    let sa = 0, sb = 0;
    for (let i = 0; i < 7; i++) {
      const c = this.tab[i];
      let x = 0x9747b28c ^ (this.down[i] << 8), y = 0x27d4eb2f + this.down[i];
      for (let j = 0; j < c.length; j++) {
        x = Math.imul(x ^ (c[j] + 1), 0x01000193);
        y = Math.imul(y + c[j] + 7, 0x9e3779b1) ^ (y >>> 13);
      }
      sa = (sa + mix(x)) | 0;
      sb = (sb + mix(y ^ 0x1234567)) | 0;
    }
    a = mix(a ^ sa);
    b = mix(b ^ sb ^ 0xabcdef);
    return (a & 0x1fffff) * 4294967296 + b;
  }
}

function mix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const plain = m => ({ k: m.k, a: m.a, b: m.b, n: m.n, j: m.j, s: m.s, c: m.c });

// Solve in one go (for tests and tools). Returns { result, path, nodes }.
export function solve(position, max = 200000) {
  const s = new Search(position);
  const result = s.run(max);
  return { result, path: s.path, nodes: s.nodes };
}
