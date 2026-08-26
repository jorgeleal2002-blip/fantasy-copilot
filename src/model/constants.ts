import type { Pos } from '../api/types';

export const POS: Pos[] = ['QB', 'RB', 'WR', 'TE'];

/** Palette pulled from the Nocturne accent plus the two status hues the
 *  prototype uses for good/bad readings. */
export const ACCENT = '#9184d9';
export const GOOD = '#8ec9a8';
export const BAD = '#d9a08e';
export const MID = '#c9c0f0';
export const MUTED = 'rgba(233,233,237,.45)';

/**
 * One hue per position, for the draft board.
 *
 * A board cell on a phone is about 32px wide — too small for a position label
 * to carry any weight, and the thing you want to read off a board is a run:
 * five backs in a row. Colour is what makes that visible at that size, so the
 * position gets a hue and the cell gets tinted with it.
 *
 * Position is nominal, so these are four distinct hues, not a ramp. Measured
 * against the card surface they clear the dark lightness band (L .48–.67), the
 * chroma floor, ΔE 15.8 to normal vision and ΔE 8.4 under simulated protan /
 * deuteranopia across every pair — not just adjacent ones, because any two
 * cells on a board can end up side by side. The letters stay printed in every
 * cell regardless: colour is the fast read, never the only one.
 */
export const POS_COLOR: Record<Pos, string> = {
  QB: '#ad8d28',
  RB: '#2c8a5f',
  WR: '#4b7fd0',
  TE: '#c26e9a',
};

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
export const MARK_MID = '#8073c9';
export const MARK_BAD = '#cc6a4e';

/** Recessive: the empty part of a meter is context, not data. */
export const TRACK = 'rgba(233,233,237,.08)';
/** The surface a mark is painted on — used for the gap that separates marks. */
export const MARK_GAP = '#232532';

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
