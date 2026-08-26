import type {
  LeagueBundle, PlayerCatalog, SleeperDraft, SleeperLeague, SleeperPick,
  SleeperRoster, SleeperStatLine, SleeperTradedPick, SleeperUser,
} from './types';

const API = 'https://api.sleeper.app/v1';

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(path.split('/')[1] + ' ' + r.status);
  return r.json() as Promise<T>;
}

/** The NFL catalog is several MB, so it is fetched once per session and kept
 *  in module memory — every league view reads the same copy. */
let catalog: PlayerCatalog | null = null;

export async function loadPlayerCatalog(): Promise<PlayerCatalog> {
  if (catalog) return catalog;
  catalog = await get<PlayerCatalog>('/players/nfl');
  return catalog;
}

/**
 * Sleeper publishes every image twice: a thumbnail around 100px, and the full
 * upload. A phone is a 3× screen, so a 34px avatar needs 102 real pixels and a
 * 64px portrait needs 192 — the thumbnail is already being stretched at the
 * smaller size and visibly upscaled at the larger. Avatars are small files and
 * there are only a handful on screen, so they come full size.
 */
export function avatarUrl(a: string | null | undefined): string | null {
  // Sleeper stores an uploaded team logo as a full URL in metadata, and an
  // account avatar as a bare hash. Both reach us through the same field.
  if (!a) return null;
  return /^https?:/.test(a) ? a : 'https://sleepercdn.com/avatars/' + a;
}

export function leagueAvatar(a: string | null | undefined): string | null {
  return a ? 'https://sleepercdn.com/avatars/' + a : null;
}

/**
 * Player portraits are the heavy ones, so this stays a choice: the thumbnail
 * for a 34px roster row, where dozens load at once and 100px is enough for the
 * 102 the row actually needs, and the full image for the 64px one on the sheet,
 * where there is exactly one and the thumbnail is stretched to twice its size.
 */
export const playerPhoto = (id: string, size: 'thumb' | 'full' = 'thumb'): string | null =>
  /^\d+$/.test(String(id))
    ? 'https://sleepercdn.com/content/nfl/players/' + (size === 'full' ? '' : 'thumb/') + id + '.jpg'
    : null;

export async function findUser(name: string): Promise<SleeperUser> {
  const user = await get<SleeperUser | null>('/user/' + encodeURIComponent(name));
  if (!user || !user.user_id) throw new Error('nouser');
  return user;
}

export async function currentSeason(): Promise<string> {
  try {
    const st = await get<{ season?: string }>('/state/nfl');
    if (st && st.season) return String(st.season);
  } catch {
    /* fall through to the calendar year */
  }
  return String(new Date().getFullYear());
}

export async function userLeagues(userId: string): Promise<SleeperLeague[]> {
  const season = await currentSeason();
  let leagues = await get<SleeperLeague[]>('/user/' + userId + '/leagues/nfl/' + season);
  // A brand-new season has no leagues until managers roll over; fall back a year.
  if (!leagues.length) leagues = await get<SleeperLeague[]>('/user/' + userId + '/leagues/nfl/' + (Number(season) - 1));
  if (!leagues.length) throw new Error('noleagues');
  return leagues;
}

export const getRosters = (lid: string) => get<SleeperRoster[]>('/league/' + lid + '/rosters');
export const getUsers = (lid: string) => get<SleeperUser[]>('/league/' + lid + '/users');
export const getTradedPicks = (lid: string) => get<SleeperTradedPick[]>('/league/' + lid + '/traded_picks');
export const getDraftPicks = (draftId: string) => get<SleeperPick[]>('/draft/' + draftId + '/picks');
export const getSeasonStats = (year: number) =>
  get<Record<string, SleeperStatLine>>('/stats/nfl/regular/' + year);

/**
 * Which manager in this league is the person signed in.
 *
 * It used to fall back to `users[0]` when the username matched nobody, which
 * quietly signed you in AS another manager: their name in the header, their
 * roster as "your team", their holes, their trades. A wrong answer delivered
 * confidently is worse than no answer, and this is one the app cannot detect
 * afterwards — the data all looks valid.
 *
 * So: no match, no identity. The empty `user_id` matches no roster, which the
 * app reads as "we could not find your team" and offers you the picker.
 */
export function matchMe(users: SleeperUser[], username: string): SleeperUser {
  const name = (username || '').toLowerCase();
  const hit = users.find(u => (u.display_name || '').toLowerCase() === name);
  return hit || { user_id: '', display_name: username, avatar: null, metadata: null };
}

/** One pass over everything a league view needs. `onStep` drives the boot log. */
export async function loadLeague(
  leagueId: string,
  username: string,
  onStep: (step: number) => void,
): Promise<LeagueBundle> {
  const league = await get<SleeperLeague>('/league/' + leagueId);
  onStep(1);
  const users = await getUsers(leagueId);
  const rosters = await getRosters(leagueId).catch(() => [] as SleeperRoster[]);
  onStep(2);
  const drafts = await get<SleeperDraft[]>('/league/' + leagueId + '/drafts').catch(() => [] as SleeperDraft[]);
  const draft = drafts && drafts.length ? await get<SleeperDraft>('/draft/' + drafts[0].draft_id) : null;
  const picks = draft ? await getDraftPicks(draft.draft_id).catch(() => [] as SleeperPick[]) : [];
  const traded = await getTradedPicks(leagueId).catch(() => [] as SleeperTradedPick[]);
  onStep(3);
  const players = await loadPlayerCatalog();
  onStep(4);
  return { league, users, rosters, draft, picks, traded, me: matchMe(users, username), players };
}
