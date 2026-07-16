'use strict';

const config = require('../config');

// Tiny in-memory TTL cache. The network is small and stats update slowly, so
// caching for a few seconds keeps the DBs quiet under refresh spam without ever
// serving anything meaningfully stale.
const store = new Map();

async function cached(key, ttl, producer) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value;
  const value = await producer();
  store.set(key, { value, expires: now + (ttl ?? config.cacheTtl) });
  return value;
}

function bust(prefix) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

// Drop everything. Used when a staff action changes what the lists should show —
// hiding a player that stays visible for another 20 seconds reads as a button
// that did not work, and gets pressed again.
function invalidate() {
  store.clear();
}

module.exports = { cached, bust, invalidate };
