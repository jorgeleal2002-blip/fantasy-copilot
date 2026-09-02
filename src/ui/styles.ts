import type { CSSProperties } from 'react';
import { ACCENT, BAD, GOOD, MID } from '../model/constants';

/** Text tints used all over the prototype, named once. */
export const dim = (a: number) => `rgba(242,253,254,${a})`;

export const fitColor = (f: number) => (f >= 75 ? GOOD : f >= 60 ? MID : dim(0.6));

/** The pill that carries a Fit Score next to a heading. */
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

/** Position chip that doubles as the player's portrait once one is available. */
export function posBadge(photo: string | null): CSSProperties {
  return {
    width: 34, height: 34, flex: 'none', borderRadius: 9,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 600, letterSpacing: '.04em',
    color: photo ? 'transparent' : ACCENT,
    background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' + (photo ? ` url(${photo}) center/cover no-repeat` : ''),
  };
}

export const surface: CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 12,
  padding: '11px 12px',
};

/**
 * The dashboard surface: the page itself, with a line drawn round it.
 *
 * It replaces a filled gradient card with a glow in the corner. Every number
 * worth reading in this app sits on one of these, and a saturated ground under
 * a figure is a second thing competing with it — the reference draws the same
 * card as an outline and nothing else, and the figure is the only lit object in
 * it. Measured off that card: 70px tall for two lines, 12px radius, 1px border,
 * and a fill identical to the ground behind it.
 */
export const panel: CSSProperties = {
  borderRadius: 12,
  padding: '14px 14px',
  background: 'transparent',
  border: '1px solid var(--color-outline)',
};

/** The headline of one: caps, bold, beside its icon, centred. */
export const panelTitle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 9,
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  lineHeight: 1.25,
  color: 'var(--color-text)',
};

/**
 * The line under it.
 *
 * Deliberately much brighter than this app's usual muted text: measured on the
 * reference it is #ccdaf2, 14:1 against the ground, because on a card with no
 * fill the second line is content and not a footnote. The neutral ramp already
 * has that value.
 */
export const panelNote: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.3,
  marginTop: 5,
  textAlign: 'center',
  color: 'var(--color-neutral-300)',
  textWrap: 'pretty' as CSSProperties['textWrap'],
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
