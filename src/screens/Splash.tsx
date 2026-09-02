import { useEffect, useState } from 'react';
import { Mark } from '../ui/Mark';
import { onBootSound, soundOn } from '../ui/boot-sound';

/** He lands, nods, blinks twice, and only then does it fade — all of it
 *  finishing before the fade starts, so no gesture is cut off mid-way. */
const HOLD_MS = 1150;
const FADE_MS = 320;

/**
 * The launch screen.
 *
 * A cold start has a moment where the shell is up but the league is not, and
 * without something in it the app opens on an empty frame. The mark fills that
 * moment, and since it is drawn rather than fetched it is on screen in the
 * first frame — a launch image would still be loading.
 *
 * It never gates anything: the app boots behind it and this only covers the
 * view, so a fast start is a glimpse rather than an imposed wait.
 */
/**
 * The longest the picture will wait for the sound.
 *
 * The clip is the reason to hold at all, so the hold follows it — but it
 * follows a number that comes from a file, and a file can be replaced with a
 * long one. This is the point past which a launch screen stops being a launch
 * screen and becomes a wait.
 */
const MAX_HOLD_MS = 4200;

/**
 * How long to stay up when there is a sound to stay up FOR.
 *
 * Set before anything plays rather than in response to it, because on an
 * installed copy nothing plays until the screen is touched — and if the
 * picture has already gone by then the sound arrives alone, which is the
 * complaint. This is the window in which that first touch usually lands.
 *
 * Not the clip's full length: a sound the browser refuses would hold an empty
 * screen for three and a half seconds, and a launch screen nobody asked to
 * wait behind is worse than a sound that starts a moment late. Once the clip
 * really starts, its own length takes over below.
 */
const WITH_SOUND_MS = 1800;

export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  /* The sound and the picture were on separate clocks: this held for 1.15s
   * over a clip of three and a half seconds, so most of the sound played to an
   * app that had already moved on. Now the picture waits for it — and only if
   * it actually started, which on an installed copy it may not have, because
   * nothing may make noise there before you have touched the screen. */
  const [hold, setHold] = useState(() => (soundOn() ? WITH_SOUND_MS : HOLD_MS));

  useEffect(() => onBootSound(secs => {
    if (secs > 0) setHold(Math.min(secs * 1000, MAX_HOLD_MS));
  }), []);

  useEffect(() => {
    const out = window.setTimeout(() => setLeaving(true), hold);
    const gone = window.setTimeout(onDone, hold + FADE_MS);
    return () => { window.clearTimeout(out); window.clearTimeout(gone); };
  }, [onDone, hold]);

  return (
    <div className={'splash' + (leaving ? ' is-leaving' : '')} aria-hidden="true">
      <div className="splash-mark">
        <Mark size={96} alive />
      </div>
      <div className="splash-word">Doctors Fantasy</div>
    </div>
  );
}
