import { describe, expect, it } from 'vitest';
import { mine, newScores, tdAlert, tdCounts, touchdowns } from '../src/watch';
import { easternParts, inGameWindow } from '../src/window';

describe('counting touchdowns off a stat line', () => {
  it('counts every kind, thrown and returned included', () => {
    expect(touchdowns({ pass_td: 2, rush_td: 1, rec_td: 1, def_st_td: 1 })).toBe(5);
  });
  it('is nought for a line with none, and for no line', () => {
    expect(touchdowns({ rec: 9, rec_yd: 194 })).toBe(0);
    expect(touchdowns(undefined)).toBe(0);
    expect(touchdowns(null)).toBe(0);
  });
  it('keeps only the scorers, because the snapshot has to fit in a key', () => {
    const counts = tdCounts({ a: { rec_td: 1 }, b: { rec_yd: 80 }, c: { rush_td: 2 } });
    expect(counts).toEqual({ a: 1, c: 2 });
  });
});

describe('what is new since the last look', () => {
  /* The rule the whole feature's manners depend on. */
  it('announces nothing at all on the first look', () => {
    expect(newScores(null, { a: 2, b: 1 })).toEqual([]);
    expect(newScores(undefined, { a: 2, b: 1 })).toEqual([]);
  });
  it('announces a player who was not scoring before', () => {
    expect(newScores({}, { a: 1 })).toEqual([{ id: 'a', total: 1, gained: 1 }]);
  });
  it('announces only the difference when he scores again', () => {
    expect(newScores({ a: 1 }, { a: 2 })).toEqual([{ id: 'a', total: 2, gained: 1 }]);
  });
  it('catches up with both when a tick was missed', () => {
    expect(newScores({ a: 0 }, { a: 2 })).toEqual([{ id: 'a', total: 2, gained: 2 }]);
  });
  it('says nothing when nothing moved', () => {
    expect(newScores({ a: 2, b: 1 }, { a: 2, b: 1 })).toEqual([]);
  });
  /* Sleeper restates a line hours later — a score reassigned on review. */
  it('stays quiet when a correction takes one away', () => {
    expect(newScores({ a: 2 }, { a: 1 })).toEqual([]);
  });
  it('announces the next one off the corrected figure, not the old one', () => {
    // He was credited 2, corrected to 1, then genuinely scored: that is one.
    expect(newScores({ a: 1 }, { a: 2 })).toEqual([{ id: 'a', total: 2, gained: 1 }]);
  });
  it('is quiet when a player drops out of the file entirely', () => {
    expect(newScores({ a: 1 }, {})).toEqual([]);
  });
  it('puts the bigger news first', () => {
    expect(newScores({}, { a: 1, b: 2 }).map(s => s.id)).toEqual(['b', 'a']);
  });
});

describe('whose touchdowns they are', () => {
  const scored = [
    { id: 'javonte', total: 1, gained: 1 },
    { id: 'someone-else', total: 1, gained: 1 },
  ];
  it('keeps the ones in the lineup', () => {
    expect(mine(scored, ['javonte', 'other']).map(s => s.id)).toEqual(['javonte']);
  });
  /* A touchdown on your bench is not news you want to be interrupted for. */
  it('drops a scorer who is only on the bench', () => {
    expect(mine(scored, ['nobody'])).toEqual([]);
  });
  it('is not fooled by the zero Sleeper puts in an unfilled slot', () => {
    expect(mine([{ id: '0', total: 1, gained: 1 }], ['0', ''])).toEqual([]);
  });
  it('is empty rather than throwing when there is no lineup', () => {
    expect(mine(scored, null)).toEqual([]);
    expect(mine(scored, undefined)).toEqual([]);
  });
});

describe('what the lock screen says', () => {
  it('leads with the name and says where he plays', () => {
    const a = tdAlert({ id: '1', total: 1, gained: 1 }, 'Javonte Williams', 'RB', 'DAL', 5);
    expect(a.title).toBe('Javonte Williams');
    expect(a.body).toBe('Touchdown · RB · DAL');
  });
  it('counts them for him once he has more than one', () => {
    expect(tdAlert({ id: '1', total: 2, gained: 1 }, 'X', 'WR', 'ATL', 5).body)
      .toBe('Touchdown — his second today · WR · ATL');
  });
  it('says both at once when a tick was missed', () => {
    expect(tdAlert({ id: '1', total: 2, gained: 2 }, 'X', 'WR', 'ATL', 5).body)
      .toBe('2 touchdowns · WR · ATL');
  });
  it('still reads when the player has no team, as a free agent does', () => {
    expect(tdAlert({ id: '1', total: 1, gained: 1 }, 'X', 'WR', '', 5).body).toBe('Touchdown · WR');
  });
  /* A resent push must collapse into the bubble it is a retry of — but his
     NEXT touchdown is a different event and has to arrive on its own. */
  it('tags the event, so a retry cannot buzz twice and the next one still can', () => {
    const first = tdAlert({ id: 'j', total: 1, gained: 1 }, 'X', 'RB', 'DAL', 5);
    const again = tdAlert({ id: 'j', total: 1, gained: 1 }, 'X', 'RB', 'DAL', 5);
    const next = tdAlert({ id: 'j', total: 2, gained: 1 }, 'X', 'RB', 'DAL', 5);
    expect(again.tag).toBe(first.tag);
    expect(next.tag).not.toBe(first.tag);
  });
  it('does not carry a points figure it would get wrong', () => {
    const a = tdAlert({ id: '1', total: 1, gained: 1 }, 'Javonte Williams', 'RB', 'DAL', 5);
    expect(a.title + a.body).not.toMatch(/\d+(\.\d+)?\s*(pts|points)/i);
  });
});

describe('when the worker bothers to look', () => {
  // Eastern time: the two clock changes inside a season are the whole point.
  const et = (iso: string) => new Date(iso);

  it('reads the Eastern weekday and hour through a UTC runtime', () => {
    // 2025-10-05 18:30Z is Sunday 14:30 in New York.
    expect(easternParts(et('2025-10-05T18:30:00Z'))).toMatchObject({ day: 0, hour: 14 });
    // 2025-01-13 01:30Z is still Sunday evening there, at 20:30.
    expect(easternParts(et('2025-01-13T01:30:00Z'))).toMatchObject({ day: 0, hour: 20 });
  });

  it('looks all Sunday, from the London kickoff to the end of the night game', () => {
    expect(inGameWindow(et('2025-10-05T13:30:00Z'))).toBe(true); // Sun 09:30 ET
    expect(inGameWindow(et('2025-10-06T02:30:00Z'))).toBe(true); // Sun 22:30 ET
  });
  it('looks on Thursday and Monday nights', () => {
    expect(inGameWindow(et('2025-10-03T01:00:00Z'))).toBe(true); // Thu 21:00 ET
    expect(inGameWindow(et('2025-10-07T01:00:00Z'))).toBe(true); // Mon 21:00 ET
  });
  it('is still looking after midnight, for a game that ran long', () => {
    expect(inGameWindow(et('2025-10-06T04:30:00Z'))).toBe(true); // Mon 00:30 ET
  });
  it('looks on a December Saturday', () => {
    expect(inGameWindow(et('2025-12-20T20:00:00Z'))).toBe(true); // Sat 15:00 ET
  });
  it('does not look on a Sunday morning before anyone has kicked off', () => {
    expect(inGameWindow(et('2025-10-05T10:00:00Z'))).toBe(false); // Sun 06:00 ET
  });
  it('does not look on a Tuesday or a Wednesday', () => {
    expect(inGameWindow(et('2025-10-07T18:00:00Z'))).toBe(false); // Tue 14:00 ET
    expect(inGameWindow(et('2025-10-08T18:00:00Z'))).toBe(false); // Wed 14:00 ET
  });
  it('does not look in the summer at all', () => {
    for (const d of ['2025-05-04T18:00:00Z', '2025-07-06T18:00:00Z', '2025-08-10T18:00:00Z']) {
      expect(inGameWindow(et(d))).toBe(false);
    }
  });
  it('looks for the Super Bowl and for nothing else in February', () => {
    expect(inGameWindow(et('2026-02-08T23:30:00Z'))).toBe(true);  // Sun 18:30 ET
    expect(inGameWindow(et('2026-02-15T18:00:00Z'))).toBe(false); // Sun 13:00 ET, no game
    expect(inGameWindow(et('2026-02-12T01:00:00Z'))).toBe(false); // Wed night
  });
});
