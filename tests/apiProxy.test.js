import test from "node:test";
import assert from "node:assert/strict";
import { fetchTmdbJson, fetchOmdbJson, createProxyGeminiClient } from "../src/services/apiTransport.js";
import tmdbHandler from "../api/tmdb.js";
import omdbHandler from "../api/omdb.js";
import geminiHandler from "../api/gemini.js";

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
