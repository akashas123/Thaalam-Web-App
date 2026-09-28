const CACHE_NAME = 'thaalam-24x7-v7';

const APP_FILES = [
  './',
  './index.html',
  './style.css?v=34',
  './script.js?v=23',
  './audio-recovery.js?v=1',
  './marquee.js?v=2',
  './media-metadata.js?v=5',
  './player-controls.js?v=28',
  './lyrics.js?v=27',
  './manifest.json',
  './album-placeholder.svg?v=2',
  './icon-192.png',
  './icon-512.png',
  './logo.png'
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
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.includes('/api/') ||
    url.pathname.includes('/hls/')
  ) {
    return;
  }

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
    caches.match(request, { ignoreSearch: true })
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
