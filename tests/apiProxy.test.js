import test from "node:test";
import assert from "node:assert/strict";
import { fetchTmdbJson, fetchOmdbJson, createProxyGeminiClient } from "../src/services/apiTransport.js";
import tmdbHandler from "../api/tmdb.js";
import omdbHandler from "../api/omdb.js";
import geminiHandler from "../api/gemini.js";
import { resetRateLimitBuckets } from "../api/_security.js";

function createMockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

test("api/tmdb handler rejects traversal / disallowed paths and injects server TMDB_API_KEY", async () => {
  const prevTmdb = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = "SERVER_TMDB_SECRET";
  try {
    const badRes = createMockRes();
    await tmdbHandler({ method: "GET", query: { path: "/3/../../account", api_key: "spoof" } }, badRes);
    assert.equal(badRes.statusCode, 400);

    const postRes = createMockRes();
    await tmdbHandler({ method: "POST", query: { path: "/3/discover/movie" } }, postRes);
    assert.equal(postRes.statusCode, 405);

    let forwardedUrl = "";
    const okRes = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        query: { path: "/3/discover/movie", sort_by: "popularity.desc", api_key: "spoof" },
        fetchFn: async (url) => {
          forwardedUrl = String(url);
          return { ok: true, status: 200, json: async () => ({ results: [{ id: 10 }] }) };
        }
      },
      okRes
    );
    assert.equal(okRes.statusCode, 200);
    assert.match(forwardedUrl, /api_key=SERVER_TMDB_SECRET/);
    assert.doesNotMatch(forwardedUrl, /spoof/);
    assert.deepEqual(okRes.body, { results: [{ id: 10 }] });
  } finally {
    if (prevTmdb === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prevTmdb;
  }
});

test("api/omdb handler enforces GET, strips client apikey, and injects server OMDB_API_KEY", async () => {
  const prevOmdb = process.env.OMDB_API_KEY;
  process.env.OMDB_API_KEY = "SERVER_OMDB_SECRET";
  try {
    const postRes = createMockRes();
    await omdbHandler({ method: "POST", query: { t: "Solaris" } }, postRes);
    assert.equal(postRes.statusCode, 405);

    let forwardedUrl = "";
    const okRes = createMockRes();
    await omdbHandler(
      {
        method: "GET",
        query: { t: "Solaris", apikey: "spoof" },
        fetchFn: async (url) => {
          forwardedUrl = String(url);
          return { ok: true, status: 200, json: async () => ({ Response: "True", Title: "Solaris" }) };
        }
      },
      okRes
    );
    assert.equal(okRes.statusCode, 200);
    assert.match(forwardedUrl, /apikey=SERVER_OMDB_SECRET/);
    assert.doesNotMatch(forwardedUrl, /spoof/);
  } finally {
    if (prevOmdb === undefined) delete process.env.OMDB_API_KEY;
    else process.env.OMDB_API_KEY = prevOmdb;
  }
});

test("fetchTmdbJson, fetchOmdbJson, and createProxyGeminiClient route via /api/* when client VITE keys are absent", async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", body: init?.body, signal: init?.signal });
    if (String(url).startsWith("/api/gemini")) {
      return { ok: true, status: 200, json: async () => ({ text: "{\"ok\":true}", usageMetadata: { totalTokenCount: 5 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };

  await fetchTmdbJson("/3/search/movie", { query: "Solaris" }, { apiKey: "", forceProxy: true, fetchFn: mockFetch });
  await fetchOmdbJson({ t: "Solaris" }, { apiKey: "", forceProxy: true, fetchFn: mockFetch });
  const proxyAi = createProxyGeminiClient({ fetchFn: mockFetch });
  const controller = new AbortController();
  const gRes = await proxyAi.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: "hi",
    config: { temperature: 0.2, abortSignal: controller.signal }
  });

  assert.equal(calls[0].url.startsWith("/api/tmdb?"), true);
  assert.equal(calls[1].url.startsWith("/api/omdb?"), true);
  assert.equal(calls[2].url, "/api/gemini");
  assert.equal(calls[2].method, "POST");
  assert.equal(calls[2].signal, controller.signal);
  const parsedBody = JSON.parse(calls[2].body);
  assert.equal(parsedBody.config.abortSignal, undefined);
  assert.equal(gRes.text, "{\"ok\":true}");
  assert.deepEqual(gRes.usageMetadata, { totalTokenCount: 5 });
});

test("api/gemini handler rejects GET requests, non-model strings, and forwards valid requests using GEMINI_API_KEY", async () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "SERVER_GEMINI_SECRET";
  try {
    const resGet = createMockRes();
    await geminiHandler({ method: "GET", body: {} }, resGet);
    assert.equal(resGet.statusCode, 405);

    const resBadModel = createMockRes();
    await geminiHandler({ method: "POST", body: { model: "bad model/path", contents: "x" } }, resBadModel);
    assert.equal(resBadModel.statusCode, 400);

    const okRes = createMockRes();
    let usedKey = "";
    await geminiHandler(
      {
        method: "POST",
        body: { model: "gemini-3.5-flash-lite", contents: "hello", config: { temperature: 0.1 } },
        aiFactory: (apiKey) => {
          usedKey = apiKey;
          return {
            models: {
              generateContent: async () => ({ text: "{\"hi\":1}", usageMetadata: { promptTokenCount: 2 } })
            }
          };
        }
      },
      okRes
    );
    assert.equal(usedKey, "SERVER_GEMINI_SECRET");
    assert.equal(okRes.statusCode, 200);
    assert.deepEqual(okRes.body, { text: "{\"hi\":1}", usageMetadata: { promptTokenCount: 2 } });
  } finally {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});

test("api/gemini handler enforces explicit CinemaVault model allowlist and gates Argon behind server opt-in", async () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevArgon = process.env.ENABLE_ARGON;
  const prevViteArgon = process.env.VITE_ENABLE_ARGON;
  process.env.GEMINI_API_KEY = "SERVER_GEMINI_SECRET";
  delete process.env.ENABLE_ARGON;
  delete process.env.VITE_ENABLE_ARGON;
  let invoked = 0;
  const aiFactory = () => {
    invoked += 1;
    return {
      models: {
        generateContent: async ({ model }) => ({ text: `{\"model\":\"${model}\"}`, usageMetadata: null })
      }
    };
  };

  try {
    const resUnknown = createMockRes();
    await geminiHandler(
      { method: "POST", body: { model: "gemini-1.5-pro", contents: "hello" }, aiFactory },
      resUnknown
    );
    assert.equal(resUnknown.statusCode, 400);
    assert.equal(invoked, 0);

    const resArgonBlocked = createMockRes();
    await geminiHandler(
      { method: "POST", body: { model: "gemini-4-argon", contents: "hello" }, aiFactory },
      resArgonBlocked
    );
    assert.equal(resArgonBlocked.statusCode, 403);
    assert.equal(invoked, 0);

    process.env.ENABLE_ARGON = "true";
    const resArgonAllowed = createMockRes();
    await geminiHandler(
      { method: "POST", body: { model: "gemini-4-argon", contents: "hello" }, aiFactory },
      resArgonAllowed
    );
    assert.equal(resArgonAllowed.statusCode, 200);
    assert.equal(invoked, 1);

    const resHydrogen = createMockRes();
    await geminiHandler(
      { method: "POST", body: { model: "gemini-4-hydrogen", contents: "hello" }, aiFactory },
      resHydrogen
    );
    assert.equal(resHydrogen.statusCode, 200);
    assert.equal(invoked, 2);
  } finally {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevArgon === undefined) delete process.env.ENABLE_ARGON;
    else process.env.ENABLE_ARGON = prevArgon;
    if (prevViteArgon === undefined) delete process.env.VITE_ENABLE_ARGON;
    else process.env.VITE_ENABLE_ARGON = prevViteArgon;
  }
});

test("api/tmdb handler allows trending/movie/(day|week) and rejects trending/person/week", async () => {
  const prevTmdb = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = "SERVER_TMDB_SECRET";
  try {
    let forwardedUrl = "";
    const okRes = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        query: { path: "/3/trending/movie/week" },
        fetchFn: async (url) => {
          forwardedUrl = String(url);
          return { ok: true, status: 200, json: async () => ({ results: [{ id: 550 }] }) };
        }
      },
      okRes
    );
    assert.equal(okRes.statusCode, 200);
    assert.match(forwardedUrl, /\/3\/trending\/movie\/week\?api_key=SERVER_TMDB_SECRET/);

    const badRes = createMockRes();
    await tmdbHandler({ method: "GET", query: { path: "/3/trending/person/week" } }, badRes);
    assert.equal(badRes.statusCode, 400);
  } finally {
    if (prevTmdb === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prevTmdb;
  }
});

test("api/tmdb handler allows safe /3/person/:id and /3/search/person paths while blocking non-numeric or person trending paths", async () => {
  resetRateLimitBuckets();
  const prevTmdb = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = "SERVER_TMDB_SECRET";
  try {
    const allowedPaths = [
      { path: "/3/person/71580", append_to_response: "movie_credits,external_ids" },
      { path: "/3/person/71580/movie_credits" },
      { path: "/3/search/person", query: "Morten Tyldum" }
    ];

    for (const q of allowedPaths) {
      let forwardedUrl = "";
      const okRes = createMockRes();
      await tmdbHandler(
        {
          method: "GET",
          query: q,
          fetchFn: async (url) => {
            forwardedUrl = String(url);
            return { ok: true, status: 200, json: async () => ({ id: 71580 }) };
          }
        },
        okRes
      );
      assert.equal(okRes.statusCode, 200, `expected 200 for ${q.path}`);
      assert.match(forwardedUrl, /api_key=SERVER_TMDB_SECRET/);
    }

    for (const badPath of ["/3/person/not-a-number", "/3/person/71580/../tv", "/3/trending/person/week"]) {
      const badRes = createMockRes();
      await tmdbHandler({ method: "GET", query: { path: badPath } }, badRes);
      assert.equal(badRes.statusCode, 400, `expected 400 for ${badPath}`);
    }
  } finally {
    if (prevTmdb === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prevTmdb;
  }
});


test("api/* proxies block cross-origin requests with 403 while allowing matching host, localhost, ALLOWED_ORIGIN, or server calls without Origin", async () => {
  resetRateLimitBuckets();
  const prevAllowed = process.env.ALLOWED_ORIGIN;
  const prevTmdb = process.env.TMDB_API_KEY;
  const prevOmdb = process.env.OMDB_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.TMDB_API_KEY = "SERVER_TMDB_SECRET";
  process.env.OMDB_API_KEY = "SERVER_OMDB_SECRET";
  process.env.GEMINI_API_KEY = "SERVER_GEMINI_SECRET";

  try {
    // 1. Mismatched browser Origin blocked across all 3 endpoints
    const badTmdb = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: { origin: "https://evil.example.com", host: "cinemavault.vercel.app" },
        query: { path: "/3/discover/movie" }
      },
      badTmdb
    );
    assert.equal(badTmdb.statusCode, 403);

    const badOmdb = createMockRes();
    await omdbHandler(
      {
        method: "GET",
        headers: { origin: "https://evil.example.com", host: "cinemavault.vercel.app" },
        query: { i: "tt0133093" }
      },
      badOmdb
    );
    assert.equal(badOmdb.statusCode, 403);

    const badGemini = createMockRes();
    await geminiHandler(
      {
        method: "POST",
        headers: { origin: "https://evil.example.com", host: "cinemavault.vercel.app" },
        body: { model: "gemini-3.5-flash-lite", contents: "hi" }
      },
      badGemini
    );
    assert.equal(badGemini.statusCode, 403);

    // 2. Same-host Origin and localhost Origin allowed
    const okHostRes = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: { origin: "https://cinemavault.vercel.app", host: "cinemavault.vercel.app" },
        query: { path: "/3/discover/movie" },
        fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })
      },
      okHostRes
    );
    assert.equal(okHostRes.statusCode, 200);

    const okLocalRes = createMockRes();
    await omdbHandler(
      {
        method: "GET",
        headers: { origin: "http://localhost:5173", host: "cinemavault.vercel.app" },
        query: { i: "tt0133093" },
        fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ Response: "True" }) })
      },
      okLocalRes
    );
    assert.equal(okLocalRes.statusCode, 200);

    // 3. Explicit ALLOWED_ORIGIN allowlist supported
    process.env.ALLOWED_ORIGIN = "https://custom-preview.example.org";
    const okAllowedOrigin = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: { origin: "https://custom-preview.example.org", host: "cinemavault.vercel.app" },
        query: { path: "/3/discover/movie" },
        fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })
      },
      okAllowedOrigin
    );
    assert.equal(okAllowedOrigin.statusCode, 200);
  } finally {
    resetRateLimitBuckets();
    if (prevAllowed === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = prevAllowed;
    if (prevTmdb === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prevTmdb;
    if (prevOmdb === undefined) delete process.env.OMDB_API_KEY;
    else process.env.OMDB_API_KEY = prevOmdb;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});

test("api/* proxies enforce sliding-window per-IP rate limits (20/min Gemini, 60/min TMDB & OMDb -> 429)", async () => {
  resetRateLimitBuckets();
  const prevTmdb = process.env.TMDB_API_KEY;
  const prevOmdb = process.env.OMDB_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.TMDB_API_KEY = "SERVER_TMDB_SECRET";
  process.env.OMDB_API_KEY = "SERVER_OMDB_SECRET";
  process.env.GEMINI_API_KEY = "SERVER_GEMINI_SECRET";

  try {
    const geminiAiFactory = () => ({
      models: { generateContent: async () => ({ text: "{}", usageMetadata: null }) }
    });
    for (let i = 0; i < 20; i += 1) {
      const r = createMockRes();
      await geminiHandler(
        {
          method: "POST",
          headers: { "x-forwarded-for": "198.51.100.10" },
          body: { model: "gemini-3.5-flash-lite", contents: "ok" },
          aiFactory: geminiAiFactory
        },
        r
      );
      assert.equal(r.statusCode, 200);
    }
    const blockedGemini = createMockRes();
    await geminiHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.10" },
        body: { model: "gemini-3.5-flash-lite", contents: "ok" },
        aiFactory: geminiAiFactory
      },
      blockedGemini
    );
    assert.equal(blockedGemini.statusCode, 429);
    assert.ok(Number(blockedGemini.headers["Retry-After"]) >= 1);

    // Distinct IP remains unblocked
    const otherIpGemini = createMockRes();
    await geminiHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.11" },
        body: { model: "gemini-3.5-flash-lite", contents: "ok" },
        aiFactory: geminiAiFactory
      },
      otherIpGemini
    );
    assert.equal(otherIpGemini.statusCode, 200);

    // TMDB & OMDb 60/min limits
    for (let i = 0; i < 60; i += 1) {
      const rTmdb = createMockRes();
      await tmdbHandler(
        {
          method: "GET",
          headers: { "x-forwarded-for": "198.51.100.20" },
          query: { path: "/3/discover/movie" },
          fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })
        },
        rTmdb
      );
      assert.equal(rTmdb.statusCode, 200);

      const rOmdb = createMockRes();
      await omdbHandler(
        {
          method: "GET",
          headers: { "x-forwarded-for": "198.51.100.30" },
          query: { i: "tt0133093" },
          fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ Response: "True" }) })
        },
        rOmdb
      );
      assert.equal(rOmdb.statusCode, 200);
    }

    const blockedTmdb = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.20" },
        query: { path: "/3/discover/movie" }
      },
      blockedTmdb
    );
    assert.equal(blockedTmdb.statusCode, 429);

    const blockedOmdb = createMockRes();
    await omdbHandler(
      {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.30" },
        query: { i: "tt0133093" }
      },
      blockedOmdb
    );
    assert.equal(blockedOmdb.statusCode, 429);
  } finally {
    resetRateLimitBuckets();
    if (prevTmdb === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prevTmdb;
    if (prevOmdb === undefined) delete process.env.OMDB_API_KEY;
    else process.env.OMDB_API_KEY = prevOmdb;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});

test("api/tmdb-batch enforces 40-ID cap, <=6 upstream concurrency, single rate-limit hit, headers, and partial failure redaction", async () => {
  const { default: tmdbBatchHandler } = await import("../api/tmdb-batch.js");
  resetRateLimitBuckets();
  const prevTmdb = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = "SERVER_TMDB_BATCH_SECRET";

  try {
    const resPost = createMockRes();
    await tmdbBatchHandler({ method: "POST", headers: { "x-forwarded-for": "198.51.100.70" } }, resPost);
    assert.equal(resPost.statusCode, 405);

    for (const badQuery of [{}, { ids: "" }, { ids: "12,abc" }, { ids: "0,5" }]) {
      const badRes = createMockRes();
      await tmdbBatchHandler(
        { method: "GET", headers: { "x-forwarded-for": "198.51.100.71" }, query: badQuery },
        badRes
      );
      assert.equal(badRes.statusCode, 400);
    }

    const tooManyIds = Array.from({ length: 41 }, (_, i) => i + 1).join(",");
    const res41 = createMockRes();
    await tmdbBatchHandler(
      { method: "GET", headers: { "x-forwarded-for": "198.51.100.72" }, query: { ids: tooManyIds } },
      res41
    );
    assert.equal(res41.statusCode, 400);

    // Valid 40-ID batch: check concurrency <= 6, append_to_response, Vary & Cache-Control, and 1 rate-limit hit
    const ids40 = Array.from({ length: 40 }, (_, i) => i + 1).join(",");
    let inFlight = 0;
    let maxInFlight = 0;
    const seenUrls = [];
    const okBatchRes = createMockRes();
    await tmdbBatchHandler(
      {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.77", origin: "https://cinemavault.vercel.app", host: "cinemavault.vercel.app" },
        query: { ids: ids40 },
        fetchFn: async (url) => {
          seenUrls.push(String(url));
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 2));
          inFlight -= 1;
          const match = String(url).match(/\/3\/movie\/(\d+)/);
          const id = Number(match?.[1] || 0);
          return { ok: true, status: 200, json: async () => ({ id, title: `Film ${id}` }) };
        }
      },
      okBatchRes
    );
    assert.equal(okBatchRes.statusCode, 200);
    assert.equal(Object.keys(okBatchRes.body.results).length, 40);
    assert.equal(Object.keys(okBatchRes.body.errors).length, 0);
    assert.equal(maxInFlight <= 6 && maxInFlight >= 2, true);
    assert.equal(seenUrls[0].includes("videos"), true);
    assert.equal(seenUrls[0].includes("release_dates"), true);
    assert.equal(seenUrls[0].includes("watch%2Fproviders"), true);
    assert.equal(okBatchRes.headers.Vary, "Origin");
    assert.equal(okBatchRes.headers["Cache-Control"], "s-maxage=86400, stale-while-revalidate=604800");

    // 59 more batch hits (total 60) should all pass on same IP before 61st hits shared TMDB 429 limit
    for (let i = 0; i < 59; i += 1) {
      const r = createMockRes();
      await tmdbBatchHandler(
        {
          method: "GET",
          headers: { "x-forwarded-for": "198.51.100.77" },
          query: { ids: "1,2" },
          fetchFn: async (url) => {
            const id = Number(String(url).match(/\/3\/movie\/(\d+)/)?.[1] || 1);
            return { ok: true, status: 200, json: async () => ({ id }) };
          }
        },
        r
      );
      assert.equal(r.statusCode, 200);
    }
    const r429 = createMockRes();
    await tmdbBatchHandler(
      { method: "GET", headers: { "x-forwarded-for": "198.51.100.77" }, query: { ids: "1" } },
      r429
    );
    assert.equal(r429.statusCode, 429);

    // Partial failure with upstream secret redaction
    const partialRes = createMockRes();
    await tmdbBatchHandler(
      {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.78" },
        query: { ids: "101,102,103" },
        fetchFn: async (url) => {
          const s = String(url);
          if (s.includes("/3/movie/101")) {
            return { ok: true, status: 200, json: async () => ({ id: 101, title: "OK" }) };
          }
          if (s.includes("/3/movie/102")) {
            return { ok: false, status: 404, json: async () => ({ status_message: "Not found" }) };
          }
          throw new Error(`network failure api_key=SERVER_TMDB_BATCH_SECRET`);
        }
      },
      partialRes
    );
    assert.equal(partialRes.statusCode, 200);
    assert.equal(partialRes.body.results["101"].id, 101);
    assert.equal(partialRes.body.errors["102"].status, 404);
    assert.equal(partialRes.body.errors["103"].status, 502);
    assert.equal(partialRes.body.errors["103"].error.includes("SERVER_TMDB_BATCH_SECRET"), false);
    assert.equal(partialRes.body.errors["103"].error.includes("[REDACTED]"), true);
    assert.equal(partialRes.headers["Cache-Control"], "no-store");
  } finally {
    resetRateLimitBuckets();
    if (prevTmdb === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prevTmdb;
  }
});

test("getMovieDetailsBatch chunks at 40 in proxy mode, honors 30-day cache TTL, never caches failures, and safely no-ops without indexedDB", async () => {
  const { getMovieDetailsBatch, TMDB_CACHE_TTL_MS } = await import("../src/services/apiTransport.js");
  const prevTmdb = process.env.VITE_TMDB_KEY;
  delete process.env.VITE_TMDB_KEY;

  try {
    // 1. Node without indexedDB: chunks 45 IDs into 40 + 5 cleanly
    const ids45 = Array.from({ length: 45 }, (_, i) => i + 1);
    const batchUrls = [];
    const noCacheMap = await getMovieDetailsBatch(ids45, {
      apiKey: "",
      forceProxy: true,
      fetchFn: async (url) => {
        batchUrls.push(String(url));
        const qs = new URLSearchParams(String(url).split("?")[1] || "");
        const chunkIds = (qs.get("ids") || "").split(",").map(Number);
        const results = {};
        for (const id of chunkIds) {
          results[String(id)] = { id, title: `Movie ${id}` };
        }
        return { ok: true, status: 200, json: async () => ({ results, errors: {} }) };
      }
    });
    assert.equal(batchUrls.length, 2);
    assert.equal(Object.keys(noCacheMap).length, 45);
    assert.equal(noCacheMap[45].id, 45);

    // 2. Cache TTL + never cache failures
    const now = 1_700_000_000_000;
    const storeMap = new Map([
      ["tmdb:1", { key: "tmdb:1", data: { id: 1, title: "Cached Fresh" }, cachedAt: now - 1000 }],
      ["tmdb:2", { key: "tmdb:2", data: { id: 2, title: "Cached Expired" }, cachedAt: now - TMDB_CACHE_TTL_MS }]
    ]);
    const cacheStore = {
      get: async (k) => storeMap.get(k) || null,
      set: async (k, v) => {
        storeMap.set(k, v);
      }
    };

    const fetchedBatches = [];
    const cachedRes = await getMovieDetailsBatch([1, 2, 3, 4], {
      apiKey: "",
      forceProxy: true,
      now,
      cacheStore,
      fetchFn: async (url) => {
        const qs = new URLSearchParams(String(url).split("?")[1] || "");
        fetchedBatches.push(qs.get("ids"));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: {
              "2": { id: 2, title: "Refreshed 2" },
              "3": { id: 3, title: "Fresh 3" }
            },
            errors: {
              "4": { status: 404, error: "Not found" }
            }
          })
        };
      }
    });

    assert.deepEqual(fetchedBatches, ["2,3,4"]);
    assert.equal(cachedRes[1].title, "Cached Fresh");
    assert.equal(cachedRes[2].title, "Refreshed 2");
    assert.equal(cachedRes[3].title, "Fresh 3");
    assert.equal(cachedRes[4], undefined);
    assert.equal(storeMap.get("tmdb:2").data.title, "Refreshed 2");
    assert.equal(storeMap.get("tmdb:3").data.title, "Fresh 3");
    assert.equal(storeMap.has("tmdb:4"), false);
  } finally {
    if (prevTmdb === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevTmdb;
  }
});

test("api/* proxy 429 rate limit sets X-RateLimit-Source: proxy, Retry-After, errorCode PROXY_RATE_LIMIT, and createProxyGeminiClient forwards them", async () => {
  resetRateLimitBuckets();
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "SERVER_GEMINI_SECRET";
  try {
    const aiFactory = () => ({
      models: {
        generateContent: async () => ({ text: "ok", usageMetadata: null })
      }
    });

    for (let i = 0; i < 20; i += 1) {
      const okRes = createMockRes();
      await geminiHandler(
        {
          method: "POST",
          headers: { "x-forwarded-for": "198.51.100.88" },
          body: { model: "gemini-3.5-flash-lite", contents: "hi" },
          aiFactory
        },
        okRes
      );
      assert.equal(okRes.statusCode, 200);
    }

    const blockedRes = createMockRes();
    await geminiHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.88" },
        body: { model: "gemini-3.5-flash-lite", contents: "hi" },
        aiFactory
      },
      blockedRes
    );

    assert.equal(blockedRes.statusCode, 429);
    assert.equal(blockedRes.body?.errorCode, "PROXY_RATE_LIMIT");
    assert.equal(blockedRes.headers["X-RateLimit-Source"], "proxy");
    assert.ok(Number(blockedRes.headers["Retry-After"]) >= 1);

    const client = createProxyGeminiClient({
      fetchFn: async () =>
        new Response(JSON.stringify(blockedRes.body), {
          status: blockedRes.statusCode,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": blockedRes.headers["Retry-After"],
            "X-RateLimit-Source": blockedRes.headers["X-RateLimit-Source"]
          }
        })
    });

    let thrown = null;
    try {
      await client.models.generateContent({ model: "gemini-3.5-flash-lite", contents: "hi" });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown);
    assert.equal(thrown.status, 429);
    assert.equal(thrown.errorCode, "PROXY_RATE_LIMIT");
    assert.equal(thrown.retryAfter, blockedRes.headers["Retry-After"]);
  } finally {
    resetRateLimitBuckets();
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});

test("api/* Sec-Fetch-Site: cross-site is rejected when Origin is absent, never overrides ALLOWED_ORIGIN, and passes without headers", async () => {
  resetRateLimitBuckets();
  const prevTmdb = process.env.TMDB_API_KEY;
  const prevAllowed = process.env.ALLOWED_ORIGIN;
  process.env.TMDB_API_KEY = "SERVER_TMDB_SECRET";
  process.env.ALLOWED_ORIGIN = "https://vault.partner.example";

  try {
    const fetchFn = async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    // Absent Origin + Sec-Fetch-Site: cross-site -> 403
    const crossSiteNoOrigin = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: {
          host: "cinemavault.example.com",
          "sec-fetch-site": "cross-site",
          "x-forwarded-for": "198.51.100.90"
        },
        query: { path: "/3/discover/movie" },
        fetchFn
      },
      crossSiteNoOrigin
    );
    assert.equal(crossSiteNoOrigin.statusCode, 403);

    // Absent Origin + mixed-case Sec-Fetch-Site: Cross-Site -> 403
    const crossSiteMixedCase = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: {
          host: "cinemavault.example.com",
          "sec-fetch-site": "Cross-Site",
          "x-forwarded-for": "198.51.100.91"
        },
        query: { path: "/3/discover/movie" },
        fetchFn
      },
      crossSiteMixedCase
    );
    assert.equal(crossSiteMixedCase.statusCode, 403);

    // Neither Origin nor Sec-Fetch-Site present -> pass-through allowed
    const serverCallNoHeaders = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: {
          host: "cinemavault.example.com",
          "x-forwarded-for": "198.51.100.92"
        },
        query: { path: "/3/discover/movie" },
        fetchFn
      },
      serverCallNoHeaders
    );
    assert.equal(serverCallNoHeaders.statusCode, 200);

    // ALLOWED_ORIGIN match + Sec-Fetch-Site: cross-site -> allowed (never overridden)
    const allowedOriginOverrideCheck = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: {
          host: "cinemavault.example.com",
          origin: "https://vault.partner.example",
          "sec-fetch-site": "cross-site",
          "x-forwarded-for": "198.51.100.93"
        },
        query: { path: "/3/discover/movie" },
        fetchFn
      },
      allowedOriginOverrideCheck
    );
    assert.equal(allowedOriginOverrideCheck.statusCode, 200);

    // Disallowed Origin + Sec-Fetch-Site: same-origin -> still 403
    const evilOriginWithSameOriginFetchSite = createMockRes();
    await tmdbHandler(
      {
        method: "GET",
        headers: {
          host: "cinemavault.example.com",
          origin: "https://evil.example.com",
          "sec-fetch-site": "same-origin",
          "x-forwarded-for": "198.51.100.94"
        },
        query: { path: "/3/discover/movie" },
        fetchFn
      },
      evilOriginWithSameOriginFetchSite
    );
    assert.equal(evilOriginWithSameOriginFetchSite.statusCode, 403);

    // Production / Vercel strict mode: curl / script with neither Origin nor Sec-Fetch-Site -> 403,
    // while browser same-origin request with Sec-Fetch-Site: same-origin -> 200
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const curlNoHeadersProd = createMockRes();
      await tmdbHandler(
        {
          method: "GET",
          headers: {
            host: "cinemavault.example.com",
            "x-forwarded-for": "198.51.100.95"
          },
          query: { path: "/3/discover/movie" },
          fetchFn
        },
        curlNoHeadersProd
      );
      assert.equal(curlNoHeadersProd.statusCode, 403, "curl without Origin or Sec-Fetch-Site must be blocked in production");

      const browserSameOriginProd = createMockRes();
      await tmdbHandler(
        {
          method: "GET",
          headers: {
            host: "cinemavault.example.com",
            "sec-fetch-site": "same-origin",
            "x-forwarded-for": "198.51.100.96"
          },
          query: { path: "/3/discover/movie" },
          fetchFn
        },
        browserSameOriginProd
      );
      assert.equal(browserSameOriginProd.statusCode, 200, "same-origin browser fetch with Sec-Fetch-Site: same-origin must pass in production");
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  } finally {
    resetRateLimitBuckets();
    if (prevTmdb === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prevTmdb;
    if (prevAllowed === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = prevAllowed;
  }
});

test("api/tmdb handler allows collection, keyword search, recommendations, and similar paths while blocking invalid suffixes", async () => {
  resetRateLimitBuckets();
  const prevTmdb = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = "SERVER_TMDB_SECRET";

  try {
    const validQueries = [
      { path: "/3/collection/87359", language: "en-US" },
      { path: "/3/search/keyword", query: "time travel", page: "1" },
      { path: "/3/movie/157336/recommendations", page: "1" },
      { path: "/3/movie/157336/similar", page: "1" }
    ];

    for (const q of validQueries) {
      const okRes = createMockRes();
      let forwardedUrl = "";
      await tmdbHandler(
        {
          method: "GET",
          query: q,
          fetchFn: async (url) => {
            forwardedUrl = String(url);
            return { ok: true, status: 200, json: async () => ({ id: 1, results: [] }) };
          }
        },
        okRes
      );
      assert.equal(okRes.statusCode, 200, `expected 200 for ${q.path}`);
      assert.match(forwardedUrl, /api_key=SERVER_TMDB_SECRET/);
    }

    for (const badPath of [
      "/3/collection/87359/images",
      "/3/collection/not-a-number",
      "/3/movie/157336/account_states",
      "/3/search/keyword/../person"
    ]) {
      const badRes = createMockRes();
      await tmdbHandler({ method: "GET", query: { path: badPath } }, badRes);
      assert.equal(badRes.statusCode, 400, `expected 400 for ${badPath}`);
    }
  } finally {
    resetRateLimitBuckets();
    if (prevTmdb === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = prevTmdb;
  }
});

test("api/gemini request guard rejects oversized or empty contents and sanitizes config", async () => {
  resetRateLimitBuckets();
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "SERVER_GEMINI_SECRET";
  try {
    let calls = 0;
    let capturedArgs = null;
    const makeAi = () => ({
      models: {
        generateContent: async (args) => {
          calls += 1;
          capturedArgs = args;
          return { text: "ok", usageMetadata: null };
        }
      }
    });

    const oversizedRes = createMockRes();
    await geminiHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.120" },
        body: { model: "gemini-3.5-flash-lite", contents: "x".repeat(60005) },
        aiFactory: makeAi
      },
      oversizedRes
    );
    assert.equal(oversizedRes.statusCode, 413);
    assert.equal(calls, 0);

    const emptyStrRes = createMockRes();
    await geminiHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.121" },
        body: { model: "gemini-3.5-flash-lite", contents: "   " },
        aiFactory: makeAi
      },
      emptyStrRes
    );
    assert.equal(emptyStrRes.statusCode, 400);
    assert.equal(calls, 0);

    const clampRes = createMockRes();
    await geminiHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.122" },
        body: {
          model: "gemini-3.5-flash-lite",
          contents: "hi",
          config: {
            temperature: 0.2,
            tools: [{ googleSearch: {} }],
            toolConfig: { any: true },
            cachedContent: "caches/123",
            maxOutputTokens: 1000000
          }
        },
        aiFactory: makeAi
      },
      clampRes
    );
    assert.equal(clampRes.statusCode, 200);
    assert.equal("tools" in capturedArgs.config, false);
    assert.equal("toolConfig" in capturedArgs.config, false);
    assert.equal("cachedContent" in capturedArgs.config, false);
    assert.equal(capturedArgs.config.maxOutputTokens, 16384);
    assert.equal(capturedArgs.config.temperature, 0.2);

    const nullConfigRes = createMockRes();
    await geminiHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.123" },
        body: { model: "gemini-3.5-flash-lite", contents: "hello", config: null },
        aiFactory: makeAi
      },
      nullConfigRes
    );
    assert.equal(nullConfigRes.statusCode, 200);
    assert.deepEqual(capturedArgs.config, { maxOutputTokens: 16384 });
  } finally {
    resetRateLimitBuckets();
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});
