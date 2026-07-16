'use strict';

const mongo = require('../mongo');
const colors = require('../colors');

// ---------------------------------------------------------------------------
// Practice / Duels (Bolt, MongoDB)
//
// bolt-statistics    : one doc per player — global stats + per-kit stat blocks
// bolt-player-profiles: settings, parkour PB, ordered match-history ids
// bolt-profile-history: one doc per finished match (winner/loser snapshots)
// ---------------------------------------------------------------------------

// Pretty kit labels. Anything not listed is title-cased from its key.
const KIT_LABELS = {
  nodebuff: 'NoDebuff',
  bedfight: 'BedFight',
  fireballfight: 'FireballFight',
  bridge: 'The Bridge',
  sumo: 'Sumo',
  battlerush: 'BattleRush',
  pearlfight: 'PearlFight',
  builduhc: 'BuildUHC',
  boxing: 'Boxing',
  skywars: 'SkyWars',
  classic: 'Classic',
  topfight: 'TopFight',
  blocksumo: 'BlockSumo',
  wallrun: 'WallRun',
  blockfight: 'BlockFight',
  stickfight: 'StickFight',
  bowfight: 'BowFight',
  gapple: 'GApple',
  spleef: 'Spleef',
  axe: 'Axe',
};

function kitLabel(key) {
  return KIT_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

function ratio(a, b) {
  return b > 0 ? a / b : a;
}

function shapeKit(key, k) {
  const wins = k.wins || 0;
  const losses = k.losses || 0;
  const kills = k.kills || 0;
  const deaths = k.deaths || 0;
  return {
    key,
    label: kitLabel(key),
    elo: k.elo || 1000,
    wins,
    losses,
    kills,
    deaths,
    winStreak: k.winstreak || 0,
    bestWinStreak: k.highestWinstreak || 0,
    games: wins + losses,
    kd: ratio(kills, deaths),
    wlr: ratio(wins, losses),
  };
}

function shapeGlobal(doc) {
  const div = doc.division || {};
  const parsed = colors.parse(div['display-name'] || div.name || '');
  const wins = doc.wins || 0;
  const losses = doc.losses || 0;
  const kills = doc.kills || 0;
  const deaths = doc.deaths || 0;
  const kits = Object.entries(doc.kitStats || {})
    .map(([key, k]) => shapeKit(key, k))
    .sort((a, b) => b.games - a.games || b.elo - a.elo);

  return {
    uuid: doc._id,
    name: doc.name,
    division: {
      name: div.name || 'unranked',
      label: parsed.label || 'Unranked',
      color: parsed.color,
    },
    globalElo: doc.globalElo || 1000,
    level: doc.level || 0,
    experience: doc.experience || 0,
    coins: doc.coins || 0,
    kills,
    deaths,
    wins,
    losses,
    winStreak: doc.winstreak || 0,
    bestWinStreak: doc.highestWinstreak || 0,
    games: wins + losses,
    kd: ratio(kills, deaths),
    wlr: ratio(wins, losses),
    kits,
  };
}

async function forUuid(uuid) {
  const stats = await mongo.practice.statistics();
  const doc = await stats.findOne({ _id: uuid });
  if (!doc) return null;
  const shaped = shapeGlobal(doc);
  shaped.recent = await recentMatches(uuid, 8);
  return shaped;
}

// bolt-profile-history snapshots are positional arrays where [0]=uuid, [1]=name.
async function recentMatches(uuid, limit = 8) {
  try {
    const hist = await mongo.practice.history();
    const docs = await hist
      .find({ $or: [{ 'snapshots.winner.0': uuid }, { 'snapshots.loser.0': uuid }] })
      .sort({ time: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => {
      const winner = d.snapshots?.winner || [];
      const loser = d.snapshots?.loser || [];
      const won = winner[0] === uuid;
      const oppo = won ? loser : winner;
      return {
        won,
        kit: d.kit || 'Unknown',
        arena: d.arena || null,
        ranked: !!d.ranked,
        type: d.type || 'SOLO',
        duration: Number(d.duration) || 0,
        time: d.time ? Number(d.time) : null,
        opponent: oppo[1] || 'Unknown',
        opponentUuid: oppo[0] || null,
      };
    });
  } catch {
    return [];
  }
}

async function loadAll() {
  try {
    const stats = await mongo.practice.statistics();
    const docs = await stats.find({}).toArray();
    return docs.map(shapeGlobal);
  } catch {
    return [];
  }
}

const GLOBAL_METRICS = {
  elo: (p) => p.globalElo,
  wins: (p) => p.wins,
  kills: (p) => p.kills,
  level: (p) => p.experience,
  winstreak: (p) => p.bestWinStreak,
};

// Leaderboard over global metrics, or over a single kit when `kit` is given.
//
// Ties are common here — the ladder is young, so most players still sit on the
// 1000 starting ELO. Without tie-breakers the order would be whatever Mongo
// returned, which looks arbitrary (a 51-win player below a 0-win one). Fall back
// to wins, then kills, then games played.
async function leaderboard(metric = 'elo', limit = 100, kit = null) {
  const all = await loadAll();
  if (kit) {
    const pickKit = (p) => p.kits.find((k) => k.key === kit);
    const kmetric = {
      elo: (k) => k.elo,
      wins: (k) => k.wins,
      kills: (k) => k.kills,
      winstreak: (k) => k.bestWinStreak,
    }[metric] || ((k) => k.elo);
    return all
      .map((p) => ({ player: p, kit: pickKit(p) }))
      .filter((x) => x.kit && x.kit.games > 0)
      .sort(
        (a, b) =>
          kmetric(b.kit) - kmetric(a.kit) ||
          b.kit.wins - a.kit.wins ||
          b.kit.kills - a.kit.kills ||
          b.kit.games - a.kit.games,
      )
      .slice(0, limit)
      .map((x) => ({ ...x.player, kitStat: x.kit }));
  }
  const pick = GLOBAL_METRICS[metric] || GLOBAL_METRICS.elo;
  return all
    .filter((p) => p.games > 0 || p.globalElo !== 1000 || p.kills > 0)
    .sort((a, b) => pick(b) - pick(a) || b.wins - a.wins || b.kills - a.kills || b.games - a.games)
    .slice(0, limit);
}

// The union of kits actually present in the data, for building selectors.
async function kitCatalog() {
  const all = await loadAll();
  const seen = new Map();
  for (const p of all) {
    for (const k of p.kits) {
      const cur = seen.get(k.key) || { key: k.key, label: k.label, games: 0 };
      cur.games += k.games;
      seen.set(k.key, cur);
    }
  }
  return [...seen.values()].sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));
}

module.exports = { forUuid, loadAll, leaderboard, kitCatalog, kitLabel, GLOBAL_METRICS };
