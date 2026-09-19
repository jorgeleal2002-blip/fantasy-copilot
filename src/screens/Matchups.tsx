import { useState } from 'react';
import {
  leaderOf, lineupRows, pairMatchups,
  type LineupCell, type Matchup, type MatchupSide,
} from '../model/matchups';
import type { DraftPos } from '../api/types';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { colorOf } from '../model/constants';
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
      ) : games.map((g, i) => <Game key={(g.id ?? 'bye') + '-' + i} app={app} m={m} g={g} />)}
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

function Game({ app, m, g }: { app: App; m: Model; g: Matchup }) {
  // Your own game opens by itself. It is the one the screen was opened for,
  // and making you tap it to see your own lineup is a tap with no question
  // behind it.
  const [open, setOpen] = useState(g.hasMe);
  const lead = leaderOf(g);
  const rows = open ? lineupRows(g, m.league.roster_positions, app.data?.players || {}) : [];

  return (
    <div className={'mu-card' + (g.hasMe ? ' is-mine' : '')}>
      <div
        className="mu-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
      >
        <Side s={g.a} winning={lead === 'a'} />
        {/* The chevron replaces "vs" rather than joining it: two marks in a
            34px column is a column of marks, and the one that says the card
            does something is the one worth keeping. */}
        <div className={'mu-vs' + (open ? ' is-open' : '')}>{g.b ? (open ? '▾' : '▸') : 'bye'}</div>
        {g.b ? <Side s={g.b} winning={lead === 'b'} align="right" /> : <div style={{ flex: 1 }} />}
      </div>

      {open ? (
        rows.length ? (
          <div className="mu-lineup">
            {rows.map((r, i) => (
              <div className="mu-row" key={r.slot + '-' + i}>
                <Cell app={app} c={r.a} />
                <div className="mu-slot">{r.slot === 'SUPER_FLEX' ? 'SFLX' : r.slot.replace('_', ' ')}</div>
                <Cell app={app} c={r.b} align="right" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mu-empty">
            Sleeper has not published the lineups for this week yet.
          </div>
        )
      ) : null}
    </div>
  );
}

/** One player on one side of a slot. Tapping him opens his card, which is what
 *  every other list of players in the app does. */
function Cell({ app, c, align }: { app: App; c: LineupCell | null; align?: 'right' }) {
  const right = align === 'right';
  if (!c) return <div className="mu-cell" />;
  const tappable = !!c.id;
  return (
    <div
      className={'mu-cell' + (right ? ' is-right' : '') + (tappable ? ' is-tap' : '')}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable ? () => app.setDetail(c.id as string) : undefined}
      onKeyDown={tappable ? e => { if (e.key === 'Enter') app.setDetail(c.id as string); } : undefined}
    >
      <div className="mu-pl">
        <span className="mu-dot" style={{ background: c.pos ? colorOf(c.pos as DraftPos) : 'transparent' }} />
        <span className="mu-pl-name">{c.name}</span>
      </div>
      <div className="mu-pl-pts">{c.points == null ? '—' : c.points.toFixed(1)}</div>
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
