'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const mongo = require('../lib/mongo');
const staff = require('../lib/staff');
const audit = require('../lib/audit');
const rules = require('../lib/rules');
const configActions = require('../lib/config-actions');
const backups = require('../lib/backups');
const links = require('../lib/links');
const sql = require('../lib/sql');
const { ObjectId } = require('mongodb');

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

// --- the network itself: ranks and ladders --------------------------------
//
// The deepest thing the console does. Everything here is an edit to Phoenix's
// own configuration, so nothing is written to Mongo directly — the edit is
// diffed against the current config into a short list of operations and handed
// to the plugin (config_actions / ConfigActionQueue.java), which applies each
// through the core's API in game. See lib/config-actions for why it is a queue.

// The rank whose priority is at or above this may only be edited by Management —
// it is the Owner rank, and an Admin rewriting it (or deleting it) is the one
// mistake here that could take the network's own top standing with it.
const OWNER_FLOOR = 1500;

function actorLabel(req) {
  const d = req.session.discord;
  return `${d.globalName || d.username} (${d.id})`;
}

// A value bound for a `set` line. Newlines are the payload's own delimiter, so a
// prefix with one in it would be read as two operations — strip them out.
const oneLine = (v, max) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

// The editable face of a rank. Phoenix keeps a legacy and a modern copy of every
// display field; this network writes the same &-codes into both, so the editor
// shows and edits one value and the plugin sets both.
function shapeRankEditable(doc, nameByUuid) {
  const perms = Array.isArray(doc.permissions) ? doc.permissions : [];
  const inh = Array.isArray(doc.inheritance) ? doc.inheritance : [];
  return {
    id: doc._id,
    name: doc.name,
    color: doc.colorModern || doc.color || '',
    prefix: doc.prefixModern || doc.prefix || '',
    suffix: doc.suffixModern || doc.suffix || '',
    displayName: doc.displayNameModern || doc.displayName || '',
    playerListPrefix: doc.playerListPrefixModern || doc.playerListPrefix || '',
    priority: Number(doc.priority) || 0,
    price: Number(doc.price) || 0,
    staff: !!doc.staff,
    visible: doc.visible !== false,
    grantable: !!doc.grantable,
    purchasable: !!doc.purchasable,
    subscription: !!doc.subscription,
    defaultRank: !!doc.defaultRank,
    permissions: perms.map((p) => p.permission).filter(Boolean).sort(),
    // Inheritance is stored as rank UUIDs; the editor speaks in names.
    inherits: inh.map((u) => nameByUuid.get(u)).filter(Boolean).sort(),
  };
}

function shapeLadderEditable(doc) {
  const steps = Array.isArray(doc.ladder) ? doc.ladder : [];
  return {
    id: doc._id,
    reason: doc.reason || doc._id,
    priority: Number(doc.priority) || 0,
    hidden: !!doc.hidden,
    requireChatSnapshot: !!doc.requireChatSnapshot,
    steps: steps
      .map((s) => ({
        order: Number(s.order) || 0,
        type: String(s.type || '').toUpperCase(),
        duration: Number(s.duration) || 0, // Phoenix stores these as strings
        decay: Number(s.decay) || 0,
        ip: !!s.ip,
        shadow: !!s.shadow,
      }))
      .sort((a, b) => a.order - b.order),
  };
}

// GET the ranks, plus the full set of permission nodes in use anywhere — the
// pool the editor lets you add from, because a node no rank carries cannot be
// copied onto one (there is no way to mint a permission through the API).
router.get('/dash/config/ranks', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const docs = await (await mongo.phoenix.ranks()).find({}).toArray();
    const nameByUuid = new Map(docs.map((d) => [d._id, d.name]));
    const ranks = docs
      .map((d) => shapeRankEditable(d, nameByUuid))
      .sort((a, b) => b.priority - a.priority);
    const pool = [...new Set(ranks.flatMap((r) => r.permissions))].sort();
    res.json({ ranks, permissionPool: pool, installed: await configActions.installed() });
  } catch (err) {
    console.error('[dash config ranks]', err);
    res.status(500).json({ error: 'ranks_unavailable' });
  }
});

router.get('/dash/config/ladders', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const docs = await (await mongo.phoenix.punishmentLadders()).find({}).toArray();
    const ladders = docs.map(shapeLadderEditable).sort((a, b) => b.priority - a.priority);
    const types = ['BAN', 'BLACKLIST', 'MUTE', 'KICK', 'WARN', 'COMPETITIVE'];
    res.json({ ladders, types, installed: await configActions.installed() });
  } catch (err) {
    console.error('[dash config ladders]', err);
    res.status(500).json({ error: 'ladders_unavailable' });
  }
});

// The scalar fields, mapped from the editor's camelCase to the plugin's flat
// field names, with how to read the same field back off a Mongo doc so a diff
// can tell what actually changed.
const RANK_FIELDS = [
  { key: 'color', field: 'color', kind: 'str', max: 64, read: (d) => d.colorModern || d.color || '' },
  { key: 'prefix', field: 'prefix', kind: 'str', max: 64, read: (d) => d.prefixModern || d.prefix || '' },
  { key: 'suffix', field: 'suffix', kind: 'str', max: 64, read: (d) => d.suffixModern || d.suffix || '' },
  { key: 'displayName', field: 'displayname', kind: 'str', max: 64, read: (d) => d.displayNameModern || d.displayName || '' },
  { key: 'playerListPrefix', field: 'playerlistprefix', kind: 'str', max: 64, read: (d) => d.playerListPrefixModern || d.playerListPrefix || '' },
  { key: 'priority', field: 'priority', kind: 'int', read: (d) => Number(d.priority) || 0 },
  { key: 'price', field: 'price', kind: 'int', read: (d) => Number(d.price) || 0 },
  { key: 'staff', field: 'staff', kind: 'bool', read: (d) => !!d.staff },
  { key: 'visible', field: 'visible', kind: 'bool', read: (d) => d.visible !== false },
  { key: 'grantable', field: 'grantable', kind: 'bool', read: (d) => !!d.grantable },
  { key: 'purchasable', field: 'purchasable', kind: 'bool', read: (d) => !!d.purchasable },
  { key: 'subscription', field: 'subscription', kind: 'bool', read: (d) => !!d.subscription },
  { key: 'defaultRank', field: 'defaultrank', kind: 'bool', read: (d) => !!d.defaultRank },
];

// Turns "set this field to this value" into a payload line, or throws on a value
// the core would refuse — a priority that is not a number, a colour a kilobyte
// long. Returns null when the field was not sent (leave it be).
function fieldLine(spec, body) {
  if (!(spec.key in body)) return null;
  if (spec.kind === 'int') {
    const n = Math.trunc(Number(body[spec.key]));
    if (!Number.isFinite(n)) throw new Error(`${spec.key} must be a number`);
    return { line: `set ${spec.field} ${n}`, value: n };
  }
  if (spec.kind === 'bool') {
    const b = body[spec.key] === true || body[spec.key] === 'true';
    return { line: `set ${spec.field} ${b}`, value: b };
  }
  return { line: `set ${spec.field} ${oneLine(body[spec.key], spec.max)}`, value: oneLine(body[spec.key], spec.max) };
}

const PERM_RE = /^[A-Za-z0-9_.*-]{1,96}$/;

// POST a rank edit: create, update, or delete. The body carries the desired
// whole state; the diff against Mongo is what becomes the (short) payload, so a
// save that changed one colour queues one operation, not thirteen.
router.post('/dash/config/rank', staff.requires('manageNetwork'), json, async (req, res) => {
  const op = String(req.body?.op || '');
  if (!['create', 'update', 'delete'].includes(op)) return res.status(400).json({ error: 'bad_op' });

  const name = oneLine(req.body?.name, 64);
  if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) return res.status(400).json({ error: 'bad_name' });

  try {
    const ranksCol = await mongo.phoenix.ranks();
    const docs = await ranksCol.find({}).toArray();
    const byName = new Map(docs.map((d) => [d.name, d]));
    const nameByUuid = new Map(docs.map((d) => [d._id, d.name]));
    const existing = byName.get(name);

    // Owner-rank protection, on the rank as it stands now.
    if (existing && Number(existing.priority) >= OWNER_FLOOR && req.staff.tier < staff.TIER.Management) {
      return res.status(403).json({ error: 'rank_protected' });
    }

    let action;
    let payload = '';

    if (op === 'delete') {
      if (!existing) return res.status(404).json({ error: 'unknown_rank' });
      if (existing.defaultRank) return res.status(400).json({ error: 'is_default_rank' });
      action = 'rank_delete';
    } else if (op === 'create') {
      if (existing) return res.status(409).json({ error: 'rank_exists' });
      action = 'rank_create';
      const lines = [];
      for (const spec of RANK_FIELDS) {
        const f = fieldLine(spec, req.body);
        if (f) lines.push(f.line);
      }
      payload = lines.join('\n');
    } else {
      // update — diff every provided field/list against the current doc
      if (!existing) return res.status(404).json({ error: 'unknown_rank' });
      const lines = [];
      for (const spec of RANK_FIELDS) {
        const f = fieldLine(spec, req.body);
        if (f && String(f.value) !== String(spec.read(existing))) lines.push(f.line);
      }

      // Permissions: desired vs current, as add/remove operations. A node already
      // on some rank is added by copying that object; a node new to the whole
      // network is minted plugin-side. Either way, any well-formed node is fair
      // game here — the shape check is the only gate.
      if (Array.isArray(req.body.permissions)) {
        const want = new Set(req.body.permissions.map((p) => oneLine(p, 96)).filter((p) => PERM_RE.test(p)));
        const have = new Set((existing.permissions || []).map((p) => p.permission).filter(Boolean));
        for (const node of want) if (!have.has(node)) lines.push(`perm+ ${node}`);
        for (const node of have) if (!want.has(node)) lines.push(`perm- ${node}`);
      }

      // Inheritance: desired rank names vs current (stored as UUIDs).
      if (Array.isArray(req.body.inherits)) {
        const want = new Set(req.body.inherits.map((n) => oneLine(n, 64)).filter(Boolean));
        const have = new Set((existing.inheritance || []).map((u) => nameByUuid.get(u)).filter(Boolean));
        for (const rn of want) {
          if (rn === name) continue; // a rank cannot inherit itself
          if (!byName.has(rn)) return res.status(400).json({ error: 'unknown_inherit', detail: rn });
          if (!have.has(rn)) lines.push(`inherit+ ${rn}`);
        }
        for (const rn of have) if (!want.has(rn)) lines.push(`inherit- ${rn}`);
      }

      if (!lines.length) return res.status(400).json({ error: 'no_changes' });
      if (lines.length > 200) return res.status(400).json({ error: 'too_many_changes' });
      action = 'rank_update';
      payload = lines.join('\n');
    }

    const id = await configActions.enqueue({
      action, subject: name, payload,
      actorUuid: null, actorLabel: actorLabel(req),
    });
    await audit.record(req, `network.${action}`, name, { op, jobId: id, ops: payload ? payload.split('\n').length : 0 });
    res.status(202).json({ ok: true, jobId: id });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    if (err.message && /must be a number/.test(err.message)) return res.status(400).json({ error: 'bad_value', detail: err.message });
    console.error('[dash config rank]', err);
    res.status(500).json({ error: 'rank_edit_failed' });
  }
});

const LADDER_TYPES = new Set(['BAN', 'BLACKLIST', 'MUTE', 'KICK', 'WARN', 'COMPETITIVE']);

// POST a ladder edit. Existing rungs can be re-timed, re-typed, or removed, and
// the ladder's priority/visibility changed — all diffed against the current
// config. A brand-new rung has no safe API to build it, so adding one is refused
// here rather than half-done.
router.post('/dash/config/ladder', staff.requires('manageNetwork'), json, async (req, res) => {
  const id = oneLine(req.body?.id, 64);
  if (!id) return res.status(400).json({ error: 'bad_id' });

  try {
    const doc = await (await mongo.phoenix.punishmentLadders()).findOne({ _id: id });
    if (!doc) return res.status(404).json({ error: 'unknown_ladder' });

    const cur = shapeLadderEditable(doc);
    const curByOrder = new Map(cur.steps.map((s) => [s.order, s]));
    const lines = [];

    if ('priority' in req.body) {
      const n = Math.trunc(Number(req.body.priority));
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'bad_value', detail: 'priority' });
      if (n !== cur.priority) lines.push(`set priority ${n}`);
    }
    if ('hidden' in req.body) {
      const b = req.body.hidden === true || req.body.hidden === 'true';
      if (b !== cur.hidden) lines.push(`set hidden ${b}`);
    }

    if (Array.isArray(req.body.steps)) {
      const wantOrders = new Set();
      for (const s of req.body.steps) {
        const order = Math.trunc(Number(s.order));
        if (!Number.isFinite(order) || order < 1) return res.status(400).json({ error: 'bad_step_order' });
        wantOrders.add(order);
        const now = curByOrder.get(order);
        if (!now) return res.status(400).json({ error: 'cannot_add_step', detail: `step ${order}` });

        const type = String(s.type || '').toUpperCase();
        if (!LADDER_TYPES.has(type)) return res.status(400).json({ error: 'bad_step_type', detail: type });
        const duration = Math.trunc(Number(s.duration));
        const decay = Math.trunc(Number(s.decay));
        if (!Number.isFinite(duration) || duration < 0) return res.status(400).json({ error: 'bad_step_duration' });
        if (!Number.isFinite(decay) || decay < 0) return res.status(400).json({ error: 'bad_step_decay' });
        const ip = s.ip === true || s.ip === 'true';
        const shadow = s.shadow === true || s.shadow === 'true';

        if (type !== now.type) lines.push(`step ${order} type ${type}`);
        if (duration !== now.duration) lines.push(`step ${order} duration ${duration}`);
        if (decay !== now.decay) lines.push(`step ${order} decay ${decay}`);
        if (ip !== now.ip) lines.push(`step ${order} ip ${ip}`);
        if (shadow !== now.shadow) lines.push(`step ${order} shadow ${shadow}`);
      }
      // Rungs the editor dropped.
      for (const s of cur.steps) if (!wantOrders.has(s.order)) lines.push(`stepdel ${s.order}`);
    }

    if (!lines.length) return res.status(400).json({ error: 'no_changes' });

    const jobId = await configActions.enqueue({
      action: 'ladder_update', subject: id, payload: lines.join('\n'),
      actorUuid: null, actorLabel: actorLabel(req),
    });
    await audit.record(req, 'network.ladder_update', id, { jobId, ops: lines.length });
    res.status(202).json({ ok: true, jobId });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash config ladder]', err);
    res.status(500).json({ error: 'ladder_edit_failed' });
  }
});

// How a queued config edit ended, for the page that queued it. Same shape as a
// mod action's status, so the editor can watch it the same way.
router.get('/dash/config/action/:id', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const row = await configActions.status(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    console.error('[dash config action]', err);
    res.status(500).json({ error: 'status_unavailable' });
  }
});

// Turns a field spec + a value straight into a payload line — the write side of
// RANK_FIELDS.read, used when re-applying a rank from a backup.
function setLineFromValue(spec, value) {
  if (spec.kind === 'int') return `set ${spec.field} ${Math.trunc(Number(value))}`;
  if (spec.kind === 'bool') return `set ${spec.field} ${value === true}`;
  return `set ${spec.field} ${oneLine(value, spec.max)}`;
}

// The ladder diff, shared by the ladder editor and a restore: what to change to
// make `cur` look like `want`. Both are shapeLadderEditable shapes.
function ladderDiffLines(want, cur) {
  const lines = [];
  if (want.priority !== cur.priority) lines.push(`set priority ${want.priority}`);
  if (want.hidden !== cur.hidden) lines.push(`set hidden ${want.hidden}`);
  const curByOrder = new Map(cur.steps.map((s) => [s.order, s]));
  const wantOrders = new Set();
  for (const s of want.steps) {
    wantOrders.add(s.order);
    const now = curByOrder.get(s.order);
    if (!now) continue; // a restore cannot add a rung the live ladder lacks
    if (s.type !== now.type) lines.push(`step ${s.order} type ${s.type}`);
    if (s.duration !== now.duration) lines.push(`step ${s.order} duration ${s.duration}`);
    if (s.decay !== now.decay) lines.push(`step ${s.order} decay ${s.decay}`);
    if (s.ip !== now.ip) lines.push(`step ${s.order} ip ${s.ip}`);
    if (s.shadow !== now.shadow) lines.push(`step ${s.order} shadow ${s.shadow}`);
  }
  for (const s of cur.steps) if (!wantOrders.has(s.order)) lines.push(`stepdel ${s.order}`);
  return lines;
}

// --- the report menu (categories) ------------------------------------------
//
// Phoenix has no API for the report categories, so — with the owner's go-ahead
// to take the risk — these are edited straight in Mongo. The site's own report
// form reads the same collection, so a change shows there at once; the in-game
// /report menu reads it at startup, so it shows there on the next restart.

// Sensible icons for a 1.8-era GUI, so nobody has to recall that a player head
// is SKULL_ITEM. Free text is still accepted — this is a shortcut, not a fence.
const MATERIALS = [
  'PAPER', 'BOOK', 'WRITTEN_BOOK', 'MAP', 'NAME_TAG', 'SKULL_ITEM', 'BARRIER', 'REDSTONE',
  'TNT', 'IRON_SWORD', 'DIAMOND_SWORD', 'BOW', 'FISHING_ROD', 'COMPASS', 'WATCH', 'SIGN',
  'CHEST', 'ANVIL', 'BLAZE_ROD', 'NETHER_STAR', 'EMERALD', 'GOLD_INGOT', 'BEDROCK', 'WEB',
];

const CAT_NAME = /^[A-Za-z0-9 _/-]{1,64}$/;
const MAT_RE = /^[A-Z0-9_]{1,48}$/;

router.get('/dash/config/categories', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const [cats, ladders] = await Promise.all([
      (await mongo.phoenix.reportCategories()).find({}).toArray(),
      (await mongo.phoenix.punishmentLadders()).find({}, { projection: { _id: 1 } }).toArray(),
    ]);
    res.json({
      categories: cats
        .map((c) => ({
          id: c._id,
          displayName: c.displayName || '',
          description: Array.isArray(c.description) ? c.description : [],
          punishmentLadderId: c.punishmentLadderId || '',
          materialName: c.materialName || 'PAPER',
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      ladders: ladders.map((l) => l._id).sort(),
      materials: MATERIALS,
    });
  } catch (err) {
    console.error('[dash categories]', err);
    res.status(500).json({ error: 'categories_unavailable' });
  }
});

router.post('/dash/config/category', staff.requires('manageNetwork'), json, async (req, res) => {
  const op = String(req.body?.op || '');
  if (!['create', 'update', 'delete'].includes(op)) return res.status(400).json({ error: 'bad_op' });
  const name = oneLine(req.body?.name, 64);
  if (!name || !CAT_NAME.test(name)) return res.status(400).json({ error: 'bad_name' });

  try {
    const col = await mongo.phoenix.reportCategories();
    const existing = await col.findOne({ _id: name });

    if (op === 'delete') {
      if (!existing) return res.status(404).json({ error: 'unknown_category' });
      await col.deleteOne({ _id: name });
      await audit.record(req, 'reportmenu.delete', name);
      return res.json({ ok: true });
    }
    if (op === 'create' && existing) return res.status(409).json({ error: 'category_exists' });
    if (op === 'update' && !existing) return res.status(404).json({ error: 'unknown_category' });

    const displayName = oneLine(req.body?.displayName, 64);
    if (!displayName) return res.status(400).json({ error: 'displayname_required' });
    const materialName = oneLine(req.body?.materialName, 48).toUpperCase();
    if (!MAT_RE.test(materialName)) return res.status(400).json({ error: 'bad_material' });
    const ladderId = oneLine(req.body?.punishmentLadderId, 64);
    if (ladderId && !(await (await mongo.phoenix.punishmentLadders()).findOne({ _id: ladderId }))) {
      return res.status(400).json({ error: 'unknown_ladder' });
    }
    const description = (Array.isArray(req.body?.description) ? req.body.description : [])
      .map((s) => oneLine(s, 100))
      .filter(Boolean)
      .slice(0, 10);

    await col.replaceOne(
      { _id: name },
      { _id: name, displayName, description, punishmentLadderId: ladderId, materialName },
      { upsert: true },
    );
    await audit.record(req, `reportmenu.${op}`, name, { displayName, ladder: ladderId, material: materialName });
    res.json({ ok: true });
  } catch (err) {
    console.error('[dash category]', err);
    res.status(500).json({ error: 'category_failed' });
  }
});

// --- everyone who has signed in --------------------------------------------
//
// The website holds no member list of its own — the only record of who exists to
// it is who has logged in, i.e. the sessions. One row per Discord id, freshest
// session wins, joined to the Minecraft account they have linked if any.
router.get('/dash/users', staff.requires('viewPlayers'), async (req, res) => {
  try {
    const sessions = await (await mongo.collection(config.mongo.siteDb, 'sessions')).find({}).toArray();
    const byId = new Map();
    for (const s of sessions) {
      if (!s.discord?.id) continue;
      const seen = s.rolesAt || s.createdAt || 0;
      const prev = byId.get(s.discord.id);
      if (prev && (prev.lastSeen || 0) >= seen) continue;
      byId.set(s.discord.id, {
        id: s.discord.id,
        name: s.discord.globalName || s.discord.username,
        avatar: s.discord.avatar || null,
        roles: s.roles || [],
        lastSeen: seen,
        since: s.createdAt || null,
      });
    }

    let linkByDiscord = new Map();
    try {
      const rows = await sql.query('phoenix', 'SELECT `discord_id`, `uuid`, `name`, `linked_at` FROM `account_links`');
      linkByDiscord = new Map(rows.map((r) => [r.discord_id, { uuid: r.uuid, name: r.name, at: r.linked_at }]));
    } catch { /* the table may not exist yet; no links is a fine answer */ }

    const users = [...byId.values()]
      .map((u) => {
        const ranks = staff.ranksFromRoles(u.roles);
        return {
          id: u.id,
          name: u.name,
          avatar: u.avatar,
          ranks,
          tier: staff.tierOf(ranks),
          linked: linkByDiscord.get(u.id) || null,
          lastSeen: u.lastSeen || null,
          since: u.since,
        };
      })
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    res.json({ users, count: users.length });
  } catch (err) {
    console.error('[dash users]', err);
    res.status(500).json({ error: 'users_unavailable' });
  }
});

// --- backups ---------------------------------------------------------------

router.get('/dash/backups', staff.requires('manageNetwork'), async (req, res) => {
  try {
    res.json({ backups: await backups.list() });
  } catch (err) {
    console.error('[dash backups]', err);
    res.status(500).json({ error: 'backups_unavailable' });
  }
});

router.post('/dash/backups', staff.requires('manageNetwork'), json, async (req, res) => {
  try {
    const doc = await backups.create(audit.actor(req), oneLine(req.body?.note, 200));
    await audit.record(req, 'backup.create', doc._id, { counts: doc.counts });
    res.status(201).json({ ok: true, id: doc._id, counts: doc.counts, at: doc.at });
  } catch (err) {
    console.error('[dash backup create]', err);
    res.status(500).json({ error: 'backup_failed' });
  }
});

router.get('/dash/backups/:id', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const b = await backups.get(req.params.id);
    if (!b) return res.status(404).json({ error: 'not_found' });
    res.json(b);
  } catch (err) {
    console.error('[dash backup get]', err);
    res.status(500).json({ error: 'backup_unavailable' });
  }
});

router.delete('/dash/backups/:id', staff.requires('manageNetwork'), async (req, res) => {
  try {
    if (!(await backups.remove(req.params.id))) return res.status(404).json({ error: 'not_found' });
    await audit.record(req, 'backup.delete', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[dash backup del]', err);
    res.status(500).json({ error: 'delete_failed' });
  }
});

// Re-apply a backup. Rules and the report menu are ours, so they go back at once.
// Ranks and ladders go through the queue: their display, flags and rungs are
// restored on the ranks/ladders that still exist. A restore does not recreate a
// deleted rank or remove one added since — undo, not a destructive rollback —
// and rank permissions/inheritance are in the download for a manual re-apply
// rather than re-diffed here.
router.post('/dash/backups/:id/restore', staff.requires('manageNetwork'), json, async (req, res) => {
  try {
    const b = await backups.get(req.params.id);
    if (!b) return res.status(404).json({ error: 'not_found' });
    const data = b.data || {};
    const summary = { rules: false, categories: 0, rankJobs: 0, ladderJobs: 0 };

    if (Array.isArray(data.rules)) {
      try {
        await rules.save(data.rules, audit.actor(req));
        require('../lib/cache').invalidate();
        summary.rules = true;
      } catch { /* a bad rules blob must not sink the rest of the restore */ }
    }

    if (Array.isArray(data.categories)) {
      const col = await mongo.phoenix.reportCategories();
      await col.deleteMany({});
      if (data.categories.length) await col.insertMany(data.categories);
      summary.categories = data.categories.length;
    }

    const curRanks = await (await mongo.phoenix.ranks()).find({}).toArray();
    const curByName = new Map(curRanks.map((d) => [d.name, d]));
    for (const br of data.ranks || []) {
      const cur = curByName.get(br.name);
      if (!cur) continue;
      if (Number(cur.priority) >= OWNER_FLOOR && req.staff.tier < staff.TIER.Management) continue;
      const lines = [];
      for (const spec of RANK_FIELDS) {
        const bv = spec.read(br);
        if (String(bv) !== String(spec.read(cur))) lines.push(setLineFromValue(spec, bv));
      }
      if (lines.length) {
        await configActions.enqueue({ action: 'rank_update', subject: br.name, payload: lines.join('\n'), actorUuid: null, actorLabel: actorLabel(req) });
        summary.rankJobs++;
      }
    }

    const curLadders = await (await mongo.phoenix.punishmentLadders()).find({}).toArray();
    const curLadderById = new Map(curLadders.map((d) => [d._id, shapeLadderEditable(d)]));
    for (const bl of data.ladders || []) {
      const cur = curLadderById.get(bl._id);
      if (!cur) continue;
      const lines = ladderDiffLines(shapeLadderEditable(bl), cur);
      if (lines.length) {
        await configActions.enqueue({ action: 'ladder_update', subject: bl._id, payload: lines.join('\n'), actorUuid: null, actorLabel: actorLabel(req) });
        summary.ladderJobs++;
      }
    }

    await audit.record(req, 'backup.restore', b._id, summary);
    res.json({ ok: true, summary });
  } catch (err) {
    if (err.code === 'not_installed') return res.status(503).json({ error: 'plugin_missing' });
    console.error('[dash backup restore]', err);
    res.status(500).json({ error: 'restore_failed' });
  }
});

// --- the chat filter -------------------------------------------------------
//
// The word list the core matches every line against. Same story as the report
// menu: no API, so edited in the store directly and picked up on restart. A
// REGEX filter is compiled here before it is saved — a pattern that does not
// parse would otherwise be a broken chat filter discovered by the whole server.

const FILTER_TYPES = ['WORD', 'REGEX', 'CONTAINS'];

router.get('/dash/config/filters', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const [filters, ladders] = await Promise.all([
      (await mongo.phoenix.filters()).find({}).toArray(),
      (await mongo.phoenix.punishmentLadders()).find({}, { projection: { _id: 1 } }).toArray(),
    ]);
    res.json({
      filters: filters
        .map((f) => ({
          id: f._id,
          filter: f.filter || '',
          filterType: String(f.filterType || 'WORD').toUpperCase(),
          hard: !!f.hard,
          autoPunish: !!f.autoPunish,
          punishmentLadderId: f.punishmentLadderId || '',
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      types: FILTER_TYPES,
      ladders: ladders.map((l) => l._id).sort(),
    });
  } catch (err) {
    console.error('[dash filters]', err);
    res.status(500).json({ error: 'filters_unavailable' });
  }
});

router.post('/dash/config/filter', staff.requires('manageNetwork'), json, async (req, res) => {
  const op = String(req.body?.op || '');
  if (!['create', 'update', 'delete'].includes(op)) return res.status(400).json({ error: 'bad_op' });
  const name = oneLine(req.body?.name, 64);
  if (!name || !CAT_NAME.test(name)) return res.status(400).json({ error: 'bad_name' });

  try {
    const col = await mongo.phoenix.filters();
    const existing = await col.findOne({ _id: name });

    if (op === 'delete') {
      if (!existing) return res.status(404).json({ error: 'unknown_filter' });
      await col.deleteOne({ _id: name });
      await audit.record(req, 'filter.delete', name);
      return res.json({ ok: true });
    }
    if (op === 'create' && existing) return res.status(409).json({ error: 'filter_exists' });
    if (op === 'update' && !existing) return res.status(404).json({ error: 'unknown_filter' });

    const pattern = String(req.body?.filter ?? '').replace(/[\r\n]+/g, '').trim().slice(0, 4000);
    if (!pattern) return res.status(400).json({ error: 'pattern_required' });
    const filterType = oneLine(req.body?.filterType, 16).toUpperCase();
    if (!FILTER_TYPES.includes(filterType)) return res.status(400).json({ error: 'bad_filter_type' });
    // A regex that does not compile here would not compile in game either.
    if (filterType === 'REGEX') {
      try { new RegExp(pattern); } catch (e) { return res.status(400).json({ error: 'bad_regex', detail: e.message }); }
    }
    const ladderId = oneLine(req.body?.punishmentLadderId, 64);
    if (ladderId && !(await (await mongo.phoenix.punishmentLadders()).findOne({ _id: ladderId }))) {
      return res.status(400).json({ error: 'unknown_ladder' });
    }

    await col.replaceOne(
      { _id: name },
      {
        _id: name,
        filter: pattern,
        filterType,
        hard: req.body?.hard === true || req.body?.hard === 'true',
        autoPunish: req.body?.autoPunish === true || req.body?.autoPunish === 'true',
        punishmentLadderId: ladderId || null,
      },
      { upsert: true },
    );
    await audit.record(req, `filter.${op}`, name, { filterType, hard: !!req.body?.hard });
    res.json({ ok: true });
  } catch (err) {
    console.error('[dash filter]', err);
    res.status(500).json({ error: 'filter_failed' });
  }
});

// --- cosmetic tags ---------------------------------------------------------
// Keyed by ObjectId rather than by name, so these are addressed by their id.

router.get('/dash/config/tags', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const tags = await (await mongo.phoenix.tags()).find({}).toArray();
    res.json({
      tags: tags
        .map((t) => ({
          id: String(t._id),
          name: t.name || '',
          prefix: t.prefix || '',
          color: t.color || '',
          priority: Number(t.priority) || 0,
          price: Number(t.price) || 0,
          purchasable: !!t.purchasable,
        }))
        .sort((a, b) => b.priority - a.priority || String(a.name).localeCompare(String(b.name))),
    });
  } catch (err) {
    console.error('[dash tags]', err);
    res.status(500).json({ error: 'tags_unavailable' });
  }
});

router.post('/dash/config/tag', staff.requires('manageNetwork'), json, async (req, res) => {
  const op = String(req.body?.op || '');
  if (!['create', 'update', 'delete'].includes(op)) return res.status(400).json({ error: 'bad_op' });

  try {
    const col = await mongo.phoenix.tags();

    if (op !== 'create') {
      let oid;
      try { oid = new ObjectId(String(req.body?.id || '')); }
      catch { return res.status(400).json({ error: 'bad_tag_id' }); }
      if (op === 'delete') {
        const r = await col.deleteOne({ _id: oid });
        if (!r.deletedCount) return res.status(404).json({ error: 'unknown_tag' });
        await audit.record(req, 'tag.delete', String(oid));
        return res.json({ ok: true });
      }
      const fields = readTag(req.body);
      if (fields.error) return res.status(400).json({ error: fields.error });
      const r = await col.updateOne({ _id: oid }, { $set: fields.doc });
      if (!r.matchedCount) return res.status(404).json({ error: 'unknown_tag' });
      await audit.record(req, 'tag.update', String(oid), { name: fields.doc.name });
      return res.json({ ok: true });
    }

    const fields = readTag(req.body);
    if (fields.error) return res.status(400).json({ error: fields.error });
    const r = await col.insertOne(fields.doc);
    await audit.record(req, 'tag.create', String(r.insertedId), { name: fields.doc.name });
    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error('[dash tag]', err);
    res.status(500).json({ error: 'tag_failed' });
  }
});

function readTag(body) {
  const name = oneLine(body?.name, 48);
  if (!name) return { error: 'name_required' };
  const priority = Math.trunc(Number(body?.priority));
  const price = Math.trunc(Number(body?.price));
  if (!Number.isFinite(priority) || !Number.isFinite(price)) return { error: 'bad_value' };
  return {
    doc: {
      name,
      prefix: oneLine(body?.prefix, 96),
      color: oneLine(body?.color, 16),
      priority,
      price,
      purchasable: body?.purchasable === true || body?.purchasable === 'true',
    },
  };
}

// --- the logs the core keeps ------------------------------------------------
//
// Every command run and every line said, which is what actually answers "what
// happened" when a report says somebody was abusive or an admin says they did
// not run that. Read-only, and searchable by the player as well as by the text —
// a moderator looking somebody up should not have to know their UUID.

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function namesFor(uuids) {
  const list = [...new Set(uuids.filter(Boolean))];
  if (!list.length) return new Map();
  const docs = await (await mongo.phoenix.profiles())
    .find({ _id: { $in: list } }, { projection: { name: 1 } })
    .toArray();
  return new Map(docs.map((d) => [d._id, d.name]));
}

// Turns a search term into "this text, or anything this player did".
async function actorFilter(q, textField, actorField) {
  if (!q) return {};
  const rx = new RegExp(escapeRegex(q), 'i');
  const profs = await (await mongo.phoenix.profiles())
    .find({ name: rx }, { projection: { _id: 1 } })
    .limit(50)
    .toArray();
  const uuids = profs.map((p) => p._id);
  const clauses = [{ [textField]: rx }];
  if (uuids.length) clauses.push({ [actorField]: { $in: uuids } });
  return { $or: clauses };
}

router.get('/dash/logs/commands', staff.requires('viewReports'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 64);
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const rows = await (await mongo.phoenix.commandLogs())
      .find(await actorFilter(q, 'command', 'issuedBy'))
      .sort({ issuedOn: -1 })
      .limit(limit)
      .toArray();
    const names = await namesFor(rows.map((r) => r.issuedBy));
    res.json({
      logs: rows.map((r) => ({
        id: String(r._id),
        by: names.get(r.issuedBy) || null,
        byUuid: r.issuedBy,
        command: r.command,
        server: r.server,
        at: Number(r.issuedOn) || 0,
      })),
    });
  } catch (err) {
    console.error('[dash command logs]', err);
    res.status(500).json({ error: 'logs_unavailable' });
  }
});

router.get('/dash/logs/chat', staff.requires('viewReports'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 64);
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const rows = await (await mongo.phoenix.chatLogs())
      .find(await actorFilter(q, 'message', 'sender'))
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    const names = await namesFor(rows.map((r) => r.sender));
    res.json({
      logs: rows.map((r) => ({
        id: String(r._id),
        by: names.get(r.sender) || null,
        byUuid: r.sender,
        message: r.message,
        at: Number(r.timestamp) || 0,
      })),
    });
  } catch (err) {
    console.error('[dash chat logs]', err);
    res.status(500).json({ error: 'logs_unavailable' });
  }
});

// --- export -----------------------------------------------------------------
//
// The audit and the logs, out, for keeping. A record you cannot get a copy of is
// a record you are trusting somebody else's disk with — and these are the two
// that answer "what happened" long after the window the core keeps has rolled.
const EXPORTS = {
  audit: {
    need: 'viewReports',
    load: async () => (await mongo.site.audit()).find({}).sort({ at: -1 }).limit(10000).toArray(),
  },
  commands: {
    need: 'viewReports',
    load: async () => (await mongo.phoenix.commandLogs()).find({}).sort({ issuedOn: -1 }).limit(10000).toArray(),
  },
  chat: {
    need: 'viewReports',
    load: async () => (await mongo.phoenix.chatLogs()).find({}).sort({ timestamp: -1 }).limit(10000).toArray(),
  },
};

router.get('/dash/export/:what', async (req, res, next) => {
  const spec = EXPORTS[String(req.params.what)];
  if (!spec) return res.status(404).json({ error: 'unknown_export' });
  // Gated per export rather than once at the top, so adding a wider one later
  // cannot inherit a narrower one's permission by accident.
  return staff.requires(spec.need)(req, res, () => next());
}, async (req, res) => {
  const what = String(req.params.what);
  try {
    const rows = await EXPORTS[what].load();
    await audit.record(req, 'export', what, { rows: rows.length });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gravijet-${what}.json"`);
    res.send(JSON.stringify({ export: what, at: Date.now(), rows }, null, 2));
  } catch (err) {
    console.error('[dash export]', err);
    res.status(500).json({ error: 'export_failed' });
  }
});

module.exports = router;
