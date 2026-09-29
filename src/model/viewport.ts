/**
 * Which claim about the viewport's height to believe.
 *
 * An installed iOS copy sometimes reports its window before the system has
 * finished sizing it, and it is short by exactly the top safe area — 793 where
 * the screen is 852, which is the Dynamic Island inset to the pixel. Both of
 * the sources that exist for it, `innerHeight` and a measured `100dvh`, are the
 * same wrong number in that moment, so taking the larger of the two does not
 * help and neither does asking again: on a launch that loses the race they can
 * stay wrong. The band of dead background under the tab bar is that deficit.
 *
 * There is a third source, and on a home-screen app it is the authoritative
 * one: with no browser chrome around it the window IS the screen, so
 * `screen.height` is what the window is going to settle at, and it is right
 * immediately with no race to win. It is only consulted where all of that
 * holds — installed, portrait, and a window as wide as the screen — and only
 * as a correction to a reading that is nearly right already. A browser tab
 * with chrome bars, a rotated phone, or a desktop window on a tall monitor all
 * fail one of those and are left alone, because there the screen is emphatically
 * not the window and believing it would make the app too tall instead.
 */

/** How far past a reading the screen may be and still be a correction to it. */
export const SCREEN_TRUST = 1.15;

export type Reading = {
  /** `window.innerHeight`. */
  inner: number;
  /** A measured `100dvh`. */
  dvh: number;
  /** `screen.height`, and the width beside it, both in CSS pixels. */
  screen: number;
  screenW: number;
  innerW: number;
  /** Installed to the home screen, so nothing is drawn around the window. */
  standalone: boolean;
};

export function bestHeight(r: Reading, trust = SCREEN_TRUST): number {
  const seen = Math.max(r.inner || 0, r.dvh || 0);
  if (!r.standalone || !(seen > 0)) return seen;
  // Portrait, and filling the screen sideways. Either failing means the screen
  // is not what this window is about to be.
  if (!(r.innerW > 0) || r.innerW !== r.screenW || !(seen > r.innerW)) return seen;
  const s = r.screen || 0;
  return s > seen && s <= seen * trust ? s : seen;
}
