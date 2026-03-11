const CACHE_NAME = 'vault-cache-v2';

const urlsToCache = [
  '/my-vault/',
  '/my-vault/index.html',
  '/my-vault/style.css',
  '/my-vault/script.js',
  '/my-vault/icon.png',
  '/my-vault/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});