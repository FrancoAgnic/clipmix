/* Service Worker de ClipMix
 * Estrategia "red primero" para el app shell: con internet siempre trae lo
 * más nuevo (auto-actualización); sin internet usa lo cacheado.
 */
const CACHE = 'clipmix-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './webm-duration.js',
  './store.js',
  './vendor/mp4-muxer.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // videos blob: no pasan por aquí

  // Red primero: intenta la versión más reciente, cae al caché si no hay internet.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
