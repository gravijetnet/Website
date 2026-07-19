'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const mongo = require('../lib/mongo');
const staff = require('../lib/staff');
const audit = require('../lib/audit');
const sql = require('../lib/sql');
const discordtasks = require('../lib/discordtasks');

// The Discord half of the console.
//
// The website holds no bot token and should not — so it asks. Everything here
// writes a row into `discord_tasks` and the bot performs it, which is the same
// arrangement as the game side and for the same reason: the half that holds the
// credentials is the half that acts.
//
// Discord's own rules still apply on the far side. The bot cannot kick somebody
// above it in the role order, and when it refuses, the reason it gives is what
// comes back — "the bot cannot kick them — check role order" is a fixable
// sentence; "failed" is not.

const json = express.json({ limit: '64kb' });

const SNOWFLAKE = /^[0-9]{5,32}$/;

function label(req) {
  const d = req.session.discord;
  return `${d.globalName || d.username} (${d.id})`;
}

// --- posting ---------------------------------------------------------------

// Channels worth offering by name, so nobody has to go and copy an id out of
// Discord for the everyday case. Anything not listed can still be pasted.
function knownChannels() {
  const out = [];
  const c = config.discord || {};
  for (const [key, value] of Object.entries(c)) {
    if (/channel/i.test(key) && SNOWFLAKE.test(String(value))) {
      out.push({ id: String(value), label: key.replace(/([A-Z])/g, ' $1').toLowerCase() });
    }
  }
  return out;
}

router.get('/dash/discord/channels', staff.requires('broadcast'), (req, res) => {
  res.json({ channels: knownChannels() });
});

router.post('/dash/discord/message', staff.requires('broadcast'), json, async (req, res) => {
  const channelId = String(req.body?.channelId || '').trim();
  if (!SNOWFLAKE.test(channelId)) return res.status(400).json({ error: 'bad_channel' });

  const asEmbed = req.body?.embed === true || req.body?.embed === 'true';
  const text = String(req.body?.message || '').trim().slice(0, 1900);
  if (!text) return res.status(400).json({ error: 'message_required' });

  // An embed is described rather than drawn here: the bot builds it, so the
  // footer can honestly say which console it came from and who sent it.
  const payload = asEmbed
    ? JSON.stringify({
      embed: {
        title: String(req.body?.title || '').trim().slice(0, 200) || undefined,
        description: text,
        color: Number.isFinite(Number(req.body?.color)) ? Number(req.body.color) : 0xE6B800,
      },
    })
    : text;

  try {
    const taskId = await discordtasks.enqueue({
      action: 'channel_message', discordId: channelId, payload, actorLabel: label(req),
    });
    await audit.record(req, 'discord.message', channelId, { embed: asEmbed, length: text.length, taskId });
    res.status(202).json({ ok: true, taskId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'bot_missing' });
    console.error('[dash discord message]', err);
    res.status(500).json({ error: 'message_failed' });
  }
});

// --- moderating a member ---------------------------------------------------

const MEMBER_ACTIONS = { kick: 'member_kick', ban: 'member_ban', timeout: 'member_timeout' };

router.post('/dash/discord/member', staff.requires('punishPlayers'), json, async (req, res) => {
  const what = String(req.body?.action || '');
  const action = MEMBER_ACTIONS[what];
  if (!action) return res.status(400).json({ error: 'bad_action' });

  // Banning somebody off the Discord is the same weight of decision as banning
  // them off the game, and sits behind the same permission.
  if (what === 'ban' && !req.staff.abilities.banPlayers) {
    return res.status(403).json({ error: 'forbidden', need: 'banPlayers' });
  }

  const discordId = String(req.body?.discordId || '').trim();
  if (!SNOWFLAKE.test(discordId)) return res.status(400).json({ error: 'bad_member' });
  if (discordId === req.session.discord.id) return res.status(400).json({ error: 'not_yourself' });

  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (!reason) return res.status(400).json({ error: 'reason_required' });

  // A timeout needs a length; zero clears one.
  let payload = null;
  if (what === 'timeout') {
    const minutes = Math.trunc(Number(req.body?.minutes));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 40320) {
      return res.status(400).json({ error: 'bad_minutes' });
    }
    payload = String(minutes);
  }

  try {
    // Refuse to act on somebody who outranks you here, the same as everywhere
    // else in the console — decided by our tiers, not by Discord's role order.
    // Somebody who has never signed in has no tier, and Discord's own role check
    // on the far side is then the only thing standing in the way, which is fine.
    const sessions = await mongo.collection(config.mongo.siteDb, 'sessions');
    const theirSession = await sessions.findOne({ 'discord.id': discordId }, { sort: { rolesAt: -1 } });
    if (theirSession) {
      const theirTier = staff.tierOf(staff.ranksFromRoles(theirSession.roles || []));
      if (theirTier >= req.staff.tier) return res.status(403).json({ error: 'target_outranks_you' });
    }

    const taskId = await discordtasks.enqueue({
      action, discordId, reason, payload, actorLabel: label(req),
    });
    await audit.record(req, `discord.${what}`, discordId, { reason, minutes: payload, taskId });
    res.status(202).json({ ok: true, taskId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'bot_missing' });
    console.error('[dash discord member]', err);
    res.status(500).json({ error: 'member_failed' });
  }
});

// How a queued Discord task ended.
router.get('/dash/discord/task/:id', staff.requires('broadcast'), async (req, res) => {
  try {
    const row = await discordtasks.status(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    console.error('[dash discord task]', err);
    res.status(500).json({ error: 'status_unavailable' });
  }
});

// --- account links ----------------------------------------------------------

// Breaking a link is not a punishment, but it does decide whose Minecraft rank
// follows whose Discord roles — so it is Admin work and it is recorded.
router.delete('/dash/link/:discordId', staff.requires('manageNetwork'), async (req, res) => {
  const discordId = String(req.params.discordId || '').trim();
  if (!SNOWFLAKE.test(discordId)) return res.status(400).json({ error: 'bad_member' });
  try {
    const rows = await sql.query('phoenix', 'SELECT `uuid`, `name` FROM `account_links` WHERE `discord_id` = ?', [discordId]);
    if (!rows.length) return res.status(404).json({ error: 'not_linked' });
    await sql.query('phoenix', 'DELETE FROM `account_links` WHERE `discord_id` = ?', [discordId]);
    await audit.record(req, 'link.break', discordId, { uuid: rows[0].uuid, name: rows[0].name });
    res.json({ ok: true, was: rows[0].name });
  } catch (err) {
    console.error('[dash link break]', err);
    res.status(500).json({ error: 'unlink_failed' });
  }
});

module.exports = router;
