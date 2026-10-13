// Patience: the game, the buttons, the record and the settings.

import { VARIANTS, gameOf, label } from './games/index.js';
import { Table } from './table.js';
import { Dealer, hintFor } from './deals.js';
import { cascade } from './win.js';
import { suitSprite } from './suits.js';

const KEY = 'patience.v1';
const $ = id => document.getElementById(id);
const DEFAULTS = { variant: 'k1', winnable: true, auto: true, clock: true, four: false, left: false };
const blank = () => ({ played: 0, won: 0, streak: 0, best: 0, fastest: 0 });
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

const saved = read();
// The first version only played Klondike, and kept the draw count where the way of playing now goes.
if (saved.settings && !saved.settings.variant && saved.settings.draw) saved.settings.variant = 'k' + saved.settings.draw;
if (saved.stats?.[1] || saved.stats?.[3]) { saved.stats.k1 ??= saved.stats[1]; saved.stats.k3 ??= saved.stats[3]; }
const upgrade = s => (s && !s.v && s.draw ? { ...s, v: 'k' + s.draw } : s);
if (saved.game) { saved.game.state = upgrade(saved.game.state); saved.game.history = (Array.isArray(saved.game.history) ? saved.game.history : []).filter(isObj).map(upgrade); }

const settings = { ...DEFAULTS, ...saved.settings };
delete settings.draw;
if (!Object.keys(VARIANTS).includes(settings.variant)) settings.variant = 'k1';
const record = r => Object.fromEntries(Object.entries(blank()).map(([k, zero]) => [k, Number.isFinite(r?.[k]) ? r[k] : zero]));
const stats = Object.fromEntries(Object.keys(VARIANTS).map(v => [v, record(saved.stats?.[v])]));
// The deal kept ready for each way of playing, by draw count in the first version.
const kept = { k1: saved.next?.[1], k3: saved.next?.[3], ...saved.next };
const ready = Object.fromEntries(Object.keys(VARIANTS).filter(v => Number.isInteger(kept[v]) && kept[v] > 0).map(v => [v, kept[v]]));

let game = null;      // where the cards are now
let history = [];     // where they were before each move, for Undo
let elapsed = 0;      // time spent on this game, not counting time away
let since = 0;        // when the clock last started, or 0 while it's stopped
let counted = false;  // whether this game has been counted as played (it is from the first move)
let chain = 0;        // the timer for the next card going up by itself
let dealing = 0;      // counts the deals asked for, so only the latest one is dealt
let slow = 0;         // the timer that says a deal is still being shuffled
let landed = 0;       // the timer that frees the table once a deal has landed
let thinking = false; // the Hint button is searching
let stopBounce = null;

const G = () => gameOf(game);

document.body.prepend(suitSprite());
const table = new Table($('table'), {
  stock: () => {
    if (act(G().stock(game))) return;
    const note = G().stockNote(game);
    if (note) toast(note);
  },
  tap: (pile, n) => {
    if (pile[0] === 'f') return;
    const to = G().tapTarget(game, pile, n);
    if (!to || !act(G().move(game, pile, n, to))) table.shake(pile, n);
  },
  move: (pile, n, to) => { if (!act(G().move(game, pile, n, to))) table.render(game); },
  touched: () => hideToast(),
});
const dealer = new Dealer(ready, () => write());

// ---- playing ----

// Make a move the player asked for. Returns false if there was nothing to do.
// A won game is finished: it can be looked at, but not played on or undone, so it can't be won twice.
function act(next) {
  if (!next || table.locked || G().won(game)) return false;
  cancelChain();
  table.clearHint();
  history.push(game);
  if (!counted) { counted = true; stats[next.v].played++; }
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
  cancelChain(); // only one thing comes next
  const g = G();
  if (g.won(game)) { chain = setTimeout(victory, 700); return; }
  if (g.finishable(game)) { finish(); return; }
  if (settings.auto) {
    const step = g.autoStep(game);
    if (step) {
      chain = setTimeout(() => {
        chain = 0;
        const next = G() === g && g.move(game, step.from, step.n, step.to);
        if (!next) return; // another game, or the card has gone
        next.moves = game.moves; // these aren't the player's moves
        set(next);
      }, 140);
      return;
    }
  }
  if (counted && g.outOfMoves(game, { auto: settings.auto })) {
    toast('There are no moves left.', [['Undo', undo], ['New game', openNew]]);
  }
}

function cancelChain() { clearTimeout(chain); chain = 0; }

// Every card is in order: put them all away, lowest first.
function finish() {
  table.locked = true;
  const g = G();
  const step = () => {
    const s = g.finishStep(game);
    if (!s) { table.locked = false; return; }
    const next = g.move(game, s.from, s.n, s.to);
    next.moves = game.moves;
    game = next;
    table.render(game);
    if (g.won(game)) { chain = setTimeout(victory, 320); return; }
    chain = setTimeout(step, 80);
  };
  chain = setTimeout(step, 260);
}

function undo() {
  if (!history.length || table.locked || G().won(game)) return;
  cancelChain();
  hideToast();
  game = history.pop();
  table.render(game);
  showInfo();
  write();
}

async function newGame(v, number) {
  const ticket = ++dealing;
  closeSheets();
  hideToast();
  cancelChain();
  clearTimeout(landed);
  clearTimeout(slow);
  if (game && counted && !G().won(game)) stats[game.v].streak = 0; // leaving a game part way counts as a loss
  settings.variant = v;
  table.locked = true;
  const g = VARIANTS[v].game;
  slow = setTimeout(() => { $('status').textContent = 'Shuffling for a deal that can be won…'; }, 250);
  const n = number ?? (settings.winnable ? await dealer.take(v) : g.randomDeal());
  if (ticket !== dealing) return; // another game was chosen while this one was being shuffled
  clearTimeout(slow);
  start(g.deal(n, v));
}

function restart() {
  closeSheets();
  if (!game || !game.moves) return;
  dealing++; // a deal still being shuffled isn't wanted now
  settings.variant = game.v; // so this is the way of playing to remember, not the one given up on
  clearTimeout(slow);
  hideToast();
  table.locked = true;
  start(G().deal(game.deal, game.v), true);
}

function start(state, again) {
  cancelChain();
  clearTimeout(landed);
  game = state;
  history = [];
  // Starting the same deal again part way through keeps its clock (stopped until the next move), so a fastest win counts
  // all the time spent on that deal, not just the last try. Once it's won, starting it again is a new game with a new clock.
  if (again && counted) stopClock();
  else { elapsed = 0; since = 0; counted = false; }
  table.render(game, { deal: true });
  showInfo();
  write();
  landed = setTimeout(() => { table.locked = false; after(); }, table.dealDuration + 150);
}

async function hint() {
  if (thinking || table.locked || !game || G().won(game)) return;
  if (chain) { setTimeout(hint, 120); return; } // let cards going up by themselves land first
  const at = game;
  thinking = true;
  $('b-hint').classList.add('busy');
  let h;
  try {
    h = await hintFor(game, { auto: settings.auto });
  } finally {
    thinking = false;
    $('b-hint').classList.remove('busy');
  }
  if (game !== at) return; // they moved on while it was thinking
  if (h.move) table.showHint(h.move);
  else if (h.lost) toast('Looks like there’s no way to win from here. Undo a few moves to try another way.', [['Undo', undo]]);
  else toast('There are no moves left.', [['New game', openNew]]);
}

// ---- winning ----

function victory() {
  chain = 0;
  table.locked = true;
  stopClock();
  showInfo(); // the last cards may have gone up by themselves; Undo goes off
  const st = stats[game.v];
  if (!counted) st.played++;
  st.won++;
  st.streak++;
  st.best = Math.max(st.best, st.streak);
  st.fastest = st.fastest ? Math.min(st.fastest, elapsed) : elapsed;
  counted = false;
  write();

  $('won-line').textContent = `${label(game.v)}, deal ${game.deal.toLocaleString('en-US')}, in ${clock(elapsed)} and ${plural(game.moves, 'move')}.`;
  $('won-stats').innerHTML = tiles([
    ['Won', `${st.won} of ${st.played}`],
    ['Streak', st.streak],
    ['Fastest', clock(st.fastest)],
  ]);
  const overlay = $('won'), panel = overlay.querySelector('.panel');
  hideToast();
  overlay.hidden = false;
  panel.hidden = true;
  modal();
  const showPanel = () => { panel.hidden = false; $('b-again').focus({ preventScroll: true }); };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showPanel();
  } else {
    table.unbury();
    stopBounce = cascade($('bounce'), G().bounceOrder(game), c => table.rectOf(c), c => table.hide(c, true));
    const timer = setTimeout(showPanel, 3500);
    overlay.addEventListener('pointerdown', () => { clearTimeout(timer); showPanel(); }, { once: true });
  }
}

function closeWon() {
  stopBounce?.();
  stopBounce = null;
  const canvas = $('bounce');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  $('won').hidden = true;
  modal();
  table.showAllCards();
  table.locked = false;
}
$('b-again').addEventListener('click', () => { closeWon(); newGame(game.v); });
$('b-pick').addEventListener('click', () => { closeWon(); openNew(); });

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
  $('status').textContent = `${label(game.v)} · Deal ${game.deal.toLocaleString('en-US')}`;
  $('moves').textContent = plural(game.moves, 'move');
  $('time').textContent = clock(played());
  $('b-undo').disabled = !history.length || G().won(game);
  document.documentElement.dataset.game = VARIANTS[game.v].name.toLowerCase();
}
setInterval(() => { if (game && since) $('time').textContent = clock(played()); }, 1000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopClock(); write(); }
  else if (counted && game && !G().won(game)) startClock();
});
window.addEventListener('pagehide', () => { stopClock(); write(); });

function tiles(list) {
  return list.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function showStats(v) {
  const st = stats[v];
  $('stats-for').value = v;
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

// What was saved, leaving out any part that isn't the shape this page writes (it never should be).
function read() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* none, or not readable */ }
  if (!isObj(s)) return {};
  for (const k of ['settings', 'stats', 'next', 'game']) if (!isObj(s[k])) delete s[k];
  return s;
}

function write() {
  // The whole undo list goes too, so Undo still goes all the way back after the page is closed. The last 2,000 moves
  // is more than a game takes, and keeps the save to about a megabyte even in Spider.
  const g = game && !G().won(game) ? { state: game, history: history.slice(-2000), elapsed: played(), counted } : null;
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
    if (k === 'winnable' && settings.winnable && game) dealer.prepare(game.v);
  });
}

function apply() {
  for (const [k, id] of Object.entries(toggles)) $(id).checked = settings[k];
  document.documentElement.toggleAttribute('data-four', settings.four);
  $('clock').hidden = !settings.clock;
  if (table.left !== settings.left) {
    table.left = settings.left;
    if (game) table.render(game, { still: true });
  }
}

// ---- buttons, sheets and messages ----

$('b-new').addEventListener('click', openNew);
$('b-undo').addEventListener('click', undo);
$('b-hint').addEventListener('click', hint);
$('b-menu').addEventListener('click', () => {
  showStats(game?.v || settings.variant);
  const name = VARIANTS[game?.v || settings.variant].name;
  document.querySelectorAll('.howto details').forEach(d => { d.open = d.dataset.game === name.toLowerCase(); });
  openSheet('sheet-menu');
});
$('b-restart').addEventListener('click', restart);
$('stats-for').addEventListener('change', e => showStats(e.target.value));
document.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => newGame(b.dataset.v)));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheets));

function openNew() {
  hideToast();
  $('new-note').hidden = !(counted && game && !G().won(game));
  $('b-restart').hidden = !game || !game.moves;
  document.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('current', b.dataset.v === (game?.v || settings.variant)));
  openSheet('sheet-new');
}

let opener = null;
function openSheet(id) {
  closeSheets();
  hideToast();
  opener = document.activeElement; // before the page behind goes inert, which takes focus away from it
  $(id).hidden = false;
  modal();
  ($(id).querySelector('.current') || $(id).querySelector('.close, button'))?.focus({ preventScroll: true });
}
function closeSheets() {
  const open = document.querySelectorAll('.sheet:not([hidden])');
  open.forEach(s => { s.hidden = true; });
  modal(); // before focus goes back, since nothing inert can take it
  if (open.length && opener?.focus) opener.focus({ preventScroll: true });
  opener = null;
}

// While a sheet or the won panel is open, the table, its buttons and any message behind it can't be reached.
function modal() {
  const blocked = !!document.querySelector('.sheet:not([hidden])') || !$('won').hidden;
  $('game').inert = blocked;
  $('toast').inert = blocked;
}

let toastTimer = 0;
function toast(text, actions = []) {
  const t = $('toast');
  t.textContent = text;
  for (const [name, fn] of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
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
  if (!$('won').hidden || e.altKey || !game) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (e.ctrlKey || e.metaKey) return;
  else if (k === ' ' && keyFocus && e.target.closest?.('button, a, summary')) return; // Space presses it
  else if (k === ' ' || k === 'd') { e.preventDefault(); table.on.stock(); }
  else if (k === 'h') hint();
  else if (k === 'n') openNew();
});

// Whether the keyboard brought focus to where it is (Tab, or Escape closing a sheet). A button there takes Space;
// a button that kept focus after a click or tap leaves Space to the deck.
let byKey = false, keyFocus = false;
document.addEventListener('pointerdown', () => { byKey = false; }, true);
document.addEventListener('keydown', () => { byKey = true; }, true);
document.addEventListener('focusin', () => { keyFocus = byKey; });

// ---- offline ----

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---- starting up: carry on with the saved game, or deal a new one ----

apply();
if (!resume(saved.game)) newGame(settings.variant);

// Carry on with a saved game, if there's one that can be played. A saved game that can't (it never should be)
// is dropped, and a new one dealt, keeping the settings and the record.
function resume(g) {
  const s = g?.state;
  try {
    if (!isObj(s) || !VARIANTS[s.v] || gameOf(s).won(s)) return false;
    game = s;
    history = g.history;
    elapsed = Number.isFinite(g.elapsed) ? g.elapsed : 0;
    counted = !!g.counted;
    table.render(game, { still: true });
    showInfo();
    after();
  } catch {
    cancelChain();
    game = null;
    history = [];
    elapsed = 0;
    counted = false;
    table.state = null; // so the table doesn't try to draw it again
    return false;
  }
  if (settings.winnable) setTimeout(() => dealer.prepare(game.v), 4000);
  return true;
}

// For the tests and the screenshot tool.
window.patience = {
  get state() { return game; },
  get busy() { return table.locked || !!chain; },
  load(state, ms = 0) { cancelChain(); clearTimeout(landed); game = state; history = []; elapsed = ms; since = 0; table.locked = false; table.render(game, { still: true }); showInfo(); after(); },
  newGame,
  settings,
  stats,
};
