import { useState } from 'react';
import { ACCENT, METRIC_LABEL, PEAK, POS, type Weights } from '../model/constants';
import { num } from '../model/math';
import type { Metrics } from '../model/score';
import type { SleeperLeague, SleeperPlayer } from '../api/types';
import type { Model } from '../model/types';
import type { Usage } from '../model/usage';
import type { App } from '../state/useApp';
import { ord } from '../ui/format';
import { Meter, SERIES } from '../ui/charts';
import { Card, Overlay } from '../ui/primitives';
import { ALLOWED_SEASON, OPPONENTS, SCHEDULE_SEASON } from '../model/schedule';
import { byeOf, sosFor } from '../model/sos';
import { projectConfidence, projectPPG } from '../model/project';
import { barHeights, ordinal, type Ranked } from '../model/season';
import { TradePackages } from '../ui/TradePackages';
import { cardTitle, dim, fitColor } from '../ui/styles';

const DATA_NOTE =
  'Live from Sleeper: league, managers, draft order, picks and the NFL catalog (position, age, team, experience). ' +
  'Market values come from FantasyCalc, priced for this league\'s format. ' +
  'Fixtures and last season\'s points allowed by each defence ship with the app, from nflverse. ' +
  'The Rating, floor and upside are the app\'s own model on top of those.';

/** How much sample the projection is standing on, said out loud rather than
 *  left for the reader to assume from a number that prints the same either way. */
const CONF: Record<string, string> = {
  high: 'three full seasons behind it',
  fair: 'a season and a half behind it',
  low: 'off a short sample, treat it lightly',
};

interface Sheet {
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

function resolve(m: Model, id: string, strat: Weights): Sheet | null {
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

function Tiles({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
      {rows.map(r => (
        <div key={r.label} style={{ background: 'var(--color-surface)', borderRadius: 11, padding: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', color: dim(0.42) }}>
            {r.label}
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 5, lineHeight: 1.3 }}>
            {r.value}
          </div>
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
  const conf = modelProj != null ? projectConfidence(p.use) : null;
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
  const standing = (pct: number | null | undefined): string => {
    if (!fin(pct)) return '';
    const n = Math.round((pct as number) * 100);
    return n >= 90 ? ' · among the best at his position'
      : n >= 70 ? ' · well above average'
        : n <= 20 ? ' · below average'
          : '';
  };

  /* What a person reads. Price, whether he plays, how much of the offence he
   * is, and what he does with it — in that order, because that is the order
   * the questions come in. */
  const stats = [
    {
      // The first thing anyone wants before proposing a trade: the price, and
      // whether that price is the market's or the model's stand-in for it.
      label: val && !val.real ? 'Value (modelled)' : 'Market value',
      value: val
        ? num(val.pts) + (val.posRank ? ' · ' + val.pos + val.posRank + ' at his position' : '')
        : 'no data',
    },
    {
      label: 'Availability',
      value: (() => {
        const status = String(p.raw.status || '');
        const inj = String(p.raw.injury_status || '');
        const dco = Number(p.raw.depth_chart_order);
        const role = fin(dco) ? (dco === 1 ? 'starter on his depth chart' : ord(dco) + ' on his depth chart') : null;
        const state = inj || (status && status.toLowerCase() !== 'active' ? status : 'healthy');
        return state + (role ? ' · ' + role : '');
      })(),
    },
    {
      /* This season, in this league's scoring — which is what somebody means
       * when they ask what a player is averaging. `Usage.ppg` is a blend of
       * four seasons measured in half-PPR, and was neither. It still has a
       * job: it is what the projection is built out of, on its own card. */
      label: 'Points per game',
      value: season
        ? season.ppg.toFixed(1) + ' · ' + season.games + (season.games === 1 ? ' game' : ' games') + ' this season'
        : u && u.ppg != null ? u.ppg.toFixed(1) + ' · half-PPR, last seasons' : 'no data',
    },
    {
      label: 'On the field',
      value: u && u.snap != null ? Math.round(u.snap * 100) + '% of his team\'s snaps' : 'no data',
    },
    {
      label: u?.shareLabel || 'Target share',
      value: u && u.shareText ? u.shareText + standing(u.volPct) : 'no data',
    },
    {
      label: u?.effLabel || 'Yards per touch',
      value: u && fin(u.eff) ? (u.eff as number).toFixed(1) + standing(u.effPct) : 'no data',
    },
    {
      label: 'TDs per game',
      value: u && u.tdPerGame != null
        ? u.tdPerGame.toFixed(2) + (u.tdShare != null ? ` · ${Math.round(u.tdShare * 100)}% of the team\'s` : '')
        : 'no data',
    },
  ];

  /* The rest. Not wrong and not what anybody opened the card for: two of them
   * are the model talking about itself, and the others are the kind of number
   * you go looking for rather than one you want put in front of you. */
  const deeper = [
    {
      label: 'Red-zone share',
      value: u && u.rzShare != null ? (u.rzShare * 100).toFixed(1) + '% of his team\'s' : 'no data',
    },
    {
      label: 'Expected TDs',
      value: u && u.xtd != null
        ? u.xtd.toFixed(1) + ' expected vs ' + Math.round(u.xtd + (u.tdLuck || 0)) + ' scored' +
          (Math.abs(u.tdLuck || 0) < 1.5 ? ' · in line' : (u.tdLuck || 0) > 0 ? ' · scored above it' : ' · scored below it')
        : 'no data',
    },
    {
      label: 'Long TDs',
      value: u && fin(u.longTd)
        ? (u.longTd as number).toFixed(1) + ' of ' + Math.round((u.xtd || 0) + (u.tdLuck || 0)) + standing(u.ltrPct)
        : 'no data',
    },
    {
      label: 'Market vs production',
      value: (() => {
        if (!diverge) return 'no data';
        const d = Math.round((diverge.mkt - diverge.prod) * 100);
        return Math.abs(d) < 12 ? 'the two agree'
          : d > 0 ? 'the market pays more than he produces'
            : 'he produces more than he costs';
      })(),
    },
    // The market's own order across every player it prices — not a search
    // index dressed up as an ADP.
    { label: 'Market rank', value: p.rank ? '#' + p.rank : 'unranked' },
    {
      label: 'Seasons measured',
      value: u && u.seasons
        ? (u.seasons === 1
          ? '1 · ' + u.seasonList + ' (small sample)'
          : u.seasons + ' · ' + u.seasonList
            /* How much of the number is the year you are watching. Two games
             * and a full season print the same and are not the same claim. */
            + (u.curWeight != null ? ' · ' + Math.round(u.curWeight * 100) + '% this year' : ''))
        : 'no data',
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

      {fill ? null : <ThisSeason app={app} pos={p.pos} id={p.id} />}

      {/* First, because it is the answer. It used to sit under a paragraph
          about how a projection is built and a nine-row breakdown — below the
          fold on the one thing somebody opened the card to find out. */}
      {fill ? null : (
      <div style={{
        border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)', borderRadius: 12, padding: '14px 13px', marginTop: 14,
        background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
      }}>
        <div style={{
          fontSize: 10, letterSpacing: '.11em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 8,
        }}>
          Read
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, textWrap: 'pretty' }}>{verdict(p)}</div>
      </div>
      )}

      {modelProj != null ? (
        <Card style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, textWrap: 'pretty' }}>
            The model has him at <b>{modelProj.toFixed(1)}</b> half-PPR points a game next season
            {conf ? <span style={{ color: dim(0.5) }}>{' — ' + CONF[conf]}</span> : null}.
          </div>
          <More label="How this is worked out">
          <div style={{ fontSize: 12, color: dim(0.5), lineHeight: 1.55, marginTop: 10, textWrap: 'pretty' }}>
            Built from his volume rather than his points — the season being played,
            weighted by how much of it there is, over his last three finished ones: his
            real touches, priced at rates pulled from his own toward what is ordinary at
            his position by how much each rate actually repeats year to year. A quarterback's
            touchdowns mostly keep; a running back's catch rate is noise. It knows nothing
            about your roster or this pick — that is the Rating's job, and the two
            disagreeing on a player is information rather than a bug.
          </div>
          </More>
        </Card>
      ) : null}

      {fill ? (
        <Card style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, textWrap: 'pretty' }}>
            No Rating for a {p.pos === 'DEF' ? 'team defence' : 'kicker'}.
          </div>
          <div style={{ fontSize: 12, color: dim(0.5), lineHeight: 1.55, marginTop: 8, textWrap: 'pretty' }}>
            The Rating is built from market value, snap share, targets, yards per touch,
            red-zone looks and an age curve.{' '}
            {p.pos === 'DEF'
              ? 'A team defence has none of them: no snap count, no targets, no age, and no market — nobody trades one.'
              : 'A kicker has none of them: he is not on the field for a snap that counts here, and nobody trades one, so the market never prices him.'}{' '}
            The number above is where the consensus drafts him, which is the only real
            signal there is. Take one late.
          </div>
        </Card>
      ) : (
      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Why {p.fit}</div>
        <More label="Metric by metric">
        <div style={{ fontSize: 11.5, color: dim(0.42), margin: '10px 0 12px', textWrap: 'pretty' }}>
          Metric × weight, biggest contribution first — sorted by what each one actually put on the
          board, so the first row is the answer.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {m.metricKeys
            .filter(k => p.weights[k] > 0)
            .sort((a, b) => p.m[b] * p.weights[b] - p.m[a] * p.weights[a])
            .map(k => (
              <div key={k}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 5,
                }}>
                  <span style={{ fontSize: 12.5 }}>{METRIC_LABEL[k]}</span>
                  <span style={{ fontSize: 11.5, color: dim(0.45) }}>
                    {Math.round(p.m[k] * 100)} × {Math.round(p.weights[k] * 100)}%
                    {' = '}
                    <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>
                      {Math.round(p.m[k] * p.weights[k] * 100)}
                    </span>
                  </span>
                </div>
                <Meter pct={p.m[k] * 100} color={SERIES} />
              </div>
            ))}
        </div>
        </More>
      </Card>
      )}

      {fill || m.isDynasty ? null : <Schedule pos={p.pos} team={p.team} league={m.league} />}

      {fill ? null : <WhatHeCosts app={app} m={m} sheet={p} />}

      {fill ? null : <Tiles rows={stats} />}

      {fill ? null : (
        <More label="More numbers">
          <Tiles rows={deeper} />
          <div style={{ fontSize: 11, lineHeight: 1.5, color: dim(0.33), marginTop: 14, textWrap: 'pretty' }}>
            {DATA_NOTE}
          </div>
        </More>
      )}
    </Overlay>
  );
}

/**
 * Who he actually has to play.
 *
 * The breakdown above already scores the schedule, but a percentile does not
 * tell you anything you can argue with. This is the measurement under it: where
 * his run of opponents ranks AT HIS POSITION among the 32, what those defences
 * gave up per game last year, and the three weeks that decide most leagues,
 * named — because "a hard finish" means nothing until you see who it is against.
 *
 * Redraft only. A dynasty roster outlives this table.
 */
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
function ThisSeason({ app, pos, id }: { app: App; pos: string; id: string }) {
  const line = app.seasonOf(id);
  const games = app.seasonLog(id);
  const ranks = app.seasonRanks(id, pos);
  // Before he has played there is nothing here but zeroes pretending to be
  // facts, and the projection above is the whole of what is known.
  if (!line || !games.length) return null;

  const cells: { k: string; v: string; r?: Ranked | null }[] = [
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
      <div style={cardTitle}>This season</div>
      <div style={{ fontSize: 11.5, color: dim(0.45), marginTop: 3, textWrap: 'pretty' }}>
        In this league's own scoring. Byes and the weeks he did not play are
        left out rather than averaged in as nothing.
      </div>

      <div className="ps-grid">
        {cells.map(c => (
          <div className="ps-cell" key={c.k}>
            <div className="ps-k">{c.k}</div>
            <div className="ps-v">{c.v}</div>
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
    </Card>
  );
}

function Schedule(
  { pos, team, league }: { pos: string; team: string | null | undefined; league: SleeperLeague },
) {
  const s = sosFor(team, pos, league);
  const sched = team ? OPPONENTS[team] : null;
  if (!s || !sched) return null;
  const say = (rank: number) => (rank <= 10 ? 'One of the easiest runs'
    : rank >= 23 ? 'One of the hardest runs' : 'A middling run');
  return (
    <Card style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: dim(0.45), marginBottom: 10 }}>
        Schedule — {SCHEDULE_SEASON}, for a {pos}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5, textWrap: 'pretty' }}>
        {ord(s.rank)} easiest of 32. {say(s.rank)} of opponents in the league for a {pos}:
        they gave up {s.perGame} points a game to {pos}s in {ALLOWED_SEASON}.
      </div>
      {/* The weeks the league is actually decided in, off its own settings —
          a season that averages out fine can still end against the two best
          defences left, and that is the half of a schedule people check. */}
      <div style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 10, textWrap: 'pretty' }}>
        <span style={{ color: dim(0.55) }}>
          Your playoffs, week{s.weeks.length > 1 ? 's ' : ' '}
          {s.weeks.length > 1 ? s.weeks[0] + '–' + s.weeks[s.weeks.length - 1] : s.weeks[0]}:
        </span>{' '}
        {s.weeks.map(w => sched[w - 1] || 'bye').join(' · ')} — {ord(s.playoffRank)} easiest
        of 32 ({s.playoffPerGame} a game allowed).
      </div>
    </Card>
  );
}

/**
 * You have decided you want him. Now: what would it take?
 *
 * The Trades tab answers the opposite question — it starts from your spare
 * parts and finds anything worth doing. This starts from one name, so it is
 * allowed to cost you a starter, and it says so rather than quietly excluding
 * every package that would.
 */
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

/** For a player you own the question is hold or sell; for anyone else it is buy. */
function verdict(p: Sheet): string {
  const peak = PEAK[p.pos as keyof typeof PEAK] || 26;
  if (p.owned) {
    if ((p.age || 0) > peak + 1) {
      return `Already yours and past his peak (${p.age}): your best sell candidate while the league still pays for him.`;
    }
    if (p.m.age > 0.9) return 'Already yours and still short of his peak. Hold — the model projects him upward.';
    return 'Already yours, inside his maximum-value window. No rush to buy or sell.';
  }
  if (p.m.need > 0.6 && p.m.value > 0.55) {
    return 'Clean fit: he fills your most expensive hole and is falling past where the board has him.';
  }
  if (p.m.need > 0.6) return 'Fills your most urgent need, though you would be taking him near his market price.';
  if (p.m.value > 0.65) return 'The best value on the board, not your need. Take him if you believe in best-player-available.';
  return 'A reasonable option without being the best: it neither solves a hole nor gets him below where the board has him.';
}
