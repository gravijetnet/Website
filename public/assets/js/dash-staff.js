// Spielplatz, the staff console, at spielplatz.example.invalid.
//
// This used to only be able to change what the website showed — hide a player,
// rule on a form — on the reasoning that a punishment row written behind
// Phoenix's back would reach nobody. That is still true, and it is why nothing
// here writes to Phoenix directly. What changed is that it no longer needs to:
// punishments and rank changes are handed to MoreFeatures through a queue, and
// the plugin performs them through the core's own API, in game, for real. See
// server/lib/actions and the plugin's ActionQueue.
//
// So Spielplatz now does three kinds of thing: it shows the network, it rules on
// what the website's own forms produced, and — Admin and up — it reaches into
// the game to punish, promote, and change the rules everyone plays by.
import { api } from './api.js';
import { icons } from './icons.js';
import { pageLoader, notice } from './components.js';
import { paintStaffTabs, STAFF_TABS } from './shell.js';
import { esc, head, int, timeAgo, dateShort, playtime, dur } from './util.js';
import { renderRulesEditor } from './dash-rules.js';
import { renderAccess } from './dash-access.js';
import { renderRanks, renderLadders, renderReportMenu, renderBackups } from './dash-network.js';
import { renderUsers } from './dash-users.js';
import { renderBroadcast } from './dash-broadcast.js';

const SITE = 'https://example.invalid';

function wall(title, body) {
  return `
    <div class="container">
      <section class="panel entry" style="margin-top:24px">
        <div class="soon-state">
          <div class="glyph">${icons.shield}</div>
          <div><h4>${esc(title)}</h4><p>${esc(body)}</p></div>
          <div style="margin-left:auto"><a class="btn btn-primary" href="/auth/discord?return=/" data-ext>Sign in with Discord</a></div>
        </div>
      </section>
    </div>`;
}

export async function renderStaffDash(root, tab) {
  root.innerHTML = pageLoader();
  const me = await api.me().catch(() => ({ user: null }));
  if (!me.user) return void (root.innerHTML = wall('Staff only', 'Sign in with the Discord account that holds your rank.'));
  if (!me.user.staff) {
    root.innerHTML = notice(
      'Not staff',
      `Signed in as ${me.user.discord.name}, but that account holds no staff rank in the Gravijet Discord. If you were just promoted, sign out and back in.`,
    );
    return;
  }

  const can = me.user.can || {};
  paintStaffTabs(can);

  const allowed = STAFF_TABS.filter((t) => can[t.need]);
  const active = allowed.find((t) => t.key === tab);
  if (!active) {
    root.innerHTML = notice(
      allowed.length ? 'No such page' : 'Nothing to do',
      allowed.length ? 'That is not a page on Spielplatz.' : 'Your rank has no Spielplatz permissions.',
    );
    return;
  }

  root.innerHTML = `<section class="section"><div class="container"><div id="cbody">${pageLoader()}</div></div></section>`;
  const body = root.querySelector('#cbody');

  try {
    if (active.key === '') await paintQueue(body, can, me);
    else if (active.key === 'applications') await paintApplications(body, can);
    else if (active.key === 'reports') await paintReports(body, can);
    else if (active.key === 'appeals') await paintAppeals(body, can);
    else if (active.key === 'players') await paintPlayers(body, can);
    else if (active.key === 'users') await renderUsers(body, can);
    else if (active.key === 'broadcast') await renderBroadcast(body, can);
    else if (active.key === 'rules') await renderRulesEditor(body, can);
    else if (active.key === 'ranks') await renderRanks(body, can);
    else if (active.key === 'ladders') await renderLadders(body, can);
    else if (active.key === 'reportmenu') await renderReportMenu(body, can);
    else if (active.key === 'backups') await renderBackups(body, can);
    else if (active.key === 'access') await renderAccess(body, can);
    else if (active.key === 'audit') await paintAudit(body);
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="empty">${esc(
      err?.body?.error === 'forbidden' ? 'Your rank does not cover this.' : 'That list could not be loaded.',
    )}</div>`;
  }
}

function empty(what) {
  return `<div class="board"><div class="empty">${esc(what)}</div></div>`;
}

// A filter strip. The selected one is a real link, so a filtered view is a URL
// somebody can send to the person who has to deal with it.
function filters(current, options, base) {
  return `
    <div class="lb-controls">
      <div class="lb-tabs">
        ${options
          .map(
            (o) =>
              `<a class="lb-tab btn ${o.key === current ? 'active' : ''}" href="${base}?status=${o.key}">${esc(o.label)}</a>`,
          )
          .join('')}
      </div>
    </div>`;
}

function statusOf() {
  return new URLSearchParams(location.search).get('status') || '';
}

// --- the queue -------------------------------------------------------------

const KIND_ICON = { application: 'staff', report: 'report', appeal: 'shield' };

// How long something has waited, said plainly. "3d ago" is a fact; "waiting 3
// days" is the same fact pointed at the person who has to do something about it.
function waited(at) {
  const d = Math.floor((Date.now() - at) / 86400000);
  if (d >= 1) return { text: `waiting ${d} day${d === 1 ? '' : 's'}`, stale: d >= 3 };
  const h = Math.floor((Date.now() - at) / 3600000);
  if (h >= 1) return { text: `waiting ${h}h`, stale: false };
  return { text: 'just in', stale: false };
}

async function paintQueue(body, can, me) {
  const [queue, stats] = await Promise.all([
    api.dash.queue().catch(() => ({ items: [] })),
    api.dash.stats().catch(() => null),
  ]);

  const tile = (n, label) => `<div class="ptile entry"><span class="pt-n">${n}</span><span class="pt-l">${esc(label)}</span></div>`;

  body.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">${esc(me.user.ranks.join(', ') || 'Staff')} — ${esc(me.user.discord.name)}</span>
        <h2>What needs doing</h2>
        <p>Everything waiting on a human, oldest first.</p>
      </div>
      <a class="btn" href="${SITE}/" data-ext>example.invalid</a>
    </div>

    <div id="q">${
      queue.items.length
        ? queue.items
            .map((i) => {
              const w = waited(i.at);
              return `
      <a class="board-row entry qrow" style="grid-template-columns:auto 1fr auto;gap:12px" href="${i.href}">
        <div class="glyph glyph-sm">${icons[KIND_ICON[i.kind]] || icons.shield}</div>
        <div style="min-width:0">
          <div class="dn">${esc(i.title)}</div>
          <div class="dr">${esc(i.kind)}${i.detail ? ` · ${esc(String(i.detail).slice(0, 90))}` : ''}</div>
        </div>
        <div class="dr ${w.stale ? 'stale' : ''}">${esc(w.text)}</div>
      </a>`;
            })
            .join('')
        : `<div class="board"><div class="empty">The queue is empty. Nothing is waiting on you.</div></div>`
    }</div>

    ${
      stats
        ? `<div class="block">
             <div class="block-label">The network</div>
             <div class="ptiles ptiles-4">
               ${tile(int(stats.ranked), 'ranked players')}
               ${tile(int(stats.staff), 'staff')}
               ${tile(int(stats.activePunishments), 'active punishments')}
               ${tile(stats.links === null ? '—' : int(stats.links), 'linked accounts')}
             </div>
             <div class="ptiles ptiles-4">
               ${tile(int(stats.applications), 'applications all time')}
               ${tile(int(stats.reports), 'reports all time')}
               ${tile(int(stats.appeals), 'appeals all time')}
               ${tile(int(stats.punishments), 'punishments all time')}
             </div>
           </div>`
        : ''
    }`;
}

// --- applications ----------------------------------------------------------

// "All" includes the six that came over from the Discord bot, and the statuses
// the bot had that the website's own form cannot produce — cancelled, timeout —
// which is why the list is not just pending/accepted/rejected.
const APP_FILTERS = [
  { key: '', label: 'Waiting' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

async function paintApplications(body, can) {
  const status = statusOf();
  const list = await api.dash.applications(status || 'pending');

  body.innerHTML = `
    <div class="section-head">
      <div><h2>Applications</h2><p>Everyone who has asked to join the team, past and present.</p></div>
    </div>
    ${filters(status, APP_FILTERS, '/applications')}
    <div id="alist">${
      list.length
        ? list.map((a) => applicationCard(a, can)).join('')
        : empty(status === '' ? 'No applications waiting.' : 'Nothing here.')
    }</div>`;

  wireApplications(body);
}

// Who ruled on it, said accurately. The applications imported from the bot kept
// only the reviewer's Discord id, so claiming a name for them would be making
// one up, and "unknown" reads like the record is broken when it isn't.
function reviewer(a) {
  if (a.reviewedBy?.name) return `by ${esc(a.reviewedBy.name)}`;
  if (a.source === 'discord') return 'in Discord';
  return 'by someone no longer on record';
}

function applicationCard(a, can) {
  const decided = a.status !== 'pending';
  const cls = a.status === 'accepted' ? 'live' : a.status === 'rejected' ? 'dead' : 'soon';
  return `
    <details class="panel entry card-roll" data-id="${esc(a._id)}">
      <summary class="card-sum">
        <div class="glyph glyph-sm">${icons.staff}</div>
        <span class="cs-name">${esc(a.roleLabel)}</span>
        <span class="dr">${esc(a.discordName)}</span>
        <span class="badge ${cls}" data-badge>${esc(a.status)}</span>
        <span class="cs-meta">${timeAgo(a.submittedAt)}</span>
      </summary>
      <div class="panel-body">
        <div class="ph-sub">
          sent ${timeAgo(a.submittedAt)}
          ${decided ? ` · ${esc(a.status)} ${reviewer(a)}` : ''}
          ${a.source === 'discord' ? ' · <span class="tagged">from the Discord bot</span>' : ''}
        </div>
        <div class="qa">
          ${(a.qa || []).map((x) => `<div class="qa-row"><div class="qa-q">${esc(x.q)}</div><div class="qa-a">${esc(x.a)}</div></div>`).join('')}
        </div>
        ${a.note ? `<div class="block"><div class="block-label">Note</div><p class="rule-text">${esc(a.note)}</p></div>` : ''}
        ${
          can.reviewApplications && !decided
            ? `<div class="block">
                 <input class="fld" data-note placeholder="A note for the applicant (optional)" maxlength="1000">
                 <div class="factions">
                   <button class="btn btn-primary" data-act="accepted">Accept</button>
                   <button class="btn" data-act="rejected">Reject</button>
                   <span class="fmsg" data-msg></span>
                 </div>
                 <p class="rule-text" style="margin-top:8px">Accepting records the decision. It does not grant the rank — that stays a human promoting them.</p>
               </div>`
            : ''
        }
      </div>
    </details>`;
}

function wireApplications(body) {
  body.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const panel = btn.closest('.panel');
      const msg = panel.querySelector('[data-msg]');
      const note = panel.querySelector('[data-note]')?.value.trim() || '';
      panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
      msg.className = 'fmsg';
      msg.textContent = 'Saving…';
      try {
        await api.dash.reviewApplication(panel.dataset.id, btn.dataset.act, note);
        const badge = panel.querySelector('[data-badge]');
        if (badge) { badge.className = `badge ${btn.dataset.act === 'accepted' ? 'live' : 'dead'}`; badge.textContent = btn.dataset.act; }
        panel.querySelector('.factions').innerHTML = '<span class="fmsg ok">Recorded.</span>';
      } catch (err) {
        panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
        msg.className = 'fmsg bad';
        msg.textContent = err?.body?.error === 'already_reviewed' ? 'Somebody else just ruled on this.' : 'That did not save.';
      }
    }),
  );
}

// --- reports ---------------------------------------------------------------

const REPORT_FILTERS = [
  { key: '', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

async function paintReports(body, can) {
  const status = statusOf();
  const list = await api.dash.reports(status || 'open');

  body.innerHTML = `
    <div class="section-head">
      <div><h2>Reports</h2><p>Filed on the website. The punishment itself is still done in game.</p></div>
    </div>
    ${filters(status, REPORT_FILTERS, '/reports')}
    <div>${
      list.length
        ? list
            .map(
              (r) => `
      <details class="panel entry card-roll" data-id="${esc(r._id)}">
        <summary class="card-sum">
          <div class="glyph glyph-sm">${icons.report}</div>
          <span class="cs-name">${esc(r.target.name)}</span>
          <span class="dr">${esc(r.categoryLabel)}</span>
          <span class="badge ${r.status === 'closed' ? '' : 'soon'}">${r.status === 'closed' ? esc(r.outcome) : 'open'}</span>
          <span class="cs-meta">${timeAgo(r.filedAt)}</span>
        </summary>
        <div class="panel-body">
          <div class="ph-sub">by ${esc(r.discordName)}${r.status === 'closed' ? ` · ${esc(r.outcome)} by ${esc(r.resolvedBy?.name || 'unknown')}` : ''}</div>
          <p class="rule-text">${esc(r.detail)}</p>
          ${r.evidence ? `<div class="block"><div class="block-label">Evidence</div><a href="${esc(r.evidence)}" target="_blank" rel="noopener nofollow" data-ext>${esc(r.evidence)}</a></div>` : ''}
          <a class="btn" href="/players?q=${encodeURIComponent(r.target.name)}">Look up ${esc(r.target.name)}</a>
          ${
            can.resolveReports && r.status === 'open'
              ? `<div class="block"><div class="factions">
                   <button class="btn btn-primary" data-act="punished">Punished</button>
                   <button class="btn" data-act="rejected">Rejected</button>
                   <button class="btn" data-act="duplicate">Duplicate</button>
                   <span class="fmsg" data-msg></span>
                 </div></div>`
              : ''
          }
        </div>
      </details>`,
            )
            .join('')
        : empty(status === '' ? 'No open reports.' : 'Nothing here.')
    }</div>`;

  body.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const panel = btn.closest('.panel');
      panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
      try {
        await api.dash.resolveReport(panel.dataset.id, btn.dataset.act);
        panel.querySelector('.factions').innerHTML = `<span class="fmsg ok">Closed as ${esc(btn.dataset.act)}.</span>`;
      } catch {
        panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
        const msg = panel.querySelector('[data-msg]');
        msg.className = 'fmsg bad';
        msg.textContent = 'That did not save.';
      }
    }),
  );
}

// --- appeals ---------------------------------------------------------------

const APPEAL_FILTERS = [
  { key: '', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

async function paintAppeals(body, can) {
  const status = statusOf();
  const list = await api.dash.appeals(status || 'open');

  body.innerHTML = `
    <div class="section-head">
      <div><h2>Appeals</h2><p>Granting one records the decision. The unban is still done in game.</p></div>
    </div>
    ${filters(status, APPEAL_FILTERS, '/appeals')}
    <div>${
      list.length
        ? list
            .map(
              (a) => `
      <details class="panel entry card-roll" data-id="${esc(a._id)}">
        <summary class="card-sum">
          <div class="glyph glyph-sm">${icons.shield}</div>
          <span class="cs-name">${esc(a.target.name || a.target.uuid)}</span>
          <span class="dr">${esc(a.punishment.type)}</span>
          <span class="badge ${a.status === 'closed' ? '' : 'soon'}">${a.status === 'closed' ? esc(a.outcome) : 'open'}</span>
          <span class="cs-meta">${timeAgo(a.filedAt)}</span>
        </summary>
        <div class="panel-body">
          <div class="ph-sub">
            ${esc(a.punishmentId)} · ${esc(a.punishment.reason || 'no reason recorded')}
            ${a.status === 'closed' ? ` · ${esc(a.outcome)} by ${esc(a.resolvedBy?.name || 'unknown')}` : ''}
          </div>
          <p class="rule-text">${esc(a.reason)}</p>
          ${a.target.name ? `<a class="btn" href="/players?q=${encodeURIComponent(a.target.name)}">Look up ${esc(a.target.name)}</a>` : ''}
          ${a.note ? `<div class="block"><div class="block-label">Note</div><p class="rule-text">${esc(a.note)}</p></div>` : ''}
          ${
            can.resolveAppeals && a.status === 'open'
              ? `<div class="block">
                   <input class="fld" data-note placeholder="A note for them (optional)" maxlength="1000">
                   <div class="factions">
                     <button class="btn btn-primary" data-act="granted">Grant</button>
                     <button class="btn" data-act="denied">Deny</button>
                     <span class="fmsg" data-msg></span>
                   </div>
                 </div>`
              : ''
          }
        </div>
      </details>`,
            )
            .join('')
        : empty(status === '' ? 'No open appeals.' : 'Nothing here.')
    }</div>`;

  body.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const panel = btn.closest('.panel');
      const note = panel.querySelector('[data-note]')?.value.trim() || '';
      panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
      try {
        await api.dash.resolveAppeal(panel.dataset.id, btn.dataset.act, note);
        panel.querySelector('.factions').innerHTML = `<span class="fmsg ok">${esc(btn.dataset.act)}.</span>`;
      } catch {
        panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
      }
    }),
  );
}

// --- players ---------------------------------------------------------------

// Look-up and hiding on one page, because they are the same job: you hide
// somebody after looking at them, and the thing you want to see before hiding
// them is exactly what the look-up shows.
async function paintPlayers(body, can) {
  const q = new URLSearchParams(location.search).get('q') || '';

  body.innerHTML = `
    <div class="section-head">
      <div><h2>Players</h2><p>Everything the network knows about one player, and the switch that takes them off the lists.</p></div>
    </div>
    <section class="panel entry">
      <div class="panel-body">
        <div class="frow">
          <label class="flabel" for="pq">Look up a player</label>
          <input class="fld" id="pq" type="text" maxlength="32" placeholder="Start typing a name" value="${esc(q)}" list="pqac" autocomplete="off" spellcheck="false">
          <datalist id="pqac"></datalist>
        </div>
        <div class="factions"><button class="btn btn-primary" id="look">Look up</button><span class="fmsg" id="pmsg"></span></div>
      </div>
    </section>
    <div id="pcard"></div>
    <div id="hlist">${pageLoader()}</div>`;

  const input = body.querySelector('#pq');
  const msg = body.querySelector('#pmsg');
  const card = body.querySelector('#pcard');

  const look = async () => {
    const name = input.value.trim();
    if (!name) return;
    msg.className = 'fmsg';
    msg.textContent = 'Looking…';
    card.innerHTML = pageLoader();
    try {
      const p = await api.dash.player(name);
      msg.textContent = '';
      card.innerHTML = playerCard(p, can);
      wirePlayerCard(body, card, p, can);
    } catch (err) {
      card.innerHTML = '';
      msg.className = 'fmsg bad';
      msg.textContent = err?.status === 404 ? 'No player by that name.' : 'That did not work.';
    }
  };

  body.querySelector('#look').addEventListener('click', look);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') look();
  });

  // Autocomplete from the same search the site uses. A datalist keeps it native
  // — nothing to build or dismiss — and it only offers names.
  const acList = body.querySelector('#pqac');
  let acTimer = null;
  input.addEventListener('input', () => {
    const term = input.value.trim();
    clearTimeout(acTimer);
    if (term.length < 2) { acList.innerHTML = ''; return; }
    acTimer = setTimeout(async () => {
      try {
        const hits = await api.search(term);
        acList.innerHTML = hits.map((p) => `<option value="${esc(p.name)}"></option>`).join('');
      } catch { /* keep the last suggestions */ }
    }, 160);
  });

  if (q) look();

  if (can.hidePlayers) await paintHidden(body.querySelector('#hlist'));
  else body.querySelector('#hlist').innerHTML = '';
}

// A kick is history the moment it lands, so it never reads as "active" — see
// server/lib/punishments.
const PSTATE = { live: 'Active', expired: 'Expired', lifted: 'Lifted', served: 'Done' };

function playerCard(p, can) {
  const priors = p.punishments.length;
  const live = p.punishments.filter((x) => x.live).length;
  return `
    <section class="panel entry">
      <div class="panel-head">
        <img class="you-head" src="${head(p.uuid, 64)}" alt="" onerror="this.onerror=null;this.src='${head(null, 64)}'">
        <div>
          <h3>${esc(p.name)} ${p.online ? '<span class="online-dot" title="Online"></span>' : ''}</h3>
          <div class="ph-sub">
            ${p.ranks.map((r) => `<span style="color:${r.color}">${esc(r.name)}</span>`).join(' · ') || 'Member'}
          </div>
        </div>
        <div class="ph-right">
          <a class="btn" href="${SITE}/player/${encodeURIComponent(p.name)}" data-ext>Profile</a>
        </div>
      </div>
      <div class="panel-body">
        <div class="ptiles ptiles-4">
          <div class="ptile entry"><span class="pt-n">${esc(playtime(p.playtime))}</span><span class="pt-l">played</span></div>
          <div class="ptile entry"><span class="pt-n">${int(p.sessions)}</span><span class="pt-l">sessions</span></div>
          <div class="ptile entry"><span class="pt-n">${int(priors)}</span><span class="pt-l">punishments</span></div>
          <div class="ptile entry"><span class="pt-n">${p.firstSeen ? dateShort(p.firstSeen) : '—'}</span><span class="pt-l">first seen</span></div>
        </div>

        ${live ? `<div class="pwarn">Under ${live} live restriction${live === 1 ? '' : 's'} right now.</div>` : ''}

        ${restrictionsBlock(p)}

        ${
          p.hidden
            ? `<div class="pwarn">Hidden from the public lists${p.hidden.by ? ` by ${esc(p.hidden.by)}` : ''} ${timeAgo(p.hidden.at)}${p.hidden.reason ? ` — ${esc(p.hidden.reason)}` : ''}.</div>`
            : ''
        }

        ${
          p.alts.length
            ? `<div class="block">
                 <div class="block-label">Also plays as</div>
                 <p class="rule-text">The core matched these to the same connection. It is evidence, not proof.</p>
                 <div class="altrow">
                   ${p.alts.map((a) => `<a class="alt" href="/players?q=${encodeURIComponent(a.name)}"><img src="${head(a.uuid, 32)}" alt="">${esc(a.name)}</a>`).join('')}
                 </div>
               </div>`
            : ''
        }

        <div class="block">
          <div class="block-label">Punishment history</div>
          ${
            priors
              ? `<div class="board">${p.punishments
                  .map(
                    (x) => `
              <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
                <div>
                  <div class="dn"><span class="rt ${x.live ? 'hard' : ''}">${esc(x.type)}</span> ${esc(x.reason || 'no reason recorded')}</div>
                  <div class="dr">${esc(x.id)} · ${dateShort(x.issuedAt)}${x.removedReason ? ` · lifted: ${esc(x.removedReason)}` : ''}${x.shadow ? ' · shadow' : ''}</div>
                </div>
                <div><span class="badge ${x.live ? 'dead' : ''}">${esc(PSTATE[x.state] || x.state)}</span></div>
              </div>`,
                  )
                  .join('')}</div>`
              : '<div class="board"><div class="empty">Never punished.</div></div>'
          }
        </div>

        ${(can.punishPlayers || can.banPlayers) ? punishBlock(p, can) : ''}
        ${can.manageRanks ? rankBlock(p) : ''}

        ${
          can.hidePlayers
            ? `<div class="block">
                 <div class="block-label">${p.hidden ? 'Unhide' : 'Hide from the lists'}</div>
                 ${
                   p.hidden
                     ? `<div class="factions"><button class="btn" id="unhideone">Put ${esc(p.name)} back on the lists</button><span class="fmsg" id="hmsg2"></span></div>`
                     : `<p class="rule-text">Takes them off the leaderboards, the directory and search, and 404s their profile for everyone but staff. Nothing changes in game.</p>
                        <input class="fld" id="hreason" maxlength="500" placeholder="Why — so the next person knows">
                        <div class="factions"><button class="btn btn-primary" id="hideone">Hide ${esc(p.name)}</button><span class="fmsg" id="hmsg2"></span></div>`
                 }
               </div>`
            : ''
        }
      </div>
    </section>`;
}

// The live restrictions on a player, each with the button that lifts it. Only
// live ones: a kick and an expired ban have nothing to revoke.
function liveRevocable(p) {
  return p.punishments.filter((x) => x.live && x.appealable);
}

// What is on the player right now, and the one button that takes it off. This
// sits high on the card — above the history and above the form for new ones —
// because "unban this person" is a thing you come to the page already meaning to
// do, and it should not be buried under the machinery for punishing them afresh.
function restrictionsBlock(p) {
  const live = liveRevocable(p);
  if (!live.length) return '';
  return `
    <div class="block" id="restrictions">
      <div class="block-label">Active restrictions</div>
      <p class="rule-text">These are in force in game now. Lifting one takes effect immediately, through the core, and is recorded against your name.</p>
      ${live
        .map(
          (x) => `<div class="factions revrow" data-revoke="${esc(x.id)}">
            <span class="dr revwhat"><span class="rt ${/BAN|BLACKLIST/.test(String(x.type).toUpperCase()) ? 'hard' : ''}">${esc(x.type)}</span> ${esc(x.reason || 'no reason recorded')}</span>
            <input class="fld fld-inline" placeholder="Why you're lifting it" maxlength="200">
            <button class="btn btn-primary">${undoLabel(x.type)}</button>
            <span class="fmsg revmsg"></span>
          </div>`,
        )
        .join('')}
    </div>`;
}

// Mute / kick / tempban / permban / blacklist, and lifting a live one. Durations
// are named, not typed in milliseconds — a text box asking for "how many ms"
// is how somebody bans for 30 seconds meaning 30 days.
const DURATIONS = [
  { label: '30 min', ms: 30 * 60000 },
  { label: '1 hour', ms: 3600000 },
  { label: '6 hours', ms: 6 * 3600000 },
  { label: '1 day', ms: 86400000 },
  { label: '7 days', ms: 7 * 86400000 },
  { label: '30 days', ms: 30 * 86400000 },
];

function punishBlock(p, can) {
  return `
    <div class="block" id="punishblock">
      <div class="block-label">Punish</div>
      <p class="rule-text">This takes effect in game, now, through the core — exactly as if you had typed the command. It is recorded against your name, which the player never sees.</p>
      <div class="prow">
        <select class="fld" id="ptype">
          <option value="mute">Mute</option>
          <option value="kick">Kick</option>
          <option value="ban">Ban</option>
          ${can.banPlayers ? '<option value="blacklist">Blacklist (IP)</option>' : ''}
        </select>
        <select class="fld" id="pdur">
          ${DURATIONS.map((d) => `<option value="${d.ms}">${d.label}</option>`).join('')}
          ${can.banPlayers ? '<option value="perm">Permanent</option>' : ''}
        </select>
        <label class="pcheck"><input type="checkbox" id="psilent"> Silent</label>
      </div>
      <input class="fld" id="preason" maxlength="200" placeholder="Reason — the player sees this">
      <div class="factions">
        <button class="btn btn-primary" id="pdo">Punish ${esc(p.name)}</button>
        <span class="fmsg" id="pmsg2"></span>
      </div>
    </div>`;
}

function rankBlock(p) {
  return `
    <div class="block" id="rankblock">
      <div class="block-label">Rank</div>
      <p class="rule-text">Promote or demote in game. The Discord bot posts the same announcement it always has. You cannot hand out a rank at or above your own.</p>
      <div class="prow">
        <select class="fld" id="rmode">
          <option value="grant">Promote to</option>
          <option value="ungrant">Demote from</option>
        </select>
        <select class="fld" id="rrank"><option value="">Loading ranks…</option></select>
      </div>
      <input class="fld" id="rreason" maxlength="200" placeholder="Reason — goes in the announcement">
      <div class="factions">
        <button class="btn btn-primary" id="rdo">Apply</button>
        <span class="fmsg" id="rmsg"></span>
      </div>
    </div>`;
}

function wirePlayerCard(body, card, p, can) {
  const refresh = async () => {
    const fresh = await api.dash.player(p.name);
    card.innerHTML = playerCard(fresh, can);
    wirePlayerCard(body, card, fresh, can);
    await paintHidden(body.querySelector('#hlist'));
  };

  const hide = card.querySelector('#hideone');
  if (hide) {
    hide.addEventListener('click', async () => {
      hide.disabled = true;
      try {
        await api.dash.hide(p.name, card.querySelector('#hreason').value.trim());
        await refresh();
      } catch {
        hide.disabled = false;
        const m = card.querySelector('#hmsg2');
        m.className = 'fmsg bad';
        m.textContent = 'That did not work.';
      }
    });
  }

  const unhide = card.querySelector('#unhideone');
  if (unhide) {
    unhide.addEventListener('click', async () => {
      unhide.disabled = true;
      try {
        await api.dash.unhide(p.uuid);
        await refresh();
      } catch {
        unhide.disabled = false;
      }
    });
  }

  wirePunish(card, p, refresh);
  wireRank(card, p, refresh);
}

// The website only queues a job; the game does the work a moment later. So these
// do not claim success on a 202 — they watch the job until the plugin has
// actually done it, and report what the game said. A ban that "worked" on the
// website and failed in game is the one outcome staff must never be told is fine.
// Every code the moderation and rank routes can return, each said as the reason
// it actually is — the whole point of "say exactly why it did not work". A code
// that reaches the fallback is one the server added without telling the panel;
// keep this in step with server/routes/moderation.js.
const PUNISH_ERR = {
  // shared
  reason_required: 'A reason is required — the player and the next moderator both read it.',
  forbidden: 'Your rank does not allow this.',
  unknown_player: 'No player by that name. Check the spelling — it must be exact.',
  plugin_missing: 'The game-side plugin is not deployed yet, so this cannot reach the server.',
  // punishing
  bad_type: 'That is not a punishment the core understands.',
  target_is_staff: 'They outrank what you may punish from here — only an Admin may.',
  duration_required: 'Pick how long it lasts.',
  duration_too_long: 'Longer than the core will accept (its ceiling is a year).',
  punish_failed: 'The server errored while queuing it. Nothing was applied — try again.',
  // lifting
  unknown_punishment: 'That punishment is not on record any more.',
  not_live: 'That punishment is not active any more — someone may have just lifted it.',
  revoke_failed: 'The server errored while queuing the lift. Try again.',
  // ranks
  bad_mode: 'Choose promote or demote.',
  rank_required: 'Pick a rank.',
  unknown_rank: 'No such rank on the network.',
  rank_too_high: 'That rank is at or above your own — you cannot hand out your own standing.',
  rank_not_on_discord: 'That rank lives only in game (Owner and the purchase ranks), so it cannot be set from here.',
  target_not_linked: 'They have not linked their Discord. They must /link in game first — a promotion here changes a Discord role, and there is none to change until they do.',
  bot_missing: 'The Discord bot has not been deployed with rank sync yet.',
  grant_failed: 'The server errored while asking the bot. Nothing changed — try again.',
};

function punishErr(err) {
  return PUNISH_ERR[err?.body?.error] || 'That did not go through.';
}

// A lift, named for the punishment it undoes: "Unmute" reads as the thing you
// meant to do, where a generic "Lift" makes you stop and check what it lifts.
const UNDO_LABEL = { MUTE: 'Unmute', BAN: 'Unban', BLACKLIST: 'Lift blacklist', WARN: 'Remove warning', KICK: 'Lift' };
function undoLabel(type) {
  return UNDO_LABEL[String(type).toUpperCase()] || 'Lift';
}

// Polls a queued job to its end. Resolves with the final row, or a timed-out
// shape if the game never got to it — which is itself worth showing, because it
// means no server was up to do it.
async function awaitJob(jobId, msg) {
  for (let i = 0; i < 20; i++) {
    let row;
    try {
      row = await api.dash.action(jobId);
    } catch {
      return { status: 'unknown' };
    }
    if (row.status === 'done' || row.status === 'failed') return row;
    if (msg) msg.textContent = i < 2 ? 'Sending to the server…' : 'Waiting for the server…';
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'pending' };
}

function reportJob(msg, row, doneText) {
  if (row.status === 'done') { msg.className = 'fmsg ok'; msg.textContent = doneText; return true; }
  if (row.status === 'failed') { msg.className = 'fmsg bad'; msg.textContent = `The server refused it: ${esc(row.result || 'no reason')}`; return false; }
  if (row.status === 'pending') { msg.className = 'fmsg bad'; msg.textContent = 'No server picked it up — is one online?'; return false; }
  msg.className = 'fmsg';
  msg.textContent = 'Queued. It will run when a server is next up.';
  return false;
}

function wirePunish(card, p, refresh) {
  const btn = card.querySelector('#pdo');
  if (btn) {
    const msg = card.querySelector('#pmsg2');
    btn.addEventListener('click', async () => {
      const type = card.querySelector('#ptype').value;
      const durVal = card.querySelector('#pdur').value;
      const reason = card.querySelector('#preason').value.trim();
      if (!reason) { msg.className = 'fmsg bad'; msg.textContent = 'A reason is required.'; return; }
      const body = {
        name: p.name,
        type,
        reason,
        silent: card.querySelector('#psilent').checked,
        permanent: durVal === 'perm',
        durationMs: durVal === 'perm' ? 0 : Number(durVal),
      };
      btn.disabled = true;
      msg.className = 'fmsg';
      msg.textContent = 'Queuing…';
      try {
        const { jobId } = await api.dash.punish(body);
        const row = await awaitJob(jobId, msg);
        if (reportJob(msg, row, `${type} applied.`)) setTimeout(refresh, 900);
        else btn.disabled = false;
      } catch (err) {
        btn.disabled = false;
        msg.className = 'fmsg bad';
        msg.textContent = punishErr(err);
      }
    });
  }

  card.querySelectorAll('[data-revoke]').forEach((rowEl) => {
    const b = rowEl.querySelector('button');
    const input = rowEl.querySelector('input');
    const msg = rowEl.querySelector('.revmsg');
    const say = (cls, text) => { if (msg) { msg.className = `fmsg ${cls}`.trim(); msg.textContent = text; } };
    b.addEventListener('click', async () => {
      const reason = input.value.trim();
      if (!reason) { say('bad', 'Say why you are lifting it.'); input.focus(); return; }
      b.disabled = true;
      say('', 'Lifting…');
      try {
        const { jobId } = await api.dash.revoke(rowEl.dataset.revoke, reason);
        const row = await awaitJob(jobId, msg);
        if (reportJob(msg, row, 'Lifted — it is off them in game.')) setTimeout(refresh, 900);
        else b.disabled = false;
      } catch (err) {
        b.disabled = false;
        say('bad', punishErr(err));
      }
    });
  });
}

async function wireRank(card, p, refresh) {
  const btn = card.querySelector('#rdo');
  if (!btn) return;
  const sel = card.querySelector('#rrank');
  const msg = card.querySelector('#rmsg');

  // The rank list is the same for everybody, so it is fetched once and cached on
  // the module rather than per player card.
  try {
    const ranks = await ranksOnce();
    sel.innerHTML = ranks
      .map((r) => `<option value="${esc(r.name)}" style="color:${r.color}">${esc(r.name)}</option>`)
      .join('');
  } catch {
    sel.innerHTML = '<option value="">Could not load ranks</option>';
  }

  btn.addEventListener('click', async () => {
    const rank = sel.value;
    const mode = card.querySelector('#rmode').value;
    const reason = card.querySelector('#rreason').value.trim();
    if (!rank) return;
    if (!reason) { msg.className = 'fmsg bad'; msg.textContent = 'A reason is required.'; return; }
    btn.disabled = true;
    msg.className = 'fmsg';
    msg.textContent = 'Asking the bot…';
    try {
      // A rank change goes through Discord — the bot adds the role, the sync
      // carries it into the game and posts the announcement. So this watches the
      // bot's task, not a game job, and says the in-game rank follows.
      const { taskId } = await api.dash.grant({ name: p.name, rank, mode, reason });
      const row = await awaitGrant(taskId, msg);
      if (row.status === 'done') {
        msg.className = 'fmsg ok';
        msg.textContent = mode === 'grant'
          ? `${rank} role added — the in-game rank follows in a moment.`
          : `${rank} role removed — the in-game rank follows in a moment.`;
        setTimeout(refresh, 2500);
      } else if (row.status === 'failed') {
        msg.className = 'fmsg bad';
        msg.textContent = `The bot could not: ${esc(row.result || 'no reason')}`;
        btn.disabled = false;
      } else {
        msg.className = 'fmsg';
        msg.textContent = 'Queued for the bot. It will run shortly.';
        btn.disabled = false;
      }
    } catch (err) {
      btn.disabled = false;
      msg.className = 'fmsg bad';
      msg.textContent = punishErr(err);
    }
  });
}

async function awaitGrant(taskId, msg) {
  for (let i = 0; i < 15; i++) {
    let row;
    try { row = await api.dash.grantStatus(taskId); } catch { return { status: 'unknown' }; }
    if (row.status === 'done' || row.status === 'failed') return row;
    if (msg) msg.textContent = 'Waiting for the bot…';
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'pending' };
}

let _ranks = null;
function ranksOnce() {
  if (!_ranks) _ranks = api.dash.ranks();
  return _ranks;
}

async function paintHidden(box) {
  const list = await api.dash.hidden().catch(() => []);
  box.innerHTML = `
    <div class="block">
      <div class="block-label">Currently hidden</div>
      <div class="board">
        ${
          list.length
            ? list
                .map(
                  (h) => `
          <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px" data-uuid="${esc(h._id)}">
            <div>
              <div class="dn">${esc(h.name)}</div>
              <div class="dr">${esc(h.reason || 'no reason given')} · ${esc(h.by?.name || 'unknown')} · ${timeAgo(h.at)}</div>
            </div>
            <a class="btn" href="/players?q=${encodeURIComponent(h.name)}">Open</a>
          </div>`,
                )
                .join('')
            : '<div class="empty">Nobody is hidden.</div>'
        }
      </div>
    </div>`;
}

// --- audit -----------------------------------------------------------------

async function paintAudit(body) {
  const list = await api.dash.audit();
  body.innerHTML = `
    <div class="section-head">
      <div><h2>Audit</h2><p>Every decision made here, against the name of whoever made it. Yours included.</p></div>
    </div>
    ${
      list.length
        ? `<div class="board">
             <div class="board-head" style="grid-template-columns:140px 1fr 1fr"><span>When</span><span>Action</span><span>By</span></div>
             ${list
               .map(
                 (a) => `
               <div class="board-row entry" style="grid-template-columns:140px 1fr 1fr">
                 <div class="dr" title="${esc(dateShort(a.at))}">${timeAgo(a.at)}</div>
                 <div><div class="dn">${esc(a.action)}</div><div class="dr">${esc(a.name || a.applicant || a.subject || '')}</div></div>
                 <div class="dr">${esc(a.by?.name || 'unknown')}${a.by?.ranks?.length ? ` · ${esc(a.by.ranks[0])}` : ''}</div>
               </div>`,
               )
               .join('')}
           </div>`
        : empty('Nothing has been done yet.')
    }`;
}
