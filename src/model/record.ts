import type { SleeperRoster } from '../api/types';
import type { TeamRecord } from './types';

/**
 * A team's standing, read off the roster Sleeper already sends.
 *
 * Two details it gets wrong if taken at face value. Points are stored in two
 * halves — whole and hundredths — so a team on 1,284.56 arrives as 1284 and 56
 * and reads as either 1284 or, worse, 128456. And a league with no ties should
 * not be made to say "7-3-0" on every card for the sake of a column that is
 * always zero.
 */
export function readRecord(r: SleeperRoster | null | undefined): TeamRecord {
  const s = r?.settings || {};
  const wins = Math.max(0, Number(s.wins) || 0);
  const losses = Math.max(0, Number(s.losses) || 0);
  const ties = Math.max(0, Number(s.ties) || 0);
  return {
    wins,
    losses,
    ties,
    label: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
    pointsFor: rejoin(s.fpts, s.fpts_decimal),
    pointsAgainst: rejoin(s.fpts_against, s.fpts_against_decimal),
  };
}

/** Sleeper splits a score into whole points and hundredths. */
function rejoin(whole?: number, decimal?: number): number {
  const w = Number(whole) || 0;
  const d = Number(decimal) || 0;
  return Math.round((w + d / 100) * 100) / 100;
}

/** True once a season has actually started — before that a record is noise. */
export function hasPlayed(rec: TeamRecord): boolean {
  return rec.wins + rec.losses + rec.ties > 0;
}
