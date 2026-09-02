import type { Pos, SleeperLeague } from '../api/types';
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
  /** The same over THIS league's own playoff weeks. A season that averages out
   *  fine can still end against the two best defences left. */
  playoff: number;
  /** 1 = the softest run of playoff weeks in the league at this position. */
  playoffRank: number;
  /** Points per game his opponents gave up over those weeks. */
  playoffPerGame: number;
  /** The weeks that were measured, so the screen can name them. */
  weeks: number[];
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
 * Which weeks THIS league is decided in.
 *
 * Everybody says "weeks 15 to 17" and Sleeper knows better: a league carries
 * its own `playoff_week_start`, and leagues that finish in week 16 or run a
 * fourth round are common enough that guessing gets a lot of people the wrong
 * three weeks. How many weeks it runs comes from how many teams make it — four
 * teams is two rounds, six is three because of the byes, twelve is four.
 *
 * The old default stays for a league that has not said, or has said something
 * the calendar cannot hold.
 */
export function playoffWeeks(league?: SleeperLeague | null): number[] {
  const st = league?.settings || {};
  const start = Number(st.playoff_week_start);
  if (!Number.isFinite(start) || start < 2 || start > SEASON_WEEKS) return PLAYOFF_WEEKS;
  const teams = Number(st.playoff_teams);
  const rounds = Number.isFinite(teams) && teams >= 2
    ? Math.max(1, Math.ceil(Math.log2(teams)))
    : PLAYOFF_WEEKS.length;
  const out: number[] = [];
  for (let w = start; w < start + rounds && w <= SEASON_WEEKS; w++) out.push(w);
  return out.length ? out : PLAYOFF_WEEKS;
}

/**
 * The whole table, for one set of playoff weeks.
 *
 * The season half is a pure function of two constants fixed for the year —
 * nothing about your roster, your scoring or your format changes who Dallas
 * plays in week 12 — but the playoff half is not: it depends on which weeks
 * your league calls the playoffs. So the table is built per set of weeks and
 * kept, which in practice means once or twice a session.
 *
 * The percentiles are over PPR points allowed, and a league that pays half a
 * point a catch orders defences very slightly differently. Slightly: the gap
 * between the toughest and softest schedule is worth a few points of Fit, and
 * re-deriving 32 defensive seasons under each league's own scoring to move a
 * couple of teams one place is not worth what it costs to be that precise.
 */
function build(weeks: number[]): SosTable {
  const out: SosTable = {};
  TEAMS.forEach(t => { out[t] = {}; });
  ALLOWED_POS.forEach(pos => {
    const season = TEAMS.map(t => ({ t, v: faced(t, pos, ALL_WEEKS) }));
    const playoff = TEAMS.map(t => ({ t, v: faced(t, pos, weeks) }));
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
    const ranked = (rows: { t: string; v: number }[]) => {
      const at: Record<string, number> = {};
      rows.slice().sort((a, b) => b.v - a.v).forEach((r, i) => { at[r.t] = i + 1; });
      return at;
    };
    const sRank = ranked(season);
    const pRank = ranked(playoff);
    const pVal: Record<string, number> = {};
    playoff.forEach(r => { pVal[r.t] = r.v; });
    season.forEach(r => {
      out[r.t][pos] = {
        season: sPct[r.t], playoff: pPct[r.t],
        perGame: Math.round(r.v * 10) / 10, rank: sRank[r.t],
        playoffRank: pRank[r.t], playoffPerGame: Math.round(pVal[r.t] * 10) / 10,
        weeks,
      };
    });
  });
  return out;
}

const cache: Record<string, SosTable> = {};

/** The table for a league — its own playoff weeks, built once and kept. */
export function sosTable(league?: SleeperLeague | null): SosTable {
  const weeks = playoffWeeks(league);
  const key = weeks.join(',');
  if (!cache[key]) cache[key] = build(weeks);
  return cache[key];
}

/** The table under the season's default weeks, for anything with no league. */
export const SOS: SosTable = sosTable(null);

export const sosFor = (
  team: string | null | undefined,
  pos: string | null | undefined,
  league?: SleeperLeague | null,
): Sos | null => {
  const t = league === undefined ? SOS : sosTable(league);
  return team && pos && t[team] ? t[team][pos as Pos] || null : null;
};

/**
 * The one number the Fit takes, 0..1.
 *
 * Weighted toward the whole season, because that is where most of your points
 * come from, but not entirely: the weeks that decide the league are worth a
 * large share of a season that is only seventeen games long.
 */
export const sosScore = (s: Sos | null): number | undefined =>
  s ? s.season * 0.6 + s.playoff * 0.4 : undefined;
