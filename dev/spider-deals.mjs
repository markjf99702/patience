// Finds four-suit Spider deals the solver can win, for js/games/spider-deals.js:  node dev/spider-deals.mjs [how many]
// The game finds its own as you play; these are so the first four-suit game doesn't have to wait.
import { writeFile } from 'node:fs/promises';
import { spider } from '../js/games/spider.js';

const WANT = +(process.argv[2] || 120), MAX = 150000, found = [];
for (let n = 1; found.length < WANT; n++) {
  const s = spider.search(spider.deal(n, 's4'));
  if (s.run(MAX) === 'won') { found.push(n); process.stdout.write(`${found.length}:${n} `); }
}
await writeFile(new URL('../js/games/spider-deals.js', import.meta.url),
  `// Four-suit Spider deals the solver has won, found by dev/spider-deals.mjs.\n// A new four-suit game takes one of these when no freshly checked deal is ready yet.\nexport const FOUR_SUIT_DEALS = [\n${found.map(n => n).join(', ').replace(/(.{1,100})(, |$)/g, '  $1,\n')}];\n`);
console.log('\nwrote', found.length);
