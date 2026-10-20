// The rules and the solver, checked in Node:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { card, safeUp, stacks, fits, suitOf } from '../js/cards.js';
import { deal, draw, move, canDrop, bestTarget, autoStep, won, finishable, finishStep, forSolver, fromSolver, easyHint, foundationFor, foundCounts, outOfMoves, TABLEAU, FOUNDATIONS } from '../js/games/klondike.js';
import { solve, Search } from '../js/solvers/klondike.js';
import { hintFor } from '../js/deals.js';

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

// The same with "Send cards up by themselves" on, the way the table plays it: after every move and every tap on the deck,
// any card that can go up by itself does. A card the line sends up later is skipped once it's up, and a card it wants
// from the deck is drawn for until it shows, however many cards went up on the way.
function replayAuto(s, path) {
  const settle = t => { for (let st = autoStep(t); st && !won(t); st = autoStep(t)) t = move(t, st.from, st.n, st.to); return t; };
  const isUp = c => s.found.some(f => f.includes(c));
  s = settle(s);
  for (const m of path) {
    if ((m.k === 0 || m.k === 2) && isUp(m.c)) continue;
    if (m.k === 2 || m.k === 3) {
      for (let guard = 0; top(s.waste) !== m.c && !isUp(m.c); guard++) {
        assert.ok(guard < 100, `the ${m.c} never came to the top of the waste`);
        s = settle(draw(s));
      }
      if (isUp(m.c)) { assert.equal(m.k, 2, `the ${m.c} went up by itself, but the line wanted it on a column`); continue; }
      s = move(s, 'waste', 1, m.k === 2 ? foundationFor(s, m.c) : TABLEAU[m.b]);
    } else if (m.k === 0) s = move(s, TABLEAU[m.a], 1, foundationFor(s, top(s.tab[m.a].up)));
    else if (m.k === 1) s = move(s, TABLEAU[m.a], m.n, TABLEAU[m.b]);
    else { const i = s.found.findIndex(f => f.length && suitOf(f[0]) === m.s); s = move(s, FOUNDATIONS[i], 1, TABLEAU[m.b]); }
    assert.ok(s, 'illegal move ' + JSON.stringify(m));
    s = settle(s);
  }
  for (let guard = 0; guard < 3000 && !won(s); guard++) {
    const counts = foundCounts(s);
    const i = s.tab.findIndex(t => t.up.length && fits(top(t.up), counts));
    if (i >= 0) s = move(s, TABLEAU[i], 1, foundationFor(s, top(s.tab[i].up)));
    else if (s.waste.length && fits(top(s.waste), counts)) s = move(s, 'waste', 1, foundationFor(s, top(s.waste)));
    else s = draw(s);
    s = settle(s);
  }
  return won(s);
}

for (const drawCount of [1, 3]) {
  test(`the solver's wins are real wins, with cards going up by themselves or not (draw ${drawCount})`, () => {
    let wins = 0;
    for (let n = 1; n <= 40; n++) {
      const s = deal(n, drawCount);
      const r = solve(forSolver(s), 100000);
      if (r.result !== 'won') continue;
      wins++;
      assert.ok(replay(s, r.path), `deal ${n} did not finish`);
      assert.ok(replayAuto(s, r.path), `deal ${n} did not finish with cards going up by themselves`);
    }
    assert.ok(wins >= 20, `only ${wins} of 40 deals solved`);
  });
}

test('drawing three, a deal that cards going up by themselves would make unwinnable is not dealt', () => {
  // Deal 20: aces and twos that turn up on the waste go up by themselves, which changes which cards later draws turn
  // over, and no way through is left: a search of every table the page can reach with the setting on finds none.
  // Left on the waste for a tap, they leave one.
  const s = deal(20, 3);
  assert.notEqual(solve(forSolver(s), 100000).result, 'won');
  assert.equal(solve(forSolver(s, false), 100000).result, 'won');
});

test('drawing three with cards going up by themselves off, Hint lets a card wait on the waste', async () => {
  // Deal 37024 after 33 hints with the setting off. The ace of spades on the waste would go up by itself with it on,
  // and Hint used to send it up as if it would, which leaves no way through. Drawing past it, for the 8 of hearts, wins.
  const s = {
    v: 'k3', deal: 37024, draw: 3, stock: [5, 47, 20, 11, 50], waste: [12, 44, 17, 46, 45, 28, 21, 16, 42, 27, 4, 33, 18, 0], fan: 3,
    found: [[39, 40], [26], [13, 14], []], moves: 33,
    tab: [[[], [7, 19, 31, 43, 3]], [[], [38]], [[], [51, 37, 23, 9]], [[49], [10, 22, 34]], [[29], [35]], [[24, 6, 41, 30, 32], [2]], [[8, 25, 1, 15], [36, 48]]]
      .map(([down, up]) => ({ down, up })),
  };
  assert.deepEqual(await hintFor(s, { auto: false }), { move: { stock: true, c: card(H, 8) } });
  const r = solve(forSolver(s, false), 300000);
  assert.equal(r.result, 'won');
  assert.ok(replay(s, r.path), 'and that way through really wins');
});

// Cards from names like 'TS' (ten of spades), bottom to top.
const cards = names => names.split(' ').filter(Boolean).map(x => card('SHCD'.indexOf(x.slice(-1)), 'A23456789TJQK'.indexOf(x.slice(0, -1)) + 1));
const upTo = (suit, n) => Array.from({ length: n }, (_, i) => card(suit, i + 1));
const column = (down, up) => ({ down: cards(down), up: cards(up) });

test('a game whose way through needs part of a run moved or a card taken back down is neither lost nor out of moves', async () => {
  // Deal 378865 after 71 moves: nothing is left in the stock, and none of the moves the solver tries first helps, but
  // moving part of a run does. It used to say there were no moves left, and Hint that there was no way to win.
  const s = {
    v: 'k1', deal: 378865, draw: 1, stock: [], waste: cards('JC QC'), fan: 1, moves: 71,
    found: [upTo(C, 7), upTo(D, 2), upTo(H, 2), []],
    tab: [column('', 'QD JS TH 9S 8H 7S 6D 5S 4H 3S'), column('', 'KD QS JD TC 9D 8C 7D 6S 5H'), column('', 'KS'), column('', 'KC'),
      column('3D 6H AS', '5D 4S 3H 2S'), column('4D QH', 'JH TS 9H 8S 7H'), column('KH', 'TD 9C 8D')],
  };
  assert.equal(outOfMoves(s), false);
  const h = await hintFor(s);
  assert.ok(h.move && !h.move.stock, `Hint said ${JSON.stringify(h)}`);
  assert.ok(move(s, h.move.from, h.move.n, h.move.to), 'and the move is one the table allows');
  const all = new Search(forSolver(s), { every: true });
  assert.equal(all.run(5000), 'won');
  assert.ok(replay(s, all.path), 'and that way through really wins');

  // Deal 546070 drawing three, all face up with four empty columns: the way through takes the 10 of spades and the
  // 9 of hearts back down from the foundations.
  const t = {
    v: 'k3', deal: 546070, draw: 3, stock: cards('5C TD KC QH 7C JS'), waste: [], fan: 0, moves: 600,
    found: [upTo(H, 9), upTo(S, 10), upTo(D, 6), upTo(C, 4)],
    tab: [column('', 'KS QD JC TH 9C 8D'), column('', ''), column('', ''), column('', 'KH QC JD'), column('', ''), column('', ''), column('', 'KD QS JH TC 9D 8C 7D 6C')],
  };
  const g = await hintFor(t);
  assert.ok(g.move, `Hint said ${JSON.stringify(g)}`);
});

test('a hint for a card deeper in the stock says to draw, and for which card', () => {
  const s = draw(deal(3, 1));
  const p = forSolver(s);
  assert.deepEqual(fromSolver(s, { k: 3, j: p.pos, b: 0 }), { stock: true, c: p.talon[p.pos] });
  assert.equal(fromSolver(s, { k: 2, j: p.pos - 1 }).from, 'waste');
});

test('with every card face up, Hint draws for the first card that will fit when it turns up', () => {
  // Clubs are up to the 5 and diamonds to the 9. The 6 of clubs is on top of the stock, the 10 of diamonds at the bottom.
  const s = empty(1);
  s.found = [upTo(S, 13), upTo(H, 13), upTo(C, 5), upTo(D, 9)];
  s.stock = cards('TD 9C 8C JD 6C');
  s.tab = ['KC', 'QC', 'JC', 'TC', '7C', 'QD', 'KD'].map(c => column('', c));
  assert.deepEqual(easyHint(s), { stock: true, c: card(C, 6) });
  // Drawing three, the 6 of clubs turns over under the jack of diamonds and the 8 of clubs, and the 10 of diamonds
  // is the first that shows.
  assert.deepEqual(easyHint({ ...s, draw: 3 }), { stock: true, c: card(D, 10) });
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
