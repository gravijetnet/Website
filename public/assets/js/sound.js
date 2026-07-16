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
//
// Two struck resonators, no oscillator. The first version swept a triangle from
// 880Hz to 240Hz, which is why it read as a synth blip: a pitch glide is a
// melodic gesture and the game's click has no melody in it. What it has is wood
// — a hard transient plus a short resonance — and the way you get wood is to hit
// a filter with noise and let it ring, not to play a note.
export function voice(ac, out, noiseBuf, t, pitch = 1, gain = 0.5) {
  // One lowpass across the whole voice. A bandpass only slopes away from its
  // centre, it doesn't wall anything off, so enough of the noise's top end
  // survives to turn the click into a hiss — measured at 41% of the energy above
  // 6kHz before this existed. Wood has no sizzle.
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4800 * pitch;
  lp.Q.value = 0.7;
  lp.connect(out);

  // A narrow bandpass throws away most of white noise's energy, so `level` runs
  // well above 1 to pay that back — these aren't mix levels, they're what's left
  // after the filter.
  const strike = (freq, q, decay, level) => {
    const n = ac.createBufferSource();
    n.buffer = noiseBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * pitch;
    bp.Q.value = q;
    const g = ac.createGain();
    // Ramp up over 2ms rather than starting at full: a hard start adds its own
    // click on top of ours, and two clicks read as a crackle.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    n.connect(bp).connect(g).connect(lp);
    n.start(t);
    n.stop(t + decay + 0.01);
  };

  strike(2400, 1.2, 0.014, 2.7); // the tick — the part you hear as "click"
  strike(560, 4.5, 0.055, 8.5);  // the body — rings just long enough to be wood
}

// If a click has been placed at SAMPLE_URL, it wins over the synth. Nothing is
// shipped with the site and nothing is fetched from anywhere else: the file is
// absent unless someone puts it there, and 404 is a normal, expected answer.
// Whoever adds one is deciding they have the right to serve it.
const SAMPLE_URL = '/assets/sfx/click.ogg';
let sample = null;

async function loadSample(ac) {
  try {
    const r = await fetch(SAMPLE_URL, { cache: 'force-cache' });
    if (!r.ok) return null;
    sample = await ac.decodeAudioData(await r.arrayBuffer());
  } catch {
    /* no file, or not decodable: the synth stays. */
  }
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
  loadSample(ctx); // async — the first click or two may still be synthesised
}

function tick(pitch = 1, gain = 0.5, delay = 0) {
  if (!on || !armed) return;
  boot();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime + delay;

  if (!sample) return voice(ctx, master, noise, t, pitch, gain);

  // playbackRate repitches by resampling, which is what the game does to vary a
  // sound too — so the four pitches carry over to a real file unchanged.
  const s = ctx.createBufferSource();
  s.buffer = sample;
  s.playbackRate.value = pitch;
  // Same gain as the synth: a real click file is normalised, so master (0.45)
  // times this lands at ~0.22 peak — near where the synth measures anyway.
  const g = ctx.createGain();
  g.gain.value = gain;
  s.connect(g).connect(master);
  s.start(t);
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
