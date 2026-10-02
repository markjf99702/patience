// A best-first search, shared by the FreeCell and Spider solvers. It always looks next at the most promising
// position found so far, by the game's own score (lower is better) plus a little for each move it took to get there,
// and never looks at the same position twice.
//
// The game supplies:
//   start(position)  -> { state, autos }   the position, with any moves that make themselves already made
//   moves(state)     -> [move]             the moves worth trying
//   apply(state, m)  -> { state, autos }   a new state; the old one is left alone
//   key(state)       -> string             the same for positions that play the same
//   score(state)     -> number             how far from won it looks; lower is better
//   done(state)      -> boolean            won, or as good as
//
// Like the Klondike solver, it can be run a slice at a time with step().

export class BestFirst {
  constructor(game, position, { weight = 0.3 } = {}) {
    this.game = game;
    this.weight = weight;
    this.seen = new Set();
    this.heap = new Heap();
    this.nodes = 0;
    this.result = null; // 'won', 'lost' (looked everywhere) or null while still looking
    this.path = null;   // the moves that win, when there are some
    const { state, autos } = game.start(position);
    this.root = { state, parent: null, move: null, autos, g: 0 };
    this.best = null;   // the most promising position seen, for a hint when time runs out
    if (game.done(state)) { this.finish(this.root); return; }
    this.seen.add(game.key(state));
    this.heap.push(this.root, game.score(state));
  }

  step(budget) {
    if (this.result) return this.result;
    const g = this.game, stop = this.nodes + budget;
    while (this.heap.size) {
      if (this.nodes >= stop) return null;
      const node = this.heap.pop();
      for (const m of g.moves(node.state)) {
        const { state, autos } = g.apply(node.state, m);
        const k = g.key(state);
        if (this.seen.has(k)) continue;
        this.seen.add(k);
        this.nodes++;
        const child = { state, parent: node, move: m, autos, g: node.g + 1 };
        if (g.done(state)) { this.finish(child); return this.result; }
        const score = g.score(state);
        if (!this.best || score < this.best.score) this.best = { node: child, score };
        this.heap.push(child, score + this.weight * child.g);
      }
    }
    this.result = 'lost';
    return this.result;
  }

  run(max) {
    while (!this.result) {
      if (this.nodes >= max) return 'unknown';
      this.step(Math.min(5000, max - this.nodes));
    }
    return this.result;
  }

  finish(node) {
    this.result = 'won';
    this.path = pathTo(node);
    this.heap = new Heap();
  }

  // The first move toward the most promising position found, for when there wasn't time to finish.
  firstMove() {
    if (this.path) return this.path[0] ?? null;
    if (this.root.autos.length) return this.root.autos[0];
    return this.best ? pathTo(this.best.node)[0] ?? null : null;
  }
}

function pathTo(node) {
  const chain = [];
  for (let n = node; n; n = n.parent) chain.push(n);
  chain.reverse();
  const path = [...chain[0].autos];
  for (const n of chain.slice(1)) path.push(n.move, ...n.autos);
  return path;
}

// A binary min-heap of items by priority. Ties go to the item pushed first.
class Heap {
  constructor() { this.items = []; this.keys = []; this.order = []; this.count = 0; }
  get size() { return this.items.length; }
  less(i, j) { return this.keys[i] < this.keys[j] || (this.keys[i] === this.keys[j] && this.order[i] < this.order[j]); }
  swap(i, j) {
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
    [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
  }
  push(item, key) {
    this.items.push(item); this.keys.push(key); this.order.push(this.count++);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop() {
    const top = this.items[0], last = this.items.length - 1;
    this.swap(0, last);
    this.items.pop(); this.keys.pop(); this.order.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.items.length && this.less(l, m)) m = l;
      if (r < this.items.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}
