import type { CSSProperties } from 'react';
import { ACCENT, BAD, GOOD, MID } from '../model/constants';
import { FS } from './scale';
import { toneOfRank } from '../model/standing';

/** Text tints used all over the prototype, named once. */
export const dim = (a: number) => `rgba(242,253,254,${a})`;

/**
 * The colour a placing is written in. The ONE answer, everywhere.
 *
 * There were four copies of this decision, and none of them agreed. The hero
 * tiles on the team screen coloured their rank by WHICH TILE IT WAS — cyan for
 * strength, blue-violet for quality — so a 1st and a 2nd came out in different
 * colours for reasons that had nothing to do with the ranks. "Rank by position"
 * and the team sheet each had their own thresholds written inline, `<= 3` for
 * good and `>= n - 2` for bad, with the middle painted blue-violet. And
 * everything else in the app used `toneOfRank`, whose whole point is that the
 * middle is UNCOLOURED.
 *
 * On one screen that meant the same blue-violet said "2nd of twelve" in the
 * card at the top and "8th of twelve" four hundred pixels below it. A colour
 * that means both very good and nearly worst is not a colour, and no amount of
 * choosing prettier ones would have fixed it.
 *
 * So: green near the top, salmon near the bottom, and nothing in between —
 * `undefined`, which leaves the figure in the text colour and is the honest
 * answer for a rank that is simply ordinary.
 */
export const placeColor = (
  rank: number | null | undefined,
  of: number | null | undefined,
): string | undefined => {
  const t = toneOfRank(rank, of);
  return t === 'good' ? GOOD : t === 'bad' ? BAD : undefined;
};

/** The same verdict for a bar, which has to be painted something. */
export const placeMark = (
  rank: number | null | undefined,
  of: number | null | undefined,
): 'good' | 'bad' | 'none' => {
  const t = toneOfRank(rank, of);
  return t === 'good' ? 'good' : t === 'bad' ? 'bad' : 'none';
};

export const fitColor = (f: number) => (f >= 75 ? GOOD : f >= 60 ? MID : dim(0.75));

/** The pill that carries a Rating next to a heading. */
export function fitStyle(fit: number): CSSProperties {
  const c = fit >= 75 ? GOOD : fit >= 60 ? MID : dim(0.75);
  return {
    fontSize: 12, fontWeight: 500, padding: '2px 9px', borderRadius: 8, flex: 'none',
    color: c,
    border: '1px solid ' + (fit >= 60 ? c + '55' : 'var(--color-divider)'),
    background: fit >= 60 ? c + '18' : 'transparent',
  };
}

export type SegSize = 'md' | 'sm';

/**
 * A category picker, drawn as tabs rather than as a row of outlined pills.
 *
 * Five outlined chips side by side are five boxes competing with the card they
 * sit on; underlining the chosen one says the same thing with one mark and
 * leaves the row quiet. It also matches how the app this palette came from
 * does it, which is the point of the exercise.
 */
export function seg(active: boolean, size: SegSize = 'md'): CSSProperties {
  return {
    flex: 1,
    textAlign: 'center',
    padding: size === 'sm' ? '6px 3px 5px' : '7px 4px 6px',
    fontSize: size === 'sm' ? FS.micro : FS.small,
    /* Whole pixels, per branch: a ratio here resolved to 14.3 and 14.95. */
    lineHeight: size === 'sm' ? '13px' : '16px',
    // "Free agents" broke across two lines and made the row twice as tall as
    // its neighbour; a two-word option is still one option.
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    border: 0,
    // The underline is the whole of the selected state, so it is drawn on the
    // unselected one too — transparent — or the row jumps 2px as you tap along.
    borderBottom: '2px solid ' + (active ? ACCENT : 'transparent'),
    borderRadius: 0,
    fontWeight: active ? 600 : 400,
    letterSpacing: active ? '.01em' : 0,
    color: active ? ACCENT : dim(0.62),
    background: 'transparent',
    userSelect: 'none',
  };
}

/** Only the part that changes with state — the layout lives in `.tab-btn`,
 *  because it has to become a row on a laptop and inline styles cannot. */
export function tabStyle(on: boolean): CSSProperties {
  return { color: on ? ACCENT : dim(0.52) };
}


export const surface: CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 12,
  padding: '11px 12px',
};

/**
 * The one lifted ground the system allows, used for the hero cards.
 *
 * ONE tone. It used to be a gradient from #1b2e4b to #151f3e with a cyan glow
 * burning in the top corner — three colours in a card whose job is to hold a
 * number still, and the shading was the loudest thing on the screen. Flat, it
 * is a single step above the regular cards: enough to say "this one first" and
 * nothing more.
 */
export const heroCard: CSSProperties = {
  borderRadius: 12,
  padding: 13,
  background: 'var(--color-section)',
  position: 'relative',
  overflow: 'hidden',
};

export const kicker: CSSProperties = {
  fontSize: 10,
  letterSpacing: '.11em',
  textTransform: 'uppercase',
  /* The one lilac left in the app, from the violet palette the cyan replaced —
     a colour belonging to no ramp here, and an inlined hex in a system whose
     tokens file says never to inline one. The accent's light step is the same
     job in this palette's own family. */
  color: 'var(--color-accent-300)',
};

/**
 * A card's heading, measured against the app this look comes from.
 *
 * Sleeper draws the equivalent — the name of the thing the row is about — at
 * about 17px and weight 700; this was 13 and 500, two steps of size and one of
 * weight lighter. Small and light is most of what "not as sharp" turns out to
 * mean: a 500 at 13px lays down barely more ink than the antialiasing around
 * it. Not all the way to theirs, because these cards are denser than their
 * list rows, but the same direction.
 */
export const cardTitle: CSSProperties = { fontSize: 15, fontWeight: 600 };

export const cardNote: CSSProperties = {
  fontSize: 10,
  lineHeight: '14px',
  color: dim(0.52),
  textWrap: 'pretty' as CSSProperties['textWrap'],
};

export const ellipsis: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** Small capsule hint — the system prefers these over paragraphs of help text. */
export const capsule: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 10,
  letterSpacing: '.04em',
  color: dim(0.62),
  background: 'rgba(242,253,254,0.04)',
  borderRadius: 4,
  padding: '4px 8px',
};

export const trackStyle: CSSProperties = {
  height: 6,
  /* Follows its own height — see `R.pill`. A 4px corner on a 6px bar leaves a
     flat 2px in the middle of what is meant to read as a capsule. */
  borderRadius: 999,
  background: 'rgba(242,253,254,0.07)',
  overflow: 'hidden',
};

export const rowDivider = 'var(--hairline) solid var(--color-divider)';

export { ACCENT, GOOD, BAD, MID };
