'use strict';

const sql = require('./sql');

// Things the website asks the game to do.
//
// Why a queue instead of just writing the row ourselves:
//
// Phoenix keeps punishments and grants in memory and syncs them between servers
// over Redis. A row inserted into its database behind its back reaches nobody
// who is already online, gets overwritten the next time the core saves the
// profile it thinks it owns, and fires none of the events the rest of the
// network hangs off — no ban screen, no staff alert, no ladder step, no
// PunishmentListener. It would look like it worked in Mongo and do nothing to
// the player, which is the worst of both.
//
// The core's Redis channel (`Packet:All`) is the real mechanism, but it is
// Phoenix's private protocol, shipped inside a native library and free to change
// in any update. Reproducing it here would be reverse-engineering a paid
// plugin's wire format and betting the network's moderation on it holding.
//
// So the website does not do it. It writes down what it wants done, and
// MoreFeatures — which is ours, runs inside the game, and already compiles
// against the real xyz.refinedev.phoenix API — picks the job up and calls
// IPunishmentHandler.executePunishment / IGrantHandler.grant. The core's own
// code path does the work, exactly as if a moderator had typed it.
//
// The table is owned by the plugin (see ActionQueue.java), for the same reason
// account_links is: the half that owns the DDL should be the half that runs
// inside the game. A missing table means the plugin has not been deployed yet,
// and saying so is better than a second definition that can drift.

class NotInstalled extends Error {
  constructor() {
    super('mod_actions table missing');
    this.code = 'not_installed';
  }
}

function isMissingTable(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

// What the executor knows how to do. The website must never be able to ask for
// something the plugin will not recognise — an unknown action would sit pending
// forever and look like a punishment that quietly failed.
const ACTIONS = new Set(['ban', 'mute', 'kick', 'blacklist', 'revoke', 'grant', 'ungrant']);

// Phoenix's own ceiling, from settings.yml (`max-temp-duration: 365d`). Asking
// for longer is asking for something the core will refuse.
const MAX_TEMP_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Queues a job and returns its id.
 *
 * Nothing here decides whether the caller is allowed to do it — routes do that,
 * against lib/staff. This only decides whether the job is coherent.
 */
async function enqueue(job) {
  if (!ACTIONS.has(job.action)) throw new Error(`unknown action: ${job.action}`);

  try {
    const res = await sql.query(
      'phoenix',
      'INSERT INTO `mod_actions`'
        + ' (`action`, `target_uuid`, `target_name`, `rank_name`, `punishment_id`, `duration_ms`,'
        + '  `permanent`, `reason`, `silent`, `actor_uuid`, `actor_label`, `status`, `created_at`)'
        + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())",
      [
        job.action,
        job.targetUuid,
        job.targetName || null,
        job.rankName || null,
        job.punishmentId || null,
        Number(job.durationMs) || 0,
        job.permanent ? 1 : 0,
        job.reason || null,
        job.silent ? 1 : 0,
        job.actorUuid || null,
        job.actorLabel,
      ],
    );
    return res.insertId;
  } catch (err) {
    if (isMissingTable(err)) throw new NotInstalled();
    throw err;
  }
}

/** How a job ended, for the page that queued it. */
async function status(id) {
  try {
    const rows = await sql.query(
      'phoenix',
      'SELECT `id`, `action`, `status`, `result`, `created_at`, `done_at` FROM `mod_actions` WHERE `id` = ?',
      [id],
    );
    return rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * The most recent jobs, for the console.
 *
 * This is deliberately not the audit log: the audit says a human decided
 * something, this says whether the game agreed to do it. A ban that was decided
 * and then failed because every server was offline appears in both, saying two
 * different true things.
 */
async function recent(limit = 50) {
  try {
    return await sql.query(
      'phoenix',
      'SELECT `id`, `action`, `target_name`, `rank_name`, `reason`, `actor_label`, `status`, `result`,'
        + ' `created_at`, `done_at` FROM `mod_actions` ORDER BY `id` DESC LIMIT ?',
      [Number(limit) || 50],
    );
  } catch (err) {
    if (isMissingTable(err)) return null; // unknown is not the same as none
    throw err;
  }
}

/** Whether the plugin half of this exists yet. */
async function installed() {
  try {
    await sql.query('phoenix', 'SELECT 1 FROM `mod_actions` LIMIT 1');
    return true;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

module.exports = { enqueue, status, recent, installed, ACTIONS, MAX_TEMP_MS, NotInstalled };
