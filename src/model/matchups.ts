import type { SleeperMatchup } from '../api/types';

export interface MatchupSide {
  rosterId: number;
  name: string;
  avatar: string | null;
  /** Sleeper reports 0 before kickoff and null for a week it has no row for. */
  points: number | null;
  isMe: boolean;
}

export interface Matchup {
  id: number | null;
  a: MatchupSide;
  /** Absent on a bye — an odd league, or a week Sleeper only half-published. */
  b: MatchupSide | null;
  hasMe: boolean;
}

interface TeamLike {
  id: number;
  name: string;
  avatar: string | null;
  isMe: boolean;
}

/**
 * Turns Sleeper's flat list of roster-weeks into the head-to-heads it means.
 *
 * Two teams facing each other share a `matchup_id`; that is the whole of the
 * pairing Sleeper gives you. A roster with an id nobody else carries is on a
 * bye, and one with no id at all has not been scheduled — both are shown
 * rather than dropped, since a missing team reads as a bug in the app.
 *
 * Your own game comes first. It is the one being looked for, and in a
 * fourteen-team league it would otherwise sit anywhere in seven cards.
 */
export function pairMatchups(teams: TeamLike[], rows: SleeperMatchup[]): Matchup[] {
  const byRoster = new Map(teams.map(t => [t.id, t]));
  const side = (r: SleeperMatchup): MatchupSide | null => {
    const t = byRoster.get(r.roster_id);
    if (!t) return null; // a roster the league no longer lists
    return {
      rosterId: r.roster_id,
      name: t.name,
      avatar: t.avatar,
      points: r.points ?? null,
      isMe: t.isMe,
    };
  };

  // Grouped in the order Sleeper listed them, so an unscheduled roster keeps a
  // stable place instead of jumping around between refreshes.
  const groups = new Map<string, MatchupSide[]>();
  rows.forEach((r, i) => {
    const s = side(r);
    if (!s) return;
    const key = r.matchup_id == null ? 'solo:' + i : 'm:' + r.matchup_id;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  });

  const out: Matchup[] = [];
  for (const [key, sides] of groups) {
    const id = key.startsWith('m:') ? Number(key.slice(2)) : null;
    // You on the left, the way you read your own game.
    const ordered = sides.slice().sort((x, y) => Number(y.isMe) - Number(x.isMe));
    // A group larger than two is not a thing Sleeper produces, but if it ever
    // did, splitting it keeps every team on screen.
    for (let i = 0; i < ordered.length; i += 2) {
      const a = ordered[i];
      const b = ordered[i + 1] ?? null;
      out.push({ id, a, b, hasMe: a.isMe || !!b?.isMe });
    }
  }

  return out.sort((x, y) => Number(y.hasMe) - Number(x.hasMe));
}

/** Who is ahead, once there is anything to be ahead by. */
export function leaderOf(m: Matchup): 'a' | 'b' | null {
  const a = m.a.points;
  const b = m.b?.points;
  if (a == null || b == null || a === b) return null;
  return a > b ? 'a' : 'b';
}
