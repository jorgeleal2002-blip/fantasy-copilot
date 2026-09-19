import type { PlayerCatalog, SleeperMatchup } from '../api/types';

export interface MatchupSide {
  rosterId: number;
  name: string;
  avatar: string | null;
  /** Sleeper reports 0 before kickoff and null for a week it has no row for. */
  points: number | null;
  isMe: boolean;
  /** "7-3", or empty before a season has been played. */
  record: string;
  /** Who he started, in the league's own slot order. Absent for a week Sleeper
   *  has published a score for but not a lineup. */
  starters: string[] | null;
  /** Every player's points that week, starters and bench alike. */
  playerPoints: Record<string, number> | null;
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
  record?: { label: string; wins: number; losses: number; ties: number };
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
      // Before a game has been played, "0-0" under every name is a column of
      // noise pretending to be standings.
      record: t.record && (t.record.wins + t.record.losses + t.record.ties) > 0
        ? t.record.label
        : '',
      starters: r.starters ?? null,
      playerPoints: r.players_points ?? null,
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

/** Slots a lineup is actually made of. Sleeper's `starters` array lines up with
 *  `roster_positions` once the places nobody plays from are taken out. */
const NOT_STARTED = ['BN', 'IR', 'TAXI'];
export const startingSlots = (rosterPositions: string[] | null | undefined): string[] =>
  (rosterPositions || []).filter(p => NOT_STARTED.indexOf(p) < 0);

export interface LineupCell {
  /** null where the manager left the slot empty — Sleeper writes "0" there. */
  id: string | null;
  name: string;
  /** his real position, which is not the slot when he is in a flex */
  pos: string;
  team: string | null;
  points: number | null;
}

export interface LineupRow {
  slot: string;
  a: LineupCell | null;
  b: LineupCell | null;
}

/** "Christian McCaffrey" → "C. McCaffrey", because a scoreboard row is two
 *  names wide and a phone is not. The surname is what identifies him. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return parts[0][0] + '. ' + parts.slice(1).join(' ');
}

/**
 * The two lineups laid against each other, a row per slot.
 *
 * This is the shape a scoreboard is read in: not "here is his team and here is
 * hers" but "his quarterback against hers", because the question being asked of
 * the screen is where the game is being won. Sleeper gives the two lineups as
 * bare arrays in the league's slot order, so the pairing is by index.
 *
 * A side with no lineup published yet still gets its rows — with nothing in
 * them — rather than collapsing the column, so the slot labels stay where the
 * other side can be read against them.
 */
export function lineupRows(
  m: Matchup,
  rosterPositions: string[] | null | undefined,
  players: PlayerCatalog,
): LineupRow[] {
  const slots = startingSlots(rosterPositions);
  const cell = (side: MatchupSide | null, i: number): LineupCell | null => {
    // Past the end of what Sleeper sent is not the same as an empty slot: one
    // means he did not start anybody there, the other that the week has no
    // lineup published at all. Drawing the second as the first invented a
    // column of "Empty" down every card before kickoff.
    if (!side || !side.starters || i >= side.starters.length) return null;
    const id = side.starters[i];
    // Sleeper writes "0" for a slot the manager never filled, and an empty
    // slot is a fact worth showing: it is where the week was lost.
    if (!id || id === '0') return { id: null, name: 'Empty', pos: '', team: null, points: null };
    const p = players[id];
    const full = p ? (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim()) : '';
    return {
      id,
      name: full ? shortName(full) : 'Unknown',
      pos: p?.position || '',
      team: p?.team || null,
      points: side.playerPoints?.[id] ?? null,
    };
  };

  // As deep as the deeper of the two LINEUPS, never as deep as the slot list:
  // the slots only supply the labels, and a league that lists seven while
  // Sleeper has posted two would otherwise draw five rows of nothing. A league
  // can also publish more starters than it lists slots for — a mid-season rule
  // change does it — and dropping those would silently hide a started player,
  // so they keep their row under a generic label.
  const depth = Math.max(m.a.starters?.length || 0, m.b?.starters?.length || 0);

  const out: LineupRow[] = [];
  for (let i = 0; i < depth; i++) {
    const a = cell(m.a, i);
    const b = cell(m.b, i);
    if (!a && !b) continue;
    out.push({ slot: slots[i] || 'FLEX', a, b });
  }
  return out;
}
