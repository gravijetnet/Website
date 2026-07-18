// Everyone who has signed in to the site.
//
// The website keeps no member list — the only record of who exists to it is who
// has logged in. This is that list: one row per person, their Discord identity,
// the rank their roles give them, and the Minecraft account they have linked if
// any. Filtered in the browser, because the whole set is small and a staff member
// looking for one person should not wait on a round trip per keystroke.
import { api } from './api.js';
import { esc, head, timeAgo, dateShort } from './util.js';
import { pageLoader, notice } from './components.js';

export async function renderUsers(root) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.users();
  } catch {
    root.innerHTML = notice('Users unavailable', 'Could not read who has signed in.');
    return;
  }

  const users = data.users || [];
  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Users</h2>
        <p>${data.count} account${data.count === 1 ? ' has' : 's have'} signed in. Search by name, rank, or linked Minecraft account.</p>
      </div>
    </div>
    <section class="panel entry"><div class="panel-body">
      <input class="fld" id="usearch" placeholder="Filter by name, rank, or Minecraft name" autocomplete="off" spellcheck="false">
    </div></section>
    <div class="board" id="ulist">${users.map(userRow).join('') || '<div class="empty">Nobody has signed in yet.</div>'}</div>`;

  const input = root.querySelector('#usearch');
  const list = root.querySelector('#ulist');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const shown = q ? users.filter((u) => matches(u, q)) : users;
    list.innerHTML = shown.map(userRow).join('') || '<div class="empty">Nobody matches.</div>';
  });
}

function matches(u, q) {
  return (
    (u.name || '').toLowerCase().includes(q)
    || u.ranks.some((r) => r.toLowerCase().includes(q))
    || (u.linked?.name || '').toLowerCase().includes(q)
    || (u.id || '').includes(q)
  );
}

function userRow(u) {
  const rank = u.ranks[0] || 'Member';
  const avatar = u.avatar
    ? `<img class="uav" src="${esc(u.avatar)}" alt="" onerror="this.style.visibility='hidden'">`
    : (u.linked
      ? `<img class="uav" src="${head(u.linked.uuid, 40)}" alt="">`
      : '<span class="uav uav-blank"></span>');
  return `
    <div class="board-row entry" style="grid-template-columns:auto 1fr auto;gap:12px">
      ${avatar}
      <div style="min-width:0">
        <div class="dn">${esc(u.name || 'unknown')} ${u.ranks.length ? `<span class="utag">${esc(rank)}</span>` : ''}</div>
        <div class="dr">${u.linked ? `linked to ${esc(u.linked.name)}` : 'not linked'}${u.since ? ` · joined ${esc(dateShort(u.since))}` : ''}</div>
      </div>
      <div class="dr" title="Last seen">${u.lastSeen ? timeAgo(u.lastSeen) : '—'}</div>
    </div>`;
}
