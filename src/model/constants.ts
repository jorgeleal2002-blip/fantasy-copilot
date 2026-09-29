import type { DraftPos, FillPos, Pos } from '../api/types';

export const POS: Pos[] = ['QB', 'RB', 'WR', 'TE'];

/**
 * The verdict hues, and the accent they share a screen with.
 *
 * These were muted on purpose — the note at WARN argued that a saturated set
 * "read as an alarm on a card that is mostly quiet" — and the purpose was
 * wrong. Measured in LCh against the app this look comes from: Sleeper's green
 * is chroma 64 and its pink chip 52, while this green sat at 28, the salmon at
 * 26 and the accent at 29. Less than half. That is not restraint, it is a
 * palette that has had the colour taken out of it, and nothing about a figure
 * being green survives being told in a green that grey.
 *
 * So each keeps its hue and roughly doubles its chroma, landing in the band
 * Sleeper actually occupies rather than at the top of the gamut, which is where
 * the alarm the old note feared really is: the most chromatic green in sRGB at
 * this hue is #00ff8d, and it is a highlighter.
 *
 * Every one of them clears 4.5:1 on all three grounds and no two are closer
 * than ΔE 36 — better separated than the muted set, which had pairs at 24.
 */
export const ACCENT = '#2ef0f8';
export const GOOD = '#52dea4';
export const BAD = '#ee8c64';
/**
 * The third state, for a reading that is neither good nor bad but wary — a man
 * listed Questionable, a run of opponents that is middling.
 *
 * Measured against everything it shares a screen with, the way `--color-mid`
 * below had to be: ΔE2000 22.7 from the green, 23.3 from the salmon, 29.7 from
 * the accent and 54.3 from the mid, at 11.7:1 on a card. Chroma 31 against the
 * others' 26-29, so it belongs to the same muted family rather than arriving as
 * a traffic light — a saturated yellow cleared the distances by ten more but
 * read as an alarm on a card that is mostly quiet.
 */
export const WARN = '#ecd880';
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
 * This is measured clear of all three: 82 from the green, 74 from the salmon,
 * 72 from the accent itself, so it never reads as any of them.
 *
 * Lightened from #6783ec, which measured 3.9:1 on a hero card — under the 4.5
 * floor for text, on the ground where it appeared largest. Four and nine tenths
 * of ΔE away from where it was, which is about the smallest move that clears
 * it, and 4.6:1 there now.
 *
 * It is for a CATEGORY whose middle is a real state — a team contending,
 * middling or rebuilding — never for a placing. The middle of a placing is not
 * a state, it is the absence of one, and `toneOf` returns nothing for it. Using
 * this there is what made one colour mean "2nd of twelve" on one card and "8th
 * of twelve" on the next.
 */
export const MID = '#7290fa';
export const MUTED = 'rgba(242,253,254,0.62)';

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
  POS_COLOR[pos as Pos] || FILL_COLOR[pos as FillPos] || 'rgba(242,253,254,0.52)';

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
export const MARK_GOOD = '#12b878';
/** The fill of the same neutral. Worst adjacent pair ΔE 22.2 to deuteranopes,
 *  against the 16.9 the violet managed. */
export const MARK_MID = '#5c8ef4';
export const MARK_BAD = '#dc7442';
/**
 * A bar with nothing to report.
 *
 * `MARK_MID` is a full third hue — ΔE 86 from the green and 77 from the salmon —
 * so a bar painted with it announces a verdict as loudly as the two that have
 * one. But the middle of a placing is not a verdict: `toneOf` deliberately
 * returns nothing there, because a screen where everything is lit is a screen
 * where nothing stands out. A number in the middle band simply goes uncoloured;
 * a bar cannot go uncoloured, so it goes neutral instead. Low chroma, ΔE 34
 * from the green and 33 from the salmon: far enough to never be mistaken for
 * either, quiet enough to read as the absence of a claim.
 */
export const MARK_NONE = '#afb7ca';

/** Recessive: the empty part of a meter is context, not data. */
export const TRACK = 'rgba(242,253,254,0.07)';
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

/** Bumped when the MEANING of the usage map changes, not only its shape — a
 *  map blended under different weights is a different map, and one held over
 *  from an older build would answer with numbers this build did not produce.
 *  v7: two metrics joined the blend, the season in progress is weighted per
 *  metric, each finished season back is worth half the one in front, and a
 *  role that has moved rather than drifted stops being shrunk at all.
 *  v8: the shrinkage is scaled by how much football the prior is made of, so a
 *  second-year player's season counts for more than a veteran's does. */
export const USAGE_V = 8;

/**
 * How many seasons of usage to blend, and how much each is worth.
 *
 * Three, because one is a small sample: an injury, a coordinator, a quarterback
 * going down, and every number in a single year moves. The most recent leads,
 * and a season the player missed has its weight redistributed across the ones
 * he played, so an injury year is not counted as a bad year.
 *
 * Each year back is worth half the one in front of it, which is a rule rather
 * than three numbers. It used to be 50/30/20, a decay of about two thirds a
 * year, and that left a two-year-old season carrying a fifth of what the model
 * thought a player was — too much for a league you only own him in for this
 * one, and too much generally for a sport where roles turn over on a coaching
 * change and a contract. Halving puts 2023 at a seventh instead of a fifth.
 *
 * `blendSeasons` steepens this further for a player past his prime: his older
 * seasons prop him up falsely, so they fade on top of this.
 */
export const USAGE_DECAY = 0.5;
export const USAGE_WEIGHTS: [number, number, number] =
  (([a, b, c]) => [a, b, c] as [number, number, number])(
    [1, USAGE_DECAY, USAGE_DECAY ** 2].map(x => x / (1 + USAGE_DECAY + USAGE_DECAY ** 2)),
  );

/**
 * How many games of the season in progress are worth everything before it.
 *
 * The finished seasons are a big sample of a player who may no longer exist —
 * new team, new coordinator, new depth chart — and the season in progress is a
 * small sample of the one who does. So the current year is weighted by how
 * much of it there is, `gp / (gp + K)`.
 *
 * One K for every metric was the crude part, and it is what held a breakout
 * down: a receiver who has taken over an offence shows it in his snaps and his
 * targets within a month, and those were being shrunk as hard as his yards per
 * catch. They do not stabilise at the same speed and should not be trusted at
 * the same speed.
 *
 * Role first, because it is both the fastest to settle and the most predictive
 * thing here: three games of a man playing every snap is most of what there is
 * to know about whether he plays every snap. What he does with the ball next.
 * Scoring last, because touchdown rate is the noisiest number in the sport.
 *
 * Retuned once the shape was right and the level was not. The prior is a big
 * sample — three finished seasons, fifty-odd games — but it is a big sample of
 * a player who may not exist any more: different team, different coordinator,
 * different depth chart, a year older. Weighting it as fifty games of evidence
 * about the man playing now overstates it badly, and that is what held the
 * season in progress to a third of the answer in October. Treated as what it
 * is — a handful of games' worth of evidence about THIS player — the constants
 * come down by about half, and by game three the year you are watching leads.
 */
export const CURRENT_SEASON_K = 3;

/**
 * When a role has not drifted but MOVED.
 *
 * Shrinking the season in progress toward the seasons behind it assumes the
 * two are measuring the same thing — a noisy reading of one player against a
 * quiet one. A receiver who has gone from third in a pecking order to first
 * breaks that assumption: the old number is not a better estimate of his role,
 * it is an accurate estimate of a role he no longer has. Averaging them is
 * wrong in kind, not in degree, and it is what keeps a man whose snaps and
 * targets have doubled sitting behind players he has passed.
 *
 * So a move large enough that a small sample cannot explain it stops being
 * shrunk. Below `ROLE_BREAK` nothing changes; by `ROLE_BREAK_FULL` — a role
 * that has doubled or halved — the season in progress is simply believed.
 *
 * Role only. A jump in yards per catch or in touchdown rate over three games
 * is exactly the noise this model exists to discount; a jump in snap share is
 * a depth chart, and depth charts do not regress to last year.
 */
export const ROLE_BREAK = 0.35;
export const ROLE_BREAK_FULL = 1.0;
/** And never off one Sunday: a break needs a sample to be a break. */
export const ROLE_BREAK_MIN_GP = 3;

/**
 * How much the finished seasons are worth as a prior.
 *
 * Shrinking toward a prior should be proportional to how much that prior
 * knows, and this shrank toward all of them equally. A man with three seasons
 * behind him and one with a single half-season were pulled back just as hard,
 * though one prior is forty-five games of evidence and the other is eight —
 * and shrinking toward eight games is shrinking toward noise. It is second-
 * year players it hurts most, and they are the ones whose roles change.
 *
 * So `K` is scaled by the prior's own sample: about two seasons of football is
 * a prior worth its full strength, and less than that is worth proportionally
 * less. Never nothing, because even one season is more than none — a rookie
 * with no finished season at all is already a separate case and takes his year
 * whole.
 */
export const PRIOR_FULL_GP = 30;
export const PRIOR_MIN = 0.25;

/** Per metric, because they do not settle at the same rate. */
export const CURRENT_K: Record<string, number> = {
  /* Role: two thirds of the answer by game four. */
  snap: 2,
  tgt: 2,
  vol: 2,
  /* What he does with it: half by game four. */
  eff: 4,
  ppg: 4,
  ppgAdj: 4,
  /* Scoring: still the slowest, because one big Sunday must not repaint a
     player — which is the whole failure mode of looking at this at all. */
  ltr: 8,
  tdPerGame: 8,
  rzPerGame: 5,
  rzShare: 5,
  tdShare: 8,
  xtdPerGame: 6,
};

export type MetricKey =
  | 'talent' | 'need' | 'value' | 'floor' | 'boom' | 'combo' | 'age' | 'stack' | 'rz'
  | 'scarce' | 'sos';
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
    w: { talent: 0.27, need: 0.15, value: 0.10, floor: 0.07, boom: 0.07, combo: 0, age: 0.06, stack: 0.06, rz: 0.10, scarce: 0.12, sos: 0 },
    copy: 'Weighted by what actually repeats. Opportunity keeps year to year and efficiency mostly does not, so a season\'s points are priced at what its volume was worth rather than taken at face value.',
  },
  floor: {
    label: 'Safe floor',
    w: { talent: 0.20, need: 0.13, value: 0.08, floor: 0.26, boom: 0.03, combo: 0, age: 0.07, stack: 0.05, rz: 0.10, scarce: 0.08, sos: 0 },
    copy: 'I prioritise an established role, volume and red-zone presence. Less variance, less ceiling.',
  },
  upside: {
    label: 'Upside',
    w: { talent: 0.19, need: 0.11, value: 0.07, floor: 0.03, boom: 0.30, combo: 0, age: 0.09, stack: 0.06, rz: 0.08, scarce: 0.07, sos: 0 },
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
  scarce: 'Edge over a replacement at his position',
  sos: 'Strength of schedule',
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
/** Scores move while games are on; a minute is often enough to feel live
 *  without asking Sleeper for the same numbers every few seconds. */
export const MATCHUP_POLL_MS = 45000;
/**
 * How long a week's projections stand before they are re-read.
 *
 * They are not static. Sleeper revises them all week and hardest on a Sunday
 * morning, when a starter is ruled out and his projection goes to nothing —
 * which is the moment the number on the card matters most and the moment it
 * was most likely to be hours old. Not the scores' own cadence, though: a
 * projection that moves on news does not need asking for every forty-five
 * seconds, and this is an undocumented endpoint to be polite to.
 */
export const PROJ_TTL_MS = 5 * 60 * 1000;
/**
 * How long away is long enough that coming back should re-read the league.
 *
 * A home-screen web app is not reloaded for days — iOS suspends it and hands
 * it back exactly as it was. Switching apps for a minute should not cost a
 * round of requests; coming back the next morning should not show yesterday.
 */
export const RESUME_REFRESH_MS = 10 * 60 * 1000;

export const STORAGE_SESSION = 'fc.session';
export const STORAGE_PHOTOS = 'fc.photos';
/** Leagues this device has already handed its own photos over to. Once per
 *  league and never again, so a photo the league takes down is not pushed
 *  back up by whoever still had it cached. */
export const STORAGE_PHOTOS_SENT = 'fc.photos.sent';
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
