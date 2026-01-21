/* Minimal PWA service worker: cache app shell; runtime cache Ben Yehuda responses (best-effort). */

const CACHE_VERSION = "v1.1.0";
const SHELL_CACHE = `shir-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `shir-runtime-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
          return Promise.resolve();
        })
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // App shell: cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        return res;
      })()
    );
    return;
  }

  // Runtime cache for Ben Yehuda API calls: network-first with cache fallback.
  if (url.hostname === "benyehuda.org" && url.pathname.startsWith("/api/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          const cached = await cache.match(req);
          if (cached) return cached;
          throw new Error("Offline and no cached API response");
        }
      })()
    );
  }
});
