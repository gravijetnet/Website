// Live — the network, watched rather than searched.
//
// The Logs page answers "what happened" after the fact. This answers "what is
// happening", right now: network chat filling from the bottom the way a chat box
// does, and beside it a pulse of everything else — bans handed out, players
// joining and leaving, the moderation commands staff run. It is the screen you
// leave open on a second monitor while you work.
//
// Two cheap polls carry it. Each holds a `since` cursor and asks only for what is
// newer, so a page left open all shift is a trickle of small requests, not a
// firehose. When the tab is hidden the polls sleep; a page nobody is looking at
// has nothing to catch up on.
import { api } from './api.js';
import { esc, timeAgo } from './util.js';
import { pageLoader, notice } from './components.js';
import { icons } from './icons.js';
import { sound } from './sound.js';

const CHAT_EVERY = 3000;
const PULSE_EVERY = 4000;
const CHAT_KEEP = 300; // lines held in the DOM before the oldest are dropped
const PULSE_KEEP = 120;

// A clock, not an age: chat is read line by line, and "2m ago" on every line is
// noise where the time it was said is the thing.
function clock(at) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// A player's name, in their rank colour, linking to their record. An unresolved
// sender (a UUID with no profile) shows the short UUID rather than a blank, so a
// line is never anonymous by accident.
function nameTag(name, uuid, color) {
  const shown = name || (uuid ? `${uuid.slice(0, 8)}…` : 'unknown');
  const href = name ? `/players?q=${encodeURIComponent(name)}` : null;
  const style = `color:${esc(color || '#AAAAAA')}`;
  return href
    ? `<a class="lc-name" style="${style}" href="${href}">${esc(shown)}</a>`
    : `<span class="lc-name" style="${style}">${esc(shown)}</span>`;
}

// The searchbox highlight: what a moderator is looking for, marked wherever it
// lands in a line — without letting the term itself become HTML.
function highlight(text, term) {
  const safe = esc(text);
  if (!term) return safe;
  const rx = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return safe.replace(rx, '<mark class="lc-hit">$1</mark>');
}

function chatLine(l, term) {
  return `
    <div class="lc-line ${l.flag ? 'flagged' : ''}" data-at="${l.at}">
      <span class="lc-t">${clock(l.at)}</span>
      ${nameTag(l.name, l.uuid, l.color)}
      <span class="lc-msg">${highlight(l.message || '', term)}</span>
      ${l.flag ? `<span class="lc-flag" title="Trips the ${esc(l.flag)} filter">${esc(l.flag)}</span>` : ''}
    </div>`;
}

// One line of the pulse, its shape decided by what happened. The verb carries
// the meaning, so it is the coloured word; names keep their rank colour.
const PUNISH_VERB = { ban: 'banned', mute: 'muted', kick: 'kicked', warn: 'warned', blacklist: 'blacklisted' };
const REVOKE_VERB = { ban: 'unbanned', mute: 'unmuted', blacklist: 'unblacklisted' };

function pulseLine(e) {
  const actor = e.actorName ? nameTag(e.actorName, e.actor, e.actorColor) : null;
  const target = e.targetName ? nameTag(e.targetName, e.target, e.targetColor) : null;
  let icon = icons.flame; let cls = 'ev-cmd'; let body = '';

  if (e.type === 'punish') {
    icon = icons.shield; cls = e.kind === 'warn' ? 'ev-warn' : 'ev-punish';
    const verb = PUNISH_VERB[e.kind] || e.kind || 'punished';
    body = `${actor || 'The core'} <b class="ev-verb">${esc(verb)}</b> ${target || 'someone'}${e.permanent ? ' <span class="ev-perm">· permanent</span>' : ''}${e.reason ? ` <span class="ev-note">— ${esc(e.reason)}</span>` : ''}`;
  } else if (e.type === 'revoke') {
    icon = icons.staff; cls = 'ev-lift';
    const verb = REVOKE_VERB[e.kind] || `lifted ${e.kind || 'punishment'} on`;
    body = `${actor || 'The core'} <b class="ev-verb">${esc(verb)}</b> ${target || 'someone'}${e.reason ? ` <span class="ev-note">— ${esc(e.reason)}</span>` : ''}`;
  } else if (e.type === 'join') {
    icon = icons.arrow; cls = 'ev-join';
    body = `${target || 'A player'} <b class="ev-verb">joined</b>`;
  } else if (e.type === 'leave') {
    icon = icons.arrow; cls = 'ev-leave';
    body = `${target || 'A player'} <b class="ev-verb">left</b>`;
  } else if (e.type === 'command') {
    icon = icons.flame; cls = 'ev-cmd';
    body = `${actor || 'Someone'} ran <span class="mono">${esc(e.command || '')}</span>${e.server ? ` <span class="ev-note">on ${esc(e.server)}</span>` : ''}`;
  }

  return `
    <div class="pulse-row ${cls}" data-at="${e.at}">
      <span class="pulse-ic">${icon}</span>
      <div class="pulse-body">
        <div class="pulse-txt">${body}</div>
        <div class="pulse-when" title="${esc(new Date(e.at).toLocaleString())}">${timeAgo(e.at)}${e.server && e.type === 'punish' ? ` · ${esc(e.server)}` : ''}</div>
      </div>
    </div>`;
}

export async function renderLive(root) {
  root.innerHTML = pageLoader();

  // First fill, so the page opens full rather than empty and filling.
  let first;
  try {
    first = await Promise.all([api.dash.chatFeed(0, 60), api.dash.pulse(0, 40)]);
  } catch {
    root.innerHTML = notice('Live is unavailable', 'The core’s logs could not be read just now.');
    return;
  }
  const [chat0, pulse0] = first;

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2><span class="live-beat" id="livedot"></span>Live</h2>
        <p>Network chat and everything moving, as it happens. Leave it open.</p>
      </div>
      <div class="live-ctl">
        <input class="fld fld-inline" id="lchi" placeholder="Highlight a word" autocomplete="off" spellcheck="false" style="max-width:160px">
        <label class="live-tog" title="Hide everything but lines that trip a filter"><input type="checkbox" id="lflag"> Flagged only</label>
        <label class="live-tog" title="A sound when a filter trips while you watch"><input type="checkbox" id="lalert"> Alert</label>
        <button class="btn" id="lpause" title="Stop and start the feed">Pause</button>
      </div>
    </div>
    <div class="live-grid">
      <section class="panel entry live-pane">
        <div class="live-head">Chat <span class="live-sub" id="chatstat"></span></div>
        <div class="livechat" id="livechat"></div>
      </section>
      <section class="panel entry live-pane">
        <div class="live-head">Pulse</div>
        <div class="livepulse" id="livepulse"></div>
      </section>
    </div>`;

  const chatBox = root.querySelector('#livechat');
  const pulseBox = root.querySelector('#livepulse');
  const hiIn = root.querySelector('#lchi');
  const pauseBtn = root.querySelector('#lpause');
  const flagOnly = root.querySelector('#lflag');
  const alertOn = root.querySelector('#lalert');
  const dot = root.querySelector('#livedot');
  const chatStat = root.querySelector('#chatstat');

  let term = '';
  let paused = false;
  let chatSince = 0;
  let pulseSince = 0;
  let flagged = 0;

  // Whether the chat box is scrolled to the bottom: only then does new chat pull
  // the view down, so reading back through history is never yanked away from.
  const atBottom = () => chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 40;

  const paintChat = (lines, initial) => {
    if (!lines.length) return;
    const stick = atBottom();
    let freshFlags = 0;
    for (const l of lines) {
      if (l.at > chatSince) chatSince = l.at;
      if (l.flag) { flagged++; freshFlags++; }
      chatBox.insertAdjacentHTML('beforeend', chatLine(l, term));
    }
    while (chatBox.children.length > CHAT_KEEP) chatBox.firstElementChild.remove();
    if (stick || initial) chatBox.scrollTop = chatBox.scrollHeight;
    chatStat.textContent = flagged ? `${flagged} flagged` : '';
    // A filter tripping while you watch is the one thing worth pulling your eyes
    // over — a sound if you asked for one, and a flash either way. Never on the
    // first fill, which is history, not something that just happened.
    if (!initial && freshFlags) {
      chatBox.classList.remove('flagflash');
      void chatBox.offsetWidth; // restart the animation even on back-to-back flags
      chatBox.classList.add('flagflash');
      if (alertOn.checked) sound.click();
    }
  };

  const paintPulse = (events, initial) => {
    if (!events.length) return;
    const stick = pulseBox.scrollTop < 40;
    // The feed is newest-first; prepend so the newest sits on top.
    for (const e of [...events].reverse()) {
      if (e.at > pulseSince) pulseSince = e.at;
      pulseBox.insertAdjacentHTML('afterbegin', pulseLine(e));
    }
    while (pulseBox.children.length > PULSE_KEEP) pulseBox.lastElementChild.remove();
    if (stick || initial) pulseBox.scrollTop = 0;
  };

  // Chat arrives oldest-first, so painting in order fills the box top to bottom.
  if (chat0.lines?.length) paintChat(chat0.lines, true);
  else chatBox.innerHTML = '<div class="live-empty">Nothing said yet. New lines will appear here.</div>';
  // Pulse arrives newest-first; render straight down without the prepend dance.
  if (pulse0.events?.length) {
    pulseBox.innerHTML = pulse0.events.map(pulseLine).join('');
    pulseSince = Math.max(...pulse0.events.map((e) => e.at));
  } else {
    pulseBox.innerHTML = '<div class="live-empty">Quiet. Bans, joins and commands will show up here.</div>';
  }

  const tickChat = async () => {
    if (paused || document.hidden) return;
    try {
      const { lines } = await api.dash.chatFeed(chatSince, 60);
      if (!chatBox.isConnected) return;
      if (chatBox.querySelector('.live-empty') && lines.length) chatBox.innerHTML = '';
      paintChat(lines, false);
    } catch { /* a dropped poll is caught by the next one */ }
  };
  const tickPulse = async () => {
    if (paused || document.hidden) return;
    try {
      const { events } = await api.dash.pulse(pulseSince, 40);
      if (!pulseBox.isConnected) return;
      if (pulseBox.querySelector('.live-empty') && events.length) pulseBox.innerHTML = '';
      paintPulse(events, false);
    } catch { /* likewise */ }
  };

  // One pair of intervals, torn down the moment the page is replaced — checked on
  // each tick against the box still being in the document.
  const chatTimer = setInterval(() => {
    if (!chatBox.isConnected) { clearInterval(chatTimer); clearInterval(pulseTimer); return; }
    tickChat();
  }, CHAT_EVERY);
  const pulseTimer = setInterval(() => {
    if (!pulseBox.isConnected) { clearInterval(chatTimer); clearInterval(pulseTimer); return; }
    tickPulse();
  }, PULSE_EVERY);

  // The highlight re-marks what is already on screen as well as what comes next,
  // so typing a word lights up the backlog too.
  hiIn.addEventListener('input', () => {
    term = hiIn.value.trim();
    chatBox.querySelectorAll('.lc-msg').forEach((el) => {
      const raw = el.textContent;
      el.innerHTML = highlight(raw, term);
    });
  });

  // Flagged-only hides the calm lines rather than dropping them — untick and the
  // backlog is all still there. The state lives on the box, so it applies to
  // what is already on screen and to everything that arrives after.
  flagOnly.addEventListener('change', () => {
    chatBox.classList.toggle('flagged-only', flagOnly.checked);
  });

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    dot.classList.toggle('off', paused);
    // Resuming catches up at once rather than waiting out the interval.
    if (!paused) { tickChat(); tickPulse(); }
  });
}
