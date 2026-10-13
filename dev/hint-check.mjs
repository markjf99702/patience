// Plays deals the way someone who always does what Hint says would: press Hint, make that move, let cards go up by
// themselves (or not), and again, until the game is won. Counts the games won, and any that end with "no way to win",
// a move the table refuses, or Hint leading back to a table it has already been at (round in circles for good).
//   node dev/hint-check.mjs [k1|k3|fc|s1|s2|s4] [deals] [on|off] [first deal]
// Deals are the ones the game would hand out from the first deal number on: those its solver wins within its limit.
import { VARIANTS } from '../js/games/index.js';
import { hintFor } from '../js/deals.js';

const V = process.argv[2] || 'k1', N = +(process.argv[3] || 30), AUTO = process.argv[4] !== 'off', FIRST = +(process.argv[5] || 1);
const game = VARIANTS[V].game;
const where = s => JSON.stringify(s, (k, x) => (k === 'moves' || k === 'fan' ? undefined : x));
const settle = s => {
  for (let st; AUTO && !game.won(s) && !game.finishable(s) && (st = game.autoStep(s));) s = game.move(s, st.from, st.n, st.to);
  while (game.finishable(s)) { const st = game.finishStep(s); s = game.move(s, st.from, st.n, st.to); }
  return s;
};

const tally = { won: 0, lost: 0, refused: 0, circles: 0, unfinished: 0 };
let presses = 0, slowest = 0;
for (let n = FIRST, played = 0; played < N; n++) {
  const check = game.search(game.deal(n, V));
  if (check.run(game.budget.deal) !== 'won') continue;
  played++;
  let s = settle(game.deal(n, V)), end = 'unfinished';
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    if (game.won(s)) { end = 'won'; break; }
    if (seen.has(where(s))) { end = 'circles'; break; }
    seen.add(where(s));
    const t0 = performance.now();
    const h = await hintFor(s, { auto: AUTO });
    slowest = Math.max(slowest, performance.now() - t0);
    presses++;
    if (!h.move) { end = 'lost'; break; }
    const next = h.move.stock ? game.stock(s) : game.move(s, h.move.from, h.move.n, h.move.to);
    if (!next) { end = 'refused'; break; }
    s = settle(next);
  }
  tally[end]++;
  if (end !== 'won') console.log(`deal ${n}: ${end}`);
}
console.log(`${V}, cards going up by themselves ${AUTO ? 'on' : 'off'}, ${N} deals:`, tally, `${presses} presses of Hint, slowest ${slowest.toFixed(0)} ms`);
