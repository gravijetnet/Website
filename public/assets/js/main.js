// App shell entry: picks the chrome for the surface, then routes.
//
// The chrome itself lives in shell.js — the three surfaces (site, player,
// staff) do not share a header, so choosing one is a routing decision.
import { navigate, startRouter } from './nav.js';
import { sound } from './sound.js';
import { esc, head } from './util.js';
import { api } from './api.js';
import { mountShell, surfaceFor, markActive, paintWho, pollLive, IS_DASH_HOST } from './shell.js';
import {
  renderHome, renderLeaderboards, renderPlayer, renderPlayers,
  renderStaff, renderMedia, renderRules,
} from './views.js';
import { renderApply, renderReport, renderAppeal } from './forms.js';
import { renderPlayerDash } from './dash-player.js';
import { renderStaffDash } from './dash-staff.js';

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
      setTitle('Staff console');
      return await renderStaffDash(app, seg[0] || '');
    }
    if (seg[0] === 'dashboard') {
      setTitle('Your dashboard');
      return await renderPlayerDash(app, seg[1] || '');
    }
    if (seg.length === 0) {
      setTitle('');
      return await renderHome(app);
    }
    if (seg[0] === 'leaderboards') {
      setTitle('Leaderboards');
      return await renderLeaderboards(app, seg[1] || 'practice', params);
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
    setTitle('Not found');
    app.innerHTML = `<div class="container"><div class="notice"><h2>404 — no such route</h2><p>That page doesn't exist. <a href="/">Head back home</a>.</p></div></div>`;
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="container"><div class="notice"><h2>Something broke</h2><p>This page failed to load. Try again in a moment.</p></div></div>`;
  }
}

wireSound();
wireSearch();
startRouter(route);
// Only the site chrome carries a pill; pollLive returns immediately elsewhere.
setInterval(pollLive, 30000);
