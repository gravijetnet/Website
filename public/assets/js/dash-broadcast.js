// Sending a message to everyone in game, from the console.
//
// The website only writes the line down; the plugin's Broadcaster shows it on
// every server once. So there is no job to watch here — a send either wrote the
// row or it did not. Colour codes with & are previewed as you type, because the
// difference between "&aup in 5" and the green line it becomes is the whole point.
import { api } from './api.js';
import { esc, timeAgo } from './util.js';
import { pageLoader, notice } from './components.js';
import { mcPreview } from './dash-network.js';

export async function renderBroadcast(root) {
  root.innerHTML = pageLoader();
  let data;
  try {
    data = await api.dash.broadcasts();
  } catch {
    root.innerHTML = notice('Broadcast unavailable', 'Could not load the broadcast history.');
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Broadcast</h2>
        <p>Send a message to everyone in game — it reaches every server. Colour codes with &amp; work.</p>
      </div>
    </div>
    ${data.installed ? '' : notice('Not deployed yet', 'The plugin build that shows broadcasts has not reached the servers yet. It goes out on the next deploy; until then a send is stored but nobody sees it.')}
    <section class="panel entry"><div class="panel-body">
      <label class="re-field"><span class="re-lab">Message</span>
        <input class="fld" id="bcmsg" placeholder="&aThe server restarts in 5 minutes." maxlength="512" autocomplete="off">
      </label>
      <div class="bcprev" id="bcprev"><span class="dr">Preview appears here.</span></div>
      <div class="prow">
        <select class="fld" id="bckind">
          <option value="all">Everyone</option>
          <option value="staff">Staff only</option>
        </select>
        <button class="btn btn-primary" id="bcsend">Send</button>
        <span class="fmsg" id="bcm"></span>
      </div>
    </div></section>
    <div class="block">
      <div class="block-label">Recently sent</div>
      <div class="board" id="bclist">${(data.broadcasts || []).map(bcRow).join('') || '<div class="empty">Nothing sent yet.</div>'}</div>
    </div>`;

  const input = root.querySelector('#bcmsg');
  const prev = root.querySelector('#bcprev');
  input.addEventListener('input', () => {
    prev.innerHTML = input.value ? mcPreview(input.value) : '<span class="dr">Preview appears here.</span>';
  });

  const btn = root.querySelector('#bcsend');
  const msg = root.querySelector('#bcm');
  btn.addEventListener('click', async () => {
    const message = input.value.trim();
    if (!message) { msg.className = 'fmsg bad'; msg.textContent = 'Type a message first.'; return; }
    const kind = root.querySelector('#bckind').value;
    if (!confirm(`Send this to ${kind === 'staff' ? 'all staff' : 'everyone'} in game?`)) return;
    btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Sending…';
    try {
      await api.dash.broadcast(kind, message);
      msg.className = 'fmsg ok'; msg.textContent = 'Sent to the network.';
      setTimeout(() => renderBroadcast(root), 800);
    } catch (err) {
      btn.disabled = false;
      msg.className = 'fmsg bad';
      msg.textContent = err?.body?.error === 'plugin_missing'
        ? 'The plugin is not deployed yet, so nobody would see it.'
        : err?.body?.error === 'message_required' ? 'Type a message first.' : 'That did not send.';
    }
  });
}

function bcRow(b) {
  return `
    <div class="board-row entry" style="grid-template-columns:1fr auto;gap:12px">
      <div style="min-width:0">
        <div class="dn">${mcPreview(b.message)}</div>
        <div class="dr">${esc(b.kind === 'staff' ? 'staff only' : 'everyone')}${b.actor_label ? ` · ${esc(b.actor_label)}` : ''}</div>
      </div>
      <div class="dr">${b.created_at ? timeAgo(b.created_at) : ''}</div>
    </div>`;
}
