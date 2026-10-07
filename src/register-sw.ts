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
        if (document.visibilityState === 'visible') { void reg.update(); void checkBuild(); }
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

/* The worker only changes when sw.js does, which a new build of the app does
 * not touch — and an iPhone brings a home-screen app back from the background
 * without loading the page again, so it kept showing the old app for days. On
 * every return the entry page is asked for again and, if it points at a
 * different bundle from the one running, the app reloads into it. */
let checking = false;
async function checkBuild() {
  if (checking) return;
  checking = true;
  try {
    const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!mine) return;
    const res = await fetch('./index.html', { cache: 'no-cache' });
    if (!res.ok) return;
    const html = await res.text();
    const next = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1];
    if (next && new URL(next, location.href).href !== mine) window.location.reload();
  } catch {
    /* offline: the next return tries again */
  } finally {
    checking = false;
  }
}
