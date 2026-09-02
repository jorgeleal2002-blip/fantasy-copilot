/**
 * The noises the draft room makes.
 *
 * Every one of them is SYNTHESISED — oscillators, a noise buffer and envelopes,
 * built at the moment it plays. Nothing is downloaded and nothing ships. Three
 * reasons, in order:
 *
 *  1. The obvious way to get these sounds is to take the files, and those files
 *     belong to somebody. The app already has one borrowed clip sitting in a
 *     public repository and does not need six more.
 *  2. A pick has to be heard the instant it lands. A fetched clip is a network
 *     request, a service worker, a decode and a range request — this session
 *     has already lost hours to exactly that path with a single 25 KB file.
 *     There is no path here: the sound is made in the moment.
 *  3. Six clips is a few hundred kilobytes on a phone. This is a few hundred
 *     bytes of code and weighs nothing.
 *
 * They are close cousins of the sounds they are named after rather than
 * copies, which is what you get for free when you build the thing out of the
 * physics instead of sampling it.
 */

export type SfxName = 'tick' | 'coin' | 'boom' | 'horn' | 'pipe' | 'womp';

const KEY = 'fc.sfx';

export const sfxOn = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

export const setSfxOn = (on: boolean): void => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode — the setting just does not persist */
  }
};

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;

/**
 * The context, made on first use and kept.
 *
 * A context created before the page has been touched starts suspended, so
 * every call asks it to resume: by the time anything in here plays you have
 * pressed Start, claimed a seat or drafted somebody, and any one of those is
 * the gesture the browser wanted.
 */
function audio(): { c: AudioContext; out: GainNode } | null {
  if (typeof window === 'undefined') return null;
  const C: Ctor | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!C) return null;
  if (!ctx) {
    try {
      ctx = new C();
    } catch {
      return null;
    }
    bus = ctx.createGain();
    bus.gain.value = 0.55;
    /* Insurance, not an effect. Measured one at a time nothing here comes near
     * full scale — the loudest single sample in the set is 0.57 — and a pick
     * lands every 420ms, by which point a boom has decayed to almost nothing.
     * What this catches is the Settings row, where six buttons can be hit as
     * fast as a finger moves. With this much headroom it never engages during
     * a draft, so it costs the sounds nothing. */
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3;
    lim.knee.value = 0;
    lim.ratio.value = 12;
    lim.attack.value = 0.002;
    lim.release.value = 0.12;
    bus.connect(lim);
    lim.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return bus ? { c: ctx, out: bus } : null;
}

/** One second of white noise, made once and re-read by every voice that wants
 *  a transient. Filling this per pick would allocate 48,000 floats a pick. */
let noiseBuf: AudioBuffer | null = null;
function noise(c: BaseAudioContext): AudioBufferSourceNode {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

/** A soft clip. The boom is a sine, and a pure sine at that volume is a hum;
 *  the grit is what makes it hit rather than swell. */
let grit: Float32Array<ArrayBuffer> | null = null;
function gritCurve(): Float32Array<ArrayBuffer> {
  if (grit) return grit;
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 2.2);
  }
  grit = c;
  return c;
}

/** Attack to a peak, then decay away. Exponential ramps cannot touch zero, so
 *  everything starts and ends at a value low enough to be silence. */
const NEAR_ZERO = 0.0001;
function shape(g: GainNode, t: number, peak: number, attack: number, decay: number, hold = 0) {
  g.gain.setValueAtTime(NEAR_ZERO, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  if (hold) g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(NEAR_ZERO, t + attack + hold + decay);
}

/* ── the voices ─────────────────────────────────────────────────────────── */

/** A pick landed. Deliberately almost nothing: this fires thirty times in a
 *  row at four hundred milliseconds apart, and anything with character in it
 *  would be unbearable by the third round. */
function tick(c: BaseAudioContext, out: AudioNode, t: number) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(360, t);
  o.frequency.exponentialRampToValueAtTime(170, t + 0.035);
  const g = c.createGain();
  shape(g, t, 0.26, 0.003, 0.075);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.11);
}

/**
 * The boom.
 *
 * A hundred and fifty hertz falling to thirty-six in a third of a second, an
 * octave below it for weight, a slap of low-passed noise on the front so it
 * starts rather than fades in, and the whole thing through a soft clip. The
 * falling pitch is the entire trick — a fixed low note is a hum, and the same
 * note sliding down is an impact.
 */
function boom(c: BaseAudioContext, out: AudioNode, t: number) {
  const shaper = c.createWaveShaper();
  shaper.curve = gritCurve();
  shaper.connect(out);

  const g = c.createGain();
  shape(g, t, 0.8, 0.006, 0.9);
  g.connect(shaper);

  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(36, t + 0.36);
  const sub = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(75, t);
  sub.frequency.exponentialRampToValueAtTime(24, t + 0.42);
  o.connect(g); sub.connect(g);

  const n = noise(c);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.5, t);
  ng.gain.exponentialRampToValueAtTime(NEAR_ZERO, t + 0.09);
  n.connect(lp); lp.connect(ng); ng.connect(out);

  o.start(t); sub.start(t); n.start(t);
  o.stop(t + 1); sub.stop(t + 1); n.stop(t + 0.12);
}

/** An air horn: three saws a few hertz apart so they beat against each other,
 *  the octave above them underneath, one vibrato shared by all five, and a
 *  hard gate at both ends. The beating is what makes it a horn and not a note. */
function horn(c: BaseAudioContext, out: AudioNode, t: number) {
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.connect(out);
  const g = c.createGain();
  shape(g, t, 0.5, 0.025, 0.12, 0.3);
  g.connect(lp);

  const lfo = c.createOscillator();
  lfo.frequency.value = 5.5;
  const lfoG = c.createGain();
  lfoG.gain.value = 7;
  lfo.connect(lfoG);

  [415, 440, 466, 831, 880].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const og = c.createGain();
    og.gain.value = i > 2 ? 0.12 : 0.3;
    lfoG.connect(o.detune);
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + 0.5);
  });
  lfo.start(t); lfo.stop(t + 0.5);
}

/**
 * The pipe.
 *
 * Six sines at ratios that are not whole numbers — 1 : 1.54 : 2.35 : 3.16 —
 * each dying faster than the one below it, with a band-passed crack on the
 * front. Whole-number ratios are what make a note; these are what make a piece
 * of metal, and the fast-dying top is what makes it hollow.
 */
function pipe(c: BaseAudioContext, out: AudioNode, t: number) {
  const parts: [number, number, number][] = [
    [412, 0.34, 0.55], [636, 0.24, 0.4], [968, 0.18, 0.3],
    [1302, 0.13, 0.2], [1974, 0.1, 0.14], [2841, 0.07, 0.1],
  ];
  parts.forEach(([f, v, d]) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = c.createGain();
    shape(g, t, v, 0.003, d);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + d + 0.05);
  });
  const n = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3400;
  bp.Q.value = 0.8;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.26, t);
  ng.gain.exponentialRampToValueAtTime(NEAR_ZERO, t + 0.04);
  n.connect(bp); bp.connect(ng); ng.connect(out);
  n.start(t); n.stop(t + 0.06);
}

/** Two square notes up a fourth, the second held while it fades. The oldest
 *  "you got the thing" sound there is. */
function coin(c: BaseAudioContext, out: AudioNode, t: number) {
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(988, t);
  o.frequency.setValueAtTime(1319, t + 0.075);
  const g = c.createGain();
  g.gain.setValueAtTime(NEAR_ZERO, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.008);
  g.gain.setValueAtTime(0.4, t + 0.075);
  g.gain.exponentialRampToValueAtTime(NEAR_ZERO, t + 0.55);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.6);
}

/** The sad trombone: one saw walking down four notes, sliding into each, under
 *  a resonant filter that takes the buzz off and leaves the brass. */
function womp(c: BaseAudioContext, out: AudioNode, t: number) {
  const o = c.createOscillator();
  o.type = 'sawtooth';
  [311, 277, 247, 208].forEach((f, i) => {
    const at = t + i * 0.19;
    o.frequency.setValueAtTime(f, at);
    o.frequency.linearRampToValueAtTime(f * 0.94, at + 0.17);
  });
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  lp.Q.value = 4;
  const g = c.createGain();
  shape(g, t, 0.3, 0.03, 0.28, 0.58);

  const lfo = c.createOscillator();
  lfo.frequency.value = 5;
  const lg = c.createGain();
  lg.gain.value = 9;
  lfo.connect(lg); lg.connect(o.detune);

  o.connect(lp); lp.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.95);
  lfo.start(t); lfo.stop(t + 0.95);
}

type Voice = (c: BaseAudioContext, out: AudioNode, t: number) => void;

const VOICES: Record<SfxName, Voice> = { tick, coin, boom, horn, pipe, womp };

/**
 * Draw one sound into any context at any time.
 *
 * `playSfx` is this aimed at the speakers. Kept separate because the same call
 * renders into an OfflineAudioContext, which is the only way to check what
 * these actually sound like without a pair of ears in the room: render it, read
 * the samples back, and measure whether the boom really falls in pitch and
 * whether any of them clip.
 */
export function renderSfx(name: SfxName, c: BaseAudioContext, out: AudioNode, t: number): void {
  VOICES[name](c, out, t);
}

/**
 * Nothing may start within this of the last thing.
 *
 * Picks reveal every four hundred milliseconds and a person can draft in the
 * middle of that, so two sounds can be asked for almost together. Two is fine;
 * two of the LOUD ones on top of each other is a clipped mess. The quiet tick
 * gives way, the rest never wait — a boom that arrives late is worse than a
 * tick that never arrives.
 */
const FLOOR_MS = 90;
let lastAt = 0;

export function playSfx(name: SfxName): void {
  if (!sfxOn()) return;
  const now = Date.now();
  if (name === 'tick' && now - lastAt < FLOOR_MS) return;
  const a = audio();
  if (!a) return;
  lastAt = now;
  try {
    VOICES[name](a.c, a.out, a.c.currentTime);
  } catch {
    /* a context that died with the tab. The room does not stop for it. */
  }
}
