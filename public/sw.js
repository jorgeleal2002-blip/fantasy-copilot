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
      // A launch on a weak signal used to fail once and silently hand back
      // whatever entry was cached — the old app, with no sign anything had
      // gone wrong. One retry covers the radio still waking up.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // 'no-cache' still revalidates rather than refetching whole — a 304
          // on an unchanged deploy, the new entry the moment there is one.
          const fresh = await fetch(request.url, { cache: 'no-cache' });
          const cache = await caches.open(CACHE);
          await cache.put(SHELL, fresh.clone());
          return fresh;
        } catch {
          if (attempt === 0) await new Promise(r => setTimeout(r, 600));
        }
      }

      // Genuinely offline. Serve the last entry seen so the shell renders,
      // and keep looking so the next launch is current.
      event.waitUntil((async () => {
        try {
          const late = await fetch(request.url, { cache: 'no-cache' });
          const cache = await caches.open(CACHE);
          await cache.put(SHELL, late.clone());
        } catch {
          /* still offline — the next launch tries again */
        }
      })());

      return (await caches.match(SHELL)) ?? Response.error();
    })());
    return;
  }

  /* Media asks for byte ranges, and this cache cannot serve them.
   *
   * An <audio> element does not fetch a file, it asks for a slice of one, and
   * two things then go wrong here. `caches.match` ignores the Range header, so
   * a cached whole file comes back as a 200 to a request that asked for part
   * of one — which Safari refuses for media. And `cache.put` THROWS on a 206,
   * so storing the network's reply rejects, the rejection escapes into
   * respondWith, and the request fails outright rather than falling back.
   *
   * That is what silenced the opening sound: the file never loaded, so play()
   * was rejected for an unsupported source, which looks from the outside
   * exactly like a browser blocking autoplay.
   *
   * A range request is small, it only happens while something is playing, and
   * it is not what this cache exists for. It goes straight to the network. */
  if (request.headers.has('range')) return;

  // Hashed filenames can never go stale, so serving them from the cache is
  // safe and keeps the shell rendering when the network is gone.
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.includes('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      // Only a complete reply may be stored: `cache.put` rejects a 206, and an
      // unhandled rejection in here fails the request instead of the cache.
      if (res.ok && res.status === 200) {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(request, res.clone());
        } catch {
          /* out of quota, or a response that cannot be stored — serve it anyway */
        }
      }
      return res;
    })());
  }
});
