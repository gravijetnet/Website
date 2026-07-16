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
  reports: () => collection(config.mongo.phoenixDb, 'px-reports'),
  reportCategories: () => collection(config.mongo.phoenixDb, 'px-report-categories'),
  punishmentLadders: () => collection(config.mongo.phoenixDb, 'px-punishmentLadders'),
};

// Ours to write.
const site = {
  applications: () => collection(config.mongo.siteDb, 'applications'),
  reports: () => collection(config.mongo.siteDb, 'reports'),
  appeals: () => collection(config.mongo.siteDb, 'appeals'),
  links: () => collection(config.mongo.siteDb, 'links'),
  hidden: () => collection(config.mongo.siteDb, 'hidden'),
  audit: () => collection(config.mongo.siteDb, 'audit'),
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
