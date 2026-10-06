import { useEffect, useState } from 'react';
import { BAD } from '../model/constants';
import { notifyState, readAlerts, writeAlerts, type AlertPrefs } from '../ui/alert-prefs';
import { Card } from '../ui/primitives';
import { cardNote, cardTitle, dim } from '../ui/styles';

/** The switches for touchdown and big-play alerts. */
export function AlertSettings() {
  const [p, setP] = useState<AlertPrefs>(readAlerts);
  const [perm, setPerm] = useState(notifyState);
  useEffect(() => { writeAlerts(p); }, [p]);

  const phone = async () => {
    if (p.phone) { setP({ ...p, phone: false }); return; }
    if (perm === 'default') {
      const r = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
      setPerm(r);
      if (r !== 'granted') return;
    }
    if (notifyState() === 'granted') setP({ ...p, phone: true });
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
      <Toggle on={p.on && p.phone} disabled={!p.on || perm === 'unsupported' || perm === 'denied'}
        label="Phone notifications" onClick={() => void phone()} />
      {perm === 'unsupported' ? (
        <div style={{ ...cardNote, marginTop: 6 }}>
          On iPhone, add the app to your home screen (Share → Add to Home Screen) and open it from there to allow notifications.
        </div>
      ) : perm === 'denied' ? (
        <div style={{ fontSize: 12, lineHeight: '18px', color: BAD, marginTop: 6 }}>
          Notifications are blocked for this app. Allow them in your phone&apos;s settings.
        </div>
      ) : null}
      <div style={{ ...cardNote, marginTop: 8 }}>
        They arrive while the app is open. With it fully closed the phone stops it from checking.
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
