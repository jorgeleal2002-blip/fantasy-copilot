import { useEffect, useState } from 'react';
import { BAD } from '../model/constants';
import {
  installed, isIOS, notifyState, pushConfigured, readAlerts, turnOffPhone, turnOnPhone, writeAlerts,
  type AlertPrefs, type PushWho,
} from '../ui/alert-prefs';
import { Card } from '../ui/primitives';
import { cardNote, cardTitle, dim } from '../ui/styles';

/** The switches for touchdown and big-play alerts. */
export function AlertSettings({ who }: { who: PushWho }) {
  const [p, setP] = useState<AlertPrefs>(readAlerts);
  const [perm, setPerm] = useState(notifyState);
  useEffect(() => { writeAlerts(p); }, [p]);

  const phone = async () => {
    if (p.phone) { await turnOffPhone(); setP(readAlerts()); return; }
    const ok = await turnOnPhone(who);
    setPerm(notifyState());
    if (ok) setP(readAlerts());
  };

  return (
    <Card>
      <div style={{ ...cardTitle, marginBottom: 2 }}>Play alerts</div>
      <div style={{ ...cardNote, marginBottom: 10 }}>
        🏈 Touchdowns and 💥 big plays (40+ yd catch or pass, 30+ yd run) by your starters, while games are on.
      </div>
      <Toggle on={p.on} label="Alerts in the app" onClick={() => setP({ ...p, on: !p.on })} />
      <Toggle on={p.on && p.opp} disabled={!p.on} label="Include my opponent's players"
        onClick={() => setP({ ...p, opp: !p.opp })} />
      {perm === 'granted' ? (
        <Toggle on={p.on && p.phone} disabled={!p.on} label="Phone notifications" onClick={() => void phone()} />
      ) : perm === 'default' ? (
        <button type="button" className="btn btn-primary" onClick={() => void phone()}
          style={{ width: '100%', borderRadius: 8, minHeight: 42, marginTop: 6 }}>
          🔔 Turn on phone notifications
        </button>
      ) : perm === 'denied' ? (
        <div style={{ fontSize: 12, lineHeight: '18px', color: BAD, marginTop: 6 }}>
          Notifications are blocked for this app. Turn them on in your phone&apos;s Settings → Notifications
          {isIOS() ? ' → Doctors' : ' (or the site settings in your browser)'}.
        </div>
      ) : (
        <div style={{ ...cardNote, marginTop: 6 }}>
          {isIOS() && !installed()
            ? '🔔 Phone notifications: on iPhone, tap Share → Add to Home Screen, then open Doctors from the icon and come back here.'
            : 'This browser cannot show notifications.'}
        </div>
      )}
      {/* The honest reach, which is not the same sentence in both builds.
          Without a watcher the app has to be on screen to notice anything —
          iOS suspends a backgrounded web app and its timers with it, which is
          why a touchdown scored over lunch never arrived. */}
      <div style={{ ...cardNote, marginTop: 8 }}>
        {p.push
          ? 'Touchdowns by your starters reach you with the app closed. Big plays and your opponent\u2019s players only while it is open.'
          : pushConfigured() && p.phone
            ? 'Only while the app is open — this phone is not subscribed to the watcher. Turn phone notifications off and on again to retry.'
            : 'They arrive while the app is open. With it fully closed the phone stops it from checking.'}
      </div>
    </Card>
  );
}

function Toggle({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%',
        background: 'none', border: 0, padding: '8px 0', font: 'inherit', fontSize: 13, textAlign: 'left',
        color: disabled ? dim(0.52) : 'var(--color-text)', cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span>{label}</span>
      <span aria-hidden="true" style={{
        width: 40, height: 24, flex: 'none', borderRadius: 999, position: 'relative',
        background: on ? 'var(--color-accent)' : 'rgba(242, 253, 254, 0.12)', transition: 'background .2s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 18 : 2, width: 20, height: 20, borderRadius: 999,
          background: 'var(--color-text)', transition: 'left .2s',
        }} />
      </span>
    </button>
  );
}
