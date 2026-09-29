/**
 * Pull-to-refresh, as arithmetic.
 *
 * The gesture is only meaningful where a scroller has run out of scroll: a
 * drag in the middle of a list is a scroll and must stay one, and the same
 * drag against an edge is dead space the browser would otherwise spend on a
 * rubber band. Both edges are wired, not just the top — a scoreboard is read
 * from wherever the thumb already is, and on a screen whose content does not
 * fill it there is no meaningful top or bottom at all.
 *
 * The finger moves further than the indicator does. That resistance is what
 * makes the gesture feel like it is pulling against something, and it is also
 * what stops a flick from tripping a refresh: the trigger is a distance the
 * thumb has to mean.
 */

/** Indicator pixels the pull has to reach before releasing does anything. */
export const PULL_TRIGGER = 62;
/** Where the rubber band stops giving. */
export const PULL_MAX = 92;
/** Indicator pixels per finger pixel. */
export const PULL_RESIST = 0.45;
/** Finger pixels before a drag counts as a pull rather than a stray touch. */
export const PULL_SLOP = 6;

export type PullEdge = 'top' | 'bottom' | 'both' | null;
export type Pull = { edge: 'top' | 'bottom'; amount: number };

/**
 * Which edge a scroller is sitting against, if any.
 *
 * A scroller with nothing to scroll is against both at once, and which one the
 * gesture is depends on which way the thumb goes.
 */
export function edgeAt(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  slack = 2,
): PullEdge {
  const still = scrollHeight <= clientHeight + slack;
  if (still) return 'both';
  if (scrollTop <= slack) return 'top';
  if (scrollTop + clientHeight >= scrollHeight - slack) return 'bottom';
  return null;
}

/**
 * How far a drag from that edge has pulled, and which way.
 *
 * `dy` is the finger's travel since it went down: positive is downward, which
 * pulls the top edge, and negative pulls the bottom. A drag away from the edge
 * it started against is a scroll and gets nothing back.
 */
export function pullFrom(
  edge: PullEdge,
  dy: number,
  resist = PULL_RESIST,
  max = PULL_MAX,
  slop = PULL_SLOP,
): Pull | null {
  if (!edge || Math.abs(dy) <= slop) return null;
  const down = dy > 0;
  const can = edge === 'both' || (down ? edge === 'top' : edge === 'bottom');
  if (!can) return null;
  return { edge: down ? 'top' : 'bottom', amount: Math.min((Math.abs(dy) - slop) * resist, max) };
}

/** Whether letting go now would refresh. */
export const pullArmed = (p: Pull | null, trigger = PULL_TRIGGER): boolean =>
  !!p && p.amount >= trigger;

/** How far through the gesture the indicator should read, 0..1. */
export const pullProgress = (p: Pull | null, trigger = PULL_TRIGGER): number =>
  !p ? 0 : Math.min(1, p.amount / trigger);
