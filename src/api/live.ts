/**
 * The shared draft room.
 *
 * A mock draft is already a pure function of three things — the league, the
 * seed, and the map of "pick N went to player X". Two people who agree on
 * those three see the same draft down to the bot picks. So a room does not
 * need to stream a board or a timer or a player list: it needs to hold one
 * small JSON document and tell everybody the moment it changes.
 *
 * That is exactly what Firebase's Realtime Database does over plain HTTP, and
 * it is why there is no SDK here. The official client is larger than this
 * entire application; a room is four fetches and an EventSource, and those are
 * built into the browser. Nothing new ships to the phone.
 *
 * With no database configured every export below is inert and the app keeps the
 * solo mock it has always had — the feature is off, not broken.
 */

/** The whole of a room, as it sits in the database. */
export interface Room {
  /** the mock's seed: everyone drafting the same board agrees on this */
  seed: number;
  leagueId: string;
  /** who opened it, so exactly one client runs the bots */
  host: string;
  /** seat number → the person sitting in it */
  seats: Record<string, { id: string; name: string }>;
  /** overall pick → player id. This IS the mock's `choices` map. */
  picks: Record<string, string>;
  /**
   * Nobody drafts until this is set.
   *
   * Without it the person who opened the room starts drafting alone: the seats
   * their friends have not claimed yet are still bots, so the bots take the
   * first picks and the friends arrive to a draft that already left without
   * them. One shared flag means the room waits for everyone to sit down.
   */
  started?: boolean;
}

export const EMPTY_ROOM = (seed: number, leagueId: string, host: string): Room => ({
  seed, leagueId, host, seats: {}, picks: {}, started: false,
});

/**
 * Where the rooms live. Absent in a normal checkout, which is the point: the
 * repository is public and carries no database of mine or anyone else's.
 * See README — "Drafting together" — for the two minutes of setup.
 */
export const LIVE_URL: string = (import.meta.env?.VITE_RTDB_URL || '').replace(/\/+$/, '');
export const liveEnabled = () => !!LIVE_URL;

/** How often to re-read when the stream is not available. */
const POLL_MS = 4000;

const roomPath = (id: string) => LIVE_URL + '/rooms/' + encodeURIComponent(id) + '.json';

/** Six characters a person can read down a phone line. No l/1/O/0. */
export function newRoomId(): string {
  const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const buf = new Uint32Array(6);
  (globalThis.crypto || ({} as Crypto)).getRandomValues?.(buf);
  for (let i = 0; i < 6; i++) {
    out += ABC[(buf[i] || Math.floor(Math.random() * 1e9)) % ABC.length];
  }
  return out;
}

async function send(url: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error('live ' + res.status);
  return res.status === 204 ? null : res.json();
}

export async function createRoom(id: string, room: Room): Promise<void> {
  await send(roomPath(id), 'PUT', room);
}

export async function readRoom(id: string): Promise<Room | null> {
  const r = (await send(roomPath(id), 'GET')) as Room | null;
  if (!r || typeof r.seed !== 'number') return null;
  return { ...r, seats: r.seats || {}, picks: r.picks || {} };
}

/** Sit down. A PATCH so two people claiming different seats never collide. */
export async function claimSeat(id: string, slot: number, who: { id: string; name: string }) {
  await send(LIVE_URL + '/rooms/' + encodeURIComponent(id) + '/seats.json', 'PATCH', { [slot]: who });
}

/**
 * Make a pick.
 *
 * Keyed by the overall pick number rather than appended to a list, so the same
 * pick sent twice — a flaky connection, a double tap — is one entry and not
 * two, and the map that comes back is already the shape the mock replays from.
 */
export async function pushPick(id: string, overall: number, playerId: string) {
  await send(LIVE_URL + '/rooms/' + encodeURIComponent(id) + '/picks.json', 'PATCH', {
    [overall]: playerId,
  });
}

/** Let the draft begin, for everyone at once. */
export async function startRoom(id: string) {
  await send(LIVE_URL + '/rooms/' + encodeURIComponent(id) + '.json', 'PATCH', { started: true });
}

/**
 * Follow a room until you stop.
 *
 * The database streams server-sent events: a `put` carrying the whole room on
 * connect, then a `patch` or `put` per change, each naming the path that moved.
 * Rather than apply those deltas by hand — where one missed shape is a draft
 * that quietly disagrees between two phones — this re-reads the room on any
 * change. A room is a few hundred bytes and a draft is a pick every several
 * seconds; correctness is worth more than the bytes here.
 *
 * Returns the function that stops it.
 */
export function watchRoom(id: string, onRoom: (r: Room) => void, onError?: () => void): () => void {
  if (!LIVE_URL) return () => {};
  let stopped = false;
  let es: EventSource | null = null;
  let timer: number | undefined;

  const pull = async () => {
    try {
      const r = await readRoom(id);
      if (r && !stopped) onRoom(r);
    } catch {
      if (!stopped) onError?.();
    }
  };

  const poll = (on: boolean) => {
    if (on && !timer && !stopped) timer = window.setInterval(() => void pull(), POLL_MS);
    if (!on && timer) { window.clearInterval(timer); timer = undefined; }
  };

  const open = () => {
    if (stopped || es || typeof EventSource === 'undefined') { poll(!stopped); return; }
    try {
      es = new EventSource(roomPath(id));
      const bump = () => { if (!stopped) void pull(); };
      es.addEventListener('put', bump);
      es.addEventListener('patch', bump);
      // A working stream makes the poll redundant. Without this line one
      // dropped packet started a timer that then ran beside the recovered
      // stream for the rest of the session, doubling the traffic for nothing.
      es.onopen = () => poll(false);
      es.onerror = () => poll(true);
    } catch {
      poll(true);
    }
  };

  const close = () => { es?.close(); es = null; poll(false); };

  /* A phone in a pocket does not need the draft. A room left open overnight
   * would otherwise poll around twenty thousand times with nobody watching,
   * which is somebody's free quota spent on a locked screen. */
  const onVisible = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') close();
    else { open(); void pull(); }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

  open();
  void pull();
  return () => {
    stopped = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    close();
  };
}

/**
 * Prove the database is really there, from the phone that will use it.
 *
 * Setting this up has three steps that can each fail silently and look
 * identical from the outside — the app just has no room button, or has one
 * that does nothing:
 *
 *  · the URL never reached the build, because a repository variable is read
 *    when the site is COMPILED and adding one does not rebuild anything;
 *  · the URL is there but wrong, or the database was deleted;
 *  · the database is there but still in locked mode, so every write is
 *    refused — the commonest of the three by a distance, because "locked" is
 *    what the console tells you to start with.
 *
 * A real round trip separates them: write a room, read it back, delete it.
 * Nothing else can tell them apart, and guessing between them is how an
 * evening disappears.
 */
export type LiveCheck =
  | { ok: true; ms: number; streamed: boolean }
  | { ok: false; why: 'unset' | 'rules' | 'unreachable' | 'mismatch'; detail: string };

export async function checkLive(): Promise<LiveCheck> {
  if (!LIVE_URL) {
    return {
      ok: false,
      why: 'unset',
      detail: 'No database URL in this build. A repository variable is read when the '
        + 'site is compiled, so adding one does not rebuild it — run the deploy again '
        + '(Actions → Deploy to GitHub Pages → Run workflow).',
    };
  }
  const id = '_check_' + newRoomId();
  const seed = Math.floor(Math.random() * 1e9);
  const started = Date.now();
  try {
    /* A whole room, not the two fields the README's rule happens to ask for.
     * A probe that writes less than the real thing passes rules the real thing
     * would fail — which is the one way a connection check can lie, and the
     * worst way, because it lies in the reassuring direction. */
    const probe: Room = {
      seed,
      leagueId: 'connection-check',
      host: 'check',
      seats: { 1: { id: 'check', name: 'check' } },
      picks: { 1: 'check' },
      started: false,
    };
    await send(roomPath(id), 'PUT', probe);
    const back = (await send(roomPath(id), 'GET')) as { seed?: number } | null;
    await send(roomPath(id), 'DELETE').catch(() => undefined);
    if (!back || back.seed !== seed) {
      return {
        ok: false,
        why: 'mismatch',
        detail: 'The database accepted a write and then handed back something else. '
          + 'Check that the URL points at YOUR database and not another project.',
      };
    }
    return { ok: true, ms: Date.now() - started, streamed: await canStream(id) };
  } catch (e) {
    const msg = String((e as Error).message || e);
    /* 401 is the rules, and it is worth saying so outright: it is the one
     * failure whose fix is a paste into a box the person has already seen. */
    if (/40[13]/.test(msg)) {
      return {
        ok: false,
        why: 'rules',
        detail: 'The database refused the write. It is still in locked mode — open '
          + 'Realtime Database → Rules in the Firebase console and paste the rules '
          + 'from the README, then Publish.',
      };
    }
    return {
      ok: false,
      why: 'unreachable',
      detail: 'Could not reach the database at all (' + msg + '). Check the URL, and '
        + 'that the database has not been deleted.',
    };
  }
}

/** Whether the live stream opens, as opposed to falling back to polling. It
 *  still works either way — this is the difference between instant and every
 *  four seconds, and between a little traffic and twenty times as much. */
function canStream(id: string): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof EventSource === 'undefined') { resolve(false); return; }
    let es: EventSource | null = null;
    const done = (v: boolean) => { es?.close(); clearTimeout(t); resolve(v); };
    const t = setTimeout(() => done(false), 4000);
    try {
      es = new EventSource(roomPath(id));
      es.onopen = () => done(true);
      es.onerror = () => done(false);
    } catch {
      done(false);
    }
  });
}
