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
/**
 * A place on the board, written the way a draft is spoken: "1.04".
 *
 * A bare rank is not a number anyone drafts by — "37th" makes you count. The
 * pick it lands on at this league's size is the same fact, already answered.
 */
export const pickLabel = (n: number | null | undefined, teams: number) => {
  if (!n || n < 1 || teams < 1) return null;
  return (Math.floor((n - 1) / teams) + 1) + '.' + String(((n - 1) % teams) + 1).padStart(2, '0');
};

/**
 * Talent from market value, on a log scale over the pool it is ranking.
 *
 * Value across a player pool spans two to three orders of magnitude — a first-
 * round veteran is worth a hundred times a bench body, not five times. Divided
 * linearly by the most valuable asset in scope, almost everyone lands near
 * zero: the best rookie on a real board scored 0.056, and since talent carries
 * the heaviest weight in the Rating, it dragged every rookie into the twenties
 * out of a hundred. A board where the 1.01 reads 32 is not measuring anything.
 *
 * But a fixed three decades has the mirror fault at the other end, and that is
 * the end a league table is read at. Three decades of range spent on a pool
 * that only spans one puts the whole top of it inside a sliver of the scale:
 * two receivers thirteen per cent apart in value came out 0.997 and 0.980,
 * six tenths of a Rating point, while everything else about them was worth
 * three or four. The best players in a league were indistinguishable on the
 * term that weighs the most.
 *
 * So the range is the pool's own. `lo` is the least valuable thing being
 * ranked; left out it falls back to a thousandth of the top, which is the
 * three decades this always used and exactly what a draft board wants. A
 * league of rostered players passes its real floor and the scale stretches
 * over what is actually there.
 */
export const talentScale = (dv: number, dvMax: number, lo?: number) => {
  if (!(dv > 0) || !(dvMax > 0)) return 0;
  const floor = lo != null && lo > 0 && lo < dvMax ? lo : dvMax / 1000;
  const span = Math.log10(dvMax / floor);
  if (!(span > 0)) return 1;
  return clamp(Math.log10(dv / floor) / span, 0, 1);
};

/**
 * The bottom of a pool, for `talentScale` to stretch its scale over.
 *
 * A scale belongs to the pool it is measuring, and the app ranks the same
 * league through several lenses that are not the same pool: today's values,
 * the same values aged two years, the surplus over a replacement starter. Each
 * needs its own floor, and handing one lens another's puts part of it under the
 * bottom of the scale where everything clamps to zero together.
 *
 * Zero and below are absent rather than low — a player the market has no price
 * for is not the cheapest man in the league — and a pool with nothing in it has
 * no floor, which `talentScale` reads as "use the three decades a draft board
 * wants".
 */
export const poolFloor = (values: number[]): number | undefined => {
  let lo: number | undefined;
  for (const v of values) {
    if (!(v > 0) || !Number.isFinite(v)) continue;
    if (lo === undefined || v < lo) lo = v;
  }
  return lo;
};

export const rankScore = (r: number | null | undefined) =>
  clamp(1 - Math.log10(Math.max(r || 900, 1)) / 3.1, 0.02, 1);

/** Talent from Sleeper's ADP, decayed exponentially — raw ADP compresses the
 *  top of the board far too much to separate a top-20 from a top-150. */
export const talentBase = (adp: number | null | undefined) =>
  clamp(Math.exp(-((adp || 900) - 1) / 70), 0.008, 1);

/**
 * Fallback value when the market feed is down: talent × the format's positional
 * premium × the age curve — and the age curve has to be the right one. In a
 * redraft league a 31-year-old back is worth 70% of himself, not the 40% that
 * three more seasons of decline would price him at.
 */
export const modelVal = (
  pl: SleeperPlayer,
  mult: Record<string, number>,
  redraft = false,
) =>
  talentBase(pl.search_rank)
  * (mult[pl.position || ''] || 1)
  * (redraft ? ageCurveRedraft : ageCurve)(pl.position, pl.age);

export const grade = (v: number) =>
  v >= 0.80 ? 'A+' : v >= 0.72 ? 'A' : v >= 0.65 ? 'B+' : v >= 0.57 ? 'B'
    : v >= 0.50 ? 'C+' : v >= 0.42 ? 'C' : 'D';

export const playerName = (p: SleeperPlayer): string =>
  p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();

export const num = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * How much of "player quality" is what he has done, against what he costs.
 *
 * Quality was a fixed three-fifths market price and two-fifths production, and
 * that fraction made sense in an off-season: the market has watched a player
 * for years and a model has watched him for three. It stops making sense in
 * October. The market's price is what he is worth to trade for, and it moves
 * in weeks, while the season is telling you every Sunday who is actually good
 * now. So the evidence gains on the prior as the evidence accumulates.
 *
 * It gains further in a redraft league, where the price is the weakest of the
 * two to begin with. A dynasty price is about a player's whole career and is
 * worth respecting against four games; a redraft price is a guess at one
 * season, made before it started, and by October the season itself has
 * answered most of what that guess was for. There is no asset underneath him
 * either — you do not keep him — so nothing is being measured except what he
 * scores between now and the end of it.
 */
export const PROD_SHARE_BASE = 0.4;
export const PROD_SHARE_MAX = 0.7;
/** Where it can reach in a league nobody is kept in. */
export const PROD_SHARE_MAX_REDRAFT = 0.85;

export const prodShare = (at: number | null | undefined, redraft = false): number => {
  const w = Number.isFinite(at as number) ? clamp(at as number, 0, 1) : 0;
  const top = redraft ? PROD_SHARE_MAX_REDRAFT : PROD_SHARE_MAX;
  return PROD_SHARE_BASE + (top - PROD_SHARE_BASE) * w;
};
