'use strict';

const express = require('express');
const router = express.Router();

const sql = require('../lib/sql');
const mongoLib = require('../lib/mongo');
const { cached } = require('../lib/cache');
const colors = require('../lib/colors');
const bedwars = require('../lib/modes/bedwars');
const practice = require('../lib/modes/practice');
const ffa = require('../lib/modes/ffa');
const fastbuilder = require('../lib/modes/fastbuilder');

function num(rows, field = 'c') {
  return rows.length ? Number(rows[0][field]) || 0 : 0;
}

async function buildOverview() {
  // Network-wide counters + live registry state.
  const [statRows, onlineRows, regRows] = await Promise.all([
    sql.safeQuery('phoenix', 'SELECT * FROM network_stats WHERE id = 1'),
    sql.safeQuery('phoenix', "SELECT uuid, name, rank FROM players WHERE online = 1 ORDER BY playtime DESC"),
    sql.safeQuery('phoenix', 'SELECT COUNT(*) AS c FROM players'),
  ]);
  const net = statRows[0] || {};

  const onlinePlayers = onlineRows.map((r) => {
    const rk = colors.parse(r.rank || '');
    return { uuid: r.uuid, name: r.name, rank: { label: rk.label || 'Member', color: rk.color } };
  });

  // Per-mode data (each guarded so a dead source can't break the page).
  const [bw, pr, fa, fb, bwLive] = await Promise.all([
    bedwars.loadAll(),
    practice.loadAll(),
    ffa.loadAll(),
    fastbuilder.loadAll(),
    bedwars.live(),
  ]);

  const bwActive = bw.filter((p) => p.hasData);
  const sum = (arr, f) => arr.reduce((a, p) => a + (f(p) || 0), 0);
  const max = (arr, f) => arr.reduce((a, p) => Math.max(a, f(p) || 0), 0);

  const modes = [
    {
      key: 'bedwars',
      name: 'Bedwars',
      tag: 'Beds & final kills',
      status: 'active',
      live: !!(bwLive && bwLive.online),
      players: bwActive.length,
      headline: [
        { label: 'Beds broken', value: sum(bw, (p) => p.bedsDestroyed) },
        { label: 'Total wins', value: sum(bw, (p) => p.wins) },
      ],
    },
    {
      key: 'practice',
      name: 'Duels',
      tag: '20 ranked kits',
      status: 'active',
      players: pr.filter((p) => p.games > 0).length,
      headline: [
        { label: 'Top ELO', value: max(pr, (p) => p.globalElo) },
        { label: 'Matches', value: Math.round(sum(pr, (p) => p.games) / 2) },
      ],
    },
    {
      key: 'ffa',
      name: 'FFA',
      tag: 'Open-arena combat',
      status: 'active',
      players: fa.filter((p) => p.hasData).length,
      headline: [
        { label: 'Total kills', value: sum(fa, (p) => p.kills) },
        { label: 'Best streak', value: max(fa, (p) => p.bestStreak) },
      ],
    },
    {
      key: 'fastbuilder',
      name: 'FastBuilder',
      tag: 'Island-to-island bridging, against the clock',
      status: 'active',
      players: fb.length,
      headline: [
        { label: 'Bridgers', value: fb.length },
        { label: 'Total XP', value: sum(fb, (p) => p.experience) },
      ],
    },
    {
      key: 'clutches',
      name: 'Clutches',
      tag: 'Landing the impossible',
      status: 'soon',
      players: 0,
      headline: [],
    },
  ];

  return {
    network: {
      totalPlayers: Number(net.total_players) || num(regRows),
      totalBans: Number(net.total_bans) || 0,
      totalMutes: Number(net.total_mutes) || 0,
      totalKicks: Number(net.total_kicks) || 0,
      peakOnline: Number(net.peak_online) || 0,
      currentOnline: onlinePlayers.length,
    },
    registered: num(regRows),
    online: onlinePlayers.length,
    onlinePlayers,
    modes,
  };
}

router.get('/network', async (req, res) => {
  try {
    const data = await cached('network', 15000, buildOverview);
    res.json(data);
  } catch (err) {
    console.error('[network]', err);
    res.status(500).json({ error: 'overview_unavailable' });
  }
});

router.get('/health', async (req, res) => {
  const [mysqlStatus, mongoStatus] = await Promise.all([sql.ping(), mongoLib.ping()]);
  const bwLive = await bedwars.live();
  res.json({
    ok: true,
    mysql: mysqlStatus,
    mongo: mongoStatus,
    mbedwarsApi: !!(bwLive && bwLive.online),
    time: new Date().toISOString(),
  });
});

module.exports = router;
