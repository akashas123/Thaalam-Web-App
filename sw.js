const CACHE_NAME = 'thaalam-24x7-v1160';
const ALBUM_ART_CACHE_NAME = 'thaalam-album-art-v2';
const ALBUM_ART_CACHE_LIMIT = 240;

const APP_FILES = [
  './',
  './index.html',
  './Documentation/Documentation.html',
  './style.css?v=839',
  './script.js?v=98',
  './audio-recovery.js?v=3',
  './marquee.js?v=4',
  './media-metadata.js?v=18',
  './recommendation-engine.js?v=5',
  './player-controls.js?v=62',
  './ondemand-player.js?v=246',
  './storage-maintenance.js?v=1',
  './lyrics.js?v=56',
  './manifest.json',
  './album-placeholder.svg?v=3',
  './silent.wav?v=1',
  './thaalam-icon-192.png?v=8',
  './thaalam-icon-512.png?v=8',
  './Google.png',
  './Login-background.mp4'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      // Downloaded updates should be ready for the next app open without
      // prompting or interrupting the listener's current session.
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
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'GET_THAALAM_CACHE_VERSION') return;
  event.source?.postMessage({ type: 'THAALAM_CACHE_VERSION', cacheName: CACHE_NAME });
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
