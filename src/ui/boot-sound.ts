import bootUrl from '../assets/boot.mp3';

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

/** Once per page load, not once per mount: React runs effects twice in dev. */
let already = false;
/** Held so it can be silenced later. `new Audio()` is never in the document,
 *  so looking for it with a DOM query finds nothing — which is how the Off
 *  switch came to do nothing at all the first time it was written. */
let playing: HTMLAudioElement | null = null;

export function playBootSound(): void {
  if (already || !soundOn() || typeof Audio === 'undefined') return;
  already = true;

  const el = new Audio(bootUrl);
  el.preload = 'auto';
  playing = el;
  const EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];

  const disarm = () => EVENTS.forEach(e => window.removeEventListener(e, onGesture));
  const onGesture = () => {
    disarm();
    // Muted between the refusal and here would be a silent "success".
    void el.play().catch(() => {});
  };

  void el.play().then(disarm).catch(() => {
    EVENTS.forEach(e => window.addEventListener(e, onGesture, { once: true, passive: true }));
  });
}

/** For the toggle in Settings: silence it now, not just next launch. */
export function stopBootSound(): void {
  playing?.pause();
}
