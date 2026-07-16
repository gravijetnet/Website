// Minimal history-based router with link interception.
let handler = null;

function run() {
  if (handler) handler(location.pathname, new URLSearchParams(location.search));
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  run();
}

export function startRouter(fn) {
  handler = fn;
  window.addEventListener('popstate', run);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || a.target === '_blank' || a.hasAttribute('data-ext')) return;
    e.preventDefault();
    navigate(href);
  });
  run();
}
