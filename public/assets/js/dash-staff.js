// The staff console, at spielplatz.example.invalid.
//
// Nothing here bans, kicks or mutes. Phoenix keeps punishments in memory and
// syncs them over Redis, so a row written behind its back would miss anyone
// currently online and could be overwritten by the plugin that owns it.
// Punishments stay in game. This decides what the website shows, rules on what
// the website's own forms produced, and — the part that is new — tells you what
// you are looking at before you rule on it.
import { api } from './api.js';
import { icons } from './icons.js';
import { pageLoader, notice } from './components.js';
import { paintStaffTabs, STAFF_TABS } from './shell.js';
import { esc, head, int, timeAgo, dateShort, playtime } from './util.js';

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
      allowed.length ? 'That is not a page on the console.' : 'Your rank has no console permissions.',
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
    <section class="panel entry" data-id="${esc(a._id)}">
      <div class="panel-head">
        <div class="glyph">${icons.staff}</div>
        <div>
          <h3>${esc(a.roleLabel)} — ${esc(a.discordName)}</h3>
          <div class="ph-sub">
            sent ${timeAgo(a.submittedAt)}
            ${decided ? ` · ${esc(a.status)} ${reviewer(a)}` : ''}
            ${a.source === 'discord' ? ' · <span class="tagged">from the Discord bot</span>' : ''}
          </div>
        </div>
        <div class="ph-right"><span class="badge ${cls}">${esc(a.status)}</span></div>
      </div>
      <div class="panel-body">
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
    </section>`;
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
        panel.querySelector('.ph-right').innerHTML = `<span class="badge ${btn.dataset.act === 'accepted' ? 'live' : 'dead'}">${esc(btn.dataset.act)}</span>`;
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
      <section class="panel entry" data-id="${esc(r._id)}">
        <div class="panel-head">
          <div class="glyph">${icons.report}</div>
          <div>
            <h3>${esc(r.target.name)} — ${esc(r.categoryLabel)}</h3>
            <div class="ph-sub">
              by ${esc(r.discordName)} · ${timeAgo(r.filedAt)}
              ${r.status === 'closed' ? ` · ${esc(r.outcome)} by ${esc(r.resolvedBy?.name || 'unknown')}` : ''}
            </div>
          </div>
          <div class="ph-right">
            <a class="btn" href="/players?q=${encodeURIComponent(r.target.name)}">Look up</a>
          </div>
        </div>
        <div class="panel-body">
          <p class="rule-text">${esc(r.detail)}</p>
          ${r.evidence ? `<div class="block"><div class="block-label">Evidence</div><a href="${esc(r.evidence)}" target="_blank" rel="noopener nofollow" data-ext>${esc(r.evidence)}</a></div>` : ''}
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
      </section>`,
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
      <section class="panel entry" data-id="${esc(a._id)}">
        <div class="panel-head">
          <div class="glyph">${icons.shield}</div>
          <div>
            <h3>${esc(a.target.name || a.target.uuid)} — ${esc(a.punishment.type)}</h3>
            <div class="ph-sub">
              ${esc(a.punishmentId)} · ${esc(a.punishment.reason || 'no reason recorded')} · ${timeAgo(a.filedAt)}
              ${a.status === 'closed' ? ` · ${esc(a.outcome)} by ${esc(a.resolvedBy?.name || 'unknown')}` : ''}
            </div>
          </div>
          <div class="ph-right">
            ${a.target.name ? `<a class="btn" href="/players?q=${encodeURIComponent(a.target.name)}">Look up</a>` : ''}
          </div>
        </div>
        <div class="panel-body">
          <p class="rule-text">${esc(a.reason)}</p>
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
      </section>`,
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
          <input class="fld" id="pq" type="text" maxlength="32" placeholder="Exact in-game name" value="${esc(q)}">
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
