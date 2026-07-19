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
const configActions = require('../lib/config-actions');
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
  if (!['ban', 'mute', 'kick', 'blacklist', 'warn'].includes(type)) {
    return res.status(400).json({ error: 'bad_type' });
  }

  const permanent = !!req.body?.permanent;
  const need = needFor(type, permanent);
  if (!req.staff.abilities[need]) return res.status(403).json({ error: 'forbidden', need });

  const reason = String(req.body?.reason || '').trim().slice(0, MAX_REASON);
  if (!reason) return res.status(400).json({ error: 'reason_required' });

  // A kick happens once and has no length, and a warning is the same shape — a
  // thing that happened rather than a state you are in. A permanent punishment
  // has no length either. Everything else needs one, and Phoenix will not take
  // longer than its own configured ceiling.
  const instant = type === 'kick' || type === 'warn';
  let durationMs = 0;
  if (!instant && !permanent) {
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
      permanent: instant ? false : permanent,
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

// Phoenix's console, for actions that are not on anybody's behalf.
const CONSOLE_UUID = '00000000-0000-0000-0000-000000000000';

// A message to everyone in game, or a staff alert.
//
// The two take different roads on purpose. An alert is the core's own — it goes
// through Phoenix's staff channel, prefixed the way the game prefixes it, and
// Phoenix carries it to every server and proxy itself; so exactly one server may
// send it, which is what the claimed queue guarantees. A message to *everyone*
// has no such call in the core, so it stays a fan-out row that each server shows
// to its own players once.
router.post('/dash/broadcast', staff.requires('broadcast'), json, async (req, res) => {
  const kind = String(req.body?.kind || 'all');
  if (!['all', 'staff'].includes(kind)) return res.status(400).json({ error: 'bad_kind' });

  const message = String(req.body?.message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 512);
  if (!message) return res.status(400).json({ error: 'message_required' });

  try {
    const id = kind === 'staff'
      ? await actions.enqueue({
        action: 'alert',
        targetUuid: CONSOLE_UUID,
        reason: message,
        actorUuid: await actorUuid(req),
        actorLabel: label(req),
      })
      : await broadcasts.enqueue({ kind: 'all', message, actorLabel: label(req) });

    await audit.record(req, `broadcast.${kind}`, 'network', { message, id });
    res.status(202).json({ ok: true, id, via: kind === 'staff' ? 'alert' : 'broadcast' });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash broadcast]', err);
    res.status(500).json({ error: 'broadcast_failed' });
  }
});

// --- reaching one player ----------------------------------------------------
//
// Both of these are fan-out rows rather than claimed jobs: every server reads
// them and only the one the player is actually connected to acts, so nothing has
// to work out which box they are on first.

router.post('/dash/player/message', staff.requires('punishPlayers'), json, async (req, res) => {
  const message = String(req.body?.message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 512);
  if (!message) return res.status(400).json({ error: 'message_required' });
  try {
    const identity = await playersLib.byName(String(req.body?.name || '').trim());
    if (!identity) return res.status(404).json({ error: 'unknown_player' });
    const id = await broadcasts.enqueue({
      kind: 'player', message, targetUuid: identity.uuid, actorLabel: label(req),
    });
    await audit.record(req, 'player.message', identity.uuid, { name: identity.name, message, id });
    res.status(202).json({ ok: true, id });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash player message]', err);
    res.status(500).json({ error: 'message_failed' });
  }
});

router.post('/dash/player/send', staff.requires('punishPlayers'), json, async (req, res) => {
  const server = String(req.body?.server || '').trim().slice(0, 64);
  if (!server || !/^[A-Za-z0-9_-]{1,64}$/.test(server)) return res.status(400).json({ error: 'bad_server' });
  try {
    const identity = await playersLib.byName(String(req.body?.name || '').trim());
    if (!identity) return res.status(404).json({ error: 'unknown_player' });
    const id = await broadcasts.enqueue({
      kind: 'send', message: server, targetUuid: identity.uuid, actorLabel: label(req),
    });
    await audit.record(req, 'player.send', identity.uuid, { name: identity.name, server, id });
    res.status(202).json({ ok: true, id });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash player send]', err);
    res.status(500).json({ error: 'send_failed' });
  }
});

// --- the smaller powers -----------------------------------------------------
//
// None of these punish anybody, which is exactly why they are worth having: they
// are what a moderator needs when something is *stuck* rather than when somebody
// misbehaved. Two of them reach further than the rest and are gated higher.
const TOOLS = {
  logout: { need: 'punishPlayers', label: 'cleared their session' },
  cooldowns: { need: 'punishPlayers', label: 'cleared their cooldowns' },
  undisguise: { need: 'punishPlayers', label: 'removed their disguise' },
  // These two change who may get into the network at all.
  security: { need: 'manageNetwork', label: 'cleared their security hold' },
  vpn_allow: { need: 'manageNetwork', label: 'allowed them past the VPN check' },
  vpn_deny: { need: 'manageNetwork', label: 'put them back behind the VPN check' },
};

router.post('/dash/player/tool', staff.requires('punishPlayers'), json, async (req, res) => {
  const tool = String(req.body?.tool || '');
  const spec = TOOLS[tool];
  if (!spec) return res.status(400).json({ error: 'bad_tool' });
  // Re-checked against what was actually asked for, the same way a permanent ban
  // is re-checked above: the guard on the door is the lower of the two.
  if (!req.staff.abilities[spec.need]) return res.status(403).json({ error: 'forbidden', need: spec.need });

  try {
    const identity = await playersLib.byName(String(req.body?.name || '').trim());
    if (!identity) return res.status(404).json({ error: 'unknown_player' });

    const jobId = await actions.enqueue({
      action: tool,
      targetUuid: identity.uuid,
      targetName: identity.name,
      actorUuid: await actorUuid(req),
      actorLabel: label(req),
    });
    await audit.record(req, `tool.${tool}`, identity.uuid, { name: identity.name, jobId });
    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash tool]', err);
    res.status(500).json({ error: 'tool_failed' });
  }
});

// --- the dossier ------------------------------------------------------------
//
// Everything the core recorded about one player that the card does not already
// show: where they logged in from, who else has used those addresses, and any
// chat frozen as evidence. Shared addresses are how alts are actually found —
// the core's own `alts` list is a starting point, not the whole answer.
router.get('/dash/player/:name/dossier', staff.requires('viewPlayers'), async (req, res) => {
  try {
    const identity = await playersLib.byName(String(req.params.name || '').trim());
    if (!identity) return res.status(404).json({ error: 'unknown_player' });

    const loginCol = await mongo.phoenix.logins();
    const logins = await loginCol
      .find({ target: identity.uuid })
      .sort({ login: -1 })
      .limit(60)
      .toArray();

    const addresses = [...new Set(logins.map((l) => l.ip).filter(Boolean))];

    // Everyone else who has come from one of those addresses.
    const shared = addresses.length
      ? await loginCol
        .find({ ip: { $in: addresses }, target: { $ne: identity.uuid } }, { projection: { target: 1, ip: 1 } })
        .limit(500)
        .toArray()
      : [];

    const byUuid = new Map();
    for (const row of shared) {
      const entry = byUuid.get(row.target) || { uuid: row.target, addresses: new Set() };
      entry.addresses.add(row.ip);
      byUuid.set(row.target, entry);
    }
    const profiles = byUuid.size
      ? await (await mongo.phoenix.profiles())
        .find({ _id: { $in: [...byUuid.keys()] } }, { projection: { name: 1 } })
        .toArray()
      : [];
    const nameOf = new Map(profiles.map((p) => [p._id, p.name]));

    const snapshots = await (await mongo.phoenix.chatSnapshots())
      .find({ 'chat.uuid': identity.uuid }, { projection: { niceId: 1, createdOn: 1, requestedBy: 1 } })
      .sort({ createdOn: -1 })
      .limit(20)
      .toArray();

    res.json({
      name: identity.name,
      uuid: identity.uuid,
      logins: logins.map((l) => ({
        ip: l.ip || null,
        login: Number(l.login) || null,
        logout: Number(l.logout) || null,
      })),
      addresses,
      sharedWith: [...byUuid.values()]
        .map((e) => ({ uuid: e.uuid, name: nameOf.get(e.uuid) || null, addresses: [...e.addresses] }))
        .filter((e) => e.name)
        .sort((a, b) => b.addresses.length - a.addresses.length),
      snapshots: snapshots.map((s) => ({
        id: s.niceId || String(s._id),
        at: Number(s.createdOn) || null,
        requestedBy: s.requestedBy || null,
      })),
    });
  } catch (err) {
    console.error('[dash dossier]', err);
    res.status(500).json({ error: 'dossier_unavailable' });
  }
});

// One frozen snapshot, in full — the transcript behind a report.
router.get('/dash/snapshot/:id', staff.requires('viewReports'), async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const doc = await (await mongo.phoenix.chatSnapshots()).findOne({ $or: [{ niceId: id }, { _id: id }] });
    if (!doc) return res.status(404).json({ error: 'not_found' });

    const uuids = [...new Set((doc.chat || []).map((c) => c.uuid).filter(Boolean))];
    const profiles = uuids.length
      ? await (await mongo.phoenix.profiles()).find({ _id: { $in: uuids } }, { projection: { name: 1 } }).toArray()
      : [];
    const nameOf = new Map(profiles.map((p) => [p._id, p.name]));

    res.json({
      id: doc.niceId || String(doc._id),
      at: Number(doc.createdOn) || null,
      lines: (doc.chat || []).map((c) => ({
        by: nameOf.get(c.uuid) || null,
        at: Number(c.time) || null,
        // The core stores these already coloured, with § codes.
        message: c.message || '',
      })),
    });
  } catch (err) {
    console.error('[dash snapshot]', err);
    res.status(500).json({ error: 'snapshot_unavailable' });
  }
});

// Freeze the chat around a player, right now, as evidence.
router.post('/dash/player/snapshot', staff.requires('viewReports'), json, async (req, res) => {
  try {
    const identity = await playersLib.byName(String(req.body?.name || '').trim());
    if (!identity) return res.status(404).json({ error: 'unknown_player' });
    const jobId = await actions.enqueue({
      action: 'snapshot',
      targetUuid: identity.uuid,
      targetName: identity.name,
      actorUuid: await actorUuid(req),
      actorLabel: label(req),
    });
    await audit.record(req, 'player.snapshot', identity.uuid, { name: identity.name, jobId });
    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash snapshot create]', err);
    res.status(500).json({ error: 'snapshot_failed' });
  }
});

// --- the console runner -----------------------------------------------------

// Any command, as console, on one named server. This is the escape hatch for
// everything Phoenix can do that has no API — and the most dangerous thing here,
// so it is Management only and every line is in the audit under a real name.
router.post('/dash/server/command', staff.requires('runCommands'), json, async (req, res) => {
  const server = String(req.body?.server || '').trim().slice(0, 64);
  if (!server || !/^[A-Za-z0-9_-]{1,64}$/.test(server)) return res.status(400).json({ error: 'bad_server' });
  const command = String(req.body?.command || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 255);
  if (!command) return res.status(400).json({ error: 'command_required' });

  try {
    const jobId = await actions.enqueue({
      action: 'command',
      targetUuid: CONSOLE_UUID,
      reason: command,
      targetServer: server,
      actorUuid: await actorUuid(req),
      actorLabel: label(req),
    });
    await audit.record(req, 'server.command', server, { command, jobId });
    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash command]', err);
    res.status(500).json({ error: 'command_failed' });
  }
});

// --- restarts ---------------------------------------------------------------

// A restart happens where it is run, so this is the one job that names a server:
// only that box may claim it. The countdown is the core's own, so players get the
// warnings they already know.
router.post('/dash/server/reboot', staff.requires('manageNetwork'), json, async (req, res) => {
  const server = String(req.body?.server || '').trim().slice(0, 64);
  if (!server || !/^[A-Za-z0-9_-]{1,64}$/.test(server)) return res.status(400).json({ error: 'bad_server' });
  const cancel = req.body?.cancel === true || req.body?.cancel === 'true';

  // Up to a day out. Anything longer is somebody typing into the wrong box.
  const seconds = Math.trunc(Number(req.body?.seconds));
  if (!cancel && (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400)) {
    return res.status(400).json({ error: 'bad_delay' });
  }

  try {
    const jobId = await actions.enqueue({
      action: cancel ? 'reboot_cancel' : 'reboot',
      targetUuid: CONSOLE_UUID,
      durationMs: cancel ? 0 : seconds * 1000,
      targetServer: server,
      actorUuid: await actorUuid(req),
      actorLabel: label(req),
    });
    await audit.record(req, cancel ? 'server.reboot_cancel' : 'server.reboot', server, { seconds, jobId });
    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash reboot]', err);
    res.status(500).json({ error: 'reboot_failed' });
  }
});

// --- the network, as it is right now ---------------------------------------

// Each server publishes its own row every ten seconds (see ServerPublisher). A
// row nobody has touched in a minute is a server that stopped, which is worth
// showing as plainly as one that is up.
router.get('/dash/servers', staff.requires('viewReports'), async (req, res) => {
  try {
    const sqlLib = require('../lib/sql');
    const COLUMNS = '`name`, `server_group`, `online`, `max_players`, `whitelisted`, `updated_at`';
    const EXTRA = '`players`, `tps`, `heap_used`, `heap_max`, `uptime_ms`';
    let rows;
    try {
      rows = await sqlLib.query(
        'phoenix',
        `SELECT ${COLUMNS}, ${EXTRA} FROM \`network_servers\` ORDER BY \`server_group\`, \`name\``,
      );
    } catch (e) {
      // A server still on an older build publishes the basics and none of the
      // rest; the page then simply has less to show rather than erroring.
      if (!(e && (e.code === 'ER_BAD_FIELD_ERROR' || e.errno === 1054))) throw e;
      rows = await sqlLib.query(
        'phoenix',
        `SELECT ${COLUMNS} FROM \`network_servers\` ORDER BY \`server_group\`, \`name\``,
      );
    }
    const now = Date.now();
    res.json({
      installed: true,
      servers: rows.map((r) => {
        const at = new Date(r.updated_at).getTime();
        return {
          name: r.name,
          group: r.server_group || null,
          online: Number(r.online) || 0,
          max: Number(r.max_players) || 0,
          whitelisted: !!r.whitelisted,
          players: String(r.players || '').split('\n').map((s) => s.trim()).filter(Boolean),
          // What the server itself reports about its own health. The panel can
          // say what a container was allocated; only this says whether the
          // server inside it is keeping up.
          tps: r.tps === undefined ? null : Number(r.tps) || 0,
          heap: r.heap_max ? { used: Number(r.heap_used) || 0, max: Number(r.heap_max) || 0 } : null,
          uptimeMs: r.uptime_ms === undefined ? null : Number(r.uptime_ms) || 0,
          updatedAt: at,
          up: now - at < 60000,
        };
      }),
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146) {
      return res.json({ installed: false, servers: [] });
    }
    console.error('[dash servers]', err);
    res.status(500).json({ error: 'servers_unavailable' });
  }
});

// --- maintenance ------------------------------------------------------------

// The switch that closes the network. Who still gets through is the core's
// decision (it has a whitelist rank for exactly that) — this only flips it.
router.post('/dash/maintenance', staff.requires('manageNetwork'), json, async (req, res) => {
  const on = req.body?.on === true || req.body?.on === 'true';
  try {
    const jobId = await configActions.enqueue({
      action: on ? 'whitelist_on' : 'whitelist_off',
      subject: 'network',
      payload: '',
      actorUuid: null,
      actorLabel: label(req),
    });
    await audit.record(req, `maintenance.${on ? 'on' : 'off'}`, 'network', { jobId });
    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash maintenance]', err);
    res.status(500).json({ error: 'maintenance_failed' });
  }
});

router.post('/dash/whitelist', staff.requires('manageNetwork'), json, async (req, res) => {
  const add = req.body?.add === true || req.body?.add === 'true';
  const name = String(req.body?.name || '').trim().slice(0, 32);
  if (!name || !/^[A-Za-z0-9_]{1,32}$/.test(name)) return res.status(400).json({ error: 'bad_name' });
  try {
    const jobId = await configActions.enqueue({
      action: add ? 'whitelist_add' : 'whitelist_remove',
      subject: name,
      payload: '',
      actorUuid: null,
      actorLabel: label(req),
    });
    await audit.record(req, `whitelist.${add ? 'add' : 'remove'}`, name, { jobId });
    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash whitelist]', err);
    res.status(500).json({ error: 'whitelist_failed' });
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
