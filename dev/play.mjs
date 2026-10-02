// Helpers for driving the page from tests and tools: play a deal part way with the solver's own moves.
// Runs inside the page (pass to page.evaluate).
export async function playInto({ v, n, steps, ms = 0 }) {
  const { VARIANTS } = await import('./js/games/index.js');
  const game = VARIANTS[v].game;
  let s = game.deal(n, v);
  const search = game.search(s);
  while (!search.result && search.nodes < 400000) search.step(5000);
  if (search.result !== 'won') throw new Error(`${v} deal ${n} did not solve`);
  let i = 0, left = steps;
  while (i < search.path.length && left-- > 0) {
    const m = search.path[i], ui = game.fromSolver(s, m);
    if (ui.stock) {
      s = game.stock(s);
      // In Klondike a card deeper in the stock takes several draws before it can be played.
      if (!(v[0] === 'k' && (m.k === 2 || m.k === 3))) i++;
      continue;
    }
    s = game.move(s, ui.from, ui.n, ui.to);
    i++;
  }
  window.patience.load(s, ms);
  return { moves: search.path.length };
}
