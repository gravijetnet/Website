'use strict';

const mongo = require('./mongo');
const phoenix = require('./phoenix');
const { cached } = require('./cache');

// The live network, read out of the core's own logs.
//
// Three collections the console has always held but never shown moving:
// px-chatLogs (every line said), px-logins (every session), punishments and
// commandLogs (every action). Polled with a `since` cursor, each of these turns
// from a page you search into a feed you watch — which is the difference between
// a moderator looking something up after the fact and one catching it live.
//
// Everything here is read-only. The core owns these collections; we only look.

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// UUID -> who they are, for a whole batch at once. Name comes from the profile
// store (everyone who has ever joined has one); rank colour and the staff flag
// come from the cached roster (only those holding a grant), so an unranked
// player resolves to their name in neutral grey rather than to a blank.
async function resolveIdentities(uuids) {
  const list = [...new Set(uuids.filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;

  const [profs, roster] = await Promise.all([
    (await mongo.phoenix.profiles()).find({ _id: { $in: list } }, { projection: { name: 1 } }).toArray(),
    cached('roster', 60000, phoenix.roster).catch(() => []),
  ]);
  const nameById = new Map(profs.map((p) => [p._id, p.name]));
  const topById = new Map(roster.map((r) => [r.uuid, r.top]));

  for (const uuid of list) {
    const top = topById.get(uuid);
    out.set(uuid, {
      uuid,
      name: nameById.get(uuid) || null,
      color: top?.color || '#AAAAAA',
      rank: top?.name || null,
      staff: !!top?.staff,
    });
  }
  return out;
}

// The chat filter list, compiled to testers once and kept for a few minutes.
// A word filter is matched as a word; a REGEX filter is trusted as one, and if
// it will not compile it is skipped rather than taking the whole feed down.
let filterCache = { at: 0, tests: [] };
async function filterTests() {
  if (Date.now() - filterCache.at < 300000 && filterCache.tests.length) return filterCache.tests;
  const docs = await (await mongo.phoenix.filters()).find({}).toArray().catch(() => []);
  const tests = [];
  for (const d of docs) {
    const pattern = d.filterType === 'REGEX' ? d.filter : escapeRegex(d.filter);
    try {
      tests.push({ name: d._id, re: new RegExp(pattern, 'i') });
    } catch { /* a filter that will not compile catches nothing, quietly */ }
  }
  filterCache = { at: Date.now(), tests };
  return tests;
}

function flagOf(tests, message) {
  const text = String(message || '');
  for (const t of tests) {
    try { if (t.re.test(text)) return t.name; } catch { /* skip a bad tester */ }
  }
  return null;
}

// Chat since a timestamp, oldest-first so a watching page appends at the bottom
// the way a chat box fills. The first call (since 0) returns the last `limit`
// lines in order; every call after that returns only what is new. Each line
// carries the sender's name and rank colour, and a flag naming the filter it
// would trip — the thing a moderator is actually watching for.
async function chatFeed(since, limit) {
  const rows = await (await mongo.phoenix.chatLogs())
    .find({}).sort({ timestamp: -1 }).limit(limit).toArray();
  const fresh = since ? rows.filter((r) => Number(r.timestamp) > since) : rows;
  const [ids, tests] = await Promise.all([
    resolveIdentities(fresh.map((r) => r.sender)),
    filterTests(),
  ]);
  return fresh
    .map((r) => {
      const id = ids.get(r.sender) || {};
      return {
        id: String(r._id),
        at: Number(r.timestamp) || 0,
        uuid: r.sender,
        name: id.name || null,
        color: id.color || '#AAAAAA',
        rank: id.rank || null,
        staff: !!id.staff,
        message: r.message,
        flag: flagOf(tests, r.message),
      };
    })
    .sort((a, b) => a.at - b.at);
}

// The commands worth surfacing in a live feed. Every /setblock a builder runs is
// a command too, and drowning the pulse in them would hide the ban that matters.
// This is the moderation-relevant set — the verbs that change what a player can
// do or where they are — kept deliberately short.
const MOD_CMD = /^\/?(ban|tempban|ipban|mute|tempmute|kick|warn|unban|unmute|pardon|blacklist|unblacklist|vanish|v|freeze|unfreeze|staffchat|sc|alert|broadcast|bc|say|whitelist|maintenance|gamemode|gm|gmc|gms|gma|gmsp|tp|tphere|teleport|god|heal|fly|invsee|ban-ip)\b/i;

// One merged feed of what is happening: punishments handed out and lifted,
// players joining and leaving, and the moderation commands staff run. Newest
// first, since a pulse is read from the top.
async function pulse(since, limit) {
  const [punishments, logins, commands] = await Promise.all([
    (await mongo.phoenix.punishments()).find({}).sort({ issuedAt: -1 }).limit(50).toArray(),
    (await mongo.phoenix.logins()).find({}).sort({ login: -1 }).limit(60).toArray(),
    (await mongo.phoenix.commandLogs()).find({}).sort({ issuedOn: -1 }).limit(120).toArray(),
  ]);

  const events = [];
  for (const p of punishments) {
    const kind = String(p.punishmentType || '').toLowerCase();
    events.push({
      type: 'punish', at: Number(p.issuedAt) || 0,
      actor: p.issuedBy, target: p.target, kind,
      reason: p.reason || null, pid: p.punishmentID || null,
      permanent: !!p.permanent, server: p.issuedOn || null,
    });
    if (p.removedAt && Number(p.removedAt) > 0) {
      events.push({
        type: 'revoke', at: Number(p.removedAt),
        actor: p.removedBy, target: p.target, kind, pid: p.punishmentID || null,
        reason: p.removedReason || null,
      });
    }
  }
  for (const s of logins) {
    if (s.login && Number(s.login) > 0) events.push({ type: 'join', at: Number(s.login), target: s.target });
    if (s.logout && Number(s.logout) > 0) events.push({ type: 'leave', at: Number(s.logout), target: s.target });
  }
  for (const c of commands) {
    if (!MOD_CMD.test(c.command || '')) continue;
    events.push({ type: 'command', at: Number(c.issuedOn) || 0, actor: c.issuedBy, command: c.command, server: c.server || null });
  }

  const fresh = (since ? events.filter((e) => e.at > since) : events)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);

  const ids = await resolveIdentities(fresh.flatMap((e) => [e.actor, e.target].filter(Boolean)));
  const name = (u) => (u ? (ids.get(u)?.name || null) : null);
  const color = (u) => (u ? (ids.get(u)?.color || '#AAAAAA') : null);
  return fresh.map((e) => ({
    ...e,
    actorName: name(e.actor), actorColor: color(e.actor),
    targetName: name(e.target), targetColor: color(e.target),
  }));
}

module.exports = { resolveIdentities, chatFeed, pulse, MOD_CMD };
