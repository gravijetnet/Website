// Thin API client. Every call resolves to parsed JSON or throws an Error with
// a `.status` for the views to branch on (e.g. 404 -> "player not found").

async function get(path) {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`request failed: ${res.status}`);
    err.status = res.status;
    try { err.body = await res.json(); } catch { /* ignore */ }
    throw err;
  }
  return res.json();
}

export const api = {
  network: () => get('/network'),
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
};
