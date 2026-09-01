import { useEffect, useState } from 'react';
import { Mark } from '../ui/Mark';

/** In by 420ms, held, then out — the whole thing is under a second and a half. */
const HOLD_MS = 900;
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
export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const out = window.setTimeout(() => setLeaving(true), HOLD_MS);
    const gone = window.setTimeout(onDone, HOLD_MS + FADE_MS);
    return () => { window.clearTimeout(out); window.clearTimeout(gone); };
  }, [onDone]);

  return (
    <div className={'splash' + (leaving ? ' is-leaving' : '')} aria-hidden="true">
      <div className="splash-mark">
        <Mark size={96} />
      </div>
      <div className="splash-word">Doctors Fantasy</div>
    </div>
  );
}
