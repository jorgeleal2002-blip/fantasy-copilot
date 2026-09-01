import { leagueAvatar } from '../api/sleeper';
import type { SleeperLeague } from '../api/types';
import { BOOT_STEPS, type App } from '../state/useApp';
import { Mark } from '../ui/Mark';
import { dim, ellipsis } from '../ui/styles';

const topPad = (extra: number) => `calc(var(--safe-top) + ${extra}px)`;

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
        <Mark size={72} title="Doctors Fantasy" />
      </div>
      <h1 style={{ fontSize: 30, lineHeight: 1.1, fontWeight: 500, letterSpacing: '-0.025em', margin: '26px 0 8px' }}>
        Doctors Fantasy
      </h1>
      <p style={{ fontSize: 13.5, lineHeight: 1.5, color: dim(0.5), margin: '0 0 28px', maxWidth: '30ch' }}>
        Connect your Sleeper account. Read-only.
      </p>

      <label
        htmlFor="sleeper-user"
        style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: dim(0.4), marginBottom: 8 }}
      >
        Sleeper username
      </label>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--color-surface)', border: '1px solid var(--color-divider)',
          borderRadius: 11, padding: '13px 14px',
        }}
      >
        <span style={{ color: dim(0.32), fontSize: 15 }}>@</span>
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
        <div role="alert" style={{ fontSize: 12.5, lineHeight: 1.45, color: '#d9a08e', marginTop: 10 }}>
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
            color: dim(0.4), marginBottom: 9,
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
                    background: 'var(--color-surface)', border: '1px solid var(--color-divider)',
                    borderRadius: 11, padding: '12px 14px', cursor: 'pointer',
                    font: "500 14px 'Inter', system-ui", color: 'var(--color-text)', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 26, height: 26, flex: 'none', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10.5, fontWeight: 600, color: 'var(--color-accent)',
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
                    color: dim(0.35), font: "400 12px 'Inter', system-ui", padding: '0 2px',
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
    </div>
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
      <h2 style={{ fontSize: 23, fontWeight: 500, letterSpacing: '-0.02em', margin: '8px 0 18px' }}>
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
                border: '1px solid var(--color-divider)', cursor: 'pointer',
                color: 'inherit', textAlign: 'left', font: 'inherit',
              }}
            >
              {logo ? (
                <img src={logo} alt="" style={{ width: 36, height: 36, borderRadius: 9, flex: 'none', objectFit: 'cover' }} />
              ) : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: '-0.01em', ...ellipsis }}>{l.name}</div>
                <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 3 }}>{leagueMeta(l)}</div>
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
      <div
        style={{
          width: 44, height: 44, borderRadius: '50%',
          border: '2px solid color-mix(in srgb, var(--color-accent) 22%, transparent)', borderTopColor: 'var(--color-accent)',
          animation: 'spin 1s linear infinite',
        }}
      />
      <div>
        <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 6 }}>Reading your league</div>
        <div style={{ fontSize: 13, color: dim(0.5) }}>
          {error ? 'Loading stopped' : BOOT_STEPS[Math.min(step, 4)] + '…'}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {BOOT_STEPS.map((label, i) => (
          <div
            key={label}
            style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: i <= step ? dim(0.8) : dim(0.3) }}
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
            border: '1px solid rgba(217,160,142,.5)', background: 'rgba(217,160,142,.08)',
            borderRadius: 11, padding: 13,
          }}
        >
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#d9a08e' }}>{error}</div>
          <button type="button" onClick={app.retry} className="btn btn-secondary" style={{ marginTop: 10, borderRadius: 9 }}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
