/**
 * service worker — network-first for navigations, cache-first for hashed
 * static assets, network-only for API/auth.
 *
 * #4812: app shell was cache-first with a never-bumped version, so a new
 * deploy kept serving the stale index.html → old hashed bundles → dashboard
 * looped on login forever. Navigations are now network-first so index.html
 * always re-fetches (picking up new asset hashes); hashed assets stay
 * cache-first because their filenames are content-addressed.
 */

const CACHE_NAME = 'aegis-dashboard-v2';
const APP_SHELL = [
  '/dashboard',
  '/dashboard/',
  '/dashboard/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET.
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  const pathname = url.pathname;

  // API, auth, SSE, and events are never cached (live data).
  if (
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/auth/') ||
    pathname.endsWith('/events')
  ) {
    return;
  }

  // Navigations (HTML): network-first so a fresh deploy's index.html wins,
  // falling back to cache only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/dashboard/index.html'))
        )
    );
    return;
  }

  // Static assets: cache-first (filenames are content-hashed → immutable).
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
