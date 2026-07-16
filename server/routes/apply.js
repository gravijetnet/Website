'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const apps = require('../lib/applications');
const mongo = require('../lib/mongo');

// Applications are stored in our own database. The Discord bot keeps its own and
// is not written to from here — it stays exactly as it is.

const MAX_ANSWER = 2000;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

router.get('/apply', (req, res) => res.json(apps.list()));

router.get('/apply/:role', (req, res) => {
  const role = apps.role(req.params.role);
  if (!role) return res.status(404).json({ error: 'unknown_role' });
  res.json({
    key: String(req.params.role).toLowerCase(),
    label: role.label,
    blurb: role.blurb,
    questions: role.questions.map((q, i) => ({ index: i, text: q.text, long: q.long })),
  });
});

router.post('/apply/:role', express.json({ limit: '64kb' }), async (req, res) => {
  const role = apps.role(req.params.role);
  if (!role) return res.status(404).json({ error: 'unknown_role' });

  // Login is what makes this an application rather than an anonymous form: it
  // gives the answers an owner, a way to reply, and a cooldown that means
  // something.
  if (!req.session) return res.status(401).json({ error: 'login_required' });

  const answers = Array.isArray(req.body?.answers) ? req.body.answers : null;
  if (!answers || answers.length !== role.questions.length) {
    return res.status(400).json({ error: 'answer_count_mismatch' });
  }
  const clean = answers.map((a) => String(a ?? '').trim().slice(0, MAX_ANSWER));
  if (clean.some((a) => !a)) return res.status(400).json({ error: 'blank_answers' });

  const key = String(req.params.role).toLowerCase();
  const discordId = req.session.discord.id;

  try {
    const col = await mongo.site.applications();

    // One open application per role at a time, and a day between tries after a
    // rejection — otherwise "apply again" is a button, not a decision.
    const existing = await col.findOne(
      { discordId, role: key },
      { sort: { submittedAt: -1 } },
    );
    if (existing && existing.status === 'pending') {
      return res.status(409).json({ error: 'already_pending', submittedAt: existing.submittedAt });
    }
    if (existing && Date.now() - existing.submittedAt < COOLDOWN_MS) {
      return res.status(429).json({
        error: 'cooldown',
        retryAt: existing.submittedAt + COOLDOWN_MS,
      });
    }

    const doc = {
      _id: crypto.randomUUID(),
      role: key,
      roleLabel: role.label,
      status: 'pending',
      discordId,
      discordName: req.session.discord.globalName || req.session.discord.username,
      // The questions are stored beside the answers on purpose: rewording a
      // question later must not silently change what an old applicant was asked.
      qa: role.questions.map((q, i) => ({ q: q.text, a: clean[i] })),
      submittedAt: Date.now(),
      reviewedAt: null,
      reviewedBy: null,
      note: null,
    };
    await col.insertOne(doc);
    res.status(201).json({ ok: true, id: doc._id });
  } catch (err) {
    console.error('[apply]', err);
    res.status(500).json({ error: 'apply_unavailable' });
  }
});

// What the signed-in visitor has already sent, so the form can say "pending"
// instead of letting them write it all out again for nothing.
router.get('/my/applications', async (req, res) => {
  if (!req.session) return res.json([]);
  try {
    const col = await mongo.site.applications();
    const mine = await col
      .find({ discordId: req.session.discord.id })
      .project({ qa: 0 })
      .sort({ submittedAt: -1 })
      .toArray();
    res.json(mine);
  } catch (err) {
    console.error('[my applications]', err);
    res.json([]);
  }
});

module.exports = router;
