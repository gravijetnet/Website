'use strict';

const express = require('express');
const router = express.Router();

const { cached } = require('../lib/cache');
const mongo = require('../lib/mongo');
const colors = require('../lib/colors');

// The rules ARE the punishment ladders. Phoenix already encodes what this
// network punishes and how hard it escalates, so keeping a hand-written list of
// rules beside it would mean maintaining a second version of the truth — one
// that drifts, while the other is the one that actually bans people. The wording
// below is ours because the ladders ship with empty `description` arrays; every
// consequence shown on the page is read from the ladder itself.
//
// A ladder with no blurb still renders: it keeps its name and its escalation,
// and simply says less. Better a rule stated thinly than a rule left out.
const BLURB = {
  Cheating:
    'Play with your own hands. No client, mod, macro or script that aims, reaches, times or builds for you. Mods that only change how the game looks or performs are fine — if it makes a decision you would otherwise make, it is not.',
  Toxicity:
    'Winning is not a licence to abuse anyone. Harassment, targeted insults, threats, and telling people to hurt themselves are punished on sight, whoever started it.',
  Discrimination:
    'Nothing about race, ethnicity, nationality, religion, gender, sexuality or disability. There is no joking version of this rule and no context that makes it fine.',
  Spamming:
    'Leave chat usable. No repeated messages, no walls of text, no advertising other servers, no filling the channel so nobody else can get a word in.',
  RunningCamping:
    'In a duel, duel. Running out the clock or sitting in a corner to force a draw wastes the time of someone who came here to fight.',
};

function shapeStep(step) {
  return {
    order: Number(step.order) || 0,
    type: String(step.type || '').toUpperCase(),
    duration: Number(step.duration) || 0,
    ip: !!step.ip,
  };
}

async function build() {
  const ladders = await (await mongo.phoenix.punishmentLadders()).find({}).toArray();
  return ladders
    .filter((l) => !l.hidden)
    .map((l) => ({
      id: l._id,
      title: colors.strip(l.reason || l._id),
      blurb: BLURB[l._id] || null,
      // Higher priority means the network treats it as more serious.
      priority: Number(l.priority) || 0,
      steps: (l.ladder || []).map(shapeStep).sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => b.priority - a.priority);
}

router.get('/rules', async (req, res) => {
  try {
    res.json(await cached('rules', 300000, build));
  } catch (err) {
    console.error('[rules]', err);
    res.status(500).json({ error: 'rules_unavailable' });
  }
});

module.exports = router;
