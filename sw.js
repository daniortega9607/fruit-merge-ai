// Service Worker — cache inteligente: rápido pero siempre actualizado
// Estrategia: stale-while-revalidate para archivos locales
//             cache-first para CDNs (no cambian频繁mente)

const CACHE_NAME = 'frutitas-v3';
const CDN_CACHE = 'frutitas-cdn-v1';
const ASSETS = [
    './',
    './index.html',
    './game.js',
    './multiplayer.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
];
const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        Promise.all([
            caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {}),
            caches.open(CDN_CACHE).then(cache => cache.addAll(CDN_ASSETS)).catch(() => {})
        ])
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME && k !== CDN_CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    
    // Solo GET
    if (req.method !== 'GET') return;
    
    const url = new URL(req.url);
    const isCDN = url.origin !== self.location.origin;
    
    if (isCDN) {
        // CDN: cache-first (Matter.js y PeerJS no cambian entre versiones fijas)
        e.respondWith(
            caches.match(req).then(cached => {
                return cached || fetch(req).then(resp => {
                    if (resp && resp.status === 200) {
                        const clone = resp.clone();
                        caches.open(CDN_CACHE).then(c => c.put(req, clone));
                    }
                    return resp;
                }).catch(() => cached);
            })
        );
    } else {
        // Archivos locales: stale-while-revalidate
        // 1. Sirve del cache inmediatamente (rápido)
        // 2. En paralelo, descarga la versión nueva del servidor
        // 3. Si es diferente, actualiza el cache para la próxima visita
        e.respondWith(
            caches.match(req).then(cached => {
                const fetchPromise = fetch(req).then(resp => {
                    if (resp && resp.status === 200) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then(c => c.put(req, clone));
                    }
                    return resp;
                }).catch(() => cached);
                
                // Devolver cache si existe, si no esperar al fetch
                return cached || fetchPromise;
            })
        );
    }
});