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
export function trackViewportHeight() {
  const apply = () => {
    try {
      // innerHeight, not visualViewport: the latter shrinks around the
      // on-screen keyboard, which would squash the shell while typing.
      const h = Math.round(window.innerHeight);
      if (h > 0) document.documentElement.style.setProperty('--app-h', `${h}px`);
    } catch {
      /* leave the CSS fallback in place */
    }
  };

  apply();

  // The launch race is the whole point: re-measure once the first frame has
  // painted and again shortly after, by which time iOS has settled.
  requestAnimationFrame(apply);
  setTimeout(apply, 300);
  setTimeout(apply, 1200);

  addEventListener('resize', apply);
  addEventListener('orientationchange', apply);
  addEventListener('pageshow', apply);
  visualViewport?.addEventListener('resize', apply);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') apply();
  });
}
