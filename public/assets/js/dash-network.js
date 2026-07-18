// The network editor: ranks and the punishment ladders, edited from Spielplatz.
//
// This is the deepest surface the console has. Everything here changes Phoenix's
// own configuration — what a rank *is*, what a ladder *does* — rather than what
// the website shows or what one player did. So nothing saves straight to a
// database: an edit is queued for the MoreFeatures plugin, which applies it in
// game through the core's API, and the page watches that job to its end and says
// exactly what the core did with it. See routes/admin and ConfigActionQueue.java.
//
// One shape recurs: an editor is a form over the current config, you change what
// you like, and Save sends the whole desired state. The server diffs it down to
// the few operations that actually changed, so a Save that only recoloured a
// rank queues one operation, not thirteen.
import { api } from './api.js';
import { esc, dur, timeAgo, dateShort } from './util.js';
import { pageLoader, notice } from './components.js';

// --- Minecraft colour codes, rendered ---------------------------------------
// So a prefix reads as what it will look like in chat, not as `&aHelper &8|`.

const MC = {
  0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa',
  6: '#ffaa00', 7: '#aaaaaa', 8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

// A faithful-enough preview of a legacy colour string. Not a chat renderer — it
// only needs to make a prefix legible and show what a colour code does. Exported
// because a broadcast and a report category read the same &-codes.
export function mcPreview(raw) {
  const s = String(raw || '');
  let out = '';
  let color = '#ffffff';
  let bold = false, italic = false, under = false, strike = false;
  const flush = (text) => {
    if (!text) return;
    const deco = [under ? 'underline' : '', strike ? 'line-through' : ''].filter(Boolean).join(' ');
    out += `<span style="color:${color}${bold ? ';font-weight:700' : ''}${italic ? ';font-style:italic' : ''}${deco ? ';text-decoration:' + deco : ''}">${esc(text)}</span>`;
  };
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ((ch === '&' || ch === '§') && i + 1 < s.length) {
      const code = s[++i].toLowerCase();
      flush(buf); buf = '';
      if (MC[code]) { color = MC[code]; bold = italic = under = strike = false; }
      else if (code === 'l') bold = true;
      else if (code === 'o') italic = true;
      else if (code === 'n') under = true;
      else if (code === 'm') strike = true;
      else if (code === 'r') { color = '#ffffff'; bold = italic = under = strike = false; }
      // k (obfuscated) is left as-is: previewing scramble helps nobody.
    } else {
      buf += ch;
    }
  }
  flush(buf);
  return out || '<span style="color:#888">—</span>';
}

// --- watching a queued edit -------------------------------------------------

const CFG_ERR = {
  bad_op: 'That is not an edit the server understands.',
  bad_name: 'A rank name is letters, numbers, dashes and underscores — nothing else.',
  bad_id: 'Missing which ladder to edit.',
  bad_value: 'One of the numbers was not a number.',
  unknown_rank: 'No rank by that name.',
  unknown_ladder: 'No ladder by that name.',
  unknown_inherit: 'Tried to inherit a rank that does not exist.',
  perm_not_in_pool: 'That permission is on no rank yet, so there is nothing to copy. Add it to a rank in game once, then it can be set from here.',
  rank_exists: 'A rank with that name already exists.',
  is_default_rank: 'The default rank cannot be deleted — everyone falls back to it.',
  rank_protected: 'That rank is the network’s top standing. Only Management may edit it.',
  no_changes: 'Nothing changed.',
  too_many_changes: 'That is more changes than one save should carry.',
  cannot_add_step: 'A brand-new ladder rung has to be added in game — the core gives no safe way to build one from here.',
  bad_step_type: 'That is not a punishment type.',
  bad_step_order: 'A step order is a whole number from 1 up.',
  bad_step_duration: 'A step duration must be zero or more milliseconds.',
  bad_step_decay: 'A step decay must be zero or more milliseconds.',
  plugin_missing: 'The game-side plugin is not deployed yet, so this cannot reach the network.',
  forbidden: 'Your rank does not allow this.',
  // report menu
  displayname_required: 'Give the category a display name.',
  bad_material: 'That is not a valid material name.',
  category_exists: 'A category with that name already exists.',
  unknown_category: 'No category by that name.',
};

function cfgErr(err) {
  const code = err?.body?.error;
  const base = CFG_ERR[code] || 'That did not go through.';
  return err?.body?.detail ? `${base} (${err.body.detail})` : base;
}

// Polls a queued config edit to its end, and reports what the core actually did
// — the summary the plugin writes ("colour, +core.command.fly") lands in
// `result`, which is the honest answer to "did my edit take".
async function watchJob(jobId, msg) {
  for (let i = 0; i < 25; i++) {
    let row;
    try { row = await api.dash.configAction(jobId); } catch { return { status: 'unknown' }; }
    if (row.status === 'done' || row.status === 'failed') return row;
    if (msg) msg.textContent = i < 2 ? 'Sending to the network…' : 'Waiting for a server to apply it…';
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'pending' };
}

function reportJob(msg, row) {
  if (row.status === 'done') { msg.className = 'fmsg ok'; msg.textContent = `Applied in game: ${row.result || 'done'}.`; return true; }
  if (row.status === 'failed') { msg.className = 'fmsg bad'; msg.textContent = `The core refused it: ${row.result || 'no reason given'}`; return false; }
  if (row.status === 'pending') { msg.className = 'fmsg bad'; msg.textContent = 'No server picked it up — is one online?'; return false; }
  msg.className = 'fmsg';
  msg.textContent = 'Queued. It will apply when a server next runs.';
  return false;
}

function notInstalled() {
  return notice(
    'Not deployed yet',
    'The plugin build that applies these edits has not reached the game servers yet. It goes out on the next deploy and takes effect on each server’s next restart. Until then you can look, but a save will report that it could not reach the network.',
  );
}

// ============================================================ ranks =========

const FLAGS = [
  { key: 'staff', label: 'Staff', note: 'Counts as a moderator — the core treats them accordingly.' },
  { key: 'visible', label: 'Visible', note: 'Shown in tab, chat and on the site.' },
  { key: 'grantable', label: 'Grantable', note: 'Can be handed out with a grant.' },
  { key: 'purchasable', label: 'Purchasable', note: 'Can be bought in the store.' },
  { key: 'subscription', label: 'Subscription', note: 'A recurring rank.' },
  { key: 'defaultRank', label: 'Default rank', note: 'Everyone with no other rank. There should be exactly one.' },
];

const TEXTF = [
  { key: 'color', label: 'Colour', ph: '&a' },
  { key: 'prefix', label: 'Prefix', ph: '&aHelper &8| &a' },
  { key: 'suffix', label: 'Suffix', ph: '' },
  { key: 'displayName', label: 'Display name', ph: 'Helper' },
  { key: 'playerListPrefix', label: 'Tab prefix', ph: '' },
];

export async function renderRanks(root, can) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.configRanks();
  } catch (err) {
    root.innerHTML = notice('Ranks unavailable', 'Could not read the ranks from the core. Try again in a moment.');
    return;
  }

  const pool = data.permissionPool || [];
  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Ranks</h2>
        <p>Every rank on the network — colour, prefix, priority, permissions and inheritance. Saving applies the change in game.</p>
      </div>
    </div>
    ${data.installed ? '' : notInstalled()}
    <details class="rank-ed rank-new">
      <summary><span class="re-name">＋ New rank</span></summary>
      <div class="re-body" id="newrank"></div>
    </details>
    <div id="ranklist">${data.ranks.map((r) => rankCard(r, data.ranks, pool)).join('')}</div>
    <datalist id="permpool">${pool.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;

  // The create form reuses the same fields as an edit, minus the identity that a
  // new rank does not have yet.
  root.querySelector('#newrank').innerHTML = createForm(data.ranks);

  wireRanks(root, data.ranks, pool);
}

function flagRow(r) {
  return FLAGS.map(
    (f) => `<label class="re-flag" title="${esc(f.note)}"><input type="checkbox" data-flag="${f.key}" ${r[f.key] ? 'checked' : ''}> ${esc(f.label)}</label>`,
  ).join('');
}

function textFields(r) {
  return TEXTF.map(
    (f) => `
    <label class="re-field">
      <span class="re-lab">${esc(f.label)}</span>
      <input class="fld" data-text="${f.key}" value="${esc(r[f.key] || '')}" placeholder="${esc(f.ph)}" maxlength="64">
    </label>`,
  ).join('');
}

function permEditor(r, pool) {
  return `
    <div class="re-perms">
      <div class="re-lab">Permissions <span class="re-count">${r.permissions.length}</span></div>
      <div class="permchips" data-perms>
        ${r.permissions.map((p) => permChip(p)).join('') || '<span class="dr">None.</span>'}
      </div>
      <div class="re-permadd">
        <input class="fld" list="permpool" data-permadd placeholder="core.command.something" maxlength="96">
        <button class="btn" type="button" data-permaddbtn>Add</button>
      </div>
      <p class="rule-text re-hint">Type any node — the list suggests ones already in use, but a brand-new one is created too.</p>
    </div>`;
}

function permChip(node) {
  return `<span class="permchip" data-perm="${esc(node)}">${esc(node)}<button type="button" class="permx" title="Remove" data-permdel>×</button></span>`;
}

function inheritEditor(r, allRanks) {
  const others = allRanks.filter((x) => x.name !== r.name);
  const have = new Set(r.inherits || []);
  return `
    <div class="re-inherit">
      <div class="re-lab">Inherits</div>
      <div class="inhrow">
        ${others
          .map(
            (o) => `<label class="inhtog"><input type="checkbox" data-inherit="${esc(o.name)}" ${have.has(o.name) ? 'checked' : ''}> ${esc(o.name)}</label>`,
          )
          .join('')}
      </div>
    </div>`;
}

function rankCard(r, allRanks, pool) {
  return `
    <details class="rank-ed" data-rank="${esc(r.name)}">
      <summary>
        <span class="re-swatch">${mcPreview(r.prefix || r.color + r.name)}</span>
        <span class="re-name">${esc(r.name)}</span>
        <span class="re-prio">priority ${r.priority}</span>
        ${r.staff ? '<span class="re-tag">staff</span>' : ''}
        ${r.defaultRank ? '<span class="re-tag">default</span>' : ''}
        ${r.visible ? '' : '<span class="re-tag muted">hidden</span>'}
      </summary>
      <div class="re-body">
        <div class="re-grid">
          ${textFields(r)}
          <label class="re-field"><span class="re-lab">Priority</span><input class="fld" type="number" data-num="priority" value="${r.priority}"></label>
          <label class="re-field"><span class="re-lab">Price</span><input class="fld" type="number" data-num="price" value="${r.price}"></label>
        </div>
        <div class="re-flags">${flagRow(r)}</div>
        ${permEditor(r, pool)}
        ${inheritEditor(r, allRanks)}
        <div class="factions">
          <button class="btn btn-primary" data-save>Save ${esc(r.name)}</button>
          <button class="btn btn-danger" data-delete>Delete</button>
          <span class="fmsg" data-msg></span>
        </div>
      </div>
    </details>`;
}

function createForm(allRanks) {
  const blank = { color: '', prefix: '', suffix: '', displayName: '', playerListPrefix: '', priority: 0, price: 0, permissions: [], inherits: [] };
  FLAGS.forEach((f) => (blank[f.key] = f.key === 'visible' || f.key === 'grantable'));
  return `
    <label class="re-field"><span class="re-lab">Name</span><input class="fld" data-newname placeholder="Helper" maxlength="64"></label>
    <div class="re-grid">
      ${textFields(blank)}
      <label class="re-field"><span class="re-lab">Priority</span><input class="fld" type="number" data-num="priority" value="0"></label>
      <label class="re-field"><span class="re-lab">Price</span><input class="fld" type="number" data-num="price" value="0"></label>
    </div>
    <div class="re-flags">${flagRow(blank)}</div>
    <p class="rule-text re-hint">Permissions and inheritance can be set once it exists.</p>
    <div class="factions">
      <button class="btn btn-primary" data-createbtn>Create rank</button>
      <span class="fmsg" data-msg></span>
    </div>`;
}

// Reads the desired whole state back off a rank's form.
function readRankForm(box) {
  const body = {};
  box.querySelectorAll('[data-text]').forEach((el) => (body[el.dataset.text] = el.value));
  box.querySelectorAll('[data-num]').forEach((el) => (body[el.dataset.num] = Number(el.value)));
  box.querySelectorAll('[data-flag]').forEach((el) => (body[el.dataset.flag] = el.checked));
  body.permissions = [...box.querySelectorAll('[data-perm]')].map((el) => el.dataset.perm);
  body.inherits = [...box.querySelectorAll('[data-inherit]:checked')].map((el) => el.dataset.inherit);
  return body;
}

function wireRanks(root, allRanks, pool) {
  // The live prefix preview follows the prefix box as you type it.
  root.querySelectorAll('.rank-ed').forEach((card) => {
    const prefixInput = card.querySelector('[data-text="prefix"]');
    const swatch = card.querySelector('.re-swatch');
    if (prefixInput && swatch) {
      prefixInput.addEventListener('input', () => (swatch.innerHTML = mcPreview(prefixInput.value)));
    }

    // Add / remove permission chips.
    const perms = card.querySelector('[data-perms]');
    const addBtn = card.querySelector('[data-permaddbtn]');
    const addInput = card.querySelector('[data-permadd]');
    if (addBtn && addInput && perms) {
      const add = () => {
        const node = addInput.value.trim();
        if (!node || !/^[A-Za-z0-9_.*-]{1,96}$/.test(node)) { addInput.focus(); return; }
        if ([...perms.querySelectorAll('[data-perm]')].some((el) => el.dataset.perm === node)) { addInput.value = ''; return; }
        if (perms.querySelector('.dr')) perms.innerHTML = '';
        perms.insertAdjacentHTML('beforeend', permChip(node));
        addInput.value = '';
      };
      addBtn.addEventListener('click', add);
      addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    }
    if (perms) {
      perms.addEventListener('click', (e) => {
        const x = e.target.closest('[data-permdel]');
        if (x) x.closest('[data-perm]').remove();
      });
    }
  });

  // Save / delete on each existing rank.
  root.querySelectorAll('#ranklist .rank-ed').forEach((card) => {
    const name = card.dataset.rank;
    const msg = card.querySelector('[data-msg]');
    const save = card.querySelector('[data-save]');
    const del = card.querySelector('[data-delete]');

    save.addEventListener('click', async () => {
      const body = { op: 'update', name, ...readRankForm(card) };
      save.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Queuing…';
      try {
        const { jobId } = await api.dash.saveRank(body);
        reportJob(msg, await watchJob(jobId, msg));
      } catch (err) {
        msg.className = 'fmsg bad'; msg.textContent = cfgErr(err);
      } finally {
        save.disabled = false;
      }
    });

    del.addEventListener('click', async () => {
      if (!confirm(`Delete the rank "${name}"? Anyone holding it falls back to the default rank. This applies in game.`)) return;
      del.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Queuing…';
      try {
        const { jobId } = await api.dash.saveRank({ op: 'delete', name });
        if (reportJob(msg, await watchJob(jobId, msg))) setTimeout(() => renderRanks(root, {}), 1200);
      } catch (err) {
        msg.className = 'fmsg bad'; msg.textContent = cfgErr(err);
        del.disabled = false;
      }
    });
  });

  // Create.
  const nf = root.querySelector('#newrank');
  const createBtn = nf.querySelector('[data-createbtn]');
  const cmsg = nf.querySelector('[data-msg]');
  createBtn.addEventListener('click', async () => {
    const name = nf.querySelector('[data-newname]').value.trim();
    if (!name) { cmsg.className = 'fmsg bad'; cmsg.textContent = 'Give it a name.'; return; }
    const body = { op: 'create', name, ...readRankForm(nf) };
    createBtn.disabled = true; cmsg.className = 'fmsg'; cmsg.textContent = 'Queuing…';
    try {
      const { jobId } = await api.dash.saveRank(body);
      if (reportJob(cmsg, await watchJob(jobId, cmsg))) setTimeout(() => renderRanks(root, {}), 1200);
    } catch (err) {
      cmsg.className = 'fmsg bad'; cmsg.textContent = cfgErr(err);
      createBtn.disabled = false;
    }
  });
}

// ============================================================ ladders =======

// A duration editor that is not a millisecond text box. The step already has its
// ms; this shows the largest sensible unit and edits in it.
const UNITS = [
  { u: 'perm', ms: 0, label: 'permanent' },
  { u: 'min', ms: 60000, label: 'minutes' },
  { u: 'hour', ms: 3600000, label: 'hours' },
  { u: 'day', ms: 86400000, label: 'days' },
];

function splitDuration(ms) {
  if (ms <= 0) return { n: 0, u: 'perm' };
  for (const unit of ['day', 'hour', 'min']) {
    const spec = UNITS.find((x) => x.u === unit);
    if (ms % spec.ms === 0) return { n: ms / spec.ms, u: unit };
  }
  return { n: Math.round(ms / 60000), u: 'min' };
}

export async function renderLadders(root, can) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.configLadders();
  } catch {
    root.innerHTML = notice('Ladders unavailable', 'Could not read the ladders from the core. Try again in a moment.');
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Punishment ladders</h2>
        <p>What each repeated offence escalates to. Saving writes the change to the core; a running server picks it up on its next restart. New rungs are added in game — here you re-time, re-type, or remove the ones that exist.</p>
      </div>
    </div>
    ${data.installed ? '' : notInstalled()}
    <div id="ladderlist">${data.ladders.map((l) => ladderCard(l, data.types)).join('')}</div>`;

  wireLadders(root, data.ladders);
}

function stepRow(s, types) {
  const d = splitDuration(s.duration);
  const decay = splitDuration(s.decay);
  return `
    <div class="lad-step" data-order="${s.order}">
      <span class="ls-n">${s.order}</span>
      <select class="fld" data-sf="type">
        ${types.map((t) => `<option value="${t}" ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <span class="ls-dur">
        <input class="fld ls-num" type="number" min="0" data-dur-n value="${d.n}">
        <select class="fld" data-dur-u>${UNITS.map((u) => `<option value="${u.u}" ${u.u === d.u ? 'selected' : ''}>${u.label}</option>`).join('')}</select>
      </span>
      <span class="ls-decay" title="How long this step counts against them before it decays">
        <span class="ls-declab">decay</span>
        <input class="fld ls-num" type="number" min="0" data-decay-n value="${decay.n}">
        <select class="fld" data-decay-u>${UNITS.map((u) => `<option value="${u.u}" ${u.u === decay.u ? 'selected' : ''}>${u.label}</option>`).join('')}</select>
      </span>
      <label class="pcheck"><input type="checkbox" data-sf="ip" ${s.ip ? 'checked' : ''}> IP</label>
      <label class="pcheck"><input type="checkbox" data-sf="shadow" ${s.shadow ? 'checked' : ''}> Shadow</label>
      <button type="button" class="btn btn-danger ls-del" data-stepdel title="Remove this rung">×</button>
    </div>`;
}

function ladderCard(l, types) {
  return `
    <details class="panel entry lad-card card-roll" data-ladder="${esc(l.id)}">
      <summary class="card-sum">
        <span class="cs-name">${esc(l.reason)}</span>
        <span class="dr">${esc(l.id)}</span>
        <span class="cs-meta">${l.steps.length} rung${l.steps.length === 1 ? '' : 's'}${l.hidden ? ' · hidden' : ''}</span>
      </summary>
      <div class="panel-body">
        <div class="lad-head">
          <label class="re-field re-inline"><span class="re-lab">Priority</span><input class="fld ls-num" type="number" data-ladprio value="${l.priority}"></label>
          <label class="pcheck"><input type="checkbox" data-ladhidden ${l.hidden ? 'checked' : ''}> Hidden</label>
          ${l.requireChatSnapshot ? '<span class="dr">needs a chat snapshot</span>' : ''}
        </div>
        <div class="lad-steps">${l.steps.map((s) => stepRow(s, types)).join('')}</div>
        <div class="factions">
          <button class="btn btn-primary" data-ladsave>Save ${esc(l.id)}</button>
          <span class="fmsg" data-msg></span>
        </div>
      </div>
    </details>`;
}

function unitToMs(n, u) {
  if (u === 'perm') return 0;
  const spec = UNITS.find((x) => x.u === u);
  return Math.max(0, Math.trunc(Number(n) || 0)) * (spec ? spec.ms : 60000);
}

function wireLadders(root, ladders) {
  root.querySelectorAll('.lad-card').forEach((card) => {
    const id = card.dataset.ladder;
    const msg = card.querySelector('[data-msg]');

    card.querySelectorAll('[data-stepdel]').forEach((btn) =>
      btn.addEventListener('click', () => btn.closest('.lad-step').remove()),
    );

    card.querySelector('[data-ladsave]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const steps = [...card.querySelectorAll('.lad-step')].map((row) => ({
        order: Number(row.dataset.order),
        type: row.querySelector('[data-sf="type"]').value,
        duration: unitToMs(row.querySelector('[data-dur-n]').value, row.querySelector('[data-dur-u]').value),
        decay: unitToMs(row.querySelector('[data-decay-n]').value, row.querySelector('[data-decay-u]').value),
        ip: row.querySelector('[data-sf="ip"]').checked,
        shadow: row.querySelector('[data-sf="shadow"]').checked,
      }));
      const body = {
        id,
        priority: Number(card.querySelector('[data-ladprio]').value),
        hidden: card.querySelector('[data-ladhidden]').checked,
        steps,
      };
      btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Queuing…';
      try {
        const { jobId } = await api.dash.saveLadder(body);
        reportJob(msg, await watchJob(jobId, msg));
      } catch (err) {
        msg.className = 'fmsg bad'; msg.textContent = cfgErr(err);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// ======================================================= report menu ========

// The categories a player picks when reporting — one list, shared by the in-game
// /report menu and the site's own report form. Phoenix has no API for these, so
// they are edited straight in the store; the site form reads it live, the game
// menu at startup. Instant, no queued job to watch.

export async function renderReportMenu(root) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.categories();
  } catch {
    root.innerHTML = notice('Report menu unavailable', 'Could not read the report categories from the core.');
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Report menu</h2>
        <p>The categories a player picks when reporting — the same list in game and on the site. A change shows on the site at once; the in-game menu picks it up on each server’s next restart.</p>
      </div>
    </div>
    <details class="rank-ed rank-new">
      <summary><span class="re-name">＋ New category</span></summary>
      <div class="re-body" id="newcat">${categoryFields(null)}
        <label class="re-field"><span class="re-lab">Name — the key it is stored under</span><input class="fld" data-catname placeholder="Cheating" maxlength="64"></label>
        <div class="factions"><button class="btn btn-primary" data-catcreate>Create category</button><span class="fmsg" data-msg></span></div>
      </div>
    </details>
    <div id="catlist">${data.categories.map(categoryCard).join('') || '<div class="empty">No report categories.</div>'}</div>
    <datalist id="matpool">${data.materials.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="ladpool">${data.ladders.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>`;

  wireReportMenu(root);
}

function categoryFields(c) {
  const desc = (c && Array.isArray(c.description) ? c.description : []).join('\n');
  return `
    <label class="re-field"><span class="re-lab">Display name</span><input class="fld" data-dn value="${esc(c ? c.displayName : '')}" placeholder="&cCheating" maxlength="64"></label>
    <div class="re-grid">
      <label class="re-field"><span class="re-lab">Icon material</span><input class="fld" list="matpool" data-mat value="${esc(c ? c.materialName : 'PAPER')}" maxlength="48"></label>
      <label class="re-field"><span class="re-lab">Links to ladder</span><input class="fld" list="ladpool" data-lad value="${esc(c ? c.punishmentLadderId : '')}" placeholder="(optional)" maxlength="64"></label>
    </div>
    <label class="re-field"><span class="re-lab">Description — one lore line each</span><textarea class="fld" data-desc rows="3" placeholder="Shown under the icon in the menu">${esc(desc)}</textarea></label>`;
}

function categoryCard(c) {
  return `
    <details class="rank-ed" data-cat="${esc(c.id)}">
      <summary>
        <span class="re-swatch">${mcPreview(c.displayName || c.id)}</span>
        <span class="re-name">${esc(c.id)}</span>
        ${c.punishmentLadderId ? `<span class="re-tag">→ ${esc(c.punishmentLadderId)}</span>` : ''}
        <span class="re-prio">${esc(c.materialName)}</span>
      </summary>
      <div class="re-body">
        ${categoryFields(c)}
        <div class="factions">
          <button class="btn btn-primary" data-catsave>Save</button>
          <button class="btn btn-danger" data-catdel>Delete</button>
          <span class="fmsg" data-msg></span>
        </div>
      </div>
    </details>`;
}

function readCategory(box) {
  return {
    displayName: box.querySelector('[data-dn]').value,
    materialName: box.querySelector('[data-mat]').value,
    punishmentLadderId: box.querySelector('[data-lad]').value,
    description: box.querySelector('[data-desc]').value.split('\n').map((s) => s.trim()).filter(Boolean),
  };
}

function wireReportMenu(root) {
  // Live preview of the display name, everywhere it is edited.
  root.querySelectorAll('.rank-ed').forEach((card) => {
    const dn = card.querySelector('[data-dn]');
    const sw = card.querySelector('.re-swatch');
    if (dn && sw) dn.addEventListener('input', () => (sw.innerHTML = mcPreview(dn.value)));
  });

  root.querySelectorAll('#catlist .rank-ed').forEach((card) => {
    const name = card.dataset.cat;
    const msg = card.querySelector('[data-msg]');
    card.querySelector('[data-catsave]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Saving…';
      try {
        await api.dash.saveCategory({ op: 'update', name, ...readCategory(card) });
        msg.className = 'fmsg ok'; msg.textContent = 'Saved. Live on the site now; in game on the next restart.';
      } catch (err) { msg.className = 'fmsg bad'; msg.textContent = cfgErr(err); }
      finally { btn.disabled = false; }
    });
    card.querySelector('[data-catdel]').addEventListener('click', async (e) => {
      if (!confirm(`Delete the report category "${name}"?`)) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await api.dash.saveCategory({ op: 'delete', name }); card.remove(); }
      catch (err) { btn.disabled = false; msg.className = 'fmsg bad'; msg.textContent = cfgErr(err); }
    });
  });

  const nc = root.querySelector('#newcat');
  const cmsg = nc.querySelector('[data-msg]');
  nc.querySelector('[data-catcreate]').addEventListener('click', async (e) => {
    const name = nc.querySelector('[data-catname]').value.trim();
    if (!name) { cmsg.className = 'fmsg bad'; cmsg.textContent = 'Give it a name.'; return; }
    const btn = e.currentTarget;
    btn.disabled = true; cmsg.className = 'fmsg'; cmsg.textContent = 'Creating…';
    try {
      await api.dash.saveCategory({ op: 'create', name, ...readCategory(nc) });
      setTimeout(() => renderReportMenu(root), 700);
    } catch (err) { btn.disabled = false; cmsg.className = 'fmsg bad'; cmsg.textContent = cfgErr(err); }
  });
}

// ========================================================== backups =========

export async function renderBackups(root) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.backups();
  } catch {
    root.innerHTML = notice('Backups unavailable', 'Could not read the backups.');
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Backups</h2>
        <p>A copy of the whole network config — ranks, ladders, the report menu and the rules — to keep, download, or roll back to.</p>
      </div>
    </div>
    <section class="panel entry"><div class="panel-body">
      <label class="re-field"><span class="re-lab">Note — optional, so future-you knows why</span><input class="fld" id="bknote" placeholder="Before the rank overhaul" maxlength="200"></label>
      <div class="factions"><button class="btn btn-primary" id="bkmake">Take a backup now</button><span class="fmsg" id="bkmsg"></span></div>
    </div></section>
    <div id="bklist">${data.backups.map(backupCard).join('') || '<div class="empty">No backups yet.</div>'}</div>`;

  wireBackups(root);
}

function backupCard(b) {
  const c = b.counts || {};
  return `
    <details class="rank-ed" data-backup="${esc(b._id)}">
      <summary>
        <span class="re-name">${esc(dateShort(b.at))}</span>
        <span class="dr">${timeAgo(b.at)}${b.note ? ` · ${esc(b.note)}` : ''}</span>
        <span class="re-prio">${c.ranks || 0} ranks · ${c.ladders || 0} ladders · ${c.categories || 0} categories · ${c.rules || 0} rule sets</span>
      </summary>
      <div class="re-body">
        <p class="rule-text">Taken by ${esc(b.by?.name || 'unknown')}.</p>
        <div class="factions">
          <button class="btn" data-download>Download JSON</button>
          <button class="btn btn-primary" data-restore>Restore</button>
          <button class="btn btn-danger" data-delbk>Delete</button>
          <span class="fmsg" data-msg></span>
        </div>
        <p class="rule-text re-hint">Restore re-applies rank display and flags, the ladders, the report menu and the rules in game. It does not recreate a deleted rank or remove one added since. Rank permissions and inheritance are kept in the download for a manual re-apply.</p>
      </div>
    </details>`;
}

function wireBackups(root) {
  const make = root.querySelector('#bkmake');
  const mmsg = root.querySelector('#bkmsg');
  make.addEventListener('click', async () => {
    make.disabled = true; mmsg.className = 'fmsg'; mmsg.textContent = 'Capturing…';
    try {
      await api.dash.createBackup(root.querySelector('#bknote').value.trim());
      setTimeout(() => renderBackups(root), 500);
    } catch { make.disabled = false; mmsg.className = 'fmsg bad'; mmsg.textContent = 'That did not save.'; }
  });

  root.querySelectorAll('#bklist .rank-ed').forEach((card) => {
    const id = card.dataset.backup;
    const msg = card.querySelector('[data-msg]');

    card.querySelector('[data-download]').addEventListener('click', async () => {
      msg.className = 'fmsg'; msg.textContent = 'Preparing…';
      try {
        const full = await api.dash.getBackup(id);
        const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${id}.json`; a.click();
        URL.revokeObjectURL(url);
        msg.className = 'fmsg ok'; msg.textContent = 'Downloaded.';
      } catch { msg.className = 'fmsg bad'; msg.textContent = 'Could not fetch it.'; }
    });

    card.querySelector('[data-restore]').addEventListener('click', async (e) => {
      if (!confirm('Restore this backup? It re-applies its ranks, ladders, report menu and rules in game.')) return;
      const btn = e.currentTarget;
      btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Restoring…';
      try {
        const { summary } = await api.dash.restoreBackup(id);
        msg.className = 'fmsg ok';
        msg.textContent = `Restored: ${summary.rules ? 'rules, ' : ''}${summary.categories} categories, ${summary.rankJobs} rank + ${summary.ladderJobs} ladder edits queued.`;
      } catch (err) { msg.className = 'fmsg bad'; msg.textContent = cfgErr(err); }
      finally { btn.disabled = false; }
    });

    card.querySelector('[data-delbk]').addEventListener('click', async (e) => {
      if (!confirm('Delete this backup? The copy is gone; the live config is untouched.')) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await api.dash.deleteBackup(id); card.remove(); }
      catch { btn.disabled = false; msg.className = 'fmsg bad'; msg.textContent = 'Could not delete.'; }
    });
  });
}
