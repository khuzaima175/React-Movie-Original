function readConfiguredKey(name) {
  const key = import.meta.env?.[name] || globalThis.process?.env?.[name];
  if (!key || key === "undefined" || key === "null" || String(key).trim() === "") {
    return "";
  }
  return String(key).trim();
}

export function isBrowserRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function resolveTmdbKey() {
  return readConfiguredKey("VITE_TMDB_KEY");
}

export function resolveOmdbKey() {
  return readConfiguredKey("VITE_OMDB_KEY");
}

export function resolveGeminiKey() {
  return readConfiguredKey("VITE_GEMINI_KEY");
}

export function hasTmdbBackend(options = {}) {
  if (typeof options.apiKey === "string" && options.apiKey.trim()) return true;
  if (resolveTmdbKey()) return true;
  if (options.forceProxy === true) return true;
  return isBrowserRuntime() && options.forceProxy !== false;
}

export function hasOmdbBackend(options = {}) {
  if (typeof options.apiKey === "string" && options.apiKey.trim()) return true;
  if (resolveOmdbKey()) return true;
  if (options.forceProxy === true) return true;
  return isBrowserRuntime() && options.forceProxy !== false;
}

export function hasGeminiBackend(options = {}) {
  if (typeof options.apiKey === "string" && options.apiKey.trim()) return true;
  if (resolveGeminiKey()) return true;
  if (options.useProxy === true) return true;
  return isBrowserRuntime() && options.useProxy !== false;
}

function buildSearchParams(queryParams = {}, stripKeys = []) {
  const params = new URLSearchParams();
  const stripped = new Set(stripKeys);
  if (!queryParams || typeof queryParams !== "object") return params;
  for (const [k, v] of Object.entries(queryParams)) {
    if (stripped.has(k) || v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  return params;
}

/**
 * Fetch JSON from TMDB directly when a client dev key exists, or via /api/tmdb in browser production.
 */
export async function fetchTmdbJson(path, queryParams = {}, options = {}) {
  if (!path || typeof path !== "string") return null;
  const apiKey = options.apiKey !== undefined ? String(options.apiKey || "").trim() : resolveTmdbKey();
  const useProxy = !apiKey && (options.forceProxy === true || (isBrowserRuntime() && options.forceProxy !== false));
  if (!apiKey && !useProxy) {
    return null;
  }

  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : fetch;
  const params = buildSearchParams(queryParams, ["api_key", "path"]);

  let url;
  if (apiKey) {
    params.set("api_key", apiKey);
    const qs = params.toString();
    url = `https://api.themoviedb.org${path}${qs ? `?${qs}` : ""}`;
  } else {
    const proxyParams = new URLSearchParams({ path });
    for (const [k, v] of params.entries()) {
      proxyParams.set(k, v);
    }
    url = `/api/tmdb?${proxyParams.toString()}`;
  }

  const res = await fetchFn(url, {
    cache: "no-store",
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!res || !res.ok) return null;
  return await res.json();
}

/**
 * Fetch JSON from OMDb directly when a client dev key exists, or via /api/omdb in browser production.
 */
export async function fetchOmdbJson(queryParams = {}, options = {}) {
  const apiKey = options.apiKey !== undefined ? String(options.apiKey || "").trim() : resolveOmdbKey();
  const useProxy = !apiKey && (options.forceProxy === true || (isBrowserRuntime() && options.forceProxy !== false));
  if (!apiKey && !useProxy) {
    return null;
  }

  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : fetch;
  const params = buildSearchParams(queryParams, ["apikey"]);

  let url;
  if (apiKey) {
    params.set("apikey", apiKey);
    url = `https://www.omdbapi.com/?${params.toString()}`;
  } else {
    url = `/api/omdb?${params.toString()}`;
  }

  const res = await fetchFn(url, {
    cache: "no-store",
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!res || !res.ok) return null;
  return await res.json();
}

/**
 * GoogleGenAI-compatible client adapter that routes generateContent through /api/gemini.
 */
export function createProxyGeminiClient(options = {}) {
  const endpoint = options.endpoint || "/api/gemini";
  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : fetch;

  return {
    models: {
      async generateContent({ model, contents, config } = {}) {
        const { abortSignal, ...serializableConfig } = config || {};
        const res = await fetchFn(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, contents, config: serializableConfig }),
          signal: abortSignal || options.signal
        });

        let data = null;
        try {
          data = await res.json();
        } catch (_) {
          data = null;
        }

        if (!res || !res.ok) {
          const message = data?.error?.message || data?.error || `Gemini proxy error (HTTP ${res?.status ?? 500})`;
          throw Object.assign(new Error(message), {
            status: res?.status,
            error: data?.error
          });
        }

        return {
          text: data?.text ?? "",
          usageMetadata: data?.usageMetadata ?? null
        };
      }
    }
  };
}
