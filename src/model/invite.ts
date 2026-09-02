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

/**
 * The alphabet a room code is drawn from, and how long one is.
 *
 * Every character that can be misread as another is left out — no I, L or 1,
 * no O or 0 — because a code's whole job is to survive being read out loud
 * across a room. `newRoomId` draws from exactly this set.
 */
export const ROOM_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_LEN = 6;

/** What somebody types, cleaned up: case, spaces and dashes are not the code. */
export const cleanRoomCode = (raw: string): string =>
  (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_LEN);

/**
 * Why what they typed cannot be a code, in a sentence they can act on.
 *
 * The look-alike characters are the whole point of the alphabet, so a typed I
 * or O is almost always a misread rather than a typo — and saying which
 * character is wrong is the difference between fixing it and giving up. Null
 * while the code is still being typed, and null when it is fine.
 */
export function roomCodeProblem(code: string): string | null {
  const bad = Array.from(new Set(code.split('').filter(c => ROOM_ABC.indexOf(c) < 0)));
  if (bad.length) {
    return 'No ' + bad.join(' or ') + ' in a room code — the characters that look '
      + 'like each other are left out. Try the one it resembles.';
  }
  return null;
}

/** Whether it is a whole, usable code rather than half of one. */
export const isRoomCode = (code: string): boolean =>
  code.length === ROOM_LEN && !roomCodeProblem(code);

export interface Invite {
  leagueId: string;
  seed: number;
  /** a seat to sit the guest in; omitted means their own seat in the league */
  seat: number | null;
  /** a shared room to walk into. Without one the link is the older kind: the
   *  same board, drafted alone. */
  room?: string | null;
}

const P_LEAGUE = 'mock';
const P_SEED = 'seed';
const P_SEAT = 'seat';
const P_ROOM = 'room';

/** The link to send. Built off the current document so it survives whatever
 *  path the app is deployed under — the Vite base is relative. */
export function inviteUrl(inv: Invite, base?: string): string {
  const href = base ?? (typeof window === 'undefined' ? '' : window.location.origin + window.location.pathname);
  const q = new URLSearchParams();
  q.set(P_LEAGUE, inv.leagueId);
  q.set(P_SEED, String(inv.seed));
  if (inv.seat != null) q.set(P_SEAT, String(inv.seat));
  if (inv.room) q.set(P_ROOM, inv.room);
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
  const room = (q.get(P_ROOM) || '').trim().toUpperCase();
  return {
    leagueId,
    seed: Math.floor(seed),
    seat: seat != null && Number.isFinite(seat) && seat >= 1 ? Math.floor(seat) : null,
    room: /^[A-Z0-9]{4,12}$/.test(room) ? room : null,
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
