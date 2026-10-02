import type { PlayerCatalog } from '../api/types';
import { gameLeftOf, type NflGame } from './nfl-games';
import { KICKOFF_MIN, SCHEDULE_SEASON } from './schedule';

/** Wall-clock length of an NFL game, halftime and stoppages included. */
export const GAME_MIN = 190;
/** How long after kickoff a game may still be going — overtime, reviews. */
export const OVER_MIN = 240;

const kickoff = (team: string | null | undefined, week: number, season: number): number | null => {
  if (!team || season !== SCHEDULE_SEASON) return null;
  const at = KICKOFF_MIN[team]?.[week - 1];
  return at ? at * 60000 : null;
};

/**
 * How much of a team's game is left: 1 before kickoff, 0 once it is over, and
 * the share of the clock not yet run in between.
 *
 * By wall clock, not game clock — Sleeper's feed carries no game clock — so it
 * is an estimate that is right at both ends and close in the middle. Null for a
 * bye, an unknown team or a season the bundled schedule is not for.
 */
export function gameLeft(team: string | null | undefined, week: number, season: number, now: number): number | null {
  const at = kickoff(team, week, season);
  if (at == null) return null;
  const run = (now - at) / 60000;
  if (run <= 0) return 1;
  return Math.max(0, 1 - run / GAME_MIN);
}

export type GamePhase = 'pre' | 'live' | 'final';

/** Where a team's game is: not kicked off, on (overtime included), or over. */
export function gamePhase(team: string | null | undefined, week: number, season: number, now: number): GamePhase | null {
  const at = kickoff(team, week, season);
  if (at == null) return null;
  if (now < at) return 'pre';
  return now < at + OVER_MIN * 60000 ? 'live' : 'final';
}

/** Where a team's game is, off the real game state when there is one and the
 *  bundled kickoff times when there is not — which also covers a game the
 *  league flexed to another slot. */
export function phaseFor(
  team: string | null | undefined, week: number, season: number, now: number,
  games?: Record<string, NflGame> | null,
): GamePhase | null {
  const g = team ? games?.[team] : undefined;
  if (g) return g.state === 'in' ? 'live' : g.state === 'post' ? 'final' : 'pre';
  return gamePhase(team, week, season, now);
}

/** `gameLeft` by player id, for the week on screen — off the real clock when
 *  the scoreboard has his game. */
export function clockFor(
  players: PlayerCatalog,
  week: number | null,
  season: string | number | null | undefined,
  now: number,
  games?: Record<string, NflGame> | null,
): ((id: string) => number | null) | undefined {
  if (!week) return undefined;
  const yr = Number(season);
  return id => {
    const t = players[id]?.team;
    const g = t ? games?.[t] : undefined;
    return g ? gameLeftOf(g) : gameLeft(t, week, yr, now);
  };
}

/** Whether any game of the week is on right now. */
export function weekLive(week: number, season: number, now: number, games?: Record<string, NflGame> | null): boolean {
  if (games && Object.values(games).some(g => g.state === 'in')) return true;
  if (season !== SCHEDULE_SEASON) return false;
  for (const t of Object.keys(KICKOFF_MIN)) {
    const at = kickoff(t, week, season);
    if (at != null && now >= at && now < at + OVER_MIN * 60000) return true;
  }
  return false;
}
