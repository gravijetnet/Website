'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const { cached } = require('../lib/cache');
const mongo = require('../lib/mongo');
const colors = require('../lib/colors');
const playersLib = require('../lib/players');

// Reports filed on the website. Written to our own database — Phoenix's
// px-reports belongs to the core and is fed by the in-game menu; a row appearing
// there from outside the game would be a row the core never made.

const MAX_TEXT = 4000;
const COOLDOWN_MS = 60 * 1000;

// The categories the network already reports on, read from its own config so the
// form cannot offer a reason the staff have no ladder for.
async function categories() {
  const [cats, ladders] = await Promise.all([
    (await mongo.phoenix.reportCategories()).find({}).toArray(),
    (await mongo.phoenix.punishmentLadders()).find({}).toArray(),
  ]);
  const ladderIds = new Set(ladders.map((l) => l._id));

  const seen = new Map();
  for (const c of cats) {
    // `Running/Camping` points at a ladder of that name, which does not exist —
    // the real one is `RunningCamping`, and a working category already points at
    // it. Offering a reason nothing can be done about wastes the reporter's
    // time, so a broken reference is dropped rather than shown.
    if (!ladderIds.has(c.punishmentLadderId)) continue;
    const label = colors.strip(c.displayName || c._id);
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, { key: c._id, label });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

router.get('/report/categories', async (req, res) => {
  try {
    res.json(await cached('report:categories', 300000, categories));
  } catch (err) {
    console.error('[report categories]', err);
    res.status(500).json({ error: 'categories_unavailable' });
  }
});

router.post('/report', express.json({ limit: '32kb' }), async (req, res) => {
  // Login is the whole anti-spam story: an anonymous report box is a box full of
  // noise, and a report nobody can be asked about is a report nobody can act on.
  if (!req.session) return res.status(401).json({ error: 'login_required' });

  const target = String(req.body?.target || '').trim();
  const categoryKey = String(req.body?.category || '').trim();
  const detail = String(req.body?.detail || '').trim().slice(0, MAX_TEXT);
  const evidence = String(req.body?.evidence || '').trim().slice(0, 500);

  if (!target || !categoryKey || !detail) return res.status(400).json({ error: 'missing_fields' });
  if (detail.length < 20) return res.status(400).json({ error: 'detail_too_short' });

  try {
    const cats = await cached('report:categories', 300000, categories);
    const category = cats.find((c) => c.key === categoryKey);
    if (!category) return res.status(400).json({ error: 'unknown_category' });

    // Reporting somebody who has never joined is almost always a typo, and it is
    // kinder to say so now than to file it and let a mod find out.
    const identity = await playersLib.byName(target);
    if (!identity) return res.status(404).json({ error: 'unknown_player', target });

    const col = await mongo.site.reports();
    const last = await col.findOne({ discordId: req.session.discord.id }, { sort: { filedAt: -1 } });
    if (last && Date.now() - last.filedAt < COOLDOWN_MS) {
      return res.status(429).json({ error: 'cooldown', retryAt: last.filedAt + COOLDOWN_MS });
    }

    const doc = {
      _id: crypto.randomUUID(),
      status: 'open',
      target: { uuid: identity.uuid, name: identity.name },
      category: category.key,
      categoryLabel: category.label,
      detail,
      evidence: evidence || null,
      discordId: req.session.discord.id,
      discordName: req.session.discord.globalName || req.session.discord.username,
      filedAt: Date.now(),
      resolvedAt: null,
      resolvedBy: null,
      outcome: null,
    };
    await col.insertOne(doc);
    res.status(201).json({ ok: true, id: doc._id });
  } catch (err) {
    console.error('[report]', err);
    res.status(500).json({ error: 'report_unavailable' });
  }
});

module.exports = router;
