// The Discord half of the console.
//
// The website holds no bot token and should not, so nothing here talks to
// Discord — it asks the bot to, and watches the answer. That is the same
// arrangement as the game side: whichever half holds the credentials is the half
// that acts, and this one only ever writes down what it wants.
//
// Discord's own rules still apply on the far side. When the bot cannot kick
// somebody because they sit above it in the role order, that is what comes back,
// because "check role order" is a sentence you can act on and "failed" is not.
import { api } from './api.js';
import { esc } from './util.js';
import { pageLoader, notice } from './components.js';

const ERR = {
  bad_channel: 'That is not a channel id.',
  bad_member: 'That is not a Discord user id.',
  bad_action: 'That is not something the bot does.',
  bad_minutes: 'A timeout is between 0 minutes and four weeks.',
  message_required: 'Type a message first.',
  reason_required: 'A reason is required — Discord records it too.',
  not_yourself: 'That is you.',
  target_outranks_you: 'They outrank you here.',
  forbidden: 'Your rank does not allow that.',
  bot_missing: 'The bot has not been deployed with this yet.',
  not_linked: 'That account has no link to break.',
};
const err = (e) => ERR[e?.body?.error] || 'That did not go through.';

// The bot's answer is the real one, so every action is watched to its end.
async function watchTask(taskId, msg) {
  for (let i = 0; i < 15; i++) {
    let row;
    try { row = await api.dash.discordTask(taskId); } catch { return { status: 'unknown' }; }
    if (row.status === 'done' || row.status === 'failed') return row;
    if (msg) msg.textContent = 'Waiting for the bot…';
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: 'pending' };
}

function report(msg, row, doneText) {
  if (row.status === 'done') { msg.className = 'fmsg ok'; msg.textContent = `${doneText} (${row.result || 'ok'})`; return true; }
  if (row.status === 'failed') { msg.className = 'fmsg bad'; msg.textContent = `The bot could not: ${row.result || 'no reason given'}`; return false; }
  msg.className = 'fmsg bad';
  msg.textContent = 'The bot did not pick it up — is it running?';
  return false;
}

export async function renderDiscord(root, can) {
  root.innerHTML = pageLoader();
  let channels = [];
  try {
    ({ channels } = await api.dash.discordChannels());
  } catch {
    root.innerHTML = notice('Discord unavailable', 'Could not reach the Discord side.');
    return;
  }

  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Discord</h2>
        <p>Post into a channel, or moderate a member. The bot does all of it — this only asks, and tells you exactly what it said back.</p>
      </div>
    </div>

    <details class="rank-ed" open>
      <summary><span class="re-name">Post a message</span></summary>
      <div class="re-body">
        <div class="re-grid">
          <label class="re-field"><span class="re-lab">Channel</span>
            <input class="fld" id="dchan" list="dchanpool" placeholder="Channel id" autocomplete="off">
          </label>
          <label class="re-field"><span class="re-lab">Title — embeds only</span>
            <input class="fld" id="dtitle" maxlength="200" placeholder="Optional">
          </label>
        </div>
        <label class="re-field"><span class="re-lab">Message</span>
          <textarea class="fld" id="dmsg" rows="4" maxlength="1900" placeholder="What to post"></textarea>
        </label>
        <div class="re-flags">
          <label class="re-flag"><input type="checkbox" id="dembed"> Send as an embed</label>
        </div>
        <div class="factions">
          <button class="btn btn-primary" id="dsend">Post</button>
          <span class="fmsg" id="dmsgm"></span>
        </div>
        <p class="rule-text re-hint">An embed is footed with this console and your name, so nobody has to guess where a post came from.</p>
      </div>
    </details>

    <details class="rank-ed">
      <summary><span class="re-name">Moderate a member</span></summary>
      <div class="re-body">
        <div class="re-grid">
          <label class="re-field"><span class="re-lab">Discord user id</span>
            <input class="fld" id="dmid" placeholder="From the Users tab" autocomplete="off">
          </label>
          <label class="re-field"><span class="re-lab">Timeout — minutes, 0 clears</span>
            <input class="fld" type="number" id="dmins" value="60" min="0" max="40320">
          </label>
        </div>
        <label class="re-field"><span class="re-lab">Reason</span>
          <input class="fld" id="dreason" maxlength="200" placeholder="Discord records this too">
        </label>
        <div class="factions">
          <button class="btn" data-daction="timeout">Time out</button>
          <button class="btn" data-daction="kick">Kick</button>
          ${can.banPlayers ? '<button class="btn btn-danger" data-daction="ban">Ban</button>' : ''}
          <span class="fmsg" id="dmm"></span>
        </div>
        <p class="rule-text re-hint">You cannot act on somebody whose rank here is at or above your own, and Discord will still refuse anyone above the bot in its own role order.</p>
      </div>
    </details>

    <datalist id="dchanpool">${channels.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</datalist>`;

  wireDiscord(root);
}

function wireDiscord(root) {
  const send = root.querySelector('#dsend');
  const smsg = root.querySelector('#dmsgm');
  send.addEventListener('click', async () => {
    const channelId = root.querySelector('#dchan').value.trim();
    const message = root.querySelector('#dmsg').value.trim();
    if (!channelId) { smsg.className = 'fmsg bad'; smsg.textContent = 'Which channel?'; return; }
    if (!message) { smsg.className = 'fmsg bad'; smsg.textContent = 'Type a message first.'; return; }
    const embed = root.querySelector('#dembed').checked;
    if (!confirm(`Post this to ${channelId}?`)) return;
    send.disabled = true; smsg.className = 'fmsg'; smsg.textContent = 'Asking the bot…';
    try {
      const { taskId } = await api.dash.discordMessage({
        channelId, message, embed, title: root.querySelector('#dtitle').value.trim(),
      });
      if (report(smsg, await watchTask(taskId, smsg), 'Posted.')) root.querySelector('#dmsg').value = '';
    } catch (e) { smsg.className = 'fmsg bad'; smsg.textContent = err(e); }
    finally { send.disabled = false; }
  });

  const mmsg = root.querySelector('#dmm');
  root.querySelectorAll('[data-daction]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const action = btn.dataset.daction;
      const discordId = root.querySelector('#dmid').value.trim();
      const reason = root.querySelector('#dreason').value.trim();
      if (!discordId) { mmsg.className = 'fmsg bad'; mmsg.textContent = 'Which member?'; return; }
      if (!reason) { mmsg.className = 'fmsg bad'; mmsg.textContent = 'A reason is required.'; return; }
      if (!confirm(`${action} that member?`)) return;
      btn.disabled = true; mmsg.className = 'fmsg'; mmsg.textContent = 'Asking the bot…';
      try {
        const { taskId } = await api.dash.discordMember({
          action, discordId, reason, minutes: Number(root.querySelector('#dmins').value),
        });
        report(mmsg, await watchTask(taskId, mmsg), 'Done.');
      } catch (e) { mmsg.className = 'fmsg bad'; mmsg.textContent = err(e); }
      finally { btn.disabled = false; }
    }),
  );
}
