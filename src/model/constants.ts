import type { Pos } from '../api/types';

export const POS: Pos[] = ['QB', 'RB', 'WR', 'TE'];

/** Palette pulled from the Nocturne accent plus the two status hues the
 *  prototype uses for good/bad readings. */
export const ACCENT = '#9184d9';
export const GOOD = '#8ec9a8';
export const BAD = '#d9a08e';
export const MID = '#c9c0f0';
export const MUTED = 'rgba(233,233,237,.45)';

/** Age at which each position stops gaining and starts shedding value, and
 *  how fast it sheds afterwards. RB falls off a cliff; QB barely moves. */
export const PEAK: Record<Pos, number> = { QB: 27, RB: 24, WR: 26, TE: 27 };
export const DECAY: Record<Pos, number> = { QB: 0.05, RB: 0.13, WR: 0.08, TE: 0.07 };

export type MetricKey = 'talent' | 'need' | 'value' | 'floor' | 'boom' | 'age' | 'stack' | 'rz';
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
    w: { talent: 0.34, need: 0.16, value: 0.10, floor: 0.10, boom: 0.08, age: 0.05, stack: 0.06, rz: 0.11 },
    copy: 'Quality leads, need breaks the tie, and the red zone carries weight because that is where touchdowns are scored.',
  },
  floor: {
    label: 'Safe floor',
    w: { talent: 0.29, need: 0.15, value: 0.08, floor: 0.21, boom: 0.04, age: 0.08, stack: 0.05, rz: 0.10 },
    copy: 'I prioritise an established role, volume and red-zone presence. Less variance, less ceiling.',
  },
  upside: {
    label: 'Upside',
    w: { talent: 0.27, need: 0.13, value: 0.08, floor: 0.04, boom: 0.24, age: 0.08, stack: 0.06, rz: 0.10 },
    copy: 'Chasing ceiling: youth, likely breakouts, stacks with your QB and whoever lives in the red zone.',
  },
};

export const METRIC_LABEL: Record<MetricKey, string> = {
  talent: 'Player quality',
  need: 'Positional need',
  value: 'Value vs. availability',
  floor: 'Floor (snap %)',
  boom: 'Explosiveness (ball share)',
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
