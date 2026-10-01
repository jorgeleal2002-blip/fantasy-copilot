import { LIVE_URL, liveEnabled } from './live';
import { googleEnabled, type Session } from './identity';

/**
 * The two strings that make a setup, kept against your Google account.
 *
 * Your Sleeper username and the league you had open. That is the whole of it:
 * everything else this app knows it reads back from Sleeper, so there is
 * nothing else worth carrying and nothing else worth storing about anybody.
 *
 * Not your email, and not your name. Google tells this app both and it keeps
 * neither — the only thing written down is an identifier Firebase made up, and
 * a username that is already public on Sleeper.
 *
 * It lives in the same database the draft rooms do, under a path only you can
 * read or write. THAT IS A RULE ON THE DATABASE, not a property of the path:
 * in a project whose rules are still open this subtree is readable by anybody
 * who asks for it. See the README — "Carrying your setup between phones" —
 * which has the four lines to paste.
 */
export interface Profile {
  username: string;
  leagueId: string;
  /** When it was last written, so two phones disagreeing resolve by recency. */
  at: number;
}

export const profileEnabled = () => googleEnabled() && liveEnabled();

const url = (s: Session) =>
  LIVE_URL + '/users/' + encodeURIComponent(s.uid) + '/profile.json?auth='
  + encodeURIComponent(s.idToken);

/** What this account was last set up as, or nothing. */
export async function readProfile(s: Session): Promise<Profile | null> {
  if (!profileEnabled()) return null;
  const res = await fetch(url(s));
  if (!res.ok) throw new Error('profile ' + res.status);
  const body = (await res.json()) as unknown;
  if (!body || typeof body !== 'object') return null;
  const p = body as Record<string, unknown>;
  // A half-written profile is no profile. Signing somebody into a league with
  // no username attached would put them on a screen with no way back.
  if (typeof p.username !== 'string' || !p.username) return null;
  if (typeof p.leagueId !== 'string' || !p.leagueId) return null;
  return {
    username: p.username,
    leagueId: p.leagueId,
    at: typeof p.at === 'number' ? p.at : 0,
  };
}

/**
 * Write it down, and never let it be the reason something fails.
 *
 * This is a convenience on top of a setup that already works from local
 * storage, so a database that is down, full or misconfigured must cost the
 * person nothing. It returns whether it managed, for a screen that wants to
 * say so, and throws at nobody.
 */
export async function writeProfile(s: Session, p: Omit<Profile, 'at'>): Promise<boolean> {
  if (!profileEnabled() || !p.username || !p.leagueId) return false;
  try {
    const res = await fetch(url(s), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...p, at: Date.now() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
