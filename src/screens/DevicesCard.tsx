import { useEffect, useState } from 'react';
import { LINK_MINUTES, connectAccount, createLink, signOutAccount, signedInAs, type AccountSession } from '../api/access';
import { AccountForm } from './AccountForm';
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
  const [who, setWho] = useState(() => signedInAs());
  const [connecting, setConnecting] = useState(false);

  const connect = async (x: AccountSession): Promise<string | null> => {
    const ok = await connectAccount(x, username, makeCode());
    if (!ok) return 'The database refused it. Are the latest rules published?';
    setWho({ email: x.email || '', via: x.via || 'email' });
    setConnecting(false);
    return null;
  };

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
      <div style={{ ...cardTitle, marginBottom: 2 }}>Your account</div>
      {who ? (
        <>
          <div style={{ ...cardNote, marginBottom: 10 }}>
            ✅ Signed in as <b style={{ color: 'var(--color-text)' }}>{who.email || who.via}</b>
            {who.via === 'google' ? ' (Google)' : ''}. Sign in with it on any phone or computer — no code needed.
          </div>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: 0, marginBottom: 14 }}
            onClick={() => {
              if (!confirm('Sign out of ' + (who.email || 'this account') + ' on this device?')) return;
              signOutAccount(); setWho(null); location.reload();
            }}>
            Sign out of {who.via === 'google' ? 'Google' : 'email'} on this device
          </button>
        </>
      ) : connecting ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...cardNote, marginBottom: 10 }}>
            Your access moves to this email or Google account. Then just sign in on any device.
          </div>
          <AccountForm onSession={connect} start="create" />
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: 0, marginTop: 8 }}
            onClick={() => setConnecting(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div style={{ ...cardNote, marginBottom: 10 }}>
            Right now your access lives on this device. Connect an email or Google to sign in anywhere.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setConnecting(true)}
            style={{ width: '100%', borderRadius: 8, minHeight: 42, marginBottom: 14 }}>
            ✉️ Connect email or Google
          </button>
        </>
      )}

      <div style={{ ...cardNote, marginBottom: 10 }}>
        Or add a device with a one-time code:
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
