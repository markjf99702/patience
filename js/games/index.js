// The games Patience plays, and the ways to play each one.
//
// Every game is an object with the same parts, so the table and the rest of the app don't need to know which it is.
// States are plain objects that are never changed in place; each has `v` (the way of playing, a key below),
// `deal` (the deal number) and `moves`.
//
//   deal(n, v)              a new game: deal number n of way v
//   layout(s, left)         where the piles go: { cols, rows?, top: [{ id, col, kind, label?, dir? }], tableau: [ids], dealFrom }
//                           (rows: how many card heights a long column needs, for sizing the cards on a short screen)
//                           kinds: 'stock' and 'deals' (tap to draw or deal), 'waste', 'stack' (foundations, free cells),
//                           'sets' (Spider's cleared runs), and 'column' for the tableau
//   pile(s, id)             the cards in a pile: { down: [...], up: [...] }, bottom to top
//   fan(s)                  how many waste cards are spread out (Klondike drawing three)
//   cardIds(s)              every card in this game
//   lift(s, id, index)      the cards that come up when picking up card `index` of a pile's face-up cards, or null
//   targets(s)              the piles cards can be dropped on
//   canDrop(s, cards, to)   whether they can go there
//   move(s, from, n, to)    the new state, or null if the rules say no
//   stock(s)                the new state after tapping the stock, or null; stockNote(s) says why not, if it matters
//   tapTarget(s, from, n)   where a tap sends the top n cards of a pile, or null
//   autoStep(s)             a card that can go up by itself because nothing could need it, or null
//   won(s), finishable(s), finishStep(s)    finished; ready to finish by itself; the next card when it does
//   easyHint(s)             a hint for a position the solver calls as good as won
//   search(s)               a solver for this position (step(budget), result, path, firstMove())
//   fromSolver(s, m)        a solver move as a table move: { from, n, to }, or { stock: true }
//   outOfMoves(s)           nothing useful left to do
//   bounceOrder(s)          the cards in the order they bounce off the table when it's won
//   dealOrder(s)            the cards in the order they're dealt, for the dealing animation
//   randomDeal()            a deal number
//   budget                  how many positions the solver may look at: { deal, hint }

import { klondike } from './klondike.js';
import { freecell } from './freecell.js';
import { spider } from './spider.js';

export const VARIANTS = {
  k1: { game: klondike, name: 'Klondike', detail: 'draw one' },
  k3: { game: klondike, name: 'Klondike', detail: 'draw three' },
  fc: { game: freecell, name: 'FreeCell', detail: '' },
  s1: { game: spider, name: 'Spider', detail: 'one suit' },
  s2: { game: spider, name: 'Spider', detail: 'two suits' },
  s4: { game: spider, name: 'Spider', detail: 'four suits' },
};

export const gameOf = s => VARIANTS[s.v].game;
export const label = v => (VARIANTS[v].detail ? `${VARIANTS[v].name}, ${VARIANTS[v].detail}` : VARIANTS[v].name);
