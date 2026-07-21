// Team activity — the owner's view of who is moderating.
//
// The logs say what happened; this says who has been doing it. For each member
// of the team: the punishments they have handed out, broken down by kind, the
// moderation commands they have run, and when they were last active — sorted by
// how much they have done, so a quiet week on the team is visible at a glance.
//
// It is not a scoreboard to rank people by. A network's best moderator is often
// its quietest, because the room they watch stays calm. It is here to answer the
// questions an owner actually has: is anyone carrying the whole load, and has
// anyone gone dark.
import { api } from './api.js';
import { esc, int, timeAgo, head } from './util.js';
import { pageLoader, notice } from './components.js';

// The kinds of punishment, in the order they escalate, so a row of chips reads
// the same way every time and the heavy ones sit where the eye expects them.
const TYPE_ORDER = ['BLACKLIST', 'BAN', 'MUTE', 'KICK', 'WARN'];
const TYPE_LABEL = { BLACKLIST: 'blacklist', BAN: 'ban', MUTE: 'mute', KICK: 'kick', WARN: 'warn' };

function typeChips(byType) {
  const keys = Object.keys(byType || {}).sort(
    (a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99),
  );
  if (!keys.length) return '<span class="dr">no punishments</span>';
  return keys
    .map((t) => `<span class="permchip act-chip act-${t.toLowerCase()}">${esc(TYPE_LABEL[t] || t.toLowerCase())} ${int(byType[t])}</span>`)
    .join('');
}

export async function renderActivity(root) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.staffActivity();
  } catch {
    root.innerHTML = notice('Unavailable', 'The team’s activity could not be read.');
    return;
  }

  const staff = data.staff || [];
  // The busiest member sets the scale for everyone's bar, so the bars compare to
  // each other rather than to an arbitrary ceiling.
  const peak = Math.max(1, ...staff.map((s) => s.punishments + s.commands));
  // "Gone dark" is worth flagging, but only against a network that is itself
  // active — a fortnight of quiet everywhere is a quiet fortnight, not a warning.
  const DARK = 14 * 86400000;
  const anyRecent = staff.some((s) => s.lastAt && Date.now() - s.lastAt < DARK);

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Team activity</h2>
        <p>Punishments handed out and moderation commands run, by whoever ran them.</p>
      </div>
    </div>
    <div class="board">
      ${
        staff.length
          ? staff.map((s) => row(s, peak, anyRecent, DARK)).join('')
          : '<div class="empty">No staff hold a rank right now.</div>'
      }
    </div>`;
}

function row(s, peak, anyRecent, DARK) {
  const total = s.punishments + s.commands;
  const width = Math.round((total / peak) * 100);
  const dark = anyRecent && (!s.lastAt || Date.now() - s.lastAt > DARK);
  return `
    <div class="board-row entry act-row" style="grid-template-columns:auto 1fr auto;gap:12px">
      <img class="act-head" src="${head(s.uuid, 40)}" alt="" width="40" height="40" loading="lazy">
      <div style="min-width:0">
        <div class="act-top">
          <a class="dn" style="color:${esc(s.color)}" href="/players?q=${encodeURIComponent(s.name)}">${esc(s.name)}</a>
          ${s.rank ? `<span class="dr">${esc(s.rank)}</span>` : ''}
          ${dark ? '<span class="act-dark">quiet 2w+</span>' : ''}
        </div>
        <div class="act-chips">${typeChips(s.byType)}${s.commands ? `<span class="permchip act-chip act-cmd">${int(s.commands)} commands</span>` : ''}</div>
        <div class="act-bar"><span style="width:${width}%"></span></div>
      </div>
      <div class="dr act-when" title="last action">${s.lastAt ? timeAgo(s.lastAt) : 'never'}</div>
    </div>`;
}
