// Asking, on the page.
//
// The browser's own confirm() is a grey box in the operating system's font that
// appears above the site rather than in it — on a page built to look like the
// game, it is the one element that admits none of this is real. It also cannot
// say which of two buttons is the dangerous one, cannot be read at a glance, and
// on some browsers can be suppressed entirely, which for "delete this rank" is
// not a cosmetic problem.
//
// So: the game's own dialog. Darkened world behind, a panel on top, the
// dangerous choice wearing the colour that means danger. Escape and the darkened
// area both mean no — the two gestures everybody already tries.
import { esc } from './util.js';

let open = null;

function close(result) {
  if (!open) return;
  const { el, resolve, restore } = open;
  open = null;
  document.removeEventListener('keydown', onKey, true);
  el.remove();
  if (restore && restore.isConnected) restore.focus();
  resolve(result);
}

function onKey(e) {
  if (!open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close(open.cancelValue);
  } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    close(open.confirmValue);
  } else if (e.key === 'Tab') {
    // A dialog you can tab out of is a dialog that is not really modal — the
    // focus wraps inside it instead.
    const focusable = [...open.el.querySelectorAll('button, [href], input, select, textarea')]
      .filter((n) => !n.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

/**
 * The one primitive everything else is built on.
 * @returns {Promise<boolean>} what the person chose
 */
export function ask({
  title,
  body = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  // Two dialogs at once is always a bug; the older one loses.
  if (open) close(false);

  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'modal-back';
    el.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title || 'Confirm')}">
        <div class="modal-head">${esc(title || 'Are you sure?')}</div>
        ${body ? `<div class="modal-body">${esc(body)}</div>` : ''}
        <div class="modal-acts">
          ${cancelLabel ? `<button class="btn" data-no>${esc(cancelLabel)}</button>` : ''}
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmLabel)}</button>
        </div>
      </div>`;

    document.body.appendChild(el);
    open = { el, resolve, restore: document.activeElement, confirmValue: true, cancelValue: false };

    el.querySelector('[data-yes]').addEventListener('click', () => close(true));
    el.querySelector('[data-no]')?.addEventListener('click', () => close(false));
    // Only the darkened area, not a stray click inside the panel.
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(false); });
    document.addEventListener('keydown', onKey, true);

    // Focus the safe choice, so a reflexive Enter never destroys anything.
    const safe = danger ? el.querySelector('[data-no]') : el.querySelector('[data-yes]');
    (safe || el.querySelector('[data-yes]')).focus();
  });
}

/** A confirmation whose confirm button is the dangerous one. */
export function confirmDanger(title, body, confirmLabel = 'Delete') {
  return ask({ title, body, confirmLabel, danger: true });
}

/** Something went wrong, or is worth stopping to read. Nothing to decide. */
export function tell(title, body = '') {
  return ask({ title, body, confirmLabel: 'OK', cancelLabel: null }).then(() => undefined);
}
