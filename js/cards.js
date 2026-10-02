// A card is a number from 0 to 51: suit * 13 + (rank - 1).
// Suits in order: spades, hearts, clubs, diamonds, so the red ones are the odd suits.
// Spider plays with two decks, so its cards also carry which copy they are: copy * 52 + the card,
// which keeps every card on the table distinct while it plays the same as any other of its kind.

export const SUITS = ['s', 'h', 'c', 'd'];
export const SUIT_NAMES = ['spades', 'hearts', 'clubs', 'diamonds'];
export const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const RANK_NAMES = ['', 'ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king'];

export const suitOf = c => ((c % 52) / 13) | 0;
export const rankOf = c => (c % 13) + 1;
export const isRed = c => (suitOf(c) & 1) === 1;
export const card = (suit, rank) => suit * 13 + rank - 1;
export const cardName = c => `${RANK_NAMES[rankOf(c)]} of ${SUIT_NAMES[suitOf(c)]}`;

// Can `c` go on top of `under` in the tableau? One lower, other colour.
export const stacks = (c, under) => rankOf(under) === rankOf(c) + 1 && isRed(under) !== isRed(c);

// `found` holds how many cards of each suit are on the foundations.
// A card can go up when it's the next one of its suit.
export const fits = (c, found) => found[suitOf(c)] === rankOf(c) - 1;

// Is it safe to send this card up for good? It is once nothing in the tableau could still need it:
// its only use there is to hold a lower card of the other colour, and both of those are already up.
export function safeUp(c, found) {
  if (!fits(c, found)) return false;
  const r = rankOf(c);
  if (r <= 2) return true;
  const other = isRed(c) ? [0, 2] : [1, 3];
  return found[other[0]] >= r - 1 && found[other[1]] >= r - 1;
}
