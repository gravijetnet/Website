// Feedback — the two things a player tells us about the game itself.
//
// A bug is "this is broken"; a suggestion is "I wish it did this". Both live on
// one dashboard tab because they are the same act from the player's side — you
// noticed something and took a minute to say so — and both file the same careful
// way the reports do, from inside a page that already knows who you are.
//
// The tab's centrepiece is the suggestion board: everybody's open ideas, sorted
// by how many players have upvoted them. That is the whole point of making
// suggestions public where bugs stay private — a good idea should be able to
// rise on other people agreeing with it, not on a staff member happening to like
// it. A bug report can carry a repro that gives away an exploit, so it never
// appears here; it stays between its author and the team.
import { api } from './api.js';
import { icons } from './icons.js';
import { notice } from './components.js';
import { esc, timeAgo, dateShort } from './util.js';

const AREAS = ['Practice', 'Bedwars', 'FFA', 'FastBuilder', 'Website', 'Discord', 'Other'];
const CATEGORIES = ['Gameplay', 'Maps', 'Ranks & cosmetics', 'Website', 'Discord', 'Other'];

// The words each status wears, and how loud. Green is a win, red is a no, purple
// is "we heard you and it is moving", yellow is "waiting".
const BUG_STATUS = {
  open: { label: 'Open', cls: '' },
  acknowledged: { label: 'Acknowledged', cls: 'soon' },
  fixed: { label: 'Fixed', cls: 'live' },
  wontfix: { label: "Won't fix", cls: 'dead' },
  duplicate: { label: 'Already known', cls: '' },
};
const SUGGESTION_STATUS = {
  open: { label: 'Open', cls: '' },
  planned: { label: 'Planned', cls: 'soon' },
  done: { label: 'Done', cls: 'live' },
  declined: { label: 'Declined', cls: 'dead' },
};

const ERRORS = {
  login_required: 'Your session expired. Sign in again.',
  missing_fields: 'A title and a description are both needed.',
  title_too_short: 'Give it a title — a few words that say what it is.',
  detail_too_short: 'Say a little more; a line or two at least.',
  cooldown: 'You just sent something. Give it a moment.',
  own_suggestion: 'You cannot upvote your own suggestion.',
};
const explain = (err) => ERRORS[err?.body?.error] || 'Something went wrong. Try again in a moment.';

function say(el, kind, text) {
  el.className = `fmsg ${kind}`;
  el.textContent = text;
}
function crumb(href, label) {
  return `<a class="crumb" href="${href}">← ${esc(label)}</a>`;
}
function selectField(id, label, options, chosen) {
  return `
    <div class="frow">
      <label class="flabel" for="${id}">${esc(label)}</label>
      <select class="fld" id="${id}">
        ${options.map((o) => `<option value="${esc(o)}" ${o === chosen ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>
    </div>`;
}
function textField(id, label, { long = true, placeholder = '', max = 2000 } = {}) {
  const input = long
    ? `<textarea class="fld" id="${id}" rows="5" maxlength="${max}" placeholder="${esc(placeholder)}"></textarea>`
    : `<input class="fld" id="${id}" type="text" maxlength="${max}" placeholder="${esc(placeholder)}">`;
  return `<div class="frow"><label class="flabel" for="${id}">${esc(label)}</label>${input}</div>`;
}

// ---------------------------------------------------------------- the tab ----

export async function renderFeedback(root, sub) {
  if (sub === 'bug') return renderBugForm(root);
  if (sub === 'suggestion') return renderSuggestionForm(root);

  root.innerHTML = `
    <div class="section-head">
      <div>
        <span class="eyebrow">Help us make it better</span>
        <h2>Feedback</h2>
      </div>
    </div>
    <div class="block">
      <div class="factions">
        <a class="btn btn-primary" href="/dashboard/feedback/bug">Report a bug</a>
        <a class="btn" href="/dashboard/feedback/suggestion">Suggest something</a>
      </div>
    </div>
    <div id="board"></div>
    <div id="mine"></div>`;

  // The board and your own filings load independently — one being slow or empty
  // must not hold up the other.
  paintBoard(root.querySelector('#board'));
  paintMine(root.querySelector('#mine'));
}

// --------------------------------------------------------------- the board ---

async function paintBoard(box) {
  let data;
  try {
    data = await api.board('votes');
  } catch {
    return void (box.innerHTML = '');
  }
  const list = data.suggestions || [];

  box.innerHTML = `
    <div class="block">
      <div class="block-label">Suggestion board</div>
      ${
        list.length
          ? `<p class="rule-text">What players want next, most-wanted first. Upvote the ones you agree with — the board is how the good ideas rise.</p>
             <div class="sbg">${list.map(boardCard).join('')}</div>`
          : `<div class="board"><div class="empty">No suggestions yet. <a href="/dashboard/feedback/suggestion">Be the first</a>.</div></div>`
      }
    </div>`;

  box.querySelectorAll('[data-vote]').forEach((btn) => btn.addEventListener('click', () => vote(btn)));
}

function boardCard(s) {
  const st = SUGGESTION_STATUS[s.status] || { label: s.status, cls: '' };
  return `
    <div class="scard entry" data-id="${esc(s._id)}">
      <button class="votebtn ${s.youVoted ? 'on' : ''}" data-vote="${esc(s._id)}" ${s.mine ? 'disabled title="Your own suggestion"' : 'title="Upvote"'}>
        <span class="vote-caret">▲</span>
        <span class="vote-n">${s.voteCount}</span>
      </button>
      <div class="sc-body">
        <div class="sc-top">
          <span class="sc-title">${esc(s.title)}</span>
          <span class="badge ${st.cls}">${esc(st.label)}</span>
        </div>
        <div class="sc-meta">${esc(s.category || 'Other')}${s.mine ? ' · yours' : ''} · ${timeAgo(s.filedAt)}</div>
        ${s.detail ? `<p class="sc-detail">${esc(s.detail)}</p>` : ''}
      </div>
    </div>`;
}

// Optimistic: the count moves the moment you press, and only rolls back if the
// server disagrees. A vote is cheap and reversible, so making you wait on a round
// trip to see it land would be the wrong trade.
async function vote(btn) {
  const id = btn.dataset.vote;
  const nEl = btn.querySelector('.vote-n');
  const was = btn.classList.contains('on');
  btn.classList.toggle('on', !was);
  nEl.textContent = String((Number(nEl.textContent) || 0) + (was ? -1 : 1));
  try {
    const r = await api.vote(id);
    btn.classList.toggle('on', r.youVoted);
    nEl.textContent = String(r.voteCount);
  } catch {
    btn.classList.toggle('on', was); // put it back
    nEl.textContent = String((Number(nEl.textContent) || 0) + (was ? 1 : -1));
  }
}

// ---------------------------------------------------- what you have sent ------

async function paintMine(box) {
  let data;
  try {
    data = await api.myFeedback();
  } catch {
    return void (box.innerHTML = '');
  }
  const rows = [
    ...data.bugs.map((b) => ({ ...b, kind: 'bug' })),
    ...data.suggestions.map((s) => ({ ...s, kind: 'suggestion' })),
  ].sort((a, b) => b.filedAt - a.filedAt);

  if (!rows.length) {
    box.innerHTML = `
      <div class="block">
        <div class="block-label">What you have sent</div>
        <div class="board"><div class="empty">Nothing yet. Found a bug or had an idea? The buttons up top.</div></div>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="block">
      <div class="block-label">What you have sent</div>
      ${rows.map(mineCard).join('')}
    </div>`;
}

function mineCard(r) {
  const map = r.kind === 'bug' ? BUG_STATUS : SUGGESTION_STATUS;
  const st = map[r.status] || { label: r.status, cls: '' };
  const tag = r.area || r.category || null;
  return `
    <section class="panel entry">
      <div class="panel-head">
        <div class="glyph">${icons[r.kind === 'bug' ? 'bolt' : 'rules']}</div>
        <div style="min-width:0">
          <h3>${esc(r.title)}</h3>
          <div class="ph-sub">
            ${r.kind === 'bug' ? 'Bug' : 'Suggestion'}${tag ? ` · ${esc(tag)}` : ''} · sent ${timeAgo(r.filedAt)}${r.resolvedAt ? ` · answered ${timeAgo(r.resolvedAt)}` : ''}
            ${r.kind === 'suggestion' && r.voteCount ? ` · ${r.voteCount} upvote${r.voteCount === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <div class="ph-right"><span class="badge ${st.cls}">${esc(st.label)}</span></div>
      </div>
      <div class="panel-body">
        <p class="rule-text">${esc(r.detail)}</p>
        ${r.note ? `<div class="block"><div class="block-label">What staff said</div><p class="rule-text">${esc(r.note)}</p></div>` : ''}
      </div>
    </section>`;
}

// ----------------------------------------------------------------- forms ------

function renderBugForm(root) {
  root.innerHTML = `
    ${crumb('/dashboard/feedback', 'Feedback')}
    <div class="section-head">
      <div>
        <span class="eyebrow">Something is broken</span>
        <h2>Report a bug</h2>
      </div>
    </div>
    <section class="panel entry"><div class="panel-body">
      <p class="rule-text">Tell us what happened and how to make it happen again — the second part is what lets us fix it. One bug per report.</p>
      <div class="block">
        ${textField('title', 'In one line, what is wrong?', { long: false, placeholder: 'Knockback is inconsistent in the 1.8 kit', max: 100 })}
        ${selectField('area', 'Where?', AREAS, 'Practice')}
        ${textField('detail', 'What happens, and how do we reproduce it?', { placeholder: 'Step by step: what you did, what you expected, and what happened instead.' })}
        <div class="factions">
          <button class="btn btn-primary" id="send">Send bug report</button>
          <span class="fmsg" id="msg"></span>
        </div>
      </div>
    </div></section>`;
  wireForm(root, 'bug');
}

function renderSuggestionForm(root) {
  root.innerHTML = `
    ${crumb('/dashboard/feedback', 'Feedback')}
    <div class="section-head">
      <div>
        <span class="eyebrow">An idea for the network</span>
        <h2>Suggest something</h2>
      </div>
    </div>
    <section class="panel entry"><div class="panel-body">
      <p class="rule-text">Suggestions go on a public board where other players can upvote them, so say it in a way that makes someone nod. One idea per suggestion.</p>
      <div class="block">
        ${textField('title', 'The idea, in one line', { long: false, placeholder: 'Add a round-based duels queue', max: 100 })}
        ${selectField('category', 'What is it about?', CATEGORIES, 'Gameplay')}
        ${textField('detail', 'Say more', { placeholder: 'What it is, and why it would make the network better to play on.' })}
        <div class="factions">
          <button class="btn btn-primary" id="send">Post suggestion</button>
          <span class="fmsg" id="msg"></span>
        </div>
      </div>
    </div></section>`;
  wireForm(root, 'suggestion');
}

function wireForm(root, kind) {
  const msg = root.querySelector('#msg');
  const btn = root.querySelector('#send');
  btn.addEventListener('click', async () => {
    const title = root.querySelector('#title').value.trim();
    const detail = root.querySelector('#detail').value.trim();
    if (!title || !detail) return void say(msg, 'bad', 'A title and a description are both needed.');

    const body = kind === 'bug'
      ? { title, area: root.querySelector('#area').value, detail }
      : { title, category: root.querySelector('#category').value, detail };

    btn.disabled = true;
    say(msg, '', 'Sending…');
    try {
      if (kind === 'bug') await api.submitBug(body);
      else await api.submitSuggestion(body);
      root.innerHTML = `
        ${crumb('/dashboard/feedback', 'Feedback')}
        ${notice(
          kind === 'bug' ? 'Bug report sent' : 'Suggestion posted',
          kind === 'bug'
            ? 'Thanks — it is in front of the team. You will see its status update on your Feedback tab.'
            : 'It is on the board now. Others can upvote it, and you can watch it climb from your Feedback tab.',
        )}`;
    } catch (err) {
      btn.disabled = false;
      say(msg, 'bad', explain(err));
    }
  });
}
