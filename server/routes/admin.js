'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const mongo = require('../lib/mongo');
const staff = require('../lib/staff');
const audit = require('../lib/audit');
const rules = require('../lib/rules');

// The things Admin and above can change about the network itself, rather than
// about one player: the rulebook, and who is allowed to do what.

const json = express.json({ limit: '256kb' }); // the rulebook is the big one

// --- the rulebook ----------------------------------------------------------

// The editable copy: the wording only, with no ladders merged in. The public
// route pairs those on the way out — an editor that showed them would invite
// somebody to edit a consequence that is not stored here and watch the change
// vanish on save.
router.get('/dash/rules', staff.requires('manageRules'), async (req, res) => {
  try {
    const { sections, updatedAt, updatedBy } = await rules.load();
    // The ladder ids that actually exist, so the editor can offer them rather
    // than have somebody type `Cheeting` and silently lose a consequence.
    const ladders = await (await mongo.phoenix.punishmentLadders()).find({}).toArray();
    res.json({
      sections,
      updatedAt,
      updatedBy,
      ladders: ladders.filter((l) => !l.hidden).map((l) => l._id).sort(),
      isSeed: updatedAt === null,
    });
  } catch (err) {
    console.error('[dash rules]', err);
    res.status(500).json({ error: 'rules_unavailable' });
  }
});

const str = (v, max) => String(v ?? '').trim().slice(0, max);

// Shaped rather than stored as sent. This is the one payload on the site that a
// person hand-edits into a text box and posts back, so it is the one place where
// "whatever they sent" would end up rendered on the public rules page.
function cleanSections(input) {
  if (!Array.isArray(input) || !input.length) throw new Error('sections must be a non-empty array');
  if (input.length > 40) throw new Error('too many sections');

  return input.map((s, i) => {
    const list = Array.isArray(s.rules) ? s.rules : [];
    if (!list.length) throw new Error(`section ${i + 1} has no rules`);
    if (list.length > 60) throw new Error(`section ${i + 1} has too many rules`);
    const title = str(s.title, 80);
    if (!title) throw new Error(`section ${i + 1} needs a title`);

    return {
      // The id is the anchor the public page links to, so it has to be a slug
      // and it has to be there. Derived from the title when it is missing.
      id: str(s.id, 60).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || `section-${i + 1}`,
      title,
      intro: str(s.intro, 400) || null,
      rules: list.map((r, j) => {
        const rTitle = str(r.title, 120);
        const body = str(r.body, 1200);
        if (!rTitle) throw new Error(`rule ${j + 1} in "${title}" needs a title`);
        if (!body) throw new Error(`rule ${j + 1} in "${title}" needs a body`);
        return {
          id: str(r.id, 60).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || `rule-${i + 1}-${j + 1}`,
          title: rTitle,
          body,
          detail: str(r.detail, 800) || null,
          ladder: str(r.ladder, 60) || null,
        };
      }),
    };
  });
}

router.put('/dash/rules', staff.requires('manageRules'), json, async (req, res) => {
  let sections;
  try {
    sections = cleanSections(req.body?.sections);
  } catch (err) {
    return res.status(400).json({ error: 'bad_rules', detail: err.message });
  }

  try {
    const by = audit.actor(req);
    const at = await rules.save(sections, by);
    await audit.record(req, 'rules.edit', 'rules', {
      sections: sections.length,
      rules: sections.reduce((n, s) => n + s.rules.length, 0),
    });
    res.json({ ok: true, updatedAt: at });
  } catch (err) {
    console.error('[dash rules save]', err);
    res.status(500).json({ error: 'save_failed' });
  }
});

// Back to the wording this file shipped with. Kept because the editor is a text
// box over the public rules of a live network, and "undo" cannot be somebody
// remembering what it said.
router.post('/dash/rules/reset', staff.requires('manageRules'), async (req, res) => {
  try {
    await (await mongo.site.rules()).deleteOne({ _id: 'rules' });
    require('../lib/cache').invalidate();
    await audit.record(req, 'rules.reset', 'rules');
    res.json({ ok: true });
  } catch (err) {
    console.error('[dash rules reset]', err);
    res.status(500).json({ error: 'reset_failed' });
  }
});

// --- who can do what -------------------------------------------------------

// Everyone the website has ever seen, with the tier their Discord roles give
// them and whatever exception is recorded against them.
//
// Sessions are the source of the list because they are the only record of which
// Discord ids exist as far as this app is concerned — it holds no member list of
// its own, and asking Discord for the whole guild to populate a settings page
// would be a strange amount of work for a table nobody reads twice.
async function people() {
  const [sessions, overrides] = await Promise.all([
    (await mongo.collection(config.mongo.siteDb, 'sessions')).find({}).toArray(),
    (await mongo.site.access()).find({}).toArray(),
  ]);

  const byId = new Map();
  for (const s of sessions) {
    if (!s.discord?.id) continue;
    const prev = byId.get(s.discord.id);
    // Keep the freshest reading of their roles: an old session's `roles` is a
    // snapshot of who they were, not who they are.
    if (prev && (prev.rolesAt || 0) >= (s.rolesAt || 0)) continue;
    byId.set(s.discord.id, {
      id: s.discord.id,
      name: s.discord.globalName || s.discord.username,
      roles: s.roles || [],
      rolesAt: s.rolesAt || 0,
    });
  }

  const ovById = new Map(overrides.map((o) => [o._id, o]));
  // Somebody with an override who has since never logged in still belongs on
  // this page — their exception is real and it must be removable.
  for (const o of overrides) {
    if (!byId.has(o._id)) byId.set(o._id, { id: o._id, name: o.name || null, roles: [], rolesAt: 0 });
  }

  return [...byId.values()]
    .map((p) => {
      const ranks = staff.ranksFromRoles(p.roles);
      const tier = staff.tierOf(ranks);
      const ov = ovById.get(p.id);
      return {
        id: p.id,
        name: p.name,
        ranks,
        tier,
        grant: ov?.grant || [],
        deny: ov?.deny || [],
        abilities: staff.applyOverride(staff.abilities(tier), ov),
        updatedAt: ov?.at || null,
        updatedBy: ov?.by?.name || null,
      };
    })
    // Staff first, then everyone else — the list is here to manage the team, and
    // a page that opens on 400 signed-in players is a page nobody uses.
    .filter((p) => p.tier > 0 || p.grant.length || p.deny.length)
    .sort((a, b) => b.tier - a.tier || String(a.name).localeCompare(String(b.name)));
}

router.get('/dash/access', staff.requires('manageAccess'), async (req, res) => {
  try {
    res.json({
      abilities: staff.ABILITY_INFO,
      needs: staff.NEEDS,
      tiers: staff.TIER,
      you: { id: req.session.discord.id, tier: req.staff.tier },
      people: await people(),
    });
  } catch (err) {
    console.error('[dash access]', err);
    res.status(500).json({ error: 'access_unavailable' });
  }
});

router.put('/dash/access/:discordId', staff.requires('manageAccess'), json, async (req, res) => {
  const target = String(req.params.discordId);
  const known = new Set(Object.keys(staff.NEEDS));
  const grant = [...new Set((req.body?.grant || []).map(String))].filter((k) => known.has(k));
  const deny = [...new Set((req.body?.deny || []).map(String))].filter((k) => known.has(k));

  try {
    // You may not edit somebody who stands at or above you. Without this, the
    // most junior person who can reach this page can strip the Owner — and the
    // first anyone would know is the Owner not being able to open Spielplatz.
    const list = await people();
    const them = list.find((p) => p.id === target);
    const theirTier = them?.tier ?? 0;
    if (target !== req.session.discord.id && theirTier >= req.staff.tier) {
      return res.status(403).json({ error: 'target_outranks_you' });
    }
    // Nor may you lock yourself out of the room you are standing in. This is not
    // paternalism: manageAccess is the only ability that can restore itself, so
    // denying it to yourself is the one mistake here with no way back short of
    // a database edit.
    if (target === req.session.discord.id && deny.includes('manageAccess')) {
      return res.status(400).json({ error: 'cannot_lock_yourself_out' });
    }

    if (!grant.length && !deny.length) {
      await (await mongo.site.access()).deleteOne({ _id: target });
      await audit.record(req, 'access.clear', target, { name: them?.name || null });
      return res.json({ ok: true, cleared: true });
    }

    await (await mongo.site.access()).replaceOne(
      { _id: target },
      { _id: target, name: them?.name || null, grant, deny, at: Date.now(), by: audit.actor(req) },
      { upsert: true },
    );
    await audit.record(req, 'access.set', target, { name: them?.name || null, grant, deny });
    res.json({ ok: true });
  } catch (err) {
    console.error('[dash access set]', err);
    res.status(500).json({ error: 'save_failed' });
  }
});

module.exports = router;
