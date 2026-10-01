import { useEffect, useRef } from 'react';
import { BAD } from '../model/constants';
import { mountGoogleButton } from '../api/identity';
import { leagueAvatar } from '../api/sleeper';
import type { SleeperLeague } from '../api/types';
import { BOOT_STEPS, type App } from '../state/useApp';
import { Mark } from '../ui/Mark';
import { dim, ellipsis } from '../ui/styles';

const topPad = (extra: number) => `calc(var(--safe-top) + ${extra}px)`;

/**
 * Signing in with Google, above the username box.
 *
 * It is above it because for anybody who has been here before on another phone
 * it is the whole of the sign-in, and under the box it would be the thing you
 * find after typing. For everybody else it is one tap that makes this the last
 * time they type the username — which is what the line under it says, because
 * a Google button on a screen asking for a Sleeper username reads as a promise
 * to skip it, and it is not one. Sleeper has no Google sign-in; nothing here
 * can work out which Sleeper team is yours.
 *
 * Absent entirely when the app has no Google client configured, like every
 * other optional piece of this app.
 */
function GoogleBlock({ app }: { app: App }) {
  const host = useRef<HTMLDivElement | null>(null);
  const { googleOn, signInWithGoogle } = app;

  useEffect(() => {
    const el = host.current;
    if (!googleOn || !el) return;
    mountGoogleButton(el, t => { void signInWithGoogle(t); }, () => {
      // Their script is blocked or offline. The username box below is
      // untouched, so this is one missing shortcut and not a dead end.
      el.replaceChildren();
    });
  }, [googleOn, signInWithGoogle]);

  if (!googleOn) return null;
  return (
    <div style={{ marginBottom: 26 }}>
      <div ref={host} style={{ minHeight: 44, display: 'flex' }} />
      <div style={{ fontSize: 12, lineHeight: '18px', color: dim(0.52), marginTop: 10, textWrap: 'pretty' }}>
        {app.googleBusy
          ? 'Looking for your leagues…'
          : 'Your league follows your Google account, so a new phone is one tap. '
            + 'The first time, it asks which Sleeper account is yours — once, ever.'}
      </div>
      {app.googleError ? (
        <div role="alert" style={{ fontSize: 12, lineHeight: '18px', color: BAD, marginTop: 8 }}>
          {app.googleError}
        </div>
      ) : null}
    </div>
  );
}

function leagueMeta(l: SleeperLeague) {
  const type = l.settings?.type === 2 ? 'Dynasty' : l.settings?.type === 1 ? 'Keeper' : 'Redraft';
  const sflx = (l.roster_positions || []).indexOf('SUPER_FLEX') >= 0 ? ' · Superflex' : '';
  return `${l.total_rosters} teams · ${type}${sflx}`;
}

export function ConnectScreen({ app }: { app: App }) {
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: `${topPad(34)} 24px calc(var(--safe-bottom) + 26px)`,
        animation: 'fadeUp .4s ease backwards',
      }}
    >
      <div
        style={{
          width: 72, height: 72, borderRadius: '50%',
          animation: 'pulseGlow 3s ease-in-out infinite',
        }}
      >
        <Mark size={72} title="Doctors" />
      </div>
      <h1 style={{ fontSize: 31, lineHeight: '34px', fontWeight: 500, letterSpacing: '-0.025em', margin: '26px 0 8px' }}>
        Doctors
      </h1>
      <p style={{ fontSize: 13, lineHeight: '20px', color: dim(0.62), margin: '0 0 28px', maxWidth: '32ch' }}>
        {app.googleOn
          ? 'Sign in and your leagues are here. Read-only — nothing is ever changed in Sleeper.'
          : 'Connect your Sleeper account. Read-only.'}
      </p>

      <GoogleBlock app={app} />

      {/* The way in when there is no Google client configured. It is NOT a
          second door beside the Google button: where Google is on, this is
          reached once, from `LinkScreen`, and never again on any device. */}
      {app.googleOn ? null : <SleeperForm app={app} />}
    </div>
  );
}

/**
 * Naming the Sleeper account, which has to happen exactly once.
 *
 * Google says who a person is and nothing about which Sleeper team is theirs —
 * Sleeper publishes no way to ask. So the first time, somebody has to say. This
 * screen is that moment, and the copy is careful to be a continuation of the
 * sign-in rather than a second sign-in: you are already in, this is the last
 * thing standing between you and your leagues, and it will not be asked again
 * on this phone or any other.
 */
export function LinkScreen({ app }: { app: App }) {
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
        One last thing
      </h1>
      <p style={{ fontSize: 13, lineHeight: '20px', color: dim(0.62), margin: '0 0 28px', maxWidth: '32ch' }}>
        Which Sleeper account is yours? Google cannot tell us — Sleeper does not
        publish a way to ask — so you enter it once and never again, on this
        phone or any other.
      </p>

      <SleeperForm app={app} />

      <button
        type="button"
        onClick={app.logout}
        className="btn btn-ghost"
        style={{ marginTop: 16, alignSelf: 'flex-start', fontSize: 12 }}
      >
        Use a different Google account
      </button>
    </div>
  );
}

/** The username, the people who have used this phone, and the way on. */
function SleeperForm({ app }: { app: App }) {
  return (
    <>
      <label
        htmlFor="sleeper-user"
        style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: dim(0.52), marginBottom: 8 }}
      >
        Sleeper username
      </label>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--color-surface)', border: 'var(--hairline) solid var(--color-divider)',
          borderRadius: 12, padding: '13px 14px',
        }}
      >
        <span style={{ color: dim(0.52), fontSize: 15 }}>@</span>
        <input
          id="sleeper-user"
          value={app.username}
          onChange={e => app.setUsername(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void app.connectUser(); }}
          placeholder="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          style={{
            flex: 1, background: 'transparent', border: 0, outline: 'none',
            color: 'var(--color-text)', font: "500 16px 'Inter', system-ui", minWidth: 0,
          }}
        />
      </div>
      {app.authError ? (
        <div role="alert" style={{ fontSize: 12, lineHeight: '18px', color: BAD, marginTop: 10 }}>
          {app.authError}
        </div>
      ) : null}

      {/* Whoever has used this phone before. This is the screen a second
          person actually meets, so the choice belongs here rather than buried
          in Settings — and coming back to your own account should never mean
          typing a username from memory. */}
      {app.accounts.length ? (
        <div style={{ marginTop: 26 }}>
          <div style={{
            fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase',
            color: dim(0.52), marginBottom: 9,
          }}>
            Or carry on as
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {app.accounts.map(a => (
              <div key={a.username} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => app.switchAccount(a)}
                  className="row-tap"
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
                    background: 'var(--color-surface)', border: 'var(--hairline) solid var(--color-divider)',
                    borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
                    font: "500 14px 'Inter', system-ui", color: 'var(--color-text)', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 26, height: 26, flex: 'none', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 600, color: 'var(--color-accent)',
                    background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)',
                  }}>
                    {a.username.slice(0, 2).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>@{a.username}</span>
                </button>
                <button
                  type="button"
                  onClick={() => app.forgetAccount(a.username)}
                  aria-label={'Forget ' + a.username}
                  style={{
                    flex: 'none', background: 'none', border: 0, cursor: 'pointer',
                    color: dim(0.52), font: "400 12px 'Inter', system-ui", padding: '0 2px',
                  }}
                >
                  Forget
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 26 }} />
      <button
        type="button"
        onClick={() => void app.connectUser()}
        disabled={app.authBusy}
        style={{
          width: '100%', minHeight: 50, borderRadius: 12,
          border: '1px solid var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
          color: 'var(--color-accent)', font: "500 15px 'Inter', system-ui", cursor: 'pointer',
        }}
      >
        {app.authBusy ? 'Searching…' : 'Continue'}
      </button>
    </>
  );
}

export function LeaguesScreen({ app }: { app: App }) {
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: `${topPad(30)} 22px calc(var(--safe-bottom) + 26px)`,
        animation: 'slideIn .3s ease backwards', overflow: 'auto',
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
        @{app.username}
      </div>
      <h2 style={{ fontSize: 21, fontWeight: 500, letterSpacing: '-0.02em', margin: '8px 0 18px' }}>
        Choose your league
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {app.leagues.map(l => {
          const logo = leagueAvatar(l.avatar);
          return (
            <button
              key={l.league_id}
              type="button"
              className="pick-tap"
              onClick={() => app.pickLeague(l.league_id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
                borderRadius: 12, background: 'var(--color-surface)',
                border: 'var(--hairline) solid var(--color-divider)', cursor: 'pointer',
                color: 'inherit', textAlign: 'left', font: 'inherit',
              }}
            >
              {logo ? (
                <img src={logo} alt="" style={{ width: 36, height: 36, borderRadius: 8, flex: 'none', objectFit: 'cover' }} />
              ) : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{l.name}</div>
                <div style={{ fontSize: 12, color: dim(0.62), marginTop: 3 }}>{leagueMeta(l)}</div>
              </div>
              <span style={{ color: 'var(--color-accent)', fontSize: 15, flex: 'none' }}>›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BootScreen({ app }: { app: App }) {
  const { step, error } = app;
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: `${topPad(26)} 28px calc(var(--safe-bottom) + 60px)`, gap: 22,
      }}
    >
      {/* The mark, not a spinner. A ring says "something is happening"; he
          says who it is happening for, and the wait is long enough to be
          worth filling with the app's own face. */}
      <Mark size={72} alive />
      <div>
        <div style={{ fontSize: 21, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 6 }}>Reading your league</div>
        <div style={{ fontSize: 13, color: dim(0.62) }}>
          {error ? 'Loading stopped' : BOOT_STEPS[Math.min(step, 4)] + '…'}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {BOOT_STEPS.map((label, i) => (
          <div
            key={label}
            style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: i <= step ? dim(0.9) : dim(0.52) }}
          >
            <span style={{ width: 14, color: 'var(--color-accent)' }}>{i < step ? '✓' : i === step ? '›' : '·'}</span>
            {label}
          </div>
        ))}
      </div>
      {error ? (
        <div
          role="alert"
          style={{
            border: '1px solid color-mix(in srgb, var(--c-bad) 50%, transparent)',
            background: 'color-mix(in srgb, var(--c-bad) 8%, transparent)',
            borderRadius: 12, padding: 13,
          }}
        >
          <div style={{ fontSize: 12, lineHeight: '18px', color: BAD }}>{error}</div>
          <button type="button" onClick={app.retry} className="btn btn-secondary" style={{ marginTop: 10, borderRadius: 8 }}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
