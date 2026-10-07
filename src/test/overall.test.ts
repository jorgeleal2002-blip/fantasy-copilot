import { describe, expect, it } from 'vitest';
import { overallRatings } from '../model/overall';

const t = (id: number, fit: number, value: number, wins: number, losses: number, pf: number) =>
  ({ id, fit, value, wins, losses, ties: 0, pointsFor: pf });

describe('overallRatings', () => {
  it('blends fit, value, points and record', () => {
    const o = overallRatings([t(1, 80, 100, 3, 0, 240), t(2, 70, 90, 0, 3, 400)]);
    expect(o[2].points).toBeCloseTo(100);
    expect(o[1].points).toBeCloseTo(60);
    expect(o[1].record).toBeCloseTo(100);
    expect(o[2].record).toBeCloseTo(0);
    // 0.35*80 + 0.25*100 + 0.2*60 + 0.2*100 = 85
    expect(o[1].score).toBeCloseTo(85);
    // 0.35*70 + 0.25*90 + 0.2*100 + 0.2*0 = 67
    expect(o[2].score).toBeCloseTo(67);
    expect(o[1].rank).toBe(1);
  });
  it('leaves points out before any game', () => {
    const o = overallRatings([t(1, 80, 100, 0, 0, 0), t(2, 70, 90, 0, 0, 0)]);
    expect(o[1].points).toBeNull();
    expect(o[1].rank).toBe(1);
    expect(o[1].record).toBeNull();
    expect(o[1].score).toBeCloseTo((0.35 * 80 + 0.25 * 100) / 0.6);
  });
});
