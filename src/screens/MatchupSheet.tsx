import { benchRows, leaderOf, lineupRows, pairMatchups, type LineupCell, type MatchupSide } from '../model/matchups';
import type { DraftPos } from '../api/types';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { colorOf, POS } from '../model/constants';
import { byeOf } from '../model/sos';
import { Face, Overlay } from '../ui/primitives';
import { dim } from '../ui/styles';

/**
 * One game, on its own screen.
 *
 * Laid out the way a scoreboard is read rather than the way the data arrives:
 * a face, a name, what he scored, the slot he scored it in, and the same
 * again mirrored. The projection sits under each number in the same column,
 * so the comparison people actually make — did he beat what he was supposed
 * to — is two figures stacked rather than two columns apart.
 *
 * The bench is here too. It is not a formation, so there is no slot to pair it
 * by; it goes in order of what each man scored, which is the order the
 * question is asked in.
 *
 * Everything is derived from the same polled feed the scoreboard reads, so it
 * keeps moving while it is open.
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
  const players = app.data?.players || {};
  const starters = lineupRows(game, m.league.roster_positions, players, app.projections);
  const bench = benchRows(game, players, app.projections);

  return (
    <Overlay onClose={() => app.setDetail(null)} label={app.week ? 'Week ' + app.week : 'Week'} z={6}>
      <div className="ms-head">
        <Side s={game.a} winning={lead === 'a'} />
        <div className="ms-vs">{game.b ? 'vs' : 'bye'}</div>
        {game.b ? <Side s={game.b} winning={lead === 'b'} align="right" /> : <div style={{ flex: 1 }} />}
      </div>

      {starters.length ? (
        <Block app={app} title="Starters" rows={starters} />
      ) : (
        <div style={{ fontSize: 12.5, color: dim(0.45), textWrap: 'pretty' }}>
          Sleeper has not published the lineups for this week yet.
        </div>
      )}

      {bench.length ? <Block app={app} title="Bench" rows={bench} /> : null}

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
      {s.projected != null ? <div className="ms-proj">{s.projected.toFixed(1)}</div> : null}
    </div>
  );
}

function Block({ app, title, rows }: {
  app: App;
  title: string;
  rows: { slot: string; a: LineupCell | null; b: LineupCell | null }[];
}) {
  return (
    <div className="ms-block">
      <div className="ms-block-head">{title}</div>
      {rows.map((r, i) => (
        <div className="ms-row" key={title + r.slot + '-' + i}>
          <Cell app={app} c={r.a} />
          <Slot slot={r.slot} />
          <Cell app={app} c={r.b} align="right" />
        </div>
      ))}
    </div>
  );
}

/** The slot, in its position's colour — the spine the two sides hang off. */
function Slot({ slot }: { slot: string }) {
  const label = slot === 'SUPER_FLEX' ? 'SFLX' : slot === 'REC_FLEX' ? 'WRT' : slot.replace('_', ' ');
  const tint = POS.indexOf(slot as typeof POS[number]) >= 0 || slot === 'K' || slot === 'DEF'
    ? colorOf(slot as DraftPos)
    : null;
  return (
    <div
      className="ms-slot"
      style={tint
        ? { color: tint, background: 'color-mix(in srgb, ' + tint + ' 16%, transparent)' }
        : undefined}
    >
      {label}
    </div>
  );
}

function Cell({ app, c, align }: { app: App; c: LineupCell | null; align?: 'right' }) {
  const right = align === 'right';
  if (!c) return <div className="ms-cell" />;
  const tappable = !!c.id;
  const bye = c.team ? byeOf(c.team) : 0;
  return (
    <div
      className={'ms-cell' + (right ? ' is-right' : '') + (tappable ? ' is-tap' : '')}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable ? () => app.setDetail(c.id as string) : undefined}
      onKeyDown={tappable ? e => { if (e.key === 'Enter') app.setDetail(c.id as string); } : undefined}
    >
      <Face photo={c.id ? app.photoFor(c.id, 'thumb') : null} pos={c.pos || '—'} size={28} />
      <div className="ms-who">
        <div className="ms-pl-name">{c.name}</div>
        <div className="ms-pl-sub">
          {[c.pos, c.team ? c.team + (bye ? ' (' + bye + ')' : '') : ''].filter(Boolean).join(' · ')}
        </div>
      </div>
      {/* Scored over projected, in one column: the question is whether he beat
          it, and two figures stacked is that question. */}
      <div className="ms-num">
        <div className="ms-pl-pts">{c.points == null ? '—' : c.points.toFixed(2)}</div>
        {c.projected != null ? <div className="ms-pl-proj">{c.projected.toFixed(1)}</div> : null}
      </div>
    </div>
  );
}
