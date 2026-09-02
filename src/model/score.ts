import type { SleeperPlayer } from '../api/types';
import type { MetricKey, Weights } from './constants';
import { ageCurve, ageCurveRedraft, clamp, rankScore, talentScale } from './math';
import type { Usage } from './usage';

export type Metrics = Record<MetricKey, number>;

/**
 * The breakdown for a player the Fit Score does not describe.
 *
 * Kickers and defences are on the board but not scored by it, and a breakdown
 * of zeroes is the truthful shape: the sheet draws nine bars at nothing rather
 * than nine bars of whatever each missing metric happens to default to.
 */
export const EMPTY_METRICS: Metrics = {
  talent: 0, need: 0, value: 0, floor: 0, boom: 0, combo: 0, age: 0, stack: 0, rz: 0,
};

/** How much of a ceiling we credit to a player nobody has seen produce yet. */
const UNSEEN = 0.6;

export interface ScoreContext {
  /** 1-based index of the player among what is STILL AVAILABLE */
  idx?: number;
  /** the pick number we are scoring for — value depends on where you select */
  pick?: number;
  /** the overall pick the draft has actually reached, which is what turns an
   *  index among survivors back into a position in the whole draft */
  now?: number;
  /** market (or modelled) value of this player, and the board's maximum */
  dv?: number;
  dvMax?: number;
  /** NFL-team correlation with the rest of your roster */
  stack?: number;
  use?: Usage;
  /** redraft leagues switch the age curve off entirely */
  redraft?: boolean;
  /** consensus rank on the board — the market's order, not Sleeper's search
   *  index. Falls back to `search_rank` only when nothing better exists. */
  rank?: number | null;
}

export interface ScoreResult {
  m: Metrics;
  fit: number;
  adp: number | null | undefined;
}

/**
 * Fit Score = Σ wᵢ × metricᵢ, rendered 0–100.
 *
 * Each metric is independently 0..1 so the breakdown in the player sheet reads
 * as "metric × weight = contribution". Where real 2025 usage is available it
 * replaces most of the proxy: floor becomes 70% actual snap rate, explosiveness
 * 55% actual ball share.
 */
export function scorePlayer(
  p: SleeperPlayer,
  needScore: Partial<Record<string, number>>,
  ctx: ScoreContext,
  w: Weights,
): ScoreResult {
  const adp = ctx.rank ?? p.search_rank;
  const rs = rankScore(adp);
  const exp = p.years_exp || 0;
  const age = p.age || 26;
  const talent = ctx.dv != null ? talentScale(ctx.dv, ctx.dvMax || 1) : rs;
  /** Where this player comes off the board if it runs to consensus from here. */
  const board = Math.max((ctx.now || 1) - 1 + (ctx.idx || 0), 1);

  // Explosiveness before any evidence: what his rank implies, plus what his age
  // and inexperience suggest. The second half is a guess about a ceiling, not a
  // measurement of one, and it is discounted below where nobody has seen him
  // play — see UNSEEN.
  const boomBase = rs * 0.45;
  const boomGuess = (age <= 24 ? 0.42 : age <= 26 ? 0.26 : 0.08) + (exp <= 2 ? 0.12 : 0);

  const m: Metrics = {
    need: needScore[p.position || ''] || 0,
    talent,
    // Value is a DISCOUNT: he is still sitting there later than the board says
    // he should be. `idx` counts survivors, so it has to be put back on the
    // draft's own scale first — with `now - 1` picks already gone, the player
    // idx-th in the queue comes off at `now - 1 + idx`. Cheaper than your pick
    // is a slide; dearer than it is a reach.
    //
    // The comparison used to run the other way, which scored the deepest name
    // on the board as the biggest bargain at an early pick and hung a "falling"
    // chip on what was actually a ten-spot reach.
    value: ctx.idx
      ? clamp(0.5 + ((ctx.pick || 0) - board) / ((ctx.pick || 0) + board) * 0.5, 0, 1)
      : 0.5,
    floor: clamp(rs * 0.7 + (exp >= 3 ? 0.3 : exp >= 1 ? 0.18 : 0.05), 0, 1),
    boom: clamp(boomBase + boomGuess, 0, 1),
    combo: 0,
    age: ctx.redraft
      ? ageCurveRedraft(p.position, p.age, talent)
      : ageCurve(p.position, p.age, talent),
    stack: ctx.stack != null ? ctx.stack : 0.5,
    rz: 0.35,
  };

  // Number.isFinite rather than != null: a missing value can arrive as NaN, and
  // NaN != null is true — one of them would poison this player's Fit app-wide.
  const fin = Number.isFinite;
  const u = ctx.use;
  let seenBoom = false;
  if (u) {
    // Floor = the certainty they will produce: being on the field (snaps) and
    // the ball reaching them (volume). Volume lives here, not in explosiveness —
    // many touches do not make you explosive, they make you dependable.
    if (fin(u.snap) || fin(u.volPct)) {
      const sn = fin(u.snap) ? clamp(u.snap as number, 0, 1) : null;
      const vo = fin(u.volPct) ? (u.volPct as number) : null;
      const real = sn != null && vo != null ? sn * 0.62 + vo * 0.38 : (sn ?? vo);
      if (real != null) m.floor = clamp(m.floor * 0.3 + real * 0.7, 0, 1);
    }
    // Explosiveness = how much each touch returns: yards per touch and long
    // touchdowns. Volume moved to the floor; short scores stay in red zone.
    if (fin(u.effPct) || fin(u.ltrPct)) {
      const ef = fin(u.effPct) ? (u.effPct as number) : null;
      const lt = fin(u.ltrPct) ? (u.ltrPct as number) : null;
      const real = ef != null && lt != null ? ef * 0.70 + lt * 0.30 : (ef ?? lt);
      if (real != null) { m.boom = clamp(m.boom * 0.35 + real * 0.65, 0, 1); seenBoom = true; }
    } else if (fin(u.tgt) && (u.tgt as number) > 0) {
      m.boom = clamp(m.boom * 0.45 + clamp((u.tgt as number) * 4, 0, 1) * 0.55, 0, 1);
      seenBoom = true;
    }
    // Red zone: share of the chances near the goal line plus EXPECTED
    // touchdowns per game. Scored ones carry the luck with them and luck does
    // not repeat; expected ones come from opportunities, which do persist.
    if (fin(u.rzShare) || fin(u.xtdPerGame) || fin(u.tdPerGame)) {
      const rzPart = fin(u.rzShare) ? clamp((u.rzShare as number) * 4.5, 0, 1) : null;
      const perGame = fin(u.xtdPerGame) ? u.xtdPerGame : u.tdPerGame;
      const tdPart = fin(perGame) ? clamp((perGame as number) / 1.1, 0, 1) : null;
      const blend = rzPart != null && tdPart != null ? rzPart * 0.6 + tdPart * 0.4 : (rzPart ?? tdPart);
      if (fin(blend)) m.rz = blend as number;
    }
  }

  // Nobody has watched this one play. The age-and-inexperience half of the
  // ceiling is speculation, and at full strength it beat men whose ceiling had
  // actually been measured: a rookie with no snaps scored .67 where a proven
  // veteran's real explosiveness came back .25. Evidence should not lose to its
  // own absence, so the guess is discounted until there is some.
  if (!seenBoom) m.boom = clamp(boomBase + boomGuess * UNSEEN, 0, 1);

  // Availability and role, straight out of Sleeper's own catalog — no new data
  // to fetch. These go against the FLOOR, which is where they live: an injured
  // player, or one sitting second on his depth chart, has not lost talent. He
  // has lost the certainty that he will produce.
  const inj = String(p.injury_status || '').toLowerCase();
  const status = String(p.status || '').toLowerCase();
  const injPen = status.includes('injured reserve') || status.includes('pup') ? 0.45
    : status.includes('inactive') || status.includes('practice') ? 0.30
      : inj.includes('out') ? 0.35
        : inj.includes('doubt') ? 0.22
          : inj.includes('quest') ? 0.10
            : inj ? 0.06 : 0;
  // The depth chart warns of competition weeks before any statistic does: a
  // team promoting someone over him shows up here first.
  const dco = Number(p.depth_chart_order);
  const depthPen = Number.isFinite(dco) && dco > 1 ? Math.min((dco - 1) * 0.12, 0.30) : 0;
  if (injPen || depthPen) m.floor = clamp(m.floor * (1 - Math.min(injPen + depthPen, 0.75)), 0, 1);

  // Consistency WITH a ceiling: the geometric mean of floor and boom. Averaging
  // lets the lopsided through (0.9 and 0.1 average the same as 0.5 and 0.5);
  // multiplying demands both — the one who gives you the minimum one Sunday and
  // 20 the next falls out here.
  m.combo = Math.sqrt(clamp(m.floor, 0, 1) * clamp(m.boom, 0, 1));
  // Last net: any metric that is not finite returns to its neutral before summing.
  (Object.keys(m) as MetricKey[]).forEach(k => {
    if (!fin(m[k])) m[k] = k === 'rz' ? 0.35 : 0.5;
  });

  const fit = Math.round((Object.keys(w) as MetricKey[]).reduce((a, k) => a + w[k] * m[k], 0) * 100);
  return { m, fit, adp };
}

/**
 * Two terms mean nothing for a player you already own, and both were being
 * charged against him.
 *
 * He cannot fill a hole you have — he is already on the roster. And he cannot
 * be a draft-day bargain: "value" asks whether he is still available later
 * than the board says he should be, which has no answer once he is yours, so
 * it sat pinned at its neutral 0.5 and quietly capped every owned player about
 * five points below what the rest of his metrics earned.
 *
 * Dropping both and renormalising leaves the score made only of things that
 * are actually true of him.
 */
export function ownedWeights(w: Weights): Weights {
  const dead: MetricKey[] = ['need', 'value'];
  const rest = 1 - dead.reduce((a, k) => a + w[k], 0);
  const out = {} as Weights;
  (Object.keys(w) as MetricKey[]).forEach(k => {
    out[k] = dead.indexOf(k) >= 0 ? 0 : w[k] / rest;
  });
  return out;
}

/**
 * In redraft you draft to win weeks now, not to be right in two years. The
 * dynasty weights are transformed while keeping the character of the chosen
 * strategy: what gets paid this Sunday goes up (need, reaching, floor), what
 * only pays with time goes down (age, speculative upside).
 */
export function redraftWeights(w: Weights): Weights {
  const r: Weights = {
    talent: w.talent * 1.12,
    need: w.need * 1.25,     // the hole is paid this week, not in two years
    value: w.value * 1.55,   // reaching hurts: the spent pick does not come back
    floor: w.floor * 1.30,
    boom: w.boom * 0.80,
    combo: w.combo,
    age: w.age * 0.30,       // only this season's risk
    stack: w.stack,
    rz: w.rz * 1.10,
  };
  const total = (Object.keys(r) as MetricKey[]).reduce((a, k) => a + r[k], 0);
  (Object.keys(r) as MetricKey[]).forEach(k => { r[k] = r[k] / total; });
  return r;
}

/**
 * Short chips explaining why the top recommendation is the top recommendation.
 *
 * `at` is where the board has him, already written as a pick ("1.04"), so the
 * chips talk in the units the draft is conducted in.
 */
export function reasons(m: Metrics, at: string | null, pos: string, age: number | null | undefined): string[] {
  const out: string[] = [];
  if (m.talent > 0.72) out.push(at ? 'Board has him at ' + at : 'Near the top of the board');
  if (m.need > 0.6) out.push('You need ' + pos);
  if (m.value > 0.6) out.push(at ? 'Falling past ' + at : 'Falling past his slot');
  // "Still rising" is a claim about a career, and the age term does not make
  // it: in redraft the curve is flat through the thirties because the question
  // is only this season, so a 31-year-old scored top marks and got told he was
  // on the way up.
  if (m.age > 0.9) {
    out.push(age != null && age <= 25
      ? age + ' years old, still rising'
      : 'Age is no argument against him');
  }
  if (m.boom > 0.7) out.push('High ceiling');
  if (m.floor > 0.75) out.push('Safe floor');
  return out.slice(0, 4);
}
