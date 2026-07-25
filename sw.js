var CACHE_NAME = 'storm-cache-v1';

var SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './roster.json',
  './icons/icon-180.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    fetch('./roster.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; })
      .then(function (roster) {
        var songFiles = (roster || []).map(function (p) { return './' + p.file; });
        var allFiles = SHELL_FILES.concat(songFiles);
        return caches.open(CACHE_NAME).then(function (cache) {
          return Promise.all(
            allFiles.map(function (url) {
              return cache.add(url).catch(function (err) {
                console.warn('Storm SW: could not precache', url, err);
              });
            })
          );
        });
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request)
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
          }
          return response;
        })
        .catch(function () { return cached; });

      return cached || networkFetch;
    })
  );
});
