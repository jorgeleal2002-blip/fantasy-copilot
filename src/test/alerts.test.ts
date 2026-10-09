/**
 * Which of the two alert mechanisms owns a given play.
 *
 * There are two now and they overlap. The app, while it is open, diffs the
 * live stat feed and can show anything it finds. The watcher in /worker,
 * whether or not the app is running, pushes touchdowns by your starters and
 * only those. Where they overlap, exactly one of them must put a bubble on the
 * lock screen — and it has to be the watcher's, because that is the one that
 * also arrives when the app is shut.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERTS, watcherHandles, type AlertPrefs } from '../ui/alert-prefs';

const prefs = (over: Partial<AlertPrefs> = {}): AlertPrefs => ({ ...DEFAULT_ALERTS, ...over });

describe('who sends the phone notification', () => {
  it('leaves a starter’s touchdown to the watcher once this phone is subscribed', () => {
    expect(watcherHandles(prefs({ push: true }), true, true)).toBe(true);
  });

  /* Everything the watcher does not send, the app must — otherwise turning
     push on would silently take away alerts that used to arrive. */
  it('keeps a big play, which the watcher never sends', () => {
    expect(watcherHandles(prefs({ push: true }), false, true)).toBe(false);
  });
  it('keeps an opponent’s touchdown, which the watcher never sends', () => {
    expect(watcherHandles(prefs({ push: true }), true, false)).toBe(false);
  });
  it('keeps everything when this phone is not subscribed', () => {
    for (const td of [true, false]) {
      for (const mine of [true, false]) {
        expect(watcherHandles(prefs({ push: false }), td, mine)).toBe(false);
      }
    }
  });

  /* The default has to be the safe one: a build with no watcher behind it,
     or a phone that never subscribed, must still get its own notifications. */
  it('is off by default, so a fresh install loses nothing', () => {
    expect(DEFAULT_ALERTS.push).toBe(false);
    expect(watcherHandles(DEFAULT_ALERTS, true, true)).toBe(false);
  });

  /* Chat messages have no in-app banner at all — the app shows them in the
     chat itself — so they are the watcher's alone and never reach this
     decision. Pinned so that adding a banner later cannot quietly start
     double-notifying. */
  it('is on by default for chat, which only ever travels by push', () => {
    expect(DEFAULT_ALERTS.chat).toBe(true);
    expect(DEFAULT_ALERTS.chatTags).toBe(false);
    // and still nothing is sent, because the subscription is what gates it
    expect(DEFAULT_ALERTS.push).toBe(false);
  });

  /* `push` is not `phone`. One is a real subscription delivered by the phone's
     push service; the other is the app showing a notification from its own
     polling, which iOS suspends the moment the app leaves the screen. A build
     that conflated them would go quiet exactly when it mattered. */
  it('does not follow from phone notifications merely being on', () => {
    expect(watcherHandles(prefs({ phone: true, push: false }), true, true)).toBe(false);
  });
});
