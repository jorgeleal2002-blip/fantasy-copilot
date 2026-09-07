import type { Usage } from './usage';

/**
 * How many half-PPR points a game this player is expected to score NEXT season.
 *
 * A different object from the Rating, and it exists because the backtest said
 * so. The Rating answers "who should I take at this pick" — it prices
 * replaceability, the hole on your roster, the value against where the pick
 * falls — and those are exactly what make it a WORSE predictor of points than
 * ordering by last season's points. Rather than reweight the draft score until
 * it stops doing its job, the prediction is published separately.
 *
 * It is the luck-adjusted production of `Usage.ppgAdj`, blended across up to
 * three seasons toward the present, and NOTHING ELSE. That is a smaller claim
 * than it started as, and the reason is worth keeping.
 *
 * THE AGE STEP WAS IN HERE AND WAS MEASURED OUT. One year of the age curve,
 * applied as the ratio between next season and this one, cost running backs
 * 1.7 points a game and pushed their mean error from 3.6 to 4.2. Measured
 * out of sample over two season pairs, on the top two dozen backs by
 * projection:
 *
 *     three seasons, no age    -0.42 ±3.56
 *     three seasons + age      -2.08 ±4.17
 *
 * It is the same category error twice over. The prime window for a back closes
 * at 26 because that is when the LEAGUE stops paying him, not when he stops
 * scoring — a 28-year-old workhorse is a poor asset and a fine start, and the
 * curve is built for the first question. Everywhere else the step was worth
 * nothing either way: quarterbacks -0.18 against -0.35, tight ends level.
 *
 * It survives where it belongs, inside the Rating, which is about what a
 * player is worth rather than what he scores in September.
 *
 * Deliberately NOT in here: anything about your roster, the pick, or who else
 * is available. A projection that changed depending on who you own would not
 * be a projection.
 */
export function projectPPG(u: Usage | undefined): number | null {
  const base = u?.ppgAdj;
  if (!Number.isFinite(base as number)) return null;
  // Four games is the floor the rest of the model already uses to decide that
  // a rate is a rate — `positionRates` throws out anything shorter and
  // `blendSeasons` will not count a season below it. A projection off two
  // appearances is a rumour, and publishing it as a number costs more than
  // printing nothing: it puts a preseason cameo at the top of a position.
  if ((u?.gpTotal ?? u?.gp ?? 0) < 4) return null;
  return base as number;
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
