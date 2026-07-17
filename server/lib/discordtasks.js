'use strict';

const sql = require('./sql');

// Promote/demote, asked of the Discord bot.
//
// Discord is the source of truth for ranks — a role there is what decides a rank
// in game (see the bot's roleSync). So Spielplatz does not grant in Phoenix when
// it promotes somebody; it changes the Discord role, and lets the sync carry
// that into the game and post the announcement. But the website has no Discord
// token, so it cannot touch a role itself. It writes the request here and the
// bot performs it.
//
// The table is owned by the bot (it runs the CREATE — see roleSync). A missing
// table means the bot has not been deployed with this yet, and saying so beats a
// second definition that can drift.

class NotInstalled extends Error {
  constructor() {
    super('discord_tasks table missing');
    this.code = 'not_installed';
  }
}

function isMissingTable(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

/**
 * Queues a role change for a linked Discord account.
 * @param {'role_add'|'role_remove'} action
 */
async function enqueue({ action, discordId, rankName, reason, actorLabel }) {
  if (!['role_add', 'role_remove'].includes(action)) throw new Error(`bad task ${action}`);
  try {
    const res = await sql.query(
      'phoenix',
      'INSERT INTO `discord_tasks` (`action`, `discord_id`, `rank_name`, `reason`, `actor_label`, `status`, `created_at`)'
        + " VALUES (?, ?, ?, ?, ?, 'pending', NOW())",
      [action, discordId, rankName, reason || null, actorLabel],
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
      'SELECT `id`, `action`, `status`, `result`, `done_at` FROM `discord_tasks` WHERE `id` = ?',
      [id],
    );
    return rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

module.exports = { enqueue, status, NotInstalled };
