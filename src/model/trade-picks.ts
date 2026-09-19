import type { Pos } from '../api/types';

/**
 * Which of a team's assets actually make sense to move, and why.
 *
 * A list of forty names sorted by price is not help: the expensive ones are
 * the ones you cannot afford to give, and the cheap ones are the ones nobody
 * wants. What decides a trade is the pair of questions the price cannot
 * answer — can this team spare him, and does the other one need him.
 */

export type PickTag = 'fills' | 'surplus' | 'core' | null;

export interface PickRead {
  tag: PickTag;
  /** Ordered best-to-move first; ties fall back to value at the call site. */
  score: number;
  /** Said in the team's own terms, never as a generic label. */
  why: string;
}

export interface PickInput {
  pos: Pos | string;
  /** Where he sits among his own team's players at that position, 1 = best. */
  depth: number;
  /** How many the league actually starts at the position. */
  startsAt: number;
  /** League place of the SENDING team at that position, 1 = best. */
  senderRank: number;
  /** League place of the RECEIVING team at that position. */
  receiverRank: number;
  teamCount: number;
}

/** Bottom third of the league at a position is a hole worth trading for. */
const isWeak = (rank: number, teams: number) => rank > Math.ceil((teams * 2) / 3);
/** Top half is depth you can sell from. */
const isDeep = (rank: number, teams: number) => rank <= Math.ceil(teams / 2);

export function readPick(p: PickInput): PickRead {
  const spare = p.depth > p.startsAt;
  const weakThere = isWeak(p.senderRank, p.teamCount);
  const deepThere = isDeep(p.senderRank, p.teamCount);
  const theyNeed = isWeak(p.receiverRank, p.teamCount);

  // A starter at a position the team is already thin at. Moving him is how a
  // trade that looked fine on value loses the season, so it is said first.
  if (!spare && weakThere) {
    return {
      tag: 'core',
      score: -2,
      why: 'Starts, and they are thin at ' + p.pos + ' — hard to replace',
    };
  }

  // The best piece there is: one team cannot use him, the other cannot field
  // the position.
  if (spare && theyNeed) {
    return {
      tag: 'surplus',
      score: 3,
      why: 'Spare at ' + p.pos + ' here, and a hole there',
    };
  }

  if (theyNeed) {
    return { tag: 'fills', score: 2, why: 'Fills their hole at ' + p.pos };
  }

  if (spare && deepThere) {
    return { tag: 'surplus', score: 1, why: 'Behind their starters at ' + p.pos };
  }

  return { tag: null, score: 0, why: '' };
}

/**
 * How many of a position the league starts.
 *
 * A flex is counted as half a slot at each position it accepts: a team with a
 * flex does start one more runner some weeks, and pretending otherwise calls
 * every third back a spare when he is not.
 */
export function startsAt(rosterPositions: string[] | null | undefined, pos: string): number {
  let n = 0;
  for (const slot of rosterPositions || []) {
    if (slot === pos) n += 1;
    else if (slot === 'FLEX' && (pos === 'RB' || pos === 'WR' || pos === 'TE')) n += 0.5;
    else if (slot === 'SUPER_FLEX' && pos === 'QB') n += 0.5;
  }
  return Math.max(1, Math.round(n));
}

/** Depth chart position by value, 1 = the team's best at that spot. */
export function depthOf<T extends { pos: string; q: number }>(list: T[], player: T): number {
  return list.filter(x => x.pos === player.pos && x.q > player.q).length + 1;
}
