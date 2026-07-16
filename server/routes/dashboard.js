'use strict';

const express = require('express');
const router = express.Router();

const mongo = require('../lib/mongo');
const staff = require('../lib/staff');
const playersLib = require('../lib/players');
const { invalidate } = require('../lib/cache');

// The staff dashboard's API. Everything here is website-side by design: no ban,
// kick or mute. Phoenix holds punishments in memory and syncs them over Redis,
// so a row written behind its back would not reach a player who is online and
// could be overwritten by the plugin that owns it. Punishments stay in-game,
// where the core's own code path does them properly.
//
// What this can do is what the website owns: what gets shown, and what arrives
// through the website's own forms.

const json = express.json({ limit: '32kb' });

function actor(req) {
  return {
    id: req.session.discord.id,
    name: req.session.discord.globalName || req.session.discord.username,
    ranks: req.staff.ranks,
  };
}

async function audit(req, action, subject, extra = {}) {
  try {
    await (await mongo.site.audit()).insertOne({
      at: Date.now(),
      action,
      subject,
      by: actor(req),
      ...extra,
    });
  } catch (err) {
    // An unwritten audit line must not silently accompany a completed action.
    console.error('[audit] FAILED to record', action, subject, err.message);
  }
}

// --- what the dashboard shows itself ---------------------------------------

router.get('/dash/summary', staff.requires('viewReports'), async (req, res) => {
  try {
    const [apps, reports, appeals, hidden] = await Promise.all([
      (await mongo.site.applications()).countDocuments({ status: 'pending' }),
      (await mongo.site.reports()).countDocuments({ status: 'open' }),
      (await mongo.site.appeals()).countDocuments({ status: 'open' }),
      (await mongo.site.hidden()).countDocuments({}),
    ]);
    res.json({ you: { ranks: req.staff.ranks, tier: req.staff.tier, can: req.staff.abilities }, pending: { applications: apps, reports, appeals, hidden } });
  } catch (err) {
    console.error('[dash summary]', err);
    res.status(500).json({ error: 'summary_unavailable' });
  }
});

// --- applications ----------------------------------------------------------

router.get('/dash/applications', staff.requires('viewApplications'), async (req, res) => {
  const status = String(req.query.status || 'pending');
  try {
    const list = await (await mongo.site.applications())
      .find(status === 'all' ? {} : { status })
      .sort({ submittedAt: -1 })
      .limit(200)
      .toArray();
    res.json(list);
  } catch (err) {
    console.error('[dash applications]', err);
    res.status(500).json({ error: 'applications_unavailable' });
  }
});

router.post('/dash/applications/:id', staff.requires('reviewApplications'), json, async (req, res) => {
  const decision = String(req.body?.decision || '');
  if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ error: 'bad_decision' });
  try {
    const col = await mongo.site.applications();
    const found = await col.findOne({ _id: req.params.id });
    if (!found) return res.status(404).json({ error: 'not_found' });
    if (found.status !== 'pending') return res.status(409).json({ error: 'already_reviewed', status: found.status });

    await col.updateOne(
      { _id: req.params.id, status: 'pending' },
      {
        $set: {
          status: decision,
          reviewedAt: Date.now(),
          reviewedBy: actor(req),
          note: String(req.body?.note || '').trim().slice(0, 1000) || null,
        },
      },
    );
    await audit(req, `application.${decision}`, req.params.id, { role: found.role, applicant: found.discordName });
    // Accepting an application does not grant the rank: that is Discord's and
    // Phoenix's job, and quietly granting from here would put a third hand on
    // the ladder. It records the decision; a human still promotes.
    res.json({ ok: true, granted: false });
  } catch (err) {
    console.error('[dash review]', err);
    res.status(500).json({ error: 'review_failed' });
  }
});

// --- reports ---------------------------------------------------------------

router.get('/dash/reports', staff.requires('viewReports'), async (req, res) => {
  const status = String(req.query.status || 'open');
  try {
    const list = await (await mongo.site.reports())
      .find(status === 'all' ? {} : { status })
      .sort({ filedAt: -1 })
      .limit(200)
      .toArray();
    res.json(list);
  } catch (err) {
    console.error('[dash reports]', err);
    res.status(500).json({ error: 'reports_unavailable' });
  }
});

router.post('/dash/reports/:id', staff.requires('resolveReports'), json, async (req, res) => {
  const outcome = String(req.body?.outcome || '');
  if (!['punished', 'rejected', 'duplicate'].includes(outcome)) return res.status(400).json({ error: 'bad_outcome' });
  try {
    const col = await mongo.site.reports();
    const r = await col.updateOne(
      { _id: req.params.id, status: 'open' },
      { $set: { status: 'closed', outcome, resolvedAt: Date.now(), resolvedBy: actor(req) } },
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'not_found_or_closed' });
    await audit(req, `report.${outcome}`, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[dash resolve]', err);
    res.status(500).json({ error: 'resolve_failed' });
  }
});

// --- appeals ---------------------------------------------------------------

router.get('/dash/appeals', staff.requires('viewAppeals'), async (req, res) => {
  const status = String(req.query.status || 'open');
  try {
    const list = await (await mongo.site.appeals())
      .find(status === 'all' ? {} : { status })
      .sort({ filedAt: -1 })
      .limit(200)
      .toArray();
    res.json(list);
  } catch (err) {
    console.error('[dash appeals]', err);
    res.status(500).json({ error: 'appeals_unavailable' });
  }
});

router.post('/dash/appeals/:id', staff.requires('resolveAppeals'), json, async (req, res) => {
  const outcome = String(req.body?.outcome || '');
  if (!['granted', 'denied'].includes(outcome)) return res.status(400).json({ error: 'bad_outcome' });
  try {
    const col = await mongo.site.appeals();
    const r = await col.updateOne(
      { _id: req.params.id, status: 'open' },
      {
        $set: {
          status: 'closed',
          outcome,
          resolvedAt: Date.now(),
          resolvedBy: actor(req),
          note: String(req.body?.note || '').trim().slice(0, 1000) || null,
        },
      },
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'not_found_or_closed' });
    await audit(req, `appeal.${outcome}`, req.params.id);
    // Granting an appeal records the decision. The unban itself is still an
    // in-game action, for the same reason nothing here bans.
    res.json({ ok: true, unbanned: false });
  } catch (err) {
    console.error('[dash appeal]', err);
    res.status(500).json({ error: 'appeal_failed' });
  }
});

// --- hiding players --------------------------------------------------------

router.get('/dash/hidden', staff.requires('hidePlayers'), async (req, res) => {
  try {
    res.json(await (await mongo.site.hidden()).find({}).sort({ at: -1 }).toArray());
  } catch (err) {
    console.error('[dash hidden]', err);
    res.status(500).json({ error: 'hidden_unavailable' });
  }
});

router.post('/dash/hidden', staff.requires('hidePlayers'), json, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'missing_name' });
  try {
    const identity = await playersLib.byName(name);
    if (!identity) return res.status(404).json({ error: 'unknown_player' });

    await (await mongo.site.hidden()).updateOne(
      { _id: identity.uuid },
      {
        $set: {
          _id: identity.uuid,
          name: identity.name,
          reason: String(req.body?.reason || '').trim().slice(0, 500) || null,
          at: Date.now(),
          by: actor(req),
        },
      },
      { upsert: true },
    );
    await audit(req, 'player.hidden', identity.uuid, { name: identity.name });
    // The lists are cached, so a hide that only takes effect in 20 seconds looks
    // like it did not work and gets clicked again.
    invalidate();
    res.json({ ok: true, uuid: identity.uuid, name: identity.name });
  } catch (err) {
    console.error('[dash hide]', err);
    res.status(500).json({ error: 'hide_failed' });
  }
});

router.delete('/dash/hidden/:uuid', staff.requires('hidePlayers'), async (req, res) => {
  try {
    const r = await (await mongo.site.hidden()).deleteOne({ _id: req.params.uuid });
    if (!r.deletedCount) return res.status(404).json({ error: 'not_hidden' });
    await audit(req, 'player.unhidden', req.params.uuid);
    invalidate();
    res.json({ ok: true });
  } catch (err) {
    console.error('[dash unhide]', err);
    res.status(500).json({ error: 'unhide_failed' });
  }
});

// --- audit -----------------------------------------------------------------

router.get('/dash/audit', staff.requires('reviewApplications'), async (req, res) => {
  try {
    res.json(await (await mongo.site.audit()).find({}).sort({ at: -1 }).limit(100).toArray());
  } catch (err) {
    console.error('[dash audit]', err);
    res.status(500).json({ error: 'audit_unavailable' });
  }
});

module.exports = router;
