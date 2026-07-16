// Reusable render fragments shared across views.
import { esc, head, int } from './util.js';

// A player identity cell (head + name + coloured rank) used in tables/search.
export function playerCell(uuid, name, rank, online) {
  const dot = online ? '<span class="online-dot" title="Online"></span>' : '';
  return `
    <div class="player-cell">
      <img src="${head(uuid, 68)}" loading="lazy" alt="" onerror="this.src='https://mc-heads.net/avatar/MHF_Steve/68'">
      <div style="min-width:0">
        <div class="pc-name">${esc(name)}${dot ? ' ' + dot : ''}</div>
        <div class="pc-rank" style="color:${rank?.color || '#8b91ac'}">${esc(rank?.label || 'Member')}</div>
      </div>
    </div>`;
}

// A single telemetry stat (big mono number + caption). `cls` colours the value.
export function stat(value, label, cls = '') {
  return `<div class="stat"><div class="v ${cls}">${value}</div><div class="l">${esc(label)}</div></div>`;
}

// Win/loss split bar. wins/losses are raw counts. `label` names what the middle
// percentage measures — modes differ (Bedwars counts rounds a player left, so
// its W/L split is not the same number as its win rate over all rounds).
export function wlBar(wins, losses, label = 'win rate') {
  const total = wins + losses;
  const pct = total > 0 ? (wins / total) * 100 : 0;
  return `
    <div class="wl-bar"><div class="w" style="width:${pct.toFixed(1)}%"></div></div>
    <div class="wl-legend"><span style="color:var(--win)">${int(wins)} W</span><span>${pct.toFixed(0)}% ${esc(label)}</span><span style="color:var(--loss)">${int(losses)} L</span></div>`;
}

// Bare on purpose: callers that paint into a page root wrap it in .container
// themselves (see pageLoader), while in-page slots are already inside one.
export function loader() {
  return '<div class="loader"><div class="ring"></div></div>';
}

export function pageLoader() {
  return `<div class="container">${loader()}</div>`;
}

export function notice(title, body) {
  return `<div class="container"><div class="notice"><h2>${esc(title)}</h2><p>${esc(body)}</p></div></div>`;
}
