// The four pages. Each render* function owns a root element, fetches what it
// needs and paints once — no virtual DOM, no framework, no re-render churn.
import { api } from './api.js';
import { icons } from './icons.js';
import { playerCell, stat, wlBar, loader, pageLoader, notice } from './components.js';
import {
  esc, int, compact, dec, playtime, secs, ms, timeAgo, dateShort,
  head, bodyImg, countUp,
} from './util.js';

// ---------------------------------------------------------------- shared bits

const MODE_ORDER = ['bedwars', 'practice', 'ffa', 'fastbuilder'];
const MODE_LABEL = { bedwars: 'Bedwars', practice: 'Duels', ffa: 'FFA', fastbuilder: 'FastBuilder' };

// Numbers in the readout are zero-padded — it's a machine display.
function pad(n, w = 2) {
  const s = String(Math.round(Number(n) || 0));
  return s.length >= w ? s : '0'.repeat(w - s.length) + s;
}

function panelHead(key, title, sub, right = '') {
  return `
    <div class="panel-head">
      <div class="glyph">${icons[key] || icons.bolt}</div>
      <div>
        <h3>${esc(title)}</h3>
        ${sub ? `<div class="ph-sub">${sub}</div>` : ''}
      </div>
      ${right ? `<div class="ph-right">${right}</div>` : ''}
    </div>`;
}

function emptyPanel(key, title, sub, message) {
  return `<section class="panel entry">${panelHead(key, title, sub)}<div class="panel-body"><div class="empty">${esc(message)}</div></div></section>`;
}

function titleCase(s) {
  return String(s || '').replace(/^[a-z]/, (c) => c.toUpperCase());
}

// =============================================================== home =======

export async function renderHome(root) {
  root.innerHTML = pageLoader();

  // The ladder spotlight is a nice-to-have: never let it block the page.
  const [net, spot] = await Promise.all([
    api.network(),
    api.leaderboard('practice', { metric: 'wins', limit: 5 }).catch(() => null),
  ]);

  const n = net.network;
  const liveModes = net.modes.filter((m) => m.status === 'active').length;

  const modeCard = (m) => {
    const glyph = `<div class="glyph">${icons[m.key] || icons.bolt}</div>`;
    const foot = m.headline.length
      ? `<div class="m-foot">${m.headline
          .map((h) => `<div><div class="mv">${compact(h.value)}</div><div class="ml">${esc(h.label)}</div></div>`)
          .join('')}</div>`
      : '';
    if (m.status === 'soon') {
      return `
        <div class="mode-card soon entry">
          <div class="badge-soon"><span class="badge soon">Soon</span></div>
          ${glyph}
          <h3>${esc(m.name)}</h3>
          <div class="tag">${esc(m.tag)}</div>
          <div class="m-foot"><div><div class="mv">--</div><div class="ml">Not live yet</div></div></div>
        </div>`;
    }
    const badge = m.live ? '<div class="badge-soon"><span class="badge live">Live</span></div>' : '';
    return `
      <a class="mode-card enter entry" href="/leaderboards/${m.key}">
        ${badge}
        ${glyph}
        <h3>${esc(m.name)}</h3>
        <div class="tag">${esc(m.tag)}</div>
        ${foot}
      </a>`;
  };

  root.innerHTML = `
    <section class="hero">
      <div class="container">
        <div class="hero-grid">
          <div class="hero-copy">
            <span class="eyebrow">Practice network</span>
            <h1>
              <span class="sweep">Sharpen</span>
              <span class="sweep acid">every mechanic.</span>
            </h1>
            <p class="lede">Bridging, clutching, PvP and bed rushes. Every round you play on Gravijet is measured, ranked and kept — across all five gamemodes.</p>
            <div class="hero-actions">
              <a class="btn btn-primary" href="/leaderboards">Leaderboards</a>
              <a class="btn" href="/players">Players</a>
            </div>
            <div class="hero-tags">
              <span class="chip"><b>${int(n.totalPlayers)}</b> registered</span>
              <span class="chip"><b>20</b> ranked kits</span>
              <span class="chip"><b>5</b> gamemodes</span>
            </div>
          </div>

          <div class="readout raised">
            <div class="readout-bar"><span>System status</span><span>example.invalid</span></div>
            <div class="readout-body">
              <div class="readout-big">
                <div class="v num" id="stat-online">00</div>
                <div class="u">players<br>online</div>
              </div>
              <div class="readout-rows">
                <div class="rr-row"><span class="k">Peak online</span><span class="v">${pad(n.peakOnline)}</span></div>
                <div class="rr-row"><span class="k">Registered</span><span class="v">${pad(n.totalPlayers)}</span></div>
                <div class="rr-row"><span class="k">Modes live</span><span class="v">${pad(liveModes)}</span></div>
                <div class="rr-row"><span class="k">Total bans</span><span class="v">${pad(n.totalBans)}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="telemetry">
          <div class="cell entry"><div class="v">${int(n.totalPlayers)}</div><div class="l">Players</div></div>
          <div class="cell entry"><div class="v">${int(n.peakOnline)}</div><div class="l">Peak online</div></div>
          <div class="cell entry"><div class="v">${int(n.totalBans)}</div><div class="l">Bans</div></div>
          <div class="cell entry"><div class="v">${int(n.totalMutes)}</div><div class="l">Mutes</div></div>
          <div class="cell entry"><div class="v">${int(n.totalKicks)}</div><div class="l">Kicks</div></div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <span class="eyebrow">Gamemodes</span>
            <h2>Five ways to get better.</h2>
          </div>
          <p>Every mode writes to its own ledger. Pick one and climb, or spread yourself thin — the network keeps score either way.</p>
        </div>
        <div class="mode-grid">${net.modes.map(modeCard).join('')}</div>
      </div>
    </section>

    ${spot && spot.entries.length ? spotlightSection(spot) : ''}
    ${net.onlinePlayers.length ? onlineSection(net.onlinePlayers) : ''}
  `;

  const big = root.querySelector('#stat-online');
  if (big) countUp(big, n.currentOnline, { format: (v) => pad(v), ms: 900 });

}

const GRID_SPOT = '44px 1fr 84px 84px';

function spotlightSection(spot) {
  const rows = spot.entries
    .map(
      (e) => `
      <a class="board-row entry ${e.rank <= 3 ? 'top' + e.rank : ''}" href="/player/${encodeURIComponent(e.name)}"
         style="grid-template-columns:${GRID_SPOT}">
        <div class="rank-badge">${pad(e.rank)}</div>
        ${playerCell(e.uuid, e.name, e.identity.rank, e.identity.online)}
        <div class="val primary">${int(e.stats.wins)}</div>
        <div class="val sec">${int(e.stats.globalElo)}</div>
      </a>`,
    )
    .join('');

  return `
    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <span class="eyebrow">Duels &mdash; most wins</span>
            <h2>Ladder spotlight</h2>
          </div>
          <a class="btn" href="/leaderboards/practice">Full ladder</a>
        </div>
        <div class="board">
          <div class="board-head" style="grid-template-columns:${GRID_SPOT}">
            <span>#</span><span>Player</span><span class="r">Wins</span><span class="r">Elo</span>
          </div>
          ${rows}
        </div>
      </div>
    </section>`;
}

function onlineSection(list) {
  const cards = list
    .map(
      (p) => `
      <a class="dir-card entry" href="/player/${encodeURIComponent(p.name)}">
        <img src="${head(p.uuid, 60)}" loading="lazy" alt="" onerror="this.src='https://mc-heads.net/avatar/MHF_Steve/60'">
        <div style="min-width:0">
          <div class="dn">${esc(p.name)} <span class="online-dot"></span></div>
          <div class="dr" style="color:${p.rank.color}">${esc(p.rank.label)}</div>
        </div>
      </a>`,
    )
    .join('');
  return `
    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <span class="eyebrow">Right now</span>
            <h2>Online — ${pad(list.length)}</h2>
          </div>
        </div>
        <div class="dir-grid">${cards}</div>
      </div>
    </section>`;
}

// ======================================================== leaderboards ======

// Column definitions per mode. `get` reads a stat row; `fmt` renders it.
const COLS = {
  bedwars: {
    order: ['wins', 'final_kills', 'beds_destroyed', 'fkdr'],
    defs: {
      wins: { label: 'Wins', get: (s) => s.wins, fmt: int },
      final_kills: { label: 'Finals', get: (s) => s.finalKills, fmt: int },
      kills: { label: 'Kills', get: (s) => s.kills, fmt: int },
      beds_destroyed: { label: 'Beds', get: (s) => s.bedsDestroyed, fmt: int },
      win_streak: { label: 'Streak', get: (s) => s.topWinStreak, fmt: int },
      fkdr: { label: 'Fkdr', get: (s) => s.fkdr, fmt: (v) => dec(v, 2) },
    },
  },
  practice: {
    order: ['elo', 'wins', 'kills', 'winstreak'],
    defs: {
      elo: { label: 'Elo', get: (s) => s.elo ?? s.globalElo, fmt: int },
      wins: { label: 'Wins', get: (s) => s.wins, fmt: int },
      kills: { label: 'Kills', get: (s) => s.kills, fmt: int },
      winstreak: { label: 'Streak', get: (s) => s.bestWinStreak, fmt: int },
      level: { label: 'Xp', get: (s) => s.experience, fmt: compact },
    },
  },
  ffa: {
    order: ['kills', 'streak', 'kd'],
    defs: {
      kills: { label: 'Kills', get: (s) => s.kills, fmt: int },
      streak: { label: 'Streak', get: (s) => s.bestStreak, fmt: int },
      kd: { label: 'K/D', get: (s) => s.kd, fmt: (v) => dec(v, 2) },
    },
  },
  fastbuilder: {
    order: ['best_time', 'maps', 'successes'],
    defs: {
      best_time: { label: 'Best', get: (s) => s.bestTime, fmt: ms },
      maps: { label: 'Maps', get: (s) => s.maps, fmt: int },
      successes: { label: 'Runs', get: (s) => s.successes, fmt: int },
      experience: { label: 'Xp', get: (s) => s.experience, fmt: compact },
      coins: { label: 'Coins', get: (s) => s.coins, fmt: compact },
    },
  },
};

// Which sub-filter a mode offers, and what to call it.
const SUBFILTER = {
  practice: { label: 'All kits', param: 'kit' },
  fastbuilder: { label: 'All maps', param: 'kit' },
};

export async function renderLeaderboards(root, mode, params) {
  mode = MODE_ORDER.includes(mode) ? mode : 'practice';
  const metric = params.get('metric') || null;
  const kit = params.get('kit') || null;

  root.innerHTML = `
    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <span class="eyebrow" id="lb-crumb">${esc(MODE_LABEL[mode])}</span>
            <h2>Leaderboards</h2>
          </div>
          <p>Ranked from live server data. Any row opens that player's full profile.</p>
        </div>
        <div class="lb-tabs">
          ${MODE_ORDER.map((m) => `<a class="lb-tab btn ${m === mode ? 'active' : ''}" href="/leaderboards/${m}">${MODE_LABEL[m]}</a>`).join('')}
          <span class="lb-tab dead btn" title="Coming soon">Clutches (soon)</span>
        </div>
        <div id="lb-body">${loader()}</div>
      </div>
    </section>`;

  const body = root.querySelector('#lb-body');
  let data;
  try {
    data = await api.leaderboard(mode, { metric, kit, limit: 100 });
  } catch {
    body.innerHTML = `<div class="board"><div class="empty">This ladder is unavailable right now.</div></div>`;
    return;
  }

  const active = data.metric;
  const cfg = COLS[mode];
  const kitMode = mode === 'practice' && !!data.kit;
  // FastBuilder's XP/coins rows come from a different table than its time rows,
  // so they carry different fields — pick the column set to match.
  const colOrder =
    mode === 'fastbuilder' && active !== 'best_time' ? ['experience', 'coins'] : cfg.order;

  // Reads like an in-game heading, not a shell query.
  const crumb = root.querySelector('#lb-crumb');
  if (crumb) {
    const mLabel = (data.metrics.find((x) => x.key === active) || {}).label || active;
    const kLabel = data.kits.find((k) => k.key === data.kit);
    crumb.textContent = `${MODE_LABEL[mode]} \u2014 ${mLabel}${kLabel ? ' \u2014 ' + kLabel.label : ''}`;
  }

  const chips = data.metrics
    .map((m) => {
      // In kit mode only the metrics that exist per-kit make sense.
      if (kitMode && m.key === 'level') return '';
      const q = new URLSearchParams();
      q.set('metric', m.key);
      if (data.kit) q.set('kit', data.kit);
      return `<a class="metric-chip btn ${m.key === active ? 'active' : ''}" href="/leaderboards/${mode}?${q}">${esc(m.label)}</a>`;
    })
    .join('');

  // Sub-filter: practice kits, or FastBuilder maps on the time ladder.
  let kitBar = '';
  const sub = SUBFILTER[mode];
  if (sub && data.kits.length) {
    const link = (k) => {
      const q = new URLSearchParams();
      q.set('metric', active);
      if (k) q.set(sub.param, k.key);
      return `/leaderboards/${mode}?${q}`;
    };
    kitBar = `
      <div class="kit-select">
        <a class="metric-chip btn ${!data.kit ? 'active' : ''}" href="${link(null)}">${esc(sub.label)}</a>
        ${data.kits.map((k) => `<a class="metric-chip btn ${data.kit === k.key ? 'active' : ''}" href="${link(k)}">${esc(k.label)}</a>`).join('')}
      </div>`;
  }

  if (!data.entries.length) {
    body.innerHTML = `${chips ? `<div class="chips">${chips}</div>` : ''}${kitBar}
      <div class="board" style="margin-top:18px"><div class="empty">No ranked players in this category yet — be the first.</div></div>`;
    return;
  }

  // Show the active metric first, then the mode's default columns (max 4).
  const keys = [...new Set([active, ...colOrder])].filter((k) => cfg.defs[k]).slice(0, 4);
  const grid = `44px 1fr ${keys.map(() => '92px').join(' ')}`;

  const rows = data.entries
    .map((e) => {
      const src = kitMode ? e.stats.kitStat : e.stats;
      const cells = keys
        .map((k, i) => `<div class="val ${i === 0 ? 'primary' : 'sec'}">${cfg.defs[k].fmt(cfg.defs[k].get(src) || 0)}</div>`)
        .join('');
      return `
        <a class="board-row entry ${e.rank <= 3 ? 'top' + e.rank : ''}" href="/player/${encodeURIComponent(e.name)}"
           style="grid-template-columns:${grid}">
          <div class="rank-badge">${pad(e.rank)}</div>
          ${playerCell(e.uuid, e.name, e.identity.rank, e.identity.online)}
          ${cells}
        </a>`;
    })
    .join('');

  body.innerHTML = `
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${kitBar}
    <div class="board" style="margin-top:18px">
      <div class="board-head" style="grid-template-columns:${grid}">
        <span>#</span><span>Player</span>
        ${keys.map((k) => `<span class="r">${esc(cfg.defs[k].label)}</span>`).join('')}
      </div>
      ${rows}
    </div>`;

}

// ============================================================== player ======

export async function renderPlayer(root, name) {
  root.innerHTML = pageLoader();
  let p;
  try {
    p = await api.player(name);
  } catch (err) {
    root.innerHTML =
      err.status === 404
        ? notice('No such player', `Nobody named "${name}" has ever joined Gravijet. Check the spelling and try again.`)
        : notice('Profile unavailable', 'Something went wrong loading this profile. Try again in a moment.');
    return;
  }

  const id = p.identity;
  const skin = bodyImg(id.uuid);
  const m = p.modes;

  root.innerHTML = `
    <div class="container">
      <a class="crumb" href="/players">All players</a>

      <section class="profile-hero">
        <div class="skin-wrap slot">
          <img src="${skin.src}" alt="${esc(id.name)}'s skin" onerror="this.onerror=null;this.src='${skin.fallback}'">
        </div>
        <div class="p-id entry">
          <div class="p-rank" style="color:${id.rank.color}">${esc(id.rank.label)}</div>
          <h1>${esc(id.name)}</h1>
          <div class="p-status ${id.online ? 'online' : 'offline'}">
            <span class="${id.online ? 'online-dot' : 'live-dot'}"></span>${id.online ? 'Online now' : `Last seen ${timeAgo(id.lastSeen)}`}
          </div>
          <div class="p-meta">
            <div class="pm"><div class="k">Playtime</div><div class="v">${playtime(id.playtime)}</div></div>
            <div class="pm"><div class="k">First seen</div><div class="v">${dateShort(id.firstSeen)}</div></div>
            <div class="pm"><div class="k">Modes played</div><div class="v">${p.summary.modesPlayed} / 4</div></div>
          </div>
        </div>
      </section>

      <div class="p-summary">
        <div class="sum-tile entry"><div class="v" data-count="${p.summary.kills}">0</div><div class="l">Total kills</div></div>
        <div class="sum-tile entry"><div class="v" data-count="${p.summary.wins}">0</div><div class="l">Total wins</div></div>
        <div class="sum-tile entry"><div class="v" data-count="${p.summary.bestStreak}">0</div><div class="l">Best streak</div></div>
        <div class="sum-tile entry"><div class="v">${playtime(id.playtime)}</div><div class="l">Time played</div></div>
      </div>

      <section style="padding-bottom:50px">
        ${bedwarsPanel(m.bedwars)}
        ${practicePanel(m.practice)}
        ${ffaPanel(m.ffa)}
        ${fastbuilderPanel(m.fastbuilder)}
        ${clutchesPanel()}
      </section>
    </div>`;

  root.querySelectorAll('[data-count]').forEach((el) => countUp(el, Number(el.dataset.count)));

}

function bedwarsPanel(b) {
  if (!b || !b.hasData) return emptyPanel('bedwars', 'Bedwars', 'MBedwars', 'No Bedwars rounds played yet.');
  const sub = `${int(b.rounds)} rounds · ${dec(b.winRate, 1)}% win rate`;
  return `
    <section class="panel entry">
      ${panelHead('bedwars', 'Bedwars', sub, `<span class="badge">${int(b.topWinStreak)} best streak</span>`)}
      <div class="panel-body">
        <div class="stat-row">
          ${stat(int(b.wins), 'Wins', 'win')}
          ${stat(int(b.losses), 'Losses', 'loss')}
          ${stat(int(b.finalKills), 'Final kills')}
          ${stat(int(b.finalDeaths), 'Final deaths')}
          ${stat(int(b.bedsDestroyed), 'Beds broken')}
          ${stat(int(b.bedsLost), 'Beds lost')}
          ${stat(int(b.kills), 'Kills')}
          ${stat(int(b.deaths), 'Deaths')}
          ${stat(dec(b.kd, 2), 'K/D')}
          ${stat(dec(b.fkdr, 2), 'Fkdr')}
        </div>
        <div class="block">
          <div class="block-label">Win / loss</div>
          ${wlBar(b.wins, b.losses, 'of decided rounds')}
        </div>
      </div>
    </section>`;
}

function practicePanel(pr) {
  if (!pr) return emptyPanel('practice', 'Duels', 'Practice', 'No duels played yet.');
  if (!pr.games && !pr.kills) {
    return emptyPanel('practice', 'Duels', `${esc(pr.division.label)} · ${int(pr.globalElo)} elo`, 'No duels played yet.');
  }

  const kits = pr.kits.filter((k) => k.games > 0);
  const kitGrid = kits.length
    ? `<div class="kit-grid">${kits
        .map((k) => {
          const pct = k.games > 0 ? (k.wins / k.games) * 100 : 0;
          return `
            <div class="kit-card">
              <div class="kc-top">
                <div class="kc-name">${esc(k.label)}</div>
                <div class="kc-elo">${int(k.elo)}</div>
              </div>
              <div class="kc-stats">
                <div class="ks">W <b>${int(k.wins)}</b></div>
                <div class="ks">L <b>${int(k.losses)}</b></div>
                <div class="ks">K/D <b>${dec(k.kd, 2)}</b></div>
              </div>
              <div class="kc-bar"><div class="w" style="width:${pct.toFixed(1)}%"></div></div>
            </div>`;
        })
        .join('')}</div>`
    : '<div class="empty">No kit has been played yet.</div>';

  const recent = (pr.recent || []).length
    ? `<div class="matches">${pr.recent
        .map(
          (r) => `
          <div class="match">
            <div class="res ${r.won ? 'w' : 'l'}"></div>
            <div class="m-info">
              <div class="mk">${esc(titleCase(r.kit))}${r.ranked ? ' <span class="badge live">Ranked</span>' : ''}</div>
              <div class="mo">vs ${
                r.opponentUuid
                  ? `<a href="/player/${encodeURIComponent(r.opponent)}">${esc(r.opponent)}</a>`
                  : esc(r.opponent)
              }${r.arena ? ` · ${esc(r.arena)}` : ''}</div>
            </div>
            <div class="m-right">
              <div class="rr ${r.won ? 'w' : 'l'}">${r.won ? 'WIN' : 'LOSS'}</div>
              <div class="rd">${secs(r.duration)} · ${timeAgo(r.time)}</div>
            </div>
          </div>`,
        )
        .join('')}</div>`
    : '<div class="empty">No recorded matches yet.</div>';

  return `
    <section class="panel entry">
      ${panelHead(
        'practice',
        'Duels',
        `${int(pr.games)} matches · level ${int(pr.level)}`,
        // No Minecraft colour here on purpose: the panel header is inverted, and
        // pale division colours (Silver = #AAAAAA) vanish against it. The label
        // carries the meaning; .panel-head .badge gives it readable contrast.
        `<span class="badge">${esc(pr.division.label)}</span>`,
      )}
      <div class="panel-body">
        <div class="stat-row">
          <div class="stat">
            <div class="v" style="color:${pr.division.color};font-size:15px">${esc(pr.division.label)}</div>
            <div class="l">Division</div>
          </div>
          ${stat(int(pr.globalElo), 'Global elo')}
          ${stat(int(pr.wins), 'Wins', 'win')}
          ${stat(int(pr.losses), 'Losses', 'loss')}
          ${stat(int(pr.kills), 'Kills')}
          ${stat(int(pr.deaths), 'Deaths')}
          ${stat(dec(pr.kd, 2), 'K/D')}
          ${stat(int(pr.bestWinStreak), 'Best streak')}
          ${stat(compact(pr.coins), 'Coins')}
        </div>
        <div class="block">
          <div class="block-label">Win / loss</div>
          ${wlBar(pr.wins, pr.losses)}
        </div>
        <div class="block">
          <div class="block-label">Kits — ${kits.length} played</div>
          ${kitGrid}
        </div>
        <div class="block">
          <div class="block-label">Recent matches</div>
          ${recent}
        </div>
      </div>
    </section>`;
}

function ffaPanel(f) {
  if (!f || !f.hasData) return emptyPanel('ffa', 'FFA', 'Open arena', 'No FFA fights recorded yet.');
  return `
    <section class="panel entry">
      ${panelHead('ffa', 'FFA', `Kill effect: ${esc(f.killEffect.toLowerCase())}`, `<span class="badge">${int(f.bestStreak)} best streak</span>`)}
      <div class="panel-body">
        <div class="stat-row">
          ${stat(int(f.kills), 'Kills')}
          ${stat(int(f.deaths), 'Deaths')}
          ${stat(dec(f.kd, 2), 'K/D')}
          ${stat(int(f.bestStreak), 'Best streak')}
        </div>
      </div>
    </section>`;
}

function fastbuilderPanel(fb) {
  if (!fb || !fb.hasData) return emptyPanel('fastbuilder', 'FastBuilder', 'Island-to-island bridging', 'No bridge runs completed yet.');
  const maps = (fb.maps || []).length
    ? `<div class="block">
        <div class="block-label">Best bridge times</div>
        <div class="matches">${fb.maps
          .map(
            (mp) => `
            <div class="match">
              <div class="res w"></div>
              <div class="m-info">
                <div class="mk">${esc(mp.map)}</div>
                <div class="mo">${int(mp.successes)} / ${int(mp.attempts)} runs completed</div>
              </div>
              <div class="m-right"><div class="rr w">${ms(mp.bestTime)}</div><div class="rd">personal best</div></div>
            </div>`,
          )
          .join('')}</div>
      </div>`
    : '';
  return `
    <section class="panel entry">
      ${panelHead('fastbuilder', 'FastBuilder', `${(fb.maps || []).length} maps bridged`)}
      <div class="panel-body">
        <div class="stat-row">
          ${stat(compact(fb.experience), 'Experience')}
          ${stat(compact(fb.coins), 'Coins')}
          ${stat(int((fb.maps || []).length), 'Maps bridged')}
        </div>
        ${maps}
      </div>
    </section>`;
}

function clutchesPanel() {
  return `
    <section class="panel entry">
      <div class="soon-state">
        <div class="glyph">${icons.clutches}</div>
        <div>
          <h4>Clutches — coming soon</h4>
          <p>Landing the impossible. Stats for this mode appear here once it goes live.</p>
        </div>
        <div style="margin-left:auto"><span class="badge soon">Soon</span></div>
      </div>
    </section>`;
}

// ========================================================== directory =======

export async function renderPlayers(root) {
  root.innerHTML = pageLoader();
  let list;
  try {
    list = await api.players();
  } catch {
    root.innerHTML = notice('Directory unavailable', 'The player registry could not be loaded. Try again in a moment.');
    return;
  }

  const cards = list
    .map(
      (p) => `
      <a class="dir-card entry" href="/player/${encodeURIComponent(p.name)}">
        <img src="${head(p.uuid, 60)}" loading="lazy" alt="" onerror="this.src='https://mc-heads.net/avatar/MHF_Steve/60'">
        <div style="min-width:0">
          <div class="dn">${esc(p.name)}${p.online ? ' <span class="online-dot"></span>' : ''}</div>
          <div class="dr" style="color:${p.rank.color}">${esc(p.rank.label)}</div>
        </div>
        <div class="dt">${playtime(p.playtime)}<br>${p.online ? 'online' : timeAgo(p.lastSeen)}</div>
      </a>`,
    )
    .join('');

  root.innerHTML = `
    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <span class="eyebrow">All players</span>
            <h2>${list.length} players</h2>
          </div>
          <p>Everyone who has ever joined Gravijet, sorted by time on the network.</p>
        </div>
        <div class="dir-grid">${cards || '<div class="empty">The registry is empty.</div>'}</div>
      </div>
    </section>`;

}
