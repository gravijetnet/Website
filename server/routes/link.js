'use strict';

const express = require('express');
const router = express.Router();

const links = require('../lib/links');
const playersLib = require('../lib/players');

// Linking a Minecraft account to a Discord one.
//
// The website can only prove the Discord half. Most Gravijet servers run
// online-mode=false, so Mojang cannot vouch for the other one and a name typed
// into a form is only a claim. So the website mints a code against the signed-in
// Discord session, and the player types it in game with /link — which only
// whoever is holding that account can do. The plugin (MoreFeatures) redeems it.

router.get('/link', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  try {
    const link = await links.linkFor(req.session.discord.id);
    if (!link) return res.json({ linked: null });
    const identity = await playersLib.byUuid(link.uuid, link.name);
    res.json({
      linked: {
        uuid: link.uuid,
        name: identity?.name || link.name,
        rank: identity?.rank || null,
        linkedAt: link.linkedAt,
      },
    });
  } catch (err) {
    console.error('[link status]', err);
    res.status(500).json({ error: 'link_unavailable' });
  }
});

router.post('/link/code', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  try {
    const already = await links.linkFor(req.session.discord.id);
    if (already) return res.status(409).json({ error: 'already_linked', name: already.name });

    const minted = await links.mintCode(
      req.session.discord.id,
      req.session.discord.globalName || req.session.discord.username,
    );
    res.json({ ...minted, ttlMs: links.TTL_MS });
  } catch (err) {
    // The plugin owns these tables. Missing means it has not been installed or
    // the server has not restarted since — worth saying plainly rather than
    // reporting a database error nobody can act on.
    if (err instanceof links.NotInstalled) {
      return res.status(503).json({ error: 'not_installed' });
    }
    console.error('[link code]', err);
    res.status(500).json({ error: 'link_unavailable' });
  }
});

router.delete('/link', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  try {
    const removed = await links.unlink(req.session.discord.id);
    if (!removed) return res.status(404).json({ error: 'not_linked' });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof links.NotInstalled) return res.status(503).json({ error: 'not_installed' });
    console.error('[unlink]', err);
    res.status(500).json({ error: 'link_unavailable' });
  }
});

module.exports = router;
