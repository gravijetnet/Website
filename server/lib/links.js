'use strict';

const crypto = require('crypto');
const sql = require('./sql');

// Minecraft ↔ Discord links, in the `phoenixbridge` schema.
//
// MySQL rather than our own Mongo because the other half of this lives in the
// MoreFeatures plugin, which speaks MySQL and already owns that schema. Two
// stores would mean the game and the website disagreeing about who someone is.
//
// The plugin owns the DDL. If the tables are missing, the plugin has not been
// installed or restarted yet, and saying so is better than creating a second
// definition here that can drift from the one the plugin makes.

// No I, L, O, 0 or 1: this gets read off a screen and typed into a chat box, and
// every one of those is a pair somebody will confuse. 31^6 is ~887 million, which
// is not worth guessing at one command per attempt.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const TTL_MS = 10 * 60 * 1000;

class NotInstalled extends Error {
  constructor() {
    super('link tables missing');
    this.code = 'not_installed';
  }
}

function isMissingTable(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

function newCode() {
  // randomInt, not Math.random: this is a credential, however short-lived.
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

async function linkFor(discordId) {
  try {
    const rows = await sql.query(
      'phoenix',
      'SELECT `uuid`, `name`, `linked_at` FROM `account_links` WHERE `discord_id` = ? LIMIT 1',
      [discordId],
    );
    return rows.length ? { uuid: rows[0].uuid, name: rows[0].name, linkedAt: rows[0].linked_at } : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

// One live code per Discord account: minting a second while the first is still
// good would leave two keys to the same door for no reason.
async function mintCode(discordId, discordName) {
  try {
    await sql.query('phoenix', 'DELETE FROM `link_codes` WHERE `discord_id` = ? OR `expires_at` < NOW()', [discordId]);

    // Retry on collision rather than trusting 887 million to be enough: the
    // primary key is what actually decides, and a duplicate is a thrown error,
    // not a wrong link.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      try {
        await sql.query(
          'phoenix',
          'INSERT INTO `link_codes` (`code`, `discord_id`, `discord_name`, `created_at`, `expires_at`)'
            + ' VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))',
          [code, discordId, discordName || null, Math.floor(TTL_MS / 1000)],
        );
        return { code, expiresAt: Date.now() + TTL_MS };
      } catch (err) {
        if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) continue;
        throw err;
      }
    }
    throw new Error('could not mint a unique code');
  } catch (err) {
    if (isMissingTable(err)) throw new NotInstalled();
    throw err;
  }
}

async function unlink(discordId) {
  try {
    const res = await sql.query('phoenix', 'DELETE FROM `account_links` WHERE `discord_id` = ?', [discordId]);
    return (res.affectedRows || 0) > 0;
  } catch (err) {
    if (isMissingTable(err)) throw new NotInstalled();
    throw err;
  }
}

module.exports = { linkFor, mintCode, unlink, NotInstalled, CODE_LENGTH, TTL_MS };
