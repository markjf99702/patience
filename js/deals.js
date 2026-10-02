// Finding deals that can be won, and the Hint button's search. Both run a solver a slice at a time
// between frames, so the cards keep moving while it thinks.

import { VARIANTS, gameOf } from './games/index.js';
import { FOUR_SUIT_DEALS } from './games/spider-deals.js';

// Run a search in slices of a few milliseconds. Resolves with the search once it knows,
// or once it has looked at `max` positions.
function think(search, max) {
  return new Promise(resolve => {
    const tick = () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 8) {
        if (search.step(800) || search.nodes >= max) { resolve(search); return; }
      }
      setTimeout(tick, 0);
    };
    tick();
  });
}

// Keeps a winnable deal ready for the way you're playing, so New game doesn't have to wait.
export class Dealer {
  constructor(ready, onReady) {
    this.ready = { ...ready }; // way of playing -> deal number
    this.jobs = {};
    this.onReady = onReady;
  }

  async find(v) {
    const game = VARIANTS[v].game;
    for (;;) {
      const n = game.randomDeal();
      const s = await think(game.search(game.deal(n, v)), game.budget.deal);
      if (s.result === 'won') return n;
    }
  }

  // A deal number for a new game. Takes the one that's ready if there is one, and starts on the next.
  // Four-suit Spider deals can take a while to check, so until one is ready it uses one checked in advance.
  async take(v) {
    let n = this.ready[v];
    if (n) {
      delete this.ready[v];
    } else if (v === 's4' && FOUR_SUIT_DEALS.length) {
      n = FOUR_SUIT_DEALS[Math.floor(Math.random() * FOUR_SUIT_DEALS.length)];
    } else if (this.jobs[v]) {
      const job = this.jobs[v];
      job.claimed = true;
      n = await job.promise;
    } else {
      n = await this.find(v);
    }
    this.prepare(v);
    return n;
  }

  prepare(v) {
    if (this.ready[v] || this.jobs[v]) return;
    const job = { claimed: false };
    job.promise = this.find(v).then(n => {
      delete this.jobs[v];
      if (!job.claimed) { this.ready[v] = n; this.onReady?.(this.ready); }
      return n;
    });
    this.jobs[v] = job;
  }
}

// What to suggest from here. Resolves with one of:
//   { move: { from, n, to } }   play this
//   { move: { stock: true } }   tap the stock
//   { lost: true }              the search looked everywhere and there's no way through
//   { none: true }              nothing left to do at all
export async function hintFor(state) {
  const game = gameOf(state);
  const search = await think(game.search(state), game.budget.hint);
  if (search.result === 'won') {
    const m = search.path[0];
    return { move: m ? game.fromSolver(state, m) : game.easyHint(state) };
  }
  if (search.result === 'lost') return { lost: true };
  // Ran out of time: suggest the move that looked best.
  const m = search.firstMove();
  if (m) return { move: game.fromSolver(state, m) };
  return game.stock(state) ? { move: { stock: true } } : { none: true };
}
