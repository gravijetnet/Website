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
import { ask } from './modal.js';

// The prefix Phoenix puts in front of its own staff alerts. Kept here only so
// the preview matches what the game will actually print; the plugin is what
// applies it, and it is the core that sends the line.
const ALERT_PREFIX = '&8[&4Alert&8] &r';

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
      <p class="rule-text re-hint" id="bchint"></p>
      <div class="re-flags">
        <label class="re-flag"><input type="checkbox" id="bcgame" checked> In game</label>
        <label class="re-flag"><input type="checkbox" id="bcdisc"> To Discord</label>
      </div>
      <div class="prow">
        <select class="fld" id="bckind">
          <option value="all">Everyone — a network-wide announcement</option>
          <option value="staff">Staff alert — the core’s own</option>
        </select>
        <input class="fld" id="bcchan" list="bcchanpool" placeholder="Discord channel id" autocomplete="off" hidden>
        <button class="btn btn-primary" id="bcsend">Send</button>
        <span class="fmsg" id="bcm"></span>
      </div>
      <datalist id="bcchanpool"></datalist>
    </div></section>
    <div class="block">
      <div class="block-label">Recently sent</div>
      <div class="board" id="bclist">${(data.broadcasts || []).map(bcRow).join('') || '<div class="empty">Nothing sent yet.</div>'}</div>
    </div>`;

  const input = root.querySelector('#bcmsg');
  const prev = root.querySelector('#bcprev');
  const kindSel = root.querySelector('#bckind');
  const hint = root.querySelector('#bchint');
  const gameOn = root.querySelector('#bcgame');
  const discOn = root.querySelector('#bcdisc');
  const chan = root.querySelector('#bcchan');

  // The channel field only exists when it is relevant, and the known channels
  // are offered by name so nobody goes hunting for an id in Discord.
  const syncTargets = () => {
    kindSel.hidden = !gameOn.checked;
    chan.hidden = !discOn.checked;
  };
  gameOn.addEventListener('change', syncTargets);
  discOn.addEventListener('change', () => {
    syncTargets();
    if (discOn.checked && !chan.dataset.loaded) {
      chan.dataset.loaded = '1';
      api.dash.discordChannels()
        .then(({ channels }) => {
          root.querySelector('#bcchanpool').innerHTML = (channels || [])
            .map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');
        })
        .catch(() => { /* an id typed by hand still works */ });
    }
  });
  syncTargets();

  // A staff alert is prefixed by the core, so the preview shows it prefixed —
  // otherwise you are composing one line and sending another.
  const redraw = () => {
    const staffKind = kindSel.value === 'staff';
    const line = (staffKind ? ALERT_PREFIX : '') + input.value;
    prev.innerHTML = input.value ? mcPreview(line) : '<span class="dr">Preview appears here.</span>';
    hint.textContent = staffKind
      ? 'Sent through Phoenix’s own staff channel, so it reaches staff on every server and proxy.'
      : 'Shown once to every player on every server.';
  };
  input.addEventListener('input', redraw);
  kindSel.addEventListener('change', redraw);
  redraw();

  const btn = root.querySelector('#bcsend');
  const msg = root.querySelector('#bcm');
  btn.addEventListener('click', async () => {
    const message = input.value.trim();
    if (!message) { msg.className = 'fmsg bad'; msg.textContent = 'Type a message first.'; return; }
    const kind = root.querySelector('#bckind').value;

    // Both halves at once, when both are ticked.
    if (gameOn.checked && discOn.checked) {
      const channelId = chan.value.trim();
      if (!channelId) { msg.className = 'fmsg bad'; msg.textContent = 'Which Discord channel?'; return; }
      if (!await ask({
        title: 'Send this to the game and to Discord?',
        body: message,
        confirmLabel: 'Send both',
      })) return;
      btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Sending…';
      try {
        const out = await api.dash.announce({ message, game: kind, channelId });
        const bits = [];
        bits.push(out.game?.ok ? 'game: sent' : `game: ${out.game?.error || 'failed'}`);
        bits.push(out.discord?.ok ? 'Discord: sent' : `Discord: ${out.discord?.error || 'failed'}`);
        const allOk = out.game?.ok && out.discord?.ok;
        msg.className = `fmsg ${allOk ? 'ok' : 'bad'}`;
        msg.textContent = bits.join(' · ');
        if (allOk) setTimeout(() => renderBroadcast(root), 900);
      } catch (err) {
        msg.className = 'fmsg bad';
        msg.textContent = err?.body?.error === 'no_target' ? 'Pick at least one place to send it.' : 'That did not send.';
      } finally { btn.disabled = false; }
      return;
    }

    // Discord only.
    if (discOn.checked && !gameOn.checked) {
      const channelId = chan.value.trim();
      if (!channelId) { msg.className = 'fmsg bad'; msg.textContent = 'Which Discord channel?'; return; }
      if (!await ask({ title: 'Post this to Discord?', body: message, confirmLabel: 'Post' })) return;
      btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Sending…';
      try {
        const out = await api.dash.announce({ message, channelId });
        msg.className = out.discord?.ok ? 'fmsg ok' : 'fmsg bad';
        msg.textContent = out.discord?.ok ? 'Posted to Discord.' : `Discord: ${out.discord?.error || 'failed'}`;
      } catch { msg.className = 'fmsg bad'; msg.textContent = 'That did not send.'; }
      finally { btn.disabled = false; }
      return;
    }

    if (!gameOn.checked) { msg.className = 'fmsg bad'; msg.textContent = 'Pick at least one place to send it.'; return; }
    if (!await ask({
      title: kind === 'staff' ? 'Send this alert to all staff?' : 'Send this to everyone in game?',
      body: message,
      confirmLabel: 'Send',
    })) return;
    btn.disabled = true; msg.className = 'fmsg'; msg.textContent = 'Sending…';
    try {
      const res = await api.dash.broadcast(kind, message);
      // An alert is handed to the core, so it is watched to its end like any
      // other queued job — "sent" has to mean the core sent it, not that we
      // wrote a row down.
      if (res.via === 'alert') {
        const row = await awaitAlert(res.id, msg);
        if (row.status === 'done') {
          msg.className = 'fmsg ok'; msg.textContent = 'Alert sent through the core.';
          setTimeout(() => renderBroadcast(root), 800);
        } else if (row.status === 'failed') {
          msg.className = 'fmsg bad';
          msg.textContent = `The core refused it: ${row.result || 'no reason given'}`;
          btn.disabled = false;
        } else {
          msg.className = 'fmsg bad';
          msg.textContent = 'No server picked it up — is one online?';
          btn.disabled = false;
        }
        return;
      }
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

// The alert rides the same queue a ban does, so it is watched the same way.
async function awaitAlert(jobId, msg) {
  for (let i = 0; i < 15; i++) {
    let row;
    try { row = await api.dash.action(jobId); } catch { return { status: 'unknown' }; }
    if (row.status === 'done' || row.status === 'failed') return row;
    if (msg) msg.textContent = 'Waiting for the core…';
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'pending' };
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
