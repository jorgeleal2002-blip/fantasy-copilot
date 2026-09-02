import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_ROOM, newRoomId } from '../api/live';
import { cleanRoomCode, isRoomCode, roomCodeProblem } from '../model/invite';

describe('a room id', () => {
  it('is six readable characters, with the ambiguous ones left out', () => {
    for (let i = 0; i < 40; i++) {
      const id = newRoomId();
      expect(id).toHaveLength(6);
      // O/0 and I/l/1 are the pairs people mishear and mistype
      expect(id).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('does not repeat itself in any run you would notice', () => {
    const seen = new Set(Array.from({ length: 500 }, newRoomId));
    expect(seen.size).toBeGreaterThan(495);
  });

  /* Every generated code has to be one somebody can type back in, or the
   * join box is a door with no key. */
  it('is always a code the join box will accept', () => {
    for (let i = 0; i < 40; i++) expect(isRoomCode(newRoomId())).toBe(true);
  });
});

/**
 * Typing the code instead of opening the link.
 *
 * A link means leaving the app — out to a browser, back in, and on a phone
 * that is a different window with a different session. Six characters read out
 * loud never leave the screen, which is the whole reason the alphabet has no
 * look-alikes in it.
 */
describe('a room code somebody types', () => {
  it('does not care about case, spaces or dashes', () => {
    expect(cleanRoomCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(cleanRoomCode('abcdef')).toBe('ABCDEF');
    expect(cleanRoomCode('ABCDEFGH')).toBe('ABCDEF');   // never longer than one
  });

  /* The look-alikes are excluded on purpose, so a typed O is a misread rather
   * than a typo — and naming the character is the difference between fixing it
   * and giving up. */
  it('says which character cannot be in one', () => {
    expect(roomCodeProblem('AB0DEF')).toMatch(/No 0 in a room code/);
    expect(roomCodeProblem('ABIDEF')).toMatch(/No I in a room code/);
    expect(roomCodeProblem('A0I1LO')).toMatch(/No 0 or I or 1 or L or O/);
    expect(roomCodeProblem('ABCDEF')).toBe(null);
    expect(roomCodeProblem('')).toBe(null);
  });

  it('is only whole at six', () => {
    expect(isRoomCode('ABCDE')).toBe(false);
    expect(isRoomCode('ABCDEF')).toBe(true);
    expect(isRoomCode('ABCDE0')).toBe(false);
    expect(isRoomCode('')).toBe(false);
  });
});

describe('an empty room', () => {
  it('carries the three things a shared draft is made of', () => {
    const r = EMPTY_ROOM(7, 'L1', 'u1');
    expect(r.seed).toBe(7);
    expect(r.leagueId).toBe('L1');
    expect(r.host).toBe('u1');
    // and starts with nobody seated and nothing drafted
    expect(r.seats).toEqual({});
    expect(r.picks).toEqual({});
  });
});

/* The transport is exercised against a stubbed endpoint: what matters is that
   a pick is addressed by its overall number, so the same pick sent twice is
   one entry and not two, and that a seat claim never overwrites another. */
describe('what the client sends', () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); vi.resetModules(); });

  const load = async () => {
    vi.stubEnv('VITE_RTDB_URL', 'https://x.example.com');
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) } as Response);
    });
    return import('../api/live');
  };

  it('claims a seat with a merge, never a replace', async () => {
    const live = await load();
    await live.claimSeat('ABC123', 4, { id: 'u2', name: 'Konoha' });
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('/rooms/ABC123/seats.json');
    expect(calls[0].body).toEqual({ 4: { id: 'u2', name: 'Konoha' } });
  });

  /* Sitting down means sitting in ONE chair. Without the release, tapping a
   * second seat left the room holding you in both — and a seat with somebody
   * in it is a seat the draft waits at, so a person looking around a room
   * before it started could stop the bots from ever taking a turn. */
  it('vacates the seats you were already in, in the same write', async () => {
    const live = await load();
    await live.claimSeat('ABC123', 8, { id: 'u2', name: 'Konoha' }, [1, 3, 5]);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].body).toEqual({ 8: { id: 'u2', name: 'Konoha' }, 1: null, 3: null, 5: null });
  });

  it('does not vacate the seat it is claiming', async () => {
    const live = await load();
    await live.claimSeat('ABC123', 4, { id: 'u2', name: 'Konoha' }, [4]);
    expect(calls[0].body).toEqual({ 4: { id: 'u2', name: 'Konoha' } });
  });

  it('addresses a pick by its overall number, so a resend is idempotent', async () => {
    const live = await load();
    await live.pushPick('ABC123', 17, 'p99');
    await live.pushPick('ABC123', 17, 'p99');
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].body).toEqual({ 17: 'p99' });
    expect(calls[1].body).toEqual(calls[0].body);
  });

  it('refuses a room the database does not have', async () => {
    vi.stubEnv('VITE_RTDB_URL', 'https://x.example.com');
    vi.stubGlobal('fetch', () => Promise.resolve(
      { ok: true, status: 200, json: () => Promise.resolve(null) } as Response,
    ));
    const live = await import('../api/live');
    expect(await live.readRoom('NOPE12')).toBe(null);
  });
});

describe('with no database configured', () => {
  it('the feature is off rather than broken', async () => {
    vi.stubEnv('VITE_RTDB_URL', '');
    vi.resetModules();
    const live = await import('../api/live');
    expect(live.liveEnabled()).toBe(false);
    // watching is a no-op that still hands back a working unsubscribe
    const stop = live.watchRoom('ABC123', () => { throw new Error('should not fire'); });
    expect(typeof stop).toBe('function');
    stop();
    vi.unstubAllEnvs();
  });
});
