// Helpers for driving the page from tests and tools: play a deal part way with the solver's own moves.
// Runs inside the page (pass to page.evaluate).
export async function playInto({ n, draw, steps, ms = 0 }) {
  const k = await import('./js/klondike.js');
  const { solve } = await import('./js/solver.js');
  let s = k.deal(n, draw);
  const r = solve(k.forSolver(s), 200000);
  if (r.result !== 'won') throw new Error('deal ' + n + ' did not solve');
  const top = a => a[a.length - 1];
  for (const m of r.path.slice(0, steps)) {
    if (m.k === 2 || m.k === 3) {
      let guard = 0;
      while (top(s.waste) !== m.c && guard++ < 100) s = k.draw(s);
      s = k.move(s, 'waste', 1, m.k === 2 ? k.foundationFor(s, m.c) : k.TABLEAU[m.b]);
    } else if (m.k === 0) s = k.move(s, k.TABLEAU[m.a], 1, k.foundationFor(s, top(s.tab[m.a].up)));
    else if (m.k === 1) s = k.move(s, k.TABLEAU[m.a], m.n, k.TABLEAU[m.b]);
    else if (m.k === 4) { const i = s.found.findIndex(f => f.length && (f[0] / 13 | 0) === m.s); s = k.move(s, k.FOUNDATIONS[i], 1, k.TABLEAU[m.b]); }
  }
  window.patience.load(s, ms);
  return { moves: r.path.length };
}
