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

// What each tier may do. Read is broad, write is narrow, and the two things that
// change what players see — hiding someone, ruling on an application — sit
// highest.
const NEEDS = {
  viewReports: 1,
  viewAppeals: 1,
  viewApplications: 2,
  resolveReports: 3,
  resolveAppeals: 3,
  hidePlayers: 3,
  reviewApplications: 4,
  manageStats: 4,
};

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

// Everything the caller is, resolved from their current Discord roles.
async function context(req) {
  if (!req.session) return { ranks: [], tier: 0, abilities: abilities(0) };
  const sessions = await mongo.collection(config.mongo.siteDb, 'sessions');
  const roles = await refreshRoles(req.session, sessions);
  const ranks = ranksFromRoles(roles);
  const tier = tierOf(ranks);
  return { ranks, tier, abilities: abilities(tier) };
}

// Express guard. Checked per request against freshly-read roles, so revoking
// someone in Discord takes effect within the refresh window rather than at their
// next login.
function requires(action) {
  return async (req, res, next) => {
    try {
      if (!req.session) return res.status(401).json({ error: 'login_required' });
      const ctx = await context(req);
      if (!can(ctx.tier, action)) return res.status(403).json({ error: 'forbidden', need: action });
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
  TIER, NEEDS, ranksFromRoles, tierOf, can, abilities, refreshRoles, fetchRoles, context, requires,
};
