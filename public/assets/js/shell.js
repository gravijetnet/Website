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
//
// One rule holds across all three: the brand, top left, always goes home to
// example.invalid. It is the one thing on the page that means the same everywhere,
// and it is how you get out of a dashboard.
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

// The player's own tabs. Everyone signed in may see all of these.
//
// Apply, report and appeal are not tabs of their own: they are things you do
// *to* a list you are already looking at, so each lives as an action on the tab
// that will show you the result. A separate "Apply" destination would be a
// fourth place to check for an answer that arrives in Applications.
export const PLAYER_TABS = [
  { key: '', label: 'Overview' },
  { key: 'applications', label: 'Applications' },
  { key: 'reports', label: 'Reports' },
  { key: 'appeals', label: 'Appeals' },
  { key: 'account', label: 'Account' },
];

// Sub-pages that belong to a tab. /dashboard/apply is the Applications tab with
// a form on it, so Applications is what should light up.
const PLAYER_TAB_OF = {
  apply: 'applications',
  report: 'reports',
  appeal: 'appeals',
};

// What pages exist and who may open them — the routing and permission table.
// Hiding a page is a courtesy, not the check: /api refuses regardless of what is
// drawn. The *navigation* is CONSOLE_NAV below, drawn down the side of the page;
// the two are separate because "what is this called in a menu" and "may they
// open it" are different questions with different answers.
export const STAFF_TABS = [
  { key: '', label: 'Queue', need: 'viewReports' },
  { key: 'applications', label: 'Applications', need: 'viewApplications' },
  { key: 'reports', label: 'Reports', need: 'viewReports' },
  { key: 'appeals', label: 'Appeals', need: 'viewAppeals' },
  { key: 'players', label: 'Players', need: 'viewPlayers' },
  { key: 'users', label: 'Users', need: 'viewPlayers' },
  { key: 'live', label: 'Live', need: 'viewReports' },
  { key: 'logs', label: 'Logs', need: 'viewReports' },
  { key: 'punishments', label: 'Punishments', need: 'viewPlayers' },
  { key: 'activity', label: 'Team activity', need: 'viewReports' },
  { key: 'rules', label: 'Rules', need: 'manageRules' },
  // A hub, not a page — see NETWORK_PAGES. Shown to anybody who can reach at
  // least one thing inside it.
  { key: 'network', label: 'Network', anyOf: ['manageNetwork', 'broadcast', 'viewReports'] },
  { key: 'access', label: 'Access', need: 'manageAccess' },
  { key: 'audit', label: 'Audit', need: 'viewReports' },
];

// The console's navigation, in full and in order.
//
// It went through a strip of eleven tabs (unreadable), then five (a compromise
// that hid the other six). The answer was neither: a console with twenty
// destinations wants a list down the side, grouped by what you came to do, and a
// header carrying nothing at all. Every page is here, every page is one click,
// and the strip along the top is gone.
//
// Order is by frequency of use, not by permission: the queue, then the things
// waiting on a human, then people, then the network, then the record.
export const CONSOLE_NAV = [
  { group: '', items: [{ path: '/', label: 'Queue', need: 'viewReports' }] },
  {
    group: 'Waiting on you',
    items: [
      { path: '/applications', label: 'Applications', need: 'viewApplications' },
      { path: '/reports', label: 'Reports', need: 'viewReports' },
      { path: '/appeals', label: 'Appeals', need: 'viewAppeals' },
    ],
  },
  {
    group: 'People',
    items: [
      { path: '/players', label: 'Players', need: 'viewPlayers' },
      { path: '/users', label: 'Users', need: 'viewPlayers' },
    ],
  },
  {
    group: 'The network',
    items: [
      { path: '/live', label: 'Live', need: 'viewReports' },
      { path: '/network/servers', label: 'Servers', need: 'viewReports' },
      { path: '/network/host', label: 'Host', need: 'manageNetwork' },
      { path: '/network/broadcast', label: 'Broadcast', need: 'broadcast' },
      { path: '/network/discord', label: 'Discord', need: 'broadcast' },
      { path: '/network/ranks', label: 'Ranks', need: 'manageNetwork' },
      { path: '/network/ladders', label: 'Ladders', need: 'manageNetwork' },
      { path: '/network/filters', label: 'Chat filters', need: 'manageNetwork' },
      { path: '/network/reportmenu', label: 'Report menu', need: 'manageNetwork' },
      { path: '/network/tags', label: 'Tags', need: 'manageNetwork' },
    ],
  },
  {
    group: 'The record',
    items: [
      { path: '/punishments', label: 'Punishments', need: 'viewPlayers' },
      { path: '/logs', label: 'Logs', need: 'viewReports' },
      { path: '/activity', label: 'Team activity', need: 'viewReports' },
      { path: '/audit', label: 'Audit', need: 'viewReports' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { path: '/rules', label: 'Rules', need: 'manageRules' },
      { path: '/access', label: 'Access', need: 'manageAccess' },
      { path: '/network/backups', label: 'Backups', need: 'manageNetwork' },
    ],
  },
];

// Everything that edits the network's own configuration lives under the Network
// tab. As tabs these were eleven entries in a strip nobody could scan; as one
// destination with its own row of pages they are a place you go, and then choose
// what you are changing.
export const NETWORK_PAGES = [
  // The overview comes first, and is open to anyone who can read a report — what
  // the network is doing right now is not privileged information among staff.
  { key: 'servers', label: 'Servers', need: 'viewReports' },
  { key: 'host', label: 'Host', need: 'manageNetwork' },
  { key: 'ranks', label: 'Ranks', need: 'manageNetwork' },
  { key: 'ladders', label: 'Ladders', need: 'manageNetwork' },
  { key: 'reportmenu', label: 'Report menu', need: 'manageNetwork' },
  { key: 'filters', label: 'Chat filters', need: 'manageNetwork' },
  { key: 'tags', label: 'Tags', need: 'manageNetwork' },
  { key: 'broadcast', label: 'Broadcast', need: 'broadcast' },
  { key: 'discord', label: 'Discord', need: 'broadcast' },
  { key: 'backups', label: 'Backups', need: 'manageNetwork' },
];

/** Whether a tab is reachable — a hub needs any one of its pages, a page its own. */
export function tabAllowed(tab, can) {
  return tab.anyOf ? tab.anyOf.some((n) => can[n]) : !!can[tab.need];
}

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
  // Two tiers, not one crowded row. The top tier is only ever the two things the
  // header is *about* — the mark that means "home" and the account that means
  // "you". Everything you might go *do* — the six destinations, the search, the
  // live count — drops to a navigation tier beneath it. The old strip made the
  // brand, six links, a player count, a search field and the account fight over
  // one 56px line; splitting the identity from the going-somewhere is what stops
  // the fight, and it keeps every destination one visible button away on every
  // page rather than hidden behind a menu.
  document.getElementById('nav').innerHTML = `
    <div class="hud-inner">
      <a class="brand" href="/">
        <img src="${LOGO}" alt="" onerror="this.style.display='none'">
        <span class="word">GRAVIJET <em>STATS</em></span>
      </a>
      <div class="nav-right"><div id="who"></div></div>
    </div>
    <div class="subnav-inner">
      <nav class="nav-links">
        ${NAV.map((n) => `<a href="${n.href}" data-match="${n.match}">${n.label}</a>`).join('')}
      </nav>
      <div class="subnav-right">
        <div class="live-pill" id="live-pill"><span class="live-dot"></span><span id="live-text">checking</span></div>
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
        <a href="/dashboard/applications">Apply</a>
        <a href="/dashboard/reports">Report a player</a>
        <a href="/dashboard/appeals">Appeal</a>
        <a href="/dashboard">Your dashboard</a>
        <a href="${DISCORD}" data-ext target="_blank" rel="noopener">Discord</a>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- the player

// Painted empty and filled once /me answers: the chrome must not wait on a round
// trip, and a header that arrives 200ms late is worse than one that fills in.
function playerChrome() {
  // Same two-tier shape as the site: the mark and you on top, your tabs beneath.
  document.getElementById('nav').innerHTML = `
    <div class="hud-inner">
      <a class="brand brand-back" href="/" title="Back to example.invalid">
        <img src="${LOGO}" alt="" onerror="this.style.display='none'">
        <span class="word">GRAVIJET</span>
      </a>
      <div class="nav-right"><div id="who"></div></div>
    </div>
    <div class="subnav-inner">
      <nav class="nav-links" id="ptabs">
        ${PLAYER_TABS.map(
          (t) => `<a href="/dashboard${t.key ? `/${t.key}` : ''}" data-match="/dashboard/${t.key}">${t.label}</a>`,
        ).join('')}
      </nav>
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
}

// ----------------------------------------------------------------- the staff

// No dirt and no logo-as-marketing. This is not somewhere you arrive by
// accident, and dressing it like the front page would invite reading it as one.
// The mark still goes to example.invalid, because that is what a mark in that
// corner does — a console you cannot leave by the obvious door is a trap.
function staffChrome() {
  // Nothing but the mark and you. The console's twenty destinations live in a
  // list down the side of the page (CONSOLE_NAV), where they can be grouped and
  // read; no arrangement of them along the top survived contact with the number.
  document.getElementById('nav').innerHTML = `
    <div class="hud-inner">
      <a class="console-mark" href="${SITE || 'https://example.invalid'}/" ${SITE ? 'data-ext' : ''} title="Back to example.invalid">
        <span class="cm-name">SPIELPLATZ</span>
        <span class="cm-sub">staff dashboard</span>
      </a>
      <div class="nav-right"><div id="who"></div></div>
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

// (The console used to paint a strip of tabs here. It carries none: see
// CONSOLE_NAV and the list dash-staff draws down the side of the page.)

// ------------------------------------------------------------------- shared

export function markActive(path) {
  const seg = path.split('/').filter(Boolean);
  // On the console the tabs are the root, on the site they are the first
  // segment, and on the player dashboard they are the second.
  let base;
  if (current === 'staff') base = `/${seg[0] || ''}`;
  else if (current === 'player') base = `/dashboard/${PLAYER_TAB_OF[seg[1]] || seg[1] || ''}`;
  else base = `/${seg[0] || ''}`;

  document.querySelectorAll('.nav-links a').forEach((a) => {
    const m = a.dataset.match;
    a.classList.toggle(
      'active',
      m === base || (current === 'site' && base === '/player' && m === '/players'),
    );
  });
}

// --------------------------------------------------------------- the account

// Everything about the signed-in person lives behind one avatar.
//
// It used to sit open in the strip: avatar, name, "You", "Console", and a close
// button — five things, none of which are read twice, all competing with six
// destinations and a search field for a row that was already full. Signed out
// the header fit; signed in it ran over itself, which is exactly what it looked
// like. The game does not solve this by shrinking the font: it puts the things
// you rarely press behind a button and leaves the row to the things you do.
function accountMenu(u) {
  const doors = [];
  if (current !== 'player') {
    // "You" was the label, and it named nothing — it is the only word in the
    // header that told you neither where you were going nor what was there.
    doors.push(`<a class="am-item" href="${SITE}/dashboard" ${SITE ? 'data-ext' : ''}>Dashboard</a>`);
  }
  if (current !== 'staff' && u.staff) {
    doors.push(`<a class="am-item" href="${CONSOLE_HOME}/" ${CONSOLE_HOME ? 'data-ext' : ''}>Spielplatz</a>`);
  }
  if (current !== 'site') doors.push(`<a class="am-item" href="${SITE || ''}/" ${SITE ? 'data-ext' : ''}>example.invalid</a>`);

  const avatar = u.discord.avatar
    ? `<img src="${u.discord.avatar}" alt="" width="24" height="24">`
    : `<span class="am-blank"></span>`;

  return `
    <div class="acct">
      <button class="acct-btn" id="acct-btn" aria-haspopup="menu" aria-expanded="false" title="${esc(u.discord.name)}">
        ${avatar}<span class="acct-caret">▾</span>
      </button>
      <div class="acct-menu" id="acct-menu" role="menu" hidden>
        <div class="am-head">
          <span class="am-name">${esc(u.discord.name)}</span>
          ${u.ranks.length ? `<span class="am-rank">${esc(u.ranks[0])}</span>` : '<span class="am-rank am-none">Member</span>'}
        </div>
        ${doors.join('')}
        <button class="am-item am-out" id="logout">Sign out</button>
      </div>
    </div>`;
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

  box.innerHTML = accountMenu(me.user);
  wireAccount();
}

function wireAccount() {
  const btn = document.getElementById('acct-btn');
  const menu = document.getElementById('acct-menu');
  if (!btn || !menu) return;

  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  const toggle = () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  // Anywhere else, and Escape. A menu that only closes by pressing the same
  // button again is a menu you end up fighting.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.acct')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

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
