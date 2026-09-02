import bootUrl from '../assets/boot.mp3';
import { armSfx, decodeUrl, playBuffer } from './sfx';

/**
 * The sound the app opens with.
 *
 * The hard part is not playing it, it is being allowed to. Every browser now
 * refuses to start audible sound before the person has touched the page —
 * iOS most strictly of all — so a plain `play()` on load is rejected, silently,
 * on exactly the devices this app is built for. Asking is still worth it: a
 * desktop tab the user has interacted with before, or a phone where they have
 * granted it, will start immediately.
 *
 * When it is refused the sound is not abandoned, it is ARMED: the first tap,
 * key or touch anywhere plays it and disarms the rest. In practice that is the
 * tap that signs you in, a second or two later, which is close enough to "when
 * it loads" to be what was asked for and is the only version of it that is
 * actually permitted.
 */

const KEY = 'fc.sound';

/**
 * Ask iOS to treat this as playback rather than as a UI blip.
 *
 * On an iPhone the ringer switch silences HTML audio outright — no error, no
 * event, the sound simply does not happen — and most people keep that switch
 * on. Safari 16.4 added a way to say what the audio is FOR, and "playback"
 * means it belongs to the content and should be heard like a video would be.
 * Where the API does not exist this does nothing, which is the old behaviour.
 */
function askToBeHeard(): void {
  try {
    const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (s) s.type = 'playback';
  } catch {
    /* not supported — the ringer switch wins, and nothing else breaks */
  }
}

export const soundOn = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

export const setSoundOn = (on: boolean): void => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode — the setting just does not persist */
  }
};

/**
 * How long away counts as having left.
 *
 * Coming back after glancing at a message is not opening the app, and a song
 * clip every time you flick between two apps would be unbearable. Coming back
 * after a while is opening it, and that is when this was asked to play.
 */
const AWAY_MS = 5 * 60 * 1000;

/** Held so it can be silenced later. `new Audio()` is never in the document,
 *  so looking for it with a DOM query finds nothing — which is how the Off
 *  switch came to do nothing at all the first time it was written. */
let playing: HTMLAudioElement | null = null;
/** Guards a double call in the same instant — React runs effects twice in dev. */
let starting = false;
let leftAt = 0;
let watching = false;

/* Broad on purpose. `touchstart` fires when a finger lands, which is also how
 * a scroll begins, and a scroll does not always count as the activation a
 * browser wants before it will make noise. `touchend` and `click` are the ones
 * that always do, so all of them are listened for and the first to arrive
 * wins. */
const EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown',
];

/**
 * What happened last time, kept so it can be read back.
 *
 * Two diagnoses of this have now been wrong, both made by reasoning from the
 * outside. The app records the outcome of every attempt instead, so the next
 * question is answered by looking rather than by guessing again.
 */
const LOG = 'fc.sound.last';
export type SoundOutcome = 'played' | 'waiting' | 'blocked' | 'nofile' | 'off';

function note(outcome: SoundOutcome): void {
  try {
    localStorage.setItem(LOG, JSON.stringify({ outcome, at: Date.now() }));
  } catch {
    /* private mode — the diagnosis just is not kept */
  }
}

export function lastSound(): { outcome: SoundOutcome; at: number } | null {
  try {
    const raw = localStorage.getItem(LOG);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const why = (e: DOMException | undefined): SoundOutcome =>
  (e?.name === 'NotAllowedError' ? 'blocked' : 'nofile');

/** Detail behind a failure, kept for the line in Settings. */
let failNote = '';
export const soundDetail = () => failNote;

/**
 * The audio, fetched once and held in memory.
 *
 * Handing a URL to an <audio> element makes it fetch on its own terms: byte
 * ranges, its own cache rules, its own path through the service worker. That
 * is three ways for 25 KB to not arrive, and the element reports every one of
 * them as the same useless "cannot play".
 *
 * A plain fetch has none of that. The file comes back as one ordinary
 * response, becomes a blob URL, and the element is handed something local that
 * cannot fail to load. It also fails LOUDLY: a status code is a real answer,
 * where a media element only ever shrugs.
 */
let srcReady: Promise<string> | null = null;
/**
 * The blob URL once it has arrived, so a gesture handler can use it WITHOUT
 * waiting.
 *
 * Waiting is what lost the sound on an installed copy. `play()` was called
 * inside a `.then()` — after the fetch resolved, which is after the tap that
 * triggered it has finished — and a home-screen app does not carry the page's
 * activation the way a browser tab does. The same mistake the draft room's
 * audio was making, in the other engine. Fetched up front, the tap can play it
 * on the spot.
 */
let srcUrl = '';

function source(): Promise<string> {
  if (srcReady) return srcReady;
  srcReady = fetch(bootUrl)
    .then(res => {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.blob();
    })
    .then(blob => {
      if (!blob.size) throw new Error('empty');
      srcUrl = URL.createObjectURL(blob);
      return srcUrl;
    })
    .catch(e => {
      // Fall back to letting the element try for itself rather than giving up.
      failNote = 'fetch: ' + (e as Error).message;
      return bootUrl;
    });
  return srcReady;
}

/**
 * Told when the clip actually starts, and how long it runs.
 *
 * The launch screen listens, so the picture can stay up for as long as the
 * sound does. They were on separate clocks before — a screen held for 1.15s
 * over a clip of 3.5s, which is most of the sound playing to an app that has
 * already moved on.
 */
type Heard = (seconds: number) => void;
const listeners: Heard[] = [];

export function onBootSound(fn: Heard): () => void {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

function announce(el: HTMLAudioElement): void {
  const secs = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
  listeners.slice().forEach(fn => { try { fn(secs); } catch { /* not our problem */ } });
}

/**
 * The clip, decoded for the engine that actually works on a phone.
 *
 * An installed copy has been silent all session with this playing through its
 * own `<audio>` element. That engine was never shown to work there; the draft
 * room's was — measured against a browser that refuses to resume audio outside
 * a tap, it put twelve sounds through the speakers where nothing else managed
 * one. So the opening clip goes through it now, and `<audio>` stays as the
 * fallback for anywhere Web Audio is missing.
 */
let decoded: AudioBuffer | null = null;
let decoding: Promise<void> | null = null;

function prepare(): Promise<void> {
  if (decoding) return decoding;
  decoding = decodeUrl(bootUrl).then(b => { decoded = b; });
  return decoding;
}

/** Play it through the draft room's engine. Returns false if it stayed silent,
 *  which is the case that has to wait for a tap. */
function playHere(): boolean {
  armSfx();
  const secs = playBuffer(decoded);
  if (!secs) return false;
  note('played');
  listeners.slice().forEach(fn => { try { fn(secs); } catch { /* not our problem */ } });
  return true;
}

/** Try it, and if the browser says no, wait for the first touch and try then. */
function start(): void {
  if (starting || typeof Audio === 'undefined') return;
  /* Recorded rather than returned silently. The switch being off and the
   * sound being broken produce the same silence, and the test button ignores
   * the switch — so "it stays quiet on open but the test plays" was the exact
   * shape of a setting nobody could see. Now the app says which it is. */
  if (!soundOn()) { note('off'); return; }
  starting = true;
  setTimeout(() => { starting = false; }, 0);
  askToBeHeard();
  // Started here so a tap arriving later never has to wait for it.
  void source();

  const el = playing ?? new Audio();
  el.preload = 'auto';
  playing = el;
  try { el.currentTime = 0; } catch { /* nothing loaded yet */ }

  const disarm = () => EVENTS.forEach(e => window.removeEventListener(e, onGesture));
  const onGesture = () => {
    disarm();
    askToBeHeard();
    // The tap is the unlock, so this is the moment the good engine can work.
    if (playHere()) return;
    const bad = (e: DOMException) => {
      note(why(e));
      if (e?.name !== 'NotAllowedError') failNote = failNote || ('play: ' + (e?.name || e));
    };
    /* Synchronously, inside the tap, whenever the file is already here — which
     * it is by now, because the fetch was started at launch. Everything below
     * is the fallback for the case where it is somehow not. */
    if (srcUrl) {
      if (!el.src) el.src = srcUrl;
      el.play().then(() => { note('played'); announce(el); }).catch(bad);
      return;
    }
    void source().then(url => { if (!el.src) el.src = url; return el.play(); })
      .then(() => { note('played'); announce(el); })
      .catch(bad);
  };

  /* Armed BEFORE the attempt, not after it fails.
   *
   * `play()` rejects asynchronously, so listening only in the catch leaves a
   * gap: a launch where the first touch lands inside that gap is a touch the
   * sound never hears about, and then nothing wakes it for the rest of the
   * session. Arming first costs nothing — a successful play disarms it. */
  EVENTS.forEach(ev => window.addEventListener(ev, onGesture, { once: true, passive: true }));

  /* Decode up front. A tap has to be able to play it on the spot: decoding an
   * mp3 takes longer than the tap lasts, and a sound decoded afterwards is a
   * sound that arrives after the moment it belonged to. */
  void prepare().then(() => {
    if (playHere()) disarm();
  });

  void source().then(url => {
    if (!el.src) el.src = url;
    return el.play();
  }).then(() => { disarm(); note('played'); announce(el); }).catch((e: DOMException) => {
    // Held back, not lost: the first touch of any kind plays it.
    note(e?.name === 'NotAllowedError' ? 'waiting' : why(e));
    if (e?.name !== 'NotAllowedError') failNote = failNote || ('play: ' + (e?.name || e));
  });
}

/**
 * Play it when the app opens — including the times it opens without loading.
 *
 * An installed app is not reloaded when you come back to it, it is resumed:
 * the page is the one you left, React never mounts again, and a flag saying
 * "already played" is still set from the first time. So it played once and
 * then never again, which is exactly what it looked like from the outside.
 * Returning after a real absence counts as opening it.
 */
export function playBootSound(): void {
  start();
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      leftAt = Date.now();
      return;
    }
    if (leftAt && Date.now() - leftAt >= AWAY_MS) start();
    leftAt = 0;
  });
}

/** For the toggle in Settings: silence it now, not just next launch. */
export function stopBootSound(): void {
  playing?.pause();
}

/**
 * Play it on demand, from a real tap.
 *
 * This is the answer to "it doesn't make a sound", which has three very
 * different causes that look identical from the outside: the browser held it
 * back until a gesture, the phone is on silent, or something is wrong with the
 * file. A button cannot be blocked by the autoplay rules — the tap IS the
 * gesture — so if this is silent too the problem is the device or the file, and
 * if it plays, the answer is that the launch attempt was refused.
 */
export type SoundResult = 'ok' | 'blocked' | 'nofile';

export function testSound(): Promise<SoundResult> {
  askToBeHeard();
  const el = playing ?? new Audio();
  playing = el;
  try { el.currentTime = 0; } catch { /* nothing loaded yet */ }
  return source().then(url => { if (!el.src) el.src = url; return el.play(); })
    .then(() => { note('played'); return 'ok' as const; })
    .catch((e: DOMException) => {
    note(why(e));
    if (e?.name !== 'NotAllowedError') failNote = failNote || ('play: ' + (e?.name || e));
    /* The reason matters, and collapsing every rejection into "blocked" sent
     * me hunting the wrong fault for an hour. A browser refusing autoplay
     * throws NotAllowedError; a file that never arrived throws
     * NotSupportedError, and reads identically from the outside. */
    return e?.name === 'NotAllowedError' ? ('blocked' as const) : ('nofile' as const);
  });
}
