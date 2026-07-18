'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const mongo = require('../lib/mongo');
const staff = require('../lib/staff');
const audit = require('../lib/audit');
const links = require('../lib/links');
const actions = require('../lib/actions');
const broadcasts = require('../lib/broadcasts');
const discordtasks = require('../lib/discordtasks');
const playersLib = require('../lib/players');
const phoenix = require('../lib/phoenix');
const punishments = require('../lib/punishments');
const { cached, invalidate } = require('../lib/cache');

// Reaching into the game from Spielplatz: punishments, and the rank ladder.
//
// Nothing here writes to Phoenix. It queues jobs that MoreFeatures executes
// through the core's own API — see lib/actions for why that indirection is the
// point rather than an inconvenience.
//
// Note what this changes about an older decision. The dashboard used to be
// website-side by design: it could hide a player from a leaderboard and nothing
// more, on the reasoning that a row written behind Phoenix's back would not
// reach anybody. That reasoning was right, and the conclusion is now out of date
// — the queue does not write behind Phoenix's back, it asks Phoenix to do it.

const json = express.json({ limit: '32kb' });

const MAX_REASON = 200;

// A permanent ban and a five-minute mute are not the same decision, so they are
// not the same permission. See NEEDS in lib/staff.
function needFor(type, permanent) {
  if (type === 'blacklist') return 'banPlayers';
  if (type === 'ban' && permanent) return 'banPlayers';
  return 'punishPlayers';
}

/**
 * The Minecraft account this moderator has proved they own, if any.
 *
 * Phoenix records `issuedBy` as a UUID, so a moderator who has not linked an
 * account cannot be named in the core's own history — their punishments show as
 * Console there. They are still named in our audit log, which is the record that
 * actually answers "who did this", so an unlinked moderator is allowed. It is
 * worth linking; it is not worth blocking a ban over.
 */
async function actorUuid(req) {
  try {
    const link = await links.linkFor(req.session.discord.id);
    return link ? link.uuid : null;
  } catch {
    return null;
  }
}

function label(req) {
  const d = req.session.discord;
  return `${d.globalName || d.username} (${d.id})`;
}

// Discord role names equal Phoenix rank names everywhere but two: Phoenix's Dev
// and Tester are Discord's Developer and Beta-Tester. The bot's roleSync carries
// the same two aliases (ROLE_KEY_TO_RANK) — keep them in step. Returns the
// Discord role id that stands for a Phoenix rank, or null when the rank lives
// only in game (Owner, and the purchase ranks) and so cannot be set from here.
const DISCORD_RANK_ALIAS = { Developer: 'Dev', 'Beta-Tester': 'Tester' };
function discordRoleForRank(rankName) {
  for (const [roleName, id] of Object.entries(config.discord.rankRoles)) {
    if ((DISCORD_RANK_ALIAS[roleName] || roleName) === rankName) return id;
  }
  return null;
}

// --- punishing --------------------------------------------------------------

// Guarded at punishPlayers, the lower of the two, and then re-checked below
// against what was actually asked for. Doing it in one middleware would mean
// either a moderator cannot open the form or a moderator can issue a permanent
// ban — the check has to see the duration to be the right check.
router.post('/dash/punish', staff.requires('punishPlayers'), json, async (req, res) => {
  const type = String(req.body?.type || '').toLowerCase();
  if (!['ban', 'mute', 'kick', 'blacklist'].includes(type)) {
    return res.status(400).json({ error: 'bad_type' });
  }

  const permanent = !!req.body?.permanent;
  const need = needFor(type, permanent);
  if (!req.staff.abilities[need]) return res.status(403).json({ error: 'forbidden', need });

  const reason = String(req.body?.reason || '').trim().slice(0, MAX_REASON);
  if (!reason) return res.status(400).json({ error: 'reason_required' });

  // A kick happens once and has no length; a permanent punishment has no length
  // either. Everything else needs one, and Phoenix will not take longer than its
  // own configured ceiling.
  let durationMs = 0;
  if (type !== 'kick' && !permanent) {
    durationMs = Number(req.body?.durationMs) || 0;
    if (durationMs <= 0) return res.status(400).json({ error: 'duration_required' });
    if (durationMs > actions.MAX_TEMP_MS) return res.status(400).json({ error: 'duration_too_long' });
  }

  try {
    const identity = await playersLib.byName(String(req.body?.name || '').trim());
    if (!identity) return res.status(404).json({ error: 'unknown_player' });

    // Refusing to punish somebody who outranks you, decided by Phoenix's own
    // ladder rather than by ours. Without this, a helper with the button can ban
    // an admin, and the first anyone knows about it is the admin not being able
    // to log in.
    const roster = await cached('roster', 60000, phoenix.roster).catch(() => []);
    const target = roster.find((p) => p.uuid === identity.uuid);
    if (target?.top?.staff && req.staff.tier < staff.TIER.Admin) {
      return res.status(403).json({ error: 'target_is_staff' });
    }

    const id = await actions.enqueue({
      action: type,
      targetUuid: identity.uuid,
      targetName: identity.name,
      durationMs,
      permanent: type === 'kick' ? false : permanent,
      reason,
      silent: !!req.body?.silent,
      actorUuid: await actorUuid(req),
      actorLabel: label(req),
    });

    await audit.record(req, `punish.${type}`, identity.uuid, {
      name: identity.name,
      reason,
      permanent,
      durationMs,
      jobId: id,
    });
    res.status(202).json({ ok: true, jobId: id });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash punish]', err);
    res.status(500).json({ error: 'punish_failed' });
  }
});

// Lifting one. Keyed by the punishment's own ID rather than by player: a player
// can be muted and banned at once, and "undo the punishment" has to say which.
router.post('/dash/punish/:pid/revoke', staff.requires('punishPlayers'), json, async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, MAX_REASON);
  if (!reason) return res.status(400).json({ error: 'reason_required' });

  try {
    const doc = await (await mongo.phoenix.punishments()).findOne({ punishmentID: req.params.pid });
    if (!doc) return res.status(404).json({ error: 'unknown_punishment' });
    if (!punishments.isLive(doc)) return res.status(409).json({ error: 'not_live' });

    // Undoing a permanent ban is the same weight of decision as issuing one.
    if ((doc.permanent || String(doc.punishmentType).toUpperCase() === 'BLACKLIST')
        && !req.staff.abilities.banPlayers) {
      return res.status(403).json({ error: 'forbidden', need: 'banPlayers' });
    }

    const id = await actions.enqueue({
      action: 'revoke',
      targetUuid: doc.target,
      punishmentId: doc.punishmentID,
      reason,
      actorUuid: await actorUuid(req),
      actorLabel: label(req),
    });

    await audit.record(req, 'punish.revoke', doc.punishmentID, {
      type: doc.punishmentType,
      reason,
      jobId: id,
    });
    res.status(202).json({ ok: true, jobId: id });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash revoke]', err);
    res.status(500).json({ error: 'revoke_failed' });
  }
});

// --- ranks ------------------------------------------------------------------

// What can be handed out, so the console offers real ranks rather than a text
// box somebody can typo a network into.
router.get('/dash/ranks', staff.requires('manageRanks'), async (req, res) => {
  try {
    const ranks = await (await mongo.phoenix.ranks()).find({}).toArray();
    res.json(
      ranks
        .map(phoenix.shapeRank)
        .sort((a, b) => b.priority - a.priority)
        .map((r) => ({ id: r.id, name: r.name, color: r.color, staff: r.staff, priority: r.priority })),
    );
  } catch (err) {
    console.error('[dash ranks]', err);
    res.status(500).json({ error: 'ranks_unavailable' });
  }
});

// Promote and demote.
//
// This does NOT grant in Phoenix. Discord is the source of truth for ranks (see
// the bot's roleSync), so promoting somebody means adding their Discord role and
// letting the sync carry it into the game — which is also what posts the same
// announcement embed the network has always had. Granting in Phoenix here would
// make Discord and the game disagree, and the next sync would notice and undo
// it. So the request is handed to the bot, and it needs a linked account to
// have a Discord role to change at all.
router.post('/dash/grant', staff.requires('manageRanks'), json, async (req, res) => {
  const mode = String(req.body?.mode || 'grant');
  if (!['grant', 'ungrant'].includes(mode)) return res.status(400).json({ error: 'bad_mode' });

  const rankName = String(req.body?.rank || '').trim();
  if (!rankName) return res.status(400).json({ error: 'rank_required' });

  const reason = String(req.body?.reason || '').trim().slice(0, MAX_REASON);
  if (!reason) return res.status(400).json({ error: 'reason_required' });

  try {
    const rankDoc = await (await mongo.phoenix.ranks()).findOne({ name: rankName });
    if (!rankDoc) return res.status(404).json({ error: 'unknown_rank' });
    const rank = phoenix.shapeRank(rankDoc);

    const identity = await playersLib.byName(String(req.body?.name || '').trim());
    if (!identity) return res.status(404).json({ error: 'unknown_player' });

    // The rank has to have a Discord role, or there is nothing for Discord — the
    // source — to hold. Owner and the purchase ranks have none; those are granted
    // in game, not from here. Uses the alias map so Dev and Tester resolve.
    if (!discordRoleForRank(rankName)) {
      return res.status(400).json({ error: 'rank_not_on_discord' });
    }

    // The target must have linked their Discord, because a promotion is a Discord
    // role change and we need the account to change it on.
    const targetLink = await (async () => {
      try {
        const rows = await require('../lib/sql').query(
          'phoenix',
          'SELECT `discord_id` FROM `account_links` WHERE `uuid` = ? LIMIT 1',
          [identity.uuid],
        );
        return rows[0]?.discord_id || null;
      } catch { return null; }
    })();
    if (!targetLink) return res.status(409).json({ error: 'target_not_linked' });

    // You cannot hand out a rank at or above your own standing. Phoenix's own
    // priorities decide, so this stays true when the ladder changes — and it is
    // what stops "promote" being a way to make yourself Owner.
    const mine = await actorUuid(req);
    const roster = await cached('roster', 60000, phoenix.roster).catch(() => []);
    const me = mine ? roster.find((p) => p.uuid === mine) : null;
    const myPriority = me?.top?.priority ?? 0;
    if (rank.priority >= myPriority && req.staff.tier < staff.TIER.Management) {
      return res.status(403).json({ error: 'rank_too_high', yours: myPriority, theirs: rank.priority });
    }

    const id = await discordtasks.enqueue({
      action: mode === 'grant' ? 'role_add' : 'role_remove',
      discordId: targetLink,
      rankName: rank.name,
      reason,
      actorLabel: label(req),
    });

    await audit.record(req, `rank.${mode}`, identity.uuid, {
      name: identity.name,
      rank: rank.name,
      reason,
      taskId: id,
    });
    // The roster is cached, and a promotion nobody can see for a minute reads
    // like one that did not take.
    invalidate();
    res.status(202).json({ ok: true, taskId: id, via: 'discord' });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'bot_missing' });
    console.error('[dash grant]', err);
    res.status(500).json({ error: 'grant_failed' });
  }
});

// --- broadcasting -----------------------------------------------------------

// A message to everyone in game (or everyone on staff). The plugin fans it out
// to every server; this only writes it down and records who sent it.
router.post('/dash/broadcast', staff.requires('broadcast'), json, async (req, res) => {
  const kind = String(req.body?.kind || 'all');
  if (!broadcasts.KINDS.has(kind)) return res.status(400).json({ error: 'bad_kind' });

  const message = String(req.body?.message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 512);
  if (!message) return res.status(400).json({ error: 'message_required' });

  try {
    const id = await broadcasts.enqueue({ kind, message, actorLabel: label(req) });
    await audit.record(req, `broadcast.${kind}`, 'network', { message, id });
    res.status(202).json({ ok: true, id });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash broadcast]', err);
    res.status(500).json({ error: 'broadcast_failed' });
  }
});

router.get('/dash/broadcasts', staff.requires('broadcast'), async (req, res) => {
  try {
    const list = await broadcasts.recent(20);
    res.json({ installed: list !== null, broadcasts: list || [] });
  } catch (err) {
    console.error('[dash broadcasts]', err);
    res.status(500).json({ error: 'broadcasts_unavailable' });
  }
});

// --- what the game did with it ---------------------------------------------

router.get('/dash/actions', staff.requires('viewReports'), async (req, res) => {
  try {
    const list = await actions.recent(50);
    // null, not []: "the plugin is not deployed" and "nothing has been done yet"
    // look identical in an empty list and mean completely different things.
    res.json({ installed: list !== null, actions: list || [] });
  } catch (err) {
    console.error('[dash actions]', err);
    res.status(500).json({ error: 'actions_unavailable' });
  }
});

router.get('/dash/actions/:id', staff.requires('viewReports'), async (req, res) => {
  try {
    const row = await actions.status(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    console.error('[dash action]', err);
    res.status(500).json({ error: 'action_unavailable' });
  }
});

// The Discord side of a promote/demote — whether the bot has changed the role
// yet. The in-game rank follows from the sync a moment after.
router.get('/dash/grant/:id', staff.requires('manageRanks'), async (req, res) => {
  try {
    const row = await discordtasks.status(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    console.error('[dash grant status]', err);
    res.status(500).json({ error: 'status_unavailable' });
  }
});

module.exports = router;
