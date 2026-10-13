// FreeCell and Spider rules and solvers, checked in Node:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { card, suitOf, rankOf } from '../js/cards.js';
import { freecell, room } from '../js/games/freecell.js';
import { spider } from '../js/games/spider.js';
import { VARIANTS } from '../js/games/index.js';
import { FOUR_SUIT_DEALS } from '../js/games/spider-deals.js';
import { hintFor } from '../js/deals.js';

const S = 0, H = 1, C = 2, D = 3;
const name = c => 'A23456789TJQK'[rankOf(c) - 1] + 'SHCD'[suitOf(c)];
const emptyFC = () => ({ v: 'fc', deal: 0, tab: Array.from({ length: 8 }, () => []), cells: [null, null, null, null], found: [[], [], [], []], moves: 0 });

// ---- FreeCell ----

test('FreeCell deals match the numbered deals from Windows', () => {
  const first = s => s.tab.map(t => name(t[0])).join(' ');
  assert.equal(first(freecell.deal(1)), 'JD 2D 9H JC 5D 7H 7C 5H');
  assert.equal(first(freecell.deal(617)), '7D AD 5C 3S 5S 8C 2D AH');
  const s = freecell.deal(617);
  assert.deepEqual(s.tab.map(t => t.length), [7, 7, 7, 7, 6, 6, 6, 6]);
  assert.equal(new Set(s.tab.flat()).size, 52);
});

test('FreeCell runs move only as far as free cells and empty columns allow', () => {
  const s = emptyFC();
  s.tab[0] = [card(S, 9), card(H, 8), card(C, 7), card(D, 6), card(S, 5)];
  s.tab[1] = [card(D, 10)];
  s.tab[2] = [card(C, 13)]; s.tab[3] = [card(D, 13)]; s.tab[4] = [card(H, 13)]; s.tab[5] = [card(S, 13)]; s.tab[6] = [card(C, 12)]; s.tab[7] = [card(D, 12)];
  s.cells = [card(H, 2), card(H, 3), null, null];
  assert.equal(room(s, false), 3);
  assert.equal(freecell.move(s, 't0', 5, 't1'), null, 'five cards need more room than two free cells give');
  s.cells = [null, null, null, null];
  assert.equal(room(s, false), 5);
  const next = freecell.move(s, 't0', 5, 't1');
  assert.deepEqual(next.tab[1].map(name), ['TD', '9S', '8H', '7C', '6D', '5S']);
  assert.deepEqual(next.tab[0], []);
});

test('a FreeCell tap sends a card up, then onto a column, then into a free cell', () => {
  const s = emptyFC();
  s.tab[0] = [card(D, 9), card(S, 1)];
  s.tab[1] = [card(C, 10)];
  s.tab[2] = [card(H, 4)];
  for (let i = 3; i < 8; i++) s.tab[i] = [card(i % 4, 13)];
  assert.equal(freecell.tapTarget(s, 't0', 1), 'f0');
  const up = freecell.move(s, 't0', 1, 'f0');
  assert.equal(freecell.tapTarget(up, 't0', 1), 't1', '9 of diamonds onto the 10 of clubs');
  assert.equal(freecell.tapTarget(up, 't2', 1), 'c0', 'nowhere else for the 4 of hearts');
  assert.equal(freecell.lift(up, 'f0', 0), null, 'cards on the foundations stay up');
});

test("FreeCell's solver wins are real wins, and deal 11982 can't be won", () => {
  let wins = 0;
  for (let n = 1; n <= 15; n++) {
    let s = freecell.deal(n);
    const search = freecell.search(s);
    if (search.run(100000) !== 'won') continue;
    wins++;
    for (const m of search.path) {
      const ui = freecell.fromSolver(s, m);
      s = freecell.move(s, ui.from, ui.n, ui.to);
      assert.ok(s, `deal ${n}: illegal ${JSON.stringify(m)}`);
    }
    for (let guard = 0; guard < 60 && !freecell.won(s); guard++) {
      const m = freecell.finishStep(s);
      assert.ok(m, `deal ${n}: stuck finishing`);
      s = freecell.move(s, m.from, m.n, m.to);
    }
    assert.ok(freecell.won(s), `deal ${n} did not finish`);
  }
  assert.ok(wins >= 14, `only ${wins} of 15 deals solved`);
  assert.equal(freecell.search(freecell.deal(11982)).run(300000), 'lost');
});

// ---- Spider ----

test('Spider deals 104 cards: 54 on the table, 50 to come, in the suits asked for', () => {
  for (const [v, suits] of [['s1', 1], ['s2', 2], ['s4', 4]]) {
    const s = spider.deal(7, v);
    const all = [...s.stock, ...s.tab.flatMap(t => [...t.down, ...t.up])];
    assert.equal(new Set(all).size, 104, v);
    assert.equal(new Set(all.map(suitOf)).size, suits, v);
    assert.deepEqual(s.tab.map(t => t.down.length + t.up.length), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    assert.ok(s.tab.every(t => t.up.length === 1));
    assert.equal(s.stock.length, 50);
  }
});

const emptySp = () => ({ v: 's2', deal: 0, tab: Array.from({ length: 10 }, () => ({ down: [], up: [] })), stock: [], sets: [], moves: 0 });

test('in Spider only a run of one suit moves together, onto any card one higher', () => {
  const s = emptySp();
  s.tab[0].up = [card(S, 9), card(S, 8), card(H, 7)];
  s.tab[1].up = [card(H, 9)];
  s.tab[2].up = [card(S, 8)];
  assert.equal(spider.lift(s, 't0', 0), null, 'a mixed run stays put');
  assert.deepEqual(spider.lift(s, 't0', 2), [card(H, 7)]);
  assert.ok(spider.canDrop(s, [card(H, 7)], 't2'), 'any suit one higher');
  assert.equal(spider.tapTarget(s, 't0', 1), 't2');
  s.tab[3].up = [card(H, 8)];
  assert.equal(spider.tapTarget(s, 't0', 1), 't3', 'its own suit first');
});

test('a finished run of one suit clears away and turns over the card under it', () => {
  const s = emptySp();
  s.tab[0] = { down: [card(H, 5)], up: Array.from({ length: 12 }, (_, i) => card(S, 13 - i)) }; // king to 2
  s.tab[1].up = [card(S, 1)];
  const next = spider.move(s, 't1', 1, 't0');
  assert.equal(next.sets.length, 1);
  assert.equal(rankOf(next.sets[0][12]), 13, 'the king on top of the cleared pile');
  assert.deepEqual(next.tab[0], { down: [], up: [card(H, 5)] });
});

test("Spider won't deal a row while a column is empty", () => {
  const s = spider.deal(3, 's1');
  const blocked = { ...s, tab: s.tab.map((t, i) => (i === 4 ? { down: [], up: [] } : t)) };
  assert.equal(spider.stock(blocked), null);
  assert.match(spider.stockNote(blocked), /empty column/);
  const next = spider.stock(s);
  assert.equal(next.stock.length, 40);
  assert.ok(next.tab.every((t, i) => t.up.length === s.tab[i].up.length + 1));
});

for (const [v, n, count] of [['s1', 8, 7], ['s2', 4, 3]]) {
  test(`Spider's solver wins are real wins (${VARIANTS[v].detail})`, () => {
    let wins = 0;
    for (let d = 1; d <= n; d++) {
      let s = spider.deal(d, v);
      const search = spider.search(s);
      if (search.run(120000) !== 'won') continue;
      wins++;
      for (const m of search.path) {
        const ui = spider.fromSolver(s, m);
        s = ui.stock ? spider.stock(s) : spider.move(s, ui.from, ui.n, ui.to);
        assert.ok(s, `deal ${d}: illegal ${JSON.stringify(m)}`);
      }
      assert.ok(spider.won(s), `deal ${d} did not finish`);
    }
    assert.ok(wins >= count, `only ${wins} of ${n} deals solved`);
  });
}

// A Spider position with nothing left to deal, built from ranks. One suit plays spades, two suits spades and hearts;
// each card is the next copy of it not used yet (see cards.js). `cleared` is how many runs of each suit are gone.
function spiderEnd(v, cleared, cols) {
  const used = {};
  const next = (suit, rank) => { const k = suit * 13 + rank - 1; used[k] = (used[k] || 0) + 1; return (used[k] - 1) * 52 + k; };
  const sets = cleared.flatMap((n, suit) => Array.from({ length: n }, () => Array.from({ length: 13 }, (_, r) => next(suit, r + 1))));
  const tab = cols.map(([down, up]) => ({ down: down.map(([s, r]) => next(s, r)), up: up.map(([s, r]) => next(s, r)) }));
  const all = [...sets.flat(), ...tab.flatMap(t => [...t.down, ...t.up])];
  assert.equal(new Set(all).size, 104, 'every card once');
  assert.ok(all.every(c => spider.cardIds({ v }).includes(c)), 'only cards from this deck');
  return { v, deal: 0, tab, stock: [], sets, moves: 100 };
}
const sp = r => [S, r], ht = r => [H, r];

test('a Spider game that needs part of a run moved is neither lost nor out of moves', async () => {
  // K to 9 in the first column, 10 to A in the second: moving 8 to A onto the 9 clears a run, and the rest can be won.
  const tops = [13, 13, 10, 6, 6, 4, 4, 2], downs = [12, 12, 11, 11, 9, 8, 8, 7, 7, 5, 5, 3, 3, 2, 1, 1];
  const s = spiderEnd('s1', [5], [
    [[], [13, 12, 11, 10, 9].map(sp)],
    [[], [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(sp)],
    ...tops.map((r, i) => [[sp(downs[2 * i]), sp(downs[2 * i + 1])], [sp(r)]]),
  ]);
  assert.equal(spider.outOfMoves(s), false);
  const h = await hintFor(s);
  assert.ok(h.move && !h.move.stock, `hint said ${JSON.stringify(h)}`);
  let t = spider.move(s, h.move.from, h.move.n, h.move.to);
  assert.ok(t, 'the hint is a move the table allows');
  const search = spider.searchAll(t);
  assert.equal(search.run(100000), 'won', 'and it still leads to a win');
  for (const m of search.path) {
    const ui = spider.fromSolver(t, m);
    t = ui.stock ? spider.stock(t) : spider.move(t, ui.from, ui.n, ui.to);
    assert.ok(t, `illegal ${JSON.stringify(m)}`);
  }
  assert.ok(spider.won(t));
});

test('Spider is out of moves when cards can only go back and forth, and Hint says it can’t be won', async () => {
  // The 7 can go from one 8 to the other and back, and nothing else can move.
  const s = spiderEnd('s1', [5], [
    [[sp(2), sp(2)], [sp(8), sp(7)]],
    [[sp(2), sp(4)], [sp(8)]],
    [[sp(4), sp(4), sp(6)], [sp(13)]],
    [[sp(6), sp(6), sp(9)], [sp(13)]],
    [[sp(9), sp(9), sp(10)], [sp(13)]],
    [[sp(10), sp(10), sp(12)], [sp(11)]],
    [[sp(12), sp(12), sp(1)], [sp(11)]],
    [[sp(1), sp(3), sp(3)], [sp(5)]],
    [[sp(5), sp(7), sp(11)], [sp(3)]],
    [[sp(7), sp(8), sp(5)], [sp(1)]],
  ]);
  assert.ok(spider.move(s, 't0', 1, 't1'), 'the 7 can move');
  assert.equal(spider.outOfMoves(s), true);
  assert.deepEqual(await hintFor(s), { lost: true });
});

test('a Spider run moved onto a card of the other suit counts when it uncovers cards that can go somewhere', () => {
  // The spade 7 can only go onto the other heart 8; then hearts 10 to 8 go onto the jack and turn a card over.
  const s = spiderEnd('s2', [3, 2], [
    [[sp(2)], [ht(10), ht(9), ht(8), sp(7)]],
    [[sp(4), sp(5), sp(6)], [ht(8)]],
    [[sp(8), sp(9), sp(10)], [sp(11)]],
    [[sp(12), ht(1), ht(2)], [sp(13)]],
    [[ht(2), ht(3), ht(3)], [ht(13)]],
    [[ht(4), ht(4), ht(5)], [ht(13)]],
    [[ht(6), ht(6), ht(7)], [ht(1)]],
    [[ht(7), ht(9), ht(10)], [sp(1)]],
    [[ht(11), ht(11)], [ht(5)]],
    [[ht(12), ht(12)], [sp(3)]],
  ]);
  assert.equal(spider.outOfMoves(s), false);
  const t = spider.move(spider.move(s, 't0', 1, 't1'), 't0', 3, 't2');
  assert.deepEqual([t.tab[0].down.length, t.tab[0].up.map(name)], [0, ['2S']], 'the card underneath turned over');
});

test('the four-suit deals checked in advance really are won by the solver', () => {
  assert.ok(FOUR_SUIT_DEALS.length >= 100);
  for (const n of FOUR_SUIT_DEALS.slice(0, 3)) assert.equal(spider.search(spider.deal(n, 's4')).run(150000), 'won', `deal ${n}`);
});
