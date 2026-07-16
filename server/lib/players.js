'use strict';

const sql = require('./sql');
const colors = require('./colors');

// The phoenixbridge `players` table is the master registry: it maps name <-> uuid
// and holds rank, playtime, online state and first/last seen for everyone who has
// ever joined. Every mode keys on UUID, so identity resolution starts here.

function shapeIdentity(row) {
  if (!row) return null;
  const rank = colors.parse(row.rank || '');
  return {
    uuid: row.uuid,
    name: row.name,
    rank: { raw: row.rank || '', label: rank.label || 'Member', color: rank.color },
    playtime: Number(row.playtime) || 0, // seconds
    online: !!row.online,
    firstSeen: row.first_seen ? new Date(row.first_seen).toISOString() : null,
    lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
  };
}

// Resolve a display name (case-insensitive) to a full identity. When a name maps
// to several UUIDs (e.g. an offline test account) we prefer the most-played one.
async function byName(name) {
  const rows = await sql.safeQuery(
    'phoenix',
    'SELECT * FROM players WHERE LOWER(name) = LOWER(:name) ORDER BY playtime DESC LIMIT 1',
    { name },
  );
  if (rows.length) return shapeIdentity(rows[0]);

  // Fallbacks for players that exist in a mode DB but not the bridge registry.
  const mb = await sql.safeQuery(
    'mbedwars',
    'SELECT player_uuid AS uuid, username AS name FROM mbedwars_player_usernames WHERE LOWER(username) = LOWER(:name) LIMIT 1',
    { name },
  );
  if (mb.length) return byUuid(mb[0].uuid, mb[0].name);
  return null;
}

async function byUuid(uuid, fallbackName = null) {
  const rows = await sql.safeQuery('phoenix', 'SELECT * FROM players WHERE uuid = :uuid LIMIT 1', { uuid });
  if (rows.length) return shapeIdentity(rows[0]);
  if (fallbackName) {
    return {
      uuid,
      name: fallbackName,
      rank: { raw: '', label: 'Member', color: '#AAAAAA' },
      playtime: 0,
      online: false,
      firstSeen: null,
      lastSeen: null,
    };
  }
  return null;
}

// Bulk identity lookup for leaderboards. Returns a Map keyed by uuid.
async function identityMap(uuids) {
  const list = [...new Set(uuids.filter(Boolean))];
  if (!list.length) return new Map();
  const placeholders = list.map(() => '?').join(',');
  const rows = await sql.safeQuery('phoenix', `SELECT * FROM players WHERE uuid IN (${placeholders})`, list);
  const map = new Map();
  for (const row of rows) map.set(row.uuid, shapeIdentity(row));
  return map;
}

// Everyone in the registry — used for the players directory and search.
async function all() {
  const rows = await sql.safeQuery('phoenix', 'SELECT * FROM players ORDER BY playtime DESC');
  return rows.map(shapeIdentity);
}

module.exports = { byName, byUuid, identityMap, all, shapeIdentity };
