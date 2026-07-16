'use strict';

const mysql = require('mysql2/promise');
const config = require('../config');

// One pool per database. mysql2 pools are lazy, so creating them up front is
// cheap and keeps each query on the right schema without USE statements.
const pools = {};

function poolFor(dbKey) {
  const database = config.mysql.databases[dbKey];
  if (!database) throw new Error(`Unknown database key: ${dbKey}`);
  if (!pools[dbKey]) {
    pools[dbKey] = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database,
      connectionLimit: config.mysql.connectionLimit,
      waitForConnections: true,
      enableKeepAlive: true,
      namedPlaceholders: true,
      // Decimals come back as strings by default; we want numbers for stats.
      decimalNumbers: true,
      dateStrings: false,
    });
  }
  return pools[dbKey];
}

// Run a query against a named database. Returns rows (or [] on failure) — a
// missing/offline database should degrade a single module, never crash a page.
async function query(dbKey, sql, params) {
  try {
    const [rows] = await poolFor(dbKey).query(sql, params);
    return rows;
  } catch (err) {
    console.error(`[sql:${dbKey}] ${err.code || err.message}`);
    throw err;
  }
}

// Same as query() but swallows errors and returns a fallback. Used for
// optional data sources so one dead DB doesn't take down a profile page.
async function safeQuery(dbKey, sql, params, fallback = []) {
  try {
    return await query(dbKey, sql, params);
  } catch {
    return fallback;
  }
}

async function ping() {
  const out = {};
  for (const key of Object.keys(config.mysql.databases)) {
    try {
      await query(key, 'SELECT 1');
      out[key] = true;
    } catch {
      out[key] = false;
    }
  }
  return out;
}

module.exports = { query, safeQuery, ping, poolFor };
