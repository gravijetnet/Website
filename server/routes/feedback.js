'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const mongo = require('../lib/mongo');
const links = require('../lib/links');
const staff = require('../lib/staff');
const audit = require('../lib/audit');

// What players tell us about the game — bugs to fix, and things they wish it did.
//
// Neither exists in the game: Phoenix knows about punishments and ranks, not
// about a broken hitbox or an idea for a new kit. So this is entirely ours, in
// our own database, and it is written the same careful way the reports and
// appeals are — a login is the whole anti-spam story, a short cooldown stops a
// stuck button becoming ten rows, and nothing a stranger types is ever trusted
// as more than text.
//
// A bug and a suggestion are almost the same record, so they share this file and
// most of its code; they differ in the words on their status ladder and in one
// thing only suggestions have — other players can upvote a suggestion, which is
// how the good ones rise without a staff member having to guess.

const json = express.json({ limit: '32kb' });
const MAX_TITLE = 100;
const MAX_DETAIL = 4000;
const COOLDOWN_MS = 60 * 1000;

// The two ladders. `open` is where everything starts; the terminal rungs are the
// ones that stop the clock — a decision has been made and nothing more is owed.
const KINDS = {
  bug: {
    col: () => mongo.site.bugs(),
    statuses: ['open', 'acknowledged', 'fixed', 'wontfix', 'duplicate'],
    terminal: new Set(['fixed', 'wontfix', 'duplicate']),
    // Where the player says it happened. Free enough to be honest, listed enough
    // to be sortable.
    fields: ['area'],
    votable: false,
  },
  suggestion: {
    col: () => mongo.site.suggestions(),
    statuses: ['open', 'planned', 'done', 'declined'],
    terminal: new Set(['done', 'declined']),
    fields: ['category'],
    votable: true,
  },
};

// The one field beyond title and detail that each kind carries, kept short and
// never trusted as anything but a label.
function tagOf(kind, body) {
  const raw = String(body?.[KINDS[kind].fields[0]] || '').trim().slice(0, 40);
  return raw || 'Other';
}

// Strip the parts of a stored row that are nobody's business but staff's: who
// filed it (the caller already knows it is theirs) and, for suggestions, the
// list of voters — the count is public, the names are not.
function forPlayer(doc, myId) {
  const { discordId, votes, note, resolvedBy, ...rest } = doc;
  return {
    ...rest,
    note: note || null, // the staff reply is meant to be read
    voteCount: votes ? votes.length : (doc.voteCount || 0),
    youVoted: Array.isArray(votes) ? votes.includes(myId) : false,
  };
}

// --- filing ----------------------------------------------------------------

function submit(kind) {
  return async (req, res) => {
    if (!req.session) return res.status(401).json({ error: 'login_required' });

    const title = String(req.body?.title || '').trim().slice(0, MAX_TITLE);
    const detail = String(req.body?.detail || '').trim().slice(0, MAX_DETAIL);
    if (!title || !detail) return res.status(400).json({ error: 'missing_fields' });
    if (title.length < 3) return res.status(400).json({ error: 'title_too_short' });
    if (detail.length < 15) return res.status(400).json({ error: 'detail_too_short' });

    try {
      const col = await KINDS[kind].col();
      const last = await col.findOne({ discordId: req.session.discord.id }, { sort: { filedAt: -1 } });
      if (last && Date.now() - last.filedAt < COOLDOWN_MS) {
        return res.status(429).json({ error: 'cooldown', retryAt: last.filedAt + COOLDOWN_MS });
      }

      // Best-effort: if the account is linked, staff get to see who in game filed
      // it without asking. Its absence never blocks the filing.
      let minecraft = null;
      try {
        const link = await links.linkFor(req.session.discord.id);
        if (link) minecraft = { uuid: link.uuid, name: link.name };
      } catch { /* linking is a nicety here, not a requirement */ }

      const now = Date.now();
      const doc = {
        _id: crypto.randomUUID(),
        kind,
        status: 'open',
        title,
        [KINDS[kind].fields[0]]: tagOf(kind, req.body),
        detail,
        discordId: req.session.discord.id,
        discordName: req.session.discord.globalName || req.session.discord.username,
        minecraft,
        filedAt: now,
        updatedAt: now,
        resolvedAt: null,
        note: null,
      };
      if (KINDS[kind].votable) { doc.votes = []; doc.voteCount = 0; }
      await col.insertOne(doc);
      res.status(201).json({ ok: true, id: doc._id });
    } catch (err) {
      console.error(`[feedback ${kind}]`, err);
      res.status(500).json({ error: 'unavailable' });
    }
  };
}

router.post('/feedback/bug', json, submit('bug'));
router.post('/feedback/suggestion', json, submit('suggestion'));

// --- the caller's own filings ----------------------------------------------

router.get('/my/feedback', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  try {
    const mine = { discordId: req.session.discord.id };
    const [bugs, suggestions] = await Promise.all([
      (await mongo.site.bugs()).find(mine).sort({ filedAt: -1 }).limit(100).toArray(),
      (await mongo.site.suggestions()).find(mine).sort({ filedAt: -1 }).limit(100).toArray(),
    ]);
    const id = req.session.discord.id;
    res.json({
      bugs: bugs.map((d) => forPlayer(d, id)),
      suggestions: suggestions.map((d) => forPlayer(d, id)),
    });
  } catch (err) {
    console.error('[my feedback]', err);
    res.status(500).json({ error: 'unavailable' });
  }
});

// --- the suggestion board --------------------------------------------------
//
// The one public-among-players surface here: everybody signed in sees the open
// and planned suggestions, sorted by how many have upvoted them, and can add
// their own vote. Bugs are never listed like this — a bug report can carry a
// repro that gives away an exploit, so it stays between its author and staff.

router.get('/feedback/board', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  try {
    const sort = req.query.sort === 'new' ? { filedAt: -1 } : { voteCount: -1, filedAt: -1 };
    const list = await (await mongo.site.suggestions())
      .find({ status: { $in: ['open', 'planned'] } })
      .sort(sort)
      .limit(100)
      .toArray();
    const id = req.session.discord.id;
    // The board never carries the detail body in bulk — a title and a count is
    // what you vote on; the full text opens on demand elsewhere if we want it.
    res.json({
      suggestions: list.map((d) => {
        const p = forPlayer(d, id);
        return {
          _id: p._id, title: p.title, category: p.category, status: p.status,
          detail: p.detail, filedAt: p.filedAt, voteCount: p.voteCount, youVoted: p.youVoted,
          mine: d.discordId === id,
        };
      }),
    });
  } catch (err) {
    console.error('[feedback board]', err);
    res.status(500).json({ error: 'unavailable' });
  }
});

// One vote each, and it toggles: pressing it again takes it back. You cannot vote
// for your own — the board is other people telling you an idea is good.
router.post('/feedback/suggestion/:id/vote', async (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  try {
    const id = req.session.discord.id;
    const col = await mongo.site.suggestions();
    const doc = await col.findOne({ _id: String(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'not_found' });
    if (doc.discordId === id) return res.status(400).json({ error: 'own_suggestion' });

    const votes = new Set(doc.votes || []);
    const had = votes.has(id);
    if (had) votes.delete(id); else votes.add(id);
    const arr = [...votes];
    await col.updateOne({ _id: doc._id }, { $set: { votes: arr, voteCount: arr.length } });
    res.json({ ok: true, youVoted: !had, voteCount: arr.length });
  } catch (err) {
    console.error('[feedback vote]', err);
    res.status(500).json({ error: 'unavailable' });
  }
});

// --- the staff side --------------------------------------------------------
//
// Reading and triaging both kinds. Gated on viewReports — the same right that
// opens the report and appeal queues — because that is exactly what this is: a
// third queue of things players have handed the team.

router.get('/dash/feedback', staff.requires('viewReports'), async (req, res) => {
  try {
    // hasOwnProperty, not a bare `KINDS[x]`: `?kind=constructor` would otherwise
    // resolve to an inherited Object property and read as a real kind.
    const kind = Object.prototype.hasOwnProperty.call(KINDS, req.query.kind) ? req.query.kind : 'bug';
    const status = KINDS[kind].statuses.includes(String(req.query.status)) ? String(req.query.status) : null;
    const filter = status ? { status } : {};

    const col = await KINDS[kind].col();
    const [rows, counts] = await Promise.all([
      col.find(filter).sort({ status: 1, voteCount: -1, filedAt: -1 }).limit(200).toArray(),
      col.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    ]);

    const byStatus = Object.fromEntries(KINDS[kind].statuses.map((s) => [s, 0]));
    let open = 0;
    for (const c of counts) {
      if (c._id in byStatus) byStatus[c._id] = c.n;
      if (c._id === 'open') open = c.n;
    }

    res.json({
      kind,
      statuses: KINDS[kind].statuses,
      counts: byStatus,
      open,
      rows: rows.map((d) => ({
        _id: d._id,
        status: d.status,
        title: d.title,
        detail: d.detail,
        tag: d[KINDS[kind].fields[0]] || null,
        by: d.discordName || null,
        minecraft: d.minecraft || null,
        filedAt: d.filedAt,
        updatedAt: d.updatedAt || d.filedAt,
        resolvedAt: d.resolvedAt || null,
        note: d.note || null,
        voteCount: KINDS[kind].votable ? (d.votes ? d.votes.length : d.voteCount || 0) : null,
      })),
    });
  } catch (err) {
    console.error('[dash feedback]', err);
    res.status(500).json({ error: 'unavailable' });
  }
});

router.post('/dash/feedback/:kind/:id', staff.requires('resolveReports'), json, async (req, res) => {
  const kind = req.params.kind;
  // hasOwnProperty guards against `constructor`/`__proto__`, which are truthy on a
  // bare `KINDS[kind]` and would then throw on `.statuses` outside the try below.
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return res.status(400).json({ error: 'unknown_kind' });

  const status = String(req.body?.status || '');
  if (!KINDS[kind].statuses.includes(status)) return res.status(400).json({ error: 'unknown_status' });
  const note = String(req.body?.note || '').trim().slice(0, MAX_DETAIL) || null;

  try {
    const col = await KINDS[kind].col();
    const now = Date.now();
    const terminal = KINDS[kind].terminal.has(status);
    const set = {
      status,
      note,
      updatedAt: now,
      // The clock stops the moment it reaches a terminal rung, and starts again
      // if a staff member reopens it. `resolvedBy` names who closed it.
      resolvedAt: terminal ? now : null,
      resolvedBy: terminal ? audit.actor(req) : null,
    };
    const r = await col.updateOne({ _id: String(req.params.id) }, { $set: set });
    if (!r.matchedCount) return res.status(404).json({ error: 'not_found' });
    await audit.record(req, `feedback.${kind}`, String(req.params.id), { status });
    res.json({ ok: true });
  } catch (err) {
    console.error('[dash feedback set]', err);
    res.status(500).json({ error: 'save_failed' });
  }
});

module.exports = router;
