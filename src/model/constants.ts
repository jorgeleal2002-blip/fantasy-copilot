import type { DraftPos, FillPos, Pos } from '../api/types';

export const POS: Pos[] = ['QB', 'RB', 'WR', 'TE'];

/** Palette pulled from the Nocturne accent plus the two status hues the
 *  prototype uses for good/bad readings. */
export const ACCENT = '#8eeded';
export const GOOD = '#8ec9a8';
export const BAD = '#d9a08e';
/**
 * The middle of the good/bad scale.
 *
 * It used to be the accent, which worked while the accent was violet and stops
 * working now that it is cyan: cyan sits 36° from the green that means "good",
 * ΔE 11.5 — under the floor at which two colours can be told apart. Those two
 * share a column, a league table paints every team contending, middle or
 * rebuilding down one line, so the neutral would have echoed the verdict above
 * it. Sleeper's own muted slate was worse still, ΔE 10.0 to the green.
 *
 * This is measured clear of all three: 24.9 from the green, 24.3 from the
 * salmon, 29.6 from the accent itself, so it never reads as any of them.
 */
export const MID = '#6783ec';
export const MUTED = 'rgba(242,253,254,.45)';

/**
 * One hue per position, taken from the app this look comes from.
 *
 * A board cell on a phone is about 32px wide — too small for a position label
 * to carry any weight, and the thing you want to read off a board is a run:
 * five backs in a row. Colour is what makes that visible at that size.
 *
 * These four are sampled from the reference and measured against this surface:
 * ΔE 16.5 to normal vision and 10.1 under simulated protan / deuteranopia
 * across EVERY pair, not just adjacent ones, because any two cells on a board
 * can end up side by side. They sit brighter than the set they replace, which
 * is the reference's character and the reason for the change.
 */
export const POS_COLOR: Record<Pos, string> = {
  QB: '#f63273',
  RB: '#38ccbb',
  WR: '#59a7ff',
  TE: '#f8b36c',
};

/**
 * Kickers and defences, which now get a hue too.
 *
 * They were a flat grey here on the argument that nobody scans a board for a
 * run on kickers. The reference gives them colours and this is meant to look
 * like the reference, so they have them — but NOT the reference's own two.
 * Measured against the four above, its kicker purple lands ΔE 1.8 from the
 * receiver blue under deuteranopia: the same colour, for anyone with the
 * commonest form of colour blindness. Its defence red sat 14.3 from the
 * quarterback pink.
 *
 * These are the nearest pair that survives the company of the other four —
 * with them the six-colour set still measures 16.5 and 10.1, exactly what the
 * four managed alone, so neither of them costs the positions that matter.
 */
export const FILL_COLOR: Record<FillPos, string> = {
  K: '#7163b2',
  DEF: '#a8592a',
};
export const FILL: FillPos[] = ['K', 'DEF'];

/**
 * The same six as a filled square, with dark type on top.
 *
 * A drafted cell in the reference is a solid block of its position's colour,
 * not a hint of one, and that is what makes a run down a position readable at
 * arm's length — a 20% tint of six different hues all read as "dark card".
 *
 * The hues above are too saturated to carry type, so these lift to L .86 and
 * pull the chroma back to .12. Dark ink on every one of them measures between
 * 10.9 and 13.0, so the name stays the most legible thing in the cell.
 */
export const POS_CELL: Record<DraftPos, string> = {
  QB: '#ffafc2',
  RB: '#65ebd9',
  WR: '#98d5ff',
  TE: '#ffc17a',
  K: '#d0c4ff',
  DEF: '#ffb98a',
};
/** The type that sits on one. */
export const CELL_INK = '#0a1024';
export const cellOf = (pos: DraftPos): string => POS_CELL[pos] || '#8ea3c8';
/** The colour for anything a draft board can hold. */
export const colorOf = (pos: DraftPos): string =>
  POS_COLOR[pos as Pos] || FILL_COLOR[pos as FillPos] || 'rgba(242,253,254,.42)';

/** What Sleeper may call the team-defence slot. */
export const DEF_SLOTS = ['DEF', 'DST', 'D/ST'];

/**
 * The same three states again, stepped for FILLS rather than text.
 *
 * The text steps above are light because they have to be readable as 11px type
 * on a dark ground. Painted as chart marks on the card surface they came out
 * washed and too close together: measured against the surface they sat outside
 * the usable lightness band, under the chroma floor — reading as grey — and the
 * warning/bad pair separated by only ΔE 13.5 to normal vision, below the 15
 * floor. These steps are deeper, and clear every check: worst adjacent pair
 * ΔE 16.9 to deuteranopes and 21.2 to normal vision, all three above 3:1
 * against the surface.
 *
 * Two steps per state, not one: a colour dark enough to be a good mark on a
 * dark surface is too dark to be small type on it.
 */
export const MARK_GOOD = '#3fa877';
/** The fill of the same neutral. Worst adjacent pair ΔE 22.2 to deuteranopes,
 *  against the 16.9 the violet managed. */
export const MARK_MID = '#5671d8';
export const MARK_BAD = '#cc6a4e';

/** Recessive: the empty part of a meter is context, not data. */
export const TRACK = 'rgba(242,253,254,.08)';
/** The surface a mark is painted on — used for the gap that separates marks. */
export const MARK_GAP = '#151f3e';

/**
 * A prime is a window, not a point: inside it a player is at full value and
 * neither improving nor declining. Before it they climb toward it, after it
 * they fall away from it — and both rates differ by position. A back arrives
 * ready and is finished early; a quarterback takes years to arrive and then
 * lasts a decade; a tight end is the slowest of all to break out.
 */
export const PRIME: Record<Pos, [number, number]> = {
  QB: [26, 33], RB: [23, 26], WR: [24, 28], TE: [25, 29],
};
/** Value lost per year BEFORE the prime window. */
export const RISE: Record<Pos, number> = { QB: 0.07, RB: 0.05, WR: 0.06, TE: 0.09 };
/** Value lost per year AFTER it. */
export const DECAY: Record<Pos, number> = { QB: 0.05, RB: 0.15, WR: 0.08, TE: 0.07 };

/**
 * How much of the elite-longevity bonus each position actually gets.
 *
 * Talent buys a quarterback years — his decline is craft, and craft keeps. It
 * buys a running back almost nothing: that decline is a body absorbing 300
 * carries a year, and no amount of ability postpones it. Applying one flat
 * bonus to every position had a 29-year-old star back keeping 81% of his value
 * two years out, which is not a thing that happens.
 */
export const ELITE_HOLD: Record<Pos, number> = { QB: 1, TE: 0.8, WR: 0.7, RB: 0.3 };
/** Where the prime window opens — used wherever a single number is needed. */
export const PEAK: Record<Pos, number> = { QB: 26, RB: 23, WR: 24, TE: 25 };

/** Bumped when the shape of the usage map changes, so a cached map from an
 *  older build cannot survive a reload and publish one season's numbers under
 *  a three-season label. */
export const USAGE_V = 3;

/** How many seasons of usage to blend, and how much each is worth. The most
 *  recent leads; a season the player missed has its weight redistributed
 *  across the ones they played, so an injury year is not counted as a bad year. */
export const USAGE_WEIGHTS: [number, number, number] = [0.5, 0.3, 0.2];

export type MetricKey =
  | 'talent' | 'need' | 'value' | 'floor' | 'boom' | 'combo' | 'age' | 'stack' | 'rz';
export type Weights = Record<MetricKey, number>;
export type StratKey = 'balanced' | 'floor' | 'upside';

export interface Strategy {
  label: string;
  w: Weights;
  copy: string;
}

/** The strategy picker in Settings really does rewrite the weights and
 *  reorder the board — it is not a cosmetic toggle. */
export const STRATS: Record<StratKey, Strategy> = {
  balanced: {
    label: 'Balanced',
    w: { talent: 0.30, need: 0.14, value: 0.08, floor: 0.06, boom: 0.06, combo: 0.18, age: 0.05, stack: 0.05, rz: 0.08 },
    copy: 'Real balance: it demands floor AND ceiling in the same player, not one or the other. The geometric mean punishes the lopsided — out goes the one who gives you 4 points one Sunday and 22 the next.',
  },
  floor: {
    label: 'Safe floor',
    w: { talent: 0.26, need: 0.15, value: 0.08, floor: 0.26, boom: 0.03, combo: 0, age: 0.07, stack: 0.05, rz: 0.10 },
    copy: 'I prioritise an established role, volume and red-zone presence. Less variance, less ceiling.',
  },
  upside: {
    label: 'Upside',
    w: { talent: 0.25, need: 0.12, value: 0.07, floor: 0.03, boom: 0.30, combo: 0, age: 0.09, stack: 0.06, rz: 0.08 },
    copy: 'Chasing ceiling: youth, likely breakouts, stacks with your QB and whoever lives in the red zone.',
  },
};

export const METRIC_LABEL: Record<MetricKey, string> = {
  talent: 'Player quality',
  need: 'Positional need',
  value: 'Value vs. availability',
  floor: 'Floor (snaps and volume)',
  boom: 'Explosiveness (yards per touch)',
  combo: 'Floor AND ceiling (geometric mean)',
  age: 'Age curve',
  stack: 'NFL team correlation',
  rz: 'Red zone and TDs',
};

/** Which positions may fill each roster slot the league defines. */
export const ELIG: Record<string, Pos[]> = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
};

/** Display order for the optimal lineup. */
export const SLOT_SORT: Record<string, number> = {
  QB: 0, RB: 1, WR: 2, TE: 3, REC_FLEX: 4, FLEX: 5, SUPER_FLEX: 6,
};

/** Last-resort pick values, used only when the market feed is unreachable. */
export const BASE_ROUND_VALUE: Record<number, number> = { 1: 42, 2: 16, 3: 7, 4: 3 };

/** How often the draft board re-reads picks while a draft is live. */
export const DRAFT_POLL_MS = 20000;

export const STORAGE_SESSION = 'fc.session';
export const STORAGE_PHOTOS = 'fc.photos';
/** Trades you marked as interesting, kept per league across launches. */
export const STORAGE_SAVED = 'fc.saved';
/** "username/leagueId" → roster_id, for when your team is not under the
 *  account you signed in with. Keyed by both because two people sharing the
 *  app can be in the same league with different teams. */
export const STORAGE_TEAM = 'fc.team';
/** Everyone who has used the app on this device, most recent first, so a
 *  second person is one tap away rather than a username retyped. */
export const STORAGE_ACCOUNTS = 'fc.accounts';
/** "username/leagueId" → player ids you have put up for trade. */
export const STORAGE_BLOCK = 'fc.block';
