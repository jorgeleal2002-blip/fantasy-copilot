import { useEffect, useRef, useState } from 'react';
import { emailSignIn, emailSignUp, googleSignIn, resetPassword, type AccountSession } from '../api/access';
import { googleEnabled, mountGoogleButton } from '../api/identity';

/**
 * Email and password, or Google, for the account that carries across devices.
 * Hands back the signed-in identity; what to do with it is the caller's.
 *
 * Two tabs rather than two links under the button: which one you are on is
 * the first thing to know, and a link reading "Create an account" under a
 * button reading "Sign in" was read as the button's caption.
 */
export function AccountForm({ onSession, start = 'signin', hint }: {
  onSession: (s: AccountSession) => Promise<string | null>;
  start?: 'signin' | 'create';
  /** one line under the button, for the create tab */
  hint?: string;
}) {
  const [mode, setMode] = useState(start);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const gHost = useRef<HTMLDivElement>(null);
  const creating = mode === 'create';

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
  const submit = () => {
    if (!email.trim() || !pw || busy) return;
    void finish(() => (creating ? emailSignUp : emailSignIn)(email, pw));
  };

  useEffect(() => {
    if (!googleEnabled() || !gHost.current) return;
    mountGoogleButton(gHost.current, t => { void finish(() => googleSignIn(t)); }, () => { /* no Google today */ });
    // Once: the button is Google's and keeps its own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="af">
      <div className="af-tabs" role="tablist">
        {(['signin', 'create'] as const).map(m => (
          <button key={m} type="button" role="tab" aria-selected={mode === m}
            className={'af-tab' + (mode === m ? ' is-on' : '')}
            onClick={() => { setMode(m); setErr(''); setNote(''); }}>
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      {googleEnabled() ? (
        <>
          <div ref={gHost} className="af-google" />
          <div className="af-or"><span>or</span></div>
        </>
      ) : null}

      <input className="af-field" type="email" autoComplete="email" inputMode="email" placeholder="Email"
        value={email} onChange={e => setEmail(e.target.value)} />
      <div className="af-pw">
        <input className="af-field" type={show ? 'text' : 'password'}
          autoComplete={creating ? 'new-password' : 'current-password'}
          placeholder={creating ? 'Password · 6+ characters' : 'Password'}
          value={pw} onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        <button type="button" className="af-eye" aria-label={show ? 'Hide password' : 'Show password'}
          onClick={() => setShow(s => !s)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>

      {err ? <div role="alert" className="af-err">{err}</div> : null}
      {note ? <div className="af-note">{note}</div> : null}

      <button type="button" className="af-go" disabled={busy || !email.trim() || !pw} onClick={submit}>
        {busy ? '…' : creating ? 'Create account' : 'Sign in'}
      </button>

      {creating ? (
        hint ? <div className="af-hint">{hint}</div> : null
      ) : (
        <button type="button" className="af-link"
          onClick={async () => {
            if (!email.trim()) { setErr('Type your email first.'); return; }
            try { await resetPassword(email); setNote('Check your email for a link to reset your password.'); setErr(''); }
            catch (e) { setErr((e as Error).message); }
          }}>
          Forgot password?
        </button>
      )}
    </div>
  );
}
