'use strict';

const fs = require('fs');
const path = require('path');
const sql = require('../sql');
const config = require('../../config');

// ---------------------------------------------------------------------------
// FastBuilder (MariaDB, `fastbuilder` schema)
//
// The mode is a bridging race: get from one island to the other as fast as you
// can, per map — the same idea as mcplayhd.net and bridger.land. So the ladder
// that matters is *time*, not XP or coins; those are only progression currency.
//
// player_data      : coins, experience, cosmetic selections
// player_map_stats : per-map best time (ms), attempts, successes
// ---------------------------------------------------------------------------

function shapeData(row) {
  if (!row) return null;
  return {
    uuid: row.uuid,
    name: row.name,
    coins: row.coins || 0,
    experience: row.experience || 0,
  };
}

async function forUuid(uuid) {
  const data = await sql.safeQuery('fastbuilder', 'SELECT * FROM player_data WHERE uuid = :uuid LIMIT 1', { uuid });
  const maps = await sql.safeQuery(
    'fastbuilder',
    `SELECT map_name, best_time, total_attempts, successful_attempts
       FROM player_map_stats WHERE uuid = :uuid AND best_time > 0
       ORDER BY best_time ASC`,
    { uuid },
  );
  if (!data.length && !maps.length) return null;
  const base = shapeData(data[0]) || { uuid, name: null, coins: 0, experience: 0 };
  base.maps = maps.map((m) => ({
    map: m.map_name,
    bestTime: Number(m.best_time),
    attempts: m.total_attempts || 0,
    successes: m.successful_attempts || 0,
  }));
  base.hasData = base.maps.length > 0 || base.coins > 0 || base.experience > 0;
  return base;
}

async function loadAll() {
  const rows = await sql.safeQuery('fastbuilder', 'SELECT uuid, name, coins, experience FROM player_data');
  return rows.map(shapeData);
}

const METRICS = {
  coins: 'coins DESC',
  experience: 'experience DESC',
};

// Fastest bridge run — the mode's real ladder. Without a map filter this is each
// player's single best time anywhere, so one row per player rather than one row
// per player-map.
// Matched case-insensitively: the selector's key is the map's filename
// (`plains`), and there is no guarantee the plugin stores map_name in that same
// case rather than the display name (`Plains`).
async function timeLeaderboard(limit = 100, mapName = null) {
  const where = mapName
    ? 'WHERE best_time > 0 AND LOWER(map_name) = LOWER(:map)'
    : 'WHERE best_time > 0';
  const rows = await sql.safeQuery(
    'fastbuilder',
    `SELECT s.uuid,
            MIN(s.best_time)        AS best_time,
            SUM(s.total_attempts)   AS attempts,
            SUM(s.successful_attempts) AS successes,
            COUNT(DISTINCT s.map_name) AS maps,
            d.name                  AS name
       FROM player_map_stats s
       LEFT JOIN player_data d ON d.uuid = s.uuid
       ${where}
       GROUP BY s.uuid, d.name
       ORDER BY best_time ASC
       LIMIT ${parseInt(limit, 10)}`,
    { map: mapName },
  );
  return rows.map((r) => ({
    uuid: r.uuid,
    name: r.name,
    bestTime: Number(r.best_time),
    attempts: Number(r.attempts) || 0,
    successes: Number(r.successes) || 0,
    maps: Number(r.maps) || 0,
  }));
}

async function leaderboard(metric = 'best_time', limit = 100, mapName = null) {
  if (metric === 'best_time') return timeLeaderboard(limit, mapName);
  const order = METRICS[metric] || METRICS.experience;
  const rows = await sql.safeQuery(
    'fastbuilder',
    `SELECT uuid, name, coins, experience FROM player_data ORDER BY ${order} LIMIT ${parseInt(limit, 10)}`,
  );
  return rows.map(shapeData).filter((p) => p.experience > 0 || p.coins > 0);
}

// The plugin keeps one YAML file per map. Only two top-level scalars matter here
// — `name` and `enabled` — so this reads them directly rather than adding a YAML
// parser for two keys.
function mapsFromDisk() {
  const dir = config.fastbuilder && config.fastbuilder.mapsDir;
  if (!dir) return [];
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml'));
  } catch {
    return []; // not readable from here — the database still answers
  }
  const out = [];
  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      if (/^enabled:\s*false\s*$/m.test(text)) continue;
      const key = path.basename(file, '.yml');
      const named = text.match(/^name:\s*(.+?)\s*$/m);
      out.push({ key, label: named ? named[1].replace(/^["']|["']$/g, '') : key });
    } catch {
      /* one unreadable map file shouldn't empty the selector */
    }
  }
  return out;
}

// Every map you can pick, whether or not anyone has timed a run on it yet.
// Definitions come from disk so a brand-new map is selectable immediately; the
// database supplies the run counts, and any map with times but no definition
// (renamed, retired, or owned by another server) is kept rather than hidden.
async function mapCatalog() {
  const rows = await sql.safeQuery(
    'fastbuilder',
    `SELECT map_name, COUNT(*) AS runs FROM player_map_stats
       WHERE best_time > 0 GROUP BY map_name ORDER BY runs DESC, map_name ASC`,
  );
  const runs = new Map(rows.map((r) => [String(r.map_name).toLowerCase(), Number(r.runs) || 0]));

  const catalog = new Map();
  for (const m of mapsFromDisk()) {
    catalog.set(m.key.toLowerCase(), { key: m.key, label: m.label, games: runs.get(m.key.toLowerCase()) || 0 });
  }
  for (const r of rows) {
    const k = String(r.map_name).toLowerCase();
    if (!catalog.has(k)) catalog.set(k, { key: r.map_name, label: r.map_name, games: Number(r.runs) || 0 });
  }
  return [...catalog.values()].sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));
}

module.exports = { forUuid, loadAll, leaderboard, timeLeaderboard, mapCatalog, METRICS };
