/**
 * The NFL season, as two small tables.
 *
 * GENERATED — do not edit by hand. `node scripts/build-schedule.mjs 2026`
 * rebuilds it from nflverse; the header of that script says what from and why
 * it ships in the bundle instead of being fetched.
 */
import type { Pos } from '../api/types';

/** The season the fixtures below belong to. */
export const SCHEDULE_SEASON = 2026;
/** The season the defensive record below was measured in — last year's, which
 *  is the only completed one when a draft happens. */
export const ALLOWED_SEASON = 2025;
/** Regular-season weeks in 2026. */
export const SEASON_WEEKS = 18;
/** When most leagues decide it: the last three weeks before week 18. */
export const PLAYOFF_WEEKS: number[] = [15, 16, 17];

/** Who each team plays, week 1 first. An empty string is their bye. */
export const OPPONENTS: Record<string, string[]> = {
  ARI: ['LAC', 'SEA', 'SF', 'NYG', 'DET', 'LAR', 'DEN', 'DAL', 'SEA', 'LAR', 'KC', 'WAS', 'PHI', '', 'NYJ', 'NO', 'LV', 'SF'],
  ATL: ['PIT', 'CAR', 'GB', 'NO', 'BAL', 'CHI', 'SF', 'TB', 'CIN', 'KC', '', 'MIN', 'DET', 'CLE', 'WAS', 'TB', 'NO', 'CAR'],
  BAL: ['IND', 'NO', 'DAL', 'TEN', 'ATL', 'CLE', 'CIN', 'BUF', 'JAX', 'LAC', 'CAR', 'HOU', '', 'TB', 'PIT', 'CLE', 'CIN', 'PIT'],
  BUF: ['HOU', 'DET', 'LAC', 'NE', 'LAR', 'LV', '', 'BAL', 'MIN', 'NYJ', 'MIA', 'KC', 'NE', 'GB', 'CHI', 'DEN', 'MIA', 'NYJ'],
  CAR: ['CHI', 'ATL', 'CLE', 'DET', '', 'PHI', 'TB', 'GB', 'DEN', 'NO', 'BAL', 'TB', 'MIN', 'NO', 'CIN', 'PIT', 'SEA', 'ATL'],
  CHI: ['CAR', 'MIN', 'PHI', 'NYJ', 'GB', 'ATL', 'NE', 'SEA', 'TB', '', 'NO', 'DET', 'JAX', 'MIA', 'BUF', 'GB', 'DET', 'MIN'],
  CIN: ['TB', 'HOU', 'PIT', 'JAX', 'MIA', '', 'BAL', 'TEN', 'ATL', 'PIT', 'WAS', 'NO', 'CLE', 'KC', 'CAR', 'IND', 'BAL', 'CLE'],
  CLE: ['JAX', 'TB', 'CAR', 'PIT', 'NYJ', 'BAL', 'TEN', 'PIT', 'NO', 'HOU', '', 'LV', 'CIN', 'ATL', 'NYG', 'BAL', 'IND', 'CIN'],
  DAL: ['NYG', 'WAS', 'BAL', 'HOU', 'TB', 'GB', 'PHI', 'ARI', 'IND', 'SF', 'TEN', 'PHI', 'SEA', '', 'LAR', 'JAX', 'NYG', 'WAS'],
  DEN: ['KC', 'JAX', 'LAR', 'SF', 'LAC', 'SEA', 'ARI', 'KC', 'CAR', '', 'LV', 'PIT', 'MIA', 'NYJ', 'LV', 'BUF', 'NE', 'LAC'],
  DET: ['NO', 'BUF', 'NYJ', 'CAR', 'ARI', '', 'GB', 'MIN', 'MIA', 'NE', 'TB', 'CHI', 'ATL', 'TEN', 'MIN', 'NYG', 'CHI', 'GB'],
  GB: ['MIN', 'NYJ', 'ATL', 'TB', 'CHI', 'DAL', 'DET', 'CAR', 'NE', 'MIN', '', 'LAR', 'NO', 'BUF', 'MIA', 'CHI', 'HOU', 'DET'],
  HOU: ['BUF', 'CIN', 'IND', 'DAL', 'TEN', 'JAX', 'NYG', '', 'LAC', 'CLE', 'IND', 'BAL', 'PIT', 'WAS', 'JAX', 'PHI', 'GB', 'TEN'],
  IND: ['BAL', 'KC', 'HOU', 'WAS', 'PIT', 'TEN', 'MIN', 'JAX', 'DAL', 'MIA', 'HOU', 'NYG', '', 'PHI', 'TEN', 'CIN', 'CLE', 'JAX'],
  JAX: ['CLE', 'DEN', 'NE', 'CIN', 'PHI', 'HOU', '', 'IND', 'BAL', 'TEN', 'NYG', 'TEN', 'CHI', 'PIT', 'HOU', 'DAL', 'WAS', 'IND'],
  KC: ['DEN', 'IND', 'MIA', 'LV', '', 'LAC', 'SEA', 'DEN', 'NYJ', 'ATL', 'ARI', 'BUF', 'LAR', 'CIN', 'NE', 'SF', 'LAC', 'LV'],
  LAC: ['ARI', 'LV', 'BUF', 'SEA', 'DEN', 'KC', '', 'LAR', 'HOU', 'BAL', 'NYJ', 'NE', 'TB', 'LV', 'SF', 'MIA', 'KC', 'DEN'],
  LAR: ['SF', 'NYG', 'DEN', 'PHI', 'BUF', 'ARI', 'LV', 'LAC', 'WAS', 'ARI', '', 'GB', 'KC', 'SF', 'DAL', 'SEA', 'TB', 'SEA'],
  LV: ['MIA', 'LAC', 'NO', 'KC', 'NE', 'BUF', 'LAR', 'NYJ', 'SF', 'SEA', 'DEN', 'CLE', '', 'LAC', 'DEN', 'TEN', 'ARI', 'KC'],
  MIA: ['LV', 'SF', 'KC', 'MIN', 'CIN', '', 'NYJ', 'NE', 'DET', 'IND', 'BUF', 'NYJ', 'DEN', 'CHI', 'GB', 'LAC', 'BUF', 'NE'],
  MIN: ['GB', 'CHI', 'TB', 'MIA', 'NO', '', 'IND', 'DET', 'BUF', 'GB', 'SF', 'ATL', 'CAR', 'NE', 'DET', 'WAS', 'NYJ', 'CHI'],
  NE: ['SEA', 'PIT', 'JAX', 'BUF', 'LV', 'NYJ', 'CHI', 'MIA', 'GB', 'DET', '', 'LAC', 'BUF', 'MIN', 'KC', 'NYJ', 'DEN', 'MIA'],
  NO: ['DET', 'BAL', 'LV', 'ATL', 'MIN', 'NYG', 'PIT', '', 'CLE', 'CAR', 'CHI', 'CIN', 'GB', 'CAR', 'TB', 'ARI', 'ATL', 'TB'],
  NYG: ['DAL', 'LAR', 'TEN', 'ARI', 'WAS', 'NO', 'HOU', '', 'PHI', 'WAS', 'JAX', 'IND', 'SF', 'SEA', 'CLE', 'DET', 'DAL', 'PHI'],
  NYJ: ['TEN', 'GB', 'DET', 'CHI', 'CLE', 'NE', 'MIA', 'LV', 'KC', 'BUF', 'LAC', 'MIA', '', 'DEN', 'ARI', 'NE', 'MIN', 'BUF'],
  PHI: ['WAS', 'TEN', 'CHI', 'LAR', 'JAX', 'CAR', 'DAL', 'WAS', 'NYG', '', 'PIT', 'DAL', 'ARI', 'IND', 'SEA', 'HOU', 'SF', 'NYG'],
  PIT: ['ATL', 'NE', 'CIN', 'CLE', 'IND', 'TB', 'NO', 'CLE', '', 'CIN', 'PHI', 'DEN', 'HOU', 'JAX', 'BAL', 'CAR', 'TEN', 'BAL'],
  SEA: ['NE', 'ARI', 'WAS', 'LAC', 'SF', 'DEN', 'KC', 'CHI', 'ARI', 'LV', '', 'SF', 'DAL', 'NYG', 'PHI', 'LAR', 'CAR', 'LAR'],
  SF: ['LAR', 'MIA', 'ARI', 'DEN', 'SEA', 'WAS', 'ATL', '', 'LV', 'DAL', 'MIN', 'SEA', 'NYG', 'LAR', 'LAC', 'KC', 'PHI', 'ARI'],
  TB: ['CIN', 'CLE', 'MIN', 'GB', 'DAL', 'PIT', 'CAR', 'ATL', 'CHI', '', 'DET', 'CAR', 'LAC', 'BAL', 'NO', 'ATL', 'LAR', 'NO'],
  TEN: ['NYJ', 'PHI', 'NYG', 'BAL', 'HOU', 'IND', 'CLE', 'CIN', '', 'JAX', 'DAL', 'JAX', 'WAS', 'DET', 'IND', 'LV', 'PIT', 'HOU'],
  WAS: ['PHI', 'DAL', 'SEA', 'IND', 'NYG', 'SF', '', 'PHI', 'LAR', 'NYG', 'CIN', 'ARI', 'TEN', 'HOU', 'ATL', 'MIN', 'JAX', 'DAL'],
};

/** PPR fantasy points per game each defence gave up in 2025, by the
 *  position that scored them: [QB, RB, WR, TE]. Last season's record is a
 *  lagged proxy for this one's — the honest one available in August. */
export const ALLOWED: Record<string, [number, number, number, number]> = {
  ARI: [17, 26.2, 30.2, 16.9],
  ATL: [16.3, 21.5, 33.6, 10.2],
  BAL: [17.7, 23.1, 36, 10.9],
  BUF: [13.1, 23.9, 26.5, 7.6],
  CAR: [13.8, 24.1, 26.6, 13.7],
  CHI: [18.1, 21.2, 36.2, 13.1],
  CIN: [18.4, 28.3, 25.3, 20.9],
  CLE: [13.3, 21.9, 26.9, 12.1],
  DAL: [23.3, 24.9, 39.3, 12.3],
  DEN: [14.2, 16.9, 27, 13.7],
  DET: [18.2, 19.4, 35.7, 13.7],
  GB: [15, 21.5, 31.3, 12.1],
  HOU: [12.8, 20, 25.9, 12.3],
  IND: [16.9, 19.9, 36.1, 15.2],
  JAX: [15.9, 18.3, 31.2, 14.8],
  KC: [15.1, 19.2, 27.3, 11],
  LAC: [12.6, 18.5, 27.4, 10.5],
  LAR: [15.2, 20.2, 31.7, 13.1],
  LV: [16.1, 22.9, 33.5, 10.1],
  MIA: [18.2, 24.9, 29.9, 16.3],
  MIN: [11.1, 19.6, 23.7, 10.7],
  NE: [14.7, 18.8, 29.2, 13.8],
  NO: [14, 20.7, 27.8, 12.5],
  NYG: [18.3, 25.7, 33.8, 11.4],
  NYJ: [19.9, 28, 30.3, 15.2],
  PHI: [14.5, 22.8, 26.8, 8.3],
  PIT: [18.8, 19.5, 35.2, 16.6],
  SEA: [14, 18.5, 26.3, 14.7],
  SF: [17.1, 23.6, 32.2, 14.8],
  TB: [19.5, 22.1, 31.5, 15.8],
  TEN: [19, 21.4, 35.6, 14.2],
  WAS: [19.6, 25.5, 34.9, 15.9],
};

/** The order the tuples above are written in. */
export const ALLOWED_POS: Pos[] = ['QB', 'RB', 'WR', 'TE'];
