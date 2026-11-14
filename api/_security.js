const DEFAULT_LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const RATE_LIMIT_BUCKETS = new Map();
const MAX_TRACKED_KEYS = 5000;

function getHeader(req, name) {
  const headers = req?.headers;
  if (!headers || typeof headers !== "object") return "";
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== target) continue;
    if (Array.isArray(v)) return String(v[0] || "").trim();
    return String(v || "").trim();
  }
  return "";
}

function parseConfiguredAllowedOrigins() {
  const raw = String(process.env.ALLOWED_ORIGIN || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function normalizeHostCandidate(rawHost = "") {
  const first = String(rawHost || "").split(",")[0].trim().toLowerCase();
  if (!first) return { host: "", hostname: "" };
  try {
    const u = new URL(`http://${first}`);
    return { host: u.host.toLowerCase(), hostname: u.hostname.toLowerCase() };
  } catch {
    const hostname = first.replace(/:\d+$/, "");
    return { host: first, hostname };
  }
}

/**
 * Checks whether the request Origin header (when present) is allowed.
 * Requests without an Origin header (e.g. server-side callers, Node tests, curl)
 * are allowed so server proxies remain usable outside CORS browser contexts.
 */
export function isRequestOriginAllowed(req) {
  const rawOrigin = getHeader(req, "origin");
  if (!rawOrigin) return true;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(rawOrigin);
  } catch {
    return false;
  }

  const originHostname = parsedOrigin.hostname.toLowerCase();
  const originHost = parsedOrigin.host.toLowerCase();
  const originNormalized = parsedOrigin.origin.toLowerCase();

  if (DEFAULT_LOCAL_HOSTNAMES.has(originHostname)) {
    return true;
  }

  const hostCandidates = [
    getHeader(req, "x-forwarded-host"),
    getHeader(req, "host"),
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  ].filter(Boolean);

  for (const candidate of hostCandidates) {
    const { host, hostname } = normalizeHostCandidate(candidate);
    if (!hostname) continue;
    if (host === originHost || hostname === originHostname) {
      return true;
    }
  }

  for (const allowedEntry of parseConfiguredAllowedOrigins()) {
    const lowerEntry = allowedEntry.toLowerCase();
    if (/^https?:\/\//i.test(lowerEntry)) {
      if (originNormalized === lowerEntry) return true;
    } else {
      const { host, hostname } = normalizeHostCandidate(lowerEntry);
      if (host && (host === originHost || hostname === originHostname)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extracts best-effort client IP for serverless proxy rate limiting.
 */
export function getClientIp(req) {
  const forwarded = getHeader(req, "x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = getHeader(req, "x-real-ip");
  if (realIp) return realIp;
  return String(req?.socket?.remoteAddress || req?.connection?.remoteAddress || req?.ip || "unknown").trim();
}

function pruneExpiredBuckets(now, windowMs) {
  if (RATE_LIMIT_BUCKETS.size <= MAX_TRACKED_KEYS) return;
  const cutoff = now - windowMs;
  for (const [key, timestamps] of RATE_LIMIT_BUCKETS.entries()) {
    const active = timestamps.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      RATE_LIMIT_BUCKETS.delete(key);
    } else {
      RATE_LIMIT_BUCKETS.set(key, active);
    }
  }
}

/**
 * In-memory per-IP sliding-window rate limiter.
 */
export function checkSlidingWindowRateLimit(
  req,
  { bucket = "default", maxRequests = 60, windowMs = 60_000, now = Date.now() } = {}
) {
  const limit = Math.max(1, Number(maxRequests) || 60);
  const window = Math.max(1000, Number(windowMs) || 60_000);
  const key = `${bucket}:${getClientIp(req)}`;
  const cutoff = now - window;

  const existing = RATE_LIMIT_BUCKETS.get(key) || [];
  const active = existing.filter((ts) => ts > cutoff);

  if (active.length >= limit) {
    const oldest = active[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + window - now) / 1000));
    RATE_LIMIT_BUCKETS.set(key, active);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec
    };
  }

  active.push(now);
  RATE_LIMIT_BUCKETS.set(key, active);
  pruneExpiredBuckets(now, window);

  return {
    allowed: true,
    remaining: Math.max(0, limit - active.length),
    retryAfterSec: 0
  };
}

/**
 * Enforces cross-origin blocking (403) and per-IP sliding-window rate limiting (429).
 * Returns `true` if request may proceed, or `false` after writing the error response.
 */
export function enforceApiSecurity(
  req,
  res,
  { bucket = "default", maxRequests = 60, windowMs = 60_000, now = Date.now() } = {}
) {
  if (!isRequestOriginAllowed(req)) {
    res.status(403).json({ error: "Forbidden origin" });
    return false;
  }

  const rl = checkSlidingWindowRateLimit(req, { bucket, maxRequests, windowMs, now });
  if (!rl.allowed) {
    if (typeof res?.setHeader === "function") {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
    }
    res.status(429).json({ error: "Too many requests. Please try again shortly." });
    return false;
  }

  return true;
}

/**
 * Clears in-memory sliding-window buckets (primarily for deterministic unit tests).
 */
export function resetRateLimitBuckets() {
  RATE_LIMIT_BUCKETS.clear();
}
