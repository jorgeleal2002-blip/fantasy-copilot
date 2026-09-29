import type { LeagueRow, TeamRecord } from './types';

/**
 * Who has actually been the best, with the schedule taken out.
 *
 * A record is two numbers about a team and one about its luck. Losing 130–134
 * to the league's best week and beating 78 with 81 count the same in the
 * standings, so a 6-1 built on soft weeks and a 2-5 built on hard ones read as
 * opposites when they may be the same team. Everybody knows this and nobody
 * can see it, because the number that would show it is not on the page.
 *
 * So the ranking is the ALL-PLAY record: every week, every team is scored
 * against every other team that played, not only against the one the schedule
 * gave it. Over ten weeks in a twelve-team league that is a hundred and ten
 * results per team rather than ten, and the schedule has nothing left to say.
 * It is the one measure here that is a fact rather than a model: no weights,
 * no market, nothing this app believes — just who outscored whom.
 *
 * WHAT DELIBERATELY DOES NOT MOVE A ROW: the roster's market value, the
 * lineup Rating, and how the team has scored lately. All three are here, in
 * the sentence under the row, because they are what says whether the record is
 * about to change. None of them sorts the list. A ranking ordered by a blend
 * nobody can recompute is a ranking nobody can argue with, and arguing with it
 * is the entire point of a power ranking.
 */

export interface WeekScore {
  rosterId: number;
  week: number;
  points: number;
}

export interface AllPlay {
  wins: number;
  losses: number;
  /** ties count half, the way a record does */
  ties: number;
  /** 0..1 — the share of the league this team has outscored */
  pct: number;
}

export interface PowerTeam {
  id: number;
  name: string;
  isMe: boolean;
  avatar: string | null;
  rank: number;
  allPlay: AllPlay;
  record: TeamRecord;
  /** points per game over the weeks that have finished */
  ppg: number | null;
  /** the same over the most recent few, null until there are enough */
  recent: number | null;
  /** where the roster ranks, 1 = best. The model's own opinion, not a result. */
  rosterRank: number;
  /** real wins minus the wins the all-play record implies */
  luck: number;
  /** weeks that have finished for this team */
  weeks: number;
  read: string;
}

/** Fewer than this and "lately" is one game, which is not a trend. */
export const RECENT_WEEKS = 3;
/** A win either way is the rounding of a season; two is a story. */
const LUCKY = 1.2;
/** A tenth over a team's own average is inside the noise of one big game. */
const HOT = 0.1;

/**
 * Every team's score, week by week, turned into the all-play record.
 *
 * Only weeks that have FINISHED belong here — a week in progress would rank
 * the league on whoever has played so far on Sunday afternoon. The caller
 * decides which weeks those are; this counts what it is given.
 */
export function allPlayRecords(scores: WeekScore[]): Map<number, AllPlay> {
  const byWeek = new Map<number, WeekScore[]>();
  for (const s of scores) {
    if (!Number.isFinite(s.points)) continue;
    const list = byWeek.get(s.week);
    if (list) list.push(s);
    else byWeek.set(s.week, [s]);
  }

  const out = new Map<number, AllPlay>();
  const bump = (id: number, key: 'wins' | 'losses' | 'ties') => {
    const cur = out.get(id) || { wins: 0, losses: 0, ties: 0, pct: 0 };
    cur[key]++;
    out.set(id, cur);
  };

  for (const week of byWeek.values()) {
    // A week with one team in it is a week nobody can be measured against.
    if (week.length < 2) continue;
    for (const a of week) {
      for (const b of week) {
        if (a.rosterId === b.rosterId) continue;
        bump(a.rosterId, a.points > b.points ? 'wins' : a.points < b.points ? 'losses' : 'ties');
      }
    }
  }

  for (const [id, r] of out) {
    const played = r.wins + r.losses + r.ties;
    out.set(id, { ...r, pct: played ? (r.wins + r.ties / 2) / played : 0 });
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function powerRankings(rows: LeagueRow[], scores: WeekScore[]): PowerTeam[] {
  const all = allPlayRecords(scores);
  const byTeam = new Map<number, number[]>();
  for (const s of scores) {
    if (!Number.isFinite(s.points)) continue;
    const list = byTeam.get(s.rosterId);
    if (list) list.push(s.points);
    else byTeam.set(s.rosterId, [s.points]);
  }
  // Most recent last, so "lately" is the tail.
  const weeksOf = (id: number) => scores
    .filter(s => s.rosterId === id && Number.isFinite(s.points))
    .sort((a, b) => a.week - b.week)
    .map(s => s.points);

  const rosterOrder = rows.slice().sort((a, b) => b.now - a.now).map(r => r.id);

  const teams: PowerTeam[] = rows.map(row => {
    const mine = weeksOf(row.id);
    const allPlay = all.get(row.id) || { wins: 0, losses: 0, ties: 0, pct: 0 };
    const ppg = mine.length ? round1(mean(mine) as number) : null;
    const recent = mine.length >= RECENT_WEEKS
      ? round1(mean(mine.slice(-RECENT_WEEKS)) as number)
      : null;
    const games = row.record.wins + row.record.losses + row.record.ties;
    return {
      id: row.id,
      name: row.name,
      isMe: row.isMe,
      avatar: row.avatar,
      rank: 0,
      allPlay,
      record: row.record,
      ppg,
      recent,
      rosterRank: rosterOrder.indexOf(row.id) + 1,
      luck: mine.length ? round1(row.record.wins - allPlay.pct * games) : 0,
      weeks: mine.length,
      read: '',
    };
  });

  /* All-play first, and points per game to break it — two teams that have
   * beaten the same share of the league are separated by how they did it. */
  teams.sort((a, b) => b.allPlay.pct - a.allPlay.pct || (b.ppg ?? 0) - (a.ppg ?? 0));
  teams.forEach((t, i) => { t.rank = i + 1; });
  for (const t of teams) t.read = readOf(t, teams.length);
  return teams;
}

/**
 * The sentence under a row: what the all-play record does not already say.
 *
 * In order, because only one of them fits: the gap between the record and the
 * results, then where the team is heading, then what the roster thinks. A row
 * that has nothing surprising about it says the plain thing rather than
 * reaching for a story.
 */
function readOf(t: PowerTeam, teamCount: number): string {
  if (!t.weeks) return 'Nothing played yet — this is the roster.';

  const share = Math.round(t.allPlay.pct * 100);
  if (t.luck >= LUCKY) {
    return `${t.record.label} flatters them: they have outscored ${share}% of the league.`;
  }
  if (t.luck <= -LUCKY) {
    return `${t.record.label} undersells them: they have outscored ${share}% of the league.`;
  }

  if (t.recent != null && t.ppg) {
    const swing = (t.recent - t.ppg) / t.ppg;
    if (swing >= HOT) {
      return `Heating up — ${t.recent.toFixed(1)} a week lately against ${t.ppg.toFixed(1)} on the season.`;
    }
    if (swing <= -HOT) {
      return `Cooling off — ${t.recent.toFixed(1)} a week lately against ${t.ppg.toFixed(1)} on the season.`;
    }
  }

  // The roster only speaks when it disagrees with the results by enough to be
  // about something other than where the line was drawn.
  const gap = t.rank - t.rosterRank;
  const wide = Math.max(3, Math.round(teamCount / 4));
  if (gap >= wide) return `The roster is better than the results — ${ordinal(t.rosterRank)} in the league on paper.`;
  if (gap <= -wide) return `Outplaying the roster, which the model has ${ordinal(t.rosterRank)}.`;

  return `Has outscored ${share}% of the league${t.ppg ? `, ${t.ppg.toFixed(1)} a week` : ''}.`;
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}
