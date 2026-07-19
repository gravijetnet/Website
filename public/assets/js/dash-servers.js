// The network as it stands, and the switch that closes it.
//
// Phoenix knows which servers exist and who is on them, but only from inside the
// game — so each server publishes its own row every ten seconds and this reads
// the set. A row nobody has touched in a minute is a server that stopped, and
// that is shown as plainly as one that is up: a console that quietly drops a
// dead server off the list is a console that hides an outage.
import { api } from './api.js';
import { esc, int, timeAgo } from './util.js';
import { pageLoader, notice } from './components.js';

export async function renderServers(root, can) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.servers();
  } catch {
    root.innerHTML = notice('Network unavailable', 'Could not read the server list.');
    return;
  }

  const servers = data.servers || [];
  const up = servers.filter((s) => s.up);
  const players = up.reduce((n, s) => n + s.online, 0);
  const closed = up.some((s) => s.whitelisted);

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Servers</h2>
        <p>Every server that has reported in, what it is carrying, and whether it is still answering.</p>
      </div>
    </div>
    ${data.installed ? '' : notice('Not deployed yet', 'The plugin build that publishes server status has not reached the game servers yet. It arrives on their next restart.')}

    <div class="ptiles ptiles-4">
      <div class="ptile entry"><span class="pt-n">${int(players)}</span><span class="pt-l">players online</span></div>
      <div class="ptile entry"><span class="pt-n">${int(up.length)}</span><span class="pt-l">servers up</span></div>
      <div class="ptile entry"><span class="pt-n">${int(servers.length - up.length)}</span><span class="pt-l">not answering</span></div>
      <div class="ptile entry"><span class="pt-n">${closed ? 'closed' : 'open'}</span><span class="pt-l">network</span></div>
    </div>

    <div class="board" id="srvlist">${
      servers.length
        ? servers.map(serverRow).join('')
        : '<div class="empty">No server has reported in yet.</div>'
    }</div>

    ${can.manageNetwork ? maintenanceBlock(closed) : ''}`;

  if (can.manageNetwork) wireMaintenance(root);
}

function serverRow(s) {
  const pct = s.max > 0 ? Math.min(100, Math.round((s.online / s.max) * 100)) : 0;
  return `
    <div class="board-row entry" style="grid-template-columns:auto 1fr auto;gap:12px">
      <span class="srv-dot ${s.up ? 'on' : ''}" title="${s.up ? 'Answering' : 'Not answering'}"></span>
      <div style="min-width:0">
        <div class="dn">${esc(s.name)}${s.whitelisted ? ' <span class="re-tag">closed</span>' : ''}</div>
        <div class="dr">${s.group ? `${esc(s.group)} · ` : ''}${s.up ? `${int(s.online)} of ${int(s.max)}` : `last seen ${timeAgo(s.updatedAt)}`}</div>
      </div>
      <div class="srv-bar" title="${pct}% full"><span style="width:${pct}%"></span></div>
    </div>`;
}

function maintenanceBlock(closed) {
  return `
    <div class="block" id="maint">
      <div class="block-label">Maintenance</div>
      <p class="rule-text">Closing the network turns on the core's whitelist: nobody joins but those the core lets through. Who that is stays the core's decision — this only flips the switch, and records who flipped it.</p>
      <div class="factions">
        <button class="btn ${closed ? 'btn-primary' : 'btn-danger'}" id="maintbtn">${closed ? 'Open the network' : 'Close the network'}</button>
        <span class="fmsg" id="maintmsg"></span>
      </div>
      <div class="block" style="margin-top:12px">
        <div class="block-label">Let one player through</div>
        <div class="factions">
          <input class="fld fld-inline" id="wlname" placeholder="Exact in-game name" maxlength="32">
          <button class="btn" id="wladd">Add</button>
          <button class="btn" id="wlrem">Remove</button>
          <span class="fmsg" id="wlmsg"></span>
        </div>
      </div>
    </div>`;
}

function wireMaintenance(root) {
  const btn = root.querySelector('#maintbtn');
  const msg = root.querySelector('#maintmsg');
  const closing = btn.textContent.includes('Close');

  btn.addEventListener('click', async () => {
    const confirmText = closing
      ? 'Close the network? Nobody but those the core lets through will be able to join.'
      : 'Open the network again?';
    if (!confirm(confirmText)) return;
    btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Asking the network…';
    try {
      await api.dash.maintenance(closing);
      msg.className = 'fmsg ok';
      msg.textContent = closing ? 'Closing — the core is applying it.' : 'Opening — the core is applying it.';
      setTimeout(() => renderServers(root, { manageNetwork: true }), 2500);
    } catch (err) {
      btn.disabled = false;
      msg.className = 'fmsg bad';
      msg.textContent = err?.body?.error === 'plugin_missing'
        ? 'The plugin is not deployed yet, so this cannot reach the network.'
        : 'That did not go through.';
    }
  });

  const name = root.querySelector('#wlname');
  const wmsg = root.querySelector('#wlmsg');
  const run = async (add) => {
    const who = name.value.trim();
    if (!who) { wmsg.className = 'fmsg bad'; wmsg.textContent = 'Name?'; return; }
    wmsg.className = 'fmsg'; wmsg.textContent = 'Sending…';
    try {
      await api.dash.whitelist(who, add);
      wmsg.className = 'fmsg ok';
      wmsg.textContent = add ? `${who} may join.` : `${who} may not.`;
    } catch (err) {
      wmsg.className = 'fmsg bad';
      wmsg.textContent = err?.body?.error === 'bad_name' ? 'That is not a Minecraft name.' : 'That did not go through.';
    }
  };
  root.querySelector('#wladd').addEventListener('click', () => run(true));
  root.querySelector('#wlrem').addEventListener('click', () => run(false));
}
