// Service worker: offline app shell + automatic updates.
// Bump VERSION (and add an entry at the top of changelog.js) for every release.
// Any change to this file makes phones install the new version automatically.
const VERSION = '1.7.5';
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

// Push notifications (sent by the Apps Script through Firebase Cloud Messaging as data messages).
// Receipts: the phone tells the Apps Script when a notification arrived and when it was tapped,
// so the "_推送记录" tab shows the real times per phone. Needs no password (only an unguessable id).
const scriptUrl = () => caches.match('config.js', { ignoreSearch: true })
  .then((r) => r || fetch('config.js'))
  .then((r) => r.text())
  .then((t) => (t.match(/SCRIPT_URL:\s*['"]([^'"]+)['"]/) || [])[1] || '');
const ack = (rid, kind) => (!rid ? Promise.resolve() : scriptUrl()
  .then((u) => u && fetch(u, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'pushAck', rid, kind }) }))
  .catch(() => {}));
self.addEventListener('push', (e) => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || j.notification || j; } catch (err) { d = {}; }
  const title = d.title || 'Durimage';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    tag: d.tag || undefined, renotify: !!d.tag, data: { link: d.link || './', rid: d.rid || '' },
  }).then(() => ack(d.rid, 'recv'))); // shown first; the receipt never delays the notification
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || './';
  e.waitUntil(Promise.all([
    ack(e.notification.data && e.notification.data.rid, 'open'),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.postMessage({ type: 'open', link }); return c.focus(); }
      return self.clients.openWindow(link);
    }),
  ]));
});
