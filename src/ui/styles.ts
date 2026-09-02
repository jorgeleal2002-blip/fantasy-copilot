import type { CSSProperties } from 'react';
import { ACCENT, BAD, GOOD, MID } from '../model/constants';

/** Text tints used all over the prototype, named once. */
export const dim = (a: number) => `rgba(242,253,254,${a})`;

export const fitColor = (f: number) => (f >= 75 ? GOOD : f >= 60 ? MID : dim(0.6));

/** The pill that carries a Rating next to a heading. */
export function fitStyle(fit: number): CSSProperties {
  const c = fit >= 75 ? GOOD : fit >= 60 ? MID : dim(0.55);
  return {
    fontSize: 12.5, fontWeight: 500, padding: '2px 9px', borderRadius: 7, flex: 'none',
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
    fontSize: size === 'sm' ? 11 : 11.5,
    lineHeight: 1.3,
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
    color: active ? ACCENT : dim(0.45),
    background: 'transparent',
    userSelect: 'none',
  };
}

/** Only the part that changes with state — the layout lives in `.tab-btn`,
 *  because it has to become a row on a laptop and inline styles cannot. */
export function tabStyle(on: boolean): CSSProperties {
  return { color: on ? ACCENT : dim(0.4) };
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
  borderRadius: 14,
  padding: 13,
  background: 'var(--color-section)',
  position: 'relative',
  overflow: 'hidden',
};

export const kicker: CSSProperties = {
  fontSize: 10,
  letterSpacing: '.11em',
  textTransform: 'uppercase',
  color: '#b3a9e6',
};

export const cardTitle: CSSProperties = { fontSize: 13, fontWeight: 500 };

export const cardNote: CSSProperties = {
  fontSize: 11,
  lineHeight: 1.45,
  color: dim(0.42),
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
  color: dim(0.45),
  background: 'rgba(242,253,254,.05)',
  borderRadius: 6,
  padding: '4px 8px',
};

export const trackStyle: CSSProperties = {
  height: 6,
  borderRadius: 3,
  background: 'rgba(242,253,254,.08)',
  overflow: 'hidden',
};

export const rowDivider = '1px solid var(--color-divider)';

export { ACCENT, GOOD, BAD, MID };
