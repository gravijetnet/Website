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

    <div id="srvlist">${
      servers.length
        ? servers.map((s) => serverRow(s, !!can.manageNetwork, !!can.runCommands)).join('')
        : '<div class="board"><div class="empty">No server has reported in yet.</div></div>'
    }</div>

    ${can.manageNetwork ? maintenanceBlock(closed) : ''}`;

  if (can.manageNetwork) {
    wireMaintenance(root);
    wireReboots(root);
  }
}

function wireReboots(root) {
  root.querySelectorAll('.srv-card').forEach((card) => {
    const server = card.dataset.server;
    const msg = card.querySelector('[data-msg]');

    card.querySelector('[data-reboot]').addEventListener('click', async (e) => {
      const seconds = Number(card.querySelector('[data-delay]').value);
      const when = seconds === 0 ? 'right now' : `in ${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
      if (!confirm(`Restart ${server} ${when}? Everyone on it will be disconnected.`)) return;
      const btn = e.currentTarget;
      btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Asking the server…';
      try {
        const { jobId } = await api.dash.reboot(server, seconds);
        reportReboot(msg, await watchJob(jobId, msg));
      } catch (err) { msg.className = 'fmsg bad'; msg.textContent = rebootErr(err); }
      finally { btn.disabled = false; }
    });

    const cmdBtn = card.querySelector('[data-runcmd]');
    if (cmdBtn) {
      const cmdIn = card.querySelector('[data-cmd]');
      const cmdMsg = card.querySelector('[data-cmdmsg]');
      cmdBtn.addEventListener('click', async () => {
        const command = cmdIn.value.trim();
        if (!command) { cmdMsg.className = 'fmsg bad'; cmdMsg.textContent = 'Type a command.'; return; }
        if (!confirm(`Run "${command}" as console on ${server}?`)) return;
        cmdBtn.disabled = true; cmdMsg.className = 'fmsg'; cmdMsg.textContent = 'Running…';
        try {
          const { jobId } = await api.dash.runCommand(server, command);
          const row = await watchJob(jobId, cmdMsg);
          if (row.status === 'done') { cmdMsg.className = 'fmsg ok'; cmdMsg.textContent = row.result || 'Ran.'; }
          else reportReboot(cmdMsg, row);
        } catch (err) {
          cmdMsg.className = 'fmsg bad';
          cmdMsg.textContent = err?.body?.error === 'management_only'
            ? 'Running commands is Management only.'
            : rebootErr(err);
        } finally { cmdBtn.disabled = false; }
      });
    }

    card.querySelector('[data-rebootcancel]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Cancelling…';
      try {
        const { jobId } = await api.dash.rebootCancel(server);
        reportReboot(msg, await watchJob(jobId, msg));
      } catch (err) { msg.className = 'fmsg bad'; msg.textContent = rebootErr(err); }
      finally { btn.disabled = false; }
    });
  });
}

// A restart is claimed only by the server it names, so if that box is down
// nothing picks it up — which is worth saying rather than spinning forever.
async function watchJob(jobId, msg) {
  for (let i = 0; i < 15; i++) {
    let row;
    try { row = await api.dash.action(jobId); } catch { return { status: 'unknown' }; }
    if (row.status === 'done' || row.status === 'failed') return row;
    if (msg) msg.textContent = 'Waiting for the server…';
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'pending' };
}

function reportReboot(msg, row) {
  if (row.status === 'done') { msg.className = 'fmsg ok'; msg.textContent = row.result || 'Done.'; return; }
  if (row.status === 'failed') { msg.className = 'fmsg bad'; msg.textContent = `The server refused it: ${row.result || 'no reason'}`; return; }
  msg.className = 'fmsg bad';
  msg.textContent = 'That server did not pick it up — is it running?';
}

function rebootErr(err) {
  const code = err?.body?.error;
  if (code === 'plugin_missing') return 'The plugin build that can restart a server has not reached it yet.';
  if (code === 'bad_delay') return 'A restart can be scheduled up to a day out.';
  if (code === 'bad_server') return 'That is not a server name.';
  return 'That did not go through.';
}

// Each server is a roll-out card: the line you scan, and — for anyone who may —
// the restart controls behind it, so a button that empties a server is never a
// thing you can hit while reading the list.
function serverRow(s, canRestart, canCommand) {
  const pct = s.max > 0 ? Math.min(100, Math.round((s.online / s.max) * 100)) : 0;
  const head = `
    <span class="srv-dot ${s.up ? 'on' : ''}" title="${s.up ? 'Answering' : 'Not answering'}"></span>
    <span class="cs-name">${esc(s.name)}</span>
    ${s.whitelisted ? '<span class="re-tag">closed</span>' : ''}
    <span class="dr">${s.group ? esc(s.group) : ''}</span>
    <span class="cs-meta">${s.up ? `${int(s.online)} / ${int(s.max)}` : `last seen ${timeAgo(s.updatedAt)}`}</span>`;

  if (!canRestart) {
    return `<div class="board-row entry srv-row">${head}<div class="srv-bar" title="${pct}% full"><span style="width:${pct}%"></span></div></div>`;
  }

  return `
    <details class="panel entry card-roll srv-card" data-server="${esc(s.name)}">
      <summary class="card-sum">${head}</summary>
      <div class="panel-body">
        <div class="ptiles ptiles-4" style="margin-bottom:10px">
          <div class="ptile entry"><span class="pt-n">${int(s.online)}</span><span class="pt-l">online</span></div>
          <div class="ptile entry"><span class="pt-n">${int(s.max)}</span><span class="pt-l">capacity</span></div>
          <div class="ptile entry"><span class="pt-n">${pct}%</span><span class="pt-l">full</span></div>
          <div class="ptile entry"><span class="pt-n">${s.up ? 'up' : 'down'}</span><span class="pt-l">${esc(timeAgo(s.updatedAt))}</span></div>
        </div>
        ${
          s.players && s.players.length
            ? `<div class="block">
                 <div class="block-label">On right now</div>
                 <div class="altrow">${s.players
                   .map((n) => `<a class="permchip" href="/players?q=${encodeURIComponent(n)}">${esc(n)}</a>`)
                   .join('')}</div>
               </div>`
            : ''
        }
        <div class="block-label">Restart</div>
        <p class="rule-text">Uses the core's own countdown, so players get the warnings they already know. Only this server takes the job.</p>
        <div class="factions">
          <select class="fld" data-delay>
            <option value="0">now</option>
            <option value="60" selected>in 1 minute</option>
            <option value="300">in 5 minutes</option>
            <option value="900">in 15 minutes</option>
            <option value="1800">in 30 minutes</option>
          </select>
          <button class="btn btn-danger" data-reboot>Restart ${esc(s.name)}</button>
          <button class="btn" data-rebootcancel>Cancel</button>
          <span class="fmsg" data-msg></span>
        </div>

        ${
          canCommand
            ? `<div class="block" style="margin-top:12px">
                 <div class="block-label">Run a command</div>
                 <p class="rule-text">As console, on this server. This is everything the panel has no button for — and everything the core gains later. Every line is recorded against your name.</p>
                 <div class="factions">
                   <input class="fld fld-inline mono" data-cmd placeholder="say hello" maxlength="255">
                   <button class="btn btn-danger" data-runcmd>Run</button>
                   <span class="fmsg" data-cmdmsg></span>
                 </div>
               </div>`
            : ''
        }
      </div>
    </details>`;
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
