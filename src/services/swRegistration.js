/**
 * Classifies fetch requests inside the CinemaVault Service Worker so API mutations
 * and Supabase calls always bypass Cache Storage while model binaries and static assets
 * cache aggressively.
 */
export function classifySwRequest(rawUrl, method = "GET") {
  if (String(method || "GET").toUpperCase() !== "GET") {
    return "bypass";
  }

  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""), "https://cinemavault.local");
  } catch {
    return "bypass";
  }

  const pathname = parsed.pathname || "/";
  const hostname = parsed.hostname || "";

  if (pathname.startsWith("/api/") || hostname.endsWith(".supabase.co")) {
    return "bypass";
  }

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

/**
 * Registers `/sw.js` strictly in production builds so Vite dev HMR is never affected.
 */
export function registerServiceWorker({
  isProd = false,
  navigatorObj = typeof navigator !== "undefined" ? navigator : null
} = {}) {
  if (!isProd || !navigatorObj || !("serviceWorker" in navigatorObj)) {
    return Promise.resolve(null);
  }
  return navigatorObj.serviceWorker.register("/sw.js").catch(() => null);
}
