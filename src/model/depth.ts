/**
 * Whether a team can afford what a trade takes, and whether what it gets is
 * any use to it.
 *
 * The scorecard priced a deal in value and in lineup points, and both are
 * right as far as they go. What neither says out loud is the shape of the
 * roster underneath: a side can come out level on points while being left with
 * exactly two backs and no cover, or while taking a fourth receiver it can
 * never start. The arithmetic already feels the second of those — an unusable
 * man adds nothing to a lineup — so the points say "even" and nothing says
 * why. This is the why.
 *
 * It changes no verdict. A position that cannot be fielded is already paid for
 * in lineup points, and a piece that cannot start already earns none; pricing
 * either a second time would charge one fault twice.
 */

import type { Pos } from '../api/types';

export type DepthState = 'short' | 'thin' | 'stacked';

export interface PosDepth {
  pos: Pos;
  /** bodies at this position once the trade is done */
  have: number;
  /** what the lineup has to field there, flex included */
  starts: number;
  state: DepthState;
}

/**
 * Under this many spare bodies past the starters, a position has no cover: one
 * injury and a slot goes unfilled. Over it, the extras cannot all play.
 */
export const STACKED_SPARE = 2;

/**
 * What the trade leaves, position by position, reporting only the positions
 * worth a word.
 *
 * `got` and `gave` are the positions moving, not the players — a pick has no
 * position and is simply absent from both.
 */
export function depthAfter(
  roster: Pos[],
  got: Pos[],
  gave: Pos[],
  slots: Partial<Record<Pos, number>>,
): PosDepth[] {
  const count = (list: Pos[]) => {
    const n = {} as Record<string, number>;
    for (const p of list) n[p] = (n[p] || 0) + 1;
    return n;
  };
  const before = count(roster);
  const inn = count(got);
  const out = count(gave);

  const seen = new Set<string>([...Object.keys(before), ...Object.keys(inn), ...Object.keys(slots)]);
  const result: PosDepth[] = [];
  for (const key of seen) {
    const pos = key as Pos;
    const starts = slots[pos] ?? 0;
    if (!starts) continue;
    const have = Math.max(0, (before[pos] || 0) + (inn[pos] || 0) - (out[pos] || 0));
    const spare = have - starts;
    // Short of the slots it must fill, or filling them with nobody behind.
    if (spare < 0) result.push({ pos, have, starts, state: 'short' });
    else if (spare === 0) result.push({ pos, have, starts, state: 'thin' });
    /* Only where the trade ADDED to the pile. A team already deep at a
       position has not been handed a problem by a deal that swapped one of
       them for another — it is as deep as it was — and a card about this deal
       should only report what this deal did. */
    else if (spare >= STACKED_SPARE && (inn[pos] || 0) > (out[pos] || 0)) {
      result.push({ pos, have, starts, state: 'stacked' });
    }
  }
  // Worst first, and inside a state the position that is furthest off.
  const rank: Record<DepthState, number> = { short: 0, thin: 1, stacked: 2 };
  return result.sort((a, b) =>
    rank[a.state] - rank[b.state]
    || Math.abs(b.have - b.starts) - Math.abs(a.have - a.starts)
    || a.pos.localeCompare(b.pos));
}

/**
 * The depth readings as one line instead of a chip each.
 *
 * Three chips saying "Thin at QB · 1 for 1", "Thin at TE · 1 for 1" and
 * "Stacked at WR · 6 for 2" is three boxes to read one thought, on a card that
 * already carries a verdict, three meters and the byes. And none of them said
 * WHEN: a man holding two tight ends and sending one read "Thin at TE · 1 for
 * 1" as a statement about his team as it stands, and asked why it could not
 * count the one on his bench. It is counting it. The one left is the one on his
 * bench, and he is about to be the only one.
 *
 * So the line says after, once, for all of them.
 */
export function depthSentence(depth: PosDepth[]): string {
  if (!depth.length) return '';
  const names = (s: DepthState) => depth.filter(d => d.state === s).map(d => d.pos);
  const list = (xs: string[]) =>
    (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0]) as string;
  const bits: string[] = [];
  const short = names('short');
  const thin = names('thin');
  const stacked = names('stacked');
  if (short.length) bits.push('short at ' + list(short));
  if (thin.length) bits.push('thin at ' + list(thin));
  if (stacked.length) bits.push('stacked at ' + list(stacked));
  return 'After this: ' + bits.join(' · ');
}
