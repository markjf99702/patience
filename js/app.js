// Patience: the game, the buttons, the record and the settings.

import { deal, move, draw, bestTarget, autoStep, won, finishable, finishStep } from './klondike.js';
import { Table } from './table.js';
import { Dealer, hintFor, outOfMoves, randomDeal } from './deals.js';
import { cascade } from './win.js';
import { suitSprite } from './suits.js';

const KEY = 'patience.v1';
const $ = id => document.getElementById(id);
const DEFAULTS = { draw: 1, winnable: true, auto: true, clock: true, four: false, left: false };
const blank = () => ({ played: 0, won: 0, streak: 0, best: 0, fastest: 0 });
const DEAL_TIME = 28 * 26 + 420; // how long dealing the columns takes, in ms

const saved = read();
const settings = { ...DEFAULTS, ...saved.settings };
const stats = { 1: { ...blank(), ...saved.stats?.[1] }, 3: { ...blank(), ...saved.stats?.[3] } };

let game = null;      // where the cards are now
let history = [];     // where they were before each move, for Undo
let elapsed = 0;      // time spent on this game, not counting time away
let since = 0;        // when the clock last started, or 0 while it's stopped
let counted = false;  // whether this game has been counted as played (it is from the first move)
let chain = 0;        // the timer for the next card going up by itself
let thinking = false; // the Hint button is searching
let stopBounce = null;

document.body.prepend(suitSprite());
const table = new Table($('table'), {
  draw: () => act(draw(game)),
  tap: (pile, n) => {
    if (pile[0] === 'f') return;
    const to = bestTarget(game, pile, n);
    if (!to || !act(move(game, pile, n, to))) table.shake(pile, n);
  },
  move: (pile, n, to) => { if (!act(move(game, pile, n, to))) table.render(game); },
  touched: () => hideToast(),
});
const dealer = new Dealer(saved.next || {}, () => write());

// ---- playing ----

// Make a move the player asked for. Returns false if there was nothing to do.
function act(next) {
  if (!next || table.locked) return false;
  cancelChain();
  table.clearHint();
  history.push(game);
  if (!counted) { counted = true; stats[next.draw].played++; }
  startClock();
  set(next);
  return true;
}

function set(next) {
  game = next;
  table.render(game);
  showInfo();
  write();
  after();
}

// After any move: finished? Ready to finish itself? Any cards to send up?
function after() {
  if (won(game)) { victory(); return; }
  if (finishable(game)) { finish(); return; }
  if (settings.auto) {
    const step = autoStep(game);
    if (step) {
      chain = setTimeout(() => {
        chain = 0;
        const next = move(game, step.from, step.n, step.to);
        next.moves = game.moves; // these aren't the player's moves
        set(next);
      }, 140);
      return;
    }
  }
  if (counted && outOfMoves(game)) {
    toast('There are no moves left.', [['Undo', undo], ['New game', openNew]]);
  }
}

function cancelChain() { clearTimeout(chain); chain = 0; }

// Every card is face up: put them all away, lowest first.
function finish() {
  table.locked = true;
  const step = () => {
    const s = finishStep(game);
    if (!s) { table.locked = false; return; }
    const next = move(game, s.from, s.n, s.to);
    next.moves = game.moves;
    game = next;
    table.render(game);
    if (won(game)) { chain = setTimeout(victory, 320); return; }
    chain = setTimeout(step, 80);
  };
  chain = setTimeout(step, 260);
}

function undo() {
  if (!history.length || table.locked) return;
  cancelChain();
  hideToast();
  game = history.pop();
  table.render(game);
  showInfo();
  write();
}

async function newGame(drawCount, number) {
  closeSheets();
  hideToast();
  cancelChain();
  if (game && counted && !won(game)) stats[game.draw].streak = 0; // leaving a game part way counts as a loss
  settings.draw = drawCount;
  table.locked = true;
  const slow = setTimeout(() => { $('status').textContent = 'Shuffling for a deal that can be won…'; }, 250);
  const n = number ?? (settings.winnable ? await dealer.take(drawCount) : randomDeal());
  clearTimeout(slow);
  game = deal(n, drawCount);
  history = [];
  elapsed = 0;
  since = 0;
  counted = false;
  table.render(game, { deal: true });
  showInfo();
  write();
  setTimeout(() => { table.locked = false; after(); }, DEAL_TIME);
}

function restart() {
  closeSheets();
  if (!game || !game.moves) return;
  cancelChain();
  hideToast();
  game = deal(game.deal, game.draw);
  history = [];
  elapsed = 0;
  since = 0;
  table.locked = true;
  table.render(game, { deal: true });
  showInfo();
  write();
  setTimeout(() => { table.locked = false; after(); }, DEAL_TIME);
}

async function hint() {
  if (thinking || table.locked || !game) return;
  const at = game;
  thinking = true;
  $('b-hint').classList.add('busy');
  const h = await hintFor(game);
  thinking = false;
  $('b-hint').classList.remove('busy');
  if (game !== at) return; // they moved on while it was thinking
  if (h.move) table.showHint(h.move);
  else if (h.lost) toast('Looks like there’s no way to win from here. Undo a few moves to try another way.', [['Undo', undo]]);
  else toast('There are no moves left.', [['New game', openNew]]);
}

// ---- winning ----

function victory() {
  table.locked = true;
  stopClock();
  const st = stats[game.draw];
  if (!counted) st.played++;
  st.won++;
  st.streak++;
  st.best = Math.max(st.best, st.streak);
  st.fastest = st.fastest ? Math.min(st.fastest, elapsed) : elapsed;
  counted = false;
  write();

  $('won-line').textContent = `Deal ${game.deal.toLocaleString('en-US')}, ${game.draw === 1 ? 'drawing one' : 'drawing three'}, in ${clock(elapsed)} and ${plural(game.moves, 'move')}.`;
  $('won-stats').innerHTML = tiles([
    ['Won', `${st.won} of ${st.played}`],
    ['Streak', st.streak],
    ['Fastest', clock(st.fastest)],
  ]);
  const overlay = $('won'), panel = overlay.querySelector('.panel');
  overlay.hidden = false;
  panel.hidden = true;
  const showPanel = () => { panel.hidden = false; $('b-again').focus({ preventScroll: true }); };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showPanel();
  } else {
    table.unbury();
    const order = [];
    for (let r = 13; r >= 1; r--) for (const f of game.found) order.push(f[r - 1]);
    stopBounce = cascade($('bounce'), order, c => table.rectOf(c), c => table.hide(c, true));
    const timer = setTimeout(showPanel, 3500);
    overlay.addEventListener('pointerdown', () => { clearTimeout(timer); showPanel(); }, { once: true });
  }
}

$('b-again').addEventListener('click', () => {
  stopBounce?.();
  stopBounce = null;
  const canvas = $('bounce');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  $('won').hidden = true;
  for (let c = 0; c < 52; c++) table.hide(c, false);
  newGame(game.draw);
});

// ---- the clock, the counts and the record ----

function startClock() { if (!since && !document.hidden) since = performance.now(); }
function stopClock() { if (since) { elapsed += performance.now() - since; since = 0; } }
const played = () => elapsed + (since ? performance.now() - since : 0);

function clock(ms) {
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function showInfo() {
  if (!game) return;
  $('status').textContent = `${game.draw === 1 ? 'Draw one' : 'Draw three'} · Deal ${game.deal.toLocaleString('en-US')}`;
  $('moves').textContent = plural(game.moves, 'move');
  $('time').textContent = clock(played());
  $('b-undo').disabled = !history.length;
}
setInterval(() => { if (game && since) $('time').textContent = clock(played()); }, 1000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopClock(); write(); }
  else if (counted && game && !won(game)) startClock();
});
window.addEventListener('pagehide', () => { stopClock(); write(); });

function tiles(list) {
  return list.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function showStats(drawCount) {
  const st = stats[drawCount];
  document.querySelectorAll('[data-stats]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.stats === drawCount)));
  $('stats').innerHTML = tiles([
    ['Played', st.played],
    ['Won', st.won],
    ['Win rate', st.played ? `${Math.round((100 * st.won) / st.played)}%` : '–'],
    ['Streak', st.streak],
    ['Best streak', st.best],
    ['Fastest', st.fastest ? clock(st.fastest) : '–'],
  ]);
}

// ---- saving ----

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function write() {
  const g = game && !won(game) ? { state: game, history: history.slice(-500), elapsed: played(), counted } : null;
  try { localStorage.setItem(KEY, JSON.stringify({ settings, stats, next: dealer?.ready, game: g })); } catch { /* storage full or blocked */ }
}

// ---- settings ----

const toggles = { winnable: 'o-winnable', auto: 'o-auto', clock: 'o-clock', four: 'o-four', left: 'o-left' };
for (const [k, id] of Object.entries(toggles)) {
  $(id).addEventListener('change', e => {
    settings[k] = e.target.checked;
    apply();
    write();
    if (k === 'auto' && settings.auto && game && !table.locked) after();
    if (k === 'winnable' && settings.winnable) { dealer.prepare(1); dealer.prepare(3); }
  });
}

function apply() {
  for (const [k, id] of Object.entries(toggles)) $(id).checked = settings[k];
  document.documentElement.toggleAttribute('data-four', settings.four);
  $('clock').hidden = !settings.clock;
  if (table.left !== settings.left) {
    table.left = settings.left;
    if (game) { table.layout(); table.render(game, { still: true }); }
  }
}

// ---- buttons, sheets and messages ----

$('b-new').addEventListener('click', openNew);
$('b-undo').addEventListener('click', undo);
$('b-hint').addEventListener('click', hint);
$('b-menu').addEventListener('click', () => { showStats(game?.draw || settings.draw); openSheet('sheet-menu'); });
$('b-restart').addEventListener('click', restart);
document.querySelectorAll('[data-draw]').forEach(b => b.addEventListener('click', () => newGame(+b.dataset.draw)));
document.querySelectorAll('[data-stats]').forEach(b => b.addEventListener('click', () => showStats(+b.dataset.stats)));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheets));

function openNew() {
  hideToast();
  $('new-note').hidden = !(counted && game && !won(game));
  $('b-restart').hidden = !game || !game.moves;
  document.querySelectorAll('[data-draw]').forEach(b => b.classList.toggle('current', +b.dataset.draw === (game?.draw || settings.draw)));
  openSheet('sheet-new');
}

let opener = null;
function openSheet(id) {
  closeSheets();
  opener = document.activeElement;
  $(id).hidden = false;
  $(id).querySelector('.choice, .close, button')?.focus({ preventScroll: true });
}
function closeSheets() {
  const open = document.querySelectorAll('.sheet:not([hidden])');
  open.forEach(s => { s.hidden = true; });
  if (open.length && opener?.focus) opener.focus({ preventScroll: true });
  opener = null;
}

let toastTimer = 0;
function toast(text, actions = []) {
  const t = $('toast');
  t.textContent = text;
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => { hideToast(); fn(); });
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actions.length ? 9000 : 4000);
}
function hideToast() { $('toast').hidden = true; clearTimeout(toastTimer); }

document.addEventListener('keydown', e => {
  if (!$('sheet-new').hidden || !$('sheet-menu').hidden) { if (e.key === 'Escape') closeSheets(); return; }
  if (!$('won').hidden || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (e.ctrlKey || e.metaKey) return;
  else if (k === ' ' || k === 'd') { e.preventDefault(); act(draw(game)); }
  else if (k === 'h') hint();
  else if (k === 'n') openNew();
});

// ---- offline ----

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---- starting up: carry on with the saved game, or deal a new one ----

apply();
if (saved.game?.state && !won(saved.game.state)) {
  game = saved.game.state;
  history = saved.game.history || [];
  elapsed = saved.game.elapsed || 0;
  counted = !!saved.game.counted;
  table.render(game, { still: true });
  showInfo();
  after();
} else {
  newGame(settings.draw);
}
if (settings.winnable) setTimeout(() => { dealer.prepare(1); dealer.prepare(3); }, 4000);

// For the tests and the screenshot tool.
window.patience = {
  get state() { return game; },
  get busy() { return table.locked || !!chain; },
  load(state, ms = 0) { cancelChain(); game = state; history = []; elapsed = ms; since = 0; table.locked = false; table.render(game, { still: true }); showInfo(); after(); },
  newGame,
  settings,
  stats,
};
