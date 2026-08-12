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

export function avatarUrl(a: string | null | undefined): string | null {
  // Sleeper stores an uploaded team logo as a full URL in metadata, and an
  // account avatar as a bare hash. Both reach us through the same field.
  if (!a) return null;
  return /^https?:/.test(a) ? a : 'https://sleepercdn.com/avatars/thumbs/' + a;
}

export function leagueAvatar(a: string | null | undefined): string | null {
  return a ? 'https://sleepercdn.com/avatars/thumbs/' + a : null;
}

export const playerPhoto = (id: string): string | null =>
  /^\d+$/.test(String(id)) ? 'https://sleepercdn.com/content/nfl/players/thumb/' + id + '.jpg' : null;

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

export function matchMe(users: SleeperUser[], username: string): SleeperUser {
  const hit = users.find(u => (u.display_name || '').toLowerCase() === (username || '').toLowerCase());
  return hit || users[0];
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
