/**
 * The scales — type, radius, tint — and there is nothing outside them.
 *
 * What separates an app from a native one is almost never an effect. It is that
 * in a native app everything is one of a small number of sizes, and here
 * nothing was: an audit of this source found 28 distinct font sizes between 7
 * and 21 pixels, 17 distinct corner radii and 18 distinct text tints. Twelve,
 * twelve and a half, thirteen and thirteen and a half were all in use, half a
 * pixel apart. Half a pixel is not a hierarchy — nobody can see it — but it
 * does guarantee that two labels which mean the same thing on two screens are
 * not the same size, and a reader who cannot name that still reads it as
 * sloppiness. Nine radii between 6 and 14 meant no chip was ever concentric
 * with the card it sat in. Tints at .30, .32, .33, .35 and .38 are one colour
 * with five names.
 *
 * So: one set of steps, each far enough from the next to be a decision.
 * `src/test/scale.test.ts` reads this source tree and fails on any size,
 * radius or tint that is not a step, which is the only thing that keeps a
 * scale a scale.
 */

/**
 * Type. Whole pixels only, and close to the scale iOS itself publishes — which
 * is the honest answer to "make it look like Sleeper", since Sleeper is a native
 * app drawing at the system's sizes.
 *
 * Whole pixels because a fractional one is a fractional line box, and a
 * fractional line box puts every rule, underline and background edge in the row
 * on a half device pixel where the compositor has to average two of them. That
 * is the grey smear this app has been chasing for weeks.
 *
 * `micro` is the floor. Below ten pixels a phone is not rendering text, it is
 * rendering a texture, and there was a seven-pixel "LIVE" tag on the draft
 * board proving it.
 */
export const FS = {
  /** Kickers, chips, week labels, stat keys — mostly uppercase. */
  micro: 10,
  /** Second lines: a team, a position, an owner. */
  small: 12,
  /** The body of the app, and every list row. */
  body: 13,
  /** A player's name, a card's heading. */
  lg: 15,
  /** A section head, a sheet's subject. */
  title: 17,
  /** A figure worth looking at: a scoreline, a Rating on a hero card. */
  big: 21,
  /** The one number a screen is about. */
  huge: 26,
  /** A scoreboard. */
  max: 31,
  /** Decoration rather than text — the one mark that is a picture of a word. */
  display: 66,
} as const;

/**
 * Corners, doubling. A card at 12 holds a chip at 8 and a tile at 4, and each
 * of them looks cut from the one above rather than drawn separately.
 *
 * `pill` is for anything whose radius should follow its own height — a track, a
 * bar, a capsule — because a fixed radius on a 6px bar is a guess that is wrong
 * the moment the bar changes height.
 */
export const R = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Text tints, as alpha over the app's near-white. Six ranks, each about a fifth
 * darker than the one above — the smallest difference that reads as a different
 * rank on this ground.
 */
export const T = {
  /** Almost the full text colour: something quiet that still has to be read. */
  strong: 0.72,
  /** A secondary line you are meant to read. */
  mid: 0.6,
  /** A secondary line you are meant to be able to read. */
  soft: 0.48,
  /** Supporting detail. */
  faint: 0.38,
  /** Present, not competing. */
  ghost: 0.28,
  /** A mark rather than a message — a chevron, a rule's label. */
  trace: 0.2,
} as const;

/**
 * Washes of the same near-white used as a FILL rather than as text: the ground
 * of a capsule, an empty track, a blank avatar. Kept apart from the text ramp
 * because they answer a different question and share only a colour.
 */
export const W = {
  faint: 0.04,
  soft: 0.07,
  mid: 0.12,
} as const;

/** Every step, for the test that enforces them. */
export const FS_STEPS: number[] = Object.values(FS);
export const R_STEPS: number[] = [0, ...Object.values(R)];
export const T_STEPS: number[] = Object.values(T);
export const W_STEPS: number[] = Object.values(W);
export const ALPHA_STEPS: number[] = [...W_STEPS, ...T_STEPS];

/**
 * Where a nested square's corner and its label land, for an avatar drawn at
 * `size` pixels.
 *
 * These were `size * 0.27` and `size * 0.3`, which is a reasonable way to keep
 * a badge in proportion and produces a different radius and a different font
 * size for every width the component is ever used at — 9.18px and 10.2px on a
 * 34px face, 12.42 and 13.8 on a 46px one. Off every scale, and fractional, so
 * the circle's own edge was being averaged across two device pixels. The bands
 * land within a pixel of what the multipliers gave, except at the smallest
 * face, where 0.3 was producing 7.8px type.
 */
export const boxRadius = (size: number): number =>
  size < 30 ? R.sm : size < 56 ? R.md : R.lg;

export const boxType = (size: number): number =>
  size < 32 ? FS.micro : size < 50 ? FS.body : FS.big;
