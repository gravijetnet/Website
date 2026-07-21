// The record — every ban, mute, kick and blacklist the network has handed out.
//
// The dossier shows one person's history; this shows the network's. It is the
// page you open to answer "what have we been doing lately", to find the ban
// somebody is asking about when all they have is a name, or to read down a
// column of reasons and notice the one you keep typing is really a rule nobody
// wrote down.
//
// Read-only, like everything that touches the core. The "Active" count is the
// honest one — a kick is stored active-forever in Phoenix, so the server decides
// what actually bites right now (lib/punishments), and this only shows it.
import { api } from './api.js';
import { esc, head, timeAgo, dateShort, dur } from './util.js';
import { pageLoader, notice } from './components.js';

// The five types the core issues, each its own colour so a page of them reads at
// a glance — red for the hard ones, calmer for the rest. `All` carries no colour.
const TYPES = [
  { key: '', label: 'All', count: 'ALL' },
  { key: 'BAN', label: 'Bans', count: 'BAN' },
  { key: 'MUTE', label: 'Mutes', count: 'MUTE' },
  { key: 'KICK', label: 'Kicks', count: 'KICK' },
  { key: 'BLACKLIST', label: 'Blacklists', count: 'BLACKLIST' },
  { key: 'WARN', label: 'Warns', count: 'WARN' },
];

const STATES = [
  { key: 'all', label: 'Any state' },
  { key: 'live', label: 'Active now' },
  { key: 'lifted', label: 'Lifted' },
  { key: 'expired', label: 'Expired' },
];

// What each state is called to the eye reading the row, and how loud it is. A
// live restriction is the only one that is red; the rest are history.
const STATE_BADGE = {
  live: { label: 'Active', cls: 'dead' },
  expired: { label: 'Expired', cls: '' },
  lifted: { label: 'Lifted', cls: '' },
  served: { label: 'Done', cls: '' },
};

// State read from the address, so a filtered view is a link somebody can send.
function readState() {
  const p = new URLSearchParams(location.search);
  const type = (p.get('type') || '').toUpperCase();
  return {
    type: TYPES.some((t) => t.key === type) ? type : '',
    state: STATES.some((s) => s.key === p.get('state')) ? p.get('state') : 'all',
    q: p.get('q') || '',
    page: Math.max(1, parseInt(p.get('page'), 10) || 1),
  };
}

// Mirror the current filters into the address without re-routing: replaceState
// does not fire the router, so the page keeps its scroll and its focus while the
// URL stays copy-pastable.
function writeState(s) {
  const p = new URLSearchParams();
  if (s.type) p.set('type', s.type);
  if (s.state && s.state !== 'all') p.set('state', s.state);
  if (s.q) p.set('q', s.q);
  if (s.page > 1) p.set('page', s.page);
  const qs = p.toString();
  history.replaceState({}, '', `/punishments${qs ? `?${qs}` : ''}`);
}

// A player's name in their rank colour, linking to their record — the same shape
// the live feed and the dossier use, so a name means the same everywhere.
function nameLink(who) {
  if (!who || !who.name) {
    const shown = who?.uuid ? `${who.uuid.slice(0, 8)}…` : 'unknown';
    return `<span class="pr-name" style="color:#AAA">${esc(shown)}</span>`;
  }
  return `<a class="pr-name" style="color:${esc(who.color || '#AAA')}" href="/players?q=${encodeURIComponent(who.name)}">${esc(who.name)}</a>`;
}

// The length or shape of the punishment, in one short phrase: how long it was
// for, whether it is still counting down, and — if a human took it off — that.
function span(p) {
  if (p.state === 'served') return ''; // a kick has no length
  const bits = [];
  if (p.permanent) bits.push('permanent');
  else if (p.duration) bits.push(dur(p.duration));
  if (p.live && p.expiresAt) bits.push(`ends ${dateShort(p.expiresAt)}`);
  return bits.join(' · ');
}

function row(p) {
  const badge = STATE_BADGE[p.state] || { label: p.state, cls: '' };
  const type = String(p.type || '').toLowerCase();
  const s = span(p);
  return `
    <div class="pnrow entry">
      <div class="pr-who">
        <img src="${head(p.target.uuid, 32)}" alt="" width="26" height="26" onerror="this.onerror=null;this.src='${head(null, 32)}'">
        <div class="pr-wg">
          ${nameLink(p.target)}
          <span class="pr-sub">${esc(p.id || '—')}${p.server ? ` · ${esc(p.server)}` : ''}${p.shadow ? ' · shadow' : ''}${p.silent ? ' · silent' : ''}</span>
        </div>
      </div>
      <span class="pr-type pt-${type}">${esc(p.type)}</span>
      <div class="pr-reason">
        <span class="pr-rtext">${p.reason ? esc(p.reason) : '<span class="pr-none">no reason recorded</span>'}</span>
        ${p.removedReason ? `<span class="pr-sub">lifted: ${esc(p.removedReason)}${p.remover ? ` — by <span style="color:${esc(p.remover.color || '#AAA')}">${esc(p.remover.name || '—')}</span>` : ''}</span>` : ''}
      </div>
      <div class="pr-by">
        <span class="pr-sub">by</span> ${p.issuer ? nameLink(p.issuer) : '<span class="pr-name" style="color:#AAA">the core</span>'}
        <span class="pr-sub" title="${esc(dateShort(p.issuedAt))}">${timeAgo(p.issuedAt)}</span>
      </div>
      <div class="pr-state">
        <span class="badge ${badge.cls}">${esc(badge.label)}</span>
        ${s ? `<span class="pr-sub">${esc(s)}</span>` : ''}
      </div>
    </div>`;
}

export async function renderPunishments(root) {
  const st = readState();

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Punishments</h2>
        <p>Every ban, mute, kick and blacklist on the network. Search by the player it hit or the staff member who gave it.</p>
      </div>
    </div>
    <section class="panel entry"><div class="panel-body">
      <div class="prbar">
        <div class="pr-chips" id="prchips"></div>
        <div class="pr-tools">
          <select class="fld fld-inline" id="prstate" style="max-width:150px">
            ${STATES.map((s) => `<option value="${s.key}" ${s.key === st.state ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
          <input class="fld fld-inline" id="prq" placeholder="Search player or staff" autocomplete="off" spellcheck="false" value="${esc(st.q)}" style="max-width:220px">
        </div>
      </div>
    </div></section>
    <div class="pr-count" id="prcount"></div>
    <div id="prlist">${pageLoader()}</div>
    <div class="pr-pager" id="prpager"></div>`;

  const chipsBox = root.querySelector('#prchips');
  const stateSel = root.querySelector('#prstate');
  const qInput = root.querySelector('#prq');
  const list = root.querySelector('#prlist');
  const countBox = root.querySelector('#prcount');
  const pager = root.querySelector('#prpager');

  let timer = null;
  // Only the newest response paints: a slow "a" must not land on top of "abc".
  let seq = 0;

  const drawChips = (counts) => {
    chipsBox.innerHTML = TYPES.map((t) => {
      const n = counts ? counts[t.count] ?? 0 : null;
      return `<button class="btn pr-chip ${t.key === st.type ? 'active' : ''}" data-type="${t.key}">
        ${esc(t.label)}${n != null ? `<span class="pr-cn">${n}</span>` : ''}
      </button>`;
    }).join('');
    chipsBox.querySelectorAll('[data-type]').forEach((b) =>
      b.addEventListener('click', () => {
        st.type = b.dataset.type;
        st.page = 1;
        load();
      }),
    );
  };

  const drawPager = (page, pages) => {
    if (pages <= 1) return void (pager.innerHTML = '');
    pager.innerHTML = `
      <button class="btn" id="prprev" ${page <= 1 ? 'disabled' : ''}>← Newer</button>
      <span class="pr-pn">Page ${page} of ${pages}</span>
      <button class="btn" id="prnext" ${page >= pages ? 'disabled' : ''}>Older →</button>`;
    const prev = pager.querySelector('#prprev');
    const next = pager.querySelector('#prnext');
    if (prev) prev.addEventListener('click', () => { st.page = Math.max(1, page - 1); load(); root.scrollIntoView({ block: 'start' }); });
    if (next) next.addEventListener('click', () => { st.page = page + 1; load(); root.scrollIntoView({ block: 'start' }); });
  };

  drawChips(null);

  async function load() {
    const mine = ++seq;
    writeState(st);
    chipsBox.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === st.type));
    list.innerHTML = pageLoader();
    try {
      const data = await api.dash.punishmentRecord(st);
      if (mine !== seq) return;
      st.page = data.page; // the server clamps to the last page; follow it
      drawChips(data.counts);
      const active = data.counts?.LIVE || 0;
      countBox.innerHTML = data.total
        ? `${data.total} ${data.total === 1 ? 'punishment' : 'punishments'}${active ? ` · <b class="pr-live">${active} active now</b>` : ''}`
        : '';
      list.innerHTML = data.rows.length
        ? data.rows.map(row).join('')
        : '<div class="board"><div class="empty">Nothing matches. Try a different type or a name.</div></div>';
      drawPager(data.page, data.pages);
    } catch {
      if (mine !== seq) return;
      list.innerHTML = notice('Unavailable', 'The punishment record could not be read.');
      countBox.innerHTML = '';
      pager.innerHTML = '';
    }
  }

  stateSel.addEventListener('change', () => { st.state = stateSel.value; st.page = 1; load(); });
  qInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { st.q = qInput.value.trim(); st.page = 1; load(); }, 250);
  });

  await load();
}
