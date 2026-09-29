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
  /**
   * Uppercase labels, bare numerals and glyphs. NOT lowercase words.
   *
   * This step became the app's general small-text size — 41 rules were setting
   * mixed-case content lines in it, a player's team and bye, the line of what
   * he actually did on Sunday, a trade's reasoning. Ten pixels of lowercase on
   * a phone is small in a way no amount of resolution fixes, and it is most of
   * what reads as an app that has not been finished. Caps carry it because
   * their x-height IS their cap height; lowercase has nothing left over.
   */
  micro: 10,
  /** The floor for anything with lowercase words in it: a team, an owner, a
   *  secondary line, a stat line. */
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
 * The grounds the app paints text on, darkest first. A tint is only as legible
 * as the lightest thing behind it, so every step below is checked against all
 * of them — see `src/test/scale.test.ts`.
 */
export const GROUNDS: [number, number, number][] = [
  [5, 8, 27],    // --color-bg, the page
  [21, 31, 62],  // --color-surface, a card
  [27, 46, 75],  // --color-section, a hero card
];

/** The near-white everything is tinted from — `--color-text`. */
export const INK: [number, number, number] = [242, 253, 254];

/**
 * Text tints, as alpha over `INK`, and every one of them chosen by measurement
 * rather than by eye.
 *
 * The scale before this one ran .20 / .28 / .38 / .48 / .60 / .72, and the
 * bottom half of it could not be read. Against a hero card those come out at
 * 1.9, 2.4, 3.2, 4.2 to one — the floor for body text is 4.5, and for anything
 * at all it is 3 — so three of the six steps were below the minimum and one was
 * barely a shadow. That is not a subtle failure: a glyph edge drawn at 2.4:1
 * has almost no range for the screen to antialias into, so the letters smear
 * into the ground no matter how many pixels the phone has. It reads exactly the
 * way "not sharp" reads.
 *
 * Worse, those steps were carrying DATA. Comparing this app against Sleeper's
 * own screen, side by side, on the same phone: Sleeper draws "133.38" — the
 * number you opened the app for — at 12.6:1, while the same figure here,
 * "32,311", came out at 3.2:1, and a team's name next to it at 3.4:1. Sleeper
 * dims its labels and keeps its numbers bright. This dimmed the numbers.
 *
 * So the floor is now 4.5:1 on the LIGHTEST ground, and what a step is for is
 * written next to it. Nothing below that step is allowed to carry a word.
 */
export const T = {
  /** A figure, a name, a score — anything somebody came here to read. */
  strong: 0.9,
  /** Content that is not the headline: a second name, a secondary number. */
  mid: 0.75,
  /** A supporting line you are meant to read. */
  soft: 0.62,
  /** A label naming the thing beside it. The dimmest text the app may use. */
  faint: 0.52,
} as const;

/**
 * The same near-white used as a MARK or a FILL rather than as text: a rule, a
 * dot, the ground of a capsule, an empty track. These sit below the legibility
 * floor on purpose, which is exactly why none of them may carry words.
 */
export const W = {
  /** A rule, a chevron, a dot — a shape, never a letter. */
  rule: 0.28,
  mid: 0.12,
  soft: 0.07,
  faint: 0.04,
} as const;

/** Every step, for the test that enforces them. */
export const FS_STEPS: number[] = Object.values(FS);
export const R_STEPS: number[] = [0, ...Object.values(R)];
export const T_STEPS: number[] = Object.values(T);
/** The floor every step that carries text has to clear, on every ground. */
export const TEXT_CONTRAST_MIN = 4.5;
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
