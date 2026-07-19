'use strict';

const express = require('express');
const router = express.Router();

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

// --- looking ----------------------------------------------------------------

router.get('/dash/panel/servers', staff.requires('manageNetwork'), async (req, res) => {
  if (!feather.configured()) return res.json({ configured: false, servers: [] });
  try {
    const data = await feather.servers(String(req.query.q || '').trim() || undefined);
    const list = Array.isArray(data?.servers) ? data.servers : [];
    res.json({ configured: true, servers: list.map(shapeServer) });
  } catch (err) {
    return fail(res, err, 'servers');
  }
});

router.get('/dash/panel/servers/:id/backups', staff.requires('manageNetwork'), async (req, res) => {
  try {
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

// --- acting -----------------------------------------------------------------

// Power and the container console are the two things here that can take the
// network down, so they sit with the game's console runner at Management.
router.post('/dash/panel/servers/:id/power/:action', staff.requires('runCommands'), async (req, res) => {
  const action = String(req.params.action);
  if (!feather.POWER.has(action)) return res.status(400).json({ error: 'bad_action', detail: REASON.bad_action });
  try {
    await feather.power(req.params.id, action);
    await audit.record(req, `panel.${action}`, req.params.id);
    res.status(202).json({ ok: true });
  } catch (err) {
    return fail(res, err, 'power');
  }
});

router.post('/dash/panel/servers/:id/command', staff.requires('runCommands'), json, async (req, res) => {
  const command = String(req.body?.command || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 255);
  if (!command) return res.status(400).json({ error: 'command_required', detail: 'Type a command.' });
  try {
    await feather.command(req.params.id, command);
    await audit.record(req, 'panel.command', req.params.id, { command });
    res.status(202).json({ ok: true });
  } catch (err) {
    return fail(res, err, 'command');
  }
});

// Taking a backup is safe and slow; restoring one overwrites a live server, so
// it is held to the same bar as power.
router.post('/dash/panel/servers/:id/backups', staff.requires('manageNetwork'), async (req, res) => {
  try {
    const b = await feather.createBackup(req.params.id);
    await audit.record(req, 'panel.backup', req.params.id, { uuid: b?.uuid || null });
    res.status(202).json({ ok: true });
  } catch (err) {
    return fail(res, err, 'backup');
  }
});

router.post('/dash/panel/servers/:id/backups/:backupId/restore', staff.requires('runCommands'), async (req, res) => {
  try {
    await feather.restoreBackup(req.params.id, req.params.backupId);
    await audit.record(req, 'panel.backup_restore', req.params.id, { backup: req.params.backupId });
    res.status(202).json({ ok: true });
  } catch (err) {
    return fail(res, err, 'restore');
  }
});

router.delete('/dash/panel/servers/:id/backups/:backupId', staff.requires('manageNetwork'), async (req, res) => {
  try {
    await feather.deleteBackup(req.params.id, req.params.backupId);
    await audit.record(req, 'panel.backup_delete', req.params.id, { backup: req.params.backupId });
    res.json({ ok: true });
  } catch (err) {
    return fail(res, err, 'backup delete');
  }
});

module.exports = router;
