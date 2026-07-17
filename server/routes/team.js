'use strict';

const express = require('express');
const router = express.Router();

const { cached } = require('../lib/cache');
const phoenix = require('../lib/phoenix');

// The media band of the ladder, highest first. The page does not order by this
// list — grouping sorts on each rank's own priority, and Phoenix already spaces
// them Partner 140, Famous 120, Media 110, Creator 100 — but the two agree, and
// writing it in the order it renders means a reader can check that at a glance
// instead of going to look the numbers up.
const MEDIA_RANKS = ['Partner', 'Famous', 'Media', 'Creator'];

function slim(groups) {
  return groups.map((g) => ({
    rank: { name: g.rank.name, color: g.rank.color, priority: g.rank.priority, staff: g.rank.staff },
    members: g.members.map((m) => ({
      uuid: m.uuid,
      name: m.name,
      online: m.online,
      playtime: m.playtime,
      lastSeen: m.lastSeen,
      ranks: m.ranks.map((r) => r.name),
    })),
  }));
}

router.get('/staff', async (req, res) => {
  try {
    const groups = await cached('team:staff', 60000, phoenix.staff);
    res.json(slim(groups));
  } catch (err) {
    console.error('[staff]', err);
    res.status(500).json({ error: 'staff_unavailable' });
  }
});

router.get('/media', async (req, res) => {
  try {
    const groups = await cached('team:media', 60000, () => phoenix.withRank(MEDIA_RANKS));
    res.json(slim(groups));
  } catch (err) {
    console.error('[media]', err);
    res.status(500).json({ error: 'media_unavailable' });
  }
});

module.exports = router;
