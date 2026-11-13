const ALLOWED_TMDB_PATH_RE =
  /^\/3\/(discover\/movie|search\/movie|trending\/movie\/(?:day|week)|movie\/\d+(?:\/(?:keywords|credits|watch\/providers|videos|release_dates|external_ids))?|find\/[a-zA-Z0-9_-]+)$/;

function sanitizeUpstreamMessage(message, secret) {
  const text = String(message || "Upstream TMDB request failed");
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader?.("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = req.query || {};
  const rawPath = typeof query.path === "string" ? query.path.trim() : "";
  if (!rawPath || rawPath.includes("..") || !ALLOWED_TMDB_PATH_RE.test(rawPath)) {
    return res.status(400).json({ error: "Invalid or disallowed TMDB path" });
  }

  const apiKey = (process.env.TMDB_API_KEY || process.env.VITE_TMDB_KEY || "").trim();
  if (!apiKey) {
    return res.status(503).json({ error: "Server TMDB credentials are not configured" });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "path" || key === "api_key" || value === undefined || value === null || value === "") {
      continue;
    }
    const normalized = Array.isArray(value) ? value[0] : value;
    params.set(key, String(normalized));
  }
  params.set("api_key", apiKey);

  const fetchFn = typeof req.fetchFn === "function" ? req.fetchFn : fetch;
  try {
    const upstream = await fetchFn(`https://api.themoviedb.org${rawPath}?${params.toString()}`, {
      cache: "no-store"
    });
    const data = await upstream.json();
    return res.status(upstream.status || (upstream.ok ? 200 : 502)).json(data);
  } catch (err) {
    return res.status(502).json({ error: sanitizeUpstreamMessage(err?.message, apiKey) });
  }
}
