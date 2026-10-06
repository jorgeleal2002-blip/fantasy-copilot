import { useEffect, useState } from 'react';
import { LINK_MINUTES, createLink } from '../api/access';
import { inviteLink, makeCode, prettyCode } from '../model/access';
import { Card } from '../ui/primitives';
import { cardNote, cardTitle, dim } from '../ui/styles';

/**
 * Adding another device to this account: a code that works once, for fifteen
 * minutes, typed on the code screen of the new device. No second invite.
 */
export function DevicesCard({ username }: { username: string }) {
  const [link, setLink] = useState<{ code: string; exp: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!link) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [link]);

  const left = link ? Math.max(0, link.exp - now) : 0;
  const expired = !!link && left <= 0;

  const make = async () => {
    setBusy(true);
    setMsg('');
    try {
      const got = await createLink(makeCode(), username);
      if (got) { setLink(got); setNow(Date.now()); } else setMsg('The database refused it. Are the latest rules published?');
    } catch {
      setMsg('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!link) return;
    const url = inviteLink(link.code, location.href);
    const text = 'Doctors device code: ' + prettyCode(link.code);
    try {
      if (navigator.share) { await navigator.share({ title: 'Doctors', text, url }); return; }
    } catch { return; }
    try { await navigator.clipboard.writeText(url); setMsg('Link copied.'); } catch { setMsg(url); }
  };

  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);

  return (
    <Card>
      <div style={{ ...cardTitle, marginBottom: 2 }}>Your devices</div>
      <div style={{ ...cardNote, marginBottom: 12 }}>
        Use Doctors on another phone, tablet or computer with this same account — no new invite needed.
      </div>

      {link && !expired ? (
        <div style={{
          padding: 12, borderRadius: 12, textAlign: 'center',
          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        }}>
          <div style={{ fontSize: 12, color: dim(0.75) }}>On the other device, open Doctors and enter</div>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '.12em', color: 'var(--color-accent)', margin: '6px 0' }}>
            {prettyCode(link.code)}
          </div>
          <div style={{ fontSize: 12, color: dim(0.62), fontVariantNumeric: 'tabular-nums' }}>
            Works once · expires in {mm}:{String(ss).padStart(2, '0')}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void send()}
            style={{ marginTop: 10, borderRadius: 8, minHeight: 38, width: '100%' }}>
            Send to my other device
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void make()}
          style={{ width: '100%', borderRadius: 8, minHeight: 42 }}>
          {busy ? '…' : expired ? 'Code expired — make a new one' : '📱 Add another device'}
        </button>
      )}
      {msg ? <div style={{ fontSize: 12, lineHeight: '18px', color: dim(0.75), marginTop: 10, wordBreak: 'break-all' }}>{msg}</div> : null}
      <div style={{ ...cardNote, marginTop: 8 }}>
        The code lasts {LINK_MINUTES} minutes. Only share it with yourself.
      </div>
    </Card>
  );
}
