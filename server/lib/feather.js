'use strict';

const config = require('../config');

// FeatherPanel — the host the game servers actually run on.
//
// Everything else in this console reaches the *game*: Phoenix's ranks, the
// plugin's queues, the bot's roles. This reaches the machine underneath — power,
// the container's own console, backups, worlds. It is the layer below the layer,
// and the difference matters: a Phoenix restart asks the server to come back, a
// panel stop takes the box away.
//
// The key is IP-restricted at the panel's end. That is a good thing and the
// reason this file never pretends: when the panel refuses our address, the
// console says exactly that rather than "unavailable", because those need two
// completely different fixes and only one of them is ours.

class FeatherError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function configured() {
  return !!(config.feather.base && config.feather.key);
}

/**
 * One call to the panel. Returns the `data` the panel wraps everything in, or
 * throws a FeatherError whose code the routes turn into a sentence.
 */
async function call(path, { method = 'GET', body } = {}) {
  if (!configured()) throw new FeatherError('not_configured', 'No panel credentials are set', 503);

  let res;
  try {
    res = await fetch(`${config.feather.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.feather.key}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // The panel is a third party on the far side of the internet; a console
      // that hangs because somebody else's host is slow is a broken console.
      signal: AbortSignal.timeout(config.feather.timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new FeatherError('timeout', 'The panel did not answer in time', 504);
    }
    throw new FeatherError('unreachable', 'The panel could not be reached', 502);
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* some errors come back as nothing */ }

  if (res.ok && payload && payload.success !== false) {
    return payload.data !== undefined ? payload.data : payload;
  }

  const message = (payload && payload.message) || `panel returned ${res.status}`;
  // The one failure worth naming precisely: the key works, but not from here.
  // Nobody can guess that from "forbidden", and the fix is a panel setting.
  if (/ip address/i.test(message)) {
    throw new FeatherError('ip_not_allowed', message, 403);
  }
  if (res.status === 401 || res.status === 403) throw new FeatherError('unauthorised', message, 403);
  if (res.status === 404) throw new FeatherError('not_found', message, 404);
  throw new FeatherError('panel_error', message, 502);
}

// --- what the console asks for ---------------------------------------------

const servers = (search) =>
  call(`/api/user/servers?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`);

const server = (id) => call(`/api/user/servers/${encodeURIComponent(id)}`);

const POWER = new Set(['start', 'stop', 'restart', 'kill']);
function power(id, action) {
  if (!POWER.has(action)) throw new FeatherError('bad_action', `no power action ${action}`, 400);
  return call(`/api/user/servers/${encodeURIComponent(id)}/power/${action}`, { method: 'POST' });
}

const command = (id, cmd) =>
  call(`/api/user/servers/${encodeURIComponent(id)}/command`, { method: 'POST', body: { command: cmd } });

const backups = (id) => call(`/api/user/servers/${encodeURIComponent(id)}/backups`);
const createBackup = (id) => call(`/api/user/servers/${encodeURIComponent(id)}/backups`, { method: 'POST' });
const restoreBackup = (id, backupId) =>
  call(`/api/user/servers/${encodeURIComponent(id)}/backups/${encodeURIComponent(backupId)}/restore`, { method: 'POST' });
const deleteBackup = (id, backupId) =>
  call(`/api/user/servers/${encodeURIComponent(id)}/backups/${encodeURIComponent(backupId)}`, { method: 'DELETE' });

const worlds = (id) => call(`/api/user/servers/${encodeURIComponent(id)}/addons/mcutils/worlds`);
const players = (id) => call(`/api/user/servers/${encodeURIComponent(id)}/addons/mcutils/playermanager`);

module.exports = {
  configured, call, servers, server, power, command,
  backups, createBackup, restoreBackup, deleteBackup,
  worlds, players, POWER, FeatherError,
};
