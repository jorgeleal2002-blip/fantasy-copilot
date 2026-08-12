import type { Pos, SleeperPlayer } from '../api/types';
import { DECAY, ELITE_HOLD, PRIME, RISE } from './constants';

export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/**
 * Value multiplier for a player's age. The prime is a window: climbing toward
 * it, flat inside it, falling away after it, each at that position's own rate.
 *
 * `elite` (0..1) is the player's quality relative to the board. A star does not
 * age like a backup — talent buys back some of what the body loses — so they
 * hold the window 1.5 years longer and decay 45% slower. With no value passed,
 * nobody gets the discount by default.
 */
export function ageCurve(
  pos: string | undefined,
  age: number | null | undefined,
  elite?: number,
): number {
  if (!age) return 0.72;
  // The bonus is scaled by how much longevity talent can actually buy at this
  // position — see ELITE_HOLD. Flat across positions, it kept old running
  // backs alive for years they do not get.
  const hold = ELITE_HOLD[pos as Pos] ?? 0.7;
  const e = (Number.isFinite(elite) ? clamp(elite as number, 0, 1) : 0) * hold;
  const [start, end0] = PRIME[pos as Pos] ?? [24, 28];
  const end = end0 + 1.5 * e;
  const decay = (DECAY[pos as Pos] ?? 0.09) * (1 - 0.45 * e);
  if (age < start) return clamp(1 - (start - age) * (RISE[pos as Pos] ?? 0.06), 0.35, 1);
  if (age <= end) return 1;
  return clamp(1 - (age - end) * decay, 0.1, 1);
}

/**
 * In redraft, age does not predict the future — it predicts this season's risk.
 * Being young is not an asset (you will never collect that development) and
 * being old is a liability, but a smaller one: it prices a year of wear, not a
 * three-year decline. No climb, and the fall at 45% of dynasty's.
 */
export function ageCurveRedraft(
  pos: string | undefined,
  age: number | null | undefined,
  elite?: number,
): number {
  if (!age) return 0.8;
  const [, end0] = PRIME[pos as Pos] ?? [24, 28];
  const hold = ELITE_HOLD[pos as Pos] ?? 0.7;
  const end = end0 + 1.5 * (Number.isFinite(elite) ? clamp(elite as number, 0, 1) : 0) * hold;
  if (age <= end) return 1;
  return clamp(1 - (age - end) * (DECAY[pos as Pos] ?? 0.09) * 0.45, 0.45, 1);
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
