// Solves Spider deals and replays every win through the table's own rules.
//   node dev/spider-check.mjs [s1|s2|s4] [deals] [max positions]
import { spider } from '../js/games/spider.js';

const V = process.argv[2] || 's1', N = +(process.argv[3] || 30), MAX = +(process.argv[4] || 120000);
const tally = { won: 0, lost: 0, unknown: 0 };
let total = 0, worst = 0, nodes = 0, lengths = 0;
const wins = [];
for (let n = 1; n <= N; n++) {
  let s = spider.deal(n, V);
  const t0 = performance.now();
  const search = spider.search(s), r = search.run(MAX);
  const ms = performance.now() - t0;
  total += ms; worst = Math.max(worst, ms); nodes += search.nodes; tally[r]++;
  if (r !== 'won') continue;
  wins.push(n);
  lengths += search.path.length;
  for (const m of search.path) {
    const ui = spider.fromSolver(s, m);
    s = ui.stock ? spider.stock(s) : spider.move(s, ui.from, ui.n, ui.to);
    if (!s) throw new Error(`deal ${n}: illegal ${JSON.stringify(m)}`);
  }
  if (!spider.won(s)) throw new Error(`deal ${n}: did not finish`);
}
console.log(`${V}, ${N} deals, max ${MAX}:`, tally, `avg ${(total / N).toFixed(0)} ms, worst ${worst.toFixed(0)} ms, avg nodes ${(nodes / N) | 0}, avg moves ${(lengths / Math.max(1, tally.won)).toFixed(0)}`);
