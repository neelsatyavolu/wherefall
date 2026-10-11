// Wherefall's service worker: it keeps the app shell so an installed Wherefall starts without a network,
// and nothing else. It answers only two kinds of request, both from this site:
//   - page loads: from the network first, so a deploy is never hidden behind an old page; the
//     copy kept from the last visit is only for when there is no network at all;
//   - the built files under /assets/, whose names change with their content: kept once fetched.
// Everything else (the API, the lists of places, map tiles, Google, Panoramax) is not touched: the
// worker does not answer those requests, so the browser makes them as if it were not there.
const VERSION = 'plonk-shell-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(new Request(SHELL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

// a new version of this file clears whatever an older one kept
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

async function pageFromNetworkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      await cache.put(SHELL, fresh.clone());
    }
    return fresh;
  } catch {
    return (await cache.match(SHELL)) ?? Response.error();
  }
}

async function assetFromCacheFirst(request) {
  const cache = await caches.open(VERSION);
  const kept = await cache.match(request);
  if (kept) {
    return kept;
  }
  const fresh = await fetch(request);
  if (fresh.ok) {
    await cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(pageFromNetworkFirst(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(assetFromCacheFirst(request));
  }
});
