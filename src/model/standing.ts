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
 * position and salmon near the bottom — and nothing in between, because being
 * ordinary is not news. A middle band in its own colour paints most of a card
 * most of the time, and a screen where everything is lit is a screen where
 * nothing stands out; the two ends only mean something against a quiet middle.
 *
 * Nothing, too, where the card does not know where a figure places. An
 * uncoloured number is honest about that, and it reads the same as an ordinary
 * one, which is the right answer for both.
 */

/* `warn` is not reached by a placing — see `toneOf`. It exists for the one
   reading that is genuinely a caution rather than a middling one: a man listed
   Questionable, who is neither fine nor out. */
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
  if (at >= TOP) return 'good';
  if (at <= LOW) return 'bad';
  return undefined;
}

/** The tone for a placing given as a rank in a field. */
export function toneOfRank(rank: number | null | undefined, of: number | null | undefined): Tone | undefined {
  if (rank == null || of == null) return undefined;
  return toneOf(placing(rank, of));
}
