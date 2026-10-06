import { useEffect, useState } from 'react';
import {
  dismissPrompt, installed, isIOS, notifyState, promptDismissed, readAlerts, turnOnPhone,
} from '../ui/alert-prefs';

/**
 * The invitation to switch on touchdown notifications, once, at the bottom of
 * the app. A permission is only granted from a tap, so it is a button, never
 * an automatic prompt. On an iPhone in a browser tab notifications cannot be
 * had at all, so it says the one thing that makes them possible instead.
 */
export function NotifyPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const st = notifyState();
    const iosTab = st === 'unsupported' && isIOS() && !installed();
    const want = !promptDismissed() && !readAlerts().phone && st !== 'denied' && (st !== 'unsupported' || iosTab);
    // A moment after the app opens, not on top of the first paint.
    const t = window.setTimeout(() => setShow(want), 2500);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;

  const iosTab = notifyState() === 'unsupported';
  const close = () => { dismissPrompt(); setShow(false); };
  return (
    <div className="np-card" role="dialog" aria-label="Notifications">
      <div className="np-icon" aria-hidden="true">🔔</div>
      <div className="np-text">
        <div className="np-title">Get touchdown alerts</div>
        <div className="np-body">
          {iosTab
            ? 'On iPhone, tap Share → Add to Home Screen, then open Doctors from the icon to turn them on.'
            : 'A notification when your players score or break a big play.'}
        </div>
        <div className="np-actions">
          {iosTab ? null : (
            <button type="button" className="np-on" disabled={busy}
              onClick={async () => { setBusy(true); await turnOnPhone(); setBusy(false); close(); }}>
              Turn on
            </button>
          )}
          <button type="button" className="np-later" onClick={close}>{iosTab ? 'Got it' : 'Not now'}</button>
        </div>
      </div>
    </div>
  );
}
