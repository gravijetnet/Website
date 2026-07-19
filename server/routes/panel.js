'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const staff = require('../lib/staff');
const audit = require('../lib/audit');
const feather = require('../lib/feather');

// The host underneath the game.
//
// Everything else in Spielplatz reaches Phoenix — ranks, punishments, the
// plugin's queues. This reaches the machine those run on: power, the container's
// own console, backups, worlds. The distinction is worth keeping in mind while
// reading the permissions below, because it is the whole reason they are strict:
// a Phoenix restart asks a server to come back, a panel `stop` takes it away.
//
// Nothing here is cached. A power button that acted on a status from twenty
// seconds ago is a power button that stops the wrong thing.

const json = express.json({ limit: '16kb' });

// The panel's own words, turned into sentences that say whose problem it is.
const REASON = {
  not_managed: 'That server is not one this console manages.',
  not_configured: 'The panel is not configured on this server.',
  ip_not_allowed: 'The panel is refusing this server’s address — the API key is IP-restricted and this machine is not on its list.',
  unauthorised: 'The panel rejected the API key.',
  timeout: 'The panel did not answer in time.',
  unreachable: 'The panel could not be reached.',
  not_found: 'The panel has no such server.',
  bad_action: 'That is not a power action.',
};

function fail(res, err, where) {
  const code = err && err.code;
  if (REASON[code]) return res.status(err.status || 502).json({ error: code, detail: REASON[code] });
  console.error(`[panel ${where}]`, err);
  return res.status(502).json({ error: 'panel_error', detail: (err && err.message) || 'The panel errored.' });
}

// Only the fields the console has a use for. The panel returns forty per server,
// most of them about billing and provisioning, and passing them straight through
// would put a subuser permission list and an SFTP password on a page that only
// wanted to know whether Bedwars-1 is up.
function shapeServer(s) {
  return {
    id: s.uuidShort,
    uuid: s.uuid,
    name: s.name,
    status: s.status || 'unknown',
    suspended: !!s.suspended,
    memory: Number(s.memory) || 0,
    cpu: Number(s.cpu) || 0,
    disk: Number(s.disk) || 0,
    node: s.node?.name || null,
    image: s.image || null,
  };
}

// --- the allowlist ----------------------------------------------------------
//
// The panel account can see every server on the host, most of them belonging to
// other people. Filtering the *list* would be theatre: the ids are guessable and
// every action route takes one, so a filtered list with unguarded actions is a
// console where a typo stops a stranger's Survival server.
//
// So the allowlist is resolved here, from the panel's own answer, and every
// route that names a server passes through it first. A short cache keeps that
// from costing a round trip per button press without letting a rename go stale
// for long.
const MANAGED = new Set(config.feather.managed);
let cache = { at: 0, byId: new Map() };

async function managedById() {
  if (Date.now() - cache.at < 15000 && cache.byId.size) return cache.byId;
  const data = await feather.servers();
  const byId = new Map();
  for (const s of data?.servers || []) {
    if (MANAGED.has(s.name)) byId.set(s.uuidShort, s);
  }
  cache = { at: Date.now(), byId };
  return byId;
}

/** Resolves an id to a server this console is allowed to touch, or refuses. */
async function assertManaged(id) {
  const byId = await managedById();
  const server = byId.get(String(id));
  if (!server) throw new feather.FeatherError('not_managed', REASON.not_managed, 403);
  return server;
}

// --- looking ----------------------------------------------------------------

router.get('/dash/panel/servers', staff.requires('manageNetwork'), async (req, res) => {
  if (!feather.configured()) return res.json({ configured: false, servers: [] });
  try {
    const byId = await managedById();
    // Listed in the order the allowlist names them: the proxy and the lobby
    // first, because that is the order somebody thinks about the network in,
    // not whatever order the panel's database happens to return.
    const order = new Map(config.feather.managed.map((n, i) => [n, i]));
    const servers = [...byId.values()]
      .map(shapeServer)
      .sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99));
    res.json({ configured: true, servers, managed: config.feather.managed.length });
  } catch (err) {
    return fail(res, err, 'servers');
  }
});

// What the machine is actually doing. Allocation is a budget; this is the meter.
router.get('/dash/panel/node', staff.requires('manageNetwork'), async (req, res) => {
  if (!feather.configured()) return res.json({ configured: false });
  try {
    const [status, alloc] = await Promise.all([
      feather.nodeStatus(),
      feather.allocation().catch(() => null),
    ]);
    const node = status?.nodes?.[0] || null;
    const u = node?.utilization || {};
    res.json({
      configured: true,
      node: node ? { name: (node.name || '').trim(), status: node.status, fqdn: node.fqdn } : null,
      memory: { used: Number(u.memory_used) || 0, total: Number(u.memory_total) || 0 },
      swap: { used: Number(u.swap_used) || 0, total: Number(u.swap_total) || 0 },
      disk: { used: Number(u.disk_used) || 0, total: Number(u.disk_total) || 0 },
      cpu: Number(u.cpu_percent) || 0,
      load: [Number(u.load_average1) || 0, Number(u.load_average5) || 0, Number(u.load_average15) || 0],
      // Everything the panel has promised out across all its servers, ours and
      // other people's — the number that says whether the box is oversold.
      allocated: alloc
        ? { memoryMb: Number(alloc.total_memory_mb) || 0, diskMb: Number(alloc.total_disk_mb) || 0, cpuPercent: Number(alloc.total_cpu_percent) || 0 }
        : null,
    });
  } catch (err) {
    return fail(res, err, 'node');
  }
});

router.get('/dash/panel/servers/:id/backups', staff.requires('manageNetwork'), async (req, res) => {
  try {
    await assertManaged(req.params.id);
    const data = await feather.backups(req.params.id);
    const list = Array.isArray(data) ? data : (data?.data || []);
    res.json({
      backups: list.map((b) => ({
        uuid: b.uuid,
        name: b.name,
        bytes: Number(b.bytes) || Number(b.size) || 0,
        locked: !!b.is_locked,
        successful: !!b.is_successful,
        createdAt: b.created_at || null,
      })),
    });
  } catch (err) {
    return fail(res, err, 'backups');
  }
});

router.get('/dash/panel/servers/:id/worlds', staff.requires('manageNetwork'), async (req, res) => {
  try {
    await assertManaged(req.params.id);
    const data = await feather.worlds(req.params.id);
    const list = Array.isArray(data?.worlds) ? data.worlds : [];
    res.json({ worlds: list.map((w) => ({ name: w.name, bytes: Number(w.size) || 0, modified: w.modified || null })) });
  } catch (err) {
    return fail(res, err, 'worlds');
  }
});

// The server's own view of who is on it, plus its ops, whitelist and local bans.
// This is deliberately not the same thing as Phoenix's punishments — a ban here
// is the vanilla file on that one box, and a moderator who confuses the two ends
// up unbanning nothing.
router.get('/dash/panel/servers/:id/players', staff.requires('manageNetwork'), async (req, res) => {
  try {
    await assertManaged(req.params.id);
    const d = await feather.players(req.params.id);
    res.json({
      online: d?.players?.players?.online ?? 0,
      max: d?.players?.players?.max ?? 0,
      list: Array.isArray(d?.players?.list) ? d.players.list : [],
      ops: (d?.ops || []).map((o) => ({ name: o.name, uuid: o.uuid, level: o.level })),
      whitelist: (d?.whitelist || []).map((w) => ({ name: w.name, uuid: w.uuid })),
      bans: (d?.bans || []).map((b) => ({ name: b.name, reason: b.reason, source: b.source, expires: b.expires })),
    });
  } catch (err) {
    return fail(res, err, 'players');
  }
});

// The server's own console output, cleaned of the terminal's cursor games.
// Newest last, the way a log reads.
router.get('/dash/panel/servers/:id/logs', staff.requires('manageNetwork'), async (req, res) => {
  try {
    await assertManaged(req.params.id);
    const d = await feather.logs(req.params.id);
    const raw = d?.response?.data || d?.data || [];
    const lines = (Array.isArray(raw) ? raw : String(raw).split('\n'))
      .map(feather.cleanLog)
      .filter((l) => l.length);
    res.json({ lines: lines.slice(-400) });
  } catch (err) {
    return fail(res, err, 'logs');
  }
});

// The same log, pushed to mclo.gs, for when somebody else has to read it.
router.post('/dash/panel/servers/:id/logs/share', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const server = await assertManaged(req.params.id);
    const d = await feather.shareLogs(req.params.id);
    const url = d?.url || d?.link || d?.response?.url || null;
    await audit.record(req, 'panel.log_share', server.name, { url });
    res.json({ url });
  } catch (err) {
    return fail(res, err, 'log share');
  }
});

// Where the server actually is. The port is the thing nobody can ever find.
router.get('/dash/panel/servers/:id/allocations', staff.requires('manageNetwork'), async (req, res) => {
  try {
    await assertManaged(req.params.id);
    const d = await feather.allocations(req.params.id);
    const ip = d?.node?.public_ip_v4 || null;
    res.json({
      allocations: (d?.allocations || []).map((a) => ({
        ip: a.ip || ip,
        alias: a.ip_alias || null,
        port: a.port,
        primary: !!a.is_primary || !!a.primary,
        notes: a.notes || null,
      })),
    });
  } catch (err) {
    return fail(res, err, 'allocations');
  }
});

// What the *panel* recorded. Deliberately separate from our own audit: somebody
// pressing stop in the panel itself never touches Spielplatz, and this is the
// only place that would show it.
router.get('/dash/panel/servers/:id/activities', staff.requires('manageNetwork'), async (req, res) => {
  try {
    await assertManaged(req.params.id);
    const d = await feather.activities(req.params.id);
    const list = d?.activities?.data || d?.data || [];
    res.json({
      activities: list.slice(0, 60).map((a) => ({
        event: a.event,
        ip: a.ip || null,
        at: a.created_at || a.timestamp || null,
      })),
    });
  } catch (err) {
    return fail(res, err, 'activities');
  }
});

// --- the files on the box ----------------------------------------------------
//
// Reading a config is how you find out why a server is behaving oddly; editing
// one is how you fix it without an SFTP client. Reading is Admin, writing is
// Management — a typo in server.properties is a server that will not start.

// Text this console will open in its editor. Everything else is listed and left
// alone: nobody wants a world file rendered as mojibake in a textarea.
const EDITABLE = /\.(properties|ya?ml|json|txt|conf|cfg|ini|toml|log|md|sh)$/i;
const MAX_EDIT_BYTES = 512 * 1024;

router.get('/dash/panel/servers/:id/files', staff.requires('manageNetwork'), async (req, res) => {
  try {
    await assertManaged(req.params.id);
    const dir = String(req.query.path || '/');
    const d = await feather.files(req.params.id, dir);
    const contents = d?.contents || [];
    res.json({
      path: dir,
      limited: !!d?.limited,
      entries: contents
        .map((e) => ({
          name: e.name,
          directory: !!e.directory,
          size: Number(e.size) || 0,
          modified: e.modified || null,
          editable: !e.directory && EDITABLE.test(e.name) && (Number(e.size) || 0) <= MAX_EDIT_BYTES,
        }))
        // Folders first, then names — the order a file manager has taught
        // everybody to expect.
        .sort((a, b) => (b.directory - a.directory) || a.name.localeCompare(b.name)),
    });
  } catch (err) {
    return fail(res, err, 'files');
  }
});

router.get('/dash/panel/servers/:id/file', staff.requires('manageNetwork'), async (req, res) => {
  const path = String(req.query.path || '');
  if (!path) return res.status(400).json({ error: 'path_required', detail: 'Which file?' });
  if (!EDITABLE.test(path)) return res.status(400).json({ error: 'not_text', detail: 'That is not a file this console opens.' });
  try {
    await assertManaged(req.params.id);
    const content = await feather.readFile(req.params.id, path);
    if (String(content).length > MAX_EDIT_BYTES) {
      return res.status(413).json({ error: 'too_big', detail: 'That file is too large to open here.' });
    }
    res.json({ path, content: String(content) });
  } catch (err) {
    return fail(res, err, 'file');
  }
});

router.post('/dash/panel/servers/:id/file', staff.requires('runCommands'), express.text({ limit: '1mb', type: '*/*' }), async (req, res) => {
  const path = String(req.query.path || '');
  if (!path) return res.status(400).json({ error: 'path_required', detail: 'Which file?' });
  if (!EDITABLE.test(path)) return res.status(400).json({ error: 'not_text', detail: 'That is not a file this console writes.' });
  const content = typeof req.body === 'string' ? req.body : '';
  if (content.length > MAX_EDIT_BYTES) return res.status(413).json({ error: 'too_big', detail: 'That is more than this console writes.' });
  try {
    const server = await assertManaged(req.params.id);
    await feather.writeFile(req.params.id, path, content);
    await audit.record(req, 'panel.write_file', server.name, { path, bytes: content.length });
    res.json({ ok: true });
  } catch (err) {
    return fail(res, err, 'write file');
  }
});

// --- acting -----------------------------------------------------------------

// Power and the container console are the two things here that can take the
// network down, so they sit with the game's console runner at Management.
router.post('/dash/panel/servers/:id/power/:action', staff.requires('runCommands'), async (req, res) => {
  const action = String(req.params.action);
  if (!feather.POWER.has(action)) return res.status(400).json({ error: 'bad_action', detail: REASON.bad_action });
  try {
    const server = await assertManaged(req.params.id);
    await feather.power(req.params.id, action);
    await audit.record(req, `panel.${action}`, server.name);
    res.status(202).json({ ok: true });
  } catch (err) {
    return fail(res, err, 'power');
  }
});

router.post('/dash/panel/servers/:id/command', staff.requires('runCommands'), json, async (req, res) => {
  const command = String(req.body?.command || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 255);
  if (!command) return res.status(400).json({ error: 'command_required', detail: 'Type a command.' });
  try {
    const server = await assertManaged(req.params.id);
    await feather.command(req.params.id, command);
    await audit.record(req, 'panel.command', server.name, { command });
    res.status(202).json({ ok: true });
  } catch (err) {
    return fail(res, err, 'command');
  }
});

// Taking a backup is safe and slow; restoring one overwrites a live server, so
// it is held to the same bar as power.
router.post('/dash/panel/servers/:id/backups', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const server = await assertManaged(req.params.id);
    const b = await feather.createBackup(req.params.id);
    await audit.record(req, 'panel.backup', server.name, { uuid: b?.uuid || null });
    res.status(202).json({ ok: true });
  } catch (err) {
    return fail(res, err, 'backup');
  }
});

router.post('/dash/panel/servers/:id/backups/:backupId/restore', staff.requires('runCommands'), async (req, res) => {
  try {
    const server = await assertManaged(req.params.id);
    await feather.restoreBackup(req.params.id, req.params.backupId);
    await audit.record(req, 'panel.backup_restore', server.name, { backup: req.params.backupId });
    res.status(202).json({ ok: true });
  } catch (err) {
    return fail(res, err, 'restore');
  }
});

router.delete('/dash/panel/servers/:id/backups/:backupId', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const server = await assertManaged(req.params.id);
    await feather.deleteBackup(req.params.id, req.params.backupId);
    await audit.record(req, 'panel.backup_delete', server.name, { backup: req.params.backupId });
    res.json({ ok: true });
  } catch (err) {
    return fail(res, err, 'backup delete');
  }
});

module.exports = router;
