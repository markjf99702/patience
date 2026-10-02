// Solves FreeCell deals and replays every win move by move with its own simple rule checks.
//   node dev/freecell-check.mjs [deals] [max positions] [first deal]
import { freecellDeal } from '../js/rng.js';
import { FreeCellSearch } from '../js/solvers/freecell.js';
import { suitOf, rankOf, stacks, fits } from '../js/cards.js';

const N = +(process.argv[2] || 100), MAX = +(process.argv[3] || 200000), FIRST = +(process.argv[4] || 1);
const top = a => a[a.length - 1];

function position(n) {
  const tab = Array.from({ length: 8 }, () => []);
  freecellDeal(n).forEach((c, k) => tab[k % 8].push(c));
  return { tab, cells: [-1, -1, -1, -1], found: [0, 0, 0, 0] };
}

function replay(p, path) {
  const s = { tab: p.tab.map(c => c.slice()), cells: p.cells.slice(), found: p.found.slice() };
  const ok = (cond, m) => { if (!cond) throw new Error('illegal ' + JSON.stringify(m)); };
  for (const m of path) {
    const free = s.cells.filter(c => c < 0).length, empty = s.tab.filter(c => !c.length).length;
    if (m.k === 'tf') { const c = s.tab[m.a].pop(); ok(c !== undefined && fits(c, s.found), m); s.found[suitOf(c)]++; }
    else if (m.k === 'cf') { const c = s.cells[m.i]; ok(c >= 0 && fits(c, s.found), m); s.found[suitOf(c)]++; s.cells[m.i] = -1; }
    else if (m.k === 'ct') { const c = s.cells[m.i], t = s.tab[m.b]; ok(c >= 0 && (!t.length || stacks(c, top(t))), m); t.push(c); s.cells[m.i] = -1; }
    else if (m.k === 'tc') { ok(s.cells[m.i] < 0 && s.tab[m.a].length, m); s.cells[m.i] = s.tab[m.a].pop(); }
    else if (m.k === 'tt') {
      const src = s.tab[m.a], dst = s.tab[m.b], run = src.slice(src.length - m.n);
      ok(run.length === m.n, m);
      for (let i = 1; i < run.length; i++) ok(stacks(run[i], run[i - 1]), m);
      ok(dst.length ? stacks(run[0], top(dst)) : true, m);
      ok(m.n <= (free + 1) * 2 ** Math.max(0, empty - (dst.length ? 0 : 1)), m);
      src.length -= m.n; dst.push(...run);
    }
  }
  for (let guard = 0; guard < 200; guard++) {
    const a = s.tab.findIndex(c => c.length && fits(top(c), s.found));
    if (a >= 0) { s.found[suitOf(s.tab[a].pop())]++; continue; }
    const i = s.cells.findIndex(c => c >= 0 && fits(c, s.found));
    if (i >= 0) { s.found[suitOf(s.cells[i])]++; s.cells[i] = -1; continue; }
    break;
  }
  if (s.found.some(f => f !== 13)) throw new Error('did not finish');
}

const tally = { won: 0, lost: 0, unknown: 0 };
let worst = 0, total = 0, lengths = 0, nodes = 0;
const fails = [];
for (let n = FIRST; n < FIRST + N; n++) {
  const p = position(n), t0 = performance.now();
  const s = new FreeCellSearch(p), r = s.run(MAX);
  const ms = performance.now() - t0;
  total += ms; worst = Math.max(worst, ms); nodes += s.nodes;
  tally[r]++;
  if (r === 'won') { replay(p, s.path); lengths += s.path.length; } else fails.push(n);
}
console.log(`${N} deals from ${FIRST}, max ${MAX}:`, tally, `avg ${(total / N).toFixed(0)} ms, worst ${worst.toFixed(0)} ms, avg nodes ${(nodes / N) | 0}, avg moves ${(lengths / Math.max(1, tally.won)).toFixed(0)}`, fails.length ? 'not solved: ' + fails.join(' ') : '');
