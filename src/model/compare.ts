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

/**
 * The other half of a player's card, reduced to what two of them can be asked
 * together.
 *
 * Not everything on a card compares. A quarterback's attempts and a receiver's
 * targets are both "his share of the offence" and are not the same quantity,
 * so that row appears only when both sides measure it the same way — which,
 * across positions, they usually do not. The rest are the same question
 * whoever is being asked: what the league pays for him, how much of his team's
 * snaps he is on the field for, what he does per touch, how often he scores.
 */
export type CmpUse = {
  /** the app's own Rating — the headline the two of them are ordered by */
  rating: number | null;
  /** what the market pays */
  value: number | null;
  /** share of his team's snaps, 0..1 */
  snap: number | null;
  /** his share of the offence, and what that share is called for his position */
  share: number | null;
  shareLabel: string | null;
  /** yards per touch */
  eff: number | null;
  /** touchdowns a game */
  tdPerGame: number | null;
  /** share of his team's red-zone work, 0..1 */
  rzShare: number | null;
};

export function compareNumbers(a: CmpUse, b: CmpUse): CmpRow[] {
  const rows: CmpRow[] = [];
  const add = (key: string, label: string, av: number | null, bv: number | null) => {
    let win: 'a' | 'b' | null = null;
    if (av != null && bv != null && av !== bv) win = av > bv ? 'a' : 'b';
    rows.push({ key, label, a: av, b: bv, win });
  };

  /* First, because it is the number that put one of them above the other on
     the list they were opened from — and the rows under it are most of what
     goes into it, so this is where "why is he ahead" gets answered. */
  add('rating', 'Rating', a.rating, b.rating);
  add('value', 'Market value', a.value, b.value);
  add('snap', 'Snap share', pct(a.snap), pct(b.snap));
  /* Only where both sides mean the same thing by it. Comparing a passer's
     attempts with a receiver's target share is comparing two numbers that were
     never in competition, and the row would decide itself on the units. */
  if (a.shareLabel && a.shareLabel === b.shareLabel) {
    add('share', a.shareLabel, a.share, b.share);
  }
  add('eff', 'Yards per touch', a.eff, b.eff);
  add('td', 'TDs a game', a.tdPerGame, b.tdPerGame);
  add('rz', 'Red-zone share', pct(a.rzShare), pct(b.rzShare));
  return rows;
}

const pct = (n: number | null): number | null =>
  (n == null ? null : Math.round(n * 1000) / 10);
