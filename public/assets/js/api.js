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
  applySubmit: (role, answers) => send(`/apply/${encodeURIComponent(role)}`, 'POST', { answers }),
  myApplications: () => get('/my/applications'),

  reportCategories: () => get('/report/categories'),
  report: (body) => send('/report', 'POST', body),
  appeal: (body) => send('/appeal', 'POST', body),

  dash: {
    summary: () => get('/dash/summary'),
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
