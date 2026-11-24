const STATIC_CACHE = "cinemavault-static-v1";
const MODELS_CACHE = "cinemavault-models-v1";
const ALLOWED_CACHES = new Set([STATIC_CACHE, MODELS_CACHE]);

function classifyRequest(rawUrl, method) {
  if (String(method || "GET").toUpperCase() !== "GET") return "bypass";
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "bypass";
  }
  if (parsed.origin !== self.location.origin) return "bypass";
  const pathname = parsed.pathname || "/";
  if (pathname.startsWith("/api/")) return "bypass";
  if (pathname.startsWith("/models/") && /\.(bin|cvea|json)$/i.test(pathname)) {
    return "cache-first-model";
  }
  if (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.json" ||
    pathname === "/og-image.png"
  ) {
    return "cache-first-asset";
  }
  return "network-first-nav";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.json"]))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !ALLOWED_CACHES.has(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    cache.put(request, fresh.clone()).catch(() => {});
  }
  return fresh;
}

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && request.mode === "navigate") {
      const cache = await caches.open(STATIC_CACHE);
      cache.put("/", fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    if (request.mode === "navigate") {
      const cache = await caches.open(STATIC_CACHE);
      const fallback = await cache.match("/");
      if (fallback) return fallback;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const strategy = classifyRequest(event.request.url, event.request.method);
  if (strategy === "bypass") return;
  if (strategy === "cache-first-model") {
    event.respondWith(cacheFirst(event.request, MODELS_CACHE));
    return;
  }
  if (strategy === "cache-first-asset") {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
  }
});
