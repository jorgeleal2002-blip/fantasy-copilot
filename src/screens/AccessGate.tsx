import { useEffect, useState } from 'react';
import { BAD } from '../model/constants';
import { checkCode, rememberUnlock } from '../model/access';
import { Mark } from '../ui/Mark';
import { dim } from '../ui/styles';

const topPad = (extra: number) => `calc(var(--safe-top) + ${extra}px)`;

/**
 * The front door: a code before anything else. Asked once per phone. A link
 * carrying `?code=` opens it straight away, so the code can be shared as a
 * link, and is taken out of the address bar once it has been read.
 */
export function AccessGate({ onOpen }: { onOpen: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const tryCode = async (c: string) => {
    setBusy(true);
    const h = await checkCode(c).catch(() => null);
    setBusy(false);
    if (h) { rememberUnlock(h); onOpen(); return true; }
    setWrong(true);
    return false;
  };

  useEffect(() => {
    const url = new URL(location.href);
    const c = url.searchParams.get('code');
    if (!c) return;
    url.searchParams.delete('code');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    setCode(c);
    void tryCode(c);
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
      <p style={{ fontSize: 13, lineHeight: '20px', color: dim(0.62), margin: '0 0 28px', maxWidth: '32ch' }}>
        Enter your access code. You only need it once on this phone.
      </p>

      <label
        htmlFor="access-code"
        style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: dim(0.52), marginBottom: 8 }}
      >
        Access code
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
      {wrong ? (
        <div role="alert" style={{ fontSize: 12, lineHeight: '18px', color: BAD, marginTop: 10 }}>
          That code is not right. Ask whoever shared the app for it.
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
    </div>
  );
}
