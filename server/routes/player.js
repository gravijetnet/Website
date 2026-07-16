'use strict';

const express = require('express');
const router = express.Router();

const { cached } = require('../lib/cache');
const players = require('../lib/players');
const hidden = require('../lib/hidden');
const staff = require('../lib/staff');
const bedwars = require('../lib/modes/bedwars');
const practice = require('../lib/modes/practice');
const ffa = require('../lib/modes/ffa');
const fastbuilder = require('../lib/modes/fastbuilder');

async function buildProfile(name) {
  const identity = await players.byName(name);
  if (!identity) return null;
  const uuid = identity.uuid;

  const [bw, pr, fa, fb] = await Promise.all([
    bedwars.forUuid(uuid),
    practice.forUuid(uuid),
    ffa.forUuid(uuid),
    fastbuilder.forUuid(uuid),
  ]);

  // Cross-mode headline totals shown in the profile hero.
  const summary = {
    kills: (bw?.kills || 0) + (pr?.kills || 0) + (fa?.kills || 0),
    wins: (bw?.wins || 0) + (pr?.wins || 0),
    bestStreak: Math.max(bw?.topWinStreak || 0, pr?.bestWinStreak || 0, fa?.bestStreak || 0),
    modesPlayed: [bw?.hasData, pr && pr.games > 0, fa?.hasData, fb?.hasData].filter(Boolean).length,
  };

  return {
    identity,
    summary,
    modes: {
      bedwars: bw,
      practice: pr,
      ffa: fa,
      fastbuilder: fb,
      clutches: { status: 'soon' },
    },
  };
}

router.get('/player/:name', async (req, res) => {
  const name = String(req.params.name || '').slice(0, 32);
  try {
    const profile = await cached(`player:${name.toLowerCase()}`, 15000, () => buildProfile(name));
    if (!profile) return res.status(404).json({ error: 'player_not_found', name });

    // Hiding a player has to cover the direct link too, or it only hides them
    // from people who weren't looking. Staff still see it: they are the ones who
    // have to judge whether the hide was right.
    if (await hidden.isHidden(profile.identity.uuid)) {
      const ctx = await staff.context(req);
      if (!staff.can(ctx.tier, 'hidePlayers')) {
        return res.status(404).json({ error: 'player_not_found', name });
      }
      profile.hidden = true;
    }
    res.json(profile);
  } catch (err) {
    console.error('[player]', err);
    res.status(500).json({ error: 'profile_unavailable' });
  }
});

module.exports = router;
