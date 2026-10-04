const CACHE_NAME = 'thaalam-24x7-v159';
const ALBUM_ART_CACHE_NAME = 'thaalam-album-art-v1';
const ALBUM_ART_CACHE_LIMIT = 240;

const APP_FILES = [
  './',
  './index.html',
  './style.css?v=129',
  './script.js?v=39',
  './audio-recovery.js?v=2',
  './marquee.js?v=3',
  './media-metadata.js?v=7',
  './player-controls.js?v=33',
  './youtube-player.js?v=48',
  './lyrics.js?v=32',
  './manifest.json',
  './album-placeholder.svg?v=2',
  './icon-192.png?v=3',
  './icon-512.png?v=3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) =>
            cacheName !== CACHE_NAME && cacheName !== ALBUM_ART_CACHE_NAME
          )
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.origin !== self.location.origin) {
    if (
      !url.hostname.endsWith('.mzstatic.com') ||
      !url.pathname.includes('/image/thumb/')
    ) return;

    event.respondWith(fetchAndCacheAlbumArt(request));
    return;
  }

  if (url.pathname.includes('/api/') || url.pathname.includes('/hls/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) =>
              cache.put('./index.html', copy)
            );
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match('./index.html');
          return cachedPage || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => cachedResponse || fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) =>
              cache.put(request, copy)
            );
          }
          return response;
        }))
  );
});

async function fetchAndCacheAlbumArt(request) {
  let cache;
  try {
    cache = await caches.open(ALBUM_ART_CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;
  } catch {
    return fetch(request);
  }

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    try {
      const cachedRequests = await cache.keys();
      const expiredRequests = cachedRequests.slice(
        0,
        Math.max(0, cachedRequests.length - ALBUM_ART_CACHE_LIMIT + 1)
      );
      await Promise.all(expiredRequests.map((cachedRequest) => cache.delete(cachedRequest)));
      await cache.put(request, response.clone());
    } catch {
    }
  }
  return response;
}
