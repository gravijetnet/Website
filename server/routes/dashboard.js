'use strict';

const express = require('express');
const router = express.Router();

const mongo = require('../lib/mongo');
const staff = require('../lib/staff');
const playersLib = require('../lib/players');
const phoenix = require('../lib/phoenix');
const links = require('../lib/links');
const punishments = require('../lib/punishments');
const { invalidate, cached } = require('../lib/cache');

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
    const [apps, reports, appeals, hiddenCount] = await Promise.all([
      (await mongo.site.applications()).countDocuments({ status: 'pending' }),
      (await mongo.site.reports()).countDocuments({ status: 'open' }),
      (await mongo.site.appeals()).countDocuments({ status: 'open' }),
      (await mongo.site.hidden()).countDocuments({}),
    ]);
    res.json({
      you: { ranks: req.staff.ranks, tier: req.staff.tier, can: req.staff.abilities },
      pending: { applications: apps, reports, appeals, hidden: hiddenCount },
    });
  } catch (err) {
    console.error('[dash summary]', err);
    res.status(500).json({ error: 'summary_unavailable' });
  }
});

// The queue: everything waiting on a human, oldest first, in one list.
//
// The tabs answer "show me the reports"; this answers the question staff
// actually arrive with, which is "what should I do now". Sorting by age across
// all three types is the point — an appeal that has sat for a week outranks a
// report filed this morning, and no per-tab view can show you that.
router.get('/dash/queue', staff.requires('viewReports'), async (req, res) => {
  const can = req.staff.abilities;
  try {
    const [apps, reports, appeals] = await Promise.all([
      can.viewApplications
        ? (await mongo.site.applications()).find({ status: 'pending' }).sort({ submittedAt: 1 }).limit(50).toArray()
        : [],
      (await mongo.site.reports()).find({ status: 'open' }).sort({ filedAt: 1 }).limit(50).toArray(),
      can.viewAppeals
        ? (await mongo.site.appeals()).find({ status: 'open' }).sort({ filedAt: 1 }).limit(50).toArray()
        : [],
    ]);

    const items = [
      ...apps.map((a) => ({
        kind: 'application',
        id: a._id,
        at: a.submittedAt,
        title: `${a.roleLabel} — ${a.discordName}`,
        detail: null,
        href: '/applications',
      })),
      ...reports.map((r) => ({
        kind: 'report',
        id: r._id,
        at: r.filedAt,
        title: `${r.target?.name || 'unknown'} — ${r.categoryLabel}`,
        detail: r.detail,
        href: '/reports',
      })),
      ...appeals.map((a) => ({
        kind: 'appeal',
        id: a._id,
        at: a.filedAt,
        title: `${a.target?.name || a.punishmentId} — ${a.punishment?.type || 'punishment'}`,
        detail: a.reason,
        href: '/appeals',
      })),
    ].sort((a, b) => (a.at || 0) - (b.at || 0));

    res.json({ items });
  } catch (err) {
    console.error('[dash queue]', err);
    res.status(500).json({ error: 'queue_unavailable' });
  }
});

// Numbers about the network itself, for the console's landing page. Cached: this
// counts whole collections and is refreshed by staff hitting F5, not by anything
// that needs to be true to the second.
async function networkStats() {
  const [roster, punishmentTotal, live, linkCount, reports, appeals, apps] = await Promise.all([
    cached('roster', 60000, phoenix.roster).catch(() => []),
    (await mongo.phoenix.punishments()).countDocuments({}).catch(() => 0),
    // Not `active: true`: that counts every kick ever handed out, and would have
    // told the console eight people were restricted when the real number was
    // one. See lib/punishments.
    punishments.countLive(await mongo.phoenix.punishments()).catch(() => 0),
    links.count().catch(() => null),
    (await mongo.site.reports()).countDocuments({}).catch(() => 0),
    (await mongo.site.appeals()).countDocuments({}).catch(() => 0),
    (await mongo.site.applications()).countDocuments({}).catch(() => 0),
  ]);

  return {
    ranked: roster.length,
    staff: roster.filter((p) => p.top?.staff).length,
    punishments: punishmentTotal,
    activePunishments: live,
    links: linkCount,
    reports,
    appeals,
    applications: apps,
  };
}

router.get('/dash/stats', staff.requires('viewReports'), async (req, res) => {
  try {
    res.json(await cached('dash:stats', 30000, networkStats));
  } catch (err) {
    console.error('[dash stats]', err);
    res.status(500).json({ error: 'stats_unavailable' });
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

// --- looking a player up ---------------------------------------------------

// Everything the network knows about one player, in one answer: who they are,
// what they hold, what they have been punished for, who they also play as, and
// whether the website is hiding them.
//
// This is the tool a report is actually worked with. Without it, judging "is
// this their first offence" meant asking someone in game.
router.get('/dash/player/:name', staff.requires('viewPlayers'), async (req, res) => {
  try {
    const identity = await playersLib.byName(req.params.name);
    if (!identity) return res.status(404).json({ error: 'unknown_player' });

    const [roster, punishmentRows, profile, logins, isHidden] = await Promise.all([
      cached('roster', 60000, phoenix.roster).catch(() => []),
      (await mongo.phoenix.punishments()).find({ target: identity.uuid }).toArray().catch(() => []),
      (await mongo.phoenix.profiles()).findOne({ _id: identity.uuid }).catch(() => null),
      (await mongo.phoenix.logins()).find({ target: identity.uuid }).toArray().catch(() => []),
      (await mongo.site.hidden()).findOne({ _id: identity.uuid }).catch(() => null),
    ]);

    const entry = roster.find((p) => p.uuid === identity.uuid);

    // Alts are the core's own conclusion (it matches on the hashed IP), so this
    // reports them rather than working them out again — and resolves the UUIDs
    // to names, which is the only reason the list is worth showing.
    const altUuids = Array.isArray(profile?.alts) ? profile.alts : [];
    const altNames = altUuids.length
      ? await (await mongo.phoenix.profiles())
          .find({ _id: { $in: altUuids } }, { projection: { name: 1 } })
          .toArray()
          .catch(() => [])
      : [];

    const now = Date.now();
    res.json({
      uuid: identity.uuid,
      name: identity.name,
      online: !!identity.online,
      playtime: identity.playtime || 0,
      lastSeen: identity.lastSeen || null,
      ranks: entry ? entry.ranks.map((r) => ({ name: r.name, color: r.color, staff: r.staff })) : [],
      hidden: isHidden ? { reason: isHidden.reason, at: isHidden.at, by: isHidden.by?.name || null } : null,
      alts: altNames.map((a) => ({ uuid: a._id, name: a.name })),
      sessions: logins.length,
      firstSeen: logins.length ? Math.min(...logins.map((l) => Number(l.login) || now)) : null,
      // Staff see shadow punishments — hiding them from the people who apply
      // them would defeat the point of having them.
      punishments: punishmentRows
        .map((p) => punishments.shape(p, now))
        .sort((a, b) => b.issuedAt - a.issuedAt),
    });
  } catch (err) {
    console.error('[dash player]', err);
    res.status(500).json({ error: 'player_unavailable' });
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

// Readable by any staff, not just the people who can act.
//
// It used to need reviewApplications, which meant the log of what staff do to
// players was visible only to the rank most able to do it. An audit trail the
// audited cannot read is not much of a check on anything; the whole point is
// that a helper can see an admin's decisions.
router.get('/dash/audit', staff.requires('viewReports'), async (req, res) => {
  const by = String(req.query.by || '').trim();
  const action = String(req.query.action || '').trim();
  const q = {};
  if (by) q['by.id'] = by;
  // Prefix match, so `application` covers accepted and rejected both. Escaped:
  // a query string must not be able to hand us a regular expression.
  if (action) q.action = new RegExp('^' + action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  try {
    const list = await (await mongo.site.audit())
      .find(q)
      .sort({ at: -1 })
      .limit(200)
      .toArray();
    res.json(list);
  } catch (err) {
    console.error('[dash audit]', err);
    res.status(500).json({ error: 'audit_unavailable' });
  }
});

module.exports = router;
