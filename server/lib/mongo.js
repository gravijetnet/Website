'use strict';

const { MongoClient } = require('mongodb');
const config = require('../config');

let clientPromise = null;

function client() {
  if (!clientPromise) {
    const c = new MongoClient(config.mongo.url, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });
    clientPromise = c.connect().catch((err) => {
      // Reset so a later request can retry the connection.
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

async function collection(dbName, name) {
  const c = await client();
  return c.db(dbName).collection(name);
}

// Practice (Bolt) collections.
const practice = {
  statistics: () => collection(config.mongo.practiceDb, 'bolt-statistics'),
  profiles: () => collection(config.mongo.practiceDb, 'bolt-player-profiles'),
  history: () => collection(config.mongo.practiceDb, 'bolt-profile-history'),
};

// FFA (Zephyr) collections.
const ffa = {
  profiles: () => collection(config.mongo.ffaDb, 'zephyr-profiles'),
};

// Phoenix (network core) collections. Read-only from here — the core owns them.
const phoenix = {
  ranks: () => collection(config.mongo.phoenixDb, 'px-ranks'),
  grants: () => collection(config.mongo.phoenixDb, 'px-grants'),
  profiles: () => collection(config.mongo.phoenixDb, 'px-profiles'),
  punishments: () => collection(config.mongo.phoenixDb, 'punishments'),
  logins: () => collection(config.mongo.phoenixDb, 'px-logins'),
  reports: () => collection(config.mongo.phoenixDb, 'px-reports'),
  reportCategories: () => collection(config.mongo.phoenixDb, 'px-report-categories'),
  punishmentLadders: () => collection(config.mongo.phoenixDb, 'px-punishmentLadders'),
  // The chat filter word list, the cosmetic tags, and the two logs the core
  // keeps: every command run and every line said.
  filters: () => collection(config.mongo.phoenixDb, 'px-filters'),
  tags: () => collection(config.mongo.phoenixDb, 'tags'),
  commandLogs: () => collection(config.mongo.phoenixDb, 'commandLogs'),
  chatLogs: () => collection(config.mongo.phoenixDb, 'px-chatLogs'),
  // Frozen windows of chat, taken as evidence for a report.
  chatSnapshots: () => collection(config.mongo.phoenixDb, 'px-chatSnapshots'),
};

// Ours to write.
const site = {
  applications: () => collection(config.mongo.siteDb, 'applications'),
  reports: () => collection(config.mongo.siteDb, 'reports'),
  appeals: () => collection(config.mongo.siteDb, 'appeals'),
  // Account links are deliberately NOT here: the MoreFeatures plugin owns that
  // table and speaks MySQL, so they live in `phoenixbridge`. See lib/links.
  hidden: () => collection(config.mongo.siteDb, 'hidden'),
  audit: () => collection(config.mongo.siteDb, 'audit'),
  // The rulebook, once somebody has edited it. Absent until then — lib/rules
  // ships the seed, and an empty collection means "nobody has changed it yet"
  // rather than "there are no rules".
  rules: () => collection(config.mongo.siteDb, 'rules'),
  // Per-person overrides on top of the Discord-role tiers. See lib/staff.
  access: () => collection(config.mongo.siteDb, 'access'),
  // Screenshots attached to applications. The bytes are on disk; this is who
  // sent them and who may read them. See routes/uploads.
  uploads: () => collection(config.mongo.siteDb, 'uploads'),
  // Point-in-time copies of the network config (ranks, ladders, report menu,
  // rules) so a bad edit has an undo. See lib/backups.
  backups: () => collection(config.mongo.siteDb, 'backups'),
};

async function ping() {
  try {
    const c = await client();
    await c.db(config.mongo.practiceDb).command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { practice, ffa, phoenix, site, collection, ping };
