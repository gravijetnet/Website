'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const mongo = require('../lib/mongo');
const playersLib = require('../lib/players');

// Ban appeals. Filed against a punishment id — Phoenix prints one when it bans
// you (`punishmentID`, e.g. PFEYT4), so asking for it costs an honest appellant
// nothing and stops the box filling with "i was banned pls unban".

const MAX_TEXT = 4000;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Looked up rather than trusted: an appeal against a punishment that does not
// exist wastes a moderator's time, and one against somebody else's is worse.
async function findPunishment(id) {
  try {
    return await (await mongo.phoenix.punishments()).findOne({ punishmentID: String(id).toUpperCase() });
  } catch {
    return null;
  }
}

router.post('/appeal', express.json({ limit: '32kb' }), async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });

  const punishmentId = String(req.body?.punishmentId || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim().slice(0, MAX_TEXT);

  if (!punishmentId || !reason) return res.status(400).json({ error: 'missing_fields' });
  if (reason.length < 30) return res.status(400).json({ error: 'reason_too_short' });

  try {
    const punishment = await findPunishment(punishmentId);
    if (!punishment) return res.status(404).json({ error: 'unknown_punishment', punishmentId });
    if (!punishment.active) return res.status(409).json({ error: 'not_active' });

    const col = await mongo.site.appeals();

    // One open appeal per punishment: appealing twice does not double the odds,
    // it only doubles the reading.
    const open = await col.findOne({ punishmentId, status: 'open' });
    if (open) return res.status(409).json({ error: 'already_open' });

    const last = await col.findOne({ punishmentId }, { sort: { filedAt: -1 } });
    if (last && Date.now() - last.filedAt < COOLDOWN_MS) {
      return res.status(429).json({ error: 'cooldown', retryAt: last.filedAt + COOLDOWN_MS });
    }

    const target = await playersLib.byUuid(punishment.target);
    const doc = {
      _id: crypto.randomUUID(),
      status: 'open',
      punishmentId,
      punishment: {
        type: punishment.punishmentType,
        reason: punishment.reason || null,
        issuedAt: Number(punishment.issuedAt) || null,
        permanent: !!punishment.permanent,
      },
      target: { uuid: punishment.target, name: target?.name || null },
      reason,
      discordId: req.session.discord.id,
      discordName: req.session.discord.globalName || req.session.discord.username,
      filedAt: Date.now(),
      resolvedAt: null,
      resolvedBy: null,
      outcome: null,
      note: null,
    };
    await col.insertOne(doc);
    res.status(201).json({ ok: true, id: doc._id });
  } catch (err) {
    console.error('[appeal]', err);
    res.status(500).json({ error: 'appeal_unavailable' });
  }
});

module.exports = router;
