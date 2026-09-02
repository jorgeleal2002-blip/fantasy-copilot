/**
 * The noises the draft room makes.
 *
 * Two kinds, and the split is deliberate.
 *
 * THE MOMENTS ARE CLIPS. Eight of them, cut from files handed over for this
 * app, across six moments: taking somebody, being on the clock, being sniped,
 * a reach, a run on a position, and the end of the draft. The first three
 * happen often enough to hold two apiece and alternate; the closing line is
 * also half of your own pick, because it is worth more than once a draft. Under two seconds and around ten
 * kilobytes each, fetched once and decoded once, then played from memory — so
 * nothing touches the network at the moment a pick lands, which is the only
 * thing that ever made a sound arrive late.
 *
 * THE METRONOME IS SYNTHESISED. An ordinary pick reveals every 850ms and a
 * kicker comes off the board twenty times in the last rounds; a second and a
 * half of music on each of those is not a draft room, it is a wall. Those two
 * stay oscillators and envelopes, built in the moment, weighing nothing.
 *
 * The synth is also the safety net: a clip that has not finished decoding, or
 * never arrived because the first launch was offline, falls back to the voice
 * it replaced rather than to silence.
 */

import ballerinaUrl from '../assets/ballerina.mp3';
import bombardinoUrl from '../assets/bombardino.mp3';
import brainrotUrl from '../assets/brainrot.mp3';
import chillguyUrl from '../assets/chillguy.mp3';
import chimpanziniUrl from '../assets/chimpanzini.mp3';
import gotthisUrl from '../assets/gotthis.mp3';
import patapimUrl from '../assets/patapim.mp3';
import siuUrl from '../assets/siu.mp3';

export type SfxName = 'tick' | 'coin' | 'boom' | 'horn' | 'pipe' | 'womp' | 'tung' | 'done';

/**
 * Which moment gets which clip.
 *
 * `tick` and `pipe` are deliberately absent — those are the two that fire over
 * and over, and they stay short. Everything here happens a handful of times in
 * a draft, which is what earns a second and a half.
 *
 * A moment can have MORE THAN ONE, and takes them in turn. The three that
 * repeat — your pick, your turn, and being sniped — each hold two, because one
 * line said fifteen times stops being a celebration somewhere around the
 * fourth, and two taking turns is the cheapest fix there is.
 */
export type ClipName =
  | 'siu' | 'gotthis' | 'patapim' | 'bombardino'
  | 'brainrot' | 'chillguy' | 'chimpanzini' | 'ballerina';

const CLIP_URL: Record<ClipName, string> = {
  siu: siuUrl,
  gotthis: gotthisUrl,
  patapim: patapimUrl,
  bombardino: bombardinoUrl,
  brainrot: brainrotUrl,
  chillguy: chillguyUrl,
  chimpanzini: chimpanziniUrl,
  ballerina: ballerinaUrl,
};

const CLIPS: Partial<Record<SfxName, ClipName[]>> = {
  coin: ['siu', 'gotthis'],             // you took somebody
  horn: ['patapim', 'bombardino'],      // you are on the clock
  womp: ['brainrot', 'chillguy'],       // they took the one you were told to take
  boom: ['chimpanzini'],                // a reach, from well down the board
  tung: ['ballerina'],                  // three of a position in a row
  done: ['gotthis'],                    // the board is drafted out, and that is your team
};



type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;

/**
 * Tell iOS this is playback, not a UI blip.
 *
 * Safari 16.4 added a way to say what audio is FOR. Without it an installed
 * copy obeys the ringer switch, which most people leave on — no error, no
 * event, the sound simply does not happen. The opening clip has said this
 * since the day it was written; the draft room never did, which is one of the
 * two reasons a home-screen copy was silent while the same page in Safari was
 * not. Where the API does not exist this does nothing.
 */
function askToBeHeard(): void {
  try {
    const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (s) s.type = 'playback';
  } catch {
    /* not supported — the ringer switch wins, and nothing else breaks */
  }
}

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
    /* Measured, not turned up by feel. Rendering a room at real speed with the
     * loud ones deliberately next to each other: at 0.55 the whole run peaked
     * at 0.66 and left a third of the scale unused, which on a phone speaker in
     * a room with other people in it is a sound you have to be listening for.
     * At 0.8 it peaks at 0.885 with nothing clipped and the limiter shaving
     * under a decibel off the single loudest moment — which is the one job a
     * limiter has. Past that it starts doing real work and the loud sounds stop
     * being louder than the quiet ones, so this is where it stops. */
    bus.gain.value = 0.8;
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
  if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  return bus ? { c: ctx, out: bus } : null;
}

/** Whether the unlock below has actually run and taken. */
let unlocked = false;

/**
 * Wake the audio up, from inside a real tap.
 *
 * This is the other reason a home-screen copy was silent. In a browser tab the
 * page's own activation carries: touch anything and a context created later
 * will run. Installed on the home screen it does not — the context has to be
 * resumed DURING a gesture, and a resume from a React effect four hundred
 * milliseconds after a pick landed is not during anything.
 *
 * Resuming is also not sufficient on its own. iOS will report the context
 * "running" and still produce nothing until something has actually been played
 * through it, so this plays one silent frame. It costs nothing and it is the
 * only version of this that works.
 */
/**
 * The decoded clips, and the one attempt to get them.
 *
 * Loading is hung off arming rather than off module load, because a context is
 * needed to decode into and the context is not allowed to exist until somebody
 * has touched the screen. It runs once; a clip that fails simply stays absent
 * and its synthesised voice covers for it.
 */
const clips: Partial<Record<ClipName, AudioBuffer>> = {};
let loading = false;

function loadClips(c: BaseAudioContext): void {
  if (loading) return;
  loading = true;
  // A clip can appear under two moments; decode it once and share the buffer.
  const names = Array.from(new Set(Object.values(CLIPS).flat())) as ClipName[];
  names.forEach(name => {
    const url = CLIP_URL[name];
    void fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('http ' + r.status))))
      // The callback form as well as the promise: older WebKit rejects the
      // promise-only call, and this is the browser that matters here.
      .then(buf => new Promise<AudioBuffer>((ok, no) => {
        const p = c.decodeAudioData(buf, ok, no);
        if (p && typeof p.then === 'function') void p.then(ok, no);
      }))
      .then(b => { clips[name] = b; })
      .catch(() => { /* the voice it replaced still plays */ });
  });
}

/** How many times each moment has been heard, so its clips take turns. */
const turn: Partial<Record<SfxName, number>> = {};

/** The next clip for this moment, or null while none of them has decoded. */
function nextClip(name: SfxName): ClipName | null {
  const list = CLIPS[name];
  if (!list || !list.length) return null;
  // Only the ones that arrived are in the rotation, so a slow decode shifts
  // nothing: it simply joins once it is ready.
  const ready = list.filter(n => clips[n]);
  if (!ready.length) return null;
  const n = turn[name] || 0;
  turn[name] = n + 1;
  return ready[n % ready.length];
}

export function armSfx(): void {
  askToBeHeard();
  const a = audio();
  if (!a) return;
  void a.c.resume().catch(() => undefined);
  loadClips(a.c);
  try {
    const src = a.c.createBufferSource();
    src.buffer = a.c.createBuffer(1, 1, a.c.sampleRate);
    src.connect(a.c.destination);
    src.start(0);
    unlocked = true;
  } catch {
    /* it will be tried again on the next tap */
  }
}

/* Any of these counts as a tap somewhere. `touchstart` also begins a scroll,
 * which does not always count as activation, so the ones that always do are
 * listened for too and the first to arrive wins. */
const GESTURES: (keyof WindowEventMap)[] = [
  'pointerdown', 'pointerup', 'touchend', 'click', 'keydown',
];

/**
 * Arm on the first tap anywhere, and again whenever the app comes back.
 *
 * Resuming an installed app does not reload it: React never mounts again, and
 * the context it left behind comes back interrupted. Re-arming on the way in
 * costs one silent frame.
 */
export function readySfx(): void {
  if (typeof window === 'undefined') return;
  const once = () => {
    armSfx();
    if (unlocked) GESTURES.forEach(e => removeEventListener(e, once));
  };
  GESTURES.forEach(e => addEventListener(e, once, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    askToBeHeard();
    void ctx?.resume().catch(() => undefined);
    // and let the next tap re-arm, in case the resume was refused
    unlocked = false;
    GESTURES.forEach(e => addEventListener(e, once, { passive: true }));
  });
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

/**
 * Three hits on a wooden drum. Tung, tung, tung.
 *
 * Of the sounds that get asked for by name, this is the one that is physics
 * rather than a performance: a struck piece of wood, which is a short pitched
 * thump with a knock of filtered noise on the front and almost no sustain. The
 * third lands lower and rings longer, the way the last of three does.
 *
 * The ones that are a voice singing, or a song, are not here and will not be:
 * they are not here, and a set with no way to change it is better than a
 * half of one nobody can reach.
 */
function tung(c: BaseAudioContext, out: AudioNode, t: number) {
  const hit = (at: number, f: number, v: number, d: number) => {
    const o = c.createOscillator();
    o.type = 'sine';
    // The pitch drops into the note instead of starting on it. A drum skin is
    // tightest at the moment it is struck; hold the note flat and it is a bell.
    o.frequency.setValueAtTime(f * 1.7, at);
    o.frequency.exponentialRampToValueAtTime(f, at + 0.045);
    const g = c.createGain();
    shape(g, at, v, 0.004, d);
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + d + 0.05);

    const n = noise(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150;
    bp.Q.value = 1.2;
    const ng = c.createGain();
    ng.gain.setValueAtTime(v * 0.45, at);
    ng.gain.exponentialRampToValueAtTime(NEAR_ZERO, at + 0.035);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(at); n.stop(at + 0.05);
  };
  hit(t, 152, 0.5, 0.2);
  hit(t + 0.17, 152, 0.44, 0.2);
  hit(t + 0.34, 118, 0.55, 0.45);
}

type Voice = (c: BaseAudioContext, out: AudioNode, t: number) => void;

/* `done` has no voice of its own: before it had a clip it WAS the womp, which
 * is also what covers for it if the clip never decodes. */
const VOICES: Record<SfxName, Voice> = { tick, coin, boom, horn, pipe, womp, tung, done: womp };

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

/**
 * The clip that is playing, so the next one can cut it off.
 *
 * A second and a half is long enough that two of them can overlap, and two
 * pieces of music at once is noise rather than two events. The newest thing
 * that happened is the one worth hearing, so it takes the channel.
 */
let playing: AudioBufferSourceNode | null = null;

/**
 * Make the noise, and say which one it was.
 *
 * The screen has to agree with the speaker — a card that names one character
 * over the sound of another is worse than no card — so the choice of clip is
 * made here, once, and handed back rather than guessed at by the caller.
 * Null when what played was a synthesised voice, which has nothing to draw.
 */
export function playSfx(name: SfxName): ClipName | null {
  const now = Date.now();
  if (name === 'tick' && now - lastAt < FLOOR_MS) return null;
  const a = audio();
  if (!a) return null;
  lastAt = now;
  try {
    const clip = nextClip(name);
    const buf = clip ? clips[clip] : null;
    if (buf) {
      try { playing?.stop(); } catch { /* already finished */ }
      const src = a.c.createBufferSource();
      src.buffer = buf;
      src.connect(a.out);
      src.onended = () => { if (playing === src) playing = null; };
      src.start(0);
      playing = src;
      return clip;
    }
    // Not decoded yet, or never arrived: the voice it replaced covers for it.
    VOICES[name](a.c, a.out, a.c.currentTime);
  } catch {
    /* a context that died with the tab. The room does not stop for it. */
  }
  return null;
}
