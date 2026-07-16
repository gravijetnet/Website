// UI sound.
//
// Minecraft's whole interface runs on ONE sound — ui.button.click — and when the
// game wants a different meaning it repitches rather than adding a sample. So do
// we: a single synthesised tick, played at four pitches. Nothing here is sampled
// from the game; it's two oscillators and a noise burst, so there's no Mojang
// audio in the repo and nothing to load over the network.
//
// A tick is a transient (band-passed noise — the part your ear reads as "click")
// plus a fast downward blip (the wooden body). Either alone sounds wrong: noise
// on its own is a hiss, the blip on its own is a beep.

const KEY = 'gj-sound';

let ctx = null;
let master = null;
let noise = null;
let armed = false;
let on = localStorage.getItem(KEY) !== 'off';

// A route can fail on first paint — landing straight on a 404 would try to play
// the deny tick before the visitor has touched anything, which browsers refuse
// and then warn about in the console. So nothing sounds until a real gesture.
// Capture, so this runs before the handlers that actually play.
['pointerdown', 'keydown'].forEach((ev) =>
  addEventListener(ev, () => { armed = true; }, { once: true, capture: true }),
);

export function makeNoise(ac) {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.1), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// The voice, built into whichever context it's handed. Kept free of the module's
// own context so an OfflineAudioContext can render and measure the real thing —
// nobody here can hear it, and a copy of this code in a test would prove nothing.
export function voice(ac, out, noiseBuf, t, pitch = 1, gain = 0.5) {
  const n = ac.createBufferSource();
  n.buffer = noiseBuf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1700 * pitch;
  bp.Q.value = 0.9;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(gain * 0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  n.connect(bp).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.05);

  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(880 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(240 * pitch, t + 0.04);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const og = ac.createGain();
  // Ramp up over 4ms rather than starting at full: a hard start adds its own
  // click on top of ours, and two clicks read as a crackle.
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(lp).connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.06);
}

// Built on the first tick, which is always inside a user gesture — browsers
// refuse to start an AudioContext any earlier.
function boot() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(ctx.destination);
  noise = makeNoise(ctx);
}

function tick(pitch = 1, gain = 0.5, delay = 0) {
  if (!on || !armed) return;
  boot();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  voice(ctx, master, noise, ctx.currentTime + delay, pitch, gain);
}

export const PITCH = { press: 1, select: 1.34, back: 0.76, deny: 0.5 };

export const sound = {
  press: () => tick(PITCH.press, 0.5),      // pushing a button
  select: () => tick(PITCH.select, 0.42),   // a step up: changing a tab or filter
  back: () => tick(PITCH.back, 0.42),       // a step down: going back
  deny: () => { tick(PITCH.deny, 0.42); tick(0.47, 0.3, 0.07); },  // nothing there

  get on() { return on; },

  toggle() {
    on = !on;
    localStorage.setItem(KEY, on ? 'on' : 'off');
    if (on) tick(PITCH.press, 0.5); // so you hear that it's back
    return on;
  },
};
