'use strict';

const sql = require('../sql');

// ---------------------------------------------------------------------------
// FastBuilder (MariaDB, `fastbuilder` schema)
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

async function leaderboard(metric = 'experience', limit = 100) {
  const order = METRICS[metric] || METRICS.experience;
  const rows = await sql.safeQuery(
    'fastbuilder',
    `SELECT uuid, name, coins, experience FROM player_data ORDER BY ${order} LIMIT ${parseInt(limit, 10)}`,
  );
  return rows.map(shapeData).filter((p) => p.experience > 0 || p.coins > 0);
}

// Best build times across all players, per map — the real FastBuilder ladder.
async function bestTimes(limit = 100, mapName = null) {
  const where = mapName ? 'WHERE best_time > 0 AND map_name = :map' : 'WHERE best_time > 0';
  const rows = await sql.safeQuery(
    'fastbuilder',
    `SELECT uuid, map_name, best_time FROM player_map_stats ${where}
       ORDER BY best_time ASC LIMIT ${parseInt(limit, 10)}`,
    { map: mapName },
  );
  return rows.map((r) => ({ uuid: r.uuid, map: r.map_name, bestTime: Number(r.best_time) }));
}

module.exports = { forUuid, loadAll, leaderboard, bestTimes, METRICS };
