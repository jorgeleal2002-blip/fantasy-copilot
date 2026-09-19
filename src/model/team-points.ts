import type { LeagueRow, PricedSlot, Projection, TeamRecord } from './types';

export type { Projection };

/**
 * The two numbers a team wants once the draft is over: what it has actually
 * averaged, and what its lineup is worth on Sunday.
 *
 * They answer different questions. The average is the season that happened,
 * luck and injuries included; the projection is the roster as it stands now,
 * which is the one a trade or a waiver claim moves.
 *
 * They are also, straight out of the model, in two different currencies, and
 * printing them side by side without fixing that is what made the projection
 * read as nonsense: a hundred and twenty-eight point average against an
 * eighty-three point "projection" for the same roster. See
 * `leagueProjectionScale`.
 */

/**
 * Projected points for a lineup, in half-PPR.
 *
 * Reports how much of the lineup it could price as well as the total, because
 * a projection summed over six of nine starters is not a smaller projection —
 * it is a wrong one, and a screen showing it without saying so is worse than a
 * screen showing nothing.
 */
export function projectLineup(optimal: PricedSlot[]): Projection {
  let total = 0;
  let counted = 0;
  for (const s of optimal) {
    const ppg = s.player?.use?.ppgAdj;
    if (ppg == null || !Number.isFinite(ppg)) continue;
    total += ppg;
    counted++;
  }
  return { total: Math.round(total * 10) / 10, counted, slots: optimal.length };
}

/** Whether enough of the lineup is priced for the total to mean anything. */
export function projectionIsSound(p: Projection): boolean {
  return p.slots > 0 && p.counted >= Math.ceil(p.slots * 0.7);
}

/** Points per game so far, or null before a game has been played. */
export function scoringAverage(rec: TeamRecord): number | null {
  const games = rec.wins + rec.losses + rec.ties;
  if (!games) return null;
  return Math.round((rec.pointsFor / games) * 10) / 10;
}

/** The league's own average, for the only comparison that matters here. */
export function leagueScoringAverage(rows: LeagueRow[]): number | null {
  const each = rows.map(r => scoringAverage(r.record)).filter((n): n is number => n != null);
  if (!each.length) return null;
  return Math.round((each.reduce((a, b) => a + b, 0) / each.length) * 10) / 10;
}

/** Below this the scale is a guess off two or three rosters, not a measurement. */
const SCALE_MIN_TEAMS = 4;
/** A factor outside this says the two sides are not measuring the same thing,
 *  and a confidently wrong number costs more than a dash. */
const SCALE_RANGE: [number, number] = [0.5, 3];

/**
 * What one half-PPR point of lineup is worth in THIS league's points.
 *
 * `projectLineup` sums `Usage.ppgAdj`, which is half a point a catch, six a
 * touchdown and nothing at all for the kicker and the defence, because those
 * two never reach the optimal lineup — `ELIG` has no slot for them. A league
 * that pays a full point a reception, six for a passing touchdown and starts a
 * K and a DEF scores half again as much per team per week, so the projection
 * came out a third light against the very average printed next to it.
 *
 * Nothing in the feed says what the league pays for a catch in a form this
 * model could re-score from, so the league is asked instead: the average team
 * here projects at the average team here's actual points. The factor is a
 * ratio of two means over the same twelve rosters, which leaves the only thing
 * the projection is for — how one lineup stands against another — untouched,
 * and puts it in units the rest of the screen already uses.
 *
 * Null rather than 1 when it cannot be measured. An uncalibrated total is not
 * a rougher projection, it is a number in the wrong currency.
 */
export function leagueProjectionScale(rows: LeagueRow[]): number | null {
  const avg = leagueScoringAverage(rows);
  if (avg == null || avg <= 0) return null;
  const priced = rows
    .filter(r => projectionIsSound(r.proj) && r.proj.total > 0)
    .map(r => r.proj.total);
  if (priced.length < SCALE_MIN_TEAMS) return null;
  const mean = priced.reduce((a, b) => a + b, 0) / priced.length;
  if (!(mean > 0)) return null;
  const f = avg / mean;
  if (f < SCALE_RANGE[0] || f > SCALE_RANGE[1]) return null;
  return Math.round(f * 1000) / 1000;
}

/**
 * A lineup's projection in the league's points, or null when it cannot be
 * stated in them — too little of the lineup priced, or no scale to state it in.
 */
export function projectedPoints(p: Projection, scale: number | null): number | null {
  if (!projectionIsSound(p) || scale == null) return null;
  return Math.round(p.total * scale * 10) / 10;
}
