'use strict';

const express = require('express');
const router = express.Router();

const { cached } = require('../lib/cache');
const players = require('../lib/players');

function slim(p) {
  return {
    uuid: p.uuid,
    name: p.name,
    rank: p.rank,
    online: p.online,
    playtime: p.playtime,
    lastSeen: p.lastSeen,
  };
}

// Full registry directory, most-played first.
router.get('/players', async (req, res) => {
  try {
    const all = await cached('players:all', 20000, players.all);
    res.json(all.map(slim));
  } catch (err) {
    console.error('[players]', err);
    res.status(500).json({ error: 'directory_unavailable' });
  }
});

// Typeahead search by name prefix/substring.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  try {
    const all = await cached('players:all', 20000, players.all);
    const starts = [];
    const contains = [];
    for (const p of all) {
      const n = p.name.toLowerCase();
      if (n.startsWith(q)) starts.push(p);
      else if (n.includes(q)) contains.push(p);
    }
    res.json([...starts, ...contains].slice(0, 8).map(slim));
  } catch (err) {
    console.error('[search]', err);
    res.status(500).json({ error: 'search_unavailable' });
  }
});

module.exports = router;
