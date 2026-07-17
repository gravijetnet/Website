'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const staff = require('../lib/staff');
const links = require('../lib/links');
const phoenix = require('../lib/phoenix');
const { cached } = require('../lib/cache');

// Who the browser is. The page uses this to decide between a login button and a
// name, so it must answer for signed-out visitors too — 200 with `user: null`,
// never a 401.

// The Minecraft account this Discord one proved it owns, via /link in game.
// Null until they do, which every caller already handles.
async function linkedFor(discordId) {
  try {
    return await links.linkFor(discordId);
  } catch {
    return null;
  }
}

// The ranks Phoenix has for a linked account. Discord roles decide what someone
// may do (see lib/staff) because those are what the ticket bot grants; these are
// the ranks they actually hold in game, which is a different question and worth
// showing them.
async function ranksFor(uuid) {
  try {
    const roster = await cached('roster', 60000, phoenix.roster);
    const entry = roster.find((p) => p.uuid === uuid);
    return entry ? entry.ranks.map((r) => ({ name: r.name, color: r.color, staff: r.staff })) : [];
  } catch {
    return [];
  }
}

router.get('/me', async (req, res) => {
  if (!req.session) {
    return res.json({ user: null, loginConfigured: config.discord.configured });
  }

  const d = req.session.discord || {};
  const [ctx, link] = await Promise.all([staff.context(req), linkedFor(d.id)]);
  const gameRanks = link ? await ranksFor(link.uuid) : [];

  res.json({
    loginConfigured: true,
    user: {
      discord: {
        id: d.id,
        name: d.globalName || d.username,
        avatar: d.avatar
          ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=64`
          : null,
      },
      minecraft: link ? { uuid: link.uuid, name: link.name, ranks: gameRanks } : null,
      ranks: ctx.ranks,
      tier: ctx.tier,
      // Staff enough to reach Spielplatz. Usually that is a rank, but the access
      // editor can grant a single ability to somebody with none — a trusted
      // volunteer who may read reports and nothing else — and they must be able
      // to get in to use it.
      staff: ctx.tier > 0 || Object.values(ctx.abilities).some(Boolean),
      can: ctx.abilities,
    },
  });
});

module.exports = router;
