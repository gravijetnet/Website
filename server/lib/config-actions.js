'use strict';

const sql = require('./sql');

// Edits the website asks the game to make to the network's own configuration —
// ranks and punishment ladders.
//
// This is the sibling of lib/actions. That queue does things to a player; this
// one does things to the config. They are kept apart because the shapes have
// nothing in common (a rank edit has no target UUID, no duration, no reason the
// player ever sees) and because a broken rank editor must never be able to jam
// the queue that lands bans. Same reasoning as lib/actions for why it is a queue
// at all: Phoenix holds its config in memory and syncs it over Redis, so the
// only edit that reaches a running network is one the core makes itself. The
// plugin (ConfigActionQueue.java) owns the table and applies each job through the
// core's API.
//
// The payload is a tiny line-based format, one operation per line, built by the
// route (see routes/admin). It is deliberately not JSON: the plugin cannot count
// on a JSON parser being on its classpath, and this format needs none.

class NotInstalled extends Error {
  constructor() {
    super('config_actions table missing');
    this.code = 'not_installed';
  }
}

function isMissingTable(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

const ACTIONS = new Set([
  'rank_create', 'rank_update', 'rank_delete', 'ladder_update',
  // Maintenance: closing and opening the network, and who gets through while it
  // is shut. The core decides who is exempt; these only flip the switch.
  'whitelist_on', 'whitelist_off', 'whitelist_add', 'whitelist_remove',
]);

/**
 * Queues a config edit and returns its id. The route decides whether the caller
 * may do this and shapes the payload; this only writes it down.
 */
async function enqueue({ action, subject, payload, actorUuid, actorLabel }) {
  if (!ACTIONS.has(action)) throw new Error(`unknown config action: ${action}`);
  try {
    const res = await sql.query(
      'phoenix',
      'INSERT INTO `config_actions`'
        + ' (`action`, `subject`, `payload`, `actor_uuid`, `actor_label`, `status`, `created_at`)'
        + " VALUES (?, ?, ?, ?, ?, 'pending', NOW())",
      [action, subject, payload || null, actorUuid || null, actorLabel],
    );
    return res.insertId;
  } catch (err) {
    if (isMissingTable(err)) throw new NotInstalled();
    throw err;
  }
}

async function status(id) {
  try {
    const rows = await sql.query(
      'phoenix',
      'SELECT `id`, `action`, `subject`, `status`, `result`, `created_at`, `done_at`'
        + ' FROM `config_actions` WHERE `id` = ?',
      [id],
    );
    return rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function recent(limit = 40) {
  try {
    return await sql.query(
      'phoenix',
      'SELECT `id`, `action`, `subject`, `actor_label`, `status`, `result`, `created_at`, `done_at`'
        + ' FROM `config_actions` ORDER BY `id` DESC LIMIT ?',
      [Number(limit) || 40],
    );
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Whether the plugin half of this exists yet. */
async function installed() {
  try {
    await sql.query('phoenix', 'SELECT 1 FROM `config_actions` LIMIT 1');
    return true;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

module.exports = { enqueue, status, recent, installed, ACTIONS, NotInstalled };
