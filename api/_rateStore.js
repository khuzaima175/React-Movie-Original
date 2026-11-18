const MEMORY_BUCKETS = new Map();
const MAX_MEMORY_KEYS = 5000;

function pruneMemoryBuckets(now, windowMs) {
  if (MEMORY_BUCKETS.size <= MAX_MEMORY_KEYS) return;
  const cutoff = now - windowMs;
  for (const [k, timestamps] of MEMORY_BUCKETS.entries()) {
    const active = timestamps.filter((ts) => ts > cutoff);
    if (active.length === 0) MEMORY_BUCKETS.delete(k);
    else MEMORY_BUCKETS.set(k, active);
  }
}

export function hitMemoryBucket(key, { limit = 60, windowSec = 60, now = Date.now() } = {}) {
  const maxLimit = Math.max(1, Number(limit) || 60);
  const windowMs = Math.max(1000, (Number(windowSec) || 60) * 1000);
  const cutoff = now - windowMs;

  const active = (MEMORY_BUCKETS.get(key) || []).filter((ts) => ts > cutoff);
  if (active.length >= maxLimit) {
    const oldest = active[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    MEMORY_BUCKETS.set(key, active);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  active.push(now);
  MEMORY_BUCKETS.set(key, active);
  pruneMemoryBuckets(now, windowMs);
  return {
    allowed: true,
    remaining: Math.max(0, maxLimit - active.length),
    retryAfterSec: 0
  };
}

export function resetMemoryRateStore() {
  MEMORY_BUCKETS.clear();
}

/**
 * Optional Upstash Redis REST rate store with transparent fail-open memory fallback.
 */
export function createRateStore({ env = process.env, fetchFn = fetch } = {}) {
  const url = String(env?.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = String(env?.UPSTASH_REDIS_REST_TOKEN || "").trim();
  const durable = Boolean(url && token);

  return {
    durable,
    async hit(key, { limit = 60, windowSec = 60, now = Date.now() } = {}) {
      const normalizedLimit = Math.max(1, Number(limit) || 60);
      const normalizedWindowSec = Math.max(1, Math.ceil(Number(windowSec) || 60));

      if (!durable) {
        return hitMemoryBucket(key, {
          limit: normalizedLimit,
          windowSec: normalizedWindowSec,
          now
        });
      }

      try {
        const res = await fetchFn(`${url}/pipeline`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify([
            ["INCR", key],
            ["EXPIRE", key, normalizedWindowSec, "NX"]
          ])
        });
        if (!res || !res.ok) {
          throw new Error(`Upstash status ${res?.status ?? "unknown"}`);
        }
        const payload = await res.json();
        const count = Number(payload?.[0]?.result);
        if (!Number.isFinite(count)) {
          throw new Error("Invalid Upstash pipeline count");
        }
        const allowed = count <= normalizedLimit;
        return {
          allowed,
          remaining: Math.max(0, normalizedLimit - count),
          retryAfterSec: allowed ? 0 : normalizedWindowSec
        };
      } catch {
        return hitMemoryBucket(key, {
          limit: normalizedLimit,
          windowSec: normalizedWindowSec,
          now
        });
      }
    }
  };
}
