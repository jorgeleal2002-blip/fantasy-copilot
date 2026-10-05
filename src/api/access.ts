/**
 * Invite codes: one person each, handed out by the owner only.
 *
 * The site is static, so nothing in the browser can be trusted to say a code
 * is spent — that has to be the database. Each phone gets an anonymous
 * Firebase identity (no email, no name: an id Firebase makes up), and
 * redeeming a code is one write that marks the invite used by that id and
 * makes the id a member, in the same breath. The database's rules — in the
 * README, "Invite codes" — refuse that write for a code that does not exist
 * or is already used, and refuse creating codes to anybody but the owner.
 *
 * With no database or no Firebase key configured, `accessEnabled()` is false
 * and the app falls back to the single shared code in `model/access`.
 */
import { LIVE_URL, liveEnabled } from './live';
import { refresh, sessionFrom, stale, type Session } from './identity';

const FIREBASE_KEY: string = import.meta.env?.VITE_FIREBASE_KEY || '';
const SIGN_UP = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
const KEY = 'doctors-access-session';

export const accessEnabled = () => liveEnabled() && !!FIREBASE_KEY;

const load = (): Session | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch { return null; }
};
const save = (s: Session | null) => {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
};

/** This phone's identity, made the first time it is needed and kept fresh. */
export async function session(): Promise<Session> {
  const held = load();
  if (held && !stale(held, Date.now())) return held;
  if (held) {
    try {
      const s = await refresh(held.refreshToken);
      save(s);
      return s;
    } catch (e) {
      // Only a refusal means the identity is gone; a dropped connection does not.
      if (!/auth 4/.test(String((e as Error).message))) throw e;
    }
  }
  const res = await fetch(SIGN_UP + '?key=' + encodeURIComponent(FIREBASE_KEY), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw new Error('signup ' + res.status);
  const s = sessionFrom(await res.json(), Date.now());
  if (!s) throw new Error('signup shape');
  save(s);
  return s;
}

/** The uid this phone has, without making one. */
export const currentUid = () => load()?.uid ?? null;

const at = (path: string, s: Session) =>
  LIVE_URL + '/' + path + '.json?auth=' + encodeURIComponent(s.idToken);

async function get<T>(path: string, s: Session): Promise<T | null> {
  const res = await fetch(at(path, s));
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error('db ' + res.status);
  return (await res.json()) as T | null;
}

async function write(method: 'PUT' | 'PATCH' | 'DELETE', path: string, s: Session, body?: unknown): Promise<boolean> {
  const res = await fetch(at(path, s), {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw new Error('db ' + res.status);
  return true;
}

export type Standing = 'owner' | 'member' | 'none';

/** Whether this phone is let in. Throws when the database cannot be reached,
 *  so the caller can keep a phone that was already in, in. */
export async function standing(): Promise<Standing> {
  const s = await session();
  if (await get<boolean>('admins/' + s.uid, s)) return 'owner';
  if (await get<unknown>('members/' + s.uid, s)) return 'member';
  return 'none';
}

/**
 * Spend a code on this phone. False when the database refused it — the code
 * does not exist or somebody already used it; the rules do not say which.
 */
export async function redeem(code: string): Promise<boolean> {
  // A key in the database cannot hold '.', '/', '#' and friends; nothing
  // with them is a code anyway.
  if (!/^[A-Z0-9]{4,16}$/.test(code)) return false;
  const s = await session();
  return write('PATCH', '', s, {
    ['invites/' + code + '/usedBy']: s.uid,
    ['invites/' + code + '/usedAt']: { '.sv': 'timestamp' },
    ['members/' + s.uid]: { code, at: { '.sv': 'timestamp' } },
  });
}

/** Make this phone the owner. Only ever works once: the rules refuse it as
 *  soon as there is an owner. */
export async function claimOwner(): Promise<boolean> {
  const s = await session();
  return write('PUT', 'admins/' + s.uid, s, true);
}

export interface Invite {
  code: string;
  createdAt: number;
  usedBy?: string;
  usedAt?: number;
  /** a name the owner wrote down for whom it is for */
  note?: string;
}

export async function listInvites(): Promise<Invite[]> {
  const s = await session();
  const all = await get<Record<string, Omit<Invite, 'code'>>>('invites', s);
  return Object.entries(all || {})
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function createInvite(code: string, note: string): Promise<boolean> {
  const s = await session();
  return write('PUT', 'invites/' + code, s, {
    createdAt: { '.sv': 'timestamp' }, by: s.uid, ...(note ? { note } : {}),
  });
}

/** An unused code is withdrawn; a used one also shuts its phone out. */
export async function revokeInvite(inv: Invite): Promise<boolean> {
  const s = await session();
  if (inv.usedBy && !(await write('DELETE', 'members/' + inv.usedBy, s))) return false;
  return write('DELETE', 'invites/' + inv.code, s);
}
