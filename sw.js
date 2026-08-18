// Service Worker — cache para funcionamiento offline
const CACHE_NAME = 'frutitas-v2';
const ASSETS = [
    './',
    './index.html',
    './game.js',
    './multiplayer.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then(cached => {
            return cached || fetch(e.request).then(resp => {
                // Guardar nuevas peticiones en cache
                if (resp && resp.status === 200 && e.request.method === 'GET') {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                }
                return resp;
            }).catch(() => cached);
        })
    );
});