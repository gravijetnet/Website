'use strict';

const express = require('express');
const router = express.Router();

const staff = require('../lib/staff');
const live = require('../lib/live');

// The watchable network: two polling endpoints behind the Live page. Both take a
// `since` cursor (a millisecond timestamp) and return only what is newer, so a
// page can hold a long session open with small, cheap requests. Both are gated
// on viewReports — the same bar as reading the logs they draw from.

// Chat, oldest-first, with each line's sender resolved and any filter it trips
// named. A limit is capped server-side; the client asks for a windowful.
router.get('/dash/feed/chat', staff.requires('viewReports'), async (req, res) => {
  try {
    const since = Number(req.query.since) || 0;
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 120);
    const lines = await live.chatFeed(since, limit);
    res.json({ lines, now: Date.now() });
  } catch (err) {
    console.error('[dash chat feed]', err);
    res.status(500).json({ error: 'feed_unavailable' });
  }
});

// The pulse: punishments, joins, leaves and moderation commands, merged and
// newest-first.
router.get('/dash/pulse', staff.requires('viewReports'), async (req, res) => {
  try {
    const since = Number(req.query.since) || 0;
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 80);
    const events = await live.pulse(since, limit);
    res.json({ events, now: Date.now() });
  } catch (err) {
    console.error('[dash pulse]', err);
    res.status(500).json({ error: 'pulse_unavailable' });
  }
});

module.exports = router;
