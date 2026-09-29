/**
 * How big to store a photo somebody uploads.
 *
 * There is a hard ceiling on it: the league's photos live in one database
 * record that every phone reads on every launch, so a camera-roll picture has
 * to become a few tens of kilobytes. What was not decided carefully was the
 * other side of it — a flat 160 square, which is fine for the 34px face in a
 * roster row and visibly soft for the 64px portrait on a player's card, which
 * on a phone is 192 real pixels of a 160-pixel picture.
 *
 * So the size is not fixed any more: the encoder is asked what each of a few
 * sizes would actually weigh and the biggest one that fits under the ceiling
 * wins. A face is worth more pixels than it is worth fidelity — a slightly
 * softer 288 reads sharper than a pristine 160 stretched — but only down to a
 * point, past which the blocking is worse than the size is good. Hence the
 * floor: a bigger square has to earn its place at decent quality, and only
 * when nothing does is the smallest square allowed to go as low as it must.
 */

/** Squares to try, largest first. */
export const PHOTO_PX = [288, 224, 160] as const;
/** Encoder qualities to try, best first. */
export const PHOTO_Q = [0.9, 0.82, 0.74, 0.66, 0.55, 0.45] as const;
/** Below this, a bigger square is no longer worth what it costs in blocking. */
export const PHOTO_Q_FLOOR = 0.7;

export function pickEncoding(
  bytesAt: (px: number, q: number) => number,
  cap: number,
  sizes: readonly number[] = PHOTO_PX,
  qualities: readonly number[] = PHOTO_Q,
): { px: number; q: number } | null {
  for (const px of sizes) {
    for (const q of qualities) {
      if (q < PHOTO_Q_FLOOR) continue;
      if (bytesAt(px, q) <= cap) return { px, q };
    }
  }
  // Nothing fits at a quality worth having. The smallest square then takes
  // whatever it can get, because a rough photo beats no photo.
  const last = sizes[sizes.length - 1];
  if (last == null) return null;
  for (const q of qualities) {
    if (bytesAt(last, q) <= cap) return { px: last, q };
  }
  return null;
}
