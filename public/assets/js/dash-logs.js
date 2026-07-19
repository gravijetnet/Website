// What the core wrote down: every command run, and every line said.
//
// This is the tab that answers "what actually happened" — the thing a report
// claims and the thing an admin denies. Read-only by design: a log you can edit
// is not a log. Searched by player as readily as by text, because a moderator
// looking somebody up should never have to know their UUID.
import { api } from './api.js';
import { esc, timeAgo, dateShort } from './util.js';
import { pageLoader, notice } from './components.js';

const KINDS = [
  { key: 'commands', label: 'Commands' },
  { key: 'chat', label: 'Chat' },
];

export async function renderLogs(root) {
  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Logs</h2>
        <p>Everything the core recorded. Search by the player who did it, or by what was said or typed.</p>
      </div>
    </div>
    <section class="panel entry"><div class="panel-body">
      <div class="logbar">
        <div class="lb-tabs">
          ${KINDS.map((k, i) => `<button class="btn lb-tab ${i === 0 ? 'active' : ''}" data-kind="${k.key}">${k.label}</button>`).join('')}
        </div>
        <input class="fld fld-inline" id="lq" placeholder="Search by player or text" autocomplete="off" spellcheck="false">
      </div>
    </div></section>
    <div id="loglist">${pageLoader()}</div>`;

  let kind = 'commands';
  const list = root.querySelector('#loglist');
  const input = root.querySelector('#lq');
  let timer = null;
  // Only the newest response may paint: a slow search for "a" must not land on
  // top of the fast one for "abc" typed after it.
  let seq = 0;

  const load = async () => {
    const mine = ++seq;
    list.innerHTML = pageLoader();
    try {
      const q = input.value.trim();
      const data = kind === 'commands' ? await api.dash.commandLogs(q, 200) : await api.dash.chatLogs(q, 200);
      if (mine !== seq) return;
      list.innerHTML = paint(kind, data.logs || []);
    } catch {
      if (mine !== seq) return;
      list.innerHTML = notice('Unavailable', 'Those logs could not be read.');
    }
  };

  root.querySelectorAll('[data-kind]').forEach((btn) =>
    btn.addEventListener('click', () => {
      kind = btn.dataset.kind;
      root.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('active', b === btn));
      load();
    }),
  );
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });

  await load();
}

function paint(kind, logs) {
  if (!logs.length) return '<div class="board"><div class="empty">Nothing matches.</div></div>';
  return `<div class="board">${logs.map((l) => (kind === 'commands' ? cmdRow(l) : chatRow(l))).join('')}</div>`;
}

function who(l) {
  return esc(l.by || l.byUuid || 'unknown');
}

function cmdRow(l) {
  return `
    <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
      <div style="min-width:0">
        <div class="dn mono">${esc(l.command)}</div>
        <div class="dr">${who(l)}${l.server ? ` · ${esc(l.server)}` : ''}</div>
      </div>
      <div class="dr" title="${esc(dateShort(l.at))}">${timeAgo(l.at)}</div>
    </div>`;
}

function chatRow(l) {
  return `
    <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
      <div style="min-width:0">
        <div class="dn">${esc(l.message)}</div>
        <div class="dr">${who(l)}</div>
      </div>
      <div class="dr" title="${esc(dateShort(l.at))}">${timeAgo(l.at)}</div>
    </div>`;
}
