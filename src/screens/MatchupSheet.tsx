import { Fragment, useEffect } from 'react';
import { benchRows, leaderOf, lineupRows, pairMatchups, type LineupCell, type MatchupSide } from '../model/matchups';
import type { Model } from '../model/types';
import type { App } from '../state/useApp';
import { CELL_INK, slotFill } from '../model/constants';
import { clockFor } from '../model/game-clock';
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
  const season = m.league.season;
  useEffect(() => { if (wk) void app.fetchWeekStats(wk); }, [app.fetchWeekStats, wk]);

  const games = pairMatchups(m.leagueRows, app.matchups, app.projections,
    clockFor(app.data?.players || {}, wk, season, Date.now()));
  const game = games.find(g => ids.includes(g.a.rosterId) && (g.b ? ids.includes(g.b.rosterId) : ids.length === 1));

  if (!game) {
    return (
      <Overlay onClose={() => app.setDetail(null)} label="Week" z={6}>
        <div style={{ fontSize: 13, color: dim(0.75) }}>This game is not on the board any more.</div>
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

  /* What state this week is in, which a scoreboard says and this one did not:
   * 0.00 against 0.00 is three different facts — a week that has not kicked
   * off, a week nobody has played yet, and a feed that failed — and the card
   * drew the same thing for all three. The league's own clock answers it. */
  const played = (game.a.points || 0) + (game.b?.points || 0) > 0;
  const state = app.nflWeek == null || app.week == null ? null
    : app.week > app.nflWeek ? 'Upcoming'
      : app.week < app.nflWeek ? 'Final'
        : played ? 'Live' : 'Not started';

  return (
    <Overlay
      onClose={() => app.setDetail(null)}
      label={app.week ? 'Week ' + app.week : 'Week'}
      z={6}
      onRefresh={app.refreshScores}
    >
      {/* A card, not a column of loose text on the page ground. A scoreboard is
          one object — two teams and the state between them — and the thing that
          says so is an edge around it. Everything below is a list, and a list
          under a bordered block reads as the detail of it. */}
      <div className="ms-board">
        {/* Who, then what they scored. It used to run the other way: two large
            numbers with a face each, then the bar, then the projected margin,
            and only under all of it the names — so you read 148.62 and had a
            paragraph to cross before learning whose it was.

            The names take the whole width rather than sitting beside the
            avatars. Indented past a portrait they have about 98px, and
            "@vergarahater · 1-2 (#9)" wants 115 — tried, and it cut every
            record on the card to "3-0 (...". At full width they have 150 and
            the avatar is directly under its own name anyway. */}
        <div className="ms-names">
          <Who s={game.a} place={placeOf(game.a.rosterId)} />
          {game.b ? <Who s={game.b} place={placeOf(game.b.rosterId)} align="right" /> : <div style={{ flex: 1 }} />}
        </div>

        <div className="ms-scores">
          <Av s={game.a} />
          <div className="ms-score">
            <div className={'ms-pts' + (lead === 'a' ? ' is-up' : '')}>{score(game.a.points)}</div>
            {game.a.projected != null
              ? <div className="ms-proj">proj {game.a.projected.toFixed(1)}</div> : null}
          </div>
          {/* The two teams' own faces, behind the mark, meeting where they
              play each other. It is a background and is treated as one: dim
              enough that the figures either side of it stay readable over a
              white avatar, which is the case it has to survive — see the note
              on `.ms-vs-crest`. */}
          <div className="ms-vs">
            {game.a.avatar || game.b?.avatar ? (
              <span className="ms-vs-crest" aria-hidden="true">
                <span className="ms-vs-half" style={bg(game.a.avatar)} />
                {/* A bye has one team, so one face fills the circle. */}
                {game.b ? <span className="ms-vs-half" style={bg(game.b.avatar)} /> : null}
              </span>
            ) : null}
            <span className="ms-vs-txt">{game.b ? 'vs' : 'bye'}</span>
          </div>
          <div className="ms-score is-right">
            <div className={'ms-pts' + (lead === 'b' ? ' is-up' : '')}>{score(game.b?.points ?? null)}</div>
            {game.b?.projected != null
              ? <div className="ms-proj">proj {game.b.projected.toFixed(1)}</div> : null}
          </div>
          {game.b ? <Av s={game.b} /> : <div className="ms-av-sp" />}
        </div>

        {split != null ? (
          <div className="ms-split">
            {/* Two colours meeting, not one fill on a track. A single bar on
                grey reads as a progress bar — a thing filling up — and this is
                a tug of war: both ends are a team and the seam is the question.
                The tick marks even, so a split near the middle is readable as
                near the middle rather than guessed at. */}
            <div className="ms-bar" role="img"
              aria-label={'projected split ' + Math.round(split * 100) + ' to ' + Math.round((1 - split) * 100)}>
              <div className={'ms-bar-a' + (game.a.isMe ? ' is-me' : '')} style={{ width: (split * 100).toFixed(1) + '%' }} />
              <div className="ms-bar-tick" />
            </div>
            <Foot state={state} edge={edge} />
          </div>
        ) : state ? <Foot state={state} edge={null} /> : null}
      </div>

      {starters.length ? (
        <Block app={app} title="Starters" rows={starters} />
      ) : (
        <div style={{ fontSize: 12, color: dim(0.62), textWrap: 'pretty' }}>
          Sleeper has not published the lineups for this week yet.
        </div>
      )}

      {bench.length ? <Block app={app} title="Bench" rows={bench} /> : null}

      {app.projState === 'fail' ? (
        <div style={{ fontSize: 10, color: dim(0.52), textWrap: 'pretty' }}>
          Sleeper did not return projections for this week. It retries on its own.
        </div>
      ) : null}
    </Overlay>
  );
}

const score = (p: number | null) => (p == null ? '—' : p.toFixed(2));

/* The week's state and the projected margin on one line, under the bar — the
 * header above the sheet already names the week, so a row of its own for the
 * state was height spent on a word. The margin sits on the side it favours and
 * the state takes the other. */
function Foot({ state, edge }: { state: string | null; edge: number | null }) {
  const right = edge != null && edge < 0;
  const pill = state ? <span className={'ms-state is-' + state.split(' ')[0].toLowerCase()}>{state}</span> : <span />;
  const margin = edge != null
    ? <span className="ms-edge">{(edge >= 0 ? '+' : '') + edge.toFixed(1) + ' projected margin'}</span>
    : <span />;
  return <div className="ms-foot">{right ? <>{pill}{margin}</> : <>{margin}{pill}</>}</div>;
}

/** A team's own picture as a background, or nothing where it has none. */
const bg = (url: string | null) =>
  (url ? { backgroundImage: 'url("' + encodeURI(url) + '")' } : undefined);

function Av({ s }: { s: MatchupSide }) {
  return s.avatar
    ? <img className="ms-av" src={s.avatar} alt="" />
    : <div className="ms-av ms-av-blank" />;
}

/**
 * A team's name, and under it the two facts about them a scoreboard wants.
 *
 * The record and the place are one span and the handle is another, rather than
 * one joined string, so that the HANDLE is what truncates. Joined, whichever
 * fact happened to be last died — and the two sides are mirrored, so on the
 * left that was the record. On a 375px screen "3-0 (#2) · @ManuelMont" does not
 * fit either way; losing "@ManuelMon…" costs nothing, and losing the record
 * costs the only competitive fact on the card.
 *
 * The records sit on the INSIDE, nearest the centre, on both sides: they are
 * what the two teams are being compared on, and a comparison reads best with
 * its terms together.
 */
function Who({ s, place, align }: { s: MatchupSide; place: number; align?: 'right' }) {
  const rec = s.record + (place ? ' (#' + place + ')' : '');
  const user = s.user ? '@' + s.user : '';
  const parts = [
    rec ? <span className="ms-rec" key="r">{rec}</span> : null,
    user ? <span className="ms-user" key="u">{user}</span> : null,
  ].filter(Boolean);
  const ordered = align === 'right' ? parts : parts.slice().reverse();
  return (
    <div className={'ms-who-team' + (align === 'right' ? ' is-right' : '')}>
      <div className={'ms-name' + (s.isMe ? ' is-me' : '')}>{s.name}</div>
      {ordered.length ? (
        <div className="ms-sub">
          {ordered.map((el, i) => (
            <Fragment key={i}>
              {i ? <span className="ms-dot">·</span> : null}
              {el}
            </Fragment>
          ))}
        </div>
      ) : null}
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
/**
 * The slot, as a filled block rather than a tinted outline.
 *
 * Measured against Sleeper's own starters screen, on the same phone: 4.3 to
 * 6.2 per cent of their pixels are bright and 4.4 to 4.5 per cent carry real
 * colour, against 1.9 and 1.2 here. Doubling the chroma of the palette does not
 * move that, because chroma is a property of a colour and this is a property of
 * AREA — they fill blocks, this filled thin text and six-pixel bars. Their
 * position chip is the clearest instance: a solid pastel square with dark type
 * on it, in every row.
 *
 * The colours are the ones the draft board has always used for exactly this,
 * so nothing new is invented — a filled cell there is already a block of the
 * position's own colour with `CELL_INK` on top.
 */
function Slot({ slot }: { slot: string }) {
  const label = slot === 'SUPER_FLEX' ? 'SFLX' : slot === 'REC_FLEX' ? 'WRT' : slot.replace('_', ' ');
  return (
    <div className="ms-slot" style={{ background: slotFill(slot), color: CELL_INK }}>
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
      {/* The name gets the cell's whole width, above the row rather than in it.
          Beside a face and a score there were 65 pixels left for it, so "J.
          Smith-Njigba" came out "J. Smith-..." and "D. Montgomery" as "D.
          Montgo..." — on the screen whose subject is which of two players did
          more. Nothing else in the cell is text that can be read wrong when it
          is cut, and a name is. */}
      <div className="ms-pl-name">{c.name}</div>
      <div className="ms-cell-top">
        <Face {...(c.id ? app.photoSet(c.id) : { photo: null })} pos={c.pos || '—'} size={30} />
        <div className="ms-who">
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
