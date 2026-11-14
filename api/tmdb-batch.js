import { enforceApiSecurity } from "./_security.js";

const MAX_BATCH_IDS = 40;
const UPSTREAM_CONCURRENCY = 6;
const APPEND_TO_RESPONSE = "videos,credits,external_ids,keywords,watch/providers,release_dates";

function sanitizeUpstreamMessage(message, secret) {
  const text = String(message || "Upstream TMDB request failed");
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

function parseBatchIds(rawIds) {
  if (rawIds === undefined || rawIds === null) {
    return { ok: false, error: "Missing required ids query parameter" };
  }
  const combined = Array.isArray(rawIds) ? rawIds.join(",") : String(rawIds);
  const rawTokens = combined
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return { ok: false, error: "Missing required ids query parameter" };
  }
  if (rawTokens.length > MAX_BATCH_IDS * 2) {
    return { ok: false, error: `At most ${MAX_BATCH_IDS} TMDB movie IDs are allowed per batch request` };
  }

  const seen = new Set();
  const ids = [];
  for (const token of rawTokens) {
    if (!/^\d+$/.test(token)) {
      return { ok: false, error: "ids must contain only positive integer TMDB movie IDs" };
    }
    const parsed = Number(token);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { ok: false, error: "ids must contain only positive integer TMDB movie IDs" };
    }
    if (!seen.has(parsed)) {
      seen.add(parsed);
      ids.push(parsed);
    }
  }

  if (ids.length > MAX_BATCH_IDS) {
    return { ok: false, error: `At most ${MAX_BATCH_IDS} unique TMDB movie IDs are allowed per batch request` };
  }

  return { ok: true, ids };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

export default async function handler(req, res) {
  res.setHeader?.("Vary", "Origin");

  if (!enforceApiSecurity(req, res, { bucket: "tmdb", maxRequests: 60, windowMs: 60_000 })) {
    return;
  }

  if (req.method !== "GET") {
    res.setHeader?.("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = req.query || {};
  const parsed = parseBatchIds(query.ids);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  const apiKey = (process.env.TMDB_API_KEY || process.env.VITE_TMDB_KEY || "").trim();
  if (!apiKey) {
    return res.status(503).json({ error: "Server TMDB credentials are not configured" });
  }

  const rawLang = typeof query.language === "string" ? query.language.trim() : "";
  const language = /^[a-z]{2}(-[A-Z]{2})?$/i.test(rawLang) ? rawLang : "en-US";
  const fetchFn = typeof req.fetchFn === "function" ? req.fetchFn : fetch;

  const results = {};
  const errors = {};
  let hasTransientError = false;

  await mapWithConcurrency(parsed.ids, UPSTREAM_CONCURRENCY, async (id) => {
    const params = new URLSearchParams({
      append_to_response: APPEND_TO_RESPONSE,
      language,
      api_key: apiKey
    });
    const url = `https://api.themoviedb.org/3/movie/${id}?${params.toString()}`;

    try {
      const upstream = await fetchFn(url, { cache: "no-store" });
      if (!upstream || !upstream.ok) {
        const status = Number(upstream?.status) || 502;
        if (status === 429 || status >= 500) {
          hasTransientError = true;
        }
        let rawMsg = `Upstream TMDB status ${status}`;
        if (typeof upstream?.json === "function") {
          const errPayload = await upstream.json().catch(() => null);
          if (errPayload?.status_message || errPayload?.error) {
            rawMsg = errPayload.status_message || errPayload.error;
          }
        }
        errors[String(id)] = {
          status,
          error: sanitizeUpstreamMessage(rawMsg, apiKey)
        };
        return;
      }

      const data = await upstream.json();
      results[String(id)] = data;
    } catch (err) {
      hasTransientError = true;
      errors[String(id)] = {
        status: 502,
        error: sanitizeUpstreamMessage(err?.message, apiKey)
      };
    }
  });

  // Only CDN-cache responses that contain no transient upstream failures (429 / 5xx).
  res.setHeader?.(
    "Cache-Control",
    hasTransientError ? "no-store" : "s-maxage=86400, stale-while-revalidate=604800"
  );
  return res.status(200).json({ results, errors });
}
