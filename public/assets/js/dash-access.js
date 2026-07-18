// Who can do what, in Spielplatz. Admin and up (manageAccess).
//
// The Discord-role tiers decide by default; this is the layer of exceptions on
// top — see server/lib/staff. Each staff member is a row; each ability is a
// checkbox whose default comes from their tier and which you can flip on
// (grant) or off (deny) for that person alone.
//
// Two things this page will not let you do, both also enforced server-side: edit
// somebody at or above your own tier, and deny yourself the very permission that
// opens this page.
import { api } from './api.js';
import { notice } from './components.js';
import { esc, timeAgo } from './util.js';

export async function renderAccess(root, can) {
  if (!can.manageAccess) {
    root.innerHTML = notice('Not allowed', 'Changing access needs Admin or above.');
    return;
  }

  let data;
  try {
    data = await api.dash.access();
  } catch {
    root.innerHTML = notice('Unavailable', 'The access list could not be loaded.');
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">The Discord roles decide the default — this is the exceptions</span>
        <h2>Access</h2>
        <p>Everyone with a staff rank, and anyone given an exception. A ticked box is something they can do.</p>
      </div>
    </div>
    <div id="people">${data.people.map((p) => personEl(p, data)).join('')}</div>`;

  wire(root, data);
}

// The abilities that are on for this person right now, and whether each is on
// because of their tier or because of an explicit exception.
function personEl(p, data) {
  const you = p.id === data.you.id;
  // You may not edit somebody standing at or above you. It is still shown — the
  // page is also a way to read who can do what — just not editable.
  const locked = !you && p.tier >= data.you.tier;

  const topRank = p.ranks.length ? esc(p.ranks[0]) : 'no rank';
  return `
    <details class="panel entry acc-person card-roll" data-id="${esc(p.id)}" data-tier="${p.tier}">
      <summary class="card-sum">
        <span class="cs-name">${esc(p.name || p.id)} ${you ? '<span class="tagged">you</span>' : ''}</span>
        <span class="dr">${topRank}</span>
        ${p.updatedAt ? '<span class="re-tag">exception</span>' : ''}
        ${locked ? '<span class="cs-meta">read only</span>' : ''}
      </summary>
      <div class="panel-body">
        <div class="ph-sub">${p.ranks.length ? esc(p.ranks.join(', ')) : 'no rank'}${p.updatedAt ? ` · exception set ${esc(timeAgo(p.updatedAt))}${p.updatedBy ? ` by ${esc(p.updatedBy)}` : ''}` : ''}</div>
        <div class="acc-grid">
          ${data.abilities.map((a) => abilityBox(a, p, locked, data)).join('')}
        </div>
        <div class="factions">
          ${locked ? '<span class="dr">outranks you — read only</span>' : '<button class="btn btn-primary" data-save>Save</button>'}
          <span class="fmsg" data-msg></span>
        </div>
      </div>
    </details>`;
}

function abilityBox(a, p, locked, data) {
  const on = !!p.abilities[a.key];
  // The tier alone would give this, before any exception — so the UI can say
  // "this box is ticked because of their rank" vs "because you ticked it".
  const byTier = p.tier >= (data.needs[a.key] || 99);
  const overridden = (on && !byTier) || (!on && byTier);
  return `
    <label class="acc-item ${overridden ? 'acc-over' : ''}" title="${esc(a.note || '')}">
      <input type="checkbox" data-ability="${esc(a.key)}" data-tier="${byTier ? '1' : '0'}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''}>
      <span class="acc-label">${esc(a.label)}</span>
      ${a.note ? `<span class="acc-note">${esc(a.note)}</span>` : ''}
    </label>`;
}

function wire(root, data) {
  root.querySelectorAll('.acc-person').forEach((el) => {
    const btn = el.querySelector('[data-save]');
    if (!btn) return;
    const msg = el.querySelector('[data-msg]');

    btn.addEventListener('click', async () => {
      const grant = [];
      const deny = [];
      // An exception is only recorded where the box disagrees with the tier. A
      // tier default left untouched must not be frozen into an override — then a
      // later promotion would not lift with them.
      el.querySelectorAll('[data-ability]').forEach((cb) => {
        const byTier = cb.dataset.tier === '1';
        if (cb.checked && !byTier) grant.push(cb.dataset.ability);
        if (!cb.checked && byTier) deny.push(cb.dataset.ability);
      });

      btn.disabled = true;
      msg.className = 'fmsg';
      msg.textContent = 'Saving…';
      try {
        await api.dash.setAccess(el.dataset.id, grant, deny);
        msg.className = 'fmsg ok';
        msg.textContent = grant.length || deny.length ? 'Saved.' : 'Cleared — back to their rank default.';
      } catch (err) {
        msg.className = 'fmsg bad';
        msg.textContent =
          err?.body?.error === 'target_outranks_you' ? 'They outrank you.'
          : err?.body?.error === 'cannot_lock_yourself_out' ? 'You cannot deny yourself this page.'
          : 'That did not save.';
      } finally {
        btn.disabled = false;
      }
    });
  });
}
