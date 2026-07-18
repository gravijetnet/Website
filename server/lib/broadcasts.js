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

const KINDS = new Set(['all', 'staff']);

async function enqueue({ kind, message, actorLabel }) {
  if (!KINDS.has(kind)) throw new Error(`unknown broadcast kind: ${kind}`);
  try {
    const res = await sql.query(
      'phoenix',
      'INSERT INTO `network_broadcasts` (`kind`, `message`, `actor_label`, `created_at`)'
        + ' VALUES (?, ?, ?, NOW())',
      [kind, message, actorLabel || null],
    );
    return res.insertId;
  } catch (err) {
    if (isMissingTable(err)) throw new NotInstalled();
    throw err;
  }
}

async function recent(limit = 20) {
  try {
    return await sql.query(
      'phoenix',
      'SELECT `id`, `kind`, `message`, `actor_label`, `created_at`'
        + ' FROM `network_broadcasts` ORDER BY `id` DESC LIMIT ?',
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
