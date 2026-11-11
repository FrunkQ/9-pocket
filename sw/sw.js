// Service worker: lets the app open with no connection.
//
// The build fills in __VERSION__ and the list of files that make up the app
// (see vite.config.ts). Those are stored when this worker installs, so the
// next visit works offline. Each deploy produces a new version, which
// replaces the old stored copy.
const VERSION = '__VERSION__';
const SHELL = `ninepocket-shell-${VERSION}`;
// Things fetched as they are needed and worth keeping between versions:
// hockey set files, web fonts, the text reader.
const RUNTIME = 'ninepocket-runtime-v1';
const FILES = '__FILES__';

// Stored copies are matched by address alone. Servers often mark files as
// varying by the Origin header, and a page's own script and stylesheet
// requests carry that header while the copy stored at install does not.
const ANY = { ignoreVary: true };

const KEEP_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('ninepocket-shell-') && name !== SHELL) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** The page itself: fresh when online, the stored copy when not. */
async function page(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL);
    return (await cache.match('index.html', ANY)) ?? (await cache.match('./', ANY)) ?? Response.error();
  }
}

/** Stored copy if there is one; otherwise fetch it and keep it. */
async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request, ANY);
  if (hit) return hit;
  const response = await fetch(request);
  // Opaque responses are scripts loaded cross-origin without CORS (the text reader).
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(cacheName);
    void cache.put(request, response.clone());
  }
  return response;
}

/** Stored copy straight away, refreshed in the background for next time. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request, ANY);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return hit ?? (await fresh) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/catalog/')) event.respondWith(staleWhileRevalidate(request));
    else event.respondWith(cacheFirst(request, SHELL));
    return;
  }
  if (KEEP_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request, RUNTIME));
  // Everything else (card databases, card pictures) goes to the network as normal.
});
