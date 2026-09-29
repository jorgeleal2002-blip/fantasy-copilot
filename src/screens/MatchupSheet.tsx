import { lineupRows, pairMatchups, leaderOf, type LineupCell, type MatchupSide } from '../model/matchups';
import type { DraftPos } from '../api/types';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { colorOf } from '../model/constants';
import { Overlay } from '../ui/primitives';
import { dim } from '../ui/styles';

/**
 * One game, on its own screen.
 *
 * It used to open inside the card it was on, which meant reading nine slots
 * through a six-card list: the lineup you came for was squeezed between two
 * other people's games and the head of it scrolled away as you went down. A
 * game is the thing being looked at, so it gets the screen.
 *
 * Everything here is derived from the same polled feed the scoreboard reads,
 * so it keeps moving while it is open — scores, and the projections that now
 * walk with them.
 */
export function MatchupSheet({ app, m, ids }: { app: App; m: Model; ids: number[] }) {
  const games = pairMatchups(m.leagueRows, app.matchups, app.projections);
  const game = games.find(g => ids.includes(g.a.rosterId) && (g.b ? ids.includes(g.b.rosterId) : ids.length === 1));

  if (!game) {
    return (
      <Overlay onClose={() => app.setDetail(null)} label="Week" z={6}>
        <div style={{ fontSize: 14, color: dim(0.6) }}>This game is not on the board any more.</div>
      </Overlay>
    );
  }

  const lead = leaderOf(game);
  const rows = lineupRows(game, m.league.roster_positions, app.data?.players || {}, app.projections);

  return (
    <Overlay onClose={() => app.setDetail(null)} label={app.week ? 'Week ' + app.week : 'Week'} z={6}>
      <div className="ms-head">
        <Side s={game.a} winning={lead === 'a'} />
        <div className="ms-vs">{game.b ? 'vs' : 'bye'}</div>
        {game.b ? <Side s={game.b} winning={lead === 'b'} align="right" /> : <div style={{ flex: 1 }} />}
      </div>

      {rows.length ? (
        <div className="ms-lineup">
          {rows.map((r, i) => (
            <div className="ms-row" key={r.slot + '-' + i}>
              <Cell app={app} c={r.a} />
              <div className="ms-slot">{r.slot === 'SUPER_FLEX' ? 'SFLX' : r.slot.replace('_', ' ')}</div>
              <Cell app={app} c={r.b} align="right" />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: dim(0.45), textWrap: 'pretty' }}>
          Sleeper has not published the lineups for this week yet.
        </div>
      )}

      {/* Only when there is something to say. A projection that is simply
          absent, with no reason given, is the hardest kind of missing number
          to report — and the explanation of one that IS there belongs nowhere,
          which is why it no longer sits under every game. */}
      {app.projState === 'fail' ? (
        <div style={{ fontSize: 11, color: dim(0.33), textWrap: 'pretty' }}>
          Sleeper did not return projections for this week. It retries on its own.
        </div>
      ) : null}
    </Overlay>
  );
}

const score = (p: number | null) => (p == null ? '—' : p.toFixed(2));

function Side({ s, winning, align }: { s: MatchupSide; winning: boolean; align?: 'right' }) {
  const right = align === 'right';
  const sub = [s.user ? '@' + s.user : '', s.record].filter(Boolean).join(' · ');
  return (
    <div className={'ms-side' + (right ? ' is-right' : '')}>
      {s.avatar
        ? <img className="ms-av" src={s.avatar} alt="" />
        : <div className="ms-av ms-av-blank" />}
      <div className={'ms-name' + (s.isMe ? ' is-me' : '')}>{s.name}</div>
      {sub ? <div className="ms-sub">{sub}</div> : null}
      <div className={'ms-pts' + (winning ? ' is-up' : '')}>{score(s.points)}</div>
      {s.projected != null ? <div className="ms-proj">{'proj ' + s.projected.toFixed(1)}</div> : null}
    </div>
  );
}

function Cell({ app, c, align }: { app: App; c: LineupCell | null; align?: 'right' }) {
  const right = align === 'right';
  if (!c) return <div className="ms-cell" />;
  const tappable = !!c.id;
  return (
    <div
      className={'ms-cell' + (right ? ' is-right' : '') + (tappable ? ' is-tap' : '')}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable ? () => app.setDetail(c.id as string) : undefined}
      onKeyDown={tappable ? e => { if (e.key === 'Enter') app.setDetail(c.id as string); } : undefined}
    >
      <span className="ms-dot" style={{ background: c.pos ? colorOf(c.pos as DraftPos) : 'transparent' }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="ms-pl-name">{c.name}</div>
        <div className="ms-pl-sub">
          {[c.pos, c.team].filter(Boolean).join(' · ')}
          {c.projected != null ? ' · ' + c.projected.toFixed(1) + ' proj' : ''}
        </div>
      </div>
      <div className="ms-pl-pts">{c.points == null ? '—' : c.points.toFixed(1)}</div>
    </div>
  );
}
