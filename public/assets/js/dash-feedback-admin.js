// Feedback, from the team's side — the third queue.
//
// Reports are about players, appeals are about punishments; this is the pile of
// things players have told us about the game itself. Bugs first, because a bug
// is a defect sitting in the game until somebody looks, and suggestions second,
// where the board's upvotes have already done the triage of saying which ones
// people actually want.
//
// Reading needs viewReports, the same right that opens the other two queues.
// Changing a status needs resolveReports — closing a bug or planning a
// suggestion is the same kind of decision as closing a report, so it is gated
// the same way, and the controls simply are not drawn for anyone without it.
import { api } from './api.js';
import { icons } from './icons.js';
import { pageLoader, notice } from './components.js';
import { esc, head, timeAgo, dateShort } from './util.js';

const KINDS = [
  { key: 'bug', label: 'Bugs', icon: 'bolt' },
  { key: 'suggestion', label: 'Suggestions', icon: 'rules' },
];

// The word each status wears, and how loud it reads. Kept in step with the
// server's ladders (routes/feedback) and the player's copy (dash-feedback).
const STATUS = {
  bug: {
    open: { label: 'Open', cls: '' },
    acknowledged: { label: 'Acknowledged', cls: 'soon' },
    fixed: { label: 'Fixed', cls: 'live' },
    wontfix: { label: "Won't fix", cls: 'dead' },
    duplicate: { label: 'Already known', cls: '' },
  },
  suggestion: {
    open: { label: 'Open', cls: '' },
    planned: { label: 'Planned', cls: 'soon' },
    done: { label: 'Done', cls: 'live' },
    declined: { label: 'Declined', cls: 'dead' },
  },
};

function statusLabel(kind, s) {
  return (STATUS[kind] && STATUS[kind][s]) || { label: s, cls: '' };
}

export async function renderFeedbackAdmin(root, can) {
  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Feedback</h2>
        <p>What players told us about the game — bugs to fix, and ideas they voted up.</p>
      </div>
    </div>
    <section class="panel entry"><div class="panel-body">
      <div class="fbbar">
        <div class="lb-tabs" id="fbkinds">
          ${KINDS.map((k, i) => `<button class="btn lb-tab ${i === 0 ? 'active' : ''}" data-kind="${k.key}">${k.label}</button>`).join('')}
        </div>
        <div class="lb-tabs" id="fbstatus"></div>
      </div>
    </div></section>
    <div id="fblist">${pageLoader()}</div>`;

  const kindsBox = root.querySelector('#fbkinds');
  const statusBox = root.querySelector('#fbstatus');
  const list = root.querySelector('#fblist');

  let kind = 'bug';
  let status = ''; // '' == every status
  let seq = 0;

  const drawStatusFilters = (statuses, counts) => {
    const chip = (key, label, n) =>
      `<button class="btn lb-tab ${key === status ? 'active' : ''}" data-status="${key}">${esc(label)}${n != null ? ` <span class="fb-cn">${n}</span>` : ''}</button>`;
    const total = statuses.reduce((s, k) => s + (counts[k] || 0), 0);
    statusBox.innerHTML = [
      chip('', 'All', total),
      ...statuses.map((s) => chip(s, statusLabel(kind, s).label, counts[s] || 0)),
    ].join('');
    statusBox.querySelectorAll('[data-status]').forEach((b) =>
      b.addEventListener('click', () => { status = b.dataset.status; load(); }),
    );
  };

  async function load() {
    const mine = ++seq;
    list.innerHTML = pageLoader();
    try {
      const data = await api.dash.feedback(kind, status);
      if (mine !== seq) return;
      drawStatusFilters(data.statuses, data.counts);
      list.innerHTML = data.rows.length
        ? data.rows.map((r) => card(kind, r, can)).join('')
        : '<div class="board"><div class="empty">Nothing here. When players file, it lands in this list.</div></div>';
      if (can.resolveReports) list.querySelectorAll('[data-save]').forEach((btn) => wireSave(btn, kind));
    } catch {
      if (mine !== seq) return;
      list.innerHTML = notice('Unavailable', 'That list could not be read.');
    }
  }

  kindsBox.querySelectorAll('[data-kind]').forEach((btn) =>
    btn.addEventListener('click', () => {
      kind = btn.dataset.kind;
      status = '';
      kindsBox.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('active', b === btn));
      load();
    }),
  );

  await load();
}

function submitter(r) {
  if (r.minecraft?.name) {
    return `<a href="/players?q=${encodeURIComponent(r.minecraft.name)}">${esc(r.minecraft.name)}</a> <span class="dr">(${esc(r.by || 'unknown')})</span>`;
  }
  return `<span>${esc(r.by || 'unknown')}</span> <span class="dr">— no linked account</span>`;
}

function card(kind, r, can) {
  const st = statusLabel(kind, r.status);
  const controls = can.resolveReports
    ? `
      <div class="fb-ctl">
        <select class="fld fld-inline" data-status style="max-width:170px">
          ${Object.keys(STATUS[kind]).map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${esc(statusLabel(kind, s).label)}</option>`).join('')}
        </select>
        <input class="fld fld-inline" data-note placeholder="A note back to them (optional)" value="${esc(r.note || '')}" maxlength="4000">
        <button class="btn btn-primary" data-save="${esc(r._id)}">Save</button>
        <span class="fmsg" data-msg></span>
      </div>`
    : r.note
      ? `<div class="block"><div class="block-label">Staff note</div><p class="rule-text">${esc(r.note)}</p></div>`
      : '';

  return `
    <section class="panel entry" data-card="${esc(r._id)}">
      <div class="panel-head">
        <div class="glyph">${icons[kind === 'bug' ? 'bolt' : 'rules']}</div>
        <div style="min-width:0">
          <h3>${esc(r.title)}</h3>
          <div class="ph-sub">
            ${r.tag ? `${esc(r.tag)} · ` : ''}by ${submitter(r)} · ${timeAgo(r.filedAt)}
            ${r.voteCount != null ? ` · <b class="fb-votes">${r.voteCount} upvote${r.voteCount === 1 ? '' : 's'}</b>` : ''}
          </div>
        </div>
        <div class="ph-right"><span class="badge ${st.cls}" data-badge>${esc(st.label)}</span></div>
      </div>
      <div class="panel-body">
        <p class="rule-text">${esc(r.detail)}</p>
        ${controls}
      </div>
    </section>`;
}

function wireSave(btn, kind) {
  const card = btn.closest('[data-card]');
  const sel = card.querySelector('[data-status]');
  const note = card.querySelector('[data-note]');
  const msg = card.querySelector('[data-msg]');
  const badge = card.querySelector('[data-badge]');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.className = 'fmsg';
    msg.textContent = 'Saving…';
    try {
      await api.dash.setFeedback(kind, btn.dataset.save, sel.value, note.value.trim());
      const st = statusLabel(kind, sel.value);
      badge.className = `badge ${st.cls}`;
      badge.textContent = st.label;
      msg.className = 'fmsg ok';
      msg.textContent = 'Saved';
      setTimeout(() => { msg.textContent = ''; }, 1500);
    } catch {
      msg.className = 'fmsg bad';
      msg.textContent = 'That did not save.';
    } finally {
      btn.disabled = false;
    }
  });
}
