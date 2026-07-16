// Apply, report and appeal: the three pages where a visitor writes something
// down. All three need a login, so they share the same gate and the same shapes.
import { api } from './api.js';
import { icons } from './icons.js';
import { pageLoader, notice } from './components.js';
import { esc, timeAgo } from './util.js';

// --------------------------------------------------------------- shared bits

// Every one of these pages is useless signed out, so none of them render the
// form first and complain afterwards.
function loginWall(what, back) {
  return `
    <div class="container">
      <section class="panel entry" style="margin-top:24px">
        <div class="soon-state">
          <div class="glyph">${icons.report}</div>
          <div>
            <h4>Sign in first</h4>
            <p>${esc(what)} needs a Discord account, so we know who to reply to.</p>
          </div>
          <div style="margin-left:auto">
            <a class="btn btn-primary" href="/auth/discord?return=${encodeURIComponent(back)}" data-ext>Sign in with Discord</a>
          </div>
        </div>
      </section>
    </div>`;
}

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

// The server's error codes, in words a person can act on. A bare code is a
// dead end for whoever is staring at it.
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
};

function explain(err) {
  return ERRORS[err?.body?.error] || 'Something went wrong. Try again in a moment.';
}

// ================================================================ apply ======

export async function renderApply(root, roleKey) {
  root.innerHTML = pageLoader();
  const me = await api.me().catch(() => ({ user: null }));

  if (!roleKey) return renderApplyIndex(root, me);
  if (!me.user) return void (root.innerHTML = loginWall('Applying', `/apply/${roleKey}`));

  let form;
  try {
    form = await api.applyForm(roleKey);
  } catch {
    root.innerHTML = notice('No such role', 'That is not something you can apply for.');
    return;
  }

  const mine = await api.myApplications().catch(() => []);
  const pending = mine.find((a) => a.role === roleKey && a.status === 'pending');
  if (pending) {
    root.innerHTML = notice(
      'Already applied',
      `Your ${form.label} application went in ${timeAgo(pending.submittedAt)} and is still being read. You will hear back in Discord.`,
    );
    return;
  }

  root.innerHTML = `
    <section class="section">
      <div class="container narrow">
        <a class="crumb" href="/apply">All roles</a>
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
              ${form.questions.map((q) => field(`q${q.index}`, `${q.index + 1}. ${q.text}`, { long: q.long })).join('')}
              <div class="factions">
                <button class="btn btn-primary" id="send">Send application</button>
                <span class="fmsg" id="msg"></span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>`;

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
      await api.applySubmit(roleKey, answers);
      root.innerHTML = notice(
        'Application sent',
        `Thanks — your ${form.label} application is in. You will hear back in Discord.`,
      );
    } catch (err) {
      btn.disabled = false;
      say(msg, 'bad', explain(err));
    }
  });
}

async function renderApplyIndex(root, me) {
  let roles;
  try {
    roles = await api.applyRoles();
  } catch {
    root.innerHTML = notice('Unavailable', 'The application list could not be loaded.');
    return;
  }
  const mine = me.user ? await api.myApplications().catch(() => []) : [];
  const statusOf = (key) => {
    const a = mine.find((x) => x.role === key);
    if (!a) return '';
    if (a.status === 'pending') return '<span class="badge soon">Pending</span>';
    if (a.status === 'accepted') return '<span class="badge live">Accepted</span>';
    return '<span class="badge">Rejected</span>';
  };

  root.innerHTML = `
    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <span class="eyebrow">Join the team</span>
            <h2>Apply</h2>
          </div>
        </div>
        <div class="mode-list">
          ${roles
            .map(
              (r) => `
            <a class="mode-row enter entry" href="/apply/${r.key}">
              <div class="glyph">${icons.staff}</div>
              <div class="m-id">
                <h3>${esc(r.label)}</h3>
                <div class="tag">${esc(r.blurb)}</div>
              </div>
              <div class="m-foot"><div><div class="mv">${r.count}</div><div class="ml">questions</div></div></div>
              <div class="m-badge">${statusOf(r.key)}</div>
            </a>`,
            )
            .join('')}
        </div>
      </div>
    </section>`;
}

// =============================================================== report ======

export async function renderReport(root) {
  root.innerHTML = pageLoader();
  const me = await api.me().catch(() => ({ user: null }));
  if (!me.user) return void (root.innerHTML = loginWall('Reporting a player', '/report'));

  let cats;
  try {
    cats = await api.reportCategories();
  } catch {
    root.innerHTML = notice('Unavailable', 'The report form could not be loaded.');
    return;
  }

  root.innerHTML = `
    <section class="section">
      <div class="container narrow">
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
        </section>
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
      root.innerHTML = notice('Report sent', 'Thanks. A moderator will look at it — you will not usually hear the outcome, but it is read.');
    } catch (err) {
      btn.disabled = false;
      say(msg, 'bad', explain(err));
    }
  });
}

// =============================================================== appeal ======

export async function renderAppeal(root) {
  root.innerHTML = pageLoader();
  const me = await api.me().catch(() => ({ user: null }));
  if (!me.user) return void (root.innerHTML = loginWall('Appealing a punishment', '/appeal'));

  root.innerHTML = `
    <section class="section">
      <div class="container narrow">
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
              ${field('pid', 'Punishment ID', { long: false, placeholder: 'PFEYT4', max: 12 })}
              ${field('reason', 'Why should it be lifted?', { placeholder: 'What actually happened, and what is different now.' })}
              <div class="factions">
                <button class="btn btn-primary" id="send">Send appeal</button>
                <span class="fmsg" id="msg"></span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>`;

  const msg = root.querySelector('#msg');
  const btn = root.querySelector('#send');
  btn.addEventListener('click', async () => {
    const punishmentId = root.querySelector('#pid').value.trim();
    const reason = root.querySelector('#reason').value.trim();
    if (!punishmentId || !reason) {
      say(msg, 'bad', 'Both the ID and a reason are needed.');
      return;
    }
    btn.disabled = true;
    say(msg, '', 'Sending…');
    try {
      await api.appeal({ punishmentId, reason });
      root.innerHTML = notice('Appeal sent', 'It is in the queue. Senior staff read these — you will hear back in Discord.');
    } catch (err) {
      btn.disabled = false;
      say(msg, 'bad', explain(err));
    }
  });
}
