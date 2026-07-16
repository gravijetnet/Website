'use strict';

const mongo = require('./mongo');

// Players a staff member has hidden from the public lists.
//
// Hiding is a display decision and nothing more: the player keeps playing, the
// core keeps their stats, and nothing here touches the game. It exists for the
// cases where a name on a leaderboard is the problem — a slur someone got past
// registration, a bot farming a ladder, an account being harassed.
//
// Read on every list build and cached for a few seconds, so a hide takes effect
// on the next request rather than at the next restart.

let cache = { at: 0, set: new Set() };
const TTL_MS = 5000;

async function uuids() {
  const now = Date.now();
  if (now - cache.at < TTL_MS) return cache.set;
  try {
    const docs = await (await mongo.site.hidden()).find({}, { projection: { _id: 1 } }).toArray();
    cache = { at: now, set: new Set(docs.map((d) => d._id)) };
  } catch {
    // If the store is unreachable, keep the last answer rather than un-hiding
    // everyone: failing open here would put back exactly what someone chose to
    // take down.
    cache.at = now;
  }
  return cache.set;
}

// Drops hidden players from a list of things carrying a `uuid`.
async function filter(rows, key = (r) => r.uuid) {
  const set = await uuids();
  if (!set.size) return rows;
  return rows.filter((r) => !set.has(key(r)));
}

async function isHidden(uuid) {
  return (await uuids()).has(uuid);
}

function forget() {
  cache = { at: 0, set: new Set() };
}

module.exports = { uuids, filter, isHidden, forget };
