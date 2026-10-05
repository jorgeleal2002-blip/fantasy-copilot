/**
 * The shared code, and the owner's setup code.
 *
 * With the database configured (see `api/access`) entry is by one-time invite
 * codes and this hash is only the OWNER's: typed on the gate, it makes that
 * phone the owner, once. Without a database it is the one code everybody
 * shares, as before.
 *
 * Only the SHA-256 of each code is in the source, so reading the bundle does
 * not hand the code out. It is a lock on the front door, not a vault: the
 * site is static and the data behind it is Sleeper's public API, so anyone
 * determined could still get around it. What it does stop is the link being
 * passed along and opened by whoever has it.
 *
 * To change the code, put the new one's hash here — `npm run access-code NEW`
 * prints it. Everybody who unlocked with the old one is asked again, because
 * the phone remembers which hash it opened with, not that it once opened.
 */
export const ACCESS_HASHES: string[] = [
  'a01dff19f61797b4906929ded3942ee7557a816aa7ad7d29668a4ffdd3b0f512',
];

const KEY = 'doctors-access';

/** Case, spaces and dashes do not matter: "n57 rg7" is "N57RG7". */
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[\s-]+/g, '');

export async function hashCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeCode(code));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The hash a code unlocks with, or null when it is not one of them. */
export async function checkCode(code: string, hashes: string[] = ACCESS_HASHES): Promise<string | null> {
  if (!normalizeCode(code)) return null;
  const h = await hashCode(code);
  return hashes.includes(h) ? h : null;
}

/**
 * Whether this phone was let in last time. With invites, what is remembered is
 * the standing the database gave it; without, the hash it opened with — so a
 * phone that opened with the shared code is asked again once invites start.
 */
export function isUnlocked(invites: boolean, hashes: string[] = ACCESS_HASHES): boolean {
  try {
    const held = localStorage.getItem(KEY);
    if (!held) return false;
    return invites ? held === 'member' || held === 'owner' : hashes.includes(held);
  } catch {
    return false;
  }
}

export function rememberUnlock(value: string): void {
  try { localStorage.setItem(KEY, value); } catch { /* private mode: asked again next launch */ }
}

export function forgetUnlock(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}

export const isOwnerHere = () => {
  try { return localStorage.getItem(KEY) === 'owner'; } catch { return false; }
};

/** No 0/O or 1/I/L: a code read out loud or off a screen survives the trip. */
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const cryptoRand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
export function makeCode(rand: () => number = cryptoRand, len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ABC[Math.floor(rand() * ABC.length) % ABC.length];
  return s;
}

/** Shown and shared in two halves, "ABCD-EFGH", which is easier to read back. */
export const prettyCode = (c: string) => (c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c);

export const inviteLink = (code: string, base: string) => {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('code', prettyCode(code));
  return u.toString();
};
