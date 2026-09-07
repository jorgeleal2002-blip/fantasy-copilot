import type { PlayerCatalog, Pos, SleeperStatLine } from '../api/types';
import { PRIME, USAGE_WEIGHTS, POS } from './constants';

export interface Usage {
  /** offensive snaps played / team offensive snaps */
  snap: number | null;
  /** target share for receivers, carry share for backs, null for QBs */
  tgt: number | null;
  /** what "volume" means for this position — a share, or attempts per game for a QB */
  vol: number | null;
  gp: number;
  shareLabel: string;
  /** the share already formatted, since its unit changes by position */
  shareText: string | null;
  /** the same share as one short phrase — "22% targets" — for a line with no
   *  room to put a label and a value in separate columns */
  shareShort: string | null;

  /** yards per ball actually in their hands */
  eff: number | null;
  effLabel: string;
  /** long touchdowns per non-red-zone opportunity */
  ltr: number | null;
  longTd: number | null;

  /** touchdowns the player's opportunities predict */
  xtd: number | null;
  xtdPerGame: number | null;
  /** scored minus expected — the part that was luck */
  tdLuck: number | null;

  ppg: number | null;
  /**
   * Points per game with the luck taken out: his real volume, priced at rates
   * shrunk from his own toward his position's by how much each rate actually
   * repeats.
   *
   * Points are volume times efficiency and the two do not keep the same way. A
   * player's touches survive into the next season at about 0.8; his rates keep
   * anywhere from 0.58 down to 0.01 depending on which rate and which position
   * — see `KEEP`. So last season's points carry a helping of luck that is not
   * coming back, and re-pricing his opportunities throws that part away
   * without throwing away the part that was him.
   *
   * Backtested against the following season it orders at 0.797 where raw
   * points manage 0.795 (`scripts/backtest.mjs`), and — the half a rank
   * correlation cannot see — it is calibrated in POINTS to within a tenth
   * overall and within a third on the top sixty (`scripts/proj-check.mjs`).
   */
  ppgAdj: number | null;
  rz: number;
  rzShare: number | null;
  rzPerGame: number | null;
  td: number;
  tdPerGame: number | null;
  tdShare: number | null;
  rank: number | null;

  /** filled in once the seasons are blended */
  seasons?: number;
  seasonList?: string;
  gpTotal?: number;
  fade?: number;
  effPct?: number;
  volPct?: number;
  ltrPct?: number;
}

export type UsageMap = Record<string, Usage>;

/** Metrics that are the player's own rate, so they can be averaged across
 *  seasons. Shares are deliberately excluded: they are computed against this
 *  season's offence and do not travel backwards. */
/**
 * Blended across seasons, weighted by recency.
 *
 * `tgt` and `vol` were missing from this, which did not show while the screens
 * printed the snap share: that one WAS blended, so the app's own banner —
 * "real usage connected (2025 · 2024 · 2023)" — was true of the number on the
 * page. A share taken from the most recent season alone under that banner is
 * not, and one bad or injured year would have swung it. They are the same
 * number as each other for everyone but a quarterback, so blending one without
 * the other would only have made them disagree.
 */
const BLEND: (keyof Usage)[] = [
  'snap', 'tgt', 'vol', 'eff', 'ltr', 'xtdPerGame', 'ppg', 'ppgAdj', 'tdPerGame', 'rzPerGame',
];

/**
 * The share, written out. Its unit changes by position, so it is formatted
 * where the position is known — once, rather than at each of the four places
 * that show it, and again after blending, where the value it describes moves.
 */
function shareTexts(pos: string | undefined, share: number | null, vol: number | null) {
  const isQB = pos === 'QB';
  const isRun = pos === 'RB';
  return {
    shareLabel: isQB ? 'Attempts per game' : isRun ? 'Rush share' : 'Target share',
    /* Zero is not printed. A feed with no passing column and a quarterback who
     * genuinely never throws both arrive here as 0, and only one of them is
     * worth a line — "0 att/gm" beside a starter reads as a broken app, which
     * is what it was. Nothing to say is better said by saying nothing. */
    shareText: isQB
      ? (vol ? (vol as number).toFixed(1) : null)
      : (share ? ((share as number) * 100).toFixed(1) + '%' : null),
    shareShort: isQB
      ? (vol ? Math.round(vol as number) + ' att/gm' : null)
      : (share
        ? Math.round((share as number) * 100) + (isRun ? '% carries' : '% targets')
        : null),
  };
}

/**
 * Expected touchdowns, by least squares over real opportunities:
 *
 *   td ≈ b1·(red-zone touches) + b2·(touches outside it)
 *
 * The coefficients come out of the same feed being scored, so there is no
 * invented constant and no second source to reconcile by name. A position
 * whose sample is too small, or whose fitted rates come back negative or
 * absurd, simply gets no expected-TD number rather than a bad one.
 */
function fitTdRates(
  stats: Record<string, SleeperStatLine>,
  players: PlayerCatalog,
): Partial<Record<Pos, { rz: number; nz: number }>> {
  const rates: Partial<Record<Pos, { rz: number; nz: number }>> = {};

  for (const pos of ['RB', 'WR', 'TE'] as Pos[]) {
    let Sxx = 0, Syy = 0, Sxy = 0, Sxt = 0, Syt = 0, n = 0;
    for (const id of Object.keys(stats)) {
      const pl = players[id];
      const st = stats[id] || {};
      if (!pl || pl.position !== pos || !(st.gp && st.gp > 0)) continue;
      const rz = (st.rush_rz_att || 0) + (st.rec_rz_tgt || 0);
      const nz = Math.max((st.rush_att || 0) + (st.rec_tgt || 0) - rz, 0);
      if (rz + nz <= 0) continue;
      const td = (st.rush_td || 0) + (st.rec_td || 0);
      Sxx += rz * rz; Syy += nz * nz; Sxy += rz * nz; Sxt += rz * td; Syt += nz * td; n++;
    }
    const det = Sxx * Syy - Sxy * Sxy;
    if (n < 12 || Math.abs(det) < 1e-6) continue;
    const b1 = (Syy * Sxt - Sxy * Syt) / det;
    const b2 = (Sxx * Syt - Sxy * Sxt) / det;
    if (!(b1 > 0 && b1 < 1) || !(b2 >= 0 && b2 < 1)) continue;
    rates[pos] = { rz: b1, nz: b2 };
  }
  return rates;
}

/** One season's metrics. Everything joins by player_id — nothing is matched by name. */

/** The middle of a list, ignoring the entries that never existed. */
function median(xs: (number | null)[]): number {
  const v = xs.filter((x): x is number => Number.isFinite(x as number)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

interface Rates {
  /** catches per target */
  cat: number;
  /** yards per ball in hand, and touchdowns per ball in hand */
  ypt: number; tdr: number;
  /** the same two for a quarterback, per pass attempt */
  ypa: number; tpa: number;
}

/**
 * What an ORDINARY player at each position does with a chance.
 *
 * The median rather than the mean, because a handful of one-play specialists
 * with an eighty-yard average pull a mean somewhere no real player lives. The
 * minimums are there for the same reason: a rate off nine touches is not a
 * rate.
 */
function positionRates(
  stats: Record<string, SleeperStatLine>,
  players: PlayerCatalog,
  hasRec: boolean,
): Partial<Record<Pos, Rates>> {
  const rows: Partial<Record<Pos, SleeperStatLine[]>> = {};
  for (const id of Object.keys(stats)) {
    const pl = players[id];
    const pos = pl?.position as Pos;
    if (!pl || POS.indexOf(pos) < 0) continue;
    if ((stats[id]?.gp || 0) < 4) continue;
    (rows[pos] = rows[pos] || []).push(stats[id]);
  }
  const out: Partial<Record<Pos, Rates>> = {};
  POS.forEach(pos => {
    const list = rows[pos] || [];
    const touches = (st: SleeperStatLine) =>
      (hasRec ? (st.rec || 0) : (st.rec_tgt || 0)) + (st.rush_att || 0);
    out[pos] = {
      cat: median(list.map(st => ((st.rec_tgt || 0) >= 25 ? (st.rec || 0) / (st.rec_tgt || 1) : null)))
        || 0.65,
      ypt: median(list.map(st => (touches(st) >= 25
        ? ((st.rec_yd || 0) + (st.rush_yd || 0)) / touches(st) : null))),
      tdr: median(list.map(st => (touches(st) >= 25
        ? ((st.rec_td || 0) + (st.rush_td || 0)) / touches(st) : null))),
      ypa: median(list.map(st => ((st.pass_att || 0) >= 100
        ? (st.pass_yd || 0) / (st.pass_att || 1) : null))),
      tpa: median(list.map(st => ((st.pass_att || 0) >= 100
        ? (st.pass_td || 0) / (st.pass_att || 1) : null))),
    };
  });
  return out;
}

/**
 * How much of a player's OWN rate survives into the next season.
 *
 * What survives is his; what does not is replaced by what an ordinary player at
 * his position does, and that replacement is the whole of the luck adjustment.
 * A rate's shrinkage weight ought to be its reliability, so these ARE the
 * measured year-to-year correlations — volume-weighted, within position, over
 * 2021–2025, by `scripts/keeps.mjs`, which prints the table and the sample
 * behind every cell.
 *
 * They were one global set — cat .55, ypt .40, tdr .20 for everybody — which is
 * a claim that a quarterback's touchdown rate and a running back's catch rate
 * decay at the same speed. Measured, they do not, and the two worst errors both
 * showed on screen:
 *
 *   · A QUARTERBACK'S TOUCHDOWNS KEEP. Per attempt .36, and per carry .46 — the
 *     goal-line runner is a job, not a run of luck. Held at .20 the model took
 *     four points a game off Josh Allen and eight off Lamar Jackson, which is
 *     what a shrinkage weight too low for the position looks like from a phone.
 *   · A RUNNING BACK'S CATCH RATE IS NOISE. .01, over a hundred and
 *     twenty-five season pairs. It was being credited at .55.
 *
 * Everything not measurable for a position is zero, so it falls back to the
 * position median untouched: a quarterback has no targets to catch and nobody
 * else throws.
 */
const KEEP: Record<Pos, Rates> = {
  QB: { cat: 0, ypt: 0.55, tdr: 0.46, ypa: 0.37, tpa: 0.36 },
  RB: { cat: 0.01, ypt: 0.32, tdr: 0.14, ypa: 0, tpa: 0 },
  WR: { cat: 0.44, ypt: 0.51, tdr: 0.21, ypa: 0, tpa: 0 },
  TE: { cat: 0.24, ypt: 0.58, tdr: 0.14, ypa: 0, tpa: 0 },
};

/**
 * Points per game with the luck taken out — see `Usage.ppgAdj`.
 *
 * His real volume, priced at rates shrunk from his own toward his position's
 * by how much each rate actually repeats, in half-PPR: half a point a catch, a
 * tenth of a point a yard, six a touchdown, and a quarterback's passing on the
 * same footing.
 *
 * The remainder — interceptions, fumbles, two-point conversions, return yards,
 * everything the four lines above do not model — is carried across untouched,
 * as the gap between what he really scored and what this same formula says he
 * scored at his OWN rates. That makes the whole thing exact at the limit: shrink
 * nothing and it returns his actual points per game, so the adjustment can only
 * move him by the part it claims to be adjusting.
 *
 * This replaces a flat half-and-half of his points and his volume at the
 * position MEDIAN, which regressed everybody most of the way to average and cost
 * the sixty most productive players 1.41 points a game each — a compression a
 * rank correlation cannot see and the reason this number was wrong on a card
 * while scoring 0.803 in the backtest.
 */
function luckAdjusted(
  st: SleeperStatLine,
  pos: string | undefined,
  rates: Partial<Record<Pos, Rates>>,
  gp: number,
  hasRec: boolean,
): number | null {
  const k = rates[pos as Pos];
  const real = (st.pts_half_ppr || 0) / gp;
  if (!k || !k.ypt) return real;

  const tgt = st.rec_tgt || 0;
  const rush = st.rush_att || 0;
  const pa = st.pass_att || 0;
  // The same convention `positionRates` uses to count a ball in the hands, so
  // the player's rate and the position's are measured against each other
  // rather than against two different denominators. A feed with no receptions
  // column measures everybody by targets instead — worse, but consistent, and
  // consistency is the whole of what a shrinkage toward the median needs.
  const held = (hasRec ? (st.rec || 0) : (st.rec_tgt || 0)) + rush;

  /** His own rate where the sample supports one, shrunk toward the position's
   *  by how much that rate repeats; the position's where it does not. */
  const mix = (v: number, n: number, min: number, base: number, keep: number) =>
    (n >= min && Number.isFinite(v) ? base + keep * (v - base) : base);

  const rate = (keep: Rates): Rates => ({
    cat: mix(tgt && hasRec ? (st.rec || 0) / tgt : NaN, tgt, 25, k.cat, keep.cat),
    ypt: mix(held ? ((st.rec_yd || 0) + (st.rush_yd || 0)) / held : NaN, held, 25, k.ypt, keep.ypt),
    tdr: mix(held ? ((st.rec_td || 0) + (st.rush_td || 0)) / held : NaN, held, 25, k.tdr, keep.tdr),
    ypa: mix(pa ? (st.pass_yd || 0) / pa : NaN, pa, 100, k.ypa, keep.ypa),
    tpa: mix(pa ? (st.pass_td || 0) / pa : NaN, pa, 100, k.tpa, keep.tpa),
  });

  const points = (r: Rates) => {
    const recs = tgt * r.cat;
    const touches = recs + rush;
    let pts = recs * 0.5 + touches * r.ypt * 0.1 + touches * r.tdr * 6;
    if (pos === 'QB') pts += pa * (r.ypa * 0.04 + r.tpa * 4);
    return pts;
  };

  // Everything the formula does not model, kept as it was.
  const ALL: Rates = { cat: 1, ypt: 1, tdr: 1, ypa: 1, tpa: 1 };
  const keep = KEEP[pos as Pos] || KEEP.WR;
  const rest = (st.pts_half_ppr || 0) - points(rate(ALL));
  return (points(rate(keep)) + rest) / gp;
}

export function seasonUsage(
  stats: Record<string, SleeperStatLine>,
  players: PlayerCatalog,
): UsageMap {
  const teamTgt: Record<string, number> = {};
  const teamRush: Record<string, number> = {};
  const teamRz: Record<string, number> = {};
  const teamTd: Record<string, number> = {};

  for (const id of Object.keys(stats)) {
    const pl = players[id];
    const st = stats[id] || {};
    if (!pl || !pl.team) continue;
    teamTgt[pl.team] = (teamTgt[pl.team] || 0) + (st.rec_tgt || 0);
    teamRush[pl.team] = (teamRush[pl.team] || 0) + (st.rush_att || 0);
    teamRz[pl.team] = (teamRz[pl.team] || 0) + (st.rush_rz_att || 0) + (st.rec_rz_tgt || 0);
    teamTd[pl.team] = (teamTd[pl.team] || 0) + (st.rush_td || 0) + (st.rec_td || 0);
  }

  const tdRates = fitTdRates(stats, players);
  // Does this feed carry receptions? If not every receiver is measured by
  // targets instead — a worse metric, but consistent inside the percentile,
  // which is the only thing it is used for.
  const hasRec = Object.keys(stats).some(id => {
    const r = stats[id] && stats[id].rec;
    return Number.isFinite(r) && (r as number) > 0;
  });

  const ordinary = positionRates(stats, players, hasRec);

  const usage: UsageMap = {};
  for (const id of Object.keys(stats)) {
    const pl = players[id];
    const st = stats[id] || {};
    if (!pl || !pl.team) continue;
    const gp = st.gp || 0;
    const snap = st.tm_off_snp ? (st.off_snp || 0) / st.tm_off_snp : null;
    const isQB = pl.position === 'QB';
    const isRun = pl.position === 'RB';

    const share = isQB ? null : isRun
      ? (teamRush[pl.team] ? (st.rush_att || 0) / teamRush[pl.team] : null)
      : (teamTgt[pl.team] ? (st.rec_tgt || 0) / teamTgt[pl.team] : null);
    // A quarterback does not compete for targets but does have volume: pass
    // attempts plus carries per game. Leaving them with no measure at all gave
    // every starter a maximum floor (they all play ~100% of snaps) and
    // rewarded the efficient low-volume one. The percentile is taken within
    // the position, so the unit does not have to match.
    const vol = isQB ? (gp ? ((st.pass_att || 0) + (st.rush_att || 0)) / gp : null) : share;
    if (snap == null && share == null && !gp) continue;

    const rzOwn = (st.rush_rz_att || 0) + (st.rec_rz_tgt || 0);
    const nzOwn = Math.max((st.rush_att || 0) + (st.rec_tgt || 0) - rzOwn, 0);
    const tdOwn = (st.rush_td || 0) + (st.rec_td || 0) + (st.pass_td || 0);
    const scoredTd = (st.rush_td || 0) + (st.rec_td || 0);
    const rate = tdRates[pl.position as Pos];
    const xtd = rate && gp ? rate.rz * rzOwn + rate.nz * nzOwn : null;

    // Yards per ball IN THE HANDS, not per opportunity. Dividing by targets
    // would punish catch rate, which is the mark of the contested deep threat,
    // and reward the short-route receiver — the opposite of "explosive".
    const catches = hasRec ? (st.rec || 0) : (st.rec_tgt || 0);
    const opp = isQB ? (st.pass_att || 0) + (st.rush_att || 0)
      : isRun ? (st.rush_att || 0) + catches : catches;
    const yards = isQB ? (st.pass_yd || 0) + (st.rush_yd || 0)
      : isRun ? (st.rush_yd || 0) + (st.rec_yd || 0) : (st.rec_yd || 0);
    // Minimums are high on purpose: with a low threshold the specialist with a
    // handful of plays and an inflated average took the top and pushed the
    // real WR1s into the middle.
    const minOpp = isQB ? 200 : isRun ? 80 : (hasRec ? 40 : 60);
    const eff = opp >= minOpp ? yards / opp : null;

    // Long touchdowns: the ones scored ABOVE what their red-zone chances
    // predict. Those do not come from the 1-yard line — they come from
    // breaking a play. Red zone already bills the short ones, so they are not
    // counted twice here.
    const longTd = rate ? Math.max(scoredTd - rate.rz * rzOwn, 0) : null;
    const ltr = longTd != null && nzOwn >= (isRun ? 60 : 30) ? longTd / nzOwn : null;

    usage[id] = {
      snap, tgt: share, vol, gp,
      ...shareTexts(pl.position, share, vol),
      eff, effLabel: 'Yards per touch',
      ltr, longTd,
      xtd, xtdPerGame: xtd != null && gp ? xtd / gp : null,
      tdLuck: xtd != null ? scoredTd - xtd : null,
      ppg: gp ? (st.pts_half_ppr || 0) / gp : null,
      ppgAdj: gp ? luckAdjusted(st, pl.position, ordinary, gp, hasRec) : null,
      rz: rzOwn,
      rzShare: teamRz[pl.team] ? rzOwn / teamRz[pl.team] : null,
      rzPerGame: gp ? rzOwn / gp : null,
      td: tdOwn,
      tdPerGame: gp ? tdOwn / gp : null,
      tdShare: teamTd[pl.team] ? ((st.rush_td || 0) + (st.rec_td || 0)) / teamTd[pl.team] : null,
      rank: st.pos_rank_half_ppr || null,
    };
  }
  return usage;
}

/**
 * Three seasons, not one. A single season is a small sample: one injury, a new
 * coordinator or six strange weeks move any number. The most recent season
 * leads the blend and also owns anything that depends on today's role.
 */
export function blendSeasons(
  seasons: { year: number; usage: UsageMap }[],
  players: PlayerCatalog,
): UsageMap {
  if (!seasons.length) throw new Error('stats');
  const maps = seasons.map((s, i) => ({ ...s, w: USAGE_WEIGHTS[i] ?? 0.1, i }));
  const usage = maps[0].usage;

  for (const id of Object.keys(usage)) {
    const src = maps.filter(m => m.usage[id] && m.usage[id].gp >= 4);
    usage[id].seasons = src.length;
    usage[id].seasonList = src.map(m => m.year).join(', ');
    usage[id].gpTotal = src.reduce((a, m) => a + (m.usage[id].gp || 0), 0);
    if (src.length < 2) continue;

    // Averaging assumes the player is the same one they were three years ago,
    // and past their prime they are not: their 2023 props them up falsely. So
    // the further past the prime, the more the old seasons fade out.
    const pl = players[id];
    const end = (PRIME[pl?.position as Pos] ?? [24, 28])[1];
    const past = Math.max(0, (pl && pl.age ? pl.age : 25) - end);
    const fade = Math.max(1 - past * 0.18, 0.15);
    usage[id].fade = fade;

    for (const k of BLEND) {
      let sw = 0, sv = 0;
      for (const m of src) {
        const v = m.usage[id][k] as number | null | undefined;
        const w = m.w * Math.pow(fade, m.i);
        if (Number.isFinite(v)) { sv += (v as number) * w; sw += w; }
      }
      // weights renormalised over whatever was actually available
      if (sw > 0) (usage[id] as unknown as Record<string, number>)[k as string] = sv / sw;
    }
    // The formatted forms were written from ONE season's numbers. They describe
    // a value that has just moved, so they are written again from the blend.
    Object.assign(usage[id], shareTexts(pl?.position, usage[id].tgt, usage[id].vol));
  }

  // Percentiles AFTER blending, so a player is ranked against a three-year
  // distribution rather than one year's. A percentile also avoids any constant
  // that would saturate.
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
    const ok = Object.keys(usage).filter(id => {
      const pl = players[id];
      return pl && pl.position === pos && (usage[id].gpTotal || usage[id].gp || 0) >= 8;
    });
    for (const [src, dst] of [['eff', 'effPct'], ['vol', 'volPct'], ['ltr', 'ltrPct']] as const) {
      const vals = ok
        .filter(id => Number.isFinite(usage[id][src] as number))
        .sort((a, b) => (usage[a][src] as number) - (usage[b][src] as number));
      if (vals.length < 8) continue;
      vals.forEach((id, i) => { usage[id][dst] = i / (vals.length - 1); });
    }
  }

  if (!Object.keys(usage).length) throw new Error('empty');
  return usage;
}

/** Kept for the single-season path the tests and older callers use. */
export function buildUsage(
  stats: Record<string, SleeperStatLine>,
  players: PlayerCatalog,
): UsageMap {
  return blendSeasons([{ year: 0, usage: seasonUsage(stats, players) }], players);
}
