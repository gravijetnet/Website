'use strict';

const sql = require('../sql');
const config = require('../../config');

// ---------------------------------------------------------------------------
// Bedwars (MBedwars)
//
// Source of truth is the `mbedwars` SQL database, where the plugin persists one
// row per (player, stat-key) pair. That data is always available, even when the
// game server is offline. The MBedwars REST add-on (localhost:8084) is consulted
// only for *live* enrichment — whether the server is up and who is online — and
// is entirely optional: if it can't be reached we simply skip the live layer.
// ---------------------------------------------------------------------------

const KEY = (k) => `bedwars:${k}`;

function ratio(a, b) {
  return b > 0 ? a / b : a;
}

// Turn a flat { 'bedwars:kills': 7, ... } map into a structured stat block.
function shape(map) {
  const g = (k) => Number(map[KEY(k)] || 0);
  const kills = g('kills');
  const deaths = g('deaths');
  const finalKills = g('final_kills');
  const finalDeaths = g('final_deaths');
  const wins = g('wins');
  const losses = g('loses');
  const rounds = g('rounds_played');
  const bedsDestroyed = g('beds_destroyed');
  const bedsLost = g('beds_lost');

  return {
    kills,
    deaths,
    finalKills,
    finalDeaths,
    wins,
    losses,
    rounds,
    bedsDestroyed,
    bedsLost,
    winStreak: g('win_streak'),
    topWinStreak: g('top_win_streak'),
    killStreak: g('kill_streak'),
    topKillStreak: g('top_kill_streak'),
    playTimeMs: g('play_time'),
    kd: ratio(kills, deaths),
    fkdr: ratio(finalKills, finalDeaths),
    wlr: ratio(wins, losses),
    winRate: rounds > 0 ? (wins / rounds) * 100 : 0,
    hasData: rounds > 0 || kills > 0 || wins > 0,
  };
}

// Load every player's Bedwars stats in one query and group by uuid.
async function loadAll() {
  const rows = await sql.safeQuery(
    'mbedwars',
    'SELECT player_uuid AS uuid, `key`, value FROM mbedwars_player_stats',
  );
  const byUuid = new Map();
  for (const r of rows) {
    if (!byUuid.has(r.uuid)) byUuid.set(r.uuid, {});
    byUuid.get(r.uuid)[r.key] = Number(r.value);
  }
  // Names come from the plugin's own username table as a fallback identity.
  const names = await sql.safeQuery(
    'mbedwars',
    'SELECT player_uuid AS uuid, username FROM mbedwars_player_usernames',
  );
  const nameMap = new Map(names.map((n) => [n.uuid, n.username]));

  const out = [];
  for (const [uuid, map] of byUuid) {
    out.push({ uuid, name: nameMap.get(uuid) || null, ...shape(map) });
  }
  return out;
}

async function forUuid(uuid) {
  const rows = await sql.safeQuery(
    'mbedwars',
    'SELECT `key`, value FROM mbedwars_player_stats WHERE player_uuid = :uuid',
    { uuid },
  );
  if (!rows.length) return null;
  const map = {};
  for (const r of rows) map[r.key] = Number(r.value);
  const stats = shape(map);
  return stats.hasData ? stats : stats; // return even if all-zero so the panel renders
}

// Best-effort liveness probe of the REST add-on. Returns null when the game
// server / add-on is offline (the common case), so callers can degrade cleanly.
async function live() {
  const { base, username, password, timeoutMs } = config.mbedwars;
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/v1/servers`, {
      headers: { Authorization: auth, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return { online: false };
    const data = await res.json().catch(() => null);
    return { online: true, servers: data };
  } catch {
    return null; // unreachable — offline
  } finally {
    clearTimeout(t);
  }
}

const LEADERBOARD_METRICS = {
  wins: (p) => p.wins,
  kills: (p) => p.kills,
  final_kills: (p) => p.finalKills,
  beds_destroyed: (p) => p.bedsDestroyed,
  win_streak: (p) => p.topWinStreak,
  kd: (p) => p.kd,
  fkdr: (p) => p.fkdr,
};

// Ties break on wins, then final kills, then rounds played — otherwise ratio
// metrics (K/D, FKDR) and streaks would order arbitrarily among equal players.
async function leaderboard(metric = 'wins', limit = 100) {
  const all = await loadAll();
  const pick = LEADERBOARD_METRICS[metric] || LEADERBOARD_METRICS.wins;
  return all
    .filter((p) => p.hasData)
    .sort((a, b) => pick(b) - pick(a) || b.wins - a.wins || b.finalKills - a.finalKills || b.rounds - a.rounds)
    .slice(0, limit);
}

module.exports = { loadAll, forUuid, leaderboard, live, LEADERBOARD_METRICS };
