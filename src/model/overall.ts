/**
 * One number for how good a team is, from four readings of it, each taken
 * against everybody else in the league rather than on its own scale:
 *
 *  - fit: the Rating of its best lineup;
 *  - value: what its roster is worth on the market;
 *  - points: what it scores a game;
 *  - record: its share of wins (a tie is half).
 *
 * Each becomes a percentile — the share of the other teams it is ahead of,
 * 100 for the best in the league and 0 for the worst — so a 75 means the same
 * thing in every row, and the four can be added up. Weighted 35 / 25 / 20 /
 * 20. Before anybody has played, points and record say nothing and the other
 * two share their weight.
 */
export interface OverallInput {
  id: number;
  /** best-lineup Rating, 0..100 */
  fit: number;
  /** roster market value, any scale */
  value: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface Overall {
  /** 0..100 */
  score: number;
  /** 1 = best in the league */
  rank: number;
  /** each 0..100: the share of the league this team is ahead of */
  fit: number;
  value: number;
  /** null before any game */
  points: number | null;
  record: number | null;
}

export const OVERALL_WEIGHTS = { fit: 0.35, value: 0.25, points: 0.2, record: 0.2 };

/** Where x sits among all the values, 0..100: teams below it count whole,
 *  teams level with it count half. */
export function percentile(x: number, all: number[]): number {
  if (all.length < 2) return 100;
  let below = 0, level = 0;
  for (const v of all) {
    if (v < x) below++;
    else if (v === x) level++;
  }
  // Itself is one of the "level" ones and does not count.
  return ((below + (level - 1) / 2) / (all.length - 1)) * 100;
}

export function overallRatings(teams: OverallInput[]): Record<number, Overall> {
  const games = (t: OverallInput) => t.wins + t.losses + t.ties;
  const played = teams.some(t => games(t) > 0);
  const ppg = (t: OverallInput) => (games(t) ? t.pointsFor / games(t) : 0);
  const winShare = (t: OverallInput) => (games(t) ? (t.wins + t.ties / 2) / games(t) : 0);

  const fits = teams.map(t => t.fit);
  const values = teams.map(t => t.value);
  const ppgs = teams.map(ppg);
  const wins = teams.map(winShare);

  const w = OVERALL_WEIGHTS;
  const scored = teams.map(t => {
    const fit = percentile(t.fit, fits);
    const value = percentile(t.value, values);
    const points = played ? percentile(ppg(t), ppgs) : null;
    const record = played ? percentile(winShare(t), wins) : null;
    const score = points == null || record == null
      ? (w.fit * fit + w.value * value) / (w.fit + w.value)
      : w.fit * fit + w.value * value + w.points * points + w.record * record;
    return { id: t.id, score, fit, value, points, record, rawFit: t.fit };
  });
  const order = scored.slice().sort((a, b) => b.score - a.score || b.rawFit - a.rawFit);
  const out: Record<number, Overall> = {};
  for (const s of scored) {
    out[s.id] = {
      score: s.score, rank: order.findIndex(o => o.id === s.id) + 1,
      fit: s.fit, value: s.value, points: s.points, record: s.record,
    };
  }
  return out;
}
