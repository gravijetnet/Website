// Thin API client. Every call resolves to parsed JSON or throws an Error with
// a `.status` for the views to branch on (e.g. 404 -> "player not found").

async function get(path) {
  const res = await fetch(`/api${path}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) {
    const err = new Error(`request failed: ${res.status}`);
    err.status = res.status;
    try { err.body = await res.json(); } catch { /* ignore */ }
    throw err;
  }
  return res.json();
}

// Who the browser is, and what they may do — memoised.
//
// This is the one call every surface makes before it paints: the shell asks it
// to draw the header, and the console and the player dashboard both ask it again
// to know which page to draw. Left unmemoised that is two round trips on a cold
// load and one more on every single tab switch, all of them blocking the page
// behind them — which is most of why the console felt slow to move around in.
//
// The answer barely changes: the server re-reads Discord roles on a five-minute
// window, so a browser holding one for a minute is never meaningfully wrong. The
// in-flight promise is cached, not just the result, so the header and the body
// firing at the same instant on a cold load share the single request rather than
// racing two. `forgetMe` drops it when something we did could have changed it.
let meCache = null; // { at, promise }
const ME_TTL = 60000;
function me() {
  const now = Date.now();
  if (meCache && now - meCache.at < ME_TTL) return meCache.promise;
  const promise = get('/me').catch((err) => {
    // A failed lookup must not stick: the next caller should get a fresh try,
    // not a cached rejection for the rest of the minute.
    if (meCache && meCache.promise === promise) meCache = null;
    throw err;
  });
  meCache = { at: now, promise };
  return promise;
}
function forgetMe() {
  meCache = null;
}

async function send(path, method, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // Same-origin by default, but the dashboard is on a subdomain and the
    // session cookie has to travel with it.
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`request failed: ${res.status}`);
    err.status = res.status;
    try { err.body = await res.json(); } catch { /* ignore */ }
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  network: () => get('/network'),
  me,
  forgetMe,
  logout: () => send('/auth/logout', 'POST'),

  applyRoles: () => get('/apply'),
  applyForm: (role) => get(`/apply/${encodeURIComponent(role)}`),
  // attachments is { questionIndex: [uploadId, …] }, empty for most roles.
  applySubmit: (role, answers, attachments = {}) =>
    send(`/apply/${encodeURIComponent(role)}`, 'POST', { answers, attachments }),
  myApplications: () => get('/my/applications'),

  // One image as the raw body — see routes/uploads for why there is no multipart
  // here. Not the JSON `send` helper: this posts bytes, not a stringified object.
  upload: async (file) => {
    const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      credentials: 'include',
      body: file,
    });
    if (!res.ok) {
      const err = new Error(`upload failed: ${res.status}`);
      err.status = res.status;
      try { err.body = await res.json(); } catch { /* ignore */ }
      throw err;
    }
    return res.json();
  },

  // The signed-in player's own paperwork.
  my: {
    summary: () => get('/my/summary'),
    reports: () => get('/my/reports'),
    appeals: () => get('/my/appeals'),
    punishments: () => get('/my/punishments'),
    logins: () => get('/my/logins'),
  },

  linkStatus: () => get('/link'),
  linkCode: () => send('/link/code', 'POST'),
  unlink: () => send('/link', 'DELETE'),

  reportCategories: () => get('/report/categories'),
  report: (body) => send('/report', 'POST', body),
  appeal: (body) => send('/appeal', 'POST', body),

  dash: {
    summary: () => get('/dash/summary'),
    queue: () => get('/dash/queue'),
    stats: () => get('/dash/stats'),
    player: (name) => get(`/dash/player/${encodeURIComponent(name)}`),
    applications: (status) => get(`/dash/applications${status ? `?status=${status}` : ''}`),
    reviewApplication: (id, decision, note) => send(`/dash/applications/${id}`, 'POST', { decision, note }),
    reports: (status) => get(`/dash/reports${status ? `?status=${status}` : ''}`),
    resolveReport: (id, outcome) => send(`/dash/reports/${id}`, 'POST', { outcome }),
    appeals: (status) => get(`/dash/appeals${status ? `?status=${status}` : ''}`),
    resolveAppeal: (id, outcome, note) => send(`/dash/appeals/${id}`, 'POST', { outcome, note }),
    hidden: () => get('/dash/hidden'),
    hide: (name, reason) => send('/dash/hidden', 'POST', { name, reason }),
    unhide: (uuid) => send(`/dash/hidden/${uuid}`, 'DELETE'),
    audit: () => get('/dash/audit'),

    // Reaching into the game — routes/moderation.
    punish: (body) => send('/dash/punish', 'POST', body),
    revoke: (pid, reason) => send(`/dash/punish/${encodeURIComponent(pid)}/revoke`, 'POST', { reason }),
    ranks: () => get('/dash/ranks'),
    grant: (body) => send('/dash/grant', 'POST', body),
    grantStatus: (id) => get(`/dash/grant/${id}`),
    actions: () => get('/dash/actions'),
    action: (id) => get(`/dash/actions/${id}`),

    // Admin surface — routes/admin.
    rules: () => get('/dash/rules'),
    saveRules: (sections) => send('/dash/rules', 'PUT', { sections }),
    resetRules: () => send('/dash/rules/reset', 'POST'),
    access: () => get('/dash/access'),
    setAccess: (id, grant, deny) => send(`/dash/access/${encodeURIComponent(id)}`, 'PUT', { grant, deny }),

    // The network editor — ranks and ladders (routes/admin). Edits are queued
    // for the plugin and watched to completion, the same as a punishment.
    configRanks: () => get('/dash/config/ranks'),
    configLadders: () => get('/dash/config/ladders'),
    saveRank: (body) => send('/dash/config/rank', 'POST', body),
    saveLadder: (body) => send('/dash/config/ladder', 'POST', body),
    configAction: (id) => get(`/dash/config/action/${id}`),

    // The report menu — the categories a player picks (routes/admin).
    categories: () => get('/dash/config/categories'),
    saveCategory: (body) => send('/dash/config/category', 'POST', body),

    // The chat filter and the cosmetic tags (routes/admin).
    configFilters: () => get('/dash/config/filters'),
    saveFilter: (body) => send('/dash/config/filter', 'POST', body),
    configTags: () => get('/dash/config/tags'),
    saveTag: (body) => send('/dash/config/tag', 'POST', body),

    // What the core recorded — commands run, lines said (routes/admin).
    commandLogs: (q, limit) => get(`/dash/logs/commands?q=${encodeURIComponent(q || '')}&limit=${limit || 100}`),
    chatLogs: (q, limit) => get(`/dash/logs/chat?q=${encodeURIComponent(q || '')}&limit=${limit || 100}`),

    // The live feeds behind the Live page (routes/live). Both take a `since`
    // millisecond cursor and return only what is newer.
    chatFeed: (since, limit) => get(`/dash/feed/chat?since=${since || 0}&limit=${limit || 60}`),
    pulse: (since, limit) => get(`/dash/pulse?since=${since || 0}&limit=${limit || 40}`),

    // Who on the team has been moderating, and how much (routes/admin).
    staffActivity: () => get('/dash/staff-activity'),

    // Announcements to the game (routes/moderation). kind 'staff' becomes the
    // core's own prefixed alert; 'all' a network-wide announcement.
    broadcast: (kind, message) => send('/dash/broadcast', 'POST', { kind, message }),
    broadcasts: () => get('/dash/broadcasts'),
    // One line, both halves of the network. Each target answers for itself.
    announce: (body) => send('/dash/announce', 'POST', body),

    // Reaching one player where they are standing.
    playerMessage: (name, message) => send('/dash/player/message', 'POST', { name, message }),
    playerSend: (name, server) => send('/dash/player/send', 'POST', { name, server }),
    // The smaller powers — unsticking rather than punishing.
    playerTool: (name, tool) => send('/dash/player/tool', 'POST', { name, tool }),

    // Restarts, and any command at all, on one named server.
    reboot: (server, seconds) => send('/dash/server/reboot', 'POST', { server, seconds }),
    rebootCancel: (server) => send('/dash/server/reboot', 'POST', { server, cancel: true }),
    runCommand: (server, command) => send('/dash/server/command', 'POST', { server, command }),

    // The host underneath the game — FeatherPanel (routes/panel).
    panelServers: (q) => get(`/dash/panel/servers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    panelNode: () => get('/dash/panel/node'),
    panelLogs: (id) => get(`/dash/panel/servers/${encodeURIComponent(id)}/logs`),
    panelShareLogs: (id) => send(`/dash/panel/servers/${encodeURIComponent(id)}/logs/share`, 'POST'),
    panelAllocations: (id) => get(`/dash/panel/servers/${encodeURIComponent(id)}/allocations`),
    panelActivities: (id) => get(`/dash/panel/servers/${encodeURIComponent(id)}/activities`),
    panelFiles: (id, path) => get(`/dash/panel/servers/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path || '/')}`),
    panelFile: (id, path) => get(`/dash/panel/servers/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`),
    panelWriteFile: async (id, path, content) => {
      // Raw body, not JSON: the panel takes the file as the file.
      const res = await fetch(`/api/dash/panel/servers/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
      });
      if (!res.ok) {
        const err = new Error(`write failed: ${res.status}`);
        err.status = res.status;
        try { err.body = await res.json(); } catch { /* ignore */ }
        throw err;
      }
      return res.json();
    },
    panelBackups: (id) => get(`/dash/panel/servers/${encodeURIComponent(id)}/backups`),
    panelWorlds: (id) => get(`/dash/panel/servers/${encodeURIComponent(id)}/worlds`),
    panelWorldBackup: (id, w) => send(`/dash/panel/servers/${encodeURIComponent(id)}/worlds/${encodeURIComponent(w)}/backup`, 'POST'),
    panelWorldRename: (id, w, newName) => send(`/dash/panel/servers/${encodeURIComponent(id)}/worlds/${encodeURIComponent(w)}/rename`, 'POST', { newName }),
    panelWorldDelete: (id, w) => send(`/dash/panel/servers/${encodeURIComponent(id)}/worlds/${encodeURIComponent(w)}`, 'DELETE'),
    panelPlayers: (id) => get(`/dash/panel/servers/${encodeURIComponent(id)}/players`),
    panelPower: (id, action) => send(`/dash/panel/servers/${encodeURIComponent(id)}/power/${action}`, 'POST'),
    panelCommand: (id, command) => send(`/dash/panel/servers/${encodeURIComponent(id)}/command`, 'POST', { command }),
    panelBackup: (id) => send(`/dash/panel/servers/${encodeURIComponent(id)}/backups`, 'POST'),
    panelRestore: (id, b) => send(`/dash/panel/servers/${encodeURIComponent(id)}/backups/${encodeURIComponent(b)}/restore`, 'POST'),
    panelDeleteBackup: (id, b) => send(`/dash/panel/servers/${encodeURIComponent(id)}/backups/${encodeURIComponent(b)}`, 'DELETE'),

    // One box over the whole console.
    search: (q) => get(`/dash/search?q=${encodeURIComponent(q)}`),

    // The whole punishment record — every ban, mute, kick and blacklist the
    // network has handed out, filterable by type, by whether it bites right now,
    // and by player or staff name (routes/moderation).
    punishmentRecord: ({ type, state, q, page } = {}) => {
      const p = new URLSearchParams();
      if (type) p.set('type', type);
      if (state) p.set('state', state);
      if (q) p.set('q', q);
      if (page && page > 1) p.set('page', page);
      const s = p.toString();
      return get(`/dash/punishments${s ? `?${s}` : ''}`);
    },

    // Everything the core recorded about one player, and chat frozen as evidence.
    dossier: (name) => get(`/dash/player/${encodeURIComponent(name)}/dossier`),
    takeSnapshot: (name) => send('/dash/player/snapshot', 'POST', { name }),
    snapshot: (id) => get(`/dash/snapshot/${encodeURIComponent(id)}`),

    // The Discord half (routes/discord) — the bot performs all of it.
    discordChannels: () => get('/dash/discord/channels'),
    discordMessage: (body) => send('/dash/discord/message', 'POST', body),
    discordMember: (body) => send('/dash/discord/member', 'POST', body),
    discordTask: (id) => get(`/dash/discord/task/${id}`),
    breakLink: (discordId) => send(`/dash/link/${encodeURIComponent(discordId)}`, 'DELETE'),

    // The network as it is right now, and the switch that closes it.
    servers: () => get('/dash/servers'),
    maintenance: (on) => send('/dash/maintenance', 'POST', { on }),
    whitelist: (name, add) => send('/dash/whitelist', 'POST', { name, add }),

    // Everyone who has signed in (routes/admin).
    users: () => get('/dash/users'),

    // Config backups (routes/admin).
    backups: () => get('/dash/backups'),
    createBackup: (note) => send('/dash/backups', 'POST', { note }),
    getBackup: (id) => get(`/dash/backups/${encodeURIComponent(id)}`),
    deleteBackup: (id) => send(`/dash/backups/${encodeURIComponent(id)}`, 'DELETE'),
    restoreBackup: (id) => send(`/dash/backups/${encodeURIComponent(id)}/restore`, 'POST'),
  },

  health: () => get('/health'),
  leaderboard: (mode, { metric, kit, limit } = {}) => {
    const q = new URLSearchParams();
    if (metric) q.set('metric', metric);
    if (kit) q.set('kit', kit);
    if (limit) q.set('limit', limit);
    const s = q.toString();
    return get(`/leaderboards/${mode}${s ? '?' + s : ''}`);
  },
  player: (name) => get(`/player/${encodeURIComponent(name)}`),
  players: () => get('/players'),
  search: (q) => get(`/search?q=${encodeURIComponent(q)}`),
  staff: () => get('/staff'),
  media: () => get('/media'),
  rules: () => get('/rules'),
};
