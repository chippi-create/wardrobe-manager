// アプリ本体をキャッシュして、オフラインでも開けるようにする。
// ファイルを更新したら CACHE のバージョンを上げる。
const CACHE = 'wardrobe-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/db.js',
  './js/image.js',
  './js/categories.js',
  './js/suggest.js',
  './js/weather.js',
  './js/listing.js',
  './js/autofill.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// ネットにつながるときは最新版を取り、つながらないときはキャッシュを使う
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
