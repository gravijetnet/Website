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
    // Phoenix, the network core: ranks, grants, punishments, reports.
    //
    // There is a `phoenix` schema in MariaDB holding these same shapes, and it
    // is NOT this. The core's global.yml says database-type: MongoDB, so the SQL
    // one is what it used before the switch — 13 grants and 12 profiles against
    // Mongo's 34 and 29. Reading it would show a network that stopped existing.
    phoenixDb: process.env.MONGO_PHOENIX_DB || 'phoenix',
    // Our own writes (applications, reports filed on the website, moderation
    // notes). Kept out of Phoenix's database so nothing we do can confuse it.
    siteDb: process.env.MONGO_SITE_DB || 'gravijet_site',
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

  // FastBuilder's map list lives in the plugin's maps/ folder, not in the
  // database: player_map_stats only learns a map's name once somebody has timed
  // a run on it, so the selector would be empty for a map nobody has played yet.
  // Read-only, and the catalog falls back to the database if this is unreadable.
  fastbuilder: {
    mapsDir:
      process.env.FASTBUILDER_MAPS_DIR ||
      '/var/lib/featherpanel/volumes/ed4e2df8-b2dc-416f-841f-e13de4783e88/plugins/FastBuilder/maps',
  },

  // Discord login. No defaults on purpose: the secret lives in
  // /etc/gravijet-stats.env (root:www-data 0640), which systemd hands to the
  // service via EnvironmentFile. If it is missing, `configured` is false and the
  // login routes say so instead of half-working.
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    redirectUri: process.env.DISCORD_REDIRECT_URI || 'https://example.invalid/auth/discord/callback',
    get configured() {
      return !!(this.clientId && this.clientSecret);
    },

    // Who is staff is decided by Discord roles, not by a list I invented. These
    // ids are the ones the ticket bot already uses (its config.json), so a
    // promotion in Discord is a promotion here — there is one place to change.
    //
    // Not secrets: a role id is useless without being in the guild and holding
    // the role. They live here rather than in the env file so the mapping is
    // reviewable.
    guildId: process.env.DISCORD_GUILD_ID || '000000000000000000',
    staffRole: '000000000000000000',
    managementRole: '000000000000000000',
    rankRoles: {
      Creator: '000000000000000000',
      Media: '000000000000000000',
      Famous: '000000000000000000',
      Partner: '000000000000000000',
      Builder: '000000000000000000',
      Helper: '000000000000000000',
      Mod: '000000000000000000',
      SrMod: '000000000000000000',
      Developer: '000000000000000000',
      Admin: '000000000000000000',
      'Beta-Tester': '000000000000000000',
    },
  },

  session: {
    secret: process.env.SESSION_SECRET || '',
    cookie: 'gj_s',
    // Shared with example.invalid so one login covers the dashboard.
    // Unset on localhost, where a Domain would stop the cookie working at all.
    domain: process.env.SESSION_COOKIE_DOMAIN || '',
    // Seven days, matching the lifetime of the Discord token we refresh roles
    // with. A session outliving its token is a session whose permissions have
    // quietly frozen.
    ttlMs: 7 * 24 * 60 * 60 * 1000,
  },

  // FeatherPanel — the host the game servers run on. This is the layer *below*
  // Phoenix: power, the container's console, backups, worlds. The key is
  // IP-restricted at the panel's end and lives in /etc/gravijet-stats.env with
  // the Discord secret; it is never in this repository.
  feather: {
    base: (process.env.FEATHER_BASE || '').replace(/\/$/, ''),
    key: process.env.FEATHER_API_KEY || '',
    // Somebody else's host, across the internet. A console that hangs because
    // the panel is slow is a broken console.
    timeoutMs: parseInt(process.env.FEATHER_TIMEOUT_MS || '12000', 10),
  },

  // How long API responses are cached in memory (ms).
  cacheTtl: parseInt(process.env.CACHE_TTL || '20000', 10),
};
