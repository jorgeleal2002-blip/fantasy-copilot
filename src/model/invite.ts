/**
 * Invite links for a mock draft.
 *
 * There is no server behind this app — it is a static bundle that reads
 * Sleeper's public API — so a room where everyone picks in turn, watching each
 * other, is not something it can host. What it CAN do is hand everyone the
 * identical draft: the mock is deterministic, a pure function of the league,
 * the seed and the seat, so two people opening the same link see the same board
 * and the same bot behaviour down to the pick. Each drafts it from their own
 * seat, and afterwards the teams are comparable because the conditions were.
 *
 * That distinction is worth keeping honest in the wording wherever this is
 * offered: same board, separate rooms — not a live draft.
 */

export interface Invite {
  leagueId: string;
  seed: number;
  /** a seat to sit the guest in; omitted means their own seat in the league */
  seat: number | null;
}

const P_LEAGUE = 'mock';
const P_SEED = 'seed';
const P_SEAT = 'seat';

/** The link to send. Built off the current document so it survives whatever
 *  path the app is deployed under — the Vite base is relative. */
export function inviteUrl(inv: Invite, base?: string): string {
  const href = base ?? (typeof window === 'undefined' ? '' : window.location.origin + window.location.pathname);
  const q = new URLSearchParams();
  q.set(P_LEAGUE, inv.leagueId);
  q.set(P_SEED, String(inv.seed));
  if (inv.seat != null) q.set(P_SEAT, String(inv.seat));
  return href + '?' + q.toString();
}

/** Reads an invite out of a query string. Returns null unless a league and a
 *  seed are both present and usable — half an invite is not one. */
export function parseInvite(search: string): Invite | null {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search || '');
  } catch {
    return null;
  }
  const leagueId = (q.get(P_LEAGUE) || '').trim();
  const seed = Number(q.get(P_SEED));
  if (!leagueId || !/^[0-9]+$/.test(leagueId)) return null;
  if (!Number.isFinite(seed) || seed <= 0) return null;
  const rawSeat = q.get(P_SEAT);
  const seat = rawSeat == null ? null : Number(rawSeat);
  return {
    leagueId,
    seed: Math.floor(seed),
    seat: seat != null && Number.isFinite(seat) && seat >= 1 ? Math.floor(seat) : null,
  };
}

/**
 * Take the invite out of the address bar once it has been acted on.
 *
 * Without this, every reload — and an installed PWA reloads on its own — drops
 * you back into the invited mock and throws away whatever you were doing.
 */
export function clearInvite(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  window.history.replaceState({}, '', window.location.pathname + window.location.hash);
}

/**
 * Hand the link to whatever the device has: the share sheet on a phone, the
 * clipboard on a desktop. Resolves with what actually happened so the caller
 * can say so rather than guessing.
 */
export async function shareInvite(url: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (e) {
      // A cancelled share sheet is not a failure, and must not fall through to
      // the clipboard — that would copy a link the user just declined to send.
      if ((e as Error)?.name === 'AbortError') return 'shared';
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}
