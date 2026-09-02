import type { Pos } from '../api/types';
import { ALLOWED, ALLOWED_POS, OPPONENTS, PLAYOFF_WEEKS, SEASON_WEEKS } from './schedule';

/**
 * How hard a run of opponents a team has, at one position.
 *
 * A schedule is not one number. The defence that cannot cover a tight end is
 * often the one that stops the run, so a back and a receiver on the same team
 * do not have the same season in front of them — and a table of "points allowed
 * to everybody" says they do. Every figure here is per position.
 */
export interface Sos {
  /** 0..1 across the 32 teams, 1 being the softest run in the league. */
  season: number;
  /** The same over the three weeks most leagues are decided in. A season that
   *  averages out fine can still end against the two best defences left. */
  playoff: number;
  /** Points per game his opponents gave up at this position last year — the
   *  measurement the two figures above are percentiles of. */
  perGame: number;
  /** 1 = the softest schedule in the league at this position. */
  rank: number;
}

export type SosTable = Record<string, Partial<Record<Pos, Sos>>>;

const TEAMS = Object.keys(OPPONENTS);

/** Their week off, 1-based, or 0 where the team is not one of the 32. */
export function byeOf(team: string | null | undefined): number {
  const s = team ? OPPONENTS[team] : null;
  if (!s) return 0;
  const i = s.indexOf('');
  return i < 0 ? 0 : i + 1;
}

/** Mean of what this run of opponents gave up at `pos`, skipping the bye. */
function faced(team: string, pos: Pos, weeks: number[]): number {
  const col = ALLOWED_POS.indexOf(pos);
  const sched = OPPONENTS[team];
  if (col < 0 || !sched) return 0;
  let sum = 0, n = 0;
  weeks.forEach(w => {
    const other = sched[w - 1];
    const row = other ? ALLOWED[other] : null;
    if (!row) return;               // the bye, or a team we have no record for
    sum += row[col];
    n += 1;
  });
  return n ? sum / n : 0;
}

const ALL_WEEKS: number[] = [];
for (let w = 1; w <= SEASON_WEEKS; w++) ALL_WEEKS.push(w);

/**
 * The whole table, built once.
 *
 * It is a pure function of two constants that are fixed for the season, so it
 * is computed at module load rather than per league: nothing about your roster,
 * your scoring or your format changes who Dallas plays in week 12.
 *
 * The percentiles are over PPR points allowed, and a league that pays half a
 * point a catch orders defences very slightly differently. Slightly: the gap
 * between the toughest and softest schedule is worth a few points of Fit, and
 * re-deriving 32 defensive seasons under each league's own scoring to move a
 * couple of teams one place is not worth what it costs to be that precise.
 */
function build(): SosTable {
  const out: SosTable = {};
  TEAMS.forEach(t => { out[t] = {}; });
  ALLOWED_POS.forEach(pos => {
    const season = TEAMS.map(t => ({ t, v: faced(t, pos, ALL_WEEKS) }));
    const playoff = TEAMS.map(t => ({ t, v: faced(t, pos, PLAYOFF_WEEKS) }));
    const pct = (rows: { t: string; v: number }[]) => {
      const sorted = rows.slice().sort((a, b) => a.v - b.v);
      const at: Record<string, number> = {};
      sorted.forEach((r, i) => { at[r.t] = sorted.length > 1 ? i / (sorted.length - 1) : 0.5; });
      return at;
    };
    const sPct = pct(season);
    const pPct = pct(playoff);
    // Rank 1 is the softest, so the hardest schedule is 32nd — the direction
    // everyone already reads a strength-of-schedule table in.
    const order = season.slice().sort((a, b) => b.v - a.v);
    const rank: Record<string, number> = {};
    order.forEach((r, i) => { rank[r.t] = i + 1; });
    season.forEach(r => {
      out[r.t][pos] = {
        season: sPct[r.t], playoff: pPct[r.t], perGame: Math.round(r.v * 10) / 10, rank: rank[r.t],
      };
    });
  });
  return out;
}

export const SOS: SosTable = build();

export const sosFor = (team: string | null | undefined, pos: string | null | undefined): Sos | null =>
  (team && pos && SOS[team] ? SOS[team][pos as Pos] || null : null);

/**
 * The one number the Fit takes, 0..1.
 *
 * Weighted toward the whole season, because that is where most of your points
 * come from, but not entirely: the three weeks that decide the league are worth
 * a large share of a season that is only seventeen games long.
 */
export const sosScore = (s: Sos | null): number | undefined =>
  s ? s.season * 0.6 + s.playoff * 0.4 : undefined;
