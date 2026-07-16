// UI sound: the game's menu click, and nothing else.
//
// Minecraft's whole interface runs on one sound at one pitch — press a button,
// hear ui.button.click. So there are no variations here either: no repitching
// for tabs, no lower note for "back", no buzz for a 404. Those were inventions,
// and each one was a way of not sounding like the game.
//
// The file is a WAV, not the MP3 it was cut from: at 83ms an MP3's encoder
// delay can put silence in front of the transient, and the entire job of this
// sound is to land the instant you press. Uncompressed mono costs 7KB, which is
// less than the argument against it.

const KEY = 'gj-sound';
// Resolved against this module's own URL, so it follows the versioned asset
// directory automatically instead of pinning the unversioned copy.
const SRC = new URL('../sfx/click.wav', import.meta.url).href;

let ctx = null;
let master = null;
let buf = null;
let armed = false;
let on = localStorage.getItem(KEY) !== 'off';

// Browsers refuse to start an AudioContext before a gesture, and would only warn
// if we tried. Capture, so this runs before the handlers that actually play.
['pointerdown', 'keydown'].forEach((ev) =>
  addEventListener(ev, () => { armed = true; }, { once: true, capture: true }),
);

// Built on the first click, which is always inside a user gesture.
function boot() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  // Async: the first press or two may be silent, every one after is not.
  fetch(SRC, { cache: 'force-cache' })
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
    .then((b) => ctx.decodeAudioData(b))
    .then((decoded) => { buf = decoded; })
    .catch(() => { /* no file, or undecodable: the interface is simply silent */ });
}

export const sound = {
  click() {
    if (!on || !armed) return;
    boot();
    if (!ctx || !buf) return;
    if (ctx.state === 'suspended') ctx.resume();
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(master);
    s.start(ctx.currentTime);
  },

  get on() { return on; },

  toggle() {
    on = !on;
    localStorage.setItem(KEY, on ? 'on' : 'off');
    if (on) this.click(); // so you hear that it's back
    return on;
  },
};
