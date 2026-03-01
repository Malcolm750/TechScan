// public/sw.js
const CACHE_NAME = 'techscan-cache-v2'; // Passage en v2 pour forcer la mise à jour !

const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

self.addEventListener('install', event => {
  // Force le nouveau Service Worker à s'installer immédiatement
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  // Prend le contrôle immédiat de la tablette sans attendre le redémarrage
  event.waitUntil(self.clients.claim());

  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName); // Supprime les vieux caches
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // 1. Stratégie "Network First" pour la page HTML (Pour toujours avoir la dernière mise à jour)
  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Si la tablette n'a plus de réseau, on renvoie la version en cache
        return caches.match('/index.html');
      })
    );
    return;
  }

  // 2. Stratégie "Cache First" pour le reste (Images, CSS, etc.) pour la rapidité
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});