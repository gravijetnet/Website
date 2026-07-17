// The three chromes.
//
// Gravijet is one app behind one session cookie, but it is not one place. The
// public site sells the network to a stranger; /dashboard is a player's own
// paperwork; spielplatz is a console for the people who rule on it. Wearing the
// same header on all three told the visitor nothing about which of them they
// were in, and put a "find player" box on a screen whose only subject is you.
//
// So each surface gets its own chrome, and they are lifted from three different
// screens of the game rather than being one header in three colours:
//
//   site    the HUD strip — brand, destinations, who's online, search.
//   player  the inventory: your head, your name, your tabs. No search: there is
//           nobody to find here but you.
//   staff   the console: no dirt, no marketing, a caution accent, and a standing
//           reminder that every button here is signed.
import { api } from './api.js';
import { esc, head } from './util.js';

// Same reason as sound.js: follow the versioned directory this module came from.
const LOGO = new URL('../img/logo.webp', import.meta.url).href;

// The vanity code `gravijet` is not registered — discord.gg/gravijet answers
// "Unknown Invite", so the footer link was dead. This is the invite the old
// landing page redirected to, and it resolves to "example.invalid - Minecraft
// server". Swap it back if the vanity URL is ever bought.
export const DISCORD = 'https://discord.gg/xyrNc8AAH6';

// example.invalid is the same app behind the same session; the host only
// decides which front door you came through. Everything under /dashboard checks
// the rank server-side regardless of where it is asked from.
export const IS_DASH_HOST = location.hostname.startsWith('spielplatz.');

const SITE = IS_DASH_HOST ? 'https://example.invalid' : '';
const CONSOLE_HOME = IS_DASH_HOST ? '' : 'https://example.invalid';

const NAV = [
  { href: '/', match: '/', label: 'Home' },
  { href: '/leaderboards', match: '/leaderboards', label: 'Leaderboards' },
  { href: '/players', match: '/players', label: 'Players' },
  { href: '/staff', match: '/staff', label: 'Staff' },
  { href: '/media', match: '/media', label: 'Media' },
  { href: '/rules', match: '/rules', label: 'Rules' },
];

// The player's own tabs. `need` is not a permission — everyone may see all of
// these — it is just what the tab is called in the URL.
export const PLAYER_TABS = [
  { key: '', label: 'Overview' },
  { key: 'applications', label: 'Applications' },
  { key: 'reports', label: 'Reports' },
  { key: 'appeals', label: 'Appeals' },
  { key: 'account', label: 'Account' },
];

// The console's tabs, each gated on an ability the server also enforces. Hiding
// a tab is a courtesy, not the check: /api refuses regardless of what is drawn.
export const STAFF_TABS = [
  { key: '', label: 'Queue', need: 'viewReports' },
  { key: 'applications', label: 'Applications', need: 'viewApplications' },
  { key: 'reports', label: 'Reports', need: 'viewReports' },
  { key: 'appeals', label: 'Appeals', need: 'viewAppeals' },
  { key: 'players', label: 'Players', need: 'hidePlayers' },
  { key: 'audit', label: 'Audit', need: 'viewReports' },
];

let current = null;

/**
 * Draws the chrome for a surface, and only when it changes: re-rendering the
 * header on every route would throw away the search box mid-keystroke and
 * restart the live poll.
 *
 * @param {'site'|'player'|'staff'} surface
 */
export function mountShell(surface) {
  if (current === surface) return false;
  current = surface;
  document.body.dataset.surface = surface;

  if (surface === 'site') siteChrome();
  else if (surface === 'player') playerChrome();
  else staffChrome();
  return true;
}

export function surfaceFor(path) {
  if (IS_DASH_HOST) return 'staff';
  return path.split('/')[1] === 'dashboard' ? 'player' : 'site';
}

// ------------------------------------------------------------------ the site

function siteChrome() {
  document.getElementById('nav').innerHTML = `
    <div class="hud-inner">
      <a class="brand" href="/">
        <img src="${LOGO}" alt="" onerror="this.style.display='none'">
        <span class="word">GRAVIJET <em>STATS</em></span>
      </a>
      <nav class="nav-links">
        ${NAV.map((n) => `<a href="${n.href}" data-match="${n.match}">${n.label}</a>`).join('')}
      </nav>
      <div class="nav-right">
        <div class="live-pill" id="live-pill"><span class="live-dot"></span><span id="live-text">checking</span></div>
        <div id="who"></div>
        <div class="search">
          <input class="search-input" id="q" type="text" placeholder="find player" autocomplete="off" spellcheck="false" aria-label="Find a player">
          <div class="search-results" id="qr"></div>
        </div>
      </div>
    </div>`;

  document.getElementById('footer').innerHTML = `
    <div class="container footer-inner">
      <div>
        <div class="brand">
          <img src="${LOGO}" alt="" onerror="this.style.display='none'">
          <span class="word">GRAVIJET <em>STATS</em></span>
        </div>
        <div class="f-copy">example.invalid</div>
      </div>
      <div class="f-links">
        <a href="/leaderboards">Leaderboards</a>
        <a href="/players">Players</a>
        <a href="/staff">Staff</a>
        <a href="/media">Media</a>
        <a href="/rules">Rules</a>
        <a href="/apply">Apply</a>
        <a href="/report">Report</a>
        <a href="/appeal">Appeal</a>
        <a href="/dashboard">Your dashboard</a>
        <a href="${DISCORD}" data-ext target="_blank" rel="noopener">Discord</a>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- the player

// Painted empty and filled once /me answers: the chrome must not wait on a round
// trip, and a header that arrives 200ms late is worse than one that fills in.
function playerChrome() {
  document.getElementById('nav').innerHTML = `
    <div class="hud-inner">
      <a class="brand brand-back" href="/">
        <img src="${LOGO}" alt="" onerror="this.style.display='none'">
        <span class="word">GRAVIJET</span>
      </a>
      <div class="you" id="you"></div>
      <nav class="nav-links" id="ptabs">
        ${PLAYER_TABS.map(
          (t) => `<a href="/dashboard${t.key ? `/${t.key}` : ''}" data-match="/dashboard/${t.key}">${t.label}</a>`,
        ).join('')}
      </nav>
      <div class="nav-right"><div id="who"></div></div>
    </div>`;

  document.getElementById('footer').innerHTML = `
    <div class="container footer-inner">
      <div class="f-copy">Your dashboard shows what you sent us and what came back.</div>
      <div class="f-links">
        <a href="/">Back to the site</a>
        <a href="/rules">Rules</a>
        <a href="${DISCORD}" data-ext target="_blank" rel="noopener">Discord</a>
      </div>
    </div>`;

  paintYou();
}

async function paintYou() {
  const box = document.getElementById('you');
  if (!box) return;
  const me = await api.me().catch(() => ({ user: null }));
  if (!box.isConnected) return;
  if (!me.user) return void (box.innerHTML = '');

  const mc = me.user.minecraft;
  box.innerHTML = mc
    ? `<img src="${head(mc.uuid, 40)}" alt="" onerror="this.onerror=null;this.src='${head(null, 40)}'">
       <div class="you-id">
         <span class="you-name">${esc(mc.name)}</span>
         <span class="you-rank" style="color:${mc.ranks[0]?.color || '#aaaaaa'}">${esc(mc.ranks[0]?.name || 'Member')}</span>
       </div>`
    : `<div class="you-id">
         <span class="you-name">${esc(me.user.discord.name)}</span>
         <a class="you-rank you-link" href="/dashboard/account">no Minecraft account linked</a>
       </div>`;
}

// ----------------------------------------------------------------- the staff

// No dirt and no logo. This is not somewhere you arrive by accident, and dressing
// it like the front page would invite reading it as one.
function staffChrome() {
  document.getElementById('nav').innerHTML = `
    <div class="hud-inner">
      <a class="console-mark" href="/">
        <span class="cm-name">SPIELPLATZ</span>
        <span class="cm-sub">staff console</span>
      </a>
      <nav class="nav-links" id="stabs"></nav>
      <div class="nav-right">
        <div id="who"></div>
      </div>
    </div>`;

  document.getElementById('footer').innerHTML = `
    <div class="container footer-inner">
      <div class="f-copy">Every decision here is recorded against your name — see Audit.</div>
      <div class="f-links">
        <a href="${SITE || 'https://example.invalid'}/" data-ext>example.invalid</a>
        <a href="${SITE || 'https://example.invalid'}/rules" data-ext>Rules</a>
      </div>
    </div>`;
}

/**
 * The console's tabs, drawn once the caller's abilities are known. Called by the
 * dashboard rather than the shell because the shell must not block on /me.
 */
export function paintStaffTabs(can = {}) {
  const box = document.getElementById('stabs');
  if (!box) return;
  box.innerHTML = STAFF_TABS.filter((t) => can[t.need])
    .map((t) => `<a href="/${t.key}" data-match="/${t.key}">${esc(t.label)}</a>`)
    .join('');
  markActive(location.pathname);
}

// ------------------------------------------------------------------- shared

export function markActive(path) {
  const seg = path.split('/').filter(Boolean);
  // On the console the tabs are the root, on the site they are the first
  // segment, and on the player dashboard they are the second.
  let base;
  if (current === 'staff') base = `/${seg[0] || ''}`;
  else if (current === 'player') base = `/dashboard/${seg[1] || ''}`;
  else base = `/${seg[0] || ''}`;

  document.querySelectorAll('.nav-links a').forEach((a) => {
    const m = a.dataset.match;
    a.classList.toggle(
      'active',
      m === base || (current === 'site' && base === '/player' && m === '/players'),
    );
  });
}

// Painted after the chrome rather than inside it, for the same reason as the
// player strip: the shell must not wait on a round trip.
export async function paintWho() {
  const box = document.getElementById('who');
  if (!box) return;
  let me;
  try {
    me = await api.me();
  } catch {
    return; // signed-out is the safe assumption, and the button below says so
  }
  if (!box.isConnected) return;

  if (!me.user) {
    box.innerHTML = me.loginConfigured
      ? `<a class="btn who-btn" href="${SITE}/auth/discord?return=${encodeURIComponent(location.pathname)}" data-ext>Sign in</a>`
      : '';
    return;
  }

  const u = me.user;
  // Each chrome offers the door to the other two, and never to itself.
  const doors = [];
  if (current !== 'player') doors.push(`<a class="wd" href="${SITE}/dashboard" ${SITE ? 'data-ext' : ''}>You</a>`);
  if (current !== 'staff' && u.staff) {
    doors.push(`<a class="wd" href="${CONSOLE_HOME}/" ${CONSOLE_HOME ? 'data-ext' : ''}>Console</a>`);
  }

  box.innerHTML = `
    <div class="who">
      ${u.discord.avatar ? `<img src="${u.discord.avatar}" alt="" width="20" height="20">` : ''}
      <span class="wn">${esc(u.discord.name)}</span>
      ${current === 'staff' && u.ranks.length ? `<span class="wt">${esc(u.ranks[0])}</span>` : ''}
      ${doors.join('')}
      <button class="wo" id="logout" title="Sign out">×</button>
    </div>`;

  const out = document.getElementById('logout');
  if (out) {
    out.addEventListener('click', async () => {
      await api.logout().catch(() => {});
      location.reload();
    });
  }
}

// ------------------------------------------------------- live status pill

export async function pollLive() {
  const pill = document.getElementById('live-pill');
  const text = document.getElementById('live-text');
  if (!pill || !text) return; // only the site chrome carries one
  try {
    const net = await api.network();
    const on = net.online > 0;
    pill.classList.toggle('on', on);
    // "idle" described the server's mood rather than answering the question the
    // pill is there to answer. Say the number, including when it is zero.
    //
    // The unit is its own element so the strip can drop it when it runs short of
    // room: "3 online" loses nothing, and CSS cannot rewrite text.
    text.innerHTML = `${net.online}<span class="lp-word"> ${net.online === 1 ? 'player' : 'players'}</span> online`;
  } catch {
    pill.classList.remove('on');
    text.textContent = 'network unreachable';
  }
}
