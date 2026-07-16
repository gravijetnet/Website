'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const phoenix = require('../lib/phoenix');
const { cached } = require('../lib/cache');
const mongo = require('../lib/mongo');

// Who the browser is. Also what the page uses to decide whether to show a login
// button or a name, so it must answer for signed-out visitors too — 200 with
// `user: null`, not a 401.

// A linked Minecraft account is what turns a Discord identity into someone with
// ranks. Until /link exists there is nothing to look up, so this returns null
// and every caller already handles that.
async function linkedFor(discordId) {
  try {
    return await (await mongo.site.links()).findOne({ _id: discordId });
  } catch {
    return null;
  }
}

router.get('/me', async (req, res) => {
  if (!req.session) {
    return res.json({ user: null, loginConfigured: config.discord.configured });
  }
  const d = req.session.discord || {};
  const link = await linkedFor(d.id);

  let ranks = [];
  let staff = false;
  if (link) {
    const roster = await cached('roster', 60000, phoenix.roster);
    const entry = roster.find((p) => p.uuid === link.uuid);
    ranks = entry ? entry.ranks.map((r) => ({ name: r.name, color: r.color, staff: r.staff })) : [];
    staff = ranks.some((r) => r.staff);
  }

  res.json({
    loginConfigured: true,
    user: {
      discord: {
        id: d.id,
        name: d.globalName || d.username,
        avatar: d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=64` : null,
      },
      minecraft: link ? { uuid: link.uuid, name: link.name } : null,
      ranks,
      staff,
    },
  });
});

module.exports = router;
