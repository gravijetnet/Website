// The command palette — one box that reaches everything, from the keyboard.
//
// A console with twenty destinations makes you move a mouse to a list on the
// left and read it every time. This is the shortcut for the people who stop
// reading it: ⌘K (or Ctrl-K) anywhere, type three letters of where you are
// going, Enter. It knows the pages, and it asks the server for players,
// punishment ids, ranks, ladders and anybody who has signed in — the same
// search the box on the console uses, so it can never surface a thing its user
// could not already open.
//
// It is not a second router. Everything it does is navigate() to a real URL or
// run one of a short list of verbs, so a palette action is always something you
// could also have reached by clicking, and always leaves a URL behind you.
import { navigate } from './nav.js';
import { api } from './api.js';
import { icons } from './icons.js';
import { esc } from './util.js';
import { CONSOLE_NAV } from './shell.js';

// The verbs that are not pages: a small, hand-kept list of the things staff do
// often enough to want two keystrokes instead of a page and a form. Each is a
// destination a permission already guards, so the palette only shows the ones
// the caller may reach.
const ACTIONS = [
  { label: 'Broadcast to the network', hint: 'send a message in game', need: 'broadcast', href: '/network/broadcast' },
  { label: 'Run a console command', hint: 'on a server', need: 'runCommands', href: '/network/servers' },
  { label: 'Watch the network live', hint: 'chat and activity as it happens', need: 'viewReports', href: '/live' },
  { label: 'Look something up', hint: 'the logs — every command and line', need: 'viewReports', href: '/logs' },
];

let wired = false;
let overlay = null;
let can = null; // permission map, fetched once and kept
let seq = 0;
let items = []; // the flat, navigable result list currently shown
let sel = 0;

// Pages, flattened out of the side nav and kept in the order they appear there
// so the palette and the list down the side never disagree about what a page is
// called or where it sits. Group is carried so a match can say which part of the
// console it belongs to.
function pageIndex() {
  const out = [];
  for (const section of CONSOLE_NAV) {
    for (const it of section.items) {
      out.push({ path: it.path, label: it.label, group: section.group || 'Console', need: it.need });
    }
  }
  return out;
}

// Subsequence match: "nr" finds "Network ranks", "brd" finds "Broadcast". A
// query that is a straight substring scores higher, so exact beats scattered.
function score(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx === 0) return 100;
  if (idx > 0) return 80 - idx;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
  return qi === q.length ? 40 - (t.length - q.length) * 0.1 : -1;
}

// The handful of recently opened things, so an empty palette is still useful.
// Kept to what a person could open again — a label and a URL — never anything
// the server would have to be asked to re-authorise.
function recents() {
  try {
    return JSON.parse(localStorage.getItem('gj.palette.recent') || '[]').slice(0, 6);
  } catch {
    return [];
  }
}
function remember(entry) {
  if (!entry?.href) return;
  const list = recents().filter((r) => r.href !== entry.href);
  list.unshift({ label: entry.label, hint: entry.hint || '', href: entry.href, icon: entry.iconKey || 'arrow' });
  try {
    localStorage.setItem('gj.palette.recent', JSON.stringify(list.slice(0, 8)));
  } catch { /* private mode: recents are a nicety, not load-bearing */ }
}

const ICON_FOR = { player: 'users', punishment: 'shield', rank: 'staff', ladder: 'rules', user: 'users' };

function pageEntry(p) {
  return {
    label: p.label,
    hint: p.group,
    iconKey: 'arrow',
    go() { navigate(p.path); return { label: p.label, hint: p.group, href: p.path, iconKey: 'arrow' }; },
  };
}
function actionEntry(a) {
  return {
    label: a.label,
    hint: a.hint,
    iconKey: 'flame',
    go() { navigate(a.href); return { label: a.label, hint: a.hint, href: a.href, iconKey: 'flame' }; },
  };
}
function searchEntry(r) {
  return {
    label: r.label,
    hint: r.hint,
    iconKey: ICON_FOR[r.kind] || 'search',
    go() { navigate(r.href); return { label: r.label, hint: r.hint, href: r.href, iconKey: ICON_FOR[r.kind] || 'search' }; },
  };
}

// What to show for a query, before the server answers: the pages and verbs the
// caller may reach, best match first. An empty query shows recents, then the
// top of the nav — the same shape, so the list never jumps as you start typing.
function localMatches(q) {
  const pages = pageIndex().filter((p) => !p.need || can?.[p.need]);
  const acts = ACTIONS.filter((a) => !a.need || can?.[a.need]);
  if (!q) {
    const rec = recents().map((r) => ({
      label: r.label, hint: r.hint, iconKey: r.icon || 'arrow',
      go() { navigate(r.href); return r; },
    }));
    const top = pages.slice(0, 6).map(pageEntry);
    return [...rec, ...top].slice(0, 9);
  }
  const scored = [
    ...pages.map((p) => ({ e: pageEntry(p), s: score(q, p.label) })),
    ...acts.map((a) => ({ e: actionEntry(a), s: Math.max(score(q, a.label), score(q, a.hint) - 20) })),
  ]
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  return scored.map((x) => x.e).slice(0, 8);
}

function row(e, i) {
  return `
    <button class="pal-row ${i === sel ? 'sel' : ''}" data-i="${i}" tabindex="-1">
      <span class="pal-ic">${icons[e.iconKey] || icons.arrow}</span>
      <span class="pal-lab">${esc(e.label)}</span>
      ${e.hint ? `<span class="pal-hint">${esc(e.hint)}</span>` : ''}
    </button>`;
}

function paint() {
  const list = overlay.querySelector('#pal-list');
  list.innerHTML = items.length
    ? items.map(row).join('')
    : '<div class="pal-empty">Nothing matches. Try a name, a punishment id, or a page.</div>';
  list.querySelectorAll('[data-i]').forEach((el) => {
    el.addEventListener('mousemove', () => { sel = Number(el.dataset.i); mark(); });
    el.addEventListener('click', () => activate());
  });
}

function mark() {
  overlay.querySelectorAll('.pal-row').forEach((el, i) => el.classList.toggle('sel', i === sel));
  const cur = overlay.querySelector('.pal-row.sel');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function activate() {
  const e = items[sel];
  if (!e) return;
  const remembered = e.go();
  remember(remembered);
  close();
}

async function runQuery(q) {
  // Local matches paint immediately; the server's are merged in when they land.
  items = localMatches(q);
  sel = 0;
  paint();
  if (q.length < 2) return;
  const mine = ++seq;
  try {
    const { results } = await api.dash.search(q);
    if (mine !== seq || !overlay) return;
    // Server results go under the local ones — a page you named exactly should
    // still be the first thing Enter lands on.
    const server = (results || []).map(searchEntry);
    items = [...items, ...server];
    paint();
  } catch { /* the local matches stand on their own */ }
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); mark(); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); return; }
  if (e.key === 'Enter') { e.preventDefault(); activate(); return; }
  // Ctrl-N / Ctrl-P, for the hands that never leave the home row.
  if (e.ctrlKey && (e.key === 'n' || e.key === 'p')) {
    e.preventDefault();
    sel = e.key === 'n' ? Math.min(sel + 1, items.length - 1) : Math.max(sel - 1, 0);
    mark();
  }
}

function open() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'pal-back';
  overlay.innerHTML = `
    <div class="pal" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="pal-top">
        <span class="pal-search">${icons.search}</span>
        <input class="pal-in" id="pal-in" placeholder="Go to a page, or find a player, a ban, a rank…" autocomplete="off" spellcheck="false">
        <kbd class="pal-esc">esc</kbd>
      </div>
      <div class="pal-list" id="pal-list"></div>
      <div class="pal-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#pal-in');
  input.addEventListener('input', () => runQuery(input.value.trim()));
  input.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  runQuery('');
  input.focus();
}

function close() {
  seq++;
  if (overlay) { overlay.remove(); overlay = null; }
}

// Wire the one shortcut, once, for the console surface only. The listener is on
// the capture phase so it beats a page that is itself listening for keys, and it
// stays out of the way while somebody is typing in a field — ⌘K is deliberate,
// but a bare "/" opening the palette mid-sentence would be a trap.
export function initPalette() {
  if (wired) return;
  wired = true;
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.surface !== 'staff') return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'k') {
      e.preventDefault();
      if (overlay) close(); else openWithPerms();
      return;
    }
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if (k === '/' && !typing && !overlay && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openWithPerms();
    }
  }, true);
}

// The palette needs to know what its user may reach before it draws a page list.
// Fetched once and kept — permissions do not change inside a session, and a
// palette that waited on the network to open would not be a shortcut.
async function openWithPerms() {
  if (!can) {
    try { can = (await api.me()).user?.can || {}; } catch { can = {}; }
  }
  open();
}
