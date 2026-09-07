import { ageCurveRedraft } from './math';
import type { Usage } from './usage';

/**
 * How many half-PPR points a game this player is expected to score NEXT season.
 *
 * This is a different object from the Rating and exists because the backtest
 * said so. The Rating answers "who should I take at this pick" — it prices
 * replaceability, the hole on your roster, the value against where the pick
 * falls — and those are exactly the things that make it a WORSE predictor of
 * points than simply ordering by last season's points, which is what the
 * measurement found. Rather than reweight the draft score until it stops doing
 * its job, the prediction is published separately and measured on its own
 * terms.
 *
 * Two ingredients, both already earned their place:
 *
 *   · `ppgAdj` — last seasons' points with the luck taken out, half what the
 *     player actually scored and half what his volume was worth at ordinary
 *     rates for his position, blended across up to three seasons toward the
 *     present. On its own that ordering backtests at 0.803 against the next
 *     season, past the 0.795 that raw points manage.
 *   · the age curve, applied as ONE year of it — the ratio between the curve at
 *     his age next season and at his age now. Not the curve's absolute value:
 *     that would mark a 30-year-old down for being 30 twice, once in the
 *     seasons already measured and once again here. What is wanted is only the
 *     step from this year to the next.
 *
 * The REDRAFT curve, deliberately. The dynasty one is a three-year decline
 * priced into a single number and it is linear in absolute terms, so once a
 * back has fallen a long way its year-on-year RATIO gets steeper and steeper:
 * at 30 it steps a running back down 37% in one season, which is not a thing
 * that happens to anybody. The redraft curve is the same shape at 45% of the
 * fall and is described as a year of wear rather than a career, which is
 * exactly the question here. It costs that same back 9%.
 *
 * The backtest slightly PREFERS the harsher one — 0.806 against 0.803 — and it
 * is overruled, which is worth being explicit about. That test scores a rank
 * correlation, so it cannot see magnitude at all: pushing old backs further
 * down the order is all it can reward, and 7.5 points a game is the same rank
 * as 10.9. This number is printed on a card with units next to it, where being
 * believable is the whole point, and 0.003 across four season pairs is inside
 * the noise besides.
 *
 * Deliberately NOT in here: anything about your roster, the pick, or who else
 * is available. A projection that changed depending on who else you own would
 * not be a projection.
 */
export function projectPPG(
  u: Usage | undefined,
  pos: string | undefined,
  age: number | null | undefined,
  elite?: number,
): number | null {
  const base = u?.ppgAdj;
  if (!Number.isFinite(base as number)) return null;
  // Four games is the floor the rest of the model already uses to decide that
  // a rate is a rate — `positionRates` throws out anything shorter and
  // `blendSeasons` will not count a season below it. A projection off two
  // appearances is a rumour, and publishing it as a number costs more than
  // printing nothing: it puts a preseason cameo at the top of a position.
  if ((u?.gpTotal ?? u?.gp ?? 0) < 4) return null;
  if (!age) return base as number;
  const now = ageCurveRedraft(pos, age, elite);
  const then = ageCurveRedraft(pos, age + 1, elite);
  if (!(now > 0.05)) return base as number;
  return (base as number) * (then / now);
}

/**
 * How much of a projection to believe.
 *
 * A number off four games and a number off three full seasons print the same
 * and are not the same claim, so the screens say which they are holding rather
 * than letting the reader assume. The thresholds are games, not seasons: a
 * player who missed most of two years has three seasons on his card and the
 * sample of one.
 */
export function projectConfidence(u: Usage | undefined): 'high' | 'fair' | 'low' | null {
  if (!u) return null;
  const gp = u.gpTotal ?? u.gp ?? 0;
  if (gp >= 30) return 'high';
  if (gp >= 14) return 'fair';
  return 'low';
}
