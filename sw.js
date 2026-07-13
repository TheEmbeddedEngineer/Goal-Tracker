// Stale-while-revalidate for the app shell only. Firebase/CDN requests are cross-origin
// and pass through untouched — Firestore sync must never be served from cache.
const CACHE_NAME = 'couple-tracker-v2';
const APP_SHELL = [
  './', './index.html', './styles.css',
  './js/core.js', './js/data.js', './js/shared.js', './js/weekly.js',
  './js/calories.js', './js/training.js', './js/app.js',
  './icon-weekly.png', './icon-192.png', './icon-512.png', './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  // Stale-while-revalidate means a deploy only shows up one load late — so when the
  // background revalidation of the app shell fetches a changed copy (etag differs),
  // tell the open pages so they can offer a one-tap refresh instead of silently
  // running the previous version.
  const isShell = event.request.mode === 'navigate' || url.pathname.endsWith('/index.html');
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        const putDone = caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse.clone()));
        if (isShell && cached) {
          const oldTag = cached.headers.get('etag') || cached.headers.get('last-modified');
          const newTag = networkResponse.headers.get('etag') || networkResponse.headers.get('last-modified');
          if (oldTag && newTag && oldTag !== newTag) {
            putDone
              .then(() => self.clients.matchAll({ type: 'window' }))
              .then(clients => clients.forEach(c => c.postMessage('update-available')));
          }
        }
        return networkResponse;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
