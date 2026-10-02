// Finding deals that can be won, and the Hint button's search. Both run the solver a slice at a time
// between frames, so the cards keep moving while it thinks.

import { deal, forSolver, fromSolver, foundationFor, foundCounts, visible, TABLEAU } from './klondike.js';
import { Search } from './solver.js';
import { fits } from './cards.js';

const DEAL_BUDGET = 100000; // positions to try before giving up on a deal and shuffling another
const HINT_BUDGET = 300000;

export const randomDeal = () => 1 + Math.floor(Math.random() * 999999);

// Run a search in slices of about 10 ms. Resolves with the search once it knows, or once it has looked at `max` positions.
function think(search, max) {
  return new Promise(resolve => {
    const tick = () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 10) {
        if (search.step(1000) || search.nodes >= max) { resolve(search); return; }
      }
      setTimeout(tick, 0);
    };
    tick();
  });
}

// Keeps one winnable deal ready for each way of playing, so New game doesn't have to wait.
export class Dealer {
  constructor(ready, onReady) {
    this.ready = { ...ready }; // draw -> deal number
    this.jobs = {};
    this.onReady = onReady;
  }

  async find(draw) {
    for (;;) {
      const n = randomDeal();
      const s = await think(new Search(forSolver(deal(n, draw))), DEAL_BUDGET);
      if (s.result === 'won') return n;
    }
  }

  // A deal number for a new game. Takes the one that's ready if there is one, and starts on the next.
  async take(draw) {
    let n = this.ready[draw];
    if (n) {
      delete this.ready[draw];
    } else if (this.jobs[draw]) {
      const job = this.jobs[draw];
      job.claimed = true;
      n = await job.promise;
    } else {
      n = await this.find(draw);
    }
    this.prepare(draw);
    return n;
  }

  prepare(draw) {
    if (this.ready[draw] || this.jobs[draw]) return;
    const job = { claimed: false };
    job.promise = this.find(draw).then(n => {
      delete this.jobs[draw];
      if (!job.claimed) { this.ready[draw] = n; this.onReady?.(this.ready); }
      return n;
    });
    this.jobs[draw] = job;
  }
}

// What to suggest from here. Resolves with one of:
//   { move: { from, n, to } }   play this
//   { move: { draw: true } }    turn over the stock
//   { lost: true }              the search looked everywhere and there's no way through
//   { none: true }              nothing left to do at all
export async function hintFor(state) {
  const search = await think(new Search(forSolver(state)), HINT_BUDGET);
  if (search.result === 'won') {
    if (search.path.length) return { move: fromSolver(state, search.path[0]) };
    return { move: simple(state) };
  }
  if (search.result === 'lost') return { lost: true };
  // Ran out of time: suggest the move it liked best to begin with.
  const fresh = new Search(forSolver(state));
  const first = fresh.rootAutos[0] || fresh.stack[0]?.moves[0];
  if (first) return { move: fromSolver(state, first) };
  return state.stock.length || state.waste.length ? { move: { draw: true } } : { none: true };
}

// With everything face up: put up the lowest card that fits, or draw.
function simple(state) {
  const counts = foundCounts(state);
  const from = ['waste', ...TABLEAU].find(id => {
    const v = visible(state, id);
    return v.length && fits(v[v.length - 1], counts);
  });
  if (from) return { from, n: 1, to: foundationFor(state, visible(state, from).at(-1)) };
  return { draw: true };
}

// Is there anything useful left to do? Shuffling a run from one column to another doesn't count,
// unless it would empty a column for a king that's waiting.
export function outOfMoves(state) {
  const p = forSolver(state);
  const s = new Search(p);
  if (s.result === 'won' || s.rootAutos.length) return false;
  const moves = s.stack[0].moves;
  const shuffle = m => m.k === 1 && p.tab[m.a].length - m.n === 0;
  if (moves.some(m => !shuffle(m))) return false;
  if (!moves.length) return true;
  const kingWaiting =
    p.talon.some(c => c % 13 === 12) ||
    p.tab.some((t, a) => p.down[a] > 0 && t.length > p.down[a] && t[p.down[a]] % 13 === 12);
  return !kingWaiting;
}
