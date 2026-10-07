import { describe, expect, it } from 'vitest';
import { overallRatings, percentile } from '../model/overall';

const t = (id: number, fit: number, value: number, wins: number, losses: number, pf: number) =>
  ({ id, fit, value, wins, losses, ties: 0, pointsFor: pf });

describe('percentile', () => {
  it('runs from 0 for the worst to 100 for the best, ties shared', () => {
    expect(percentile(1, [1, 2, 3])).toBe(0);
    expect(percentile(2, [1, 2, 3])).toBe(50);
    expect(percentile(3, [1, 2, 3])).toBe(100);
    expect(percentile(2, [1, 2, 2])).toBe(75);
  });
});

describe('overallRatings', () => {
  it('ranks every part against the whole league, record included', () => {
    const o = overallRatings([
      t(1, 80, 100, 3, 0, 300), // best lineup, richest, 3-0, middle points
      t(2, 70, 90, 0, 3, 400), // most points, 0-3
      t(3, 60, 80, 2, 1, 200),
    ]);
    expect(o[1].fit).toBe(100);
    expect(o[3].fit).toBe(0);
    expect(o[2].points).toBe(100);
    expect(o[1].points).toBe(50);
    expect(o[1].record).toBe(100);
    expect(o[2].record).toBe(0);
    // 0.35*100 + 0.25*100 + 0.2*50 + 0.2*100 = 90
    expect(o[1].score).toBeCloseTo(90);
    expect(o[1].rank).toBe(1);
  });
  it('leaves points and record out before any game', () => {
    const o = overallRatings([t(1, 80, 100, 0, 0, 0), t(2, 70, 90, 0, 0, 0)]);
    expect(o[1].points).toBeNull();
    expect(o[1].record).toBeNull();
    expect(o[1].score).toBeCloseTo(100);
    expect(o[2].score).toBeCloseTo(0);
  });
});
