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
  me: () => get('/me'),
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

    // Announcements to the game (routes/moderation).
    broadcast: (kind, message) => send('/dash/broadcast', 'POST', { kind, message }),
    broadcasts: () => get('/dash/broadcasts'),

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
