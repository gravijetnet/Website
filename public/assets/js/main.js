// App shell entry: picks the chrome for the surface, then routes.
//
// The chrome itself lives in shell.js — the three surfaces (site, player,
// staff) do not share a header, so choosing one is a routing decision.
import { navigate, startRouter } from './nav.js';
import { sound } from './sound.js';
import { esc, head } from './util.js';
import { api } from './api.js';
import { mountShell, surfaceFor, markActive, paintWho, pollLive, IS_DASH_HOST } from './shell.js';
import { initPalette } from './palette.js';

// The three surfaces are three separate JS graphs, and a visitor only ever needs
// one: the public site never opens the console, the console never draws a
// leaderboard. Loaded up front, they were one graph — main pulled dash-staff and
// everything under it (dash-network, dash-panel, dash-live, the lot), so a
// stranger landing on example.invalid downloaded the entire staff dashboard, some
// 340 KB of JavaScript, before the home page could paint. Nobody but staff will
// ever leave that home page for the console.
//
// So each surface's renderer is imported the moment it is first needed and not
// before. The browser caches the module, so this is one request per surface per
// load — and warm() below fires it during boot so even that request overlaps the
// first paint rather than opening a fresh waterfall after main.js lands.
//
// Relative specifiers resolve against this module's own URL, which is served from
// the content-hashed /assets-<ver>/ directory — so the split chunks stay
// versioned exactly like the static graph did, with no change to the server.

// Filing something is dashboard work, not site work.
//
// Apply, report and appeal used to be public pages that happened to demand a
// login. That put the act of sending something in one place and every trace of
// having sent it in another: you applied at /apply and then went looking for the
// answer at /dashboard, and the page you filed on could not tell you that you
// had already filed. Worse, submitting dropped you back onto the marketing site
// — out of the dashboard, by accident, at exactly the moment you had reason to
// stay in it.
//
// So they moved next to their own outcomes, and these keep the old addresses
// working. A bookmark, a Discord message from last year and the footer all still
// land somewhere sensible rather than on a 404.
const MOVED = {
  '/apply': '/dashboard/applications',
  '/report': '/dashboard/report',
  '/appeal': '/dashboard/appeal',
  '/link': '/dashboard/account',
};

// The console's config editors moved under one Network hub rather than sitting
// as eleven entries in the tab strip. Their old addresses still resolve, so a
// bookmark or a link somebody sent last week lands where the page went.
const STAFF_MOVED = new Set(['ranks', 'ladders', 'reportmenu', 'filters', 'tags', 'broadcast', 'backups']);

const app = document.getElementById('app');

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

// --------------------------------------------------------------- search
// Wired to the document rather than to the input: the site chrome is mounted and
// torn down as you move between surfaces, so binding the element itself would
// leave the listeners on a node nobody can see any more.

function wireSearch() {
  let timer = null;
  let items = [];
  let sel = -1;

  const els = () => ({ input: document.getElementById('q'), out: document.getElementById('qr') });
  const close = () => {
    const { out } = els();
    if (out) out.innerHTML = '';
    items = [];
    sel = -1;
  };

  const paint = () => {
    const { out } = els();
    if (!out) return;
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

  document.addEventListener('input', (e) => {
    if (e.target.id !== 'q') return;
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (!q) return close();
    timer = setTimeout(async () => {
      try {
        items = await api.search(q);
        sel = -1;
        paint();
      } catch { close(); }
    }, 140);
  });

  document.addEventListener('keydown', (e) => {
    const { input } = els();
    if (!input) return;

    // "/" focuses search from anywhere.
    if (e.key === '/' && document.activeElement !== input && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      return input.focus();
    }
    if (e.target !== input) return;

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
  document.addEventListener('click', (e) => {
    if (e.target.closest('#qr')) {
      const { input } = els();
      if (input) input.value = '';
      return close();
    }
    if (!e.target.closest('.search')) close();
  });
}

// ---------------------------------------------------------------- routes

function setTitle(t) {
  document.title = t ? `${t} · Gravijet` : 'Gravijet — Practice network statistics';
}

async function route(path, params) {
  // Before the chrome is chosen: a redirect must not flash the site header on
  // its way to a dashboard page.
  const moved = MOVED[path.replace(/\/$/, '')];
  if (moved && !IS_DASH_HOST) return void navigate(moved, { replace: true });
  // /apply/helper keeps its role, it just files it from indoors now.
  if (!IS_DASH_HOST && path.startsWith('/apply/')) {
    return void navigate(`/dashboard${path}`, { replace: true });
  }

  if (IS_DASH_HOST) {
    const first = path.split('/').filter(Boolean)[0];
    if (STAFF_MOVED.has(first)) return void navigate(`/network/${first}`, { replace: true });
  }

  const surface = surfaceFor(path);
  // A fresh chrome has a fresh #who and a fresh pill, so both are repainted.
  if (mountShell(surface)) {
    paintWho();
    pollLive();
  }
  markActive(path);

  const seg = path.split('/').filter(Boolean);

  try {
    // The console has one job, so its root is the dashboard rather than a copy
    // of the public home page, and every path under it is a console tab.
    if (surface === 'staff') {
      setTitle('Spielplatz');
      const { renderStaffDash } = await import('./dash-staff.js');
      return await renderStaffDash(app, seg[0] || '', seg[1] || '');
    }
    if (seg[0] === 'dashboard') {
      setTitle('Your dashboard');
      const { renderPlayerDash } = await import('./dash-player.js');
      return await renderPlayerDash(app, seg[1] || '', seg[2] || null);
    }

    // Everything from here is the public site, and it all lives in one views
    // module — loaded once, on the first public route this browser visits.
    const views = await import('./views.js');
    if (seg.length === 0) {
      setTitle('');
      return await views.renderHome(app);
    }
    if (seg[0] === 'leaderboards') {
      setTitle('Leaderboards');
      return await views.renderLeaderboards(app, seg[1] || 'practice', params);
    }
    if (seg[0] === 'player' && seg[1]) {
      const name = decodeURIComponent(seg[1]);
      setTitle(name);
      return await views.renderPlayer(app, name);
    }
    if (seg[0] === 'players') {
      setTitle('Players');
      return await views.renderPlayers(app);
    }
    if (seg[0] === 'staff') {
      setTitle('Staff');
      return await views.renderStaff(app);
    }
    if (seg[0] === 'media') {
      setTitle('Media');
      return await views.renderMedia(app);
    }
    if (seg[0] === 'rules') {
      setTitle('Rules');
      return await views.renderRules(app);
    }
    setTitle('Not found');
    app.innerHTML = `<div class="container"><div class="notice"><h2>404 — no such route</h2><p>That page doesn't exist. <a href="/">Head back home</a>.</p></div></div>`;
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="container"><div class="notice"><h2>Something broke</h2><p>This page failed to load. Try again in a moment.</p></div></div>`;
  }
}

wireSound();
wireSearch();
initPalette();

// Warm the one graph this first page will actually need, in parallel with the
// rest of boot, so route()'s dynamic import below resolves from cache rather than
// opening a second waterfall once main.js has finished. The browser dedupes this
// against the awaited import, so it is fetched once, not twice.
(function warm() {
  const first = location.pathname.split('/').filter(Boolean)[0];
  if (IS_DASH_HOST) import('./dash-staff.js');
  else if (first === 'dashboard') import('./dash-player.js');
  else import('./views.js');
})();

startRouter(route);
// Only the site chrome carries a pill; pollLive returns immediately elsewhere.
setInterval(pollLive, 30000);
