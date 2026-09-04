// Pecsil Business OS — Service Worker para modo PWA e cache de app-shell
const CACHE_NAME = 'pecsil-business-os-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.png',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/pecsil-logo.png',
  '/pecsil-logo-dark.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[PWA] Cache parcial de ativos estáticos:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Ignorar requisições não-GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Não interferir em chamadas de API, Auth ou Supabase
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.hostname.includes('supabase')
  ) {
    return;
  }

  // Estratégia Stale-While-Revalidate para ativos estáticos e páginas
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          cache.put(request, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
      }).catch((error) => {
        // Se a rede falhar e houver cache, ele responde; se não, lança erro
        if (cachedResponse) return cachedResponse;
        throw error;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
