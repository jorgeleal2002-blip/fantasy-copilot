import type { SeasonLine } from './season';

/**
 * Two players' seasons, side by side.
 *
 * A comparison is not two cards next to each other. Reading a number off one
 * and a number off the other and doing the subtraction in your head is the work
 * the screen is supposed to have done, and it is exactly the work people get
 * wrong — a 2-point edge in points a game looks the same as a 2-point edge in a
 * best week, and one of those decides a season.
 *
 * So the rows are paired and each one says who wins it, and the rows are the
 * fantasy questions: how much, how often, how safe, how high.
 */

export type CmpRow = {
  key: string;
  label: string;
  /** Both sides, already rounded, and null where a man has not played. */
  a: number | null;
  b: number | null;
  /** 'a', 'b', or null for a tie or a row nobody can win. */
  win: 'a' | 'b' | null;
};

/** The order they are asked in: how much, how often, how safe, how high. */
const ROWS: { key: keyof SeasonLine; label: string }[] = [
  { key: 'ppg', label: 'Points a game' },
  { key: 'total', label: 'Total points' },
  { key: 'games', label: 'Games played' },
  { key: 'floor', label: 'Floor' },
  { key: 'ceiling', label: 'Ceiling' },
  { key: 'high', label: 'Best week' },
  { key: 'low', label: 'Worst week' },
];

/**
 * More is better in every row here, which is worth stating rather than
 * assuming: a worst week is a floor under him, so a higher one is a better
 * one, and it is the row people misread.
 */
export function compareSeasons(a: SeasonLine | null, b: SeasonLine | null): CmpRow[] {
  return ROWS.map(({ key, label }) => {
    const av = a ? a[key] : null;
    const bv = b ? b[key] : null;
    let win: 'a' | 'b' | null = null;
    if (av != null && bv != null && av !== bv) win = av > bv ? 'a' : 'b';
    return { key, label, a: av, b: bv, win };
  });
}

/** How many of the rows each side takes, for the line that says who is ahead. */
export function tally(rows: CmpRow[]): { a: number; b: number } {
  return {
    a: rows.filter(r => r.win === 'a').length,
    b: rows.filter(r => r.win === 'b').length,
  };
}

/**
 * The verdict, in the only terms a comparison of two seasons can support.
 *
 * Deliberately not a recommendation. Which of them to start on Sunday depends
 * on who they play and who is fit, and which to trade for depends on what you
 * are paying — neither is in this table, and a table that says "start him"
 * off seven rows of history is overreaching.
 */
export function aheadBy(rows: CmpRow[]): { side: 'a' | 'b'; rows: number } | null {
  const t = tally(rows);
  if (t.a === t.b) return null;
  return t.a > t.b ? { side: 'a', rows: t.a } : { side: 'b', rows: t.b };
}
