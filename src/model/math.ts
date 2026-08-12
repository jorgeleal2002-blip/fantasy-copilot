import type { Pos, SleeperPlayer } from '../api/types';
import { DECAY, PEAK } from './constants';

export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/**
 * Value multiplier for a player's age at their position: climbs to the
 * positional peak, then decays at that position's own rate.
 */
export function ageCurve(pos: string | undefined, age: number | null | undefined): number {
  if (!age) return 0.72;
  const peak = PEAK[pos as Pos] ?? 26;
  if (age <= peak) return clamp(0.82 + (age - (peak - 6)) * 0.03, 0.5, 1);
  return clamp(1 - (age - peak) * (DECAY[pos as Pos] ?? 0.09), 0.1, 1);
}

/** Board position → a 0..1 score. Log-shaped: the top of a board is steep. */
export const rankScore = (r: number | null | undefined) =>
  clamp(1 - Math.log10(Math.max(r || 900, 1)) / 3.1, 0.02, 1);

/** Talent from Sleeper's ADP, decayed exponentially — raw ADP compresses the
 *  top of the board far too much to separate a top-20 from a top-150. */
export const talentBase = (adp: number | null | undefined) =>
  clamp(Math.exp(-((adp || 900) - 1) / 70), 0.008, 1);

/** Fallback dynasty value when the market feed is down:
 *  talent × the format's positional premium × the position's age curve. */
export const dynastyVal = (pl: SleeperPlayer, mult: Record<string, number>) =>
  talentBase(pl.search_rank) * (mult[pl.position || ''] || 1) * ageCurve(pl.position, pl.age);

export const grade = (v: number) =>
  v >= 0.80 ? 'A+' : v >= 0.72 ? 'A' : v >= 0.65 ? 'B+' : v >= 0.57 ? 'B'
    : v >= 0.50 ? 'C+' : v >= 0.42 ? 'C' : 'D';

export const playerName = (p: SleeperPlayer): string =>
  p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();

export const num = (n: number) => Math.round(n).toLocaleString('en-US');
