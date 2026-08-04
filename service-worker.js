/*
 * BrewOS service worker — v2 update strategy.
 *
 * The old version cached the app shell (index.html/app.js/style.css)
 * "cache-first", which meant that once those files were cached, they were
 * served from cache FOREVER, even after a new version was deployed and this
 * service worker itself had updated. That's why updates required manually
 * clearing all site data in Safari — which also wipes IndexedDB (your beer
 * collection) as collateral damage.
 *
 * Fix: the app-shell code files now use "network-first" — always try to
 * fetch the freshest version when online, and only fall back to the cached
 * copy if there's no connection. Large, rarely-changing assets (icons, the
 * launch video) still use cache-first, since re-downloading those on every
 * visit would be wasteful. None of this ever touches IndexedDB.
 */
const CACHE_NAME = 'brewos-shell-v4';

const APP_SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json'];
const STATIC_ASSETS = ['./icon-192.png', './icon-512.png', './apple-touch-icon.png', './pour.mp4'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([...APP_SHELL, ...STATIC_ASSETS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppShellRequest(url) {
  return APP_SHELL.some(path => url.endsWith(path.replace('./', '')) || (path === './' && (url.endsWith('/') )));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  if (isAppShellRequest(url)) {
    // Network-first: always get the latest code when online.
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first: large static assets that rarely change.
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(() => {});
          return resp;
        }).catch(() => cached);
      })
    );
  }
});
