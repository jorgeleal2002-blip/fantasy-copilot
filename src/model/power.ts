import type { LeagueRow, TeamRecord } from './types';

/**
 * How good each team actually is, out of the three things that say so.
 *
 * POINTS, as the all-play record. Every week, every team is scored against
 * every other team that played, not only against the one the schedule gave it.
 * Over ten weeks in a twelve-team league that is a hundred and ten results per
 * team rather than ten, and the schedule has nothing left to say. It carries
 * the most weight because it is the best thing anyone has for what a team will
 * do next — and because it is a fact rather than a model: no market, nothing
 * this app believes, just who outscored whom.
 *
 * THE ROSTER, as the model's own strength. It is the only one of the three
 * that looks forward: a trade, a waiver claim or a starter coming back off
 * injury is in it the day it happens and in the other two weeks later.
 *
 * THE RECORD. Weakest of the three at saying how good a team is — over a
 * fourteen-game season roughly half of it is who you were scheduled against —
 * but it is not nothing, and it is the thing that actually banks a playoff
 * place. It gets the smallest share rather than none.
 *
 * The score is spelled out on the row beside it, all three parts of it, so it
 * can be recomputed by eye. A power ranking is for arguing with, and a number
 * nobody can take apart is a number nobody can argue with.
 *
 * Weights are renormalised over whatever is actually there, the same rule the
 * usage blend uses: before a week has finished the points and the record have
 * nothing to say and the roster is the whole of the answer.
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
  /** 0..100, the three parts weighted — see `WEIGHTS` */
  score: number;
  /** each part as it went in, 0..1, or null where there is nothing to say yet */
  parts: { points: number | null; roster: number | null; record: number | null };
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

/**
 * What each part of the score is worth.
 *
 * Measured out is too strong a word for these — a league season is not a
 * sample you can fit against — but the ordering is not arbitrary: points beat
 * the roster beat the record at saying what a team does next, and these follow
 * that order rather than flattening it.
 */
export const WEIGHTS = { points: 0.45, roster: 0.35, record: 0.2 };

export function powerRankings(rows: LeagueRow[], scores: WeekScore[]): PowerTeam[] {
  const all = allPlayRecords(scores);
  // Most recent last, so "lately" is the tail.
  const weeksOf = (id: number) => scores
    .filter(s => s.rosterId === id && Number.isFinite(s.points))
    .sort((a, b) => a.week - b.week)
    .map(s => s.points);

  const rosterOrder = rows.slice().sort((a, b) => b.now - a.now).map(r => r.id);
  /* A share of the league's best roster rather than a place in a line. A rank
   * says the twelfth roster is as far behind the eleventh as the second is
   * behind the first, which is exactly what a power ranking should not say. */
  const bestRoster = Math.max(...rows.map(r => r.now), 0);

  const teams: PowerTeam[] = rows.map(row => {
    const mine = weeksOf(row.id);
    const allPlay = all.get(row.id) || { wins: 0, losses: 0, ties: 0, pct: 0 };
    const ppg = mine.length ? round1(mean(mine) as number) : null;
    const recent = mine.length >= RECENT_WEEKS
      ? round1(mean(mine.slice(-RECENT_WEEKS)) as number)
      : null;
    const games = row.record.wins + row.record.losses + row.record.ties;

    const parts = {
      points: mine.length ? allPlay.pct : null,
      roster: bestRoster > 0 ? Math.max(0, row.now) / bestRoster : null,
      record: games ? (row.record.wins + row.record.ties / 2) / games : null,
    };

    return {
      id: row.id,
      name: row.name,
      isMe: row.isMe,
      avatar: row.avatar,
      rank: 0,
      score: blend(parts),
      parts,
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

  /* The score, then the all-play record to break it: two teams a point apart
   * on a composite are separated by the part of it that is a fact. */
  teams.sort((a, b) => b.score - a.score || b.allPlay.pct - a.allPlay.pct || (b.ppg ?? 0) - (a.ppg ?? 0));
  teams.forEach((t, i) => { t.rank = i + 1; });
  for (const t of teams) t.read = readOf(t, teams.length);
  return teams;
}

/**
 * The three parts, weighted — over whatever is present.
 *
 * A missing part is not a zero. Before a week has finished there is no
 * all-play record and no result, and scoring those as nothing would rank
 * every team in the league at a third of its roster rather than at its roster.
 */
function blend(parts: PowerTeam['parts']): number {
  let total = 0;
  let used = 0;
  for (const key of ['points', 'roster', 'record'] as const) {
    const v = parts[key];
    if (v == null || !Number.isFinite(v)) continue;
    total += v * WEIGHTS[key];
    used += WEIGHTS[key];
  }
  if (!used) return 0;
  return Math.round((total / used) * 1000) / 10;
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
