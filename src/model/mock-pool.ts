import type { SleeperPlayer } from '../api/types';

/**
 * Who may appear on the mock draft's board.
 *
 * The draft board proper is deliberately narrow — this league drafts rookies,
 * so it lists rookies — but a mock is a what-if and has to reach the veteran
 * you want to try. Widening it naively reaches something else too: Sleeper's
 * catalog keeps a page for everyone who ever had one, and its `active` and
 * `status` flags go stale on players who quietly left the league, so the deep
 * tail fills with names who do not play any more.
 *
 * Being on an NFL roster is the signal that does not go stale. The single
 * exception is an incoming rookie, who has no team until he is drafted.
 */
export function isMockEligible(p: SleeperPlayer | null | undefined): boolean {
  if (!p) return false;
  if (p.active === false) return false;
  if (p.status && p.status !== 'Active') return false;
  if (!p.search_rank) return false;

  const rookie = isIncomingRookie(p);
  if (!p.team && !rookie) return false;

  // Deep enough to reach a real bench veteran, not so deep it reaches the
  // practice squad.
  return p.search_rank <= (rookie ? 900 : 800);
}

export function isIncomingRookie(p: SleeperPlayer): boolean {
  return (p.years_exp === 0 || p.years_exp == null) && !!p.age && p.age <= 24;
}
