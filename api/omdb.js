function sanitizeUpstreamMessage(message, secret) {
  const text = String(message || "Upstream OMDb request failed");
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader?.("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = req.query || {};
  const hasLookupParam = Boolean(query.i || query.t || query.s);
  if (!hasLookupParam) {
    return res.status(400).json({ error: "Missing OMDb lookup parameter (i, t, or s)" });
  }

  const apiKey = (process.env.OMDB_API_KEY || process.env.VITE_OMDB_KEY || "").trim();
  if (!apiKey) {
    return res.status(503).json({ error: "Server OMDb credentials are not configured" });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "apikey" || value === undefined || value === null || value === "") {
      continue;
    }
    const normalized = Array.isArray(value) ? value[0] : value;
    params.set(key, String(normalized));
  }
  params.set("apikey", apiKey);

  const fetchFn = typeof req.fetchFn === "function" ? req.fetchFn : fetch;
  try {
    const upstream = await fetchFn(`https://www.omdbapi.com/?${params.toString()}`, {
      cache: "no-store"
    });
    const data = await upstream.json();
    return res.status(upstream.status || (upstream.ok ? 200 : 502)).json(data);
  } catch (err) {
    return res.status(502).json({ error: sanitizeUpstreamMessage(err?.message, apiKey) });
  }
}
