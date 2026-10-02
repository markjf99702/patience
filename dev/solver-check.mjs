// Solves many deals, then replays each winning line through the table's own rules to make sure it really wins.
//   node dev/solver-check.mjs [deals] [draw] [max positions]
import { deal, forSolver, move, draw as drawCards, foundationFor, won, TABLEAU, FOUNDATIONS, foundCounts } from '../js/klondike.js';
import { solve } from '../js/solver.js';
import { fits, suitOf } from '../js/cards.js';

const N = +(process.argv[2] || 200), D = +(process.argv[3] || 1), MAX = +(process.argv[4] || 200000);
const top = a => a[a.length - 1];

function replay(s, path) {
  for (const m of path) {
    if (m.k === 2 || m.k === 3) {
      let guard = 0;
      while (top(s.waste) !== m.c) { s = drawCards(s); if (!s || ++guard > 200) throw new Error('card never came up'); }
      s = move(s, 'waste', 1, m.k === 2 ? foundationFor(s, m.c) : TABLEAU[m.b]);
    } else if (m.k === 0) s = move(s, TABLEAU[m.a], 1, foundationFor(s, top(s.tab[m.a].up)));
    else if (m.k === 1) s = move(s, TABLEAU[m.a], m.n, TABLEAU[m.b]);
    else if (m.k === 4) { const i = s.found.findIndex(f => f.length && suitOf(f[0]) === m.s); s = move(s, FOUNDATIONS[i], 1, TABLEAU[m.b]); }
    if (!s) throw new Error('illegal move ' + JSON.stringify(m));
  }
  // Play out the rest: anything that fits, drawing when nothing on the table does.
  for (let guard = 0; guard < 5000 && !won(s); guard++) {
    const counts = foundCounts(s);
    const i = s.tab.findIndex(t => t.up.length && fits(top(t.up), counts));
    if (i >= 0) { s = move(s, TABLEAU[i], 1, foundationFor(s, top(s.tab[i].up))); continue; }
    if (s.waste.length && fits(top(s.waste), counts)) { s = move(s, 'waste', 1, foundationFor(s, top(s.waste))); continue; }
    s = drawCards(s);
    if (!s) break;
  }
  if (!s || !won(s)) throw new Error('did not finish');
}

const tally = { won: 0, lost: 0, unknown: 0 };
let nodes = 0, slow = 0, t0 = performance.now(), worst = 0;
for (let n = 1; n <= N; n++) {
  const s = deal(n, D);
  const a = performance.now();
  const r = solve(forSolver(s), MAX);
  const ms = performance.now() - a;
  worst = Math.max(worst, ms);
  tally[r.result]++; nodes += r.nodes;
  if (r.result === 'won') replay(s, r.path);
}
const total = performance.now() - t0;
console.log(`draw ${D}, ${N} deals, max ${MAX}:`, tally, `avg ${(total / N).toFixed(1)} ms, worst ${worst.toFixed(0)} ms, avg nodes ${(nodes / N) | 0}`);
