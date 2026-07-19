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

// Everything the bot will do on our behalf. `discord_id` is whoever or whatever
// the task is about — a member for the role and moderation tasks, a channel for
// a message — and `payload` carries anything that does not fit a column: the
// message body, or the length of a timeout.
const ACTIONS = new Set([
  'role_add', 'role_remove',
  'channel_message',
  'member_kick', 'member_ban', 'member_timeout',
]);

/**
 * Queues work for the bot. The website holds no Discord token, so everything
 * Discord-side is asked for here and performed there.
 */
async function enqueue({ action, discordId, rankName, reason, payload, actorLabel }) {
  if (!ACTIONS.has(action)) throw new Error(`bad task ${action}`);
  try {
    const res = await sql.query(
      'phoenix',
      'INSERT INTO `discord_tasks`'
        + ' (`action`, `discord_id`, `rank_name`, `reason`, `payload`, `actor_label`, `status`, `created_at`)'
        + " VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())",
      [action, discordId, rankName || null, reason || null, payload || null, actorLabel],
    );
    return res.insertId;
  } catch (err) {
    if (isMissingTable(err)) throw new NotInstalled();
    // A bot still on the build before these columns cannot run the new tasks, and
    // a rank change there still works.
    if (err && (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054)) {
      if (action !== 'role_add' && action !== 'role_remove') throw new NotInstalled();
      const res = await sql.query(
        'phoenix',
        'INSERT INTO `discord_tasks` (`action`, `discord_id`, `rank_name`, `reason`, `actor_label`, `status`, `created_at`)'
          + " VALUES (?, ?, ?, ?, ?, 'pending', NOW())",
        [action, discordId, rankName, reason || null, actorLabel],
      );
      return res.insertId;
    }
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

module.exports = { enqueue, status, ACTIONS, NotInstalled };
