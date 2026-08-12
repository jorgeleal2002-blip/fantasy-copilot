/* Registers the worker that keeps an installed copy fresh, and reloads once
 * when a newer build takes over so the phone never sits on an old bundle. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').then(reg => {
      // A launch is the moment to look for a new build; iOS keeps web apps
      // suspended for days at a time, so nothing else would prompt the check.
      void reg.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update();
      });
    }).catch(() => {
      /* No worker means no auto-update, which is how the app shipped — the
         page itself still works, so there is nothing to report. */
    });
  });

  // Only a *replacement* warrants a reload. On the very first visit there is
  // no controller yet, and reloading there would restart a healthy page.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}
