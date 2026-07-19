'use strict';

const sql = require('./sql');

// Announcements the website sends to the game.
//
// Not a work queue — a broadcast has to reach every server, not be claimed by
// one — so this only writes the row. The plugin's Broadcaster fans it out: every
// server shows each row once. See MoreFeatures Broadcaster.java. The plugin owns
// the table, so a missing one means the build carrying it has not deployed yet.

class NotInstalled extends Error {
  constructor() {
    super('network_broadcasts table missing');
    this.code = 'not_installed';
  }
}

function isMissingTable(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

// `staff` is deliberately absent: a staff alert goes through the core's own
// channel (lib/actions, action `alert`) so it reaches every server and proxy.
// What is left here is what Phoenix has no network-wide call for.
const KINDS = new Set(['all', 'player', 'send']);

function isMissingColumn(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054);
}

async function enqueue({ kind, message, targetUuid, actorLabel }) {
  if (!KINDS.has(kind)) throw new Error(`unknown broadcast kind: ${kind}`);
  try {
    const res = await sql.query(
      'phoenix',
      'INSERT INTO `network_broadcasts` (`kind`, `message`, `target_uuid`, `actor_label`, `created_at`)'
        + ' VALUES (?, ?, ?, ?, NOW())',
      [kind, message, targetUuid || null, actorLabel || null],
    );
    return res.insertId;
  } catch (err) {
    if (isMissingTable(err)) throw new NotInstalled();
    // A server still running the build before player-targeting has the table but
    // not the column. A plain announcement still works there; a targeted one
    // cannot, and saying so beats writing a row nothing will ever read.
    if (isMissingColumn(err)) {
      if (kind !== 'all') throw new NotInstalled();
      const res = await sql.query(
        'phoenix',
        'INSERT INTO `network_broadcasts` (`kind`, `message`, `actor_label`, `created_at`) VALUES (?, ?, ?, NOW())',
        [kind, message, actorLabel || null],
      );
      return res.insertId;
    }
    throw err;
  }
}

async function recent(limit = 20) {
  try {
    return await sql.query(
      'phoenix',
      // Announcements only: the same table carries player-targeted rows, and a
      // note sent to one person is not something the broadcast page is about.
      'SELECT `id`, `kind`, `message`, `actor_label`, `created_at`'
        + " FROM `network_broadcasts` WHERE `kind` = 'all' ORDER BY `id` DESC LIMIT ?",
      [Number(limit) || 20],
    );
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function installed() {
  try {
    await sql.query('phoenix', 'SELECT 1 FROM `network_broadcasts` LIMIT 1');
    return true;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

module.exports = { enqueue, recent, installed, KINDS, NotInstalled };
