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
  /**
   * The same share with the recent weeks counting for more.
   *
   * A blowout in week one says less about a team in November than last
   * Sunday does: rosters are traded, starters get hurt and come back, and a
   * waiver pickup who is now a WR2 was not on the roster in September. So the
   * score reads this rather than `pct` — but the ROW prints `pct`, because a
   * weighted share is not something anybody can check by hand and an all-play
   * record is.
   */
  form: number;
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
  /** where this team stood before the newest week, and how far it moved */
  was: number | null;
  /** positive is a climb */
  move: number;
  /** how far a normal week is from this team's average, in points */
  swing: number | null;
  /** the record the scoring earned, rounded to whole games */
  expected: { wins: number; losses: number } | null;
  /** the widest and the narrowest swing in the league, for the sentence */
  swingiest: boolean;
  steadiest: boolean;
  /** real wins minus the wins the all-play record implies */
  luck: number;
  /** weeks that have finished for this team */
  weeks: number;
  read: string;
}

/** Fewer than this and "lately" is one game, which is not a trend. */
export const RECENT_WEEKS = 3;
/**
 * How long it takes a week to count half as much as the newest one.
 *
 * Four, which over a fourteen-game season leaves week one worth about a tenth
 * of the last — present, and not deciding anything. Shorter and the ranking
 * chases one Sunday; longer and it is a season average wearing a power
 * ranking's clothes.
 */
export const HALF_LIFE_WEEKS = 4;
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

  const latest = Math.max(...byWeek.keys(), 0);
  /** Halving every `HALF_LIFE_WEEKS` back from the newest week on the board. */
  const weightOf = (week: number) => Math.pow(0.5, Math.max(0, latest - week) / HALF_LIFE_WEEKS);

  const out = new Map<number, AllPlay>();
  const got = new Map<number, { earned: number; total: number }>();
  const bump = (id: number, key: 'wins' | 'losses' | 'ties', w: number) => {
    const cur = out.get(id) || { wins: 0, losses: 0, ties: 0, pct: 0, form: 0 };
    cur[key]++;
    out.set(id, cur);
    const acc = got.get(id) || { earned: 0, total: 0 };
    acc.earned += (key === 'wins' ? 1 : key === 'ties' ? 0.5 : 0) * w;
    acc.total += w;
    got.set(id, acc);
  };

  for (const [week, rows] of byWeek) {
    // A week with one team in it is a week nobody can be measured against.
    if (rows.length < 2) continue;
    const w = weightOf(week);
    for (const a of rows) {
      for (const b of rows) {
        if (a.rosterId === b.rosterId) continue;
        bump(a.rosterId, a.points > b.points ? 'wins' : a.points < b.points ? 'losses' : 'ties', w);
      }
    }
  }

  for (const [id, r] of out) {
    const played = r.wins + r.losses + r.ties;
    const acc = got.get(id) || { earned: 0, total: 0 };
    out.set(id, {
      ...r,
      pct: played ? (r.wins + r.ties / 2) / played : 0,
      form: acc.total ? acc.earned / acc.total : 0,
    });
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

function build(rows: LeagueRow[], scores: WeekScore[]): PowerTeam[] {
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
    const allPlay = all.get(row.id) || { wins: 0, losses: 0, ties: 0, pct: 0, form: 0 };
    const ppg = mine.length ? round1(mean(mine) as number) : null;
    const recent = mine.length >= RECENT_WEEKS
      ? round1(mean(mine.slice(-RECENT_WEEKS)) as number)
      : null;
    const games = row.record.wins + row.record.losses + row.record.ties;

    const parts = {
      // The weighted share, not the raw one: a week-one blowout says less in
      // November than last Sunday does.
      points: mine.length ? allPlay.form : null,
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
      was: null,
      move: 0,
      swing: mine.length >= 2 ? round1(spread(mine)) : null,
      expected: games
        ? { wins: Math.round(allPlay.pct * games), losses: games - Math.round(allPlay.pct * games) }
        : null,
      swingiest: false,
      steadiest: false,
      luck: mine.length ? round1(row.record.wins - allPlay.pct * games) : 0,
      weeks: mine.length,
      read: '',
    };
  });

  /* The score, then the all-play record to break it: two teams a point apart
   * on a composite are separated by the part of it that is a fact. */
  teams.sort((a, b) => b.score - a.score || b.allPlay.pct - a.allPlay.pct || (b.ppg ?? 0) - (a.ppg ?? 0));
  teams.forEach((t, i) => { t.rank = i + 1; });
  return teams;
}

export function powerRankings(rows: LeagueRow[], scores: WeekScore[]): PowerTeam[] {
  const teams = build(rows, scores);

  /* Where everybody stood before the newest week, by running the same ranking
   * over everything but it. Not a stored number: a ranking that remembers its
   * own past can only be wrong about it, and this cannot disagree with itself. */
  const latest = Math.max(...scores.map(s => s.week), 0);
  const prior = latest > 1
    ? new Map(build(rows, scores.filter(s => s.week < latest)).map(t => [t.id, t.rank]))
    : null;

  const swings = teams.map(t => t.swing).filter((n): n is number => n != null);
  const widest = swings.length > 1 ? Math.max(...swings) : null;
  const narrowest = swings.length > 1 ? Math.min(...swings) : null;

  for (const t of teams) {
    t.was = prior?.get(t.id) ?? null;
    t.move = t.was == null ? 0 : t.was - t.rank;
    t.swingiest = widest != null && t.swing === widest;
    t.steadiest = narrowest != null && t.swing === narrowest;
  }
  for (const t of teams) t.read = readOf(t, teams.length);
  return teams;
}

/** How far a normal week lands from a team's average, in points. */
function spread(xs: number[]): number {
  const m = mean(xs) as number;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
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

  /* Which is the same team every week and which is a coin toss. Only the two
   * ends of the league get this line: everybody in between is ordinary, and
   * saying so about eight teams would bury the two it is about. */
  if (t.swing != null && t.weeks >= RECENT_WEEKS) {
    if (t.swingiest) {
      return `The wildest week to week in the league — give or take ${t.swing.toFixed(0)} points either side.`;
    }
    if (t.steadiest) {
      return `The same team every Sunday — give or take ${t.swing.toFixed(0)} points either side.`;
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
