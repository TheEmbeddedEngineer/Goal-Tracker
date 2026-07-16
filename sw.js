// Cache-first for the app shell, updated ONLY as a whole via a new CACHE_NAME (so a
// page load can never mix JS modules from two different deploys — version skew across
// ES modules kills the boot). Any shell change therefore requires a CACHE_NAME bump;
// the activate handler announces the new version to open pages. Firebase/CDN requests
// are cross-origin and pass through untouched — Firestore sync is never cached.
const CACHE_NAME = 'couple-tracker-v26';
const APP_SHELL = [
  './', './index.html', './styles.css',
  './js/core.js', './js/data.js', './js/shared.js', './js/app.js',
  './js/weekly/state.js', './js/weekly/sync.js', './js/weekly/ui.js', './js/weekly/index.js',
  './js/calories/state.js', './js/calories/sync.js', './js/calories/log.js',
  './js/calories/metrics.js', './js/calories/bank.js', './js/calories/insights.js',
  './js/calories/scan.js', './js/calories/index.js', './js/vendor/zxing.min.js',
  './js/training/state.js', './js/training/sync.js', './js/training/overview.js',
  './js/training/day.js', './js/training/render.js', './js/training/index.js',
  './icon-weekly.png', './icon-192.png', './icon-512.png', './manifest.json'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the browser's HTTP cache so the new version's files
  // are fetched fresh, not assembled from possibly-stale cached responses.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(APP_SHELL.map(u => new Request(u, { cache: 'reload' })))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      const oldCaches = keys.filter(k => k !== CACHE_NAME);
      return Promise.all(oldCaches.map(k => caches.delete(k))).then(() => {
        // Most deploys change JS/CSS (and bump CACHE_NAME) without touching
        // index.html, so the etag check in the fetch handler never fires for them.
        // A new CACHE_NAME activating over an old cache IS the update signal —
        // tell open pages so they get the refresh toast. Skip on first-ever
        // install (no old cache), where there's nothing to update from.
        if (oldCaches.length === 0) return;
        return self.clients.matchAll({ type: 'window' })
          .then(clients => clients.forEach(c => c.postMessage('update-available')));
      });
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  // Serve the shell cache-first from the atomically installed CACHE_NAME. No
  // per-file revalidation into the running cache: that used to let one deploy's
  // files mix with another's mid-update. A miss (e.g. after a manual cache wipe)
  // falls back to the network and repopulates.
  const key = event.request.mode === 'navigate' ? './index.html' : event.request;
  event.respondWith(
    caches.match(key).then(cached => cached || fetch(event.request).then(networkResponse => {
      if (networkResponse.ok) {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(key, clone));
      }
      return networkResponse;
    }))
  );
});
