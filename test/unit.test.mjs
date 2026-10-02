// The rules and the solver, checked in Node:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { card, safeUp, stacks, fits, suitOf } from '../js/cards.js';
import { deal, draw, move, canDrop, bestTarget, autoStep, won, finishable, finishStep, forSolver, fromSolver, foundationFor, foundCounts, outOfMoves, TABLEAU, FOUNDATIONS } from '../js/games/klondike.js';
import { solve } from '../js/solvers/klondike.js';

const S = 0, H = 1, C = 2, D = 3;
const top = a => a[a.length - 1];
const empty = (drawCount = 1) => ({ deal: 0, draw: drawCount, stock: [], waste: [], fan: 0, found: [[], [], [], []], tab: Array.from({ length: 7 }, () => ({ down: [], up: [] })), moves: 0 });

test('a deal has every card once, laid out one to seven', () => {
  const s = deal(42, 1);
  const all = [...s.stock, ...s.tab.flatMap(t => [...t.down, ...t.up])];
  assert.equal(new Set(all).size, 52);
  s.tab.forEach((t, i) => { assert.equal(t.down.length, i); assert.equal(t.up.length, 1); });
  assert.equal(s.stock.length, 24);
  assert.deepEqual(deal(42, 1), s, 'the same number deals the same cards');
  assert.notDeepEqual(deal(43, 1).stock, s.stock);
});

test('columns build down in alternating colours; only kings go in an empty column', () => {
  const s = empty();
  s.tab[0].up = [card(S, 8)];
  assert.ok(canDrop(s, [card(H, 7)], 't0'));
  assert.ok(!canDrop(s, [card(C, 7)], 't0'), 'same colour');
  assert.ok(!canDrop(s, [card(H, 6)], 't0'), 'skips a rank');
  assert.ok(canDrop(s, [card(D, 13)], 't1'));
  assert.ok(!canDrop(s, [card(D, 12)], 't1'));
  assert.ok(stacks(card(D, 4), card(C, 5)));
});

test('foundations start with an ace and follow suit', () => {
  const s = empty();
  assert.ok(canDrop(s, [card(H, 1)], 'f2'));
  assert.ok(!canDrop(s, [card(H, 2)], 'f2'));
  s.found[2] = [card(H, 1)];
  assert.ok(canDrop(s, [card(H, 2)], 'f2'));
  assert.ok(!canDrop(s, [card(D, 2)], 'f2'));
  assert.ok(!canDrop(s, [card(H, 2), card(S, 1)], 'f2'), 'one card at a time');
});

test('moving a run turns over the card underneath', () => {
  const s = empty();
  s.tab[0] = { down: [card(C, 2)], up: [card(S, 9), card(H, 8)] };
  s.tab[1] = { down: [], up: [card(D, 10)] };
  const next = move(s, 't0', 2, 't1');
  assert.deepEqual(next.tab[1].up, [card(D, 10), card(S, 9), card(H, 8)]);
  assert.deepEqual(next.tab[0], { down: [], up: [card(C, 2)] });
  assert.equal(next.moves, 1);
  assert.equal(move(s, 't0', 1, 't1'), null, 'the 8 of hearts does not go on the 10');
  assert.deepEqual(s.tab[0].up, [card(S, 9), card(H, 8)], 'the old state is left alone');
});

test('drawing one or three, then turning the waste back over', () => {
  let s = deal(7, 3);
  const before = s.stock.slice();
  s = draw(s);
  assert.deepEqual(s.waste, before.slice(-3).reverse());
  assert.equal(s.fan, 3);
  s = move(s, 'waste', 1, 't0') || { ...s, waste: s.waste.slice(0, -1), fan: 2 };
  while (s.stock.length) s = draw(s);
  const waste = s.waste.slice();
  s = draw(s);
  assert.equal(s.waste.length, 0);
  assert.deepEqual(s.stock, waste.reverse(), 'same order as before');
  assert.equal(draw({ ...empty(), stock: [], waste: [] }), null);
});

test('a tap sends a card up first, then onto a column, never a lone king to another empty column', () => {
  const s = empty();
  s.tab[0].up = [card(S, 1)];
  assert.equal(bestTarget(s, 't0', 1), 'f0');
  s.tab[0].up = [card(S, 13)];
  assert.equal(bestTarget(s, 't0', 1), null);
  s.tab[0] = { down: [card(H, 3)], up: [card(S, 13)] };
  assert.equal(bestTarget(s, 't0', 1), 't1');
  s.tab[2].up = [card(D, 8)];
  s.waste = [card(C, 7)];
  assert.equal(bestTarget(s, 'waste', 1), 't2');
  s.found[0] = [card(H, 1)];
  s.tab[4].up = [card(S, 2)];
  assert.equal(bestTarget(s, 'f0', 1), null, 'a card already up stays up when tapped');
});

test('cards only go up by themselves once nothing could need them', () => {
  const counts = [2, 2, 0, 0];
  assert.ok(safeUp(card(S, 3), [2, 2, 2, 2]));
  assert.ok(!safeUp(card(S, 3), counts), 'a red 2 might still want to sit on it');
  assert.ok(safeUp(card(D, 1), counts));
  assert.ok(safeUp(card(D, 2), [0, 0, 0, 1]));
  const s = empty();
  s.tab[3].up = [card(C, 1)];
  assert.deepEqual(autoStep(s), { from: 't3', n: 1, to: 'f0' });
});

test('with every card face up, the rest plays itself', () => {
  const s = empty();
  for (let suit = 0; suit < 4; suit++) s.found[suit] = Array.from({ length: 11 }, (_, i) => card(suit, i + 1));
  s.tab[0].up = [card(S, 13), card(H, 12)];
  s.tab[1].up = [card(H, 13), card(S, 12)];
  s.tab[2].up = [card(C, 13), card(D, 12)];
  s.tab[3].up = [card(D, 13), card(C, 12)];
  assert.ok(finishable(s));
  let t = s;
  for (let i = 0; i < 8; i++) { const m = finishStep(t); t = move(t, m.from, m.n, m.to); }
  assert.ok(won(t));
});

// Play a solver's winning line through the table's own rules.
function replay(s, path) {
  for (const m of path) {
    if (m.k === 2 || m.k === 3) {
      let guard = 0;
      while (top(s.waste) !== m.c) { s = draw(s); assert.ok(s && ++guard < 200, 'the card never came up'); }
      s = move(s, 'waste', 1, m.k === 2 ? foundationFor(s, m.c) : TABLEAU[m.b]);
    } else if (m.k === 0) s = move(s, TABLEAU[m.a], 1, foundationFor(s, top(s.tab[m.a].up)));
    else if (m.k === 1) s = move(s, TABLEAU[m.a], m.n, TABLEAU[m.b]);
    else { const i = s.found.findIndex(f => f.length && suitOf(f[0]) === m.s); s = move(s, FOUNDATIONS[i], 1, TABLEAU[m.b]); }
    assert.ok(s, 'illegal move ' + JSON.stringify(m));
  }
  for (let guard = 0; guard < 3000 && !won(s); guard++) {
    const counts = foundCounts(s);
    const i = s.tab.findIndex(t => t.up.length && fits(top(t.up), counts));
    if (i >= 0) s = move(s, TABLEAU[i], 1, foundationFor(s, top(s.tab[i].up)));
    else if (s.waste.length && fits(top(s.waste), counts)) s = move(s, 'waste', 1, foundationFor(s, top(s.waste)));
    else s = draw(s);
  }
  return won(s);
}

for (const drawCount of [1, 3]) {
  test(`the solver's wins are real wins (draw ${drawCount})`, () => {
    let wins = 0;
    for (let n = 1; n <= 40; n++) {
      const s = deal(n, drawCount);
      const r = solve(forSolver(s), 100000);
      if (r.result !== 'won') continue;
      wins++;
      assert.ok(replay(s, r.path), `deal ${n} did not finish`);
    }
    assert.ok(wins >= 20, `only ${wins} of 40 deals solved`);
  });
}

test('a hint for a card deeper in the stock says to draw', () => {
  const s = draw(deal(3, 1));
  const p = forSolver(s);
  assert.deepEqual(fromSolver(s, { k: 3, j: p.pos, b: 0 }), { stock: true });
  assert.equal(fromSolver(s, { k: 2, j: p.pos - 1 }).from, 'waste');
});

test('a deal with no moves from the start is out of moves, and the solver calls it lost', () => {
  const s = deal(905, 3); // turning three at a time, nothing in the stock or on the table can move
  assert.equal(outOfMoves(s), true);
  assert.equal(solve(forSolver(s)).result, 'lost');
  assert.equal(outOfMoves(deal(905, 1)), false, 'one at a time, the same cards have moves');
});

test('a king with cards under it can still move to an empty column', () => {
  const s = empty();
  s.found = [11, 11, 11, 11].map((n, suit) => Array.from({ length: n }, (_, i) => card(suit, i + 1)));
  s.tab[0] = { down: [card(S, 12)], up: [card(H, 13)] };
  s.tab[1] = { down: [card(H, 12)], up: [card(S, 13)] };
  s.tab[2] = { down: [card(C, 12)], up: [card(D, 13)] };
  s.tab[3] = { down: [card(D, 12)], up: [card(C, 13)] };
  assert.equal(outOfMoves(s), false);
  assert.equal(solve(forSolver(s)).result, 'won');
});
