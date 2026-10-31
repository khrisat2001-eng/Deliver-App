// Service worker: lets the apps open without internet and be installed on Android / iOS.
// - Site files: network first, cache as fallback. Always fresh when online, so a deploy never mixes
//   old and new modules; offline (or a very slow network) the cached copy is used.
// - OpenStreetMap tiles: cache-first with a size cap, so recently viewed areas still show offline.
// - Routing / search APIs: always network (the app has its own offline fallbacks).
const VERSION = 'v1';
const SITE = `ride-site-${VERSION}`;
const TILES = `ride-tiles-${VERSION}`;
const MAX_TILES = 600;

const PRECACHE = [
  './', 'index.html', 'passenger.html', 'driver.html', 'admin.html',
  'passenger.webmanifest', 'driver.webmanifest', 'assets/css/app.css', 'assets/icon.svg',
  'assets/vendor/leaflet/leaflet.js', 'assets/vendor/leaflet/leaflet.css',
  'assets/locales/ar.json', 'assets/locales/en.json', 'assets/locales/ckb.json',
  'assets/js/passenger.js', 'assets/js/driver.js', 'assets/js/admin.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SITE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SITE, TILES].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); trimTiles(); }
      return res;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(SITE);
    try {
      const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
