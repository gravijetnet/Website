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

async function ping() {
  try {
    const c = await client();
    await c.db(config.mongo.practiceDb).command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { practice, ffa, ping };
