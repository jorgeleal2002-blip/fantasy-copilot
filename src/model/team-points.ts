import type { LineupSlot, LeagueRow, TeamRecord } from './types';

/**
 * The two numbers a team wants once the draft is over: what it has actually
 * averaged, and what its lineup is worth on Sunday.
 *
 * They answer different questions. The average is the season that happened,
 * luck and injuries included; the projection is the roster as it stands now,
 * which is the one a trade or a waiver claim moves.
 */

export interface Projection {
  /** Points the optimal lineup is expected to score. */
  total: number;
  /** Starters the projection could actually be built from. */
  counted: number;
  /** Slots in the lineup, filled or not. */
  slots: number;
}

/**
 * Projected points for a lineup.
 *
 * Reports how much of the lineup it could price as well as the total, because
 * a projection summed over six of nine starters is not a smaller projection —
 * it is a wrong one, and a screen showing it without saying so is worse than a
 * screen showing nothing.
 */
export function projectLineup(optimal: LineupSlot[]): Projection {
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
