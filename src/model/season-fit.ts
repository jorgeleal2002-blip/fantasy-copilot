import { ELIG } from './constants';

/**
 * What a roster scores over the rest of the season, week by week — the way a
 * trade actually lands on a team.
 *
 * A trade's value on the market is one number; what it does for a team is a
 * string of Sundays. A receiver whose bye is the same week as your other two
 * starters costs you that week. A back who is out for a month is worth none of
 * it. A schedule full of defences that give up points at his position is worth
 * more than one that does not, and the weeks that decide the league — the
 * playoffs — are worth more than a week in October.
 *
 * So each remaining week the roster's best lineup is re-picked from who is
 * actually available and how good that week's matchup is, and the weeks are
 * added up with the playoff weeks weighed heavier.
 */

export interface FitPlayer {
  id: string;
  name: string;
  pos: string;
  team: string | null;
  /** expected points a game in this league's scoring; null when unknown */
  ppg: number | null;
  /** Sleeper's injury status: '', 'Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus' */
  injury: string;
}

export interface FitCalendar {
  /** the league's starting slots */
  slots: string[];
  /** every week still to play, regular season and playoffs */
  weeks: number[];
  playoffWeeks: number[];
  /** the opponent a team plays in a week, '' on a bye */
  opponent: (team: string, week: number) => string | null;
  /** how a defence treats a position, as a multiplier around 1 */
  matchup: (defence: string, pos: string) => number;
}

/** The weeks that decide the league count this much more than one in October. */
export const PLAYOFF_WEIGHT = 1.5;

/**
 * How much of a game an injured player is expected to give, by how many weeks
 * out it is. Sleeper's status is about the next game; a long-term one (IR,
 * PUP, a suspension) is taken as about four weeks, the usual minimum.
 */
export function availability(injury: string, weeksAhead: number): number {
  const s = injury.toLowerCase();
  if (s === 'ir' || s === 'pup' || s === 'sus' || s === 'nfi') return weeksAhead < 4 ? 0 : 1;
  if (weeksAhead > 0) return 1;
  if (s === 'out') return 0;
  if (s === 'doubtful') return 0.25;
  if (s === 'questionable') return 0.8;
  return 1;
}

/** One player's expected points in one week: zero on a bye or when out. */
export function weekPoints(p: FitPlayer, week: number, first: number, cal: FitCalendar): number {
  if (p.ppg == null || !p.team) return 0;
  const opp = cal.opponent(p.team, week);
  if (opp === '') return 0;
  const m = opp ? cal.matchup(opp, p.pos) : 1;
  return p.ppg * m * availability(p.injury, week - first);
}

/** The best lineup for one week, filled most-restricted slot first. */
export function weekLineup(list: FitPlayer[], week: number, first: number, cal: FitCalendar): number {
  const order = cal.slots.slice().sort((a, b) => (ELIG[a]?.length ?? 9) - (ELIG[b]?.length ?? 9));
  const pts = new Map(list.map(p => [p.id, weekPoints(p, week, first, cal)]));
  const used = new Set<string>();
  let total = 0;
  for (const slot of order) {
    const elig = ELIG[slot];
    if (!elig) continue;
    let best: FitPlayer | null = null;
    for (const p of list) {
      if (used.has(p.id) || elig.indexOf(p.pos as never) < 0) continue;
      if (!best || (pts.get(p.id) as number) > (pts.get(best.id) as number)) best = p;
    }
    if (best) { used.add(best.id); total += pts.get(best.id) as number; }
  }
  return total;
}

export interface SeasonFit {
  /** weighted points a week over every week left */
  perWeek: number;
  /** points a week in the playoff weeks alone; null when they are past */
  playoffs: number | null;
}

export function seasonFit(list: FitPlayer[], cal: FitCalendar): SeasonFit {
  const first = cal.weeks[0] ?? 0;
  let sum = 0, weight = 0, po = 0, poN = 0;
  for (const w of cal.weeks) {
    const pts = weekLineup(list, w, first, cal);
    const isPo = cal.playoffWeeks.includes(w);
    const k = isPo ? PLAYOFF_WEIGHT : 1;
    sum += pts * k; weight += k;
    if (isPo) { po += pts; poN++; }
  }
  return { perWeek: weight ? sum / weight : 0, playoffs: poN ? po / poN : null };
}

/** The bye weeks a set of players brings in, and whose. */
export function byesOf(list: FitPlayer[], cal: FitCalendar): { week: number; names: string[] }[] {
  const by = new Map<number, string[]>();
  for (const p of list) {
    if (!p.team) continue;
    for (const w of cal.weeks) {
      if (cal.opponent(p.team, w) === '') by.set(w, (by.get(w) || []).concat(p.name));
    }
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([week, names]) => ({ week, names }));
}

/**
 * What byes and injuries take off a roster, a week.
 *
 * `seasonFit` already charges them: a man on his bye scores nothing, an
 * injured one scores a fraction, and a slot with nobody left to fill it
 * contributes zero. That is why a thin side's season points are lower than a
 * covered one's. What it does not do is say so — the cost is folded into one
 * figure, and a reader looking at "+0.1 pts a week" cannot tell whether depth
 * was considered.
 *
 * So the same roster is run twice: once as it is, and once in a season where
 * nobody is ever away. The gap between them is what being this thin costs, in
 * the same unit the card already prints.
 */
export function exposure(list: FitPlayer[], cal: FitCalendar): number {
  const healthy = list.map(p => (p.injury ? { ...p, injury: '' } : p));
  const noByes: FitCalendar = {
    ...cal,
    // A bye is '' and an unknown opponent is null; null takes the neutral
    // matchup, which is what a week nobody is away should be worth.
    opponent: (team, week) => {
      const o = cal.opponent(team, week);
      return o === '' ? null : o;
    },
  };
  return seasonFit(healthy, noByes).perWeek - seasonFit(list, cal).perWeek;
}
