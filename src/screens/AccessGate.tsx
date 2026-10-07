import { useEffect, useState } from 'react';
import { BAD } from '../model/constants';
import {
  accessEnabled, adopt, claimOwner, logAttempt, redeem, signOutAccount, signedInAs, standing, type AccountSession,
} from '../api/access';
import { AccountForm } from './AccountForm';
import { checkCode, normalizeCode, rememberUnlock } from '../model/access';
import { Mark } from '../ui/Mark';
import { dim } from '../ui/styles';

const topPad = (extra: number) => `calc(var(--safe-top) + ${extra}px)`;

/**
 * The front door. With invites on, an account first — email or Google — and
 * then, for an account that is not in yet, the invite code, which is spent on
 * that account: from then on signing in with it opens the app on any device,
 * and it stays signed in. A link carrying `?code=` fills the code in, and it
 * is spent as soon as there is an account to spend it on.
 *
 * Without invites, the one shared code, as before.
 */
export function AccessGate({ onOpen }: { onOpen: (username?: string) => void }) {
  const [code, setCode] = useState('');
  const [who, setWho] = useState(() => signedInAs());

  /* An email or Google account that is already in opens the app on this
     device too. One that is not keeps the sign-in, so the invite code typed
     next is spent on the account rather than on the device. */
  const withAccount = async (s: AccountSession): Promise<string | null> => {
    const st = await standing(s);
    adopt(s);
    setWho({ email: s.email || '', via: s.via || 'email' });
    if (st !== 'none') { rememberUnlock(st); onOpen(); return null; }
    // Came from an invite link: spend it now that there is an account.
    if (normalizeCode(code)) void tryCode(code);
    return null;
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wrong = !!error;
  const setWrong = (on: boolean) => setError(on ? 'That code is not right. Ask whoever shared the app for it.' : '');

  /* With invites on, a code is spent on this phone by the database, and the
     owner's setup code makes this phone the one that hands them out. Without
     them, the one shared code is checked here, as before. */
  const tryCode = async (c: string) => {
    if (!normalizeCode(c)) return false;
    setBusy(true);
    setError('');
    try {
      const ownerKey = await checkCode(c).catch(() => null);
      if (!accessEnabled()) {
        if (ownerKey) { rememberUnlock(ownerKey); onOpen(); return true; }
        setWrong(true);
        return false;
      }
      if (ownerKey) {
        await claimOwner();
        if ((await standing()) === 'owner') { rememberUnlock('owner'); onOpen(); return true; }
        setError('Could not make this phone the owner: either it is already set up on another phone, or the invite rules are not published in Firebase yet.');
        return false;
      }
      if (await redeem(normalizeCode(c))) { rememberUnlock('member'); onOpen(); return true; }
      void logAttempt(normalizeCode(c));
      setError('That code does not work: it is wrong, or somebody already used it.');
      return false;
    } catch (e) {
      setError(String((e as Error)?.message) === 'anonymous-off'
        ? 'Anonymous sign-in is off in Firebase: Authentication → Sign-in method → Anonymous → Enable.'
        : 'Could not reach the server. Check your connection and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const url = new URL(location.href);
    const c = url.searchParams.get('code');
    if (!c) return;
    url.searchParams.delete('code');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    setCode(c);
    // Spent straight away only once there is an account to spend it on.
    if (!accessEnabled() || signedInAs()) void tryCode(c);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: `${topPad(34)} 24px calc(var(--safe-bottom) + 26px)`,
        animation: 'fadeUp .4s ease backwards',
      }}
    >
      <div style={{ width: 72, height: 72, borderRadius: '50%' }}>
        <Mark size={72} title="Doctors" />
      </div>
      <h1 style={{ fontSize: 31, lineHeight: '34px', fontWeight: 500, letterSpacing: '-0.025em', margin: '26px 0 8px' }}>
        Doctors
      </h1>
      {accessEnabled() && !who ? (
        <>
          <p style={{ fontSize: 13, lineHeight: '20px', color: dim(0.62), margin: '0 0 22px', maxWidth: '34ch' }}>
            {normalizeCode(code)
              ? 'You have an invite. Create your account with your email or Google — you will stay signed in, on any device.'
              : 'Sign in with your email or Google. New here? Create an account, then enter your invite code.'}
          </p>
          <AccountForm onSession={withAccount} start={normalizeCode(code) ? 'create' : 'signin'} />
        </>
      ) : (
        <>
      <p style={{ fontSize: 13, lineHeight: '20px', color: dim(0.62), margin: '0 0 28px', maxWidth: '32ch' }}>
        {who ? 'One last step: your invite code.' : 'Enter your access code.'}
      </p>

      <label
        htmlFor="access-code"
        style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: dim(0.52), marginBottom: 8 }}
      >
        {accessEnabled() ? 'Invite code' : 'Access code'}
      </label>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--color-surface)',
          border: 'var(--hairline) solid ' + (wrong ? BAD : 'var(--color-divider)'),
          borderRadius: 12, padding: '13px 14px',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 15 }}>🔒</span>
        <input
          id="access-code"
          value={code}
          onChange={e => { setCode(e.target.value); setWrong(false); }}
          onKeyDown={e => { if (e.key === 'Enter') void tryCode(code); }}
          placeholder="Code"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          style={{
            flex: 1, background: 'transparent', border: 0, outline: 'none', letterSpacing: '.12em',
            color: 'var(--color-text)', font: "500 16px 'Inter', system-ui", minWidth: 0,
          }}
        />
      </div>
      {who ? (
        <div style={{ fontSize: 12, lineHeight: '18px', color: dim(0.75), marginTop: 10 }}>
          Signed in as <b>{who.email || (who.via === 'google' ? 'Google' : 'email')}</b>.{' '}
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: 0 }}
            onClick={() => { signOutAccount(); setWho(null); setError(''); }}>
            Use another account
          </button>
          <div style={{
            marginTop: 12, padding: 12, borderRadius: 12, fontSize: 12, lineHeight: '18px',
            background: 'rgba(242, 253, 254, 0.07)', color: dim(0.75),
          }}>
            <b style={{ color: 'var(--color-text)' }}>Already using Doctors on another phone?</b> You do not need a
            new code. On that phone open <b>You → Your account → Connect email or Google</b> with this same
            email, then come back here and tap “Use another account” to sign in again.
          </div>
        </div>
      ) : null}
      {wrong ? (
        <div role="alert" style={{ fontSize: 12, lineHeight: '18px', color: BAD, marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 26 }} />
      <button
        type="button"
        onClick={() => void tryCode(code)}
        disabled={busy || !code.trim()}
        style={{
          width: '100%', minHeight: 50, borderRadius: 12,
          border: '1px solid var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
          color: 'var(--color-accent)', font: "500 15px 'Inter', system-ui", cursor: 'pointer',
          opacity: busy || !code.trim() ? 0.52 : 1,
        }}
      >
        {busy ? 'Checking…' : 'Enter'}
      </button>
        </>
      )}
    </div>
  );
}
