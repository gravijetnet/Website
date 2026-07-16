// The staff dashboard. Lives at example.invalid, but it is the same app
// and the same session cookie — the host only decides what the front door shows.
//
// Nothing here bans, kicks or mutes. Phoenix keeps punishments in memory and
// syncs them over Redis, so a row written behind its back would miss anyone
// currently online and could be overwritten by the plugin that owns it.
// Punishments stay in game. This decides what the website shows and what the
// website's own forms produced.
import { api } from './api.js';
import { icons } from './icons.js';
import { pageLoader, notice } from './components.js';
import { esc, timeAgo } from './util.js';

const TABS = [
  { key: 'applications', label: 'Applications', need: 'viewApplications' },
  { key: 'reports', label: 'Reports', need: 'viewReports' },
  { key: 'appeals', label: 'Appeals', need: 'viewAppeals' },
  { key: 'hidden', label: 'Hidden players', need: 'hidePlayers' },
  { key: 'audit', label: 'Audit', need: 'reviewApplications' },
];

function wall(title, body) {
  return `
    <div class="container">
      <section class="panel entry" style="margin-top:24px">
        <div class="soon-state">
          <div class="glyph">${icons.shield}</div>
          <div><h4>${esc(title)}</h4><p>${esc(body)}</p></div>
          <div style="margin-left:auto"><a class="btn btn-primary" href="/auth/discord?return=/dashboard" data-ext>Sign in with Discord</a></div>
        </div>
      </section>
    </div>`;
}

export async function renderDashboard(root, tab) {
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
  const allowed = TABS.filter((t) => can[t.need]);
  const active = allowed.find((t) => t.key === tab) || allowed[0];
  if (!active) return void (root.innerHTML = notice('Nothing to do', 'Your rank has no dashboard permissions.'));

  let summary = {};
  try {
    summary = await api.dash.summary();
  } catch { /* the tabs still work without the counters */ }

  const count = (k) => (summary.pending?.[k] ? `<span class="dcount">${summary.pending[k]}</span>` : '');

  root.innerHTML = `
    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <span class="eyebrow">${esc(me.user.ranks.join(', ') || 'Staff')} &mdash; ${esc(me.user.discord.name)}</span>
            <h2>Dashboard</h2>
          </div>
          <a class="btn" href="https://example.invalid/" data-ext>Back to the site</a>
        </div>
        <div class="lb-controls">
          <div class="lb-tabs">
            ${allowed
              .map(
                (t) =>
                  `<a class="lb-tab btn ${t.key === active.key ? 'active' : ''}" href="/dashboard/${t.key}">${esc(t.label)}${count(t.key)}</a>`,
              )
              .join('')}
          </div>
        </div>
        <div id="dbody">${pageLoader()}</div>
      </div>
    </section>`;

  const body = root.querySelector('#dbody');
  try {
    if (active.key === 'applications') await paintApplications(body, can);
    else if (active.key === 'reports') await paintReports(body, can);
    else if (active.key === 'appeals') await paintAppeals(body, can);
    else if (active.key === 'hidden') await paintHidden(body);
    else if (active.key === 'audit') await paintAudit(body);
  } catch (err) {
    body.innerHTML = `<div class="empty">${esc(err?.body?.error === 'forbidden' ? 'Your rank does not cover this.' : 'That list could not be loaded.')}</div>`;
  }
}

function empty(what) {
  return `<div class="board"><div class="empty">${esc(what)}</div></div>`;
}

// --- applications ----------------------------------------------------------

async function paintApplications(body, can) {
  const list = await api.dash.applications();
  if (!list.length) return void (body.innerHTML = empty('No applications waiting.'));

  body.innerHTML = list
    .map(
      (a) => `
    <section class="panel entry" data-id="${esc(a._id)}">
      <div class="panel-head">
        <div class="glyph">${icons.staff}</div>
        <div>
          <h3>${esc(a.roleLabel)} &mdash; ${esc(a.discordName)}</h3>
          <div class="ph-sub">${timeAgo(a.submittedAt)}</div>
        </div>
        <div class="ph-right"><span class="badge soon">${esc(a.status)}</span></div>
      </div>
      <div class="panel-body">
        <div class="qa">
          ${a.qa.map((x) => `<div class="qa-row"><div class="qa-q">${esc(x.q)}</div><div class="qa-a">${esc(x.a)}</div></div>`).join('')}
        </div>
        ${
          can.reviewApplications
            ? `<div class="block">
                 <div class="factions">
                   <button class="btn btn-primary" data-act="accepted">Accept</button>
                   <button class="btn" data-act="rejected">Reject</button>
                   <span class="fmsg" data-msg></span>
                 </div>
                 <p class="rule-text" style="margin-top:8px">Accepting records the decision. It does not grant the rank — that stays a human promoting them in Discord.</p>
               </div>`
            : ''
        }
      </div>
    </section>`,
    )
    .join('');

  body.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const panel = btn.closest('.panel');
      const msg = panel.querySelector('[data-msg]');
      panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
      msg.textContent = 'Saving…';
      try {
        await api.dash.reviewApplication(panel.dataset.id, btn.dataset.act);
        panel.querySelector('.ph-right').innerHTML = `<span class="badge live">${esc(btn.dataset.act)}</span>`;
        panel.querySelector('.factions').innerHTML = '<span class="fmsg ok">Recorded.</span>';
      } catch {
        panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
        msg.className = 'fmsg bad';
        msg.textContent = 'That did not save.';
      }
    }),
  );
}

// --- reports ---------------------------------------------------------------

async function paintReports(body, can) {
  const list = await api.dash.reports();
  if (!list.length) return void (body.innerHTML = empty('No open reports.'));

  body.innerHTML = list
    .map(
      (r) => `
    <section class="panel entry" data-id="${esc(r._id)}">
      <div class="panel-head">
        <div class="glyph">${icons.report}</div>
        <div>
          <h3>${esc(r.target.name)} &mdash; ${esc(r.categoryLabel)}</h3>
          <div class="ph-sub">by ${esc(r.discordName)} · ${timeAgo(r.filedAt)}</div>
        </div>
        <div class="ph-right"><a class="btn" href="https://example.invalid/player/${encodeURIComponent(r.target.name)}" data-ext>Profile</a></div>
      </div>
      <div class="panel-body">
        <p class="rule-text">${esc(r.detail)}</p>
        ${r.evidence ? `<div class="block"><div class="block-label">Evidence</div><a href="${esc(r.evidence)}" data-ext target="_blank" rel="noopener nofollow">${esc(r.evidence)}</a></div>` : ''}
        ${
          can.resolveReports
            ? `<div class="block"><div class="factions">
                 <button class="btn btn-primary" data-act="punished">Punished</button>
                 <button class="btn" data-act="rejected">Rejected</button>
                 <button class="btn" data-act="duplicate">Duplicate</button>
                 <span class="fmsg" data-msg></span>
               </div>
               <p class="rule-text" style="margin-top:8px">This closes the report. The punishment itself is still done in game.</p></div>`
            : ''
        }
      </div>
    </section>`,
    )
    .join('');

  body.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const panel = btn.closest('.panel');
      panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
      try {
        await api.dash.resolveReport(panel.dataset.id, btn.dataset.act);
        panel.querySelector('.factions').innerHTML = `<span class="fmsg ok">Closed as ${esc(btn.dataset.act)}.</span>`;
      } catch {
        panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
        panel.querySelector('[data-msg]').className = 'fmsg bad';
        panel.querySelector('[data-msg]').textContent = 'That did not save.';
      }
    }),
  );
}

// --- appeals ---------------------------------------------------------------

async function paintAppeals(body, can) {
  const list = await api.dash.appeals();
  if (!list.length) return void (body.innerHTML = empty('No open appeals.'));

  body.innerHTML = list
    .map(
      (a) => `
    <section class="panel entry" data-id="${esc(a._id)}">
      <div class="panel-head">
        <div class="glyph">${icons.shield}</div>
        <div>
          <h3>${esc(a.target.name || a.target.uuid)} &mdash; ${esc(a.punishment.type)}</h3>
          <div class="ph-sub">${esc(a.punishmentId)} · ${esc(a.punishment.reason || 'no reason recorded')} · ${timeAgo(a.filedAt)}</div>
        </div>
      </div>
      <div class="panel-body">
        <p class="rule-text">${esc(a.reason)}</p>
        ${
          can.resolveAppeals
            ? `<div class="block"><div class="factions">
                 <button class="btn btn-primary" data-act="granted">Grant</button>
                 <button class="btn" data-act="denied">Deny</button>
                 <span class="fmsg" data-msg></span>
               </div>
               <p class="rule-text" style="margin-top:8px">Granting records the decision. The unban is still done in game.</p></div>`
            : ''
        }
      </div>
    </section>`,
    )
    .join('');

  body.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const panel = btn.closest('.panel');
      panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
      try {
        await api.dash.resolveAppeal(panel.dataset.id, btn.dataset.act);
        panel.querySelector('.factions').innerHTML = `<span class="fmsg ok">${esc(btn.dataset.act)}.</span>`;
      } catch {
        panel.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
      }
    }),
  );
}

// --- hidden ----------------------------------------------------------------

async function paintHidden(body) {
  const list = await api.dash.hidden();
  body.innerHTML = `
    <section class="panel entry">
      <div class="panel-body">
        <p class="rule-text">Hiding takes a player off the leaderboards, the directory and search, and 404s their profile for everyone but staff. It changes nothing in game: they keep playing and the server keeps their stats.</p>
        <div class="block">
          <div class="frow"><label class="flabel" for="hn">Player</label><input class="fld" id="hn" type="text" maxlength="32" placeholder="Exact in-game name"></div>
          <div class="frow"><label class="flabel" for="hr">Why</label><input class="fld" id="hr" type="text" maxlength="500" placeholder="So the next person knows"></div>
          <div class="factions"><button class="btn btn-primary" id="hide">Hide player</button><span class="fmsg" id="hmsg"></span></div>
        </div>
      </div>
    </section>
    <div class="board" id="hlist">
      ${
        list.length
          ? list
              .map(
                (h) => `
        <div class="board-row entry" style="grid-template-columns:1fr auto auto;gap:12px" data-uuid="${esc(h._id)}">
          <div><div class="dn">${esc(h.name)}</div><div class="dr">${esc(h.reason || 'no reason given')} · ${esc(h.by?.name || 'unknown')} · ${timeAgo(h.at)}</div></div>
          <button class="btn" data-unhide>Unhide</button>
        </div>`,
              )
              .join('')
          : '<div class="empty">Nobody is hidden.</div>'
      }
    </div>`;

  const msg = body.querySelector('#hmsg');
  body.querySelector('#hide').addEventListener('click', async () => {
    const name = body.querySelector('#hn').value.trim();
    if (!name) return;
    msg.className = 'fmsg';
    msg.textContent = 'Hiding…';
    try {
      await api.dash.hide(name, body.querySelector('#hr').value.trim());
      await paintHidden(body);
    } catch (err) {
      msg.className = 'fmsg bad';
      msg.textContent = err?.body?.error === 'unknown_player' ? 'No player by that name.' : 'That did not work.';
    }
  });

  body.querySelectorAll('[data-unhide]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.dash.unhide(btn.closest('[data-uuid]').dataset.uuid);
        await paintHidden(body);
      } catch {
        btn.disabled = false;
      }
    }),
  );
}

// --- audit -----------------------------------------------------------------

async function paintAudit(body) {
  const list = await api.dash.audit();
  if (!list.length) return void (body.innerHTML = empty('Nothing has been done yet.'));
  body.innerHTML = `
    <div class="board">
      <div class="board-head" style="grid-template-columns:160px 1fr 1fr">
        <span>When</span><span>Action</span><span>By</span>
      </div>
      ${list
        .map(
          (a) => `
        <div class="board-row entry" style="grid-template-columns:160px 1fr 1fr">
          <div class="dr">${timeAgo(a.at)}</div>
          <div><div class="dn">${esc(a.action)}</div><div class="dr">${esc(a.name || a.subject || '')}</div></div>
          <div class="dr">${esc(a.by?.name || 'unknown')}</div>
        </div>`,
        )
        .join('')}
    </div>`;
}
