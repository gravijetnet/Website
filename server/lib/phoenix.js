'use strict';

const mongo = require('./mongo');
const colors = require('./colors');
const playersLib = require('./players');

// Ranks and who holds them, read from the Phoenix core.
//
// A player holds grants, not a rank: `gravijet` has four live ones (Owner, Admin,
// Ace, Premium) and Topsprinter_1 three. So every list here has to pick one to
// show, or the same person appears three times.

function shapeRank(doc) {
  return {
    id: doc._id,
    name: doc.name,
    priority: Number(doc.priority) || 0,
    staff: !!doc.staff,
    visible: doc.visible !== false,
    color: colors.parse(doc.colorModern || doc.color || '').color,
  };
}

// A grant is live if it hasn't been revoked and hasn't run out. Permanent grants
// carry a nonsense duration ("-5"), so the flag decides before the arithmetic.
function isLive(grant, now) {
  if (!grant.active) return false;
  if (grant.permanent) return true;
  const start = Number(grant.issuedAt) || 0;
  const duration = Number(grant.duration) || 0;
  if (duration <= 0) return true;
  return start + duration > now;
}

// Everyone holding at least one live grant, with their ranks highest-first.
async function roster() {
  const [rankDocs, grantDocs, profileDocs] = await Promise.all([
    (await mongo.phoenix.ranks()).find({}).toArray(),
    (await mongo.phoenix.grants()).find({ active: true }).toArray(),
    (await mongo.phoenix.profiles()).find({}, { projection: { name: 1 } }).toArray(),
  ]);

  const rankById = new Map(rankDocs.map((r) => [r._id, shapeRank(r)]));
  const nameById = new Map(profileDocs.map((p) => [p._id, p.name]));
  const now = Date.now();

  const byPlayer = new Map();
  for (const grant of grantDocs) {
    if (!isLive(grant, now)) continue;
    const rank = rankById.get(grant.rankId);
    if (!rank) continue; // grant to a rank that no longer exists
    const entry = byPlayer.get(grant.target) || {
      uuid: grant.target,
      name: nameById.get(grant.target) || null,
      ranks: [],
      since: 0,
    };
    entry.ranks.push(rank);
    entry.since = Math.max(entry.since, Number(grant.issuedAt) || 0);
    byPlayer.set(grant.target, entry);
  }

  const out = [];
  for (const entry of byPlayer.values()) {
    if (!entry.name) continue; // a grant against a UUID that never had a profile
    entry.ranks.sort((a, b) => b.priority - a.priority);
    entry.top = entry.ranks[0];
    out.push(entry);
  }
  return out;
}

// Presence and playtime live in the phoenixbridge registry, keyed by UUID.
async function withPresence(list) {
  const map = await playersLib.identityMap(list.map((p) => p.uuid));
  return list.map((p) => {
    const id = map.get(p.uuid);
    return {
      ...p,
      name: id?.name || p.name,
      online: !!id?.online,
      playtime: id?.playtime || 0,
      lastSeen: id?.lastSeen || null,
    };
  });
}

// One entry per name, keeping the highest rank. Two UUIDs can share a name here
// for the same reason they do in the registry — see players.isPremium.
function oneEntryPerName(list) {
  const best = new Map();
  for (const p of list) {
    const key = String(p.name || '').toLowerCase();
    const cur = best.get(key);
    if (!cur || p.top.priority > cur.top.priority) best.set(key, p);
  }
  return [...best.values()];
}

function group(list) {
  const byRank = new Map();
  for (const p of list) {
    const arr = byRank.get(p.top.id) || [];
    arr.push(p);
    byRank.set(p.top.id, arr);
  }
  return [...byRank.entries()]
    .map(([, members]) => ({
      rank: members[0].top,
      members: members.sort((a, b) => b.playtime - a.playtime || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.rank.priority - a.rank.priority);
}

// The team, grouped by rank. Every staff rank outranks every non-staff one
// (Helper is 300, Builder 210), so a player's highest rank being staff and their
// holding any staff rank are the same thing — no need to ask twice.
async function staff() {
  const list = await withPresence(await roster());
  return group(oneEntryPerName(list.filter((p) => p.top.staff && p.top.visible)));
}

// Holders of a named rank, whatever else they hold. Someone with both Media and
// Admin belongs on the media list even though Admin is what they're shown as
// elsewhere — so this asks about the rank, not about their top one.
async function withRank(rankNames) {
  const wanted = new Set(rankNames.map((n) => n.toLowerCase()));
  const list = await withPresence(await roster());
  const holders = list
    .filter((p) => p.ranks.some((r) => wanted.has(r.name.toLowerCase())))
    .map((p) => ({ ...p, top: p.ranks.find((r) => wanted.has(r.name.toLowerCase())) }));
  return group(oneEntryPerName(holders));
}

module.exports = { roster, staff, withRank, shapeRank, isLive };
