'use strict';

const config = require('../config');
const mongo = require('./mongo');

// What a signed-in person is allowed to do, decided by the Discord roles they
// hold in the Gravijet guild.
//
// Discord rather than Phoenix because Phoenix keys on a Minecraft UUID, and
// nothing yet proves that a website visitor owns one — account linking needs an
// in-game command that does not exist. Discord already knows who these people
// are, the ticket bot already grants the roles, and a promotion there becomes a
// promotion here with no second list to keep in step.

const MEMBER_API = (guild) => `https://discord.com/api/v10/users/@me/guilds/${guild}/member`;
const REFRESH_MS = 5 * 60 * 1000;

// Higher outranks lower. Developer sits with Mod deliberately: a dev needs to
// read reports to fix what causes them, not to rule on them.
const TIER = {
  Helper: 1,
  Mod: 2,
  Developer: 2,
  SrMod: 3,
  Admin: 4,
  Management: 5,
};

// What each tier may do. Read is broad, write is narrow, and everything that
// reaches into the game or decides what other staff may do sits at Admin.
const NEEDS = {
  viewReports: 1,
  viewAppeals: 1,
  // Looking a player up is the first thing anybody does with a report, so it
  // sits with reading one. It shows what the core already shows in game to
  // anyone who can run /history — the website is not the place that decides
  // whether a helper may know why someone was banned.
  viewPlayers: 1,
  viewApplications: 2,
  // Mute, kick and a temporary ban: the things a moderator does during a shift.
  punishPlayers: 2,
  resolveReports: 3,
  resolveAppeals: 3,
  hidePlayers: 3,
  // Permanent bans and blacklists. Separated from punishPlayers because "this
  // person is done here" is a different decision from "cool off for an hour",
  // and it is the one nobody should be able to make by mis-clicking a dropdown.
  banPlayers: 3,
  reviewApplications: 4,
  manageStats: 4,
  // Admin and above, per the owner: the rulebook, the ladder of ranks, and who
  // is allowed to touch what.
  manageRules: 4,
  manageRanks: 4,
  manageAccess: 4,
  // Editing the network's own configuration — the ranks themselves (colour,
  // prefix, priority, permissions, inheritance) and the punishment ladders.
  // This is the deepest thing the console can do: it changes what every player
  // on the network is, not what one of them did. Admin, like the rest.
  manageNetwork: 4,
};

// Shown in the Access editor, in the order they are worth reading. A bare key
// like `hidePlayers` is not something to hand somebody and expect them to judge.
const ABILITY_INFO = [
  { key: 'viewReports', label: 'Read reports', note: 'And the audit log.' },
  { key: 'viewAppeals', label: 'Read appeals', note: null },
  { key: 'viewPlayers', label: 'Look players up', note: 'Ranks, alts, punishment history, sessions.' },
  { key: 'viewApplications', label: 'Read applications', note: null },
  { key: 'punishPlayers', label: 'Mute, kick, tempban', note: 'Takes effect in game immediately.' },
  { key: 'resolveReports', label: 'Close reports', note: null },
  { key: 'resolveAppeals', label: 'Rule on appeals', note: null },
  { key: 'hidePlayers', label: 'Hide players', note: 'Website only — removes them from leaderboards.' },
  { key: 'banPlayers', label: 'Ban permanently, blacklist', note: 'Takes effect in game immediately.' },
  { key: 'reviewApplications', label: 'Accept or reject applications', note: null },
  { key: 'manageStats', label: 'Manage stats', note: null },
  { key: 'manageRules', label: 'Edit the rules', note: 'Changes what example.invalid/rules says.' },
  { key: 'manageRanks', label: 'Promote and demote', note: 'Grants and revokes ranks in game and in Discord.' },
  { key: 'manageAccess', label: 'Change who can do what', note: 'This page. Hand it out carefully.' },
  { key: 'manageNetwork', label: 'Edit ranks and ladders', note: 'The network config itself — colours, prefixes, permissions, escalation. Applies in game.' },
];

// Role ids -> rank names we know. An unknown role id is simply not a rank.
function ranksFromRoles(roleIds) {
  const ids = new Set(roleIds || []);
  const out = [];
  for (const [name, id] of Object.entries(config.discord.rankRoles)) {
    if (ids.has(id)) out.push(name);
  }
  if (ids.has(config.discord.managementRole)) out.push('Management');
  return out;
}

function tierOf(ranks) {
  return (ranks || []).reduce((best, r) => Math.max(best, TIER[r] || 0), 0);
}

function can(tier, action) {
  const need = NEEDS[action];
  return need != null && tier >= need;
}

function abilities(tier) {
  return Object.fromEntries(Object.keys(NEEDS).map((k) => [k, can(tier, k)]));
}

// Roles are re-read from Discord rather than trusted from login forever: someone
// demoted at noon should not still be holding the dashboard at midnight. The
// token is kept server-side in the session for exactly this. If Discord will not
// answer, the last known roles stand — a refresh failure must not silently
// promote or demote anyone.
async function refreshRoles(sessionDoc, sessions) {
  const now = Date.now();
  if (sessionDoc.rolesAt && now - sessionDoc.rolesAt < REFRESH_MS) return sessionDoc.roles || [];
  if (!sessionDoc.accessToken) return sessionDoc.roles || [];

  try {
    const r = await fetch(MEMBER_API(config.discord.guildId), {
      headers: { Authorization: `Bearer ${sessionDoc.accessToken}` },
    });
    // 404 is a real answer: they are not in the guild, so they hold no roles.
    if (r.status === 404) {
      await sessions.updateOne({ _id: sessionDoc._id }, { $set: { roles: [], rolesAt: now } });
      return [];
    }
    if (!r.ok) return sessionDoc.roles || [];
    const member = await r.json();
    const roles = Array.isArray(member.roles) ? member.roles : [];
    await sessions.updateOne({ _id: sessionDoc._id }, { $set: { roles, rolesAt: now } });
    return roles;
  } catch {
    return sessionDoc.roles || [];
  }
}

// Fetches the member's roles during login, when we still hold a fresh token.
async function fetchRoles(accessToken) {
  try {
    const r = await fetch(MEMBER_API(config.discord.guildId), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return [];
    const member = await r.json();
    return Array.isArray(member.roles) ? member.roles : [];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------- overrides

// The tier ladder decides what a rank may do, and that is the right default —
// but it is a ladder, and real teams have exceptions on it: the developer who
// needs to read applications without being handed the power to accept them, the
// helper trusted with appeals, the admin whose hands you want off the rules
// while an argument is being had. Encoding each of those as a new tier would end
// with a tier per person.
//
// So: per-person grants and denials on top of the ladder, editable from
// Spielplatz by Admin and above. The ladder still decides for everybody who has
// no override, which is almost everybody.
//
// Two rules keep this from being a way to seize the network, both enforced in
// routes/access.js rather than here: you cannot override somebody whose tier is
// at or above your own, and you cannot deny yourself out of manageAccess (which
// would lock the door from the inside with the key still in it).
async function overrideFor(discordId) {
  try {
    return await (await mongo.site.access()).findOne({ _id: discordId });
  } catch {
    // A store that will not answer must not silently widen anyone's access, and
    // must not silently narrow it either. The ladder alone is the safe answer.
    return null;
  }
}

function applyOverride(base, ov) {
  if (!ov) return base;
  const out = { ...base };
  for (const k of ov.grant || []) if (k in out) out[k] = true;
  // Deny wins over grant. If a key is somehow in both, the restrictive reading
  // is the one that cannot cause harm by being wrong.
  for (const k of ov.deny || []) if (k in out) out[k] = false;
  return out;
}

// Everything the caller is, resolved from their current Discord roles and then
// from whatever exception has been recorded against them.
async function context(req) {
  if (!req.session) return { ranks: [], tier: 0, abilities: abilities(0), override: null };
  const sessions = await mongo.collection(config.mongo.siteDb, 'sessions');
  const roles = await refreshRoles(req.session, sessions);
  const ranks = ranksFromRoles(roles);
  const tier = tierOf(ranks);
  const ov = await overrideFor(req.session.discord.id);
  return {
    ranks,
    tier,
    abilities: applyOverride(abilities(tier), ov),
    override: ov ? { grant: ov.grant || [], deny: ov.deny || [] } : null,
  };
}

// Express guard. Checked per request against freshly-read roles, so revoking
// someone in Discord takes effect within the refresh window rather than at their
// next login.
function requires(action) {
  return async (req, res, next) => {
    try {
      if (!req.session) return res.status(401).json({ error: 'login_required' });
      const ctx = await context(req);
      // ctx.abilities, not can(ctx.tier, …): the tier is only the default, and
      // checking it here would let a denied ability straight through the door it
      // was denied at.
      if (!ctx.abilities[action]) return res.status(403).json({ error: 'forbidden', need: action });
      req.staff = ctx;
      next();
    } catch (err) {
      console.error('[staff guard]', err);
      // A guard that cannot decide must refuse. Failing open here would hand the
      // dashboard to anyone the moment Discord has a bad minute.
      res.status(503).json({ error: 'auth_unavailable' });
    }
  };
}

module.exports = {
  TIER, NEEDS, ABILITY_INFO, ranksFromRoles, tierOf, can, abilities,
  refreshRoles, fetchRoles, context, requires, applyOverride,
};
