/**
 * Service Worker de PDF Extractor.
 *
 * Estrategia:
 *  - El armazón de la aplicación (HTML, manifest, iconos y motor libarchive)
 *    se precarga durante la instalación.
 *  - Las rutas con hash que genera Vite se guardan en una caché de ejecución
 *    la primera vez que se descargan.
 *  - Las navegaciones usan red primero y caché como respaldo, de modo que una
 *    versión nueva se sirve en cuanto hay conexión.
 *
 * La aplicación sigue funcionando sin conexión después de la primera visita.
 */
const VERSION = 'pdf-extractor-v2';
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './libarchive/worker-bundle.js',
  './libarchive/libarchive.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: 'reload' }));
            if (response.ok) await cache.put(url, response);
          } catch {
            // Un recurso opcional puede fallar; no bloquea la instalación.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== PRECACHE && key !== RUNTIME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(RUNTIME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  event.respondWith(cacheFirst(request));
});
