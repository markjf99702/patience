# Patience

**Play it: [patience.junkdrawer.works](https://patience.junkdrawer.works/)**

**Klondike, FreeCell and Spider solitaire with no ads, no account and nothing to wait for.** Tap a card to send it where it fits or drag it there yourself, and undo as far back as you like. Every deal has been played through before it reaches you, so there's always a way to win, and the Hint button knows it.

<p align="center">
  <img src="docs/phone-klondike.png" alt="Klondike, drawing one, part way through deal 52,817: three foundations started, the 6 of diamonds on the waste, and the hint lighting up the deck to say draw a card" width="250">
  &nbsp;
  <img src="docs/phone-freecell.png" alt="FreeCell game 617 after 40 moves: all four free cells full with the king of spades, 7 of clubs, 4 of hearts and 3 of diamonds, three foundations started, and the eight columns below" width="250">
  &nbsp;
  <img src="docs/phone-spider.png" alt="Spider with two suits, deal 5, after 70 moves: ten columns with long runs of spades and hearts, and two rows left to deal in the corner" width="250">
</p>
<p align="center">
  <img src="docs/phone-new.png" alt="The New game sheet: Klondike drawing one or three, FreeCell, and Spider with one, two or four suits, each with a line about how it plays" width="250">
  &nbsp;
  <img src="docs/phone-won.png" alt="A won Klondike game: the cards bouncing off the foundations and leaving trails across the table, behind a panel saying You won, deal 52,817, in 4:41 and 161 moves, 18 won of 25" width="250">
</p>

## How it plays

- **Klondike, the one that came with Windows.** Build the four foundations from ace to king, one suit each. In the seven columns, cards go down in alternating colours, and only a king can go in an empty column. Draw one card at a time or three, and go through the stock as many times as you like.
- **FreeCell.** All 52 cards face up from the start, four free cells to hold a card each, and any card can go in an empty column. A run moves as one when there'd be room to move it a card at a time. The deals are numbered the way the FreeCell that came with Windows numbered them, so game 617 here is game 617 there.
- **Spider, with one, two or four suits.** Two decks in ten columns. Build down in any suit, but only a run of one suit moves together, and a run from king to ace of one suit clears away. Tap the deck to deal a row, once every column has a card. Clear all eight runs to win.
- **Tap or drag.** A tap sends cards to the best place: up to a foundation if they can go, otherwise onto a column (in FreeCell, a free cell if nothing else fits; in Spider, a card of the same suit first). Drag a card, or a run, anywhere the rules allow; drop it somewhere it doesn't fit and it slides back.
- **Undo all the way back,** even after closing the page and coming back to it.
- **Deals that can be won.** Before a deal reaches you, a solver plays it through, seeing every face-down card, and any deal it can't win in time is shuffled away. Four-suit Spider is slow to check, so the first one comes from a list of deals already checked while the next is found in the background. Turn this off in the menu if you'd rather take your chances.
- **A hint that knows the way.** Hint asks the same solver for the next move from where you are, and while you do what it says, it keeps to the way it found. When it's drawing for a card further down the deck, it says which one. If an earlier move has left no way to win, it says so, and Undo takes you back to try another.
- **Cards go up by themselves** in Klondike and FreeCell once nothing on the table could still need them, and when the rest is in order the game finishes itself. You can switch the first part off.
- **The bouncing cards** when you win, as tradition requires.
- **Your record** for each of the six ways of playing: games played, won, win rate, streak, best streak and fastest win.
- **Settings:** four-colour suits (clubs green, diamonds blue), the deck on the left instead of under your right thumb, and hiding the time and moves.
- **On a keyboard,** Space uses the deck, Z undoes, H gives a hint, Enter plays it and N starts a new game.
- No ads, no account and no server. Your game, your record and your settings stay in your browser. It works offline and installs to a phone's home screen.

## Running it

It's a static site: plain HTML, CSS and JavaScript, with no build step.

```sh
npx serve .                       # or any static file server, then open the printed address
npm install                       # once, for the bundler and the screenshot tool's PNG compressor
npm test                          # the rules and the solvers in Node, then every game played in Chromium (needs Playwright)
node tools/screenshots.mjs        # redraws docs/*.png and og.png
node tools/make-icons.mjs         # redraws the PNG icons from icon.svg
npm run build                     # bundles everything into dist/patience.html, one file you can send around
node dev/solver-check.mjs 200 3   # solves 200 Klondike deals drawing three, and replays every win through the rules
node dev/freecell-check.mjs 100   # the same for FreeCell, checking every move by its own rules
node dev/spider-check.mjs s2 30   # the same for Spider with two suits (s1, s2 or s4)
node dev/spider-deals.mjs 120     # rewrites the list of four-suit Spider deals checked in advance
node dev/hint-check.mjs k3 50     # plays 50 deals doing just what Hint says, and lists any it doesn't win
```

To put it online with GitHub Pages: **Settings → Pages → Build and deployment → Deploy from a branch**, then pick `main` and `/ (root)`.

### Files

- `js/games/`: the rules of each game, all with the same parts so the rest of the app doesn't need to know which is being played (`index.js` lists them and what each part does). `spider-deals.js` is the list of four-suit Spider deals checked in advance.
- `js/solvers/klondike.js`: the Klondike solver. A depth-first search that sees the face-down cards, offers every card the stock can reach as a move of its own, and never looks at the same position twice. Drawing three, it allows for a card going up by itself from the waste, which changes what later draws turn over, so a deal it hands out can be won with that setting on or off. To be quick it leaves out moves that seldom help, like moving part of a run or taking a card back down, so before Hint says a game can't be won, or the game says there are no moves left, it looks again with every move. In the 100,000 positions it gets to check a deal before it reaches you, it wins about 79% of deals drawing one and 68% drawing three.
- `js/solvers/best-first.js`: a best-first search shared by the FreeCell and Spider solvers, which always looks next at the most promising position found so far.
- `js/solvers/freecell.js`: the FreeCell solver. It wins 99 of the first 100 Windows deals in about a tenth of a second each, and proves game 11982, the famous one, can't be won.
- `js/solvers/spider.js`: the Spider solver. In the 120,000 positions it gets to check a deal before it reaches you, it wins nearly every one-suit deal and nine in ten two-suit deals; four-suit deals are harder, about one in four. To be quick it leaves out moves that seldom help, like moving only part of a run, so before Hint says a game can't be won it looks again with every move.
- `js/deals.js`: runs a solver a slice at a time, between frames, to find winnable deals and hints.
- `js/table.js`: the table. Card sizes and layout for whichever game it is, the movement, tapping and dragging.
- `js/win.js`: the bouncing cards.
- `js/app.js`: the game itself: undo, the clock, the record, settings and saving.
- `js/cards.js`, `js/suits.js`, `js/rng.js`: the cards, the four suit shapes, the seeded shuffle that turns a deal number into a deal, and Windows' FreeCell shuffle.
- `fonts/`: Fraunces and Figtree (SIL Open Font License), served from here so nothing loads from elsewhere.
- `sw.js`: keeps a copy for playing offline. On a connection that isn't answering, a page opens from that copy after four seconds. `FILES` in it is a fingerprint of the files it keeps: change one and `npm test` says what to set it to, so a release never leaves the copy half old.
- `test/`: the rules and the solvers in Node, and every game played through the real page.
- `dev/`: tools used while building it: the solver and Hint checks, quick screenshots, and a helper that plays a deal part way.
