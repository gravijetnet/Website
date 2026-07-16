// App shell: persistent nav (brand, links, live pill, search) + the route table.
import { api } from './api.js';

// Same reason as sound.js: follow the versioned directory this module came from.
const LOGO = new URL('../img/logo.webp', import.meta.url).href;

// The vanity code `gravijet` is not registered — discord.gg/gravijet answers
// "Unknown Invite", so the footer link was dead. This is the invite the old
// landing page redirected to, and it resolves to "example.invalid - Minecraft
// server". Swap it back if the vanity URL is ever bought.
const DISCORD = 'https://discord.gg/xyrNc8AAH6';
import { navigate, startRouter } from './nav.js';
import { sound } from './sound.js';
import { esc, head } from './util.js';
import {
  renderHome, renderLeaderboards, renderPlayer, renderPlayers,
  renderStaff, renderMedia, renderRules,
} from './views.js';
import { renderApply, renderReport, renderAppeal } from './forms.js';
import { renderDashboard } from './dash.js';

// example.invalid is the same app behind the same session; the host only
// decides which front door you came through. Everything under /dashboard checks
// the rank server-side regardless of where it is asked from.
const IS_DASH_HOST = location.hostname.startsWith('spielplatz.');

const app = document.getElementById('app');

// ------------------------------------------------------------------- shell

function shell() {
  document.getElementById('nav').innerHTML = `
    <div class="container nav-inner">
      <a class="brand" href="/">
        <img src="${LOGO}" alt="" onerror="this.style.display='none'">
        <span class="word">GRAVIJET <em>STATS</em></span>
      </a>
      <nav class="nav-links">
        <a href="/" data-match="/">Home</a>
        <a href="/leaderboards" data-match="/leaderboards">LB</a>
        <a href="/players" data-match="/players">Players</a>
        <a href="/staff" data-match="/staff">Staff</a>
        <a href="/media" data-match="/media">Media</a>
        <a href="/rules" data-match="/rules">Rules</a>
      </nav>
      <div class="nav-right">
        <div class="live-pill" id="live-pill"><span class="live-dot"></span><span id="live-text">--</span></div>
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
        <a href="${DISCORD}" data-ext target="_blank" rel="noopener">Discord</a>
      </div>
    </div>`;
}

function markActive(path) {
  const base = '/' + (path.split('/')[1] || '');
  document.querySelectorAll('.nav-links a').forEach((a) => {
    a.classList.toggle('active', a.dataset.match === base || (base === '/player' && a.dataset.match === '/players'));
  });
}

// --------------------------------------------------------------- sound
// The game plays its click when you push a button down, not when you let go, so
// this hooks pointerdown — waiting for the release reads as lag.

function wireSound() {
  // One sound for everything, like the game. The dead "Clutches (soon)" tab is a
  // <span>, so it never matches and never sounds — which is the point.
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('a[href], button');
    if (el && !el.disabled) sound.click();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = document.activeElement;
    if (el && el.matches && el.matches('a[href], button') && !el.disabled) sound.click();
  });
}

// ------------------------------------------------------------------- who

// Painted after the shell rather than inside it: the shell must not wait on a
// round trip, and a nav that renders 200ms late is worse than one that fills in.
async function paintWho() {
  const box = document.getElementById('who');
  if (!box) return;
  let me;
  try {
    me = await api.me();
  } catch {
    return; // signed-out is the safe assumption, and the button below says so
  }
  if (!me.user) {
    box.innerHTML = me.loginConfigured
      ? `<a class="btn who-btn" href="/auth/discord?return=${encodeURIComponent(location.pathname)}" data-ext>Sign in</a>`
      : '';
    return;
  }
  const u = me.user;
  box.innerHTML = `
    <div class="who">
      ${u.discord.avatar ? `<img src="${u.discord.avatar}" alt="" width="20" height="20">` : ''}
      <span class="wn">${esc(u.discord.name)}</span>
      ${u.staff ? `<a class="wd" href="${IS_DASH_HOST ? '/' : 'https://example.invalid/'}" ${IS_DASH_HOST ? '' : 'data-ext'}>Dashboard</a>` : ''}
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

async function pollLive() {
  try {
    const net = await api.network();
    const pill = document.getElementById('live-pill');
    const text = document.getElementById('live-text');
    if (!pill || !text) return;
    const on = net.online > 0;
    pill.classList.toggle('on', on);
    text.textContent = on ? `${String(net.online).padStart(2, '0')} online` : 'idle';
  } catch {
    const text = document.getElementById('live-text');
    if (text) text.textContent = 'offline';
  }
}

// --------------------------------------------------------------- search

function wireSearch() {
  const input = document.getElementById('q');
  const out = document.getElementById('qr');
  let timer = null;
  let items = [];
  let sel = -1;

  const close = () => { out.innerHTML = ''; items = []; sel = -1; };

  const paint = () => {
    out.innerHTML = items
      .map(
        (p, i) => `
        <a class="search-row ${i === sel ? 'sel' : ''}" href="/player/${encodeURIComponent(p.name)}">
          <img src="${head(p.uuid, 52)}" alt="" onerror="this.onerror=null;this.src='${head(null, 52)}'">
          <span class="nm">${esc(p.name)}</span>
          <span class="rk" style="color:${p.rank.color}">${esc(p.rank.label)}</span>
        </a>`,
      )
      .join('');
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) return close();
    timer = setTimeout(async () => {
      try {
        items = await api.search(q);
        sel = -1;
        paint();
      } catch { close(); }
    }, 140);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.blur(); return close(); }
    if (!items.length) {
      // Enter with no suggestions still jumps straight to the typed name.
      if (e.key === 'Enter' && input.value.trim()) {
        navigate(`/player/${encodeURIComponent(input.value.trim())}`);
        input.value = '';
        input.blur();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; paint(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = items[sel >= 0 ? sel : 0];
      navigate(`/player/${encodeURIComponent(pick.name)}`);
      input.value = '';
      input.blur();
      close();
    }
  });

  // Clicking a suggestion is handled by the router's link interception; just tidy up.
  out.addEventListener('click', () => { input.value = ''; close(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) close(); });

  // "/" focuses search from anywhere.
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
}

// ---------------------------------------------------------------- routes

function setTitle(t) {
  document.title = t ? `${t} · Gravijet` : 'Gravijet — Practice network statistics';
}

async function route(path, params) {
  markActive(path);
  const seg = path.split('/').filter(Boolean);

  try {
    if (seg.length === 0) {
      // The dashboard host has one job, so its root is the dashboard rather than
      // a copy of the public home page.
      if (IS_DASH_HOST) {
        setTitle('Dashboard');
        return await renderDashboard(app, null);
      }
      setTitle('');
      return await renderHome(app);
    }
    if (seg[0] === 'leaderboards') {
      const mode = seg[1] || 'practice';
      setTitle('Leaderboards');
      return await renderLeaderboards(app, mode, params);
    }
    if (seg[0] === 'player' && seg[1]) {
      const name = decodeURIComponent(seg[1]);
      setTitle(name);
      return await renderPlayer(app, name);
    }
    if (seg[0] === 'players') {
      setTitle('Players');
      return await renderPlayers(app);
    }
    if (seg[0] === 'staff') {
      setTitle('Staff');
      return await renderStaff(app);
    }
    if (seg[0] === 'media') {
      setTitle('Media');
      return await renderMedia(app);
    }
    if (seg[0] === 'rules') {
      setTitle('Rules');
      return await renderRules(app);
    }
    if (seg[0] === 'apply') {
      setTitle('Apply');
      return await renderApply(app, seg[1] || null);
    }
    if (seg[0] === 'report') {
      setTitle('Report a player');
      return await renderReport(app);
    }
    if (seg[0] === 'appeal') {
      setTitle('Appeal');
      return await renderAppeal(app);
    }
    if (seg[0] === 'dashboard') {
      setTitle('Dashboard');
      return await renderDashboard(app, seg[1] || null);
    }
    setTitle('Not found');
    app.innerHTML = `<div class="container"><div class="notice"><h2>404 — no such route</h2><p>That page doesn't exist. <a href="/">Head back home</a>.</p></div></div>`;
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="container"><div class="notice"><h2>Something broke</h2><p>This page failed to load. Try again in a moment.</p></div></div>`;
  }
}

shell();
wireSound();
wireSearch();
startRouter(route);
paintWho();
pollLive();
setInterval(pollLive, 30000);
