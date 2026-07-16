'use strict';

const mongo = require('../mongo');

// ---------------------------------------------------------------------------
// FFA (Zephyr, MongoDB) — zephyr-profiles holds a flat per-player stat doc.
// ---------------------------------------------------------------------------

function ratio(a, b) {
  return b > 0 ? a / b : a;
}

function shape(doc) {
  const kills = doc.kills || 0;
  const deaths = doc.deaths || 0;
  return {
    uuid: doc._id,
    name: doc.name,
    kills,
    deaths,
    bestStreak: doc.bestStreak || 0,
    kd: ratio(kills, deaths),
    killEffect: doc.killEffect || 'NONE',
    blockAnimation: doc.blockAnimation || 'DEFAULT',
    hasData: kills > 0 || deaths > 0,
  };
}

async function forUuid(uuid) {
  try {
    const col = await mongo.ffa.profiles();
    const doc = await col.findOne({ _id: uuid });
    return doc ? shape(doc) : null;
  } catch {
    return null;
  }
}

async function loadAll() {
  try {
    const col = await mongo.ffa.profiles();
    const docs = await col.find({}).toArray();
    return docs.map(shape);
  } catch {
    return [];
  }
}

const METRICS = {
  kills: (p) => p.kills,
  streak: (p) => p.bestStreak,
  kd: (p) => p.kd,
};

// Ties break on kills, then best streak — K/D alone leaves equal players in
// arbitrary Mongo order.
async function leaderboard(metric = 'kills', limit = 100) {
  const all = await loadAll();
  const pick = METRICS[metric] || METRICS.kills;
  return all
    .filter((p) => p.hasData)
    .sort((a, b) => pick(b) - pick(a) || b.kills - a.kills || b.bestStreak - a.bestStreak)
    .slice(0, limit);
}

module.exports = { forUuid, loadAll, leaderboard, METRICS };
