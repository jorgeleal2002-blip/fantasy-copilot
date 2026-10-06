import { useState } from 'react';
import { connectAccount, signOutAccount, signedInAs, type AccountSession } from '../api/access';
import { makeCode } from '../model/access';
import { Card } from '../ui/primitives';
import { cardNote, cardTitle } from '../ui/styles';
import { AccountForm } from './AccountForm';

/**
 * The account behind this device: an email or Google sign-in that works on
 * any phone or computer. The only way to use the app on a second device.
 */
export function DevicesCard({ username }: { username: string }) {
  const [who, setWho] = useState(() => signedInAs());
  const [connecting, setConnecting] = useState(false);

  const connect = async (x: AccountSession): Promise<string | null> => {
    const ok = await connectAccount(x, username, makeCode());
    if (!ok) return 'The database refused it. Are the latest rules published?';
    setWho({ email: x.email || '', via: x.via || 'email' });
    setConnecting(false);
    return null;
  };

  return (
    <Card>
      <div style={{ ...cardTitle, marginBottom: 2 }}>Your account</div>
      {who ? (
        <>
          <div style={{ ...cardNote, marginBottom: 10 }}>
            ✅ Signed in as <b style={{ color: 'var(--color-text)' }}>{who.email || who.via}</b>
            {who.via === 'google' ? ' (Google)' : ''}. Sign in with it on any phone or computer — no code needed.
          </div>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: 0 }}
            onClick={() => {
              if (!confirm('Sign out of ' + (who.email || 'this account') + ' on this device?')) return;
              signOutAccount(); setWho(null); location.reload();
            }}>
            Sign out of {who.via === 'google' ? 'Google' : 'email'} on this device
          </button>
        </>
      ) : connecting ? (
        <div>
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
            Right now your access lives on this device. Connect an email or Google to use Doctors on
            any phone or computer.
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setConnecting(true)}
            style={{ width: '100%', borderRadius: 8, minHeight: 42 }}>
            ✉️ Connect email or Google
          </button>
        </>
      )}
    </Card>
  );
}
