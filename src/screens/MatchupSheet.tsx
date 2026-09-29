import { useEffect } from 'react';
import { benchRows, leaderOf, lineupRows, pairMatchups, type LineupCell, type MatchupSide } from '../model/matchups';
import type { DraftPos } from '../api/types';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { colorOf, POS } from '../model/constants';
import { byeOf } from '../model/sos';
import { statLine } from '../model/stat-line';
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
  // The whole league's week in one payload, so it is asked for here — the one
  // screen that draws a stat line — rather than polled beside the scores.
  const wk = app.week;
  useEffect(() => { if (wk) void app.fetchWeekStats(wk); }, [app.fetchWeekStats, wk]);

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

  /* Where each of them sits in the standings, which is the one number a
   * scoreboard header is missing: a record says how a team has done and a
   * place says what that is worth in this league. Wins, then points scored,
   * which is how a league breaks its own ties. */
  const order = m.leagueRows.slice().sort((a, b) =>
    b.record.wins - a.record.wins || b.record.pointsFor - a.record.pointsFor);
  const placeOf = (rosterId: number) => {
    const i = order.findIndex(r => r.id === rosterId);
    const row = order[i];
    if (i < 0 || !row || (row.record.wins + row.record.losses + row.record.ties) === 0) return 0;
    return i + 1;
  };

  /* The bar is the two projections against each other and nothing more. It is
   * not a win probability: that needs the spread of what is left to be played,
   * which nothing here measures, and a confident "100% WIN" that is wrong is
   * the worst number a scoreboard can carry. */
  const pa = game.a.projected;
  const pb = game.b?.projected ?? null;
  const split = pa != null && pb != null && pa + pb > 0 ? pa / (pa + pb) : null;
  const edge = pa != null && pb != null ? pa - pb : null;
  const starters = lineupRows(game, m.league.roster_positions, players, app.projections);
  const bench = benchRows(game, players, app.projections);

  return (
    <Overlay
      onClose={() => app.setDetail(null)}
      label={app.week ? 'Week ' + app.week : 'Week'}
      z={6}
      onRefresh={app.refreshScores}
    >
      <div className="ms-head">
        <div className="ms-scores">
          <Av s={game.a} />
          <div className="ms-score">
            <div className={'ms-pts' + (lead === 'a' ? ' is-up' : '')}>{score(game.a.points)}</div>
            {game.a.projected != null ? <div className="ms-proj">{game.a.projected.toFixed(1)}</div> : null}
          </div>
          <div className="ms-vs">{game.b ? 'vs' : 'bye'}</div>
          <div className="ms-score is-right">
            <div className={'ms-pts' + (lead === 'b' ? ' is-up' : '')}>{score(game.b?.points ?? null)}</div>
            {game.b?.projected != null ? <div className="ms-proj">{game.b.projected.toFixed(1)}</div> : null}
          </div>
          {game.b ? <Av s={game.b} /> : <div style={{ width: 42, flex: 'none' }} />}
        </div>

        {split != null ? (
          <div className="ms-bar" role="img" aria-label="projected split">
            <div className="ms-bar-fill" style={{ width: (split * 100).toFixed(1) + '%' }} />
          </div>
        ) : null}
        {edge != null ? (
          <div className={'ms-edge' + (edge < 0 ? ' is-right' : '')}>
            {(edge >= 0 ? '+' : '') + edge.toFixed(1) + ' projected'}
          </div>
        ) : null}

        <div className="ms-names">
          <Who s={game.a} place={placeOf(game.a.rosterId)} />
          {game.b ? <Who s={game.b} place={placeOf(game.b.rosterId)} align="right" /> : <div style={{ flex: 1 }} />}
        </div>
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

function Av({ s }: { s: MatchupSide }) {
  return s.avatar
    ? <img className="ms-av" src={s.avatar} alt="" />
    : <div className="ms-av ms-av-blank" />;
}

function Who({ s, place, align }: { s: MatchupSide; place: number; align?: 'right' }) {
  const sub = [s.record + (place ? ' (#' + place + ')' : ''), s.user ? '@' + s.user : '']
    .filter(Boolean);
  return (
    <div className={'ms-who-team' + (align === 'right' ? ' is-right' : '')}>
      <div className={'ms-name' + (s.isMe ? ' is-me' : '')}>{s.name}</div>
      {sub.length ? <div className="ms-sub">{(align === 'right' ? sub : sub.slice().reverse()).join(' · ')}</div> : null}
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
  const did = c.id ? statLine(app.weekStats[c.id], c.pos) : '';
  return (
    <div
      className={'ms-cell' + (right ? ' is-right' : '') + (tappable ? ' is-tap' : '')}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable ? () => app.setDetail(c.id as string) : undefined}
      onKeyDown={tappable ? e => { if (e.key === 'Enter') app.setDetail(c.id as string); } : undefined}
    >
      <div className="ms-cell-top">
        <Face {...(c.id ? app.photoSet(c.id) : { photo: null })} pos={c.pos || '—'} size={30} />
        <div className="ms-who">
          <div className="ms-pl-name">{c.name}</div>
          <div className="ms-pl-sub">
            {[c.pos, c.team ? c.team + (bye ? ' (' + bye + ')' : '') : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
        {/* Scored over projected, in one column: the question is whether he
            beat it, and two figures stacked is that question. */}
        <div className="ms-num">
          <div className="ms-pl-pts">{c.points == null ? '—' : c.points.toFixed(2)}</div>
          {c.projected != null ? <div className="ms-pl-proj">{c.projected.toFixed(1)}</div> : null}
        </div>
      </div>
      {/* What he actually did, across the whole of his half rather than down
          the sliver left between a face and a score. A number of points says
          how much he was worth and nothing about how he got there. */}
      {did ? <div className="ms-pl-did">{did}</div> : null}
    </div>
  );
}
