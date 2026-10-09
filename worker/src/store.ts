/**
 * What the worker remembers between ticks, and the shape of the box it keeps
 * it in.
 *
 * The Cloudflare types are declared here rather than pulled in as a package so
 * the worker compiles and tests inside the app's own toolchain — one
 * `npm test`, one `tsc`, no second build to forget about. Only the four
 * methods used are described; if a fifth is ever wanted, the real types are
 * one dependency away.
 */

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface Env {
  COPILOT: KV;
  /** the Realtime Database the league chat lives in, for verifying a message */
  RTDB_URL?: string;
  /** mailto: or https: a push service can use to reach a human */
  VAPID_SUBJECT?: string;
  /** the app's origin, for CORS. Absent allows any, which is the default */
  ALLOW_ORIGIN?: string;
}

/** One phone, and the league it is watching. */
export interface Watcher {
  /** the account id in the chat's database, so a message never notifies the
   *  person who wrote it */
  uid?: string;
  /** the Sleeper username, which is what an @tag spells */
  user?: string;
  /** wants chat messages at all */
  chat?: boolean;
  /** wants only the messages that name them */
  tagsOnly?: boolean;
  sub: { endpoint: string; keys: { p256dh: string; auth: string } };
  leagueId: string;
  /** Sleeper user id, which is how a roster is found in the league */
  userId: string;
  /** player id → how to name him on a lock screen */
  names: Record<string, { n: string; p?: string; t?: string }>;
  at: number;
}

/* A subscription endpoint is long, and some of them carry characters a key
   cannot. The digest is stable, so re-subscribing the same phone overwrites
   rather than accumulating a second copy of it. */
export async function subKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  const bytes = new Uint8Array(digest).slice(0, 16);
  return 'sub:' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * How many phones this worker will hold.
 *
 * The endpoint is open to the internet, and a free key-value store has a
 * thousand writes in it per day. Without a ceiling, one script fills it in an
 * afternoon and the real subscribers stop being written. A league is twelve
 * people with a phone each.
 */
export const MAX_WATCHERS = 200;

export async function listWatchers(kv: KV): Promise<{ key: string; w: Watcher }[]> {
  const out: { key: string; w: Watcher }[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try {
        out.push({ key: k.name, w: JSON.parse(raw) as Watcher });
      } catch {
        /* a value that will not parse is a value that cannot be used; the
           next subscribe from that phone replaces it */
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** Where a week's touchdown tally lives. One key for everybody: the box score
 *  is the same box score whoever is reading it. */
export const tallyKey = (season: string, week: number) => 'tds:' + season + ':' + week;

/**
 * Whether a body is a subscription rather than something else posted at the
 * endpoint. The keys are fixed lengths — a P-256 point is 65 bytes and an auth
 * secret is 16 — and anything else will fail deep inside the cipher later,
 * where there is nobody to tell.
 */
export function validWatcher(body: unknown): body is Omit<Watcher, 'at'> {
  const b = body as Watcher | null;
  if (!b || typeof b !== 'object') return false;
  const s = b.sub;
  if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint)) return false;
  if (!s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return false;
  // base64url of 65 and 16 bytes, unpadded.
  if (!/^[A-Za-z0-9_-]{86,88}$/.test(s.keys.p256dh)) return false;
  if (!/^[A-Za-z0-9_-]{22,24}$/.test(s.keys.auth)) return false;
  if (typeof b.leagueId !== 'string' || !/^[0-9]{5,25}$/.test(b.leagueId)) return false;
  if (typeof b.userId !== 'string' || !/^[0-9]{5,25}$/.test(b.userId)) return false;
  if (b.names && typeof b.names !== 'object') return false;
  return true;
}

/**
 * The fields a phone may change after it has subscribed, cleaned.
 *
 * Taken from the body rather than merged wholesale: a subscribe is a public
 * endpoint, and letting it write arbitrary keys into a stored record is how a
 * store full of carefully bounded values acquires one that is not.
 */
export function chatPrefsOf(body: unknown): Pick<Watcher, 'uid' | 'user' | 'chat' | 'tagsOnly'> {
  const b = (body || {}) as Record<string, unknown>;
  return {
    ...(typeof b.uid === 'string' && b.uid.length <= 128 ? { uid: b.uid } : {}),
    ...(typeof b.user === 'string' && b.user.length <= 40 ? { user: b.user } : {}),
    chat: b.chat === true,
    tagsOnly: b.tagsOnly === true,
  };
}
