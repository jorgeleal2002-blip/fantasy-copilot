/**
 * One number for how good a team is, from three readings of it:
 *
 *  - fit: the Rating of its best lineup, already 0..100;
 *  - value: what its roster is worth on the market, against the league's
 *    richest roster;
 *  - record: how it is actually doing — win share, with points for (against
 *    the league's best) beside it, because three games of wins are mostly luck
 *    and points scored are less so.
 *
 * Weighted 40 / 30 / 30. Before anybody has played, record says nothing and
 * the other two share its weight.
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
  /** 0..100, or null before any game */
  record: number | null;
}

export const OVERALL_WEIGHTS = { fit: 0.4, value: 0.3, record: 0.3 };

export function overallRatings(teams: OverallInput[]): Record<number, Overall> {
  const maxValue = Math.max(1e-9, ...teams.map(t => t.value));
  const maxPf = Math.max(1e-9, ...teams.map(t => t.pointsFor));
  const scored = teams.map(t => {
    const games = t.wins + t.losses + t.ties;
    const fit = Math.max(0, Math.min(100, t.fit));
    const value = (t.value / maxValue) * 100;
    const record = games
      ? (0.7 * ((t.wins + t.ties / 2) / games) + 0.3 * (t.pointsFor / maxPf)) * 100
      : null;
    const w = OVERALL_WEIGHTS;
    const score = record == null
      ? (w.fit * fit + w.value * value) / (w.fit + w.value)
      : w.fit * fit + w.value * value + w.record * record;
    return { id: t.id, score, fit, value, record };
  });
  const order = scored.slice().sort((a, b) => b.score - a.score || b.fit - a.fit);
  const out: Record<number, Overall> = {};
  for (const s of scored) {
    out[s.id] = { score: s.score, rank: order.findIndex(o => o.id === s.id) + 1, fit: s.fit, value: s.value, record: s.record };
  }
  return out;
}
