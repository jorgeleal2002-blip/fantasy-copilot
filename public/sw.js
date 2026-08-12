/* Keeps a home-screen copy current without a reinstall.
 *
 * Vite fingerprints every asset, so a new build lands on new filenames and the
 * only file that can go stale is the HTML entry that points at them — an
 * installed iOS web app will happily serve a months-old index.html and its
 * long-gone bundle. So the entry is fetched with revalidation forced on every
 * launch, and the cached copy exists only for a phone with no signal. */
const CACHE = 'copilot-shell-v1';
const SHELL = './index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.add(new Request(SHELL, { cache: 'reload' }))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // 'no-cache' still revalidates rather than refetching whole — a 304 on
        // an unchanged deploy, the new entry the moment there is one.
        const fresh = await fetch(request.url, { cache: 'no-cache' });
        const cache = await caches.open(CACHE);
        await cache.put(SHELL, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(SHELL)) ?? Response.error();
      }
    })());
    return;
  }

  // Hashed filenames can never go stale, so serving them from the cache is
  // safe and keeps the shell rendering when the network is gone.
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.includes('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, res.clone());
      }
      return res;
    })());
  }
});
