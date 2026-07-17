// A player's own dashboard, at example.invalid/dashboard.
//
// Everything a player sent us and everything that came back: applications,
// reports, appeals, punishments, session history, and the link between their two
// accounts. Nothing here is about anyone else, which is why this chrome has no
// search box and no leaderboard.
//
// The split against the console is by subject, not by permission: staff read
// this page too, about themselves. Being a mod does not make your own appeal
// somebody else's business.
import { api } from './api.js';
import { icons } from './icons.js';
import { pageLoader, notice } from './components.js';
import { esc, head, timeAgo, dateShort, dur } from './util.js';

const TABS = ['', 'applications', 'reports', 'appeals', 'account'];

function wall(returnTo) {
  return `
    <div class="container">
      <section class="panel entry" style="margin-top:24px">
        <div class="soon-state">
          <div class="glyph">${icons.shield}</div>
          <div>
            <h4>Sign in first</h4>
            <p>Your dashboard is your own paperwork, so we need to know who you are.</p>
          </div>
          <div style="margin-left:auto">
            <a class="btn btn-primary" href="/auth/discord?return=${encodeURIComponent(returnTo)}" data-ext>Sign in with Discord</a>
          </div>
        </div>
      </section>
    </div>`;
}

export async function renderPlayerDash(root, tab) {
  root.innerHTML = pageLoader();
  const me = await api.me().catch(() => ({ user: null }));
  if (!me.user) return void (root.innerHTML = wall(location.pathname));
  if (!TABS.includes(tab)) return void (root.innerHTML = notice('No such tab', 'That is not a page on your dashboard.'));

  root.innerHTML = `<section class="section"><div class="container"><div id="pbody">${pageLoader()}</div></div></section>`;
  const body = root.querySelector('#pbody');

  try {
    if (tab === '') await paintOverview(body);
    else if (tab === 'applications') await paintApplications(body);
    else if (tab === 'reports') await paintReports(body);
    else if (tab === 'appeals') await paintAppeals(body);
    else if (tab === 'account') await paintAccount(body, me);
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="empty">That could not be loaded. Try again in a moment.</div>`;
  }
}

// A dashboard with nothing in it should say why it is empty and what to do about
// it, not show a bare "0".
function nothing(what, cta) {
  return `<div class="board"><div class="empty">${esc(what)}${cta ? ` <a href="${cta.href}">${esc(cta.label)}</a>` : ''}</div></div>`;
}

// --- overview --------------------------------------------------------------

async function paintOverview(body) {
  const s = await api.my.summary();

  const tile = (n, label, href) =>
    `<a class="ptile entry" href="${href}"><span class="pt-n">${n}</span><span class="pt-l">${esc(label)}</span></a>`;

  body.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">${esc(s.discord.name)}</span>
        <h2>Your dashboard</h2>
      </div>
    </div>

    ${s.minecraft ? linkedCard(s.minecraft) : unlinkedCard()}

    <div class="ptiles">
      ${tile(s.counts.applications, s.counts.applications === 1 ? 'application' : 'applications', '/dashboard/applications')}
      ${tile(s.counts.reports, s.counts.reports === 1 ? 'report filed' : 'reports filed', '/dashboard/reports')}
      ${tile(s.counts.appeals, s.counts.appeals === 1 ? 'appeal' : 'appeals', '/dashboard/appeals')}
    </div>

    <div class="block">
      <div class="block-label">Do something</div>
      <div class="factions">
        <a class="btn" href="/apply">Apply for a rank</a>
        <a class="btn" href="/report">Report a player</a>
        <a class="btn" href="/appeal">Appeal a punishment</a>
      </div>
    </div>`;
}

function linkedCard(mc) {
  const rank = mc.ranks[0];
  return `
    <section class="panel entry">
      <div class="panel-head">
        <img class="you-head" src="${head(mc.uuid, 64)}" alt="" onerror="this.onerror=null;this.src='${head(null, 64)}'">
        <div>
          <h3>${esc(mc.name)}</h3>
          <div class="ph-sub">
            ${rank ? `<span style="color:${rank.color}">${esc(rank.name)}</span> · ` : ''}linked ${timeAgo(mc.linkedAt)}
          </div>
        </div>
        <div class="ph-right">
          <a class="btn" href="/player/${encodeURIComponent(mc.name)}">Your stats</a>
        </div>
      </div>
      ${
        mc.activePunishments
          ? `<div class="panel-body"><div class="pwarn">You have ${mc.activePunishments} active punishment${mc.activePunishments === 1 ? '' : 's'}. <a href="/dashboard/account">See them</a> or <a href="/appeal">appeal</a>.</div></div>`
          : ''
      }
    </section>`;
}

function unlinkedCard() {
  return `
    <section class="panel entry">
      <div class="soon-state">
        <div class="glyph">${icons.shield}</div>
        <div>
          <h4>No Minecraft account linked</h4>
          <p>Link one and this page can show your ranks, your punishments and your session history.</p>
        </div>
        <div style="margin-left:auto"><a class="btn btn-primary" href="/dashboard/account">Link it</a></div>
      </div>
    </section>`;
}

// --- applications ----------------------------------------------------------

// cancelled and timeout only ever came from the Discord bot's DM flow, which the
// website's form has no equivalent of — you cannot half-send this one. They are
// here because the old applications were imported, and a player looking at their
// own history should see the word that was true at the time.
const APP_STATUS = {
  pending: { label: 'Waiting on staff', cls: 'soon' },
  accepted: { label: 'Accepted', cls: 'live' },
  rejected: { label: 'Rejected', cls: 'dead' },
  cancelled: { label: 'You cancelled it', cls: '' },
  timeout: { label: 'Ran out of time', cls: '' },
};

async function paintApplications(body) {
  const list = await api.myApplications();
  body.innerHTML = `
    <div class="section-head">
      <div><h2>Your applications</h2><p>What you sent, and where it got to.</p></div>
      <a class="btn" href="/apply">New application</a>
    </div>
    ${
      list.length
        ? list.map(applicationCard).join('')
        : nothing('You have not applied for anything.', { href: '/apply', label: 'Apply for a rank' })
    }`;
}

function applicationCard(a) {
  const st = APP_STATUS[a.status] || { label: a.status, cls: 'soon' };
  return `
    <section class="panel entry">
      <div class="panel-head">
        <div class="glyph">${icons.staff}</div>
        <div>
          <h3>${esc(a.roleLabel)}</h3>
          <div class="ph-sub">sent ${timeAgo(a.submittedAt)}${a.reviewedAt ? ` · answered ${timeAgo(a.reviewedAt)}` : ''}</div>
        </div>
        <div class="ph-right"><span class="badge ${st.cls}">${esc(st.label)}</span></div>
      </div>
      ${
        a.note
          ? `<div class="panel-body"><div class="block"><div class="block-label">What staff said</div><p class="rule-text">${esc(a.note)}</p></div></div>`
          : ''
      }
    </section>`;
}

// --- reports ---------------------------------------------------------------

// The reporter is told what happened to their report, but never who ruled on it
// or what the punishment was: that is between the staff and the person punished.
const REPORT_OUTCOME = {
  punished: { label: 'Acted on', cls: 'live' },
  rejected: { label: 'No action taken', cls: 'dead' },
  duplicate: { label: 'Already known', cls: 'soon' },
};

async function paintReports(body) {
  const list = await api.my.reports();
  body.innerHTML = `
    <div class="section-head">
      <div><h2>Reports you filed</h2><p>Thanks for these. Staff read every one.</p></div>
      <a class="btn" href="/report">Report a player</a>
    </div>
    ${
      list.length
        ? list
            .map((r) => {
              const out = r.outcome ? REPORT_OUTCOME[r.outcome] : null;
              return `
      <section class="panel entry">
        <div class="panel-head">
          <div class="glyph">${icons.report}</div>
          <div>
            <h3>${esc(r.target.name)} — ${esc(r.categoryLabel)}</h3>
            <div class="ph-sub">${timeAgo(r.filedAt)}${r.resolvedAt ? ` · closed ${timeAgo(r.resolvedAt)}` : ''}</div>
          </div>
          <div class="ph-right">
            <span class="badge ${out ? out.cls : 'soon'}">${esc(out ? out.label : 'Open')}</span>
          </div>
        </div>
        <div class="panel-body"><p class="rule-text">${esc(r.detail)}</p></div>
      </section>`;
            })
            .join('')
        : nothing('You have not reported anyone.', { href: '/report', label: 'Report a player' })
    }`;
}

// --- appeals ---------------------------------------------------------------

const APPEAL_OUTCOME = {
  granted: { label: 'Granted', cls: 'live' },
  denied: { label: 'Denied', cls: 'dead' },
};

async function paintAppeals(body) {
  const list = await api.my.appeals();
  body.innerHTML = `
    <div class="section-head">
      <div><h2>Your appeals</h2><p>Punishments you have asked us to look at again.</p></div>
      <a class="btn" href="/appeal">New appeal</a>
    </div>
    ${
      list.length
        ? list
            .map((a) => {
              const out = a.outcome ? APPEAL_OUTCOME[a.outcome] : null;
              return `
      <section class="panel entry">
        <div class="panel-head">
          <div class="glyph">${icons.shield}</div>
          <div>
            <h3>${esc(a.punishmentId)} — ${esc(a.punishment?.type || 'punishment')}</h3>
            <div class="ph-sub">${timeAgo(a.filedAt)}${a.resolvedAt ? ` · answered ${timeAgo(a.resolvedAt)}` : ''}</div>
          </div>
          <div class="ph-right"><span class="badge ${out ? out.cls : 'soon'}">${esc(out ? out.label : 'Open')}</span></div>
        </div>
        <div class="panel-body">
          <p class="rule-text">${esc(a.reason)}</p>
          ${a.note ? `<div class="block"><div class="block-label">What staff said</div><p class="rule-text">${esc(a.note)}</p></div>` : ''}
        </div>
      </section>`;
            })
            .join('')
        : nothing('You have not appealed anything.', { href: '/appeal', label: 'Appeal a punishment' })
    }`;
}

// --- account ---------------------------------------------------------------

async function paintAccount(body, me) {
  const status = await api.linkStatus().catch(() => ({ linked: null }));

  body.innerHTML = `
    <div class="section-head">
      <div><h2>Your account</h2><p>The two halves of who you are here, and what the network has on file.</p></div>
    </div>
    <section class="panel entry">
      <div class="panel-body" id="linkbox">${status.linked ? linkedHalf(status.linked, me) : unlinkedHalf()}</div>
    </section>
    <div id="gamedata"></div>`;

  if (status.linked) wireUnlink(body, me);
  else wireCode(body);

  // The game's own records only exist for a linked account, and the two lists
  // are independent — one being down should not blank the other.
  const game = body.querySelector('#gamedata');
  if (!status.linked) return void (game.innerHTML = '');
  game.innerHTML = `<div id="punish">${pageLoader()}</div><div id="logins">${pageLoader()}</div>`;
  paintPunishments(game.querySelector('#punish'));
  paintLogins(game.querySelector('#logins'));
}

function linkedHalf(l, me) {
  return `
    <div class="soon-state">
      <img class="you-head" src="${head(l.uuid, 64)}" alt="" onerror="this.onerror=null;this.src='${head(null, 64)}'">
      <div>
        <h4>${esc(l.name)}</h4>
        <p>${l.rank ? `Playing as <span style="color:${l.rank.color}">${esc(l.rank.label)}</span>. ` : ''}Signed in as ${esc(me.user.discord.name)}.</p>
      </div>
      <div style="margin-left:auto"><button class="btn" id="unlink">Unlink</button></div>
    </div>
    <div class="block"><span class="fmsg" id="msg"></span></div>`;
}

function unlinkedHalf() {
  return `
    <p class="rule-text">Most Gravijet servers run in offline mode, so nothing out here can prove a Minecraft account is yours — only you can, from inside the game. Get a code, type it in game, done.</p>
    <div class="block">
      <div class="factions">
        <button class="btn btn-primary" id="get">Get a code</button>
        <span class="fmsg" id="msg"></span>
      </div>
      <div id="code"></div>
    </div>`;
}

function wireCode(body) {
  const msg = body.querySelector('#msg');
  const out = body.querySelector('#code');
  body.querySelector('#get').addEventListener('click', async (e) => {
    e.target.disabled = true;
    msg.className = 'fmsg';
    msg.textContent = 'Getting one…';
    try {
      const { code, ttlMs } = await api.linkCode();
      msg.textContent = '';
      out.innerHTML = `
        <div class="linkcode">
          <div class="lc-code">${esc(code)}</div>
          <ol class="lc-steps">
            <li>Join <b>example.invalid</b></li>
            <li>Type <b>/link ${esc(code)}</b></li>
            <li>Come back and reload this page</li>
          </ol>
          <div class="lc-ttl">Expires in ${Math.round(ttlMs / 60000)} minutes, and works once.</div>
        </div>`;
    } catch (err) {
      e.target.disabled = false;
      msg.className = 'fmsg bad';
      msg.textContent =
        err?.body?.error === 'not_installed'
          ? 'Linking is not switched on yet — the server plugin still needs installing.'
          : 'That did not work. Try again in a moment.';
    }
  });
}

function wireUnlink(body, me) {
  const msg = body.querySelector('#msg');
  body.querySelector('#unlink').addEventListener('click', async (e) => {
    e.target.disabled = true;
    msg.className = 'fmsg';
    msg.textContent = 'Unlinking…';
    try {
      await api.unlink();
      await paintAccount(body.closest('#pbody'), me);
    } catch {
      e.target.disabled = false;
      msg.className = 'fmsg bad';
      msg.textContent = 'That did not work.';
    }
  });
}

async function paintPunishments(box) {
  let data;
  try {
    data = await api.my.punishments();
  } catch {
    return void (box.innerHTML = '');
  }
  if (!data.punishments.length) {
    box.innerHTML = `
      <div class="block">
        <div class="block-label">Punishments</div>
        <div class="board"><div class="empty">A clean record. Keep it that way.</div></div>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="block">
      <div class="block-label">Punishments</div>
      <div class="board">
        ${data.punishments.map(punishmentRow).join('')}
      </div>
    </div>`;
}

// What each state means to the person it happened to, in their words.
const STATE = {
  live: { label: 'Active', cls: 'dead' },
  expired: { label: 'Expired', cls: '' },
  lifted: { label: 'Lifted', cls: '' },
  served: { label: 'Done', cls: '' },
};

function punishmentRow(p) {
  const st = STATE[p.state] || { label: p.state, cls: '' };
  const span = p.state === 'served' ? null : p.permanent ? 'permanent' : dur(p.duration);
  return `
    <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
      <div>
        <div class="dn">
          <span class="rt ${p.live ? 'hard' : ''}">${esc(p.type)}</span>
          ${esc(p.reason || 'no reason recorded')}
        </div>
        <div class="dr">
          ${esc(p.id)} · ${dateShort(p.issuedAt)}${span ? ` · ${span}` : ''}${p.removedReason ? ` · lifted: ${esc(p.removedReason)}` : ''}
        </div>
      </div>
      <div>
        <span class="badge ${st.cls}">${esc(st.label)}</span>
        ${p.appealable ? ' <a class="btn" href="/appeal">Appeal</a>' : ''}
      </div>
    </div>`;
}

async function paintLogins(box) {
  let data;
  try {
    data = await api.my.logins();
  } catch {
    return void (box.innerHTML = '');
  }
  if (!data.logins.length) {
    return void (box.innerHTML = `
      <div class="block">
        <div class="block-label">Recent sessions</div>
        <div class="board"><div class="empty">No sessions recorded yet.</div></div>
      </div>`);
  }

  box.innerHTML = `
    <div class="block">
      <div class="block-label">Recent sessions</div>
      <p class="rule-text">The last ${data.logins.length} times this account joined. If one of these was not you, unlink and tell staff.</p>
      <div class="board">
        <div class="board-head" style="grid-template-columns:1fr 1fr 1fr"><span>Joined</span><span>Left</span><span>Lasted</span></div>
        ${data.logins
          .map((l) => {
            const span = l.until ? l.until - l.at : null;
            return `
          <div class="board-row entry" style="grid-template-columns:1fr 1fr 1fr">
            <div class="dn">${dateShort(l.at)} <span class="dr">${timeAgo(l.at)}</span></div>
            <div class="dr">${l.until ? timeAgo(l.until) : 'still on'}</div>
            <div class="dr">${span == null ? '—' : dur(span)}</div>
          </div>`;
          })
          .join('')}
      </div>
    </div>`;
}
