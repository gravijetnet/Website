// Player suggestions, as the site's own search does them.
//
// The console's look-up used to be a bare datalist, which the browser draws in
// its own chrome: no head, no rank, no colour, and nothing you could arrow
// through. This is the same list the site header uses — a face, a name, the rank
// in its own colour — pulled out so both surfaces are literally the same widget
// rather than two things that resemble each other.
//
// Tab completes to the highlighted suggestion, or to the first one if you have
// not moved: the same gesture as completing a name in game.
import { api } from './api.js';
import { esc, head } from './util.js';

/**
 * @param {HTMLInputElement} input  the field being typed into
 * @param {HTMLElement} out         where the suggestions are drawn
 * @param {(name: string) => void} onPick  called with the chosen name
 */
export function attachPlayerSuggest(input, out, onPick) {
  let items = [];
  let sel = -1;
  let timer = null;
  // Only the newest answer may paint — a slow lookup for "a" must not land on
  // top of the fast one for "abc" typed after it.
  let seq = 0;

  const close = () => {
    out.innerHTML = '';
    items = [];
    sel = -1;
  };

  const paint = () => {
    out.innerHTML = items
      .map(
        (p, i) => `
        <a class="search-row ${i === sel ? 'sel' : ''}" data-pick="${esc(p.name)}" href="#">
          <img src="${head(p.uuid, 52)}" alt="" onerror="this.onerror=null;this.src='${head(null, 52)}'">
          <span class="nm">${esc(p.name)}</span>
          <span class="rk" style="color:${p.rank?.color || '#aaa'}">${esc(p.rank?.label || '')}</span>
        </a>`,
      )
      .join('');
  };

  const pick = (name) => {
    input.value = name;
    close();
    onPick(name);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) return close();
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const found = await api.search(q);
        if (mine !== seq || !input.isConnected) return;
        items = found || [];
        sel = -1;
        paint();
      } catch {
        close();
      }
    }, 140);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return close();
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = (sel + 1) % items.length;
      paint();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel - 1 + items.length) % items.length;
      paint();
    } else if (e.key === 'Tab') {
      // Complete, and stay in the field — tabbing away from a half-typed name is
      // never what you meant by pressing it here.
      e.preventDefault();
      pick(items[sel >= 0 ? sel : 0].name);
    } else if (e.key === 'Enter' && sel >= 0) {
      e.preventDefault();
      pick(items[sel].name);
    }
  });

  out.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pick]');
    if (!row) return;
    e.preventDefault();
    pick(row.dataset.pick);
  });

  document.addEventListener('click', (e) => {
    if (e.target !== input && !out.contains(e.target)) close();
  });
}
