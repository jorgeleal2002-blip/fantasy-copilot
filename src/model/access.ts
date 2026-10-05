/**
 * The code that lets somebody into the app.
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

export function isUnlocked(hashes: string[] = ACCESS_HASHES): boolean {
  try {
    const held = localStorage.getItem(KEY);
    return !!held && hashes.includes(held);
  } catch {
    return false;
  }
}

export function rememberUnlock(hash: string): void {
  try { localStorage.setItem(KEY, hash); } catch { /* private mode: asked again next launch */ }
}
