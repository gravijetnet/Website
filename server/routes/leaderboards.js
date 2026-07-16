'use strict';

const express = require('express');
const router = express.Router();

const { cached } = require('../lib/cache');
const { withIdentity } = require('../lib/enrich');
const bedwars = require('../lib/modes/bedwars');
const practice = require('../lib/modes/practice');
const ffa = require('../lib/modes/ffa');
const fastbuilder = require('../lib/modes/fastbuilder');

// Metric catalogs drive the selector chips on the leaderboard page. `col` is the
// primary sort column shown large; `cols` are the secondary columns rendered
// after it, in order.
const METRICS = {
  bedwars: {
    label: 'Bedwars',
    metrics: [
      { key: 'wins', label: 'Wins' },
      { key: 'final_kills', label: 'Final kills' },
      { key: 'kills', label: 'Kills' },
      { key: 'beds_destroyed', label: 'Beds broken' },
      { key: 'win_streak', label: 'Win streak' },
      { key: 'fkdr', label: 'FKDR' },
    ],
  },
  practice: {
    label: 'Practice',
    metrics: [
      { key: 'elo', label: 'Global ELO' },
      { key: 'wins', label: 'Wins' },
      { key: 'kills', label: 'Kills' },
      { key: 'winstreak', label: 'Best streak' },
      { key: 'level', label: 'Experience' },
    ],
  },
  ffa: {
    label: 'FFA',
    metrics: [
      { key: 'kills', label: 'Kills' },
      { key: 'streak', label: 'Best streak' },
      { key: 'kd', label: 'K/D' },
    ],
  },
  fastbuilder: {
    label: 'FastBuilder',
    // It's a bridging race, so time leads; XP and coins are just progression.
    metrics: [
      { key: 'best_time', label: 'Best time' },
      { key: 'experience', label: 'Experience' },
      { key: 'coins', label: 'Coins' },
    ],
  },
};

async function build(mode, metric, limit, kit) {
  let rows = [];
  if (mode === 'bedwars') rows = await bedwars.leaderboard(metric, limit);
  else if (mode === 'practice') rows = await practice.leaderboard(metric, limit, kit);
  else if (mode === 'ffa') rows = await ffa.leaderboard(metric, limit);
  else if (mode === 'fastbuilder') rows = await fastbuilder.leaderboard(metric, limit, kit);
  else return null;
  return withIdentity(rows);
}

router.get('/leaderboards/:mode', async (req, res) => {
  const mode = req.params.mode;
  const cfg = METRICS[mode];
  if (!cfg) return res.status(404).json({ error: 'unknown_mode' });

  const metric = req.query.metric || cfg.metrics[0].key;
  const kit = req.query.kit || null;
  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 250);

  try {
    const key = `lb:${mode}:${metric}:${kit || '-'}:${limit}`;
    const entries = await cached(key, 15000, () => build(mode, metric, limit, kit));
    // `kits` doubles as the sub-filter catalog: practice kits, FastBuilder maps.
    let kits = [];
    if (mode === 'practice') kits = await cached('practice:kits', 60000, practice.kitCatalog);
    else if (mode === 'fastbuilder' && metric === 'best_time') {
      kits = await cached('fastbuilder:maps', 60000, fastbuilder.mapCatalog);
    }
    res.json({ mode, metric, kit, label: cfg.label, metrics: cfg.metrics, kits, entries });
  } catch (err) {
    console.error('[leaderboards]', err);
    res.status(500).json({ error: 'leaderboard_unavailable' });
  }
});

// Catalog of every mode + its metrics, so the frontend can build tabs.
router.get('/leaderboards', (req, res) => {
  res.json(
    Object.entries(METRICS).map(([key, v]) => ({ key, label: v.label, metrics: v.metrics })),
  );
});

module.exports = router;
