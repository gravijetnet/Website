// Apply, report and appeal — the three things a player files.
//
// These used to be public pages that demanded a login. They are now tabs of the
// dashboard (see main.js MOVED and dash-player), so everything here renders into
// a body element that is already signed in and already inside the player chrome.
// No login wall, no outer <section>: the dashboard owns both.
import { api } from './api.js';
import { icons } from './icons.js';
import { notice } from './components.js';
import { esc, timeAgo } from './util.js';

// --------------------------------------------------------------- shared bits

function field(id, label, { long = true, placeholder = '', value = '', max = 2000 } = {}) {
  const input = long
    ? `<textarea class="fld" id="${id}" rows="4" maxlength="${max}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="fld" id="${id}" type="text" maxlength="${max}" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
  return `<div class="frow"><label class="flabel" for="${id}">${esc(label)}</label>${input}</div>`;
}

function say(el, kind, text) {
  el.className = `fmsg ${kind}`;
  el.textContent = text;
}

// The server's error codes, in words a person can act on. A bare code is a dead
// end for whoever is staring at it.
const ERRORS = {
  login_required: 'Your session expired. Sign in again.',
  blank_answers: 'Every question needs an answer.',
  answer_count_mismatch: 'That form is out of date. Reload the page.',
  already_pending: 'You already have an application waiting for this role.',
  cooldown: 'You did this very recently. Give it a moment.',
  missing_fields: 'Something above is still empty.',
  detail_too_short: 'Tell us what actually happened — a line or two at least.',
  reason_too_short: 'Say more than a sentence; this is the whole appeal.',
  unknown_player: 'Nobody by that name has ever joined Gravijet. Check the spelling.',
  unknown_category: 'Pick a reason from the list.',
  unknown_punishment: 'No punishment carries that ID. It is printed when you are banned.',
  not_active: 'That punishment is not active any more — there is nothing to appeal.',
  already_open: 'You already have an appeal open for that punishment.',
  too_many_files: 'That is more screenshots than we take. Remove a few.',
  bad_attachment: 'One of those files did not go up properly. Try attaching it again.',
  unknown_attachment: 'One of those uploads expired. Re-attach and send again.',
};

function explain(err) {
  return ERRORS[err?.body?.error] || 'Something went wrong. Try again in a moment.';
}

function crumb(href, label) {
  return `<a class="crumb" href="${href}">← ${esc(label)}</a>`;
}

// ================================================================ apply ======

export async function renderApply(root, roleKey) {
  if (!roleKey) return renderApplyIndex(root);

  let form;
  try {
    form = await api.applyForm(roleKey);
  } catch {
    root.innerHTML = notice('No such role', 'That is not something you can apply for.');
    return;
  }

  // Keep somebody from filling out a form they cannot send. The status of past
  // applications belongs on the Applications tab, not here — here it is only the
  // one fact that changes what this page can do.
  const mine = await api.myApplications().catch(() => []);
  const pending = mine.find((a) => a.role === roleKey && a.status === 'pending');
  if (pending) {
    root.innerHTML = `
      ${crumb('/dashboard/apply', 'All roles')}
      ${notice(
        'Already applied',
        `Your ${form.label} application went in ${timeAgo(pending.submittedAt)} and is still being read. You will hear back in Discord.`,
      )}`;
    return;
  }

  root.innerHTML = `
    ${crumb('/dashboard/apply', 'All roles')}
    <div class="section-head">
      <div>
        <span class="eyebrow">${esc(form.blurb)}</span>
        <h2>Apply — ${esc(form.label)}</h2>
      </div>
    </div>
    <section class="panel entry">
      <div class="panel-body">
        <p class="rule-text">Answer honestly and in your own words. Short, specific answers beat long ones — we read all of them.</p>
        <div class="block">
          ${form.questions.map((q) => questionField(q)).join('')}
          <div class="factions">
            <button class="btn btn-primary" id="send">Send application</button>
            <span class="fmsg" id="msg"></span>
          </div>
        </div>
      </div>
    </section>`;

  // Files land here as { questionIndex: [id, …] } as they finish uploading, so
  // the answers and their screenshots travel together to the same endpoint.
  const uploaded = {};
  form.questions.filter((q) => q.upload).forEach((q) => wireUploader(root, q, uploaded, form.maxBytes, form.maxFiles));

  const msg = root.querySelector('#msg');
  const btn = root.querySelector('#send');
  btn.addEventListener('click', async () => {
    const answers = form.questions.map((q) => root.querySelector(`#q${q.index}`).value.trim());
    const blank = answers.findIndex((a) => !a);
    if (blank >= 0) {
      say(msg, 'bad', `Question ${blank + 1} is still empty.`);
      root.querySelector(`#q${blank}`).focus();
      return;
    }
    btn.disabled = true;
    say(msg, '', 'Sending…');
    try {
      await api.applySubmit(roleKey, answers, uploaded);
      root.innerHTML = `
        ${crumb('/dashboard/applications', 'Your applications')}
        ${notice('Application sent', `Thanks — your ${form.label} application is in. You will hear back in Discord.`)}`;
    } catch (err) {
      btn.disabled = false;
      say(msg, 'bad', explain(err));
    }
  });
}

function questionField(q) {
  const base = field(`q${q.index}`, `${q.index + 1}. ${q.text}`, { long: q.long });
  if (!q.upload) return base;
  // The uploader sits under the text box: the question still wants words, and
  // the pictures are an addition to them, not a replacement.
  return `
    ${base}
    <div class="uploader" data-q="${q.index}">
      <label class="btn upl-btn">Add screenshots<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden></label>
      <span class="upl-hint">PNG, JPG, GIF or WebP.</span>
      <div class="upl-list"></div>
    </div>`;
}

function wireUploader(root, q, uploaded, maxBytes, maxFiles) {
  const box = root.querySelector(`.uploader[data-q="${q.index}"]`);
  if (!box) return;
  const input = box.querySelector('input[type=file]');
  const list = box.querySelector('.upl-list');
  uploaded[q.index] = [];

  const draw = () => {
    list.innerHTML = uploaded[q.index]
      .map(
        (f, i) => `
        <div class="upl-item">
          <img src="/api/uploads/${encodeURIComponent(f.id)}" alt="">
          <span class="upl-name">${esc(f.name)}</span>
          <button class="upl-x" data-i="${i}" title="Remove">×</button>
        </div>`,
      )
      .join('');
    list.querySelectorAll('.upl-x').forEach((b) =>
      b.addEventListener('click', () => {
        uploaded[q.index].splice(Number(b.dataset.i), 1);
        draw();
      }),
    );
  };

  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = ''; // so the same file can be re-picked after removal
    for (const file of files) {
      const total = Object.values(uploaded).reduce((n, a) => n + a.length, 0);
      if (total >= maxFiles) {
        alert(`That is the most screenshots an application takes (${maxFiles}).`);
        break;
      }
      if (file.size > maxBytes) {
        alert(`${file.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
        continue;
      }
      const item = { id: null, name: file.name, uploading: true };
      uploaded[q.index].push(item);
      draw();
      try {
        const res = await api.upload(file);
        item.id = res.id;
        item.uploading = false;
      } catch {
        // A failed upload should not sit in the list pretending to be attached.
        const at = uploaded[q.index].indexOf(item);
        if (at >= 0) uploaded[q.index].splice(at, 1);
        alert(`${file.name} could not be uploaded.`);
      }
      draw();
    }
  });
}

async function renderApplyIndex(root) {
  let roles;
  try {
    roles = await api.applyRoles();
  } catch {
    root.innerHTML = notice('Unavailable', 'The application list could not be loaded.');
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">Join the team</span>
        <h2>Apply for a rank</h2>
      </div>
      <a class="btn" href="/dashboard/applications">Your applications</a>
    </div>
    <div class="mode-list">
      ${roles
        .map(
          (r) => `
        <a class="mode-row enter entry" href="/dashboard/apply/${r.key}">
          <div class="glyph">${icons.staff}</div>
          <div class="m-id">
            <h3>${esc(r.label)}</h3>
            <div class="tag">${esc(r.blurb)}</div>
          </div>
          <div class="m-go">Apply →</div>
        </a>`,
        )
        .join('')}
    </div>`;
}

// =============================================================== report ======

export async function renderReport(root) {
  let cats;
  try {
    cats = await api.reportCategories();
  } catch {
    root.innerHTML = notice('Unavailable', 'The report form could not be loaded.');
    return;
  }

  root.innerHTML = `
    ${crumb('/dashboard/reports', 'Your reports')}
    <div class="section-head">
      <div>
        <span class="eyebrow">Something happened in game</span>
        <h2>Report a player</h2>
      </div>
      <a class="btn" href="/rules">Rules</a>
    </div>
    <section class="panel entry">
      <div class="panel-body">
        <p class="rule-text">One report per incident. Say what happened and when — a moderator has to be able to find it.</p>
        <div class="block">
          ${field('target', 'Who are you reporting?', { long: false, placeholder: 'Their exact in-game name', max: 32 })}
          <div class="frow">
            <label class="flabel" for="cat">What for?</label>
            <select class="fld" id="cat">
              <option value="">Pick a reason…</option>
              ${cats.map((c) => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}
            </select>
          </div>
          ${field('detail', 'What happened?', { placeholder: 'What they did, roughly when, and which mode or arena you were in.' })}
          ${field('evidence', 'Evidence (optional)', { long: false, placeholder: 'A link to a clip or screenshot', max: 500 })}
          <div class="factions">
            <button class="btn btn-primary" id="send">Send report</button>
            <span class="fmsg" id="msg"></span>
          </div>
        </div>
      </div>
    </section>`;

  const msg = root.querySelector('#msg');
  const btn = root.querySelector('#send');
  btn.addEventListener('click', async () => {
    const body = {
      target: root.querySelector('#target').value.trim(),
      category: root.querySelector('#cat').value,
      detail: root.querySelector('#detail').value.trim(),
      evidence: root.querySelector('#evidence').value.trim(),
    };
    if (!body.target || !body.category || !body.detail) {
      say(msg, 'bad', 'Name, reason and what happened are all needed.');
      return;
    }
    btn.disabled = true;
    say(msg, '', 'Sending…');
    try {
      await api.report(body);
      root.innerHTML = `
        ${crumb('/dashboard/reports', 'Your reports')}
        ${notice('Report sent', 'Thanks. A moderator will look at it — you will not usually hear the outcome, but it is read.')}`;
    } catch (err) {
      btn.disabled = false;
      say(msg, 'bad', explain(err));
    }
  });
}

// =============================================================== appeal ======

export async function renderAppeal(root, punishmentId) {
  root.innerHTML = `
    ${crumb('/dashboard/appeals', 'Your appeals')}
    <div class="section-head">
      <div>
        <span class="eyebrow">Think we got it wrong?</span>
        <h2>Appeal a punishment</h2>
      </div>
    </div>
    <section class="panel entry">
      <div class="panel-body">
        <p class="rule-text">Your punishment ID is printed on the screen that told you about it — six characters, like PFEYT4. Without it we cannot find which punishment you mean.</p>
        <div class="block">
          ${field('pid', 'Punishment ID', { long: false, placeholder: 'PFEYT4', max: 12, value: punishmentId || '' })}
          ${field('reason', 'Why should it be lifted?', { placeholder: 'What actually happened, and what is different now.' })}
          <div class="factions">
            <button class="btn btn-primary" id="send">Send appeal</button>
            <span class="fmsg" id="msg"></span>
          </div>
        </div>
      </div>
    </section>`;

  const msg = root.querySelector('#msg');
  const btn = root.querySelector('#send');
  btn.addEventListener('click', async () => {
    const pid = root.querySelector('#pid').value.trim();
    const reason = root.querySelector('#reason').value.trim();
    if (!pid || !reason) {
      say(msg, 'bad', 'Both the ID and a reason are needed.');
      return;
    }
    btn.disabled = true;
    say(msg, '', 'Sending…');
    try {
      await api.appeal({ punishmentId: pid, reason });
      root.innerHTML = `
        ${crumb('/dashboard/appeals', 'Your appeals')}
        ${notice('Appeal sent', 'It is in the queue. Senior staff read these — you will hear back in Discord.')}`;
    } catch (err) {
      btn.disabled = false;
      say(msg, 'bad', explain(err));
    }
  });
}
