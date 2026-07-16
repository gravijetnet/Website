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

// --- skins (rendered client-side from third-party services) ----------------
export function head(uuid, size = 64) {
  return `https://mc-heads.net/avatar/${uuid || 'MHF_Steve'}/${size}`;
}
// 3D body via StarlightSkins, falling back to a flat mc-heads body on error.
export function bodyImg(uuid) {
  const u = uuid || 'MHF_Steve';
  return {
    src: `https://starlightskins.lunareclipse.studio/render/walking/${u}/full`,
    fallback: `https://mc-heads.net/body/${u}/300`,
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

// Intersection-based reveal for sections.
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.12 })
  : null;
export function reveal(root = document) {
  root.querySelectorAll('.reveal:not(.in)').forEach((n) => (io ? io.observe(n) : n.classList.add('in')));
}
