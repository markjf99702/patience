// Seeded random numbers, so a deal number always gives the same deal.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The 52 cards in the order deal number `n` puts them.
export function shuffled(n) {
  return shuffle(Array.from({ length: 52 }, (_, i) => i), n * 2654435761 + 12345);
}

// Shuffle a deck in place with a seed, and return it.
export function shuffle(deck, seed) {
  const rand = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// FreeCell deal `n`, the way the FreeCell that came with Windows dealt it, so game 617 here is game 617 there.
// Its shuffle counts cards ace to king in clubs, diamonds, hearts, spades order.
// Returns the cards in the order they're dealt, one to each of the eight columns in turn.
export function freecellDeal(n) {
  let state = n;
  const rand = () => { state = (state * 214013 + 2531011) & 0x7fffffff; return state >> 16; };
  const cards = Array.from({ length: 52 }, (_, i) => 51 - i);
  for (let i = 0; i < 52; i++) {
    const j = 51 - (rand() % (52 - i));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  const SUIT = [2, 3, 1, 0]; // clubs, diamonds, hearts, spades, as numbered here
  return cards.map(m => SUIT[m & 3] * 13 + (m >> 2));
}
