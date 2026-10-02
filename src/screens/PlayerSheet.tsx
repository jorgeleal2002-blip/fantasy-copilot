import { useEffect, useState } from 'react';
import { ACCENT, BAD, GOOD, POS, WARN, type Weights } from '../model/constants';

const TONE = { good: GOOD, warn: WARN, bad: BAD };

/** A figure's colour, or none where the card does not know where it places. */
const tint = (t: Tone | undefined) => (t ? { color: TONE[t] } : undefined);

/**
 * What a status word means for Sunday.
 *
 * Doubtful sits with Out rather than with Questionable: it is the league
 * saying he is unlikely to play, and a colour that treats "probably not" as a
 * caution is the one that gets somebody left in a lineup.
 */
function availabilityTone(state: string): Tile['tone'] {
  const s = state.toLowerCase();
  if (/^healthy$/.test(s)) return 'good';
  if (/question|probable|day/.test(s)) return 'warn';
  return 'bad';
}
import { num } from '../model/math';
import type { Metrics } from '../model/score';
import type { SleeperPlayer } from '../api/types';
import type { Model } from '../model/types';
import type { Usage } from '../model/usage';
import type { App } from '../state/useApp';
import { ord } from '../ui/format';
import { WeekBars } from '../ui/charts';
import { Card, Face, Overlay, TdBalls } from '../ui/primitives';
import { OPPONENTS } from '../model/schedule';
import { byeOf, sosFor } from '../model/sos';
import { gameLeft, phaseFor } from '../model/game-clock';
import { clockLabel, gameLeftOf } from '../model/nfl-games';
import { headlineBits, statBits, touchdowns } from '../model/stat-line';
import { projectPPG } from '../model/project';
import { gapsIn, ordinal, type Ranked } from '../model/season';
import { type Tone, placing, toneOf, toneOfRank } from '../model/standing';
import { TradePackages } from '../ui/TradePackages';
import { cardTitle, dim, fitColor } from '../ui/styles';

export interface Sheet {
  id: string;
  name: string;
  pos: string;
  team: string;
  age: number | null | undefined;
  /** consensus rank across every player the market prices, or null. */
  rank: number | null;
  fit: number;
  m: Metrics;
  weights: Weights;
  owned: boolean;
  ownerLabel: string;
  raw: SleeperPlayer;
  use?: Usage;
}

export function resolve(m: Model, id: string, strat: Weights): Sheet | null {
  const sheet = build(m, id, strat);
  if (!sheet) return null;
  /* One Rating a player. The league's list scores everybody the same way —
     no need term, the stack measured inside his OWN owner's roster — and this
     was scoring him again: an un-owned man came back on the draft board's
     weights and against YOUR stack, so his card and the list disagreed about
     the same number under the same word. A player nobody has rostered is not
     in that list and keeps the board's answer, which is the right one for
     somebody who is still on it. */
  const listed = m.allFits.find(x => x.id === id);
  return listed ? { ...sheet, fit: listed.fit, m: listed.m, weights: listed.weights } : sheet;
}

function build(m: Model, id: string, strat: Weights): Sheet | null {
  const mine = m.myPlayers.find(p => p.id === id);
  if (mine) {
    return {
      id, name: mine.name, pos: mine.pos, team: mine.team, age: mine.age, rank: mine.rank,
      fit: mine.fit, m: mine.m, weights: mine.wEff, owned: true, ownerLabel: 'yours',
      raw: mine.raw, use: mine.use,
    };
  }
  const board = m.scored.find(p => p.id === id) || m.scoreAny(id);
  if (!board) return null;
  return {
    id, name: board.name, pos: board.pos, team: board.team || 'FA', age: board.age, rank: board.rank,
    fit: board.fit, m: board.m, weights: strat, owned: !!board.owned,
    ownerLabel: board.owned ? 'yours' : board.owner ? 'on ' + board.owner : 'free agent',
    raw: board.raw, use: board.use,
  };
}

/**
 * Something the card says only when asked.
 *
 * The sheet had two long blocks — how a projection is built, and the nine-row
 * breakdown of a Rating — sitting above the things somebody opened it to read.
 * Both are worth keeping and neither is worth scrolling past every time, which
 * is what a disclosure is for.
 */
function More({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{ fontSize: 12, padding: 0, marginTop: 12 }}
      >
        {open ? 'Less' : label + ' \u203a'}
      </button>
      {open ? children : null}
    </>
  );
}

/**
 * The numbers, as numbers.
 *
 * Each of these used to be a sentence in a box — "36.2 · well above average",
 * "6,823 · QB1 at his position" — two boxes to a row, each three lines tall,
 * so eleven facts filled a screen and a half of scrolling. The prose was
 * saying what the number already says to anyone reading a column of them: a
 * rank is above average by being a low rank, and "well above average" is a
 * restatement, not a second fact.
 *
 * So the sentence is cut back to the figure, with at most a short token beside
 * it where that token is itself data — QB1, the games it is averaged over, the
 * share of the team. Three to a row, and the whole set fits where four tiles
 * used to.
 */
export type Tile = {
  label: string;
  value: string;
  note?: string;
  /** The note is a placement — worn in the accent, as it is on the season
   *  grid, because "where does he come" is one question asked all over this
   *  card and it should look like one question wherever it is answered. */
  rank?: boolean;
  /** A reading the colour itself can carry: a man who is Out, a playoff run
   *  against the three hardest defences left. Only where the figure has a
   *  direction — most of them do not, and a coloured number that means nothing
   *  spends the one signal the card has. */
  tone?: 'good' | 'warn' | 'bad';
};

function Tiles({ rows }: { rows: Tile[] }) {
  return (
    <div className="ps-grid is-tiles">
      {rows.map(r => (
        <div className="ps-cell" key={r.label}>
          <div className="ps-k">{r.label}</div>
          {/* A word is not a figure: "Questionable" set at the size of "36.2"
              is wider than its third of the row and shoulders the columns
              either side of it out of line. */}
          <div
            className={'ps-v' + (/\d/.test(r.value) || r.value.length < 7 ? '' : ' is-word')}
            style={tint(r.tone)}
          >
            {r.value}
          </div>
          <div className={'ps-r' + (r.note ? (r.rank ? '' : ' is-note') : ' is-none')}>{r.note || ''}</div>
        </div>
      ))}
    </div>
  );
}

export function PlayerSheet({ app, m, playerId }: { app: App; m: Model; playerId: string }) {
  const p = resolve(m, playerId, m.wUsed);
  // The week's stat lines, for the line under the tiles. Cached, so opening a
  // second player costs nothing.
  const wk = app.week;
  useEffect(() => { if (wk) void app.fetchWeekStats(wk); }, [app.fetchWeekStats, wk]);

  if (!p) {
    return (
      <Overlay onClose={() => app.setDetail(null)}>
        <div style={{ fontSize: 13, color: dim(0.75) }}>No data for this player.</div>
      </Overlay>
    );
  }

  /*
   * The headline number, in the points this league actually pays.
   *
   * `projectPPG` is the model's own, and it is measured in half-PPR — which
   * almost no league scores in. This one pays a full point a catch, so every
   * receiver on the page read three or four light under a label that said
   * "half-PPR" as though that settled it.
   *
   * The team scale would be the wrong fix for one player: it maps a whole
   * skill lineup onto a whole team score, so it would hand him a ninth of the
   * kicker and the defence. Sleeper's own projection for the week is already
   * totalled against this league's `scoring_settings` — exact, per player, and
   * in the right units — so it leads, and the model's number keeps its own
   * card below rather than being converted into something it is not.
   */
  const weekProj = Number.isFinite(app.projections[p.id]) ? app.projections[p.id] : null;
  const modelProj = projectPPG(p.use);
  const proj = weekProj ?? modelProj;
  /* What he has this week, out of the scoreboard feed — his league's own
   * scoring, and moving with it while his game is on. Only a rostered player
   * is in that feed, and only a rostered player is worth a live number. */
  const wkPts = app.week
    ? app.matchups.find(r => r.players_points?.[p.id] != null)?.players_points?.[p.id]
    : undefined;
  const phase = app.week && Number.isFinite(wkPts)
    ? phaseFor(p.team, app.week, Number(app.data?.league.season), Date.now(), app.nflGames)
    : null;
  /* What he has done this week, under the tiles — the same line Sleeper puts on
   * its own card. */
  const wkLine = phase && phase !== 'pre' ? app.weekStats[p.id] : undefined;
  const wkHead = headlineBits(wkLine, p.pos);
  const wkRest = statBits(wkLine, p.pos);
  /* The game he is in — score and clock — at the top of the week's card, the
   * way Sleeper's own card has it. His side is the bright one. */
  const game = p.team ? app.nflGames[p.team] : undefined;
  /* Against his projection, the comparison Sleeper's own card is built on:
   * how much of it he has, where he is on pace to finish while the game is
   * on, and what he beat it or missed it by once it is over. */
  const got = phase && phase !== 'pre' ? (wkPts as number) : null;
  const left = game ? gameLeftOf(game)
    : app.week ? gameLeft(p.team, app.week, Number(app.data?.league.season), Date.now()) : null;
  const reached = got != null && weekProj ? Math.max(0, Math.min(1, got / weekProj)) : null;
  const pace = phase === 'live' && got != null && weekProj != null && left != null ? got + weekProj * left : null;
  const beat = phase === 'final' && got != null && weekProj != null ? got - weekProj : null;
  const photo = app.photoFor(p.id, 'full');
  const custom = !!app.photos[p.id];
  const setter = app.photoBy(p.id);
  const shared = app.photoShared(p.id);
  const season = app.seasonPpg(p.id);
  const u = p.use;

  /**
   * A kicker or a team defence, who is on the board but not described by it.
   *
   * Their number is where the consensus takes them, not a Rating — so the
   * sheet cannot draw the bars that explain one. It drew them anyway, nine
   * rows of "0 × 31% = 0" under a score of 23, which reads as a broken screen
   * rather than as an absence of data. Every stat tile below said "no data" for
   * the same reason. One sentence is the honest version of both.
   */
  const fill = POS.indexOf(p.pos as typeof POS[number]) < 0;

  const fin = Number.isFinite;
  const diverge = m.qDiverge(p.raw, p.id);

  const val = m.marketValue(p.id);

  /**
   * A percentile, in words.
   *
   * "84th pct" is a number about a number, and the reader has to do the
   * second sum themselves. Four bands say the same thing in the language
   * somebody would use out loud, and the middle one says nothing at all
   * because being ordinary is not news.
   */
  /* Where a number sits among his position, as a number. It used to be a
     clause — "well above average" — which is longer than the fact it reports
     and cannot be compared between two tiles at a glance.

     Higher is better, which is the way a percentile is read everywhere and
     was not the way this printed it: the model stores 0.74 for a man ahead of
     74% of his position and the tile said "26th pct", which reads as the
     bottom of it — under a figure the same number had just painted green. */
  const pctOf = (pct: number | null | undefined): string | undefined =>
    (fin(pct)
      ? ord(Math.min(99, Math.max(1, Math.round((pct as number) * 100)))) + ' pct'
      : undefined);

  /* Where the market puts him among the men at his position in THIS league —
     the same field every other placing on the card uses. `posRank` beside the
     figure is the market's own board, which is the right note and the wrong
     denominator for a colour. */
  const ppgRank = app.seasonRanks(p.id, p.pos)?.ppg;
  const marketAt = (() => {
    if (!val) return null;
    const field = m.allFits.filter(x => x.pos === p.pos).map(x => x.value);
    if (field.length < 2) return null;
    const better = field.filter(v => v > val.pts).length;
    return placing(better + 1, field.length);
  })();

  /* What a person reads. Price, whether he plays, how much of the offence he
   * is, and what he does with it — in that order, because that is the order
   * the questions come in. */
  const stats: Tile[] = [
    {
      // The first thing anyone wants before proposing a trade: the price, and
      // whether that price is the market's or the model's stand-in for it.
      label: val && !val.real ? 'Value (est)' : 'Market value',
      value: val ? num(val.pts) : '—',
      note: val?.posRank ? val.pos + val.posRank : undefined,
      rank: true,
      /* Placed inside this league rather than against the market's whole
         board, which is the field every other placing on this card uses. */
      tone: toneOf(marketAt),
    },
    (() => {
      const status = String(p.raw.status || '');
      const inj = String(p.raw.injury_status || '');
      const state = inj || (status && status.toLowerCase() !== 'active' ? status : 'Healthy');
      const dco = Number(p.raw.depth_chart_order);
      return {
        label: 'Availability',
        value: state,
        note: fin(dco) ? (dco === 1 ? 'starter' : ord(dco) + ' on depth') : undefined,
        /* The one word on this card that is about whether he plays at all,
           so it is worn rather than read: healthy, wary, or not playing. */
        tone: availabilityTone(state),
      } as Tile;
    })(),
    {
      /* This season, in this league's scoring — which is what somebody means
       * when they ask what a player is averaging. `Usage.ppg` is a blend of
       * four seasons measured in half-PPR, and was neither. It still has a
       * job: it is what the projection is built out of, on its own card. */
      label: 'Points/gm',
      value: season ? season.ppg.toFixed(1) : u && u.ppg != null ? u.ppg.toFixed(1) : '—',
      note: season ? season.games + ' gm' : u && u.ppg != null ? 'half-PPR' : undefined,
      tone: season ? toneOfRank(ppgRank?.rank, ppgRank?.of) : undefined,
    },
    {
      label: 'Snaps',
      value: u && u.snap != null ? Math.round(u.snap * 100) + '%' : '—',
      tone: toneOf(u?.snapPct),
    },
    {
      // Three to a row leaves no space for "Attempts per game" spelled out.
      label: (u?.shareLabel || 'Target share').replace('Attempts per game', 'Att/gm').replace(' share', ' shr'),
      value: u && u.shareText ? u.shareText : '—',
      note: u && u.shareText ? pctOf(u.volPct) : undefined,
      rank: true,
      tone: toneOf(u?.volPct),
    },
    {
      label: u?.effLabel || 'Yds/touch',
      value: u && fin(u.eff) ? (u.eff as number).toFixed(1) : '—',
      note: u && fin(u.eff) ? pctOf(u.effPct) : undefined,
      rank: true,
      tone: toneOf(u?.effPct),
    },
    {
      label: 'TDs/gm',
      value: u && u.tdPerGame != null ? u.tdPerGame.toFixed(2) : '—',
      note: u && u.tdShare != null ? Math.round(u.tdShare * 100) + '% tm' : undefined,
      tone: toneOf(u?.tdPct),
    },
  ];

  /* His schedule, as figures rather than as a sentence about them. It read
     "22nd easiest of 32. A middling run of opponents in the league for a QB:
     they gave up 16 points a game to QBs in 2025", which is four lines to
     carry two ranks and a rate — and all three belong in the same grid as the
     rest, so they can be compared with them and with the next player's.

     The three playoff opponents keep their names, because "a hard finish"
     means nothing until you see who it is against.

     Not for dynasty, where a fixture list eighteen weeks long says nothing
     about a roster measured in seasons. */
  const sos = m.isDynasty ? null : sosFor(p.team, p.pos, m.league);
  const fixtures = p.team ? OPPONENTS[p.team] : null;
  if (sos && fixtures) {
    /* The rate on top and the placement under it, the same way round as every
       other tile — so the accent line down the grid is one column of the same
       question and not two different ones. */
    stats.push(
      {
        label: 'Sched allows',
        value: sos.perGame.toFixed(1),
        note: ord(sos.rank) + ' of 32',
        rank: true,
        tone: toneOfRank(sos.rank, 32),
      },
      {
        label: 'Playoffs allow',
        value: sos.playoffPerGame.toFixed(1),
        note: ord(sos.playoffRank) + ' of 32',
        rank: true,
        tone: toneOfRank(sos.playoffRank, 32),
      },
      {
        label: 'Playoff foes',
        value: sos.weeks.map(w => fixtures[w - 1] || 'bye').join(' '),
        note: 'wks ' + sos.weeks[0] + '–' + sos.weeks[sos.weeks.length - 1],
        /* Three team codes say nothing on their own — the whole point of
           naming them was that "a hard finish" is abstract until you see who
           it is against, and the colour is that sentence without the words.
           The thresholds are the ones the prose used: a top-ten run was "one
           of the easiest", 23rd or worse "one of the hardest". */
        tone: toneOfRank(sos.playoffRank, 32),
      },
    );
  }

  const deeper: Tile[] = [
    {
      label: 'Red zone',
      value: u && u.rzShare != null ? (u.rzShare * 100).toFixed(1) + '%' : '—',
      note: u && u.rzShare != null ? 'of team' : undefined,
      tone: toneOf(u?.rzPct),
    },
    {
      label: 'Expected TDs',
      value: u && u.xtd != null ? u.xtd.toFixed(1) : '—',
      note: u && u.xtd != null ? 'scored ' + Math.round(u.xtd + (u.tdLuck || 0)) : undefined,
    },
    {
      label: 'Long TDs',
      value: u && fin(u.longTd) ? (u.longTd as number).toFixed(1) : '—',
      note: u && fin(u.longTd) ? pctOf(u.ltrPct) : undefined,
      rank: true,
      tone: toneOf(u?.ltrPct),
    },
    {
      /* Signed, because the direction is the whole finding: over is the market
       * paying more than he produces, under is him being cheap for what he
       * does. It read as a sentence and could not be compared with anything. */
      label: 'Market vs prod',
      value: (() => {
        if (!diverge) return '—';
        const d = Math.round((diverge.mkt - diverge.prod) * 100);
        return (d > 0 ? '+' : '') + d + '%';
      })(),
      note: diverge && Math.abs(Math.round((diverge.mkt - diverge.prod) * 100)) < 12 ? 'in line' : undefined,
    },
    // The market's own order across every player it prices — not a search
    // index dressed up as an ADP.
    { label: 'Market rank', value: p.rank ? '#' + p.rank : '—' },
    {
      label: 'Seasons',
      value: u && u.seasons ? String(u.seasons) : '—',
      /* How much of the number is the year you are watching. Two games and a
       * full season print the same and are not the same claim. */
      note: u && u.seasons
        ? (u.seasons === 1 ? 'small' : u.curWeight != null ? Math.round(u.curWeight * 100) + '% this yr' : undefined)
        : undefined,
    },
  ];

  return (
    <Overlay onClose={() => app.setDetail(null)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <label style={{ position: 'relative', cursor: 'pointer', flex: 'none' }}>
          <div
            style={photo
              ? {
                width: 64, height: 64, flex: 'none', borderRadius: 12,
                background: `color-mix(in srgb, var(--color-accent) 12%, transparent) url(${photo}) center/cover no-repeat`,
                border: 'var(--hairline) solid var(--color-divider)',
              }
              : {
                width: 64, height: 64, flex: 'none', borderRadius: 12,
                background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', border: 'var(--hairline) solid var(--color-divider)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: ACCENT, fontSize: 13, fontWeight: 600,
              }}
          >
            {photo ? '' : p.pos}
          </div>
          <div style={{
            position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: '50%',
            background: 'var(--color-bg)', border: '1px solid var(--color-accent)', color: 'var(--color-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
          }}>
            ✎
          </div>
          <input
            type="file"
            accept="image/*"
            onChange={e => {
              const f = e.target.files && e.target.files[0];
              if (f) app.setPhoto(p.id, f);
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />
        </label>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.025em' }}>{p.name}</div>
          <div style={{ fontSize: 12, color: dim(0.62), marginTop: 4 }}>
            {[p.pos, p.team]
              .concat(p.age ? [p.age + ' yrs'] : [])
              // The bye is a draft-room fact — you count them as you go — and it
              // is sitting in the schedule table already.
              .concat(byeOf(p.team) ? ['bye ' + byeOf(p.team)] : [])
              .concat([p.ownerLabel]).join(' · ')}
          </div>
          {custom ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => app.clearPhoto(p.id)}
                style={{ fontSize: 10, padding: 0 }}
              >
                Restore original photo
              </button>
              {/* Always, not only when it is shared. "Does everybody see
                  this" is a question about a photo that outlives the toast
                  that answered it, and a photo with nothing beside it is one
                  somebody has to come and ask about. */}
              <span style={{ fontSize: 10, color: dim(0.52) }}>
                {shared
                  ? (setter ? 'set by ' + setter + ' · the league sees it' : 'the league sees it')
                  : 'only on this device'}
              </span>
            </div>
          ) : null}
        </div>

      </div>

      {/* Under the name rather than beside it. Squeezed into the strip left
          over by a 64px photo, "Jaxon Smith-Njigba" wrapped onto three lines
          and the numbers still had to shrink; across the full width each one
          gets a tile and the name gets a line.

          Two of them, because they answer two questions and the app was only
          ever answering one. The Rating says who to take at this pick — it
          prices your hole, the replacement at his position and where the board
          has him. The projection says how many points he scores and knows
          nothing about your roster. Against the following season the
          projection is the better predictor (0.806 to 0.783) and the Rating is
          the better draft board, and printing one under both labels is what
          made the model look wrong. */}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        {phase ? (
          <div style={{ flex: 1, background: 'var(--color-surface)', borderRadius: 12, padding: '10px 12px' }}>
            <div className={'ps-now is-' + phase}>
              {phase === 'pre' ? '—' : (wkPts as number).toFixed(2)}
            </div>
            <div className={'ps-now-state is-' + phase}>
              {phase === 'live' ? 'Live' : phase === 'final' ? 'Final' : 'Not started'}
            </div>
            {reached != null ? (
              <div className="ps-reach" role="img" aria-label={Math.round(reached * 100) + '% of his projection'}>
                <div className={'ps-reach-fill is-' + phase} style={{ width: (reached * 100).toFixed(1) + '%' }} />
              </div>
            ) : null}
          </div>
        ) : null}
        {proj != null ? (
          <div style={{ flex: 1, background: 'var(--color-surface)', borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 21, fontWeight: 500, letterSpacing: '-0.03em' }}>
              {proj.toFixed(weekProj != null ? 2 : 1)}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.62), marginTop: 3 }}>
              {weekProj == null ? 'proj pts/gm' : phase ? 'proj wk ' + app.week : 'proj this week'}
            </div>
            {pace != null ? (
              <div className="ps-vs-proj">pace {pace.toFixed(1)}</div>
            ) : beat != null ? (
              <div className={'ps-vs-proj ' + (beat >= 0 ? 'is-up' : 'is-down')}
                aria-label={(beat >= 0 ? 'beat his projection by ' : 'missed his projection by ') + Math.abs(beat).toFixed(2)}>
                {(beat >= 0 ? '▲ ' : '▼ ') + Math.abs(beat).toFixed(2)}
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ flex: 1, background: 'var(--color-surface)', borderRadius: 12, padding: '10px 12px' }}>
          <div style={{ fontSize: 21, fontWeight: 500, letterSpacing: '-0.03em', color: fitColor(p.fit) }}>{p.fit}</div>
          <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.62), marginTop: 3 }}>
            {/* Never call it a Rating when it is not one. */}
            {fill ? 'consensus' : 'rating'}
          </div>
        </div>
      </div>

      {wkHead.length || game ? (
        <div className="ps-week">
          {game ? (
            <div className="ps-week-top">
              <span className="ps-week-game">
                <span className={game.away === p.team ? 'is-his' : ''}>{game.away}</span>
                {game.state === 'pre' ? ' @ ' : (
                  <> <b>{game.awayScore ?? 0}</b> – <b>{game.homeScore ?? 0}</b> </>
                )}
                <span className={game.home === p.team ? 'is-his' : ''}>{game.home}</span>
              </span>
              <span className={'ps-week-clock is-' + game.state}>{clockLabel(game)}</span>
            </div>
          ) : null}
          {wkHead.length ? (
          <div className="ps-feed-stats">
            {wkHead.map(b => (
              <span className="ps-feed-stat" key={b.unit + b.n}>
                <span className="ps-feed-n">{b.n}</span>
                <span className="ps-feed-u">{b.unit}</span>
              </span>
            ))}
            <TdBalls n={touchdowns(wkLine)} />
          </div>
          ) : null}
          {wkRest.length ? (
            <div className="ps-feed-rest">{wkRest.map(b => b.n + ' ' + b.unit).join(', ')}</div>
          ) : null}
        </div>
      ) : null}

      {/* A kicker or a team defence has no Rating, and a card that simply
          omits one reads as a broken screen rather than as an absence. */}
      {fill ? (
        <Card style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: dim(0.75) }}>
            No Rating for a {p.pos === 'DEF' ? 'team defence' : 'kicker'} — the number above is
            where the consensus drafts him.
          </div>
        </Card>
      ) : null}

      {fill ? null : <ThisSeason app={app} p={p} stats={stats} deeper={deeper} />}


      {fill ? null : <WhatHeCosts app={app} m={m} sheet={p} />}

    </Overlay>
  );
}

/**
 * What he has actually done this season, in this league's points.
 *
 * Every football app draws a stat grid; this is the same grid with the columns
 * a lineup decision turns on. Passing yards are a quarterback's season, not a
 * fantasy season — what matters is what he put on the board, over how many
 * games, and how low it goes on his bad weeks against how high on his good
 * ones. The average alone hides that: two men at 14 a game are not the same
 * player if one goes 13, 14, 15 and the other goes 2, 6, 34.
 *
 * Each number carries where it puts him among the men at his position who
 * could be started instead of him — rostered in THIS league, since that is who
 * the choice is between. A rank against every quarterback in the NFL counts
 * thirty nobody here can start.
 */
function ThisSeason(
  { app, p, stats, deeper }:
  { app: App; p: Sheet; stats: Tile[]; deeper: Tile[] },
) {
  const { pos, id } = p;
  const team = p.team;
  const line = app.seasonOf(id);
  const games = app.seasonLog(id);
  const ranks = app.seasonRanks(id, pos);
  const tds = app.seasonTds(id);

  /* Two reasons to ask for a week of stats, and the fetch is driven by both.

     The log needs a line under each game it draws. And the season itself has
     holes: the league's weekly payload lists the players on a roster, so a man
     it had not picked up yet is missing every week before somebody claimed him
     — which for a waiver pickup is most of his own total. Those weeks are
     asked for by their absence, so a player rostered all year costs nothing
     extra and one picked up in week six costs the five he was a free agent.

     Joined into a string because the array is rebuilt every render and would
     otherwise re-fire the effect forever. */
  const shown = games.slice(-LOG_GAMES);
  const upTo = Math.min(18, Math.max(0, app.nflWeek ?? app.week ?? 0));
  const want = [...new Set([...shown.map(g => g.week), ...gapsIn(games, upTo)])].sort((x, y) => x - y);
  const asked = want.join(',');
  const { fetchGameStats } = app;
  useEffect(() => {
    const weeks = asked ? asked.split(',').map(Number) : [];
    if (weeks.length) void fetchGameStats(weeks);
  }, [fetchGameStats, asked]);

  /* Before he has played, the season block is zeroes pretending to be facts
     — but the numbers under it and his schedule are as true in week 1 as in
     week 12, so it is that block that is skipped and not the card. */
  const played = !!line && !!games.length;

  const cells: { k: string; v: string; r?: Ranked | null }[] = !line ? [] : [
    { k: 'Games', v: String(line.games), r: ranks?.games },
    { k: 'Pts/gm', v: line.ppg.toFixed(1), r: ranks?.ppg },
    { k: 'Total', v: line.total.toFixed(1), r: ranks?.total },
    /* How many he has scored, which is what anybody asking about touchdowns
       means. The rate under "The numbers" is a four-season blend feeding the
       model and answers a different question. */
    ...(tds != null ? [{ k: 'TDs', v: String(tds), r: ranks?.tds }] : []),
    { k: 'Best', v: line.high.toFixed(1), r: ranks?.high },
    { k: 'Floor', v: line.floor.toFixed(1), r: ranks?.floor },
    { k: 'Ceiling', v: line.ceiling.toFixed(1), r: ranks?.ceiling },
    { k: 'Worst', v: line.low.toFixed(1), r: ranks?.low },
  ];

  return (
    <Card style={{ marginTop: 16 }}>
      {played && line ? (
      <div className="ps-sec is-first">
      {/* The way out of one player's card and into two. It belongs on this
          heading because the season is what gets compared — the market value
          and the schedule are about him alone. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={cardTitle}>This season</div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => app.setDetail('compare-' + id)}
          style={{ fontSize: 12, padding: 0, flex: 'none' }}
        >
          Compare ›
        </button>
      </div>
      <div className="ps-grid">
        {cells.map(c => (
          <div className="ps-cell" key={c.k}>
            <div className="ps-k">{c.k}</div>
            <div className="ps-v" style={tint(toneOfRank(c.r?.rank, c.r?.of))}>{c.v}</div>
            <div className={'ps-r' + (c.r ? '' : ' is-none')}>{c.r ? ordinal(c.r.rank) : '—'}</div>
          </div>
        ))}
      </div>

      <WeekBars games={games} />

      </div>
      ) : null}

      {/* The rest of what is known about him, in the same card rather than in
          three more below it: what he costs, how much of his offence he is,
          and who he still has to play. They were separate cards because they
          came from separate places, which is a fact about the app and not
          about him. */}
      <div className={'ps-sec' + (played ? '' : ' is-first')}>
        <div className="ps-sec-h">The numbers</div>
        <Tiles rows={stats} />
        <More label="More numbers">
          <Tiles rows={deeper} />
        </More>
      </div>

      {/* The long tail of the card, so it sits under everything that is
          one line each. Eight games of log between the season and the rest of
          the numbers put the two halves of one answer a screen apart. */}
      {played ? (
      <div className="ps-sec">
        <div className="ps-sec-h">Game by game</div>
      {/* Game by game, newest first — the order somebody scrolls a log in,
          because "what has he done lately" is the question being asked and
          the answer to it is at the top.

          Written the way a football feed writes a game: the figures large
          with their units small beside them, rather than a comma-joined
          sentence. Three big numbers read as a scoreline, which is what they
          are; the same numbers in prose read as a caption. */}
      <div>
        {shown.slice().reverse().map(g => {
          const bits = statBits(app.gameStats[g.week]?.[id], pos);
          /* The first few set large, the rest on a line under them. A
             quarterback's week is eight figures — completions, yards, scores,
             an interception, then what he ran for and what he lost — and all
             eight at scoreline size is three rows of shouting. Cut at three
             and the rushing simply vanished, which is what a reader noticed.
             Split, nothing is lost and the row still reads as a score.

             The tail keeps its order and its commas because a passer's line
             says "yd" twice and "td" twice, and it is the sequence that says
             which is which. */
          const head = bits.slice(0, FEED_STATS);
          const rest = bits.slice(FEED_STATS);
          const opp = OPPONENTS[team]?.[g.week - 1] || '';
          const d = Math.round((g.pts - line.ppg) * 10) / 10;
          const fin = app.weekRank(id, pos, g.week);
          return (
            <div className="ps-feed" key={g.week}>
              <Face {...app.photoSet(id)} pos={pos} size={44} round />
              <div className="ps-feed-body">
                <div className="ps-feed-top">
                  <div className="ps-feed-wk">
                    Week {g.week}
                    <span className="ps-feed-pts">{' · ' + g.pts.toFixed(1) + ' pts'}</span>
                  </div>
                  {/* Where he finished that week among the men at his
                      position — the question a week's score is actually
                      asked in. "19.5" is a number; "QB7" is a week. Worn in
                      the accent, as every other placement on this card is. */}
                  {fin ? (
                    <div className="ps-feed-rk">{pos + fin.rank}</div>
                  ) : line.games > 1 ? (
                    <div className={'ps-feed-d' + (d >= 0 ? ' is-up' : '')}>
                      {(d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1)}
                    </div>
                  ) : null}
                </div>
                {head.length ? (
                  <div className="ps-feed-stats">
                    {head.map(b => (
                      <span className="ps-feed-stat" key={b.unit + b.n}>
                        <span className="ps-feed-n">{b.n}</span>
                        <span className="ps-feed-u">{b.unit}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {rest.length ? (
                  <div className="ps-feed-rest">
                    {rest.map(b => b.n + ' ' + b.unit).join(', ')}
                  </div>
                ) : null}
                {/* Who he played. The week is already on the line above it,
                    and there is no date to put here: Sleeper's own feed says
                    "September 20 @ CHI" because it has both, and inventing
                    either would be worse than the shorter line. */}
                {opp ? <div className="ps-feed-opp">{opp}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {games.length > shown.length ? (
        <div style={{ fontSize: 10, color: dim(0.52), marginTop: 10 }}>
          His last {LOG_GAMES} games. The chart above is the whole season.
        </div>
      ) : null}
      </div>
      ) : null}
    </Card>
  );
}

/* How far back the log goes. Every game on it is one more request for a week
   of stats, and the chart above already carries the whole season — so this is
   how much detail is worth paying for, not how much season there is. */
const LOG_GAMES = 8;

/* Three figures is what a feed row holds before it wraps into a paragraph,
   and the first three of a position's line are the ones that decided the
   week — a quarterback's completions, yards and touchdowns. */
const FEED_STATS = 3;

function WhatHeCosts({ app, m, sheet }: { app: App; m: Model; sheet: Sheet }) {
  if (sheet.owned) return null;

  // A free agent has no owner to negotiate with — that is a waiver claim.
  if (sheet.ownerLabel === 'free agent') {
    return (
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 5 }}>Nobody to trade with</div>
        <div style={{ fontSize: 12, lineHeight: '18px', color: dim(0.62) }}>
          He is a free agent. Add him from the Draft tab&apos;s free-agent board — no trade needed.
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>What he would cost</div>
        <div style={{ fontSize: 10, color: dim(0.52) }}>{sheet.ownerLabel}</div>
      </div>
      <TradePackages app={app} m={m} targetId={sheet.id} />
    </Card>
  );
}

