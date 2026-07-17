'use strict';

const express = require('express');
const router = express.Router();

const { cached } = require('../lib/cache');
const rules = require('../lib/rules');

// The public rulebook. The wording is ours (lib/rules), the consequences are
// Phoenix's (px-punishmentLadders), and neither invents the other — see the
// comment at the top of lib/rules for why it is split that way.

async function build() {
  const { sections, updatedAt } = await rules.load();
  return {
    sections: await rules.withLadders(sections),
    updatedAt,
  };
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
