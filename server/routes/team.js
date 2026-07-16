'use strict';

const express = require('express');
const router = express.Router();

const { cached } = require('../lib/cache');
const phoenix = require('../lib/phoenix');

// Ranks that make someone media rather than staff. Media is the rank the network
// actually grants; the others sit beside it in the same band of the ladder and
// mean the same kind of thing to a visitor looking for content about the server.
const MEDIA_RANKS = ['Media', 'Creator', 'Partner', 'Famous'];

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
