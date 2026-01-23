const CACHE_NAME = 'v14';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './script.js',
  './icons/icon192.png',
  './icons/icon512.png',
  './audio/corsica/a.webm',
  './audio/corsica/b.webm',
  './audio/corsica/c.webm',
  './audio/corsica/d.webm',
  './audio/corsica/e.webm',
  './audio/corsica/f.webm',
  './audio/corsica/g.webm',
  './audio/corsica/h.webm',
  './audio/corsica/i.webm',
  './audio/corsica/j.webm',
  './audio/corsica/k.webm',
  './audio/corsica/l.webm',
  './audio/corsica/m.webm',
  './audio/corsica/n.webm',
  './audio/corsica/o.webm',
  './audio/corsica/p.webm',
  './audio/corsica/q.webm',
  './audio/corsica/r.webm',
  './audio/corsica/s.webm',
  './audio/corsica/t.webm',
  './audio/corsica/u.webm',
  './audio/corsica/v.webm',
  './audio/corsica/w.webm',
  './audio/corsica/x.webm',
  './audio/corsica/y.webm',
  './audio/corsica/z.webm'
];

// Install: cache all assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // Take control immediately
  );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});

// Respond to version queries
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: CACHE_NAME });
  }
});
