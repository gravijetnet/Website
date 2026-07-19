// The host underneath the game.
//
// Every other page in this console reaches Phoenix — ranks, punishments, the
// plugin's queues. This one reaches the machine those run on: power, the
// container's own console, backups, worlds, and the vanilla files that box keeps
// about who is opped and who is banned on it.
//
// That distinction is the thing this page has to keep saying out loud, because
// two of the words on it mean something different from everywhere else in
// Spielplatz. A restart here is not the core's countdown — it takes the container
// away. A ban here is the vanilla file on one box, not a Phoenix punishment, and
// a moderator who confuses the two will unban somebody who was never banned.
import { api } from './api.js';
import { esc, int, timeAgo, dateShort } from './util.js';
import { pageLoader, notice } from './components.js';
import { ask, confirmDanger } from './modal.js';

// The panel's own trouble, said as whose problem it is. `ip_not_allowed` earns
// its own sentence: it is the one failure whose fix is a setting in the panel
// rather than anything on this side, and nobody would guess that from "forbidden".
function panelErr(err) {
  return err?.body?.detail || 'The panel did not answer.';
}

const bytes = (n) => {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};

const STATE = { running: 'up', starting: 'starting', stopping: 'stopping', offline: 'down' };

export async function renderPanel(root, can) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.panelServers();
  } catch (err) {
    root.innerHTML = notice('The host is unreachable', panelErr(err));
    return;
  }

  if (!data.configured) {
    root.innerHTML = notice(
      'Not connected',
      'No panel credentials are set on this server, so the host cannot be reached from here.',
    );
    return;
  }

  const servers = data.servers || [];
  const up = servers.filter((s) => s.status === 'running');
  const down = servers.filter((s) => s.status === 'offline');

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Host</h2>
        <p>The machines the game runs on — power, their own console, backups and worlds. This is the layer below Phoenix: a restart here takes the container away rather than asking the server to come back.</p>
      </div>
    </div>

    <div class="ptiles ptiles-4">
      <div class="ptile entry"><span class="pt-n">${int(servers.length)}</span><span class="pt-l">servers</span></div>
      <div class="ptile entry"><span class="pt-n">${int(up.length)}</span><span class="pt-l">running</span></div>
      <div class="ptile entry"><span class="pt-n">${int(down.length)}</span><span class="pt-l">offline</span></div>
      <div class="ptile entry"><span class="pt-n">${int(servers.reduce((n, s) => n + s.memory, 0) / 1024)}</span><span class="pt-l">GB allotted</span></div>
    </div>

    <div id="hostlist">${servers.map((s) => serverCard(s, can)).join('')}</div>`;

  wirePanel(root, can);
}

function serverCard(s, can) {
  const state = STATE[s.status] || s.status;
  return `
    <details class="panel entry card-roll host-card" data-server="${esc(s.id)}">
      <summary class="card-sum">
        <span class="srv-dot ${s.status === 'running' ? 'on' : ''} ${s.status === 'starting' ? 'warm' : ''}"></span>
        <span class="cs-name">${esc(s.name)}</span>
        ${s.suspended ? '<span class="re-tag">suspended</span>' : ''}
        <span class="dr">${esc(state)}</span>
        <span class="cs-meta">${s.memory ? `${(s.memory / 1024).toFixed(s.memory % 1024 ? 1 : 0)} GB` : '—'} · ${s.cpu || 0}% CPU</span>
      </summary>
      <div class="panel-body">
        <div class="ptiles ptiles-4" style="margin-bottom:12px">
          <div class="ptile entry"><span class="pt-n">${esc(state)}</span><span class="pt-l">state</span></div>
          <div class="ptile entry"><span class="pt-n">${s.memory ? bytes(s.memory * 1024 * 1024) : '—'}</span><span class="pt-l">memory</span></div>
          <div class="ptile entry"><span class="pt-n">${s.disk ? bytes(s.disk * 1024 * 1024) : '—'}</span><span class="pt-l">disk</span></div>
          <div class="ptile entry"><span class="pt-n">${esc(s.node || '—')}</span><span class="pt-l">node</span></div>
        </div>

        ${
          can.runCommands
            ? `<div class="block">
                 <div class="block-label">Power</div>
                 <p class="rule-text">This is the container, not the core. Stopping one disconnects everybody on it at once, with no countdown.</p>
                 <div class="factions">
                   <button class="btn" data-power="start">Start</button>
                   <button class="btn" data-power="restart">Restart</button>
                   <button class="btn btn-danger" data-power="stop">Stop</button>
                   <button class="btn btn-danger" data-power="kill">Kill</button>
                   <span class="fmsg" data-powermsg></span>
                 </div>
               </div>
               <div class="block">
                 <div class="block-label">Console</div>
                 <div class="factions">
                   <input class="fld fld-inline mono" data-cmd placeholder="say hello" maxlength="255">
                   <button class="btn" data-runcmd>Send</button>
                   <span class="fmsg" data-cmdmsg></span>
                 </div>
               </div>`
            : ''
        }

        <details class="block card-roll" data-lazy="backups">
          <summary class="card-sum"><span class="cs-name">Backups</span><span class="cs-meta">open to load</span></summary>
          <div data-slot>${pageLoader()}</div>
        </details>

        <details class="block card-roll" data-lazy="worlds">
          <summary class="card-sum"><span class="cs-name">Worlds</span><span class="cs-meta">open to load</span></summary>
          <div data-slot>${pageLoader()}</div>
        </details>

        <details class="block card-roll" data-lazy="players">
          <summary class="card-sum"><span class="cs-name">Ops, whitelist and this box’s own bans</span><span class="cs-meta">open to load</span></summary>
          <div data-slot>${pageLoader()}</div>
        </details>
      </div>
    </details>`;
}

// --- the three lazy panes ---------------------------------------------------
// Loaded on open, one call each. Opening a server card should not fire four
// requests at somebody else's host for panes you may never look at.

function backupsPane(d, can) {
  if (!d.backups.length) return '<div class="board"><div class="empty">No backups.</div></div>';
  return `
    <div class="board">
      ${d.backups
        .map(
          (b) => `
        <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px" data-backup="${esc(b.uuid)}">
          <div style="min-width:0">
            <div class="dn">${esc(b.name)} ${b.locked ? '<span class="re-tag">locked</span>' : ''}${b.successful ? '' : '<span class="re-tag">failed</span>'}</div>
            <div class="dr">${bytes(b.bytes)}${b.createdAt ? ` · ${esc(dateShort(b.createdAt))}` : ''}</div>
          </div>
          <div class="urow-right">
            ${can.runCommands ? '<button class="btn ed-mini" data-restore>Restore</button>' : ''}
            ${!b.locked ? '<button class="btn ed-mini ed-del" data-delbackup>Delete</button>' : ''}
          </div>
        </div>`,
        )
        .join('')}
    </div>
    <div class="factions">
      <button class="btn" data-newbackup>Take a backup</button>
      <span class="fmsg" data-bmsg></span>
    </div>`;
}

function worldsPane(d) {
  if (!d.worlds.length) return '<div class="board"><div class="empty">No worlds reported.</div></div>';
  return `<div class="board">${d.worlds
    .map(
      (w) => `
      <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
        <div><div class="dn">${esc(w.name)}</div><div class="dr">${w.modified ? `changed ${timeAgo(w.modified)}` : ''}</div></div>
        <div class="dr">${bytes(w.bytes)}</div>
      </div>`,
    )
    .join('')}</div>`;
}

function playersPane(d) {
  const chips = (list, empty) =>
    list.length
      ? `<div class="altrow">${list.map((x) => `<span class="permchip">${esc(x.name || x.uuid || x)}</span>`).join('')}</div>`
      : `<p class="rule-text">${empty}</p>`;
  return `
    <div class="block">
      <div class="block-label">On this box</div>
      <p class="rule-text">${int(d.online)} of ${int(d.max)} — as the box itself reports it.</p>
      ${chips(d.list, 'Nobody.')}
    </div>
    <div class="block"><div class="block-label">Operators</div>${chips(d.ops, 'None.')}</div>
    <div class="block"><div class="block-label">Whitelist</div>${chips(d.whitelist, 'Empty — the whitelist is off or nobody is on it.')}</div>
    <div class="block">
      <div class="block-label">This box’s own bans</div>
      <p class="rule-text">These are the vanilla ban files on this one server, not Phoenix punishments. Lifting a Phoenix ban does not touch these, and these do not appear in a player’s history.</p>
      ${
        d.bans.length
          ? `<div class="board">${d.bans
            .map((b) => `<div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px"><div><div class="dn">${esc(b.name)}</div><div class="dr">${esc(b.reason || 'no reason')}</div></div><div class="dr">${esc(b.source || '')}</div></div>`)
            .join('')}</div>`
          : '<p class="rule-text">None.</p>'
      }
    </div>`;
}

function wirePanel(root, can) {
  root.querySelectorAll('.host-card').forEach((card) => {
    const id = card.dataset.server;

    // Power.
    const pmsg = card.querySelector('[data-powermsg]');
    card.querySelectorAll('[data-power]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const action = btn.dataset.power;
        const hard = action === 'stop' || action === 'kill';
        const ok = hard
          ? await confirmDanger(
            `${action === 'kill' ? 'Kill' : 'Stop'} this server?`,
            action === 'kill'
              ? 'A kill is immediate and unclean — the world may not save. Use stop unless it is already wedged.'
              : 'Everybody on it is disconnected at once, with no countdown.',
            action === 'kill' ? 'Kill it' : 'Stop it',
          )
          : await ask({ title: `${action} this server?`, confirmLabel: action });
        if (!ok) return;
        btn.disabled = true;
        pmsg.className = 'fmsg';
        pmsg.textContent = 'Asking the panel…';
        try {
          await api.dash.panelPower(id, action);
          pmsg.className = 'fmsg ok';
          pmsg.textContent = `${action} sent — the panel takes a moment.`;
        } catch (err) {
          pmsg.className = 'fmsg bad';
          pmsg.textContent = panelErr(err);
        } finally {
          btn.disabled = false;
        }
      }),
    );

    // The container's console.
    const cmdBtn = card.querySelector('[data-runcmd]');
    if (cmdBtn) {
      const cmdIn = card.querySelector('[data-cmd]');
      const cmsg = card.querySelector('[data-cmdmsg]');
      const run = async () => {
        const command = cmdIn.value.trim();
        if (!command) { cmsg.className = 'fmsg bad'; cmsg.textContent = 'Type a command.'; return; }
        cmdBtn.disabled = true; cmsg.className = 'fmsg'; cmsg.textContent = 'Sending…';
        try {
          await api.dash.panelCommand(id, command);
          cmsg.className = 'fmsg ok'; cmsg.textContent = 'Sent to the console.';
          cmdIn.value = '';
        } catch (err) { cmsg.className = 'fmsg bad'; cmsg.textContent = panelErr(err); }
        finally { cmdBtn.disabled = false; }
      };
      cmdBtn.addEventListener('click', run);
      cmdIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    }

    // The three panes, each loaded the first time it is opened.
    card.querySelectorAll('[data-lazy]').forEach((box) => {
      const slot = box.querySelector('[data-slot]');
      let loaded = false;
      box.addEventListener('toggle', async () => {
        if (!box.open || loaded) return;
        loaded = true;
        const what = box.dataset.lazy;
        try {
          if (what === 'backups') {
            slot.innerHTML = backupsPane(await api.dash.panelBackups(id), can);
            wireBackups(slot, id, can);
          } else if (what === 'worlds') {
            slot.innerHTML = worldsPane(await api.dash.panelWorlds(id));
          } else {
            slot.innerHTML = playersPane(await api.dash.panelPlayers(id));
          }
        } catch (err) {
          loaded = false;
          slot.innerHTML = `<div class="empty">${esc(panelErr(err))}</div>`;
        }
      });
    });
  });
}

function wireBackups(slot, id, can) {
  const msg = slot.querySelector('[data-bmsg]');

  slot.querySelector('[data-newbackup]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Asking the panel…';
    try {
      await api.dash.panelBackup(id);
      msg.className = 'fmsg ok';
      msg.textContent = 'Started. A backup takes a while — reopen this to see it.';
    } catch (err) { msg.className = 'fmsg bad'; msg.textContent = panelErr(err); }
    finally { btn.disabled = false; }
  });

  slot.querySelectorAll('[data-backup]').forEach((row) => {
    const uuid = row.dataset.backup;

    row.querySelector('[data-restore]')?.addEventListener('click', async () => {
      if (!await confirmDanger(
        'Restore this backup?',
        'It overwrites the server’s current files with the ones in this backup. Anything since is lost.',
        'Restore it',
      )) return;
      msg.className = 'fmsg'; msg.textContent = 'Restoring…';
      try {
        await api.dash.panelRestore(id, uuid);
        msg.className = 'fmsg ok'; msg.textContent = 'Restore started.';
      } catch (err) { msg.className = 'fmsg bad'; msg.textContent = panelErr(err); }
    });

    row.querySelector('[data-delbackup]')?.addEventListener('click', async () => {
      if (!await confirmDanger('Delete this backup?', 'The copy is gone. The server itself is untouched.', 'Delete')) return;
      try {
        await api.dash.panelDeleteBackup(id, uuid);
        row.remove();
      } catch (err) { msg.className = 'fmsg bad'; msg.textContent = panelErr(err); }
    });
  });
}
