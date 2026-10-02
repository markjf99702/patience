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

const saved = read();
// The first version only played Klondike, and kept the draw count where the way of playing now goes.
if (saved.settings && !saved.settings.variant && saved.settings.draw) saved.settings.variant = 'k' + saved.settings.draw;
if (saved.stats?.[1] || saved.stats?.[3]) { saved.stats.k1 ??= saved.stats[1]; saved.stats.k3 ??= saved.stats[3]; }
if (saved.next?.[1] || saved.next?.[3]) saved.next = { k1: saved.next[1], k3: saved.next[3] };
const upgrade = s => (s && !s.v && s.draw ? { ...s, v: 'k' + s.draw } : s);
if (saved.game) { saved.game.state = upgrade(saved.game.state); saved.game.history = (saved.game.history || []).map(upgrade); }

const settings = { ...DEFAULTS, ...saved.settings };
delete settings.draw;
if (!VARIANTS[settings.variant]) settings.variant = 'k1';
const stats = Object.fromEntries(Object.keys(VARIANTS).map(v => [v, { ...blank(), ...saved.stats?.[v] }]));

let game = null;      // where the cards are now
let history = [];     // where they were before each move, for Undo
let elapsed = 0;      // time spent on this game, not counting time away
let since = 0;        // when the clock last started, or 0 while it's stopped
let counted = false;  // whether this game has been counted as played (it is from the first move)
let chain = 0;        // the timer for the next card going up by itself
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
const dealer = new Dealer(saved.next || {}, () => write());

// ---- playing ----

// Make a move the player asked for. Returns false if there was nothing to do.
function act(next) {
  if (!next || table.locked) return false;
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
  const g = G();
  if (g.won(game)) { chain = setTimeout(victory, 700); return; }
  if (g.finishable(game)) { finish(); return; }
  if (settings.auto) {
    const step = g.autoStep(game);
    if (step) {
      chain = setTimeout(() => {
        chain = 0;
        const next = g.move(game, step.from, step.n, step.to);
        next.moves = game.moves; // these aren't the player's moves
        set(next);
      }, 140);
      return;
    }
  }
  if (counted && g.outOfMoves(game)) {
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
  if (!history.length || table.locked) return;
  cancelChain();
  hideToast();
  game = history.pop();
  table.render(game);
  showInfo();
  write();
}

async function newGame(v, number) {
  closeSheets();
  hideToast();
  cancelChain();
  if (game && counted && !G().won(game)) stats[game.v].streak = 0; // leaving a game part way counts as a loss
  settings.variant = v;
  table.locked = true;
  const g = VARIANTS[v].game;
  const slow = setTimeout(() => { $('status').textContent = 'Shuffling for a deal that can be won…'; }, 250);
  const n = number ?? (settings.winnable ? await dealer.take(v) : g.randomDeal());
  clearTimeout(slow);
  start(g.deal(n, v));
}

function restart() {
  closeSheets();
  if (!game || !game.moves) return;
  cancelChain();
  hideToast();
  table.locked = true;
  start(G().deal(game.deal, game.v), true);
}

function start(state, again) {
  game = state;
  history = [];
  elapsed = 0;
  since = 0;
  if (!again) counted = false;
  table.render(game, { deal: true });
  showInfo();
  write();
  setTimeout(() => { table.locked = false; after(); }, table.dealDuration + 150);
}

async function hint() {
  if (thinking || table.locked || !game) return;
  if (chain) { setTimeout(hint, 120); return; } // let cards going up by themselves land first
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
  chain = 0;
  table.locked = true;
  stopClock();
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
  overlay.hidden = false;
  panel.hidden = true;
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
  $('b-undo').disabled = !history.length;
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

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function write() {
  const g = game && !G().won(game) ? { state: game, history: history.slice(-500), elapsed: played(), counted } : null;
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
  opener = document.activeElement;
  $(id).hidden = false;
  $(id).querySelector('.current, .close, button')?.focus({ preventScroll: true });
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
  else if (k === ' ' || k === 'd') { e.preventDefault(); table.on.stock(); }
  else if (k === 'h') hint();
  else if (k === 'n') openNew();
});

// ---- offline ----

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---- starting up: carry on with the saved game, or deal a new one ----

apply();
const resume = saved.game?.state;
if (resume && VARIANTS[resume.v] && !gameOf(resume).won(resume)) {
  game = resume;
  history = saved.game.history || [];
  elapsed = saved.game.elapsed || 0;
  counted = !!saved.game.counted;
  table.render(game, { still: true });
  showInfo();
  after();
  if (settings.winnable) setTimeout(() => dealer.prepare(game.v), 4000);
} else {
  newGame(settings.variant);
}

// For the tests and the screenshot tool.
window.patience = {
  get state() { return game; },
  get busy() { return table.locked || !!chain; },
  load(state, ms = 0) { cancelChain(); game = state; history = []; elapsed = ms; since = 0; table.locked = false; table.render(game, { still: true }); showInfo(); after(); },
  newGame,
  settings,
  stats,
};
