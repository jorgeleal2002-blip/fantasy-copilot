import { leaderOf, pairMatchups, type Matchup, type MatchupSide } from '../model/matchups';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { dim } from '../ui/styles';

const LAST_WEEK = 18;

/** Sleeper reports 0 before kickoff, which is a score; null means no row. */
const score = (p: number | null) => (p == null ? '—' : p.toFixed(2));

/**
 * The week's head-to-heads, laid out the way a scoreboard is: the two teams
 * facing each other on one card, yours at the top.
 *
 * Points come from the same feed the app already reads and refresh themselves
 * while games are on, so this is the one screen that changes under you.
 */
export function Matchups({ app, m }: { app: App; m: Model }) {
  const week = app.week;
  const games = pairMatchups(m.leagueRows, app.matchups);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Previous week"
          disabled={!week || week <= 1}
          onClick={() => week && app.setWeek(week - 1)}
          style={{ fontSize: 15, padding: '0 4px' }}
        >
          ‹
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 500 }}>
          {week ? 'Week ' + week : 'Matchups'}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Next week"
          disabled={!week || week >= LAST_WEEK}
          onClick={() => week && app.setWeek(week + 1)}
          style={{ fontSize: 15, padding: '0 4px' }}
        >
          ›
        </button>
      </div>

      {app.matchupState === 'fail' ? (
        <Note>Sleeper did not return this week&apos;s scores. It retries on its own.</Note>
      ) : !games.length ? (
        <Note>
          {app.matchupState === 'loading'
            ? 'Reading the scoreboard…'
            : 'No schedule published for this week yet.'}
        </Note>
      ) : games.map((g, i) => <Game key={(g.id ?? 'bye') + '-' + i} g={g} />)}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--color-surface)', borderRadius: 12, padding: '14px 13px',
      fontSize: 12.5, color: dim(0.5),
    }}>
      {children}
    </div>
  );
}

function Game({ g }: { g: Matchup }) {
  const lead = leaderOf(g);
  return (
    <div className={'mu-card' + (g.hasMe ? ' is-mine' : '')}>
      <Side s={g.a} winning={lead === 'a'} />
      <div className="mu-vs">{g.b ? 'vs' : 'bye'}</div>
      {g.b ? <Side s={g.b} winning={lead === 'b'} align="right" /> : <div style={{ flex: 1 }} />}
    </div>
  );
}

function Side({ s, winning, align }: { s: MatchupSide; winning: boolean; align?: 'right' }) {
  const right = align === 'right';
  return (
    <div className={'mu-side' + (right ? ' is-right' : '')}>
      {s.avatar
        ? <img className="mu-av" src={s.avatar} alt="" />
        : <div className="mu-av mu-av-blank" />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className={'mu-name' + (s.isMe ? ' is-me' : '')}>{s.name}</div>
        {/* Bold on the leader rather than a colour: at 0-0 nobody is winning,
            and a green score before kickoff would say otherwise. */}
        <div className={'mu-pts' + (winning ? ' is-up' : '')}>{score(s.points)}</div>
      </div>
    </div>
  );
}
