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
import { ask, confirmDanger, askText } from './modal.js';

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

// A meter, not a number. "24.3 of 31.3 GB" is a fact you have to do arithmetic on
// before it means anything; a bar at 78% is the same fact already understood.
// The colour is the reading, not decoration: green while there is room, gold when
// it is getting tight, red when the next thing to start probably will not.
function meter(label, used, total, text) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const band = pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : '';
  return `
    <div class="meter">
      <div class="meter-top">
        <span class="meter-l">${esc(label)}</span>
        <span class="meter-v">${esc(text)}</span>
        <span class="meter-p ${band}">${Math.round(pct)}%</span>
      </div>
      <div class="meter-bar"><span class="${band}" style="width:${pct.toFixed(1)}%"></span></div>
    </div>`;
}

// What the machine is doing right now, against what it has. The panel's
// per-server figures are allocations — a budget somebody wrote down — and this is
// the meter, which is the number that tells you whether anything is actually
// wrong. They are shown together and labelled as the two different things they
// are, because a box can be 300% allocated and perfectly idle.
function nodePanel(n) {
  if (!n || !n.configured || !n.node) return '';
  const gb = (b) => `${(b / 1073741824).toFixed(1)} GB`;
  const allocGb = n.allocated ? n.allocated.memoryMb / 1024 : 0;
  const capacityGb = n.memory.total / 1073741824;
  const over = allocGb && capacityGb ? allocGb / capacityGb : 0;

  return `
    <section class="panel entry">
      <div class="panel-head">
        <div class="glyph glyph-sm"><span class="srv-dot ${n.node.status === 'healthy' ? 'on' : ''}"></span></div>
        <div>
          <h3>${esc(n.node.name || 'the node')}</h3>
          <div class="ph-sub">${esc(n.node.status)}${n.node.fqdn ? ` · ${esc(n.node.fqdn)}` : ''} · load ${n.load.map((l) => l.toFixed(2)).join(' / ')}</div>
        </div>
      </div>
      <div class="panel-body">
        ${meter('Memory', n.memory.used, n.memory.total, `${gb(n.memory.used)} of ${gb(n.memory.total)}`)}
        ${meter('CPU', n.cpu, 100, `${n.cpu.toFixed(1)}%`)}
        ${meter('Disk', n.disk.used, n.disk.total, `${gb(n.disk.used)} of ${gb(n.disk.total)}`)}
        ${n.swap.total ? meter('Swap', n.swap.used, n.swap.total, `${gb(n.swap.used)} of ${gb(n.swap.total)}`) : ''}
        ${
          n.allocated
            ? `<p class="rule-text meter-note">Every server on this host has been promised
                 ${allocGb.toFixed(1)} GB between them — ${over >= 1.05 ? `${over.toFixed(1)}× the machine's ${capacityGb.toFixed(1)} GB` : `under its ${capacityGb.toFixed(1)} GB`}.
                 Allocation is a budget; the bars above are what is actually being used.</p>`
            : ''
        }
      </div>
    </section>`;
}

export async function renderPanel(root, can) {
  root.innerHTML = pageLoader();
  let data;
  let node = null;
  try {
    // Asked for together: the list is useless without knowing whether the box
    // behind it has any room left, and one of them failing should not hide the
    // other.
    const [servers, nodeStatus] = await Promise.all([
      api.dash.panelServers(),
      api.dash.panelNode().catch(() => null),
    ]);
    data = servers;
    node = nodeStatus;
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
        <p>The machines the game runs on — power, their own console, backups and worlds. Only this network's own servers are listed and only they can be touched; the host carries other people's too. This is the layer below Phoenix: a restart here takes the container away rather than asking the server to come back.</p>
      </div>
    </div>

    ${nodePanel(node)}

    <div class="ptiles ptiles-4">
      <div class="ptile entry"><span class="pt-n">${int(servers.length)}</span><span class="pt-l">servers here</span></div>
      <div class="ptile entry"><span class="pt-n">${int(up.length)}</span><span class="pt-l">running</span></div>
      <div class="ptile entry"><span class="pt-n">${int(down.length)}</span><span class="pt-l">offline</span></div>
      <div class="ptile entry"><span class="pt-n">${(servers.reduce((n, s) => n + s.memory, 0) / 1024).toFixed(1)}</span><span class="pt-l">GB promised to these</span></div>
    </div>

    <div id="hostlist">${servers.map((s) => serverCard(s, can)).join('')}</div>`;

  wirePanel(root, can);
}

function serverCard(s, can) {
  const state = STATE[s.status] || s.status;
  return `
    <details class="panel entry card-roll host-card" data-server="${esc(s.id)}">
      <summary class="card-sum">
        <span class="srv-dot ${s.status === 'running' ? 'on' : ''} ${s.status === 'starting' ? 'warm' : ''}" title="${esc(state)}"></span>
        <span class="cs-name">${esc(s.name)}</span>
        ${s.suspended ? '<span class="re-tag">suspended</span>' : ''}
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

        <details class="block card-roll" data-lazy="console">
          <summary class="card-sum"><span class="cs-name">Console log</span><span class="cs-meta">open to load</span></summary>
          <div data-slot>${pageLoader()}</div>
        </details>

        <details class="block card-roll" data-lazy="ports">
          <summary class="card-sum"><span class="cs-name">Address and ports</span><span class="cs-meta">open to load</span></summary>
          <div data-slot>${pageLoader()}</div>
        </details>

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

        <details class="block card-roll" data-lazy="files">
          <summary class="card-sum"><span class="cs-name">Files</span><span class="cs-meta">open to load</span></summary>
          <div data-slot>${pageLoader()}</div>
        </details>

        <details class="block card-roll" data-lazy="activity">
          <summary class="card-sum"><span class="cs-name">What the panel recorded</span><span class="cs-meta">open to load</span></summary>
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

// The container's own output. Newest last, because that is how a log reads and
// scrolling to the bottom is a gesture everybody already has.
function consolePane(d) {
  if (!d.lines.length) return '<div class="board"><div class="empty">The log is empty.</div></div>';
  return `
    <div class="logbox">${d.lines.map((l) => `<div class="logline">${esc(l)}</div>`).join('')}</div>
    <div class="factions">
      <button class="btn" data-reloadlog>Reload</button>
      <button class="btn" data-sharelog>Share to mclo.gs</button>
      <span class="fmsg" data-logmsg></span>
    </div>`;
}

function portsPane(d) {
  if (!d.allocations.length) return '<div class="board"><div class="empty">No address on record.</div></div>';
  return `<div class="board">${d.allocations
    .map((a) => `
      <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
        <div><div class="dn mono">${esc(a.ip)}:${esc(String(a.port))}</div><div class="dr">${esc(a.alias || '')}${a.notes ? ` · ${esc(a.notes)}` : ''}</div></div>
        <div class="dr">${a.primary ? 'primary' : ''}</div>
      </div>`)
    .join('')}</div>`;
}

// The panel's own record, which is not ours. Somebody pressing stop in the panel
// never touches Spielplatz's audit, and this is the only place it shows.
function activityPane(d) {
  if (!d.activities.length) return '<div class="board"><div class="empty">Nothing recorded.</div></div>';
  return `<div class="board">${d.activities
    .map((a) => `
      <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
        <div><div class="dn mono">${esc(a.event)}</div><div class="dr">${esc(a.ip || '')}</div></div>
        <div class="dr">${a.at ? esc(dateShort(a.at)) : ''}</div>
      </div>`)
    .join('')}</div>`;
}

// A file listing, and — for the ones this console will open — an editor.
// Folders first, then names: the order every file manager has taught people to
// expect, and the one that makes a deep tree navigable by eye.
function filesPane(d, canWrite) {
  const up = d.path && d.path !== '/' ? d.path.replace(/\/[^/]*\/?$/, '') || '/' : null;
  return `
    <div class="filebar">
      <span class="dr mono">${esc(d.path)}</span>
      ${up !== null ? `<button class="btn ed-mini" data-cd="${esc(up)}">Up</button>` : ''}
      ${d.limited ? '<span class="dr">(long directory, truncated)</span>' : ''}
    </div>
    <div class="board">
      ${
        d.entries.length
          ? d.entries
            .map((e) => `
              <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
                <div style="min-width:0">
                  <div class="dn mono">${e.directory ? '📁 ' : ''}${esc(e.name)}</div>
                  <div class="dr">${e.directory ? 'folder' : bytes(e.size)}${e.modified ? ` · ${timeAgo(e.modified)}` : ''}</div>
                </div>
                <div class="urow-right">
                  ${e.directory ? `<button class="btn ed-mini" data-cd="${esc((d.path === '/' ? '' : d.path) + '/' + e.name)}">Open</button>` : ''}
                  ${!e.directory && e.editable ? `<button class="btn ed-mini" data-open="${esc((d.path === '/' ? '' : d.path) + '/' + e.name)}">${canWrite ? 'Edit' : 'View'}</button>` : ''}
                </div>
              </div>`)
            .join('')
          : '<div class="empty">Empty.</div>'
      }
    </div>
    <div data-editor></div>`;
}

function editorPane(path, content, canWrite) {
  return `
    <div class="block">
      <div class="block-label mono">${esc(path)}</div>
      <textarea class="fld mono editorbox" data-filebody ${canWrite ? '' : 'readonly'}>${esc(content)}</textarea>
      <div class="factions">
        ${canWrite ? '<button class="btn btn-primary" data-savefile>Save</button>' : '<span class="dr">Read only — saving a config is Management.</span>'}
        <button class="btn" data-closefile>Close</button>
        <span class="fmsg" data-filemsg></span>
      </div>
      ${canWrite ? '<p class="rule-text re-hint">The server reads most of these only at startup, so a change usually needs a restart to take effect.</p>' : ''}
    </div>`;
}

function worldsPane(d, canWrite) {
  if (!d.worlds.length) return '<div class="board"><div class="empty">No worlds reported.</div></div>';
  return `
    <div class="board">
      ${d.worlds
        .map(
          (w) => `
      <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px" data-world="${esc(w.name)}">
        <div style="min-width:0">
          <div class="dn">${esc(w.name)}</div>
          <div class="dr">${bytes(w.bytes)}${w.modified ? ` · changed ${timeAgo(w.modified)}` : ''}</div>
        </div>
        <div class="urow-right">
          <button class="btn ed-mini" data-wbackup>Back up</button>
          ${canWrite ? '<button class="btn ed-mini" data-wrename>Rename</button>' : ''}
          ${canWrite ? '<button class="btn ed-mini ed-del" data-wdelete>Delete</button>' : ''}
        </div>
      </div>`,
        )
        .join('')}
    </div>
    <span class="fmsg" data-wmsg></span>
    <p class="rule-text re-hint">A world is the one thing here nobody gets back. Renaming moves it out from under a running server; deleting is final.</p>`;
}

function wireWorlds(slot, id, canWrite) {
  const msg = slot.querySelector('[data-wmsg]');
  const say = (cls, text) => { msg.className = `fmsg ${cls}`.trim(); msg.textContent = text; };

  slot.querySelectorAll('[data-world]').forEach((row) => {
    const world = row.dataset.world;

    row.querySelector('[data-wbackup]')?.addEventListener('click', async () => {
      say('', `Backing up ${world}…`);
      try { await api.dash.panelWorldBackup(id, world); say('ok', `${world} is being backed up.`); }
      catch (err) { say('bad', panelErr(err)); }
    });

    row.querySelector('[data-wrename]')?.addEventListener('click', async () => {
      const newName = await askText(`Rename ${world}`, 'The server keeps using the old directory until it restarts.');
      if (!newName) return;
      say('', 'Renaming…');
      try { await api.dash.panelWorldRename(id, world, newName); say('ok', `Renamed to ${newName}.`); }
      catch (err) { say('bad', panelErr(err)); }
    });

    row.querySelector('[data-wdelete]')?.addEventListener('click', async () => {
      if (!await confirmDanger(`Delete the world ${world}?`, 'This is final. Take a backup first if there is any doubt at all.', 'Delete it')) return;
      say('', 'Deleting…');
      try { await api.dash.panelWorldDelete(id, world); row.remove(); say('ok', `${world} is gone.`); }
      catch (err) { say('bad', panelErr(err)); }
    });
  });
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
          if (what === 'console') {
            slot.innerHTML = consolePane(await api.dash.panelLogs(id));
            wireConsole(slot, id);
          } else if (what === 'ports') {
            slot.innerHTML = portsPane(await api.dash.panelAllocations(id));
          } else if (what === 'files') {
            slot.innerHTML = filesPane(await api.dash.panelFiles(id, '/'), !!can.runCommands);
            wireFiles(slot, id, can);
          } else if (what === 'activity') {
            slot.innerHTML = activityPane(await api.dash.panelActivities(id));
          } else if (what === 'backups') {
            slot.innerHTML = backupsPane(await api.dash.panelBackups(id), can);
            wireBackups(slot, id, can);
          } else if (what === 'worlds') {
            slot.innerHTML = worldsPane(await api.dash.panelWorlds(id), !!can.runCommands);
            wireWorlds(slot, id, !!can.runCommands);
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

// Navigating and editing. Re-renders the pane in place on each hop rather than
// keeping a tree in memory — a directory listing is cheap and the alternative is
// a cache that goes stale the moment somebody uploads something.
function wireFiles(slot, id, can) {
  const canWrite = !!can.runCommands;

  slot.querySelectorAll('[data-cd]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        slot.innerHTML = filesPane(await api.dash.panelFiles(id, btn.dataset.cd), canWrite);
        wireFiles(slot, id, can);
      } catch (err) {
        btn.disabled = false;
        slot.insertAdjacentHTML('beforeend', `<div class="empty">${esc(panelErr(err))}</div>`);
      }
    }),
  );

  const editor = slot.querySelector('[data-editor]');
  slot.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const path = btn.dataset.open;
      editor.innerHTML = pageLoader();
      try {
        const { content } = await api.dash.panelFile(id, path);
        editor.innerHTML = editorPane(path, content, canWrite);
        wireEditor(editor, id, path, canWrite);
      } catch (err) {
        editor.innerHTML = `<div class="empty">${esc(panelErr(err))}</div>`;
      }
    }),
  );
}

function wireEditor(editor, id, path, canWrite) {
  const msg = editor.querySelector('[data-filemsg]');
  editor.querySelector('[data-closefile]')?.addEventListener('click', () => { editor.innerHTML = ''; });

  editor.querySelector('[data-savefile]')?.addEventListener('click', async (e) => {
    const body = editor.querySelector('[data-filebody]').value;
    if (!await confirmDanger(
      'Save this file?',
      `${path} is overwritten on the server. Most configs are only read at startup, so this usually needs a restart to take effect.`,
      'Save it',
    )) return;
    const btn = e.currentTarget;
    btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Writing…';
    try {
      await api.dash.panelWriteFile(id, path, body);
      msg.className = 'fmsg ok'; msg.textContent = 'Written.';
    } catch (err) { msg.className = 'fmsg bad'; msg.textContent = panelErr(err); }
    finally { btn.disabled = false; }
  });
}

function wireConsole(slot, id) {
  const msg = slot.querySelector('[data-logmsg]');

  slot.querySelector('[data-reloadlog]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const d = await api.dash.panelLogs(id);
      slot.innerHTML = consolePane(d);
      wireConsole(slot, id);
    } catch (err) { msg.className = 'fmsg bad'; msg.textContent = panelErr(err); btn.disabled = false; }
  });

  slot.querySelector('[data-sharelog]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Uploading…';
    try {
      const { url } = await api.dash.panelShareLogs(id);
      if (url) {
        msg.className = 'fmsg ok';
        msg.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener" data-ext>${esc(url)}</a>`;
      } else {
        msg.className = 'fmsg';
        msg.textContent = 'Uploaded, but the panel returned no link.';
      }
    } catch (err) { msg.className = 'fmsg bad'; msg.textContent = panelErr(err); }
    finally { btn.disabled = false; }
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
