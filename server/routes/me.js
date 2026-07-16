'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const staff = require('../lib/staff');
const mongo = require('../lib/mongo');

// Who the browser is. The page uses this to decide between a login button and a
// name, so it must answer for signed-out visitors too — 200 with `user: null`,
// never a 401.

// A linked Minecraft account. Nothing writes to this yet: linking needs an
// in-game command to prove ownership, and that plugin does not exist. Returns
// null until it does, which every caller already handles.
async function linkedFor(discordId) {
  try {
    return await (await mongo.site.links()).findOne({ discordId });
  } catch {
    return null;
  }
}

router.get('/me', async (req, res) => {
  if (!req.session) {
    return res.json({ user: null, loginConfigured: config.discord.configured });
  }

  const d = req.session.discord || {};
  const [ctx, link] = await Promise.all([staff.context(req), linkedFor(d.id)]);

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
      minecraft: link ? { uuid: link.uuid, name: link.name } : null,
      ranks: ctx.ranks,
      tier: ctx.tier,
      staff: ctx.tier > 0,
      can: ctx.abilities,
    },
  });
});

module.exports = router;
