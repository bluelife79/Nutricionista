// IMPORTANTE: subir CACHE_NAME cada vez que cambia algo en la app o en
// database.json para forzar a los navegadores a descargar la versión nueva.
const CACHE_NAME = "revolucionat-premium-v2-3-systemic-1";
const urlsToCache = [
  "/",
  "/index.html",
  "/js/exchange_groups.js",
  "/js/household_measures.js",
  "/js/dietary_filters.js",
  "/js/premium_policy.js",
  "/js/culinary_intent.js",
  "/js/exchange_scope.js",
  "/js/algorithm.js",
  "/assets/brand/logo-revolucionat-cropped.webp",
  "/assets/brand/bricolage-grotesque-latin.woff2",
  "/assets/brand/manrope-latin.woff2",
  "/icon-192.png",
  "/icon-512.png",
  "/database.json",
  "/assets/embeddings.bin",
  "/assets/embeddings_meta.json",
  "/manifest.json",
];

// Install
self.addEventListener("install", (event) => {
  // skipWaiting hace que el SW nuevo tome control inmediato sin esperar a
  // que se cierren todas las pestañas viejas
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)),
  );
});

// Fetch — Network First para documentos y database.json, Cache First para el resto.
// Network First en database.json garantiza que la usuaria siempre vea los
// fixes nuevos. Network First en HTML evita conservar una pantalla de acceso
// antigua cuando cambia la autenticación.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isDatabase = url.pathname.endsWith("/database.json");
  const isDocument =
    event.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html");

  if (isDatabase || isDocument) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Actualizar cache en segundo plano
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),  // fallback offline
    );
  } else {
    event.respondWith(
      caches
        .match(event.request)
        .then((response) => response || fetch(event.request)),
    );
  }
});

// Activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          }),
        );
      }),
      self.clients.claim(),
    ]),
  );
});
