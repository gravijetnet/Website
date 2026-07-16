// App shell: persistent nav (brand, links, live pill, search) + the route table.
import { api } from './api.js';
import { icons } from './icons.js';
import { navigate, startRouter } from './nav.js';
import { sound } from './sound.js';
import { esc, head } from './util.js';
import { renderHome, renderLeaderboards, renderPlayer, renderPlayers } from './views.js';

const app = document.getElementById('app');

// ------------------------------------------------------------------- shell

function shell() {
  document.getElementById('nav').innerHTML = `
    <div class="container nav-inner">
      <a class="brand" href="/">
        <img src="/assets/img/logo.webp" alt="" onerror="this.style.display='none'">
        <span class="word">GRAVIJET<i>//</i><em>STATS</em></span>
      </a>
      <nav class="nav-links">
        <a href="/" data-match="/">Home</a>
        <a href="/leaderboards" data-match="/leaderboards">LB</a>
        <a href="/players" data-match="/players">Players</a>
      </nav>
      <div class="nav-right">
        <div class="live-pill" id="live-pill"><span class="live-dot"></span><span id="live-text">--</span></div>
        <button class="btn icon-btn" id="snd" aria-pressed="${sound.on}" aria-label="Interface sound" title="Interface sound"></button>
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
          <img src="/assets/img/logo.webp" alt="" onerror="this.style.display='none'">
          <span class="word">GRAVIJET<i>//</i><em>STATS</em></span>
        </div>
        <div class="f-copy">example.invalid &nbsp;//&nbsp; statistics</div>
      </div>
      <div class="f-links">
        <a href="/leaderboards">Leaderboards</a>
        <a href="/players">Players</a>
        <a href="https://discord.gg/gravijet" data-ext target="_blank" rel="noopener">Discord</a>
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

function paintSndBtn() {
  const b = document.getElementById('snd');
  if (!b) return;
  b.innerHTML = sound.on ? icons.soundOn : icons.soundOff;
  b.setAttribute('aria-pressed', String(sound.on));
}

function wireSound() {
  paintSndBtn();
  document.getElementById('snd').addEventListener('click', () => {
    // Turning it off, the press itself still sounds — you pressed while it was
    // on. Turning it on, toggle() speaks. Either way you hear exactly one tick.
    sound.toggle();
    paintSndBtn();
  });

  // The dead "Clutches (soon)" tab is a <span>, so it never matches and never
  // sounds — which is the point.
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('a[href], button');
    if (!el || el.disabled) return;
    if (el.classList.contains('crumb')) return sound.back();
    if (el.classList.contains('lb-tab') || el.classList.contains('metric-chip')) return sound.select();
    sound.press();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = document.activeElement;
    if (el && el.matches && el.matches('a[href], button') && !el.disabled) sound.press();
  });
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
          <img src="${head(p.uuid, 52)}" alt="" onerror="this.src='https://mc-heads.net/avatar/MHF_Steve/52'">
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
    setTitle('Not found');
    sound.deny();
    app.innerHTML = `<div class="container"><div class="notice"><h2>404 — no such route</h2><p>That page doesn't exist. <a href="/">Head back home</a>.</p></div></div>`;
  } catch (err) {
    console.error(err);
    sound.deny();
    app.innerHTML = `<div class="container"><div class="notice"><h2>Something broke</h2><p>This page failed to load. Try again in a moment.</p></div></div>`;
  }
}

shell();
wireSound();
wireSearch();
startRouter(route);
pollLive();
setInterval(pollLive, 30000);
