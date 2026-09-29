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
import { Card, Face, Overlay } from '../ui/primitives';
import { OPPONENTS } from '../model/schedule';
import { byeOf, sosFor } from '../model/sos';
import { statBits } from '../model/stat-line';
import { projectPPG } from '../model/project';
import { barHeights, ordinal, type Ranked } from '../model/season';
import { type Tone, placing, toneOf, toneOfRank } from '../model/standing';
import { TradePackages } from '../ui/TradePackages';
import { cardTitle, dim, fitColor } from '../ui/styles';

const DATA_NOTE =
  'Live from Sleeper: league, managers, draft order, picks and the NFL catalog (position, age, team, experience). ' +
  'Market values come from FantasyCalc, priced for this league\'s format. ' +
  'Fixtures and last season\'s points allowed by each defence ship with the app, from nflverse. ' +
  'The Rating, floor and upside are the app\'s own model on top of those.';

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
        style={{ fontSize: 11.5, padding: 0, marginTop: 12 }}
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

  if (!p) {
    return (
      <Overlay onClose={() => app.setDetail(null)}>
        <div style={{ fontSize: 14, color: dim(0.6) }}>No data for this player.</div>
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
     and cannot be compared between two tiles at a glance. */
  const pctOf = (pct: number | null | undefined): string | undefined =>
    (fin(pct) ? ord(Math.max(1, 100 - Math.round((pct as number) * 100))) + ' pct' : undefined);

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
                width: 64, height: 64, flex: 'none', borderRadius: 14,
                background: `color-mix(in srgb, var(--color-accent) 12%, transparent) url(${photo}) center/cover no-repeat`,
                border: 'var(--hairline) solid var(--color-divider)',
              }
              : {
                width: 64, height: 64, flex: 'none', borderRadius: 14,
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
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
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
          <div style={{ fontSize: 25, fontWeight: 500, letterSpacing: '-0.025em' }}>{p.name}</div>
          <div style={{ fontSize: 12.5, color: dim(0.5), marginTop: 4 }}>
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
                style={{ fontSize: 11, padding: 0 }}
              >
                Restore original photo
              </button>
              {/* Always, not only when it is shared. "Does everybody see
                  this" is a question about a photo that outlives the toast
                  that answered it, and a photo with nothing beside it is one
                  somebody has to come and ask about. */}
              <span style={{ fontSize: 10.5, color: dim(0.35) }}>
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
        {proj != null ? (
          <div style={{ flex: 1, background: 'var(--color-surface)', borderRadius: 11, padding: '10px 12px' }}>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em' }}>{proj.toFixed(1)}</div>
            <div style={{ fontSize: 9.5, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.45), marginTop: 3 }}>
              {weekProj != null ? 'proj this week' : 'proj pts/gm'}
            </div>
          </div>
        ) : null}
        <div style={{ flex: 1, background: 'var(--color-surface)', borderRadius: 11, padding: '10px 12px' }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em', color: fitColor(p.fit) }}>{p.fit}</div>
          <div style={{ fontSize: 9.5, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.45), marginTop: 3 }}>
            {/* Never call it a Rating when it is not one. */}
            {fill ? 'consensus' : 'rating'}
          </div>
        </div>
      </div>

      {/* A kicker or a team defence has no Rating, and a card that simply
          omits one reads as a broken screen rather than as an absence. */}
      {fill ? (
        <Card style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, textWrap: 'pretty' }}>
            No Rating for a {p.pos === 'DEF' ? 'team defence' : 'kicker'}. The number above is
            where the consensus drafts him, which is the only real signal there is. Take one late.
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

  /* The log costs one request a game, so it asks for the weeks it is about to
     draw and no others. `logged` is a string because the array is rebuilt
     every render and would otherwise re-fire the effect forever. */
  const shown = games.slice(-LOG_GAMES);
  const logged = shown.map(g => g.week).join(',');
  const { fetchGameStats } = app;
  useEffect(() => {
    const weeks = logged ? logged.split(',').map(Number) : [];
    if (weeks.length) void fetchGameStats(weeks);
  }, [fetchGameStats, logged]);

  /* Before he has played, the season block is zeroes pretending to be facts
     — but the numbers under it and his schedule are as true in week 1 as in
     week 12, so it is that block that is skipped and not the card. */
  const played = !!line && !!games.length;

  const cells: { k: string; v: string; r?: Ranked | null }[] = !line ? [] : [
    { k: 'Games', v: String(line.games), r: ranks?.games },
    { k: 'Pts/gm', v: line.ppg.toFixed(1), r: ranks?.ppg },
    { k: 'Total', v: line.total.toFixed(1), r: ranks?.total },
    { k: 'Best', v: line.high.toFixed(1), r: ranks?.high },
    { k: 'Floor', v: line.floor.toFixed(1), r: ranks?.floor },
    { k: 'Ceiling', v: line.ceiling.toFixed(1), r: ranks?.ceiling },
    { k: 'Worst', v: line.low.toFixed(1), r: ranks?.low },
  ];

  const hs = barHeights(games);
  const top = Math.max(...games.map(g => g.pts));
  const field = ranks?.ppg?.of ?? 0;

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
      <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 3, textWrap: 'pretty' }}>
        In this league's own scoring. Byes and the weeks he did not play are
        left out rather than averaged in as nothing.
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

      {field > 1 ? (
        <div style={{ fontSize: 11, color: dim(0.4), marginTop: 12, textWrap: 'pretty' }}>
          Ranked among the {field} {pos}s rostered in this league — the men who
          could be started instead of him. <b>Floor</b> is what he clears three
          weeks in four and <b>ceiling</b> what he reaches one in four, which is
          the difference between a safe start and one you need a big week from.
        </div>
      ) : null}

      <div className="ps-bars" role="img" aria-label={'points by week: ' + games.map(g => 'week ' + g.week + ', ' + g.pts.toFixed(1)).join('; ')}>
        {games.map((g, i) => (
          <div className={'ps-bar' + (g.pts === top ? ' is-top' : '')} key={g.week}>
            <div className="ps-bar-n">{g.pts.toFixed(1)}</div>
            <div className="ps-bar-fill" style={{ height: ((hs[i] as number) * 100) + '%' }} />
          </div>
        ))}
      </div>
      <div className="ps-wks" aria-hidden="true">
        {games.map(g => <div className="ps-wk" key={g.week}>W{g.week}</div>)}
      </div>

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
          <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(0.33), marginTop: 14, textWrap: 'pretty' }}>
            {DATA_NOTE}
          </div>
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
        <div style={{ fontSize: 10.5, color: dim(0.3), marginTop: 10 }}>
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
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 5 }}>Nobody to trade with</div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: dim(0.5) }}>
          He is a free agent. Add him from the Draft tab&apos;s free-agent board — no trade needed.
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>What he would cost</div>
        <div style={{ fontSize: 11, color: dim(0.42) }}>{sheet.ownerLabel}</div>
      </div>
      <TradePackages app={app} m={m} targetId={sheet.id} targetName={sheet.name} />
    </Card>
  );
}

