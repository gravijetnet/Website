// UI sound: the game's menu click, and nothing else.
//
// The file is a WAV, not the MP3 it was cut from: at 83ms an MP3's encoder delay
// can put silence in front of the transient, and the whole job of this sound is
// to land the instant you press.

// Resolved against this module's own URL, so it follows the versioned asset
// directory instead of pinning the unversioned copy.
const SRC = new URL('../sfx/click.wav', import.meta.url).href;

let ctx = null;
let master = null;
let buf = null;
let armed = false;

// Browsers refuse to start an AudioContext before a gesture, and would only warn
// if we tried. Capture, so this runs before the handlers that actually play.
['pointerdown', 'keydown'].forEach((ev) =>
  addEventListener(ev, () => { armed = true; }, { once: true, capture: true }),
);

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
    if (!armed) return;
    boot();
    if (!ctx || !buf) return;
    if (ctx.state === 'suspended') ctx.resume();
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(master);
    s.start(ctx.currentTime);
  },
};
