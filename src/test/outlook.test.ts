import { describe, expect, it } from 'vitest';
import { seasonOutlook } from '../model/outlook';

describe('seasonOutlook place', () => {
  it('ranks the expected finish: the strong team first, every place used once', () => {
    const teams = [1, 2, 3, 4].map(id => ({ id, wins: 0, losses: 0, ties: 0, pf: 0, strength: 80 + id * 10 }));
    const schedule = [1, 2, 3].map(week => ({ week, pairs: [[1, 2], [3, 4]] as [number, number][] }))
      .concat([4, 5, 6].map(week => ({ week, pairs: [[1, 3], [2, 4]] as [number, number][] })));
    const out = seasonOutlook(teams, schedule, 2);
    expect(out[4].place).toBe(1);
    expect(out[1].place).toBe(4);
    expect(Object.values(out).map(o => o.place).sort()).toEqual([1, 2, 3, 4]);
    expect(out[4].avgPlace).toBeLessThan(out[1].avgPlace);
  });
});
