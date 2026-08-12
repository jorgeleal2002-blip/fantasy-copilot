import type { SleeperPlayer } from '../api/types';
import type { MetricKey, Weights } from './constants';
import { ageCurve, clamp, rankScore } from './math';
import type { Usage } from './usage';

export type Metrics = Record<MetricKey, number>;

export interface ScoreContext {
  /** 1-based index of the player on the current board */
  idx?: number;
  /** the pick number we are scoring for — value depends on where you select */
  pick?: number;
  /** market (or modelled) value of this player, and the board's maximum */
  dv?: number;
  dvMax?: number;
  /** NFL-team correlation with the rest of your roster */
  stack?: number;
  use?: Usage;
  /** redraft leagues switch the age curve off entirely */
  redraft?: boolean;
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
  const adp = p.search_rank;
  const rs = rankScore(adp);
  const exp = p.years_exp || 0;
  const age = p.age || 26;

  const m: Metrics = {
    need: needScore[p.position || ''] || 0,
    talent: ctx.dv != null ? clamp(ctx.dv / (ctx.dvMax || 1), 0, 1) : rs,
    value: ctx.idx ? clamp(0.5 + (ctx.idx - (ctx.pick || 0)) / (ctx.idx + (ctx.pick || 0)) * 0.5, 0, 1) : 0.5,
    floor: clamp(rs * 0.7 + (exp >= 3 ? 0.3 : exp >= 1 ? 0.18 : 0.05), 0, 1),
    boom: clamp(rs * 0.45 + (age <= 24 ? 0.42 : age <= 26 ? 0.26 : 0.08) + (exp <= 2 ? 0.12 : 0), 0, 1),
    age: ctx.redraft ? 0.8 : ageCurve(p.position, p.age),
    stack: ctx.stack != null ? ctx.stack : 0.5,
    rz: 0.35,
  };

  const u = ctx.use;
  if (u) {
    if (u.snap != null) m.floor = clamp(m.floor * 0.3 + clamp(u.snap, 0, 1) * 0.7, 0, 1);
    if (u.tgt != null) m.boom = clamp(m.boom * 0.45 + clamp(u.tgt * 4, 0, 1) * 0.55, 0, 1);
    // Red zone: share of the offence's chances inside the 20, plus touchdowns
    // actually scored per game.
    if (u.rzShare != null || u.tdPerGame != null) {
      const rzPart = u.rzShare != null ? clamp(u.rzShare * 4.5, 0, 1) : null;
      const tdPart = u.tdPerGame != null ? clamp(u.tdPerGame / 1.1, 0, 1) : null;
      m.rz = rzPart != null && tdPart != null ? rzPart * 0.6 + tdPart * 0.4 : (rzPart ?? tdPart ?? m.rz);
    }
  }

  const fit = Math.round((Object.keys(w) as MetricKey[]).reduce((a, k) => a + w[k] * m[k], 0) * 100);
  return { m, fit, adp };
}

/**
 * A player already on your roster cannot fill a hole you have — so drop the
 * need term and renormalise the rest, or everyone you own grades a flat C.
 */
export function ownedWeights(w: Weights): Weights {
  const rest = 1 - w.need;
  const out = {} as Weights;
  (Object.keys(w) as MetricKey[]).forEach(k => {
    if (k !== 'need') out[k] = w[k] / rest;
  });
  out.need = 0;
  return out;
}

/** Short chips explaining why the top recommendation is the top recommendation. */
export function reasons(m: Metrics, adp: number | null | undefined, pos: string, age: number | null | undefined): string[] {
  const out: string[] = [];
  if (m.talent > 0.72) out.push('Top ' + adp + ' on the board');
  if (m.need > 0.6) out.push('You need ' + pos);
  if (m.value > 0.6) out.push('Falling below ADP (' + adp + ')');
  if (m.age > 0.9) out.push((age || '?') + ' years old, still rising');
  if (m.boom > 0.7) out.push('High ceiling');
  if (m.floor > 0.75) out.push('Safe floor');
  return out.slice(0, 4);
}
