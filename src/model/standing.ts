/**
 * Where a figure places, and what colour that is.
 *
 * A number on its own is not a reading. 16% of a team's red-zone work is a lot
 * for a running back and nothing for a number one receiver; 18.8 points a game
 * is a season at quarterback and a very good one at tight end. The card
 * already worked out where most of its figures place — it just printed the
 * placing beside them and left the reader to do the last step.
 *
 * So the figure itself carries it. Green where he is near the top of his
 * position, salmon near the bottom, amber in between, and nothing at all where
 * the card does not know — an uncoloured number is honest about that, and a
 * colour applied to a figure with no direction is worse than none, because it
 * spends the signal on noise.
 */

export type Tone = 'good' | 'warn' | 'bad';

/** Above this share of the field it is a strength; below LOW, a weakness. */
export const TOP = 0.7;
export const LOW = 0.3;

/**
 * A placing as a share of the field, 1 for the best and 0 for the worst.
 *
 * A field of one has no placing: being the only quarterback anybody rosters
 * makes you neither good nor bad, and reporting it as first of one would paint
 * him green for it.
 */
export function placing(rank: number, of: number): number | null {
  if (!Number.isFinite(rank) || !Number.isFinite(of)) return null;
  if (of < 2 || rank < 1 || rank > of) return null;
  return 1 - (rank - 1) / (of - 1);
}

export function toneOf(at: number | null | undefined): Tone | undefined {
  if (at == null || !Number.isFinite(at)) return undefined;
  return at >= TOP ? 'good' : at <= LOW ? 'bad' : 'warn';
}

/** The tone for a placing given as a rank in a field. */
export function toneOfRank(rank: number | null | undefined, of: number | null | undefined): Tone | undefined {
  if (rank == null || of == null) return undefined;
  return toneOf(placing(rank, of));
}
