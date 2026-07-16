'use strict';

// Central configuration. Everything can be overridden with environment
// variables so credentials never have to live in the repo, but the defaults
// match this box: MariaDB root@127.0.0.1 with no password, MongoDB with access
// control disabled, and the MBedwars REST add-on on localhost:8084.
module.exports = {
  port: parseInt(process.env.PORT || '4010', 10),
  host: process.env.HOST || '127.0.0.1',

  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    connectionLimit: 6,
    // Databases we read from.
    databases: {
      phoenix: process.env.DB_PHOENIX || 'phoenixbridge',
      fastbuilder: process.env.DB_FASTBUILDER || 'fastbuilder',
      mbedwars: process.env.DB_MBEDWARS || 'mbedwars',
    },
  },

  mongo: {
    url: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
    practiceDb: process.env.MONGO_PRACTICE_DB || 'Bolt',
    ffaDb: process.env.MONGO_FFA_DB || 'Zephyr',
  },

  // MBedwars REST API add-on. Used for live data when the game server is
  // online; the Bedwars module falls back to the `mbedwars` SQL tables (the
  // same data the plugin persists) whenever the API is unreachable.
  mbedwars: {
    base: process.env.MBEDWARS_BASE || 'http://localhost:8084',
    username: process.env.MBEDWARS_USER || 'default',
    password: process.env.MBEDWARS_PASS || 'jB]QaZJu:-M`n`(>>2qHd[v-30R_A4',
    timeoutMs: 1500,
  },

  // How long API responses are cached in memory (ms).
  cacheTtl: parseInt(process.env.CACHE_TTL || '20000', 10),
};
