var CACHE_NAME = 'storm-cache-v37';
var NETWORK_FIRST_FILES = ['./', './index.html', './css/style.css', './js/app.js', './manifest.json', './roster.json', './soundboard.json'];

var SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './roster.json',
  './soundboard.json',
  './icons/icon-180.png',
  './icons/icon-512.png',
  './icons/storm-wordmark.png',
  './fonts/Anton-Regular.woff2'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    Promise.all([
      fetch('./roster.json', { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : []; })
        .catch(function () { return []; }),
      fetch('./soundboard.json', { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : []; })
        .catch(function () { return []; })
    ])
      .then(function (results) {
        var roster = results[0];
        var soundboard = results[1];
        var songFiles = (roster || []).filter(function (p) { return p.file; })
          .map(function (p) { return './' + p.file; });
        var sfxFiles = (soundboard || []).filter(function (c) { return c.file; })
          .map(function (c) { return './' + c.file; });
        var allFiles = SHELL_FILES.concat(songFiles, sfxFiles);
        return caches.open(CACHE_NAME).then(function (cache) {
          return Promise.all(
            allFiles.map(function (url) {
              // cache.add(url) alone doesn't force a real network hit — it can
              // be silently satisfied by the browser's own HTTP cache, same
              // gap as the runtime fetch handler below. no-store here is what
              // actually guarantees a fresh precache, not just a fresh cache
              // *bucket*.
              return cache.add(new Request(url, { cache: 'no-store' })).catch(function (err) {
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

function isNetworkFirst(url) {
  var path = new URL(url).pathname;
  return NETWORK_FIRST_FILES.some(function (f) {
    var name = f.replace(/^\.\//, '');
    return name === '' ? path.slice(-1) === '/' : path.slice(-name.length) === name;
  });
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var networkFirst = isNetworkFirst(event.request.url);

  if (networkFirst) {
    // Shell + roster.json: always try the network first so new deploys (new
    // roster entries, code changes) show up immediately. Cache is only the
    // offline fallback.
    //
    // { cache: 'no-store' } here is load-bearing — without it, fetch() can be
    // silently satisfied by the browser's own HTTP cache instead of a real
    // network round-trip, which defeats "network-first" entirely and can
    // make a genuinely new deploy look identical to a stale one. Using the
    // URL string (not event.request directly) avoids fetch() rejecting the
    // override due to a mode/credentials mismatch on the original request.
    event.respondWith(
      fetch(event.request.url, { cache: 'no-store' })
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
          }
          return response;
        })
        .catch(function () { return caches.match(event.request); })
    );
    return;
  }

  // Everything else (mp3s, icons): cache-first, refresh cache in background.
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request.url, { cache: 'no-store' })
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
