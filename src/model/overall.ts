/**
 * One number for how good a team is, from three readings of it:
 *
 *  - fit: the Rating of its best lineup, already 0..100;
 *  - value: what its roster is worth on the market, against the league's
 *    richest roster;
 *  - points: what it scores a game, against the league's top scorer;
 *  - record: its share of wins — what the table actually pays for, though a
 *    win depends on the opponent too, which is why it weighs no more than
 *    the points.
 *
 * Weighted 35 / 25 / 20 / 20. Before anybody has played, points and record
 * say nothing and the other two share their weight.
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
  fit: number;
  /** 0..100, against the league's most valuable roster */
  value: number;
  /** 0..100 against the league's top scorer, or null before any game */
  points: number | null;
  /** 0..100: share of games won (a tie is half), or null before any game */
  record: number | null;
}

export const OVERALL_WEIGHTS = { fit: 0.35, value: 0.25, points: 0.2, record: 0.2 };

export function overallRatings(teams: OverallInput[]): Record<number, Overall> {
  const maxValue = Math.max(1e-9, ...teams.map(t => t.value));
  const ppgOf = (t: OverallInput) => {
    const g = t.wins + t.losses + t.ties;
    return g ? t.pointsFor / g : 0;
  };
  const maxPpg = Math.max(1e-9, ...teams.map(ppgOf));
  const scored = teams.map(t => {
    const games = t.wins + t.losses + t.ties;
    const fit = Math.max(0, Math.min(100, t.fit));
    const value = (t.value / maxValue) * 100;
    // Per game, so a team with a game more is not ahead for that alone.
    const ppg = games ? t.pointsFor / games : 0;
    const points = games ? (ppg / maxPpg) * 100 : null;
    const record = games ? ((t.wins + t.ties / 2) / games) * 100 : null;
    const w = OVERALL_WEIGHTS;
    const score = points == null || record == null
      ? (w.fit * fit + w.value * value) / (w.fit + w.value)
      : w.fit * fit + w.value * value + w.points * points + w.record * record;
    return { id: t.id, score, fit, value, points, record };
  });
  const order = scored.slice().sort((a, b) => b.score - a.score || b.fit - a.fit);
  const out: Record<number, Overall> = {};
  for (const s of scored) {
    out[s.id] = { score: s.score, rank: order.findIndex(o => o.id === s.id) + 1, fit: s.fit, value: s.value, points: s.points, record: s.record };
  }
  return out;
}
