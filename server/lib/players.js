'use strict';

const sql = require('./sql');
const colors = require('./colors');

// The phoenixbridge `players` table is the master registry: it maps name <-> uuid
// and holds rank, playtime, online state and first/last seen for everyone who has
// ever joined. Every mode keys on UUID, so identity resolution starts here.

// A real Mojang account carries a version-4 UUID; an offline ("cracked") login
// gets a version-3 one derived from the name. Most Gravijet servers run
// online-mode=false, so the same name can exist twice — `gravijet` sits in the
// registry as a premium account with five days of playtime AND as an offline one
// with 26 seconds, and the directory listed both. The version nibble is at index
// 14 of the canonical form: xxxxxxxx-xxxx-Vxxx-xxxx-xxxxxxxxxxxx.
function isPremium(uuid) {
  return typeof uuid === 'string' && uuid[14] === '4';
}

// Of two rows sharing a name, which one is actually the player: the premium
// account, and failing that whoever has played more.
function outranks(a, b) {
  const pa = isPremium(a.uuid);
  const pb = isPremium(b.uuid);
  if (pa !== pb) return pa;
  const ta = Number(a.playtime) || 0;
  const tb = Number(b.playtime) || 0;
  if (ta !== tb) return ta > tb;
  return new Date(a.last_seen || 0) > new Date(b.last_seen || 0);
}

// One row per name. Applied everywhere a name is shown or resolved, so the
// directory and the profile it links to always agree on which account is meant.
//
// The surviving row inherits presence from the ones it absorbed: the offline
// `gravijet` is the account currently on the network while the premium one sits
// idle, and dropping the duplicate must not drop the fact that the player is
// playing.
function dedupeByName(rows) {
  const best = new Map();
  for (const row of rows) {
    const key = String(row.name || '').toLowerCase();
    const cur = best.get(key);
    if (!cur) {
      best.set(key, { ...row });
      continue;
    }
    const winner = outranks(row, cur) ? { ...row } : cur;
    winner.online = cur.online || row.online ? 1 : 0;
    winner.last_seen =
      new Date(cur.last_seen || 0) > new Date(row.last_seen || 0) ? cur.last_seen : row.last_seen;
    best.set(key, winner);
  }
  return [...best.values()];
}

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

// Resolve a display name (case-insensitive) to a full identity, picking the same
// account the directory shows — otherwise a name could list one player and open
// another.
async function byName(name) {
  const rows = await sql.safeQuery(
    'phoenix',
    'SELECT * FROM players WHERE LOWER(name) = LOWER(:name)',
    { name },
  );
  if (rows.length) return shapeIdentity(dedupeByName(rows)[0]);

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
  const rows = await sql.safeQuery('phoenix', 'SELECT * FROM players');
  return dedupeByName(rows)
    .map(shapeIdentity)
    .sort((a, b) => b.playtime - a.playtime);
}

module.exports = { byName, byUuid, identityMap, all, shapeIdentity, isPremium, dedupeByName };
