/* Publishes the real viewport height as --app-h.
 *
 * `100dvh` is resolved once at launch, and an installed iOS copy sometimes
 * reports its window before the system has finished sizing it — the height
 * sticks at the wrong value and nothing recalculates it, so the shell ends up
 * short and a band of background shows under the tab bar. Whether that race is
 * lost varies per launch, which is why the gap comes and goes.
 *
 * Measuring from JS costs nothing and can be repeated: on resize, on rotation,
 * and every time the app is resumed. The CSS keeps `100dvh` as its fallback,
 * so a failure here leaves the app exactly as it was rather than broken. */

/**
 * What the browser itself thinks `100dvh` is, right now.
 *
 * `window.innerHeight` was the only source, and on a launch that loses the race
 * it is short by exactly the top safe area — measured off a phone that showed
 * the fault: 793 where the screen is 852, a 59px deficit that is precisely the
 * Dynamic Island inset. A second, independent reading of the same quantity
 * costs one hidden element and makes that case correct itself immediately,
 * with no timer to win.
 *
 * The element is measured and removed within the same call. Left in the
 * document it is one more thing for a layout pass to walk.
 */
function dvhNow(): number {
  try {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:100dvh;'
      + 'pointer-events:none;visibility:hidden;contain:strict';
    document.documentElement.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return h;
  } catch {
    return 0;
  }
}

export function trackViewportHeight() {
  /* The tallest reading seen AT THIS WIDTH.
   *
   * Every way this goes wrong makes the app too SHORT — a viewport reported
   * before the system finished sizing it, a chrome bar that has not collapsed
   * yet — so a later, larger reading is always the better one and a later,
   * smaller one is always suspect. Except after a rotation, where a smaller
   * height is the honest answer; the width changes there, and nowhere else, so
   * the width is what resets it.
   *
   * This also settles what the old code left to a comment: an on-screen
   * keyboard shrinks the window on some platforms, and the shell should not
   * squash while you type. Under this rule it cannot.
   */
  let bestFor = -1;
  let best = 0;

  const apply = () => {
    try {
      const w = window.innerWidth;
      if (w !== bestFor) { bestFor = w; best = 0; }
      const h = Math.round(Math.max(window.innerHeight || 0, dvhNow()));
      if (h <= best) return;
      best = h;
      document.documentElement.style.setProperty('--app-h', `${h}px`);
    } catch {
      /* leave the CSS fallback in place */
    }
  };

  apply();

  /* The launch race is the whole point, and its timing varies per launch — so
   * this samples across the whole window in which it can be lost rather than
   * betting on one moment. Ten reads of two numbers is nothing, and they stop
   * after three seconds. */
  [0, 60, 120, 250, 400, 600, 900, 1300, 2000, 3000].forEach(ms => setTimeout(apply, ms));
  let frames = 0;
  const onFrame = () => {
    apply();
    if (++frames < 30) requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);

  addEventListener('load', apply);
  addEventListener('resize', apply);
  addEventListener('orientationchange', apply);
  addEventListener('pageshow', apply);
  visualViewport?.addEventListener('resize', apply);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') apply();
  });
}
