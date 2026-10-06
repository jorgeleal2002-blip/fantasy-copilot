import { useEffect, useRef, useState } from 'react';
import { emailSignIn, emailSignUp, googleSignIn, resetPassword, type AccountSession } from '../api/access';
import { googleEnabled, mountGoogleButton } from '../api/identity';
import { BAD } from '../model/constants';
import { dim } from '../ui/styles';

/**
 * Email and password, or Google, for the account that carries across devices.
 * Hands back the signed-in identity; what to do with it is the caller's.
 */
export function AccountForm({ onSession, start = 'signin' }: {
  onSession: (s: AccountSession) => Promise<string | null>;
  start?: 'signin' | 'create';
}) {
  const [mode, setMode] = useState(start);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const gHost = useRef<HTMLDivElement>(null);

  const finish = async (get: () => Promise<AccountSession>) => {
    setBusy(true); setErr(''); setNote('');
    try {
      const problem = await onSession(await get());
      if (problem) setErr(problem);
    } catch (e) {
      setErr((e as Error).message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!googleEnabled() || !gHost.current) return;
    mountGoogleButton(gHost.current, t => { void finish(() => googleSignIn(t)); }, () => { /* no Google today */ });
    // Once: the button is Google's and keeps its own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const field = {
    width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)',
    border: 'var(--hairline) solid var(--color-divider)', borderRadius: 12, padding: '12px 14px',
    font: "400 16px 'Inter', system-ui", outline: 'none',
  } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {googleEnabled() ? (
        <>
          <div ref={gHost} style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }} />
          <div style={{ textAlign: 'center', fontSize: 12, color: dim(0.52) }}>or with email</div>
        </>
      ) : null}
      <input type="email" autoComplete="email" placeholder="Email" value={email}
        onChange={e => setEmail(e.target.value)} style={field} />
      <input type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
        placeholder={mode === 'create' ? 'Password (6+ characters)' : 'Password'} value={pw}
        onChange={e => setPw(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void finish(() => (mode === 'create' ? emailSignUp : emailSignIn)(email, pw)); }}
        style={field} />
      {err ? <div role="alert" style={{ fontSize: 12, lineHeight: '18px', color: BAD }}>{err}</div> : null}
      {note ? <div style={{ fontSize: 12, lineHeight: '18px', color: dim(0.75) }}>{note}</div> : null}
      <button type="button" className="btn btn-primary" disabled={busy || !email.trim() || !pw}
        onClick={() => void finish(() => (mode === 'create' ? emailSignUp : emailSignIn)(email, pw))}
        style={{ width: '100%', borderRadius: 12, minHeight: 46 }}>
        {busy ? '…' : mode === 'create' ? 'Create account' : 'Sign in'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: 0 }}
          onClick={() => { setMode(mode === 'create' ? 'signin' : 'create'); setErr(''); }}>
          {mode === 'create' ? 'I already have an account' : 'Create an account'}
        </button>
        {mode === 'signin' ? (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: 0 }}
            onClick={async () => {
              if (!email.trim()) { setErr('Type your email first.'); return; }
              try { await resetPassword(email); setNote('Check your email for a link to reset the password.'); setErr(''); }
              catch (e) { setErr((e as Error).message); }
            }}>
            Forgot password?
          </button>
        ) : null}
      </div>
    </div>
  );
}
