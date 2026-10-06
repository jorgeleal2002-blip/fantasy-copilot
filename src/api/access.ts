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

/** What this build is missing for invites, for the owner's setup card. */
export const accessMissing = (): string[] => [
  ...(liveEnabled() ? [] : ['VITE_RTDB_URL']),
  ...(FIREBASE_KEY ? [] : ['VITE_FIREBASE_KEY']),
];

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
  if (!res.ok) {
    // Firebase says why in the body; the one worth telling apart is
    // anonymous sign-in being switched off, which only the owner can fix.
    const why = await res.text().catch(() => '');
    throw new Error(/ADMIN_ONLY_OPERATION|OPERATION_NOT_ALLOWED/.test(why) ? 'anonymous-off' : 'signup ' + res.status);
  }
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
  if (inv.usedBy) {
    // Every device on that account, not only the one that spent the code.
    const all = await get<Record<string, { account?: string }>>('members', s).catch(() => null);
    const devices = Object.entries(all || {})
      .filter(([uid, m]) => uid === inv.usedBy || m?.account === inv.usedBy).map(([uid]) => uid);
    for (const uid of devices.length ? devices : [inv.usedBy]) {
      if (!(await write('DELETE', 'members/' + uid, s))) return false;
    }
  }
  return write('DELETE', 'invites/' + inv.code, s);
}

/* ── Who comes in, and who tried to.
 *
 * Each launch of a phone that is let in stamps its member record with when,
 * how many times so far, and the Sleeper username it is using — so the owner
 * sees who actually opens the app and who was invited and never did. A code
 * that is refused is written down too. Nothing else is: no location, no
 * device, no name beyond the Sleeper username already public on Sleeper. */

/** Stamp this launch. Never throws: a log that fails costs nobody anything. */
export async function touch(username: string, count: boolean): Promise<void> {
  try {
    const s = await session();
    await write('PATCH', 'members/' + s.uid, s, {
      seen: { '.sv': 'timestamp' },
      ...(count ? { opens: { '.sv': { increment: 1 } } } : {}),
      ...(username ? { user: username.slice(0, 40) } : {}),
    });
  } catch { /* offline, or rules not updated: skip */ }
}

/** A code somebody typed that did not let them in. Never throws. */
export async function logAttempt(code: string): Promise<void> {
  try {
    const s = await session();
    await fetch(LIVE_URL + '/attempts.json?auth=' + encodeURIComponent(s.idToken), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.slice(0, 16), uid: s.uid, at: { '.sv': 'timestamp' } }),
    });
  } catch { /* nothing to do */ }
}

export interface Member {
  uid: string;
  code?: string;
  /** the first device of the account, on a device added with a link code */
  account?: string;
  /** when the code was spent */
  at?: number;
  seen?: number;
  opens?: number;
  user?: string;
}
export interface Attempt { id: string; code: string; uid: string; at: number }

export async function listMembers(): Promise<Member[]> {
  const s = await session();
  const all = await get<Record<string, Omit<Member, 'uid'>>>('members', s);
  return Object.entries(all || {}).map(([uid, v]) => ({ uid, ...v }));
}

export async function listAttempts(): Promise<Attempt[]> {
  const s = await session();
  const all = await get<Record<string, Omit<Attempt, 'id'>>>('attempts', s);
  return Object.entries(all || {}).map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

export async function clearAttempts(): Promise<boolean> {
  const s = await session();
  return write('DELETE', 'attempts', s);
}

/** This phone's own uid, for the owner to tell their own row apart. */
export async function myUid(): Promise<string> {
  return (await session()).uid;
}

/* ── One account, several devices.
 *
 * An invite lets one device in. The same person on a second phone, a tablet
 * or a laptop should not need a second invite, so a device already in can
 * make a short-lived link code: typed on the new device, it adds that device
 * to the same account. Each code works once and for fifteen minutes; the
 * database's rules check both. The owner sees the devices under the person,
 * and revoking the person shuts all of them out. A link code made on the
 * owner's device makes the new device the owner's too. */

export const LINK_MINUTES = 15;

/** This device's account: its own id, or the first device's if it was linked. */
async function accountOf(s: Session): Promise<{ account: string; code: string; owner: boolean }> {
  const owner = !!(await get<boolean>('admins/' + s.uid, s));
  const me = await get<{ account?: string; code?: string }>('members/' + s.uid, s);
  return { account: me?.account || s.uid, code: me?.code || (owner ? 'OWNER' : ''), owner };
}

/** A code another device can use to join this account, or null if refused. */
export async function createLink(code: string, username: string): Promise<{ code: string; exp: number } | null> {
  const s = await session();
  const a = await accountOf(s);
  if (!a.code) return null;
  const exp = Date.now() + LINK_MINUTES * 60 * 1000 - 5000;
  const ok = await write('PUT', 'links/' + code, s, {
    by: s.uid, account: a.account, code: a.code, owner: a.owner, exp,
    ...(username ? { user: username.slice(0, 40) } : {}),
  });
  return ok ? { code, exp } : null;
}

/**
 * Join an account with a link code. Returns the standing it gave and the
 * Sleeper username the other device was using, or null when the database
 * refused it — wrong, used, or expired.
 */
export async function redeemLink(code: string): Promise<{ owner: boolean; user: string } | null> {
  if (!/^[A-Z0-9]{4,16}$/.test(code)) return null;
  const s = await session();
  const link = await get<{ account: string; code: string; owner?: boolean; user?: string; exp: number }>('links/' + code, s)
    .catch(() => null);
  if (!link || !link.account) return null;
  const ok = await write('PATCH', '', s, {
    ['links/' + code + '/usedBy']: s.uid,
    ['members/' + s.uid]: { code: link.code, link: code, account: link.account, at: { '.sv': 'timestamp' } },
  });
  if (!ok) return null;
  // The owner's other devices are the owner too; the rules allow exactly that.
  const owner = !!link.owner && (await write('PUT', 'admins/' + s.uid, s, true));
  return { owner, user: link.user || '' };
}
