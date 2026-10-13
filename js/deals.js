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

// The way through Hint found last: every table it passes through, as the page plays it, with the move to show there.
// While the player does what Hint says (or comes back to a table on the way), the next move comes from here instead
// of a new search. That's quicker, and it can't lead back where it came from: a new search from each table sometimes
// did, a card up to its foundation and straight back down, round and round for good.
// It's kept only for the setting it was found with: a way found with cards going up by themselves off can count on a
// card waiting on the waste that, with the setting switched on, goes up by itself instead.
let line = new Map(), lineAuto = true;

// A table, the same however many moves it took to get there.
const where = s => JSON.stringify(s, (k, x) => (k === 'moves' || k === 'fan' ? undefined : x));

// What the page does after a move: cards that can go up by themselves do, unless the game is about to finish itself.
function settle(game, s, auto) {
  for (let step; auto && !game.won(s) && !game.finishable(s) && (step = game.autoStep(s));) s = game.move(s, step.from, step.n, step.to);
  return s;
}

// Play a solver's winning line on the table from here, noting the move to show at each table on the way.
// A card the line sends up that has already gone up by itself is skipped, and a card it wants from the stock is
// drawn for, a tap at a time. Once the line ends (as good as won) the easy hints carry on until the game finishes itself.
function follow(game, s, path, auto) {
  const out = new Map();
  let i = 0, taps = []; // the taps on the stock so far toward the card the line wants next
  for (let guard = 0; guard < 5000 && !game.won(s) && !game.finishable(s); guard++) {
    while (i < path.length && game.upAlready?.(s, path[i])) { i++; taps = []; }
    const m = i < path.length ? game.fromSolver(s, path[i]) : game.easyHint?.(s);
    const next = m && (m.stock ? game.stock(s) : game.move(s, m.from, m.n, m.to));
    const here = where(s);
    if (!next || out.has(here)) { // the line doesn't fit the table after all, so Hint will search again from here
      for (const t of taps) out.delete(t); // drawing for a card that wasn't coming
      break;
    }
    out.set(here, m);
    // A tap on the stock on the way to a card isn't a step of the line, but dealing a row in Spider is.
    if (m.stock && !path[i]?.deal) taps.push(here);
    else { taps = []; if (i < path.length) i++; }
    s = settle(game, next, auto);
  }
  return out;
}

// What to suggest from here, with cards going up by themselves or not (the setting). Resolves with one of:
//   { move: { from, n, to } }   play this
//   { move: { stock: true } }   tap the stock
//   { lost: true }              the search looked everywhere and there's no way through
//   { none: true }              nothing left to do at all
export async function hintFor(state, { auto = true } = {}) {
  const game = gameOf(state);
  const known = auto === lineAuto && line.get(where(state));
  if (known) return { move: known };
  line = new Map();
  lineAuto = auto;
  let search = await think(game.search(state, { auto }), game.budget.hint);
  // A search that leaves out moves which seldom help can't say there's no way through; look again with every move.
  // If that runs out too, Klondike's answer stands: its first search leaves out so little that a way through it missed
  // turns up quickly when there is one. Spider's leaves out more, so Hint suggests the move that looked best.
  if (search.result === 'lost' && game.searchAll) {
    const again = await think(game.searchAll(state, { auto }), game.budget.all);
    if (again.result || !game.lostStands) search = again;
  }
  if (search.result === 'won') {
    line = follow(game, state, search.path, auto);
    const m = search.path[0];
    return { move: line.get(where(state)) ?? (m ? game.fromSolver(state, m) : game.easyHint(state)) };
  }
  if (search.result === 'lost') return { lost: true };
  // Ran out of time: suggest the move that looked best.
  const m = search.firstMove();
  if (m) return { move: game.fromSolver(state, m) };
  return game.stock(state) ? { move: { stock: true } } : { none: true };
}
