// The rules editor, in Spielplatz. Admin and up (manageRules).
//
// This edits the wording only. The punishment ladders a rule points at are
// Phoenix's and are not editable from a website — the editor offers the ladder
// ids that exist and pairs one to a rule, but the escalation itself is changed
// in game, where it is enforced. See server/lib/rules.
//
// A structured editor rather than a raw text box: the public page is sectioned,
// anchored and paired with live ladders, and handing somebody a JSON blob to
// hand-edit is how a missing comma takes the rules page down.
import { api } from './api.js';
import { notice } from './components.js';
import { esc, timeAgo } from './util.js';
import { confirmDanger } from './modal.js';

// The working copy. Edited in place, serialized on save. Kept at module scope so
// a stray re-render cannot silently drop half of somebody's unsaved work.
let model = null;
let ladders = [];
let dirty = false;

export async function renderRulesEditor(root, can) {
  if (!can.manageRules) {
    root.innerHTML = notice('Not allowed', 'Editing the rules needs Admin or above.');
    return;
  }

  let data;
  try {
    data = await api.dash.rules();
  } catch {
    root.innerHTML = notice('Unavailable', 'The rules could not be loaded.');
    return;
  }

  model = data.sections;
  ladders = data.ladders || [];
  dirty = false;

  root.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">${data.isSeed ? 'Never edited — showing the shipped rules' : `Last changed ${esc(timeAgo(data.updatedAt))}${data.updatedBy?.name ? ` by ${esc(data.updatedBy.name)}` : ''}`}</span>
        <h2>Rules</h2>
        <p>What example.invalid/rules says. Changes go live the moment you save.</p>
      </div>
    </div>
    <div class="ed-bar">
      <button class="btn btn-primary" id="save">Save changes</button>
      <button class="btn" id="addsec">Add a section</button>
      <button class="btn" id="reset">Reset to the shipped rules</button>
      <a class="btn" href="https://example.invalid/rules" data-ext target="_blank" rel="noopener">Preview</a>
      <span class="fmsg" id="edmsg"></span>
    </div>
    <div id="editor"></div>`;

  paint(root);
  wireBar(root);
}

function paint(root) {
  const editor = root.querySelector('#editor');
  editor.innerHTML = model.map((s, si) => sectionEl(s, si)).join('');
  wireEditor(root);
}

function ladderOptions(selected) {
  const none = `<option value="">— no punishment ladder —</option>`;
  return none + ladders
    .map((id) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}</option>`)
    .join('');
}

function sectionEl(s, si) {
  return `
    <section class="panel entry ed-sec" data-si="${si}">
      <div class="panel-body">
        <div class="ed-sechead">
          <input class="fld ed-title" data-f="title" value="${esc(s.title)}" placeholder="Section title" maxlength="80">
          <div class="ed-moves">
            <button class="btn ed-mini" data-move="up" title="Move section up">↑</button>
            <button class="btn ed-mini" data-move="down" title="Move section down">↓</button>
            <button class="btn ed-mini ed-del" data-delsec title="Delete section">Delete section</button>
          </div>
        </div>
        <textarea class="fld ed-intro" data-f="intro" rows="2" placeholder="Section intro (optional)" maxlength="400">${esc(s.intro || '')}</textarea>
        <div class="ed-rules">
          ${s.rules.map((r, ri) => ruleEl(r, ri)).join('')}
        </div>
        <button class="btn ed-addrule" data-addrule>Add a rule</button>
      </div>
    </section>`;
}

function ruleEl(r, ri) {
  return `
    <div class="ed-rule" data-ri="${ri}">
      <div class="ed-rulehead">
        <input class="fld ed-rtitle" data-f="title" value="${esc(r.title)}" placeholder="Rule title" maxlength="120">
        <div class="ed-moves">
          <button class="btn ed-mini" data-rmove="up" title="Move up">↑</button>
          <button class="btn ed-mini" data-rmove="down" title="Move down">↓</button>
          <button class="btn ed-mini ed-del" data-delrule title="Delete rule">×</button>
        </div>
      </div>
      <textarea class="fld" data-f="body" rows="2" placeholder="The rule itself" maxlength="1200">${esc(r.body)}</textarea>
      <textarea class="fld ed-detail" data-f="detail" rows="2" placeholder="Extra detail / the 'yes but what about' (optional)" maxlength="800">${esc(r.detail || '')}</textarea>
      <label class="ed-ladder">Consequence
        <select class="fld" data-f="ladder">${ladderOptions(r.ladder || '')}</select>
      </label>
    </div>`;
}

// Reads the DOM back into the model before any structural change, so an unsaved
// edit in a text box is not lost when a section is added or moved.
function harvest(root) {
  root.querySelectorAll('.ed-sec').forEach((secEl) => {
    const s = model[Number(secEl.dataset.si)];
    if (!s) return;
    s.title = secEl.querySelector('.ed-title').value;
    s.intro = secEl.querySelector('.ed-intro').value;
    secEl.querySelectorAll('.ed-rule').forEach((rEl) => {
      const r = s.rules[Number(rEl.dataset.ri)];
      if (!r) return;
      r.title = rEl.querySelector('[data-f="title"]').value;
      r.body = rEl.querySelector('[data-f="body"]').value;
      r.detail = rEl.querySelector('[data-f="detail"]').value;
      r.ladder = rEl.querySelector('[data-f="ladder"]').value;
    });
  });
}

function markDirty(root) {
  dirty = true;
  const msg = root.querySelector('#edmsg');
  if (msg && !msg.textContent.startsWith('Unsaved')) {
    msg.className = 'fmsg';
    msg.textContent = 'Unsaved changes.';
  }
}

function wireEditor(root) {
  root.querySelectorAll('#editor input, #editor textarea, #editor select').forEach((el) =>
    el.addEventListener('input', () => markDirty(root)),
  );

  root.querySelectorAll('.ed-sec').forEach((secEl) => {
    const si = Number(secEl.dataset.si);

    secEl.querySelector('[data-delsec]').addEventListener('click', async () => {
      if (!await confirmDanger('Delete this whole section?', 'Every rule in it goes with it.', 'Delete section')) return;
      harvest(root);
      model.splice(si, 1);
      dirty = true;
      paint(root);
    });
    secEl.querySelectorAll('[data-move]').forEach((b) =>
      b.addEventListener('click', () => {
        harvest(root);
        const to = b.dataset.move === 'up' ? si - 1 : si + 1;
        if (to < 0 || to >= model.length) return;
        [model[si], model[to]] = [model[to], model[si]];
        dirty = true;
        paint(root);
      }),
    );
    secEl.querySelector('[data-addrule]').addEventListener('click', () => {
      harvest(root);
      model[si].rules.push({ title: '', body: '', detail: '', ladder: '' });
      dirty = true;
      paint(root);
    });

    secEl.querySelectorAll('.ed-rule').forEach((rEl) => {
      const ri = Number(rEl.dataset.ri);
      rEl.querySelector('[data-delrule]').addEventListener('click', () => {
        harvest(root);
        model[si].rules.splice(ri, 1);
        dirty = true;
        paint(root);
      });
      rEl.querySelectorAll('[data-rmove]').forEach((b) =>
        b.addEventListener('click', () => {
          harvest(root);
          const to = b.dataset.rmove === 'up' ? ri - 1 : ri + 1;
          if (to < 0 || to >= model[si].rules.length) return;
          [model[si].rules[ri], model[si].rules[to]] = [model[si].rules[to], model[si].rules[ri]];
          dirty = true;
          paint(root);
        }),
      );
    });
  });
}

function wireBar(root) {
  const msg = root.querySelector('#edmsg');

  root.querySelector('#addsec').addEventListener('click', () => {
    harvest(root);
    model.push({ title: 'New section', intro: '', rules: [{ title: '', body: '', detail: '', ladder: '' }] });
    dirty = true;
    paint(root);
  });

  root.querySelector('#save').addEventListener('click', async () => {
    harvest(root);
    // Caught here rather than at the server: an empty title is a mistake to point
    // at, not an error code to translate.
    for (const s of model) {
      if (!s.title.trim()) { msg.className = 'fmsg bad'; msg.textContent = 'Every section needs a title.'; return; }
      if (!s.rules.length) { msg.className = 'fmsg bad'; msg.textContent = `"${s.title}" has no rules.`; return; }
      for (const r of s.rules) {
        if (!r.title.trim() || !r.body.trim()) {
          msg.className = 'fmsg bad';
          msg.textContent = `A rule in "${s.title}" is missing its title or body.`;
          return;
        }
      }
    }
    msg.className = 'fmsg';
    msg.textContent = 'Saving…';
    try {
      await api.dash.saveRules(model);
      dirty = false;
      msg.className = 'fmsg ok';
      msg.textContent = 'Saved and live.';
    } catch (err) {
      msg.className = 'fmsg bad';
      msg.textContent = err?.body?.detail || 'That did not save.';
    }
  });

  root.querySelector('#reset').addEventListener('click', async () => {
    if (!await confirmDanger('Reset the rulebook?', 'Every edit is thrown away and the rules go back to the ones the site shipped with.', 'Reset')) return;
    try {
      await api.dash.resetRules();
      await renderRulesEditor(root, { manageRules: true });
    } catch {
      msg.className = 'fmsg bad';
      msg.textContent = 'That did not work.';
    }
  });

  // A half-finished rewrite of a live network's rules is worth one last "are you
  // sure" before it is lost to a stray click on another tab.
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}
