/**
 * Runs the real engine on a controlled sample and dumps every intermediate
 * value, so the write-up can quote computed numbers rather than illustrative
 * ones.
 *
 *   npx esbuild scripts/explain.ts --bundle --platform=node --outfile=<tmp>.cjs
 *   node <tmp>.cjs <out.json>
 */
import { writeFileSync } from 'node:fs';
import { STRATS, PRIME, DECAY, RISE, ELITE_HOLD, USAGE_WEIGHTS, METRIC_LABEL } from '../src/model/constants';
import { ageCurve, ageCurveRedraft, rankScore, talentBase } from '../src/model/math';
import { scorePlayer, ownedWeights, redraftWeights } from '../src/model/score';
import { seasonUsage, blendSeasons } from '../src/model/usage';
import type { PlayerCatalog, SleeperStatLine } from '../src/api/types';

const out: Record<string, unknown> = {};
const r3 = (n: number | null | undefined) => (Number.isFinite(n) ? +(n as number).toFixed(3) : null);

// ── 1. A season of stats built to a known truth, so the regression is checkable.
//     Opportunity counts are whole numbers, so nothing is lost to rounding and
//     the recovered coefficients can be compared against the truth exactly.
const RZ = 0.19, NZ = 0.021;
const players: PlayerCatalog = {};
const stats: Record<string, SleeperStatLine> = {};
for (let i = 0; i < 44; i++) {
  const id = 'p' + i;
  const isWR = i % 2 === 1;
  players[id] = {
    player_id: id, position: isWR ? 'WR' : 'RB', team: 'KC',
    age: 24 + (i % 8), first_name: 'P', last_name: String(i),
  } as PlayerCatalog[string];
  const rz = 4 + i;              // red-zone touches
  const nz = 60 + i * 5;         // touches outside it
  const td = RZ * rz + NZ * nz;  // the truth the regression has to find
  stats[id] = {
    gp: 16,
    rush_att: isWR ? 0 : rz + nz, rec_tgt: isWR ? rz + nz : 0,
    rush_rz_att: isWR ? 0 : rz, rec_rz_tgt: isWR ? rz : 0,
    rush_td: isWR ? 0 : td, rec_td: isWR ? td : 0,
    rush_yd: isWR ? 0 : (rz + nz) * 4.4, rec_yd: isWR ? (rz + nz) * 11.5 : 0,
    rec: isWR ? Math.round((rz + nz) * 0.68) : 0,
    off_snp: 500 + i * 5, tm_off_snp: 1040, pts_half_ppr: 90 + i * 4,
  } as SleeperStatLine;
}
const season = seasonUsage(stats, players);

// Recover the fitted coefficients from two players' expected TDs:
//   xtd_a = b1·rz_a + b2·nz_a ,  xtd_b = b1·rz_b + b2·nz_b
const A = { rz: 4, nz: 60, xtd: season.p0.xtd as number };
const B = { rz: 8, nz: 80, xtd: season.p4.xtd as number };
const det = A.rz * B.nz - A.nz * B.rz;
const fittedRz = (A.xtd * B.nz - A.nz * B.xtd) / det;
const fittedNz = (A.rz * B.xtd - A.xtd * B.rz) / det;

out.regression = {
  truth: { rz: RZ, nz: NZ },
  fitted: { rz: +fittedRz.toFixed(5), nz: +fittedNz.toFixed(5) },
  sampleSize: Object.keys(stats).length,
  sample: ['p0', 'p4', 'p9'].map(id => ({
    id, pos: players[id].position,
    rzTouches: (stats[id].rush_rz_att || 0) + (stats[id].rec_rz_tgt || 0),
    otherTouches: (stats[id].rush_att || 0) + (stats[id].rec_tgt || 0)
      - ((stats[id].rush_rz_att || 0) + (stats[id].rec_rz_tgt || 0)),
    scoredTd: +((stats[id].rush_td || 0) + (stats[id].rec_td || 0)).toFixed(3),
    xtd: r3(season[id].xtd),
    tdLuck: r3(season[id].tdLuck),
    longTd: r3(season[id].longTd),
    eff: r3(season[id].eff),
    snap: r3(season[id].snap),
  })),
};

// ── 2. Three seasons blended, with the recency fade
const blended = blendSeasons(
  [2025, 2024, 2023].map(year => ({ year, usage: seasonUsage(stats, players) })),
  players,
);
const oldRb = Object.keys(blended).find(id => players[id].position === 'RB' && players[id].age === 30)!;
const youngWr = Object.keys(blended).find(id => players[id].position === 'WR' && players[id].age === 25)!;
out.blend = {
  weights: USAGE_WEIGHTS,
  cases: [oldRb, youngWr].map(id => ({
    id, pos: players[id].position, age: players[id].age,
    primeEnds: PRIME[players[id].position as 'RB'][1],
    seasons: blended[id].seasons,
    seasonList: blended[id].seasonList,
    gpTotal: blended[id].gpTotal,
    fade: blended[id].fade,
    effPct: r3(blended[id].effPct),
    volPct: r3(blended[id].volPct),
    ltrPct: r3(blended[id].ltrPct),
    snap: r3(blended[id].snap),
    xtdPerGame: r3(blended[id].xtdPerGame),
    rzShare: r3(blended[id].rzShare),
  })),
  // What the three weights become once the fade is applied and renormalised
  effectiveWeights: [0.28, 1].map(fade => ({
    fade,
    raw: USAGE_WEIGHTS.map((w, i) => w * Math.pow(fade, i)),
    normalised: (() => {
      const raw = USAGE_WEIGHTS.map((w, i) => w * Math.pow(fade, i));
      const s = raw.reduce((a, b) => a + b, 0);
      return raw.map(v => +(v / s).toFixed(3));
    })(),
  })),
};

// ── 3. A full Fit, metric by metric
const w = STRATS.balanced.w;
const subject = {
  player_id: 'x', position: 'WR', age: 25, years_exp: 3, search_rank: 22,
  injury_status: null, status: 'Active', depth_chart_order: 1,
} as unknown as Parameters<typeof scorePlayer>[0];
// A realistic usage line, set by hand so every step of the arithmetic can be
// checked against the formulas without depending on the synthetic percentiles.
const use = {
  ...blended[youngWr],
  snap: 0.82, volPct: 0.88, effPct: 0.74, ltrPct: 0.61,
  rzShare: 0.19, xtdPerGame: 0.55, tdPerGame: 0.62,
};
const ctx = { idx: 6, pick: 17, dv: 6100, dvMax: 10000, stack: 0.75, use };
const scored = scorePlayer(subject, { WR: 0.55 }, ctx, w);
out.fit = {
  subject, context: { idx: ctx.idx, pick: ctx.pick, dv: ctx.dv, dvMax: ctx.dvMax, stack: ctx.stack },
  usageUsed: {
    snap: r3(use.snap), volPct: r3(use.volPct), effPct: r3(use.effPct),
    ltrPct: r3(use.ltrPct), rzShare: r3(use.rzShare), xtdPerGame: r3(use.xtdPerGame),
  },
  weights: w,
  metrics: Object.fromEntries(Object.entries(scored.m).map(([k, v]) => [k, r3(v)])),
  contributions: Object.fromEntries(
    (Object.keys(w) as (keyof typeof w)[]).map(k => [k, +(w[k] * scored.m[k] * 100).toFixed(2)]),
  ),
  total: scored.fit,
  labels: METRIC_LABEL,
  // The proxy the same player would have scored with no usage feed at all
  noUsage: (() => {
    const s = scorePlayer(subject, { WR: 0.55 }, { ...ctx, use: undefined }, w);
    return { metrics: Object.fromEntries(Object.entries(s.m).map(([k, v]) => [k, r3(v)])), total: s.fit };
  })(),
};

// ── 4. What availability and the depth chart cost
const pen = (state: string, p: typeof subject) => {
  const s = scorePlayer(p, { WR: 0.55 }, ctx, w);
  return { state, floor: r3(s.m.floor), combo: r3(s.m.combo), fit: s.fit };
};
out.penalties = [
  ...['healthy', 'Questionable', 'Doubtful', 'Out'].map(state =>
    pen(state, { ...subject, injury_status: state === 'healthy' ? null : state })),
  ...[2, 3].map(d => pen('depth chart ' + d, { ...subject, depth_chart_order: d })),
  pen('injured reserve', { ...subject, status: 'Injured Reserve' }),
];

// The synthetic team puts all 44 players on one roster, so team-relative shares
// are degenerate there — record the real one for the write-up.
out.p9 = {
  rz: 13, teamRz: Object.keys(stats).reduce((a, id) =>
    a + (stats[id].rush_rz_att || 0) + (stats[id].rec_rz_tgt || 0), 0),
  rzShare: r3(season.p9.rzShare), xtdPerGame: r3(season.p9.xtdPerGame),
  eff: r3(season.p9.eff), snap: r3(season.p9.snap),
};

// ── 5. The age curve, per position, with and without the elite bonus
out.age = {
  prime: PRIME, rise: RISE, decay: DECAY, eliteHold: ELITE_HOLD,
  table: (['QB', 'RB', 'WR', 'TE'] as const).map(pos => ({
    pos,
    prime: PRIME[pos],
    rows: [22, 24, 26, 28, 30, 32].map(age => ({
      age,
      plain: r3(ageCurve(pos, age, 0)),
      elite: r3(ageCurve(pos, age, 1)),
      redraft: r3(ageCurveRedraft(pos, age, 0)),
    })),
    // What a 29-year-old star keeps two years out — the CMC case
    keepsTwoYears: {
      plain: r3(ageCurve(pos, 31, 0) / Math.max(ageCurve(pos, 29, 0), 0.05)),
      elite: r3(ageCurve(pos, 31, 1) / Math.max(ageCurve(pos, 29, 1), 0.05)),
      eliteFlat: r3(
        // what it was before ELITE_HOLD: the bonus applied at full strength
        (() => {
          const end = PRIME[pos][1] + 1.5, dec = DECAY[pos] * 0.55;
          const f = (a: number) => (a <= end ? 1 : Math.max(1 - (a - end) * dec, 0.1));
          return f(31) / Math.max(f(29), 0.05);
        })(),
      ),
    },
  })),
};

// ── 6. How the weight sets differ
const r = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(3)]));
out.weightSets = {
  balanced: r(STRATS.balanced.w),
  floor: r(STRATS.floor.w),
  upside: r(STRATS.upside.w),
  owned: r(ownedWeights(STRATS.balanced.w)),
  redraft: r(redraftWeights(STRATS.balanced.w)),
};

out.helpers = {
  rankScore: [1, 12, 40, 120, 400].map(rk => ({ rank: rk, value: r3(rankScore(rk)) })),
  talentBase: [1, 22, 62, 162, 400].map(rk => ({ adp: rk, value: +talentBase(rk).toFixed(4) })),
};

writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
console.log('written', process.argv[2]);
