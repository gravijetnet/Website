// Formatting, skin rendering and small DOM helpers.

export const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Integers with thin thousands separators.
export function int(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

// Compact form for very large headline numbers (12.4K, 3.1M).
export function compact(n) {
  n = Number(n) || 0;
  if (Math.abs(n) < 10000) return int(n);
  if (Math.abs(n) < 1e6) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

export function dec(n, p = 2) {
  return (Number(n) || 0).toFixed(p);
}

// seconds -> "3d 4h" / "12h 30m" / "42m"
export function playtime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// match duration is stored in seconds
export function secs(s) {
  s = Math.floor(Number(s) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// FastBuilder best times are milliseconds
export function ms(v) {
  v = Number(v) || 0;
  return (v / 1000).toFixed(2) + 's';
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!t) return '—';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

export function dateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// --- skins -----------------------------------------------------------------
// Served from our own origin: the renderers are still third-party, but /api/skin
// caches their answers and Cloudflare caches ours. See server/routes/skin.js.
export const STEVE = 'MHF_Steve';

export function head(uuid, size = 64) {
  return `/api/skin/head/${encodeURIComponent(uuid || STEVE)}.png?s=${size}`;
}

// The server falls back between renderers itself, so `fallback` is only for the
// case where every one of them is down.
export function bodyImg(uuid) {
  const u = uuid || STEVE;
  return {
    src: `/api/skin/body/${encodeURIComponent(u)}.png`,
    fallback: `/api/skin/body/${STEVE}.png`,
  };
}

// Count-up animation for headline numbers (skipped under reduced motion).
export function countUp(node, to, { format = int, ms: dur = 900 } = {}) {
  to = Number(to) || 0;
  if (REDUCED || to === 0) { node.textContent = format(to); return; }
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = format(to * eased);
    if (t < 1) requestAnimationFrame(step);
    else node.textContent = format(to);
  }
  requestAnimationFrame(step);
}
