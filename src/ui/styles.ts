import type { CSSProperties } from 'react';
import { ACCENT, BAD, GOOD, MID } from '../model/constants';

/**
 * A film of noise, tiled at 140px and about 3% strong.
 *
 * A long, low-contrast wash across a dark card has only a handful of 8-bit
 * steps to cross, so instead of fading it draws visible stripes — the thing
 * that makes a dark app look cheap on a screen good enough to show it.
 * Dithering breaks the step edges apart and the stripes disappear. It costs one
 * inline SVG and no DOM.
 */
export const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E"
  + "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' "
  + "stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' "
  + "opacity='0.55'/%3E%3C/svg%3E\")";

/** Text tints used all over the prototype, named once. */
export const dim = (a: number) => `rgba(233,233,237,${a})`;

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

/** Outlined segmented option — the system's one selection control. */
export function seg(active: boolean, size: SegSize = 'md'): CSSProperties {
  return {
    flex: 1,
    textAlign: 'center',
    padding: size === 'sm' ? '5px 3px' : '6px 4px',
    borderRadius: size === 'sm' ? 8 : 9,
    fontSize: size === 'sm' ? 11 : 11.5,
    lineHeight: 1.3,
    // "Free agents" broke across two lines and made the row twice as tall as
    // its neighbour; a two-word option is still one option.
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    border: '1px solid ' + (active ? ACCENT : 'var(--color-divider)'),
    color: active ? ACCENT : dim(0.6),
    background: active ? 'rgba(145,132,217,.12)' : 'transparent',
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
    background: 'rgba(145,132,217,.14)' + (photo ? ` url(${photo}) center/cover no-repeat` : ''),
  };
}

export const surface: CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 12,
  padding: '11px 12px',
};

/** The one saturated ground the system allows, used for the two hero cards. */
export const heroCard: CSSProperties = {
  borderRadius: 14,
  padding: 13,
  // The noise film sits over the gradient — see NOISE.
  background: `${NOISE}, linear-gradient(150deg,#262a60 0%,#232532 62%)`,
  position: 'relative',
  overflow: 'hidden',
};

export const heroGlow: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: `${NOISE}, radial-gradient(220px 120px at 88% 0%,rgba(145,132,217,.32),transparent 70%)`,
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
  background: 'rgba(233,233,237,.05)',
  borderRadius: 6,
  padding: '4px 8px',
};

export const trackStyle: CSSProperties = {
  height: 6,
  borderRadius: 3,
  background: 'rgba(233,233,237,.08)',
  overflow: 'hidden',
};

export const rowDivider = '1px solid var(--color-divider)';

export { ACCENT, GOOD, BAD, MID };
