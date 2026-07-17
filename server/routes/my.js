'use strict';

const express = require('express');
const router = express.Router();

const mongo = require('../lib/mongo');
const links = require('../lib/links');
const phoenix = require('../lib/phoenix');
const punishments = require('../lib/punishments');
const { cached } = require('../lib/cache');

// A player's own paperwork: what they sent us, and what came back.
//
// Two different keys open two different halves of this, and they are not
// interchangeable. Anything filed through the website is keyed by the Discord id
// in the session — that is who pressed the button. Anything the game knows
// (punishments, logins, ranks) is keyed by a Minecraft UUID, and the only UUID
// we will answer for is the one this Discord account proved it owns by typing
// /link in game. Without that proof there is nothing to show, because a name
// typed into a form is a claim and this route would be handing over somebody
// else's punishment history on the strength of it.

// Resolves the caller's proven Minecraft account, or null.
async function linkedUuid(req) {
  try {
    const link = await links.linkFor(req.session.discord.id);
    return link || null;
  } catch {
    return null;
  }
}

// Every route here needs a session; none of them mean anything without one.
router.use((req, res, next) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  next();
});

// --- the caller's own filings ----------------------------------------------

function mine(req) {
  return { discordId: req.session.discord.id };
}

router.get('/my/reports', async (req, res) => {
  try {
    const list = await (await mongo.site.reports())
      .find(mine(req))
      .sort({ filedAt: -1 })
      .limit(100)
      .toArray();
    // Who ruled on it is deliberately dropped: the reporter needs to know their
    // report was acted on, not which mod to argue with about it.
    res.json(list.map(({ resolvedBy, discordId, ...r }) => r));
  } catch (err) {
    console.error('[my reports]', err);
    res.status(500).json({ error: 'reports_unavailable' });
  }
});

router.get('/my/appeals', async (req, res) => {
  try {
    const list = await (await mongo.site.appeals())
      .find(mine(req))
      .sort({ filedAt: -1 })
      .limit(100)
      .toArray();
    res.json(list.map(({ resolvedBy, discordId, ...a }) => a));
  } catch (err) {
    console.error('[my appeals]', err);
    res.status(500).json({ error: 'appeals_unavailable' });
  }
});

// --- what the game knows about the linked account ---------------------------

router.get('/my/punishments', async (req, res) => {
  try {
    const link = await linkedUuid(req);
    if (!link) return res.json({ linked: false, punishments: [] });

    // A shadow ban the player can see is not a shadow ban. Phoenix hides these
    // from the person they are aimed at, and so does this.
    const list = await (await mongo.phoenix.punishments())
      .find({ target: link.uuid, shadow: { $ne: true } })
      .toArray();

    const now = Date.now();
    res.json({
      linked: true,
      punishments: list
        .map((p) => punishments.shape(p, now))
        .sort((a, b) => b.issuedAt - a.issuedAt),
    });
  } catch (err) {
    console.error('[my punishments]', err);
    res.status(500).json({ error: 'punishments_unavailable' });
  }
});

// Session history. The stored IP is a hash and stays server-side: it is here to
// tell the core two logins came from one place, not to be read back to anyone.
router.get('/my/logins', async (req, res) => {
  try {
    const link = await linkedUuid(req);
    if (!link) return res.json({ linked: false, logins: [] });

    const list = await (await mongo.phoenix.logins())
      .find({ target: link.uuid })
      .toArray();

    // logout is "0" while the session is still open — the string is truthy and
    // Number("0") is a falsy 0, so testing the raw field would call a player who
    // is online right now "logged out in 1970".
    const shaped = list
      .map((l) => {
        const until = Number(l.logout) || 0;
        return { at: Number(l.login) || 0, until: until > 0 ? until : null };
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 100);

    res.json({ linked: true, logins: shaped });
  } catch (err) {
    console.error('[my logins]', err);
    res.status(500).json({ error: 'logins_unavailable' });
  }
});

// --- the overview ----------------------------------------------------------

router.get('/my/summary', async (req, res) => {
  try {
    const link = await linkedUuid(req);
    const [applications, reports, appeals] = await Promise.all([
      (await mongo.site.applications()).countDocuments({ discordId: req.session.discord.id }),
      (await mongo.site.reports()).countDocuments(mine(req)),
      (await mongo.site.appeals()).countDocuments(mine(req)),
    ]);

    let minecraft = null;
    if (link) {
      const roster = await cached('roster', 60000, phoenix.roster).catch(() => []);
      const entry = roster.find((p) => p.uuid === link.uuid);
      // Live restrictions, not `active: true` rows — see lib/punishments. A kick
      // from March is not something to warn somebody about on their own page.
      const live = await punishments
        .countLive(await mongo.phoenix.punishments(), { target: link.uuid, shadow: { $ne: true } })
        .catch(() => 0);
      minecraft = {
        uuid: link.uuid,
        name: link.name,
        linkedAt: link.linkedAt || null,
        ranks: entry ? entry.ranks.map((r) => ({ name: r.name, color: r.color, staff: r.staff })) : [],
        activePunishments: live,
      };
    }

    res.json({
      counts: { applications, reports, appeals },
      minecraft,
      discord: {
        id: req.session.discord.id,
        name: req.session.discord.globalName || req.session.discord.username,
      },
    });
  } catch (err) {
    console.error('[my summary]', err);
    res.status(500).json({ error: 'summary_unavailable' });
  }
});

module.exports = router;
