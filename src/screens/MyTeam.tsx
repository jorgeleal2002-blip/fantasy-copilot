import { useEffect } from 'react';
import { CELL_INK, slotFill } from '../model/constants';
import { clockFor, gameLine, phaseFor, type GamePhase } from '../model/game-clock';
import { benchRows, lineupRows, pairMatchups, type LineupCell, type MatchupSide } from '../model/matchups';
import { statLine, touchdowns } from '../model/stat-line';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { Face, TdBalls } from '../ui/primitives';

/**
 * Your own lineup for the week, the way Sleeper's TEAM tab has it: a row per
 * slot with the man in it, when and who he plays, what he has done and what
 * he was projected for — then the bench. Everything comes off the same live
 * scoreboard the matchup screens read, so it moves while games are on.
 */
export function MyTeam({ app, m }: { app: App; m: Model }) {
  const week = app.week;
  // The stat lines under each name — one payload for the whole league.
  useEffect(() => { if (week) void app.fetchWeekStats(week); }, [app.fetchWeekStats, week]);
  const season = Number(m.league.season);
  const now = Date.now();
  const players = app.data?.players || {};
  const games = pairMatchups(m.leagueRows, app.matchups, app.projections,
    clockFor(players, week, m.league.season, now, app.nflGames));
  const g = games.find(x => x.hasMe);

  if (!week || !g) {
    return (
      <div className="mt-note">
        {app.matchupState === 'loading' ? 'Reading your lineup…' : 'No lineup for you this week.'}
      </div>
    );
  }

  const me = g.a.isMe ? g.a : (g.b as MatchupSide);
  const opp = g.a.isMe ? g.b : g.a;
  const starters = lineupRows(g, m.league.roster_positions, players, app.projections)
    .map(r => ({ slot: r.slot, c: g.a.isMe ? r.a : r.b }))
    .filter((r): r is { slot: string; c: LineupCell } => !!r.c);
  const bench = benchRows(g, players, app.projections)
    .map(r => (g.a.isMe ? r.a : r.b))
    .filter((c): c is LineupCell => !!c);

  const phase = (c: LineupCell): GamePhase | null =>
    c.id ? phaseFor(players[c.id]?.team, week, season, now, app.nflGames) : null;
  const left = starters.filter(r => phase(r.c) === 'pre').length;
  const playing = starters.filter(r => phase(r.c) === 'live').length;
  const gameId = 'matchup-' + [g.a.rosterId, g.b?.rosterId].filter(n => n != null).join('-');
  const openGame = () => app.setDetail(gameId);
  const pa = me.projected, pb = opp?.projected ?? null;
  const split = pa != null && pb != null && pa + pb > 0 ? pa / (pa + pb) : null;

  return (
    <div className="mt-wrap">
      <div
        className="mt-head"
        role="button"
        tabIndex={0}
        onClick={openGame}
        onKeyDown={e => { if (e.key === 'Enter') openGame(); }}
      >
        <div className="mt-score">
          <Team s={me} up={lead(me, opp)} />
          <span className="mt-vs">VS</span>
          {opp ? <Team s={opp} up={lead(opp, me)} right /> : <div className="mt-team is-right"><div className="mt-tname">Bye</div></div>}
        </div>
        {split != null ? (
          <div className="mt-bar"><div className="mt-bar-a" style={{ width: (split * 100).toFixed(1) + '%' }} /></div>
        ) : null}
        <div className="mt-head-foot">
          <span>Week {week}{me.record ? ' · ' + me.record : ''}</span>
          <span>
            {playing ? <b className="mt-live">● {playing} playing</b> : null}
            {playing && left ? ' · ' : ''}
            {left ? left + ' yet to play' : playing ? '' : 'All played'}
          </span>
        </div>
      </div>

      <div className="mt-list">
        <div className="mt-list-h">Starters</div>
        {starters.map((r, i) => <Row key={'s' + i} app={app} m={m} slot={r.slot} c={r.c} phase={phase(r.c)} />)}
      </div>

      {bench.length ? (
        <div className="mt-list">
          <div className="mt-list-h">Bench</div>
          {bench.map((c, i) => <Row key={'b' + i} app={app} m={m} slot="BN" c={c} phase={phase(c)} />)}
        </div>
      ) : null}
    </div>
  );
}

const lead = (a: MatchupSide, b: MatchupSide | null) =>
  !!b && a.points != null && b.points != null && a.points > b.points;

function Team({ s, up, right }: { s: MatchupSide; up: boolean; right?: boolean }) {
  return (
    <div className={'mt-team' + (right ? ' is-right' : '')}>
      {s.avatar ? <img className="mt-av" src={s.avatar} alt="" /> : <div className="mt-av" />}
      <div className="mt-team-body">
        <div className={'mt-tname' + (s.isMe ? ' is-me' : '')}>{s.name}</div>
        <div className={'mt-tpts' + (up ? ' is-up' : '')}>{s.points == null ? '—' : s.points.toFixed(2)}</div>
        {s.projected != null ? <div className="mt-tproj">proj {s.projected.toFixed(1)}</div> : null}
      </div>
    </div>
  );
}

function Row({ app, m, slot, c, phase }: {
  app: App; m: Model; slot: string; c: LineupCell; phase: GamePhase | null;
}) {
  const label = slot === 'SUPER_FLEX' ? 'SFLX' : slot === 'REC_FLEX' ? 'WRT' : slot.replace('_', ' ');
  const when = c.team ? gameLine(c.team, app.week, Number(m.league.season), Date.now(), app.nflGames) : null;
  const st = c.id ? app.weekStats[c.id] : undefined;
  const did = c.id ? statLine(st, c.pos) : '';
  const open = c.id ? () => app.setDetail(c.id as string) : undefined;
  return (
    <div
      className={'mt-row' + (open ? ' is-tap' : '') + (phase === 'live' ? ' is-live' : '')}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      onClick={open}
      onKeyDown={open ? e => { if (e.key === 'Enter') open(); } : undefined}
    >
      <div className="mt-slot" style={slot === 'BN' ? undefined : { background: slotFill(slot), color: CELL_INK }}>
        {label}
      </div>
      <Face {...(c.id ? app.photoSet(c.id) : { photo: null })} pos={c.pos || '—'} size={36} />
      <div className="mt-who">
        <div className="mt-pl">{c.name}</div>
        <div className={'mt-when' + (phase === 'live' ? ' is-live' : '')}>
          {c.id ? [c.team, when].filter(Boolean).join(' · ') : 'Empty slot'}
        </div>
        {did ? (
          <div className="mt-did">
            <TdBalls n={touchdowns(st)} />
            {did}
          </div>
        ) : null}
      </div>
      <div className="mt-num">
        <div className={'mt-pl-pts' + (phase === 'live' ? ' is-live' : '')}>
          {c.points == null || phase === 'pre' ? '–' : c.points.toFixed(2)}
        </div>
        {c.projected != null ? <div className="mt-pl-proj">proj {c.projected.toFixed(1)}</div> : null}
      </div>
    </div>
  );
}
