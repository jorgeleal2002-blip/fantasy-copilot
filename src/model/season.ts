/**
 * A player's season, in the only currency a fantasy manager spends.
 *
 * Passing yards and completion percentage are a quarterback's season; they are
 * not a fantasy season. What a lineup decision actually turns on is what he has
 * put on the board, how often, how low it goes on his bad weeks and how high on
 * his good ones — and, since a league is a closed market, where each of those
 * sits among the other men at his position who could be started instead.
 *
 * Byes and weeks he did not play are absent rather than zero: a man who has
 * played twice and sat out once has scored twice, and averaging the third in
 * says he is worse than he is. That is decided upstream, where the weeks are
 * read — a zero there is a week with no game, not a week with no points.
 */

export type Game = { week: number; pts: number };

export type SeasonLine = {
  games: number;
  total: number;
  ppg: number;
  /** His best and worst weeks. */
  high: number;
  low: number;
  /**
   * What he clears three weeks in four, and what he reaches one in four.
   *
   * The average is the wrong number to start a player on by itself: two men at
   * 14 a game are not the same player if one of them goes 13, 14, 15 and the
   * other goes 2, 6, 34. The quartiles are where that difference lives, and
   * they are what "safe" and "needs a ceiling" actually mean.
   */
  floor: number;
  ceiling: number;
};

/** The value at a fraction of the way through a sorted list, interpolated. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0] as number;
  const at = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const a = sorted[lo] as number;
  if (lo === hi) return a;
  return a + ((sorted[hi] as number) - a) * (at - lo);
}

const one = (n: number) => Math.round(n * 10) / 10;

export function seasonLine(games: Game[]): SeasonLine | null {
  if (!games.length) return null;
  const pts = games.map(g => g.pts);
  const sorted = pts.slice().sort((a, b) => a - b);
  const total = pts.reduce((a, b) => a + b, 0);
  return {
    games: games.length,
    total: one(total),
    ppg: one(total / games.length),
    high: one(sorted[sorted.length - 1] as number),
    low: one(sorted[0] as number),
    floor: one(quantile(sorted, 0.25)),
    ceiling: one(quantile(sorted, 0.75)),
  };
}

export type Ranked = { rank: number; of: number };

/**
 * Where a value sits in a field, counting from the best.
 *
 * Ties share the better rank, the way a leaderboard does: two men averaging
 * 18.4 are both second, and nobody is third.
 */
export function rankAmong(mine: number, field: number[]): Ranked | null {
  if (!field.length) return null;
  const better = field.filter(v => v > mine).length;
  return { rank: better + 1, of: field.length };
}

/** 1st, 2nd, 3rd. */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

/**
 * The bars, scaled to the best week on the card rather than to the league.
 *
 * A chart of one player is a chart about him: the question it answers is which
 * of his weeks were the good ones, and scaling it to somebody else's ceiling
 * flattens his whole season into a stripe along the bottom to make a point
 * nobody asked about.
 */
export function barHeights(games: Game[], min = 0.06): number[] {
  const top = Math.max(0, ...games.map(g => g.pts));
  if (!(top > 0)) return games.map(() => min);
  return games.map(g => Math.max(min, g.pts / top));
}
