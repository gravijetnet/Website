'use strict';

const sql = require('../sql');

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
async function timeLeaderboard(limit = 100, mapName = null) {
  const where = mapName ? 'WHERE best_time > 0 AND map_name = :map' : 'WHERE best_time > 0';
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

// The maps players have actually timed, for the map selector.
async function mapCatalog() {
  const rows = await sql.safeQuery(
    'fastbuilder',
    `SELECT map_name, COUNT(*) AS runs FROM player_map_stats
       WHERE best_time > 0 GROUP BY map_name ORDER BY runs DESC, map_name ASC`,
  );
  return rows.map((r) => ({ key: r.map_name, label: r.map_name, games: Number(r.runs) || 0 }));
}

module.exports = { forUuid, loadAll, leaderboard, timeLeaderboard, mapCatalog, METRICS };
