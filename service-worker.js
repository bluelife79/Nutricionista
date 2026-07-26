// IMPORTANTE: subir CACHE_NAME cada vez que cambia algo en la app o en
// database.json para forzar a los navegadores a descargar la versión nueva.
const CACHE_NAME = "revolucionat-v4";
const urlsToCache = [
  "/",
  "/index.html",
  "/js/algorithm.js",
  "/database.json",
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

// Fetch — Network First para database.json, Cache First para el resto.
// Network First en database.json garantiza que la usuaria siempre vea los
// fixes nuevos (categorías, flags, dedupe) sin esperar al refresh manual.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isDatabase = url.pathname.endsWith("/database.json");

  if (isDatabase) {
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
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );
});
