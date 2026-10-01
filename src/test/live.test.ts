import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_ROOM, PHOTO_MAX_BYTES, keepPhotos, newRoomId } from '../api/live';
import { sessionFrom, stale } from '../api/identity';
import { caretAfterClean, cleanRoomCode, isRoomCode, roomCodeProblem } from '../model/invite';
import { LOOKS, type ClipName } from '../ui/brainrot';

const CLIP_NAMES = Object.keys(LOOKS) as ClipName[];

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

  /* The box shows the cleaned code rather than the keystrokes, and a controlled
   * input whose value differs from what was typed drops the caret at the end
   * on every render — measured: inserting at position two left it at six, so
   * tapping into the middle to fix one character was impossible. */
  it('keeps the caret where the typing was', () => {
    expect(caretAfterClean('EPXEWTS', 3)).toBe(3);
    expect(caretAfterClean('ep-ew', 5)).toBe(4);        // the dash is not a character
    expect(caretAfterClean('  abc', 5)).toBe(3);
    expect(caretAfterClean('ABCDEFGH', 8)).toBe(6);     // never past the end of a code
    expect(caretAfterClean('ABC', 0)).toBe(0);
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

  /**
   * Restart is a local button everywhere else — a new seed, no picks, back to
   * the lobby — and in a room all three of those live in the database. Setting
   * the local three did nothing at all: measured in the browser, eleven picks
   * became zero on your own and stayed a draft in progress in a room.
   */
  it('un-decides everything the room had decided', async () => {
    const live = await load();
    await live.restartRoom('ABC123', 4242);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('/rooms/ABC123.json');
    expect(calls[0].body).toEqual({ seed: 4242, picks: null, started: false });
  });

  /* The seats stay. Restarting is re-running this draft with these people, not
   * emptying the room and asking everybody to sit down again. */
  it('and leaves everybody in their chairs', async () => {
    const live = await load();
    await live.restartRoom('ABC123', 9);
    expect(Object.keys(calls[0].body as object)).not.toContain('seats');
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

/**
 * Every clip has a card.
 *
 * The screen has to agree with the speaker, and the way that breaks is a clip
 * added to the rotation with nothing drawn for it — the room would shout and
 * show nothing, or worse, show the last character while playing a new one.
 */
describe('the brainrot cards', () => {
  it('covers every clip the room can play', () => {
    CLIP_NAMES.forEach(name => {
      const look = LOOKS[name];
      expect(look, name + ' has no card').toBeTruthy();
      expect(look.label.length, name + ' has no name on it').toBeGreaterThan(2);
      expect(look.mark.length, name + ' has no mark').toBeGreaterThan(0);
      expect(look.tint).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('gives each one its own colour, or they all read the same', () => {
    const tints = CLIP_NAMES.map(n => LOOKS[n].tint.toLowerCase());
    expect(new Set(tints).size).toBe(tints.length);
  });

  /* Two clips can land back to back — both of your picks at a turn — and an
   * entrance nobody sees is a card that appears out of nowhere. */
  it('names an entrance for each', () => {
    const moves = new Set(CLIP_NAMES.map(n => LOOKS[n].move));
    CLIP_NAMES.forEach(n => expect(LOOKS[n].move).toBeTruthy());
    expect(moves.size).toBeGreaterThan(3);
  });
});

/**
 * A photo the whole league can set is a photo anybody in it can set, and what
 * comes back goes straight into an `img src`. That makes the read the boundary.
 */
describe('photos the league shares', () => {
  const ok = 'data:image/jpeg;base64,abc';

  it('keeps an inline image and normalises what came with it', () => {
    expect(keepPhotos({ '4046': { data: ok, at: 12, by: 'jorge' } }))
      .toEqual({ '4046': { data: ok, at: 12, by: 'jorge' } });
    // A row with the bookkeeping missing is still a photo.
    expect(keepPhotos({ x: { data: ok } })).toEqual({ x: { data: ok, at: 0, by: '' } });
  });

  it('refuses anything that is not an inline image', () => {
    // Both of these are perfectly good `src` values and neither is a photo.
    expect(keepPhotos({ a: { data: 'javascript:alert(1)' } })).toEqual({});
    expect(keepPhotos({ a: { data: 'https://example.com/x.png' } })).toEqual({});
    expect(keepPhotos({ a: { data: 42 } })).toEqual({});
    expect(keepPhotos({ a: null })).toEqual({});
  });

  it('drops one too big to be a thumbnail', () => {
    const huge = 'data:image/jpeg;base64,' + 'a'.repeat(PHOTO_MAX_BYTES);
    expect(keepPhotos({ a: { data: huge } })).toEqual({});
  });

  it('has nothing to say about a payload that never arrived', () => {
    expect(keepPhotos(null)).toEqual({});
    expect(keepPhotos('nope')).toEqual({});
  });
});

/* ── Signing in with Google ──────────────────────────────────────────────────
   The two things worth pinning down are the ones that are silent when wrong:
   a session read out of the wrong field shape, and a token sent after it has
   stopped being accepted. Both fail at the database, two screens away from the
   code that caused them. */
describe('a Google session', () => {
  const IDP = {
    localId: 'u-123', idToken: 'short', refreshToken: 'long', expiresIn: '3600',
    email: 'someone@example.com', displayName: 'Someone',
  };
  /* The refresh endpoint answers in snake_case where the sign-in answers in
     camelCase — the same session, spelled two ways, which is exactly the kind
     of thing a second near-identical parser gets wrong a year later. */
  const REFRESHED = {
    user_id: 'u-123', id_token: 'short2', refresh_token: 'long2', expires_in: '3600',
  };

  it('reads the shape the sign-in answers with', () => {
    expect(sessionFrom(IDP, 1_000)).toEqual({
      uid: 'u-123', idToken: 'short', refreshToken: 'long', expiresAt: 1_000 + 3_600_000,
    });
  });

  it('reads the shape the refresh answers with', () => {
    expect(sessionFrom(REFRESHED, 1_000)).toEqual({
      uid: 'u-123', idToken: 'short2', refreshToken: 'long2', expiresAt: 1_000 + 3_600_000,
    });
  });

  /* Google tells the app the person's email and name. Neither is wanted and
     neither is kept: a session is an id and two tokens. */
  it('keeps nothing about the person beyond an id', () => {
    const s = sessionFrom(IDP, 0) as unknown as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(['expiresAt', 'idToken', 'refreshToken', 'uid']);
    expect(JSON.stringify(s)).not.toContain('example.com');
    expect(JSON.stringify(s)).not.toContain('Someone');
  });

  it('refuses a half-answer rather than building a session out of it', () => {
    expect(sessionFrom({ ...IDP, refreshToken: '' }, 0)).toBeNull();
    expect(sessionFrom({ ...IDP, localId: undefined }, 0)).toBeNull();
    expect(sessionFrom(null, 0)).toBeNull();
    expect(sessionFrom('nope', 0)).toBeNull();
  });

  /* A lifetime that cannot be read is treated as none. Refreshing early costs
     one request; refreshing late costs a database call that fails for no
     reason the screen can explain. */
  it('treats an unreadable lifetime as already expired', () => {
    const s = sessionFrom({ ...IDP, expiresIn: 'soon' }, 5_000);
    expect(s?.expiresAt).toBe(5_000);
    expect(stale(s, 5_000)).toBe(true);
  });

  it('calls a token stale a minute before it really goes, and not after', () => {
    const s = sessionFrom(IDP, 0) as NonNullable<ReturnType<typeof sessionFrom>>;
    expect(stale(s, 0)).toBe(false);
    expect(stale(s, 3_600_000 - 61_000)).toBe(false);
    // the clock on the other end is not this one's
    expect(stale(s, 3_600_000 - 60_000)).toBe(true);
    expect(stale(s, 3_600_000)).toBe(true);
  });

  it('has nothing to send when nobody is signed in', () => {
    expect(stale(null, 0)).toBe(true);
  });
});
