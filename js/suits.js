// The four suit shapes, drawn on a 100 x 100 grid. The page and the winning animation both draw from these.

export const SUIT_PATHS = {
  s: 'M50 4C62 22 95 38 95 62c0 14-10 24-22 24-9 0-16-5-19-11 1 9 5 17 13 21H33c8-4 12-12 13-21-3 6-10 11-19 11C15 86 5 76 5 62 5 38 38 22 50 4z',
  h: 'M50 90C22 68 5 52 5 31 5 16 16 6 29 6c10 0 17 6 21 14 4-8 11-14 21-14 13 0 24 10 24 25 0 21-17 37-45 59z',
  c: 'M50 6a21 21 0 0 1 17.5 32.6A21 21 0 1 1 55 72c1 10 5 17 12 24H33c7-7 11-14 12-24a21 21 0 1 1-12.5-33.4A21 21 0 0 1 50 6z',
  d: 'M50 3C61 20 74 36 90 50 74 64 61 80 50 97 39 80 26 64 10 50 26 36 39 20 50 3z',
};

// One <symbol> per suit, put on the page once and reused by every card.
export function suitSprite() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  for (const [k, d] of Object.entries(SUIT_PATHS)) {
    const sym = document.createElementNS(ns, 'symbol');
    sym.id = 'suit-' + k;
    sym.setAttribute('viewBox', '0 0 100 100');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    sym.append(p);
    svg.append(sym);
  }
  return svg;
}
