import { describe, expect, it } from 'vitest';
import { playText, playsBetween } from '../model/plays';

describe('touchdowns and big plays between two reads', () => {
  it('calls a touchdown, with the yards of the play', () => {
    const p = playsBetween({ a: { rec: 3, rec_yd: 40, rec_td: 0 } }, { a: { rec: 4, rec_yd: 82, rec_td: 1 } }, ['a']);
    expect(p).toEqual([{ pid: 'a', kind: 'td', how: 'rec', yards: 42, pts: null }]);
    expect(playText(p[0], 'Ja\'Marr Chase', 'mine')).toEqual({
      title: '🏈 TOUCHDOWN: Ja\'Marr Chase', body: '42-yd catch for a TD',
    });
  });

  it('calls a long gain a big play, and a short one nothing', () => {
    const before = { a: { rush_yd: 10 }, b: { rush_yd: 10 } };
    const after = { a: { rush_yd: 45 }, b: { rush_yd: 18 } };
    expect(playsBetween(before, after, ['a', 'b']).map(p => p.pid + ':' + p.kind + ':' + p.yards)).toEqual(['a:big:35']);
  });

  it('says nothing on the first read of a week', () => {
    expect(playsBetween({}, { a: { rec_td: 2, rec_yd: 120 } }, ['a'])).toEqual([]);
  });

  it('only watches the players asked about', () => {
    expect(playsBetween({ x: { rec_td: 0 } }, { x: { rec_td: 1 } }, ['a'])).toEqual([]);
  });

  it('counts the points the play was worth', () => {
    const pts = (l: Record<string, number | undefined>) => (l.rec_td || 0) * 6 + (l.rec_yd || 0) * 0.1;
    const [p] = playsBetween({ a: { rec_td: 0, rec_yd: 0 } }, { a: { rec_td: 1, rec_yd: 25 } }, ['a'], pts);
    expect(p.pts).toBe(8.5);
    expect(playText(p, 'X', 'theirs').title).toContain('your opponent');
  });
});
