import { describe, expect, it } from 'vitest';
import { overallRatings } from '../model/overall';

const t = (id: number, fit: number, value: number, wins: number, losses: number, pf: number) =>
  ({ id, fit, value, wins, losses, ties: 0, pointsFor: pf });

describe('overallRatings', () => {
  it('blends fit, value and points', () => {
    const o = overallRatings([t(1, 80, 100, 3, 0, 240), t(2, 70, 90, 0, 3, 400)]);
    // Team 2 has the worse lineup and record but scores far more: points count, wins do not.
    expect(o[2].rank).toBe(1);
    expect(o[1].rank).toBe(2);
    expect(o[2].points).toBeCloseTo(100);
    expect(o[1].points).toBeCloseTo(60);
  });
  it('leaves points out before any game', () => {
    const o = overallRatings([t(1, 80, 100, 0, 0, 0), t(2, 70, 90, 0, 0, 0)]);
    expect(o[1].points).toBeNull();
    expect(o[1].rank).toBe(1);
    expect(o[1].score).toBeCloseTo((0.4 * 80 + 0.3 * 100) / 0.7);
  });
});
