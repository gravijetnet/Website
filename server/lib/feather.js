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

/**
 * The same call, for the endpoints that answer with a file rather than with
 * JSON. Reading server.properties returns text/plain, so the JSON helper above
 * would throw on the one response that is working exactly as intended.
 */
async function callRaw(path, { method = 'GET', body } = {}) {
  if (!configured()) throw new FeatherError('not_configured', 'No panel credentials are set', 503);
  let res;
  try {
    res = await fetch(`${config.feather.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.feather.key}`,
        ...(body !== undefined ? { 'Content-Type': 'text/plain' } : {}),
      },
      body,
      signal: AbortSignal.timeout(config.feather.timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new FeatherError('timeout', 'The panel did not answer in time', 504);
    }
    throw new FeatherError('unreachable', 'The panel could not be reached', 502);
  }

  const text = await res.text();
  if (res.ok) {
    // A write answers with the panel's usual JSON envelope; a read answers with
    // the file. Only the envelope is worth unwrapping.
    if (text.startsWith('{')) {
      try {
        const payload = JSON.parse(text);
        if (payload.success === false) throw new FeatherError('panel_error', payload.message || 'panel refused', 502);
        return typeof payload.data === 'string' ? payload.data : text;
      } catch (e) {
        if (e instanceof FeatherError) throw e;
      }
    }
    return text;
  }

  let message = `panel returned ${res.status}`;
  try { message = JSON.parse(text).message || message; } catch { /* not JSON */ }
  if (/ip address/i.test(message)) throw new FeatherError('ip_not_allowed', message, 403);
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

// The files on the box. `files` lists a directory; `readFile` and `writeFile`
// are how a config gets looked at and fixed without an SFTP client.
const files = (id, dir) =>
  call(`/api/user/servers/${encodeURIComponent(id)}/files?path=${encodeURIComponent(dir || '/')}`);
const readFile = (id, file) =>
  callRaw(`/api/user/servers/${encodeURIComponent(id)}/file?path=${encodeURIComponent(file)}`);
const writeFile = (id, file, content) =>
  callRaw(`/api/user/servers/${encodeURIComponent(id)}/write-file?path=${encodeURIComponent(file)}`, {
    method: 'POST',
    body: content,
  });

// The server's own console output. Wings hands these back as terminal lines,
// escape codes and all — the panel is a terminal, we are a web page.
const logs = (id) => call(`/api/user/servers/${encodeURIComponent(id)}/logs`);

// Push the log to mclo.gs and get a link. The thing you actually want when a
// server is misbehaving and somebody else has to look at it.
const shareLogs = (id) => call(`/api/user/servers/${encodeURIComponent(id)}/logs/upload`, { method: 'POST' });

// What the panel itself recorded against this server — separate from our audit,
// because somebody pressing stop *in the panel* never touches Spielplatz.
const activities = (id) => call(`/api/user/servers/${encodeURIComponent(id)}/activities`);

// Where the server actually is: address and port. Surprisingly hard to find when
// you need it and trivially answered here.
const allocations = (id) => call(`/api/user/servers/${encodeURIComponent(id)}/allocations`);

// Terminal output rendered by a browser. Strips the cursor games Wings sends —
// carriage returns, erase-to-end-of-line, colour — which would otherwise show up
// as literal gibberish in the middle of every progress line.
function cleanLog(line) {
  return String(line)
    // CSI sequences: colour, erase-to-end-of-line, cursor moves. Wings is
    // talking to a terminal; this is a web page.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    // Anything else non-printable, the tab excepted.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .trimEnd();
}

// What the machine underneath is actually doing — memory and disk in use against
// what exists, the load average, the real CPU percentage. The per-server figures
// the panel hands out are *allocations*, which is a budget rather than a
// reading; this is the reading.
const nodeStatus = () => call('/api/admin/nodes/status/global');

// What has been handed out across every server on the panel, for contrast with
// the above: allocation is what was promised, utilisation is what is being used.
const allocation = () => call('/api/admin/analytics/servers/resources');

module.exports = {
  configured, call, servers, server, power, command,
  backups, createBackup, restoreBackup, deleteBackup,
  worlds, players, nodeStatus, allocation, POWER, FeatherError,
  logs, shareLogs, activities, allocations, cleanLog,
  files, readFile, writeFile, callRaw,
};
