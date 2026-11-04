// Service worker: offline app shell + automatic updates.
// Bump VERSION (and add an entry at the top of changelog.js) for every release.
// Any change to this file makes phones install the new version automatically.
const VERSION = '1.3.2';
const CACHE = 'durimage-' + VERSION;
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'i18n.js', 'config.js', 'changelog.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/mark.svg', 'vendor/qrcode.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser HTTP cache so the new version really is new.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Our own files: network first (revalidated, so updates show up), cache when offline.
// Google APIs and uploads are never touched.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    // Navigations are fetched as-is (some browsers reject or alter a navigate request given options).
    fetch(e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' }))
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
