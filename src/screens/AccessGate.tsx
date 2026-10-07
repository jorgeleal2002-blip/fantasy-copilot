import { useEffect, useState } from 'react';
import {
  accessEnabled, adopt, claimOwner, logAttempt, redeem, signOutAccount, signedInAs, standing, type AccountSession,
} from '../api/access';
import { AccountForm } from './AccountForm';
import { checkCode, normalizeCode, rememberUnlock } from '../model/access';
import { Mark } from '../ui/Mark';


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

  const invited = !!normalizeCode(code);
  return (
    <div className="ag">
      <div className="ag-head">
        <Mark size={64} title="Doctors" />
        <h1 className="ag-title">Doctors</h1>
        <p className="ag-sub">
          {accessEnabled() && !who
            ? (invited ? 'You have an invite. Create your account.' : 'Fantasy football, figured out.')
            : who ? 'One last step' : 'Enter your access code'}
        </p>
      </div>

      {accessEnabled() && !who ? (
        <AccountForm onSession={withAccount} start={invited ? 'create' : 'signin'}
          hint={invited ? 'Your invite is applied right after.' : 'You will need your invite code next.'} />
      ) : (
        <div className="af">
          {who ? (
            <div className="ag-who">
              <span>Signed in as <b>{who.email || (who.via === 'google' ? 'Google' : 'email')}</b></span>
              <button type="button" className="af-link" style={{ padding: 0 }}
                onClick={() => { signOutAccount(); setWho(null); setError(''); }}>
                Switch
              </button>
            </div>
          ) : null}
          <input
            id="access-code"
            className={'af-field ag-code' + (wrong ? ' is-bad' : '')}
            value={code}
            onChange={e => { setCode(e.target.value); setWrong(false); }}
            onKeyDown={e => { if (e.key === 'Enter') void tryCode(code); }}
            placeholder={accessEnabled() ? 'Invite code' : 'Access code'}
            aria-label={accessEnabled() ? 'Invite code' : 'Access code'}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          {wrong ? <div role="alert" className="af-err">{error}</div> : null}
          <button type="button" className="af-go" onClick={() => void tryCode(code)} disabled={busy || !code.trim()}>
            {busy ? 'Checking…' : 'Enter'}
          </button>
          {who ? (
            <details className="ag-more">
              <summary>Already use Doctors on another phone?</summary>
              <p>
                No new code needed. On that phone go to <b>You → Your account → Connect email or Google</b> with
                this same email, then tap Switch here and sign in.
              </p>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}
