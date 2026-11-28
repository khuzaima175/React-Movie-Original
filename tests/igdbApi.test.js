import test from "node:test";
import assert from "node:assert/strict";
import { resetRateLimitBuckets } from "../api/_security.js";

function createMockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    headers,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

test("api/igdb rejects unsupported HTTP methods and cross-origin requests", async () => {
  resetRateLimitBuckets();
  const { default: handler, resetIgdbTokenCache } = await import("../api/igdb.js");
  resetIgdbTokenCache();

  const badOriginRes = createMockRes();
  await handler(
    { method: "POST", headers: { origin: "https://evil.example" }, body: { action: "search", query: "zelda" } },
    badOriginRes
  );
  assert.equal(badOriginRes.statusCode, 403);

  const badMethodRes = createMockRes();
  await handler(
    { method: "DELETE", headers: { origin: "http://localhost:3000" }, body: {} },
    badMethodRes
  );
  assert.equal(badMethodRes.statusCode, 405);
});

test("api/igdb rejects invalid actions and missing/invalid inputs cleanly", async () => {
  resetRateLimitBuckets();
  const { default: handler, resetIgdbTokenCache } = await import("../api/igdb.js");
  resetIgdbTokenCache();

  const origId = process.env.IGDB_CLIENT_ID;
  const origSec = process.env.IGDB_CLIENT_SECRET;
  process.env.IGDB_CLIENT_ID = "test_client_id";
  process.env.IGDB_CLIENT_SECRET = "test_secret_xyz";

  try {
    const res1 = createMockRes();
    await handler(
      { method: "POST", headers: { origin: "http://localhost:3000" }, body: { action: "raw_sql", body: "fields *;" } },
      res1
    );
    assert.equal(res1.statusCode, 400);

    const res2 = createMockRes();
    await handler(
      { method: "POST", headers: { origin: "http://localhost:3000" }, body: { action: "details", id: "not-a-num" } },
      res2
    );
    assert.equal(res2.statusCode, 400);

    const res3 = createMockRes();
    await handler(
      { method: "POST", headers: { origin: "http://localhost:3000" }, body: { action: "batch", ids: [] } },
      res3
    );
    assert.equal(res3.statusCode, 400);
  } finally {
    if (origId === undefined) delete process.env.IGDB_CLIENT_ID; else process.env.IGDB_CLIENT_ID = origId;
    if (origSec === undefined) delete process.env.IGDB_CLIENT_SECRET; else process.env.IGDB_CLIENT_SECRET = origSec;
  }
});

test("api/igdb caches Twitch OAuth token across calls, builds safe canonical queries, and refreshes on 401", async () => {
  resetRateLimitBuckets();
  const { default: handler, resetIgdbTokenCache } = await import("../api/igdb.js");
  resetIgdbTokenCache();

  const origId = process.env.IGDB_CLIENT_ID;
  const origSec = process.env.IGDB_CLIENT_SECRET;
  process.env.IGDB_CLIENT_ID = "cid_123";
  process.env.IGDB_CLIENT_SECRET = "super_secret_token_999";

  let oauthCalls = 0;
  const igdbBodies = [];
  let failOnceWith401 = false;

  const mockFetch = async (url, init = {}) => {
    if (String(url).startsWith("https://id.twitch.tv/oauth2/token")) {
      oauthCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: `tok_${oauthCalls}`, expires_in: 3600 })
      };
    }
    if (String(url).startsWith("https://api.igdb.com/v4/games")) {
      igdbBodies.push(String(init.body || ""));
      if (failOnceWith401) {
        failOnceWith401 = false;
        return { ok: false, status: 401, text: async () => "Unauthorized" };
      }
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 119133, name: "Elden Ring", total_rating: 94.5 }]
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    // 1. Search action
    const r1 = createMockRes();
    await handler(
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: { action: "search", query: 'Elden "Ring"; drop', limit: 12 },
        fetchFn: mockFetch
      },
      r1
    );
    assert.equal(r1.statusCode, 200);
    assert.equal(oauthCalls, 1);
    assert.equal(r1.body.items.length, 1);
    assert.match(igdbBodies[0], /version_parent = null/);
    assert.match(igdbBodies[0], /game_type = \(0,4,8,9,10\)/);
    assert.ok(!igdbBodies[0].includes('"; drop'));

    // 2. Batch action reuses cached OAuth token
    const r2 = createMockRes();
    await handler(
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: { action: "batch", ids: [119133, 7334, 119133] },
        fetchFn: mockFetch
      },
      r2
    );
    assert.equal(r2.statusCode, 200);
    assert.equal(oauthCalls, 1, "should reuse cached OAuth token");
    assert.match(igdbBodies[igdbBodies.length - 1], /where id = \(119133,7334\)/);

    // 3. Discover action handles 401 refresh automatically
    failOnceWith401 = true;
    const r3 = createMockRes();
    await handler(
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: { action: "discover", preset: "recent_hits", platformFamily: "playstation", limit: 20 },
        fetchFn: mockFetch
      },
      r3
    );
    assert.equal(r3.statusCode, 200);
    assert.equal(oauthCalls, 2, "should refresh token on 401");
    assert.match(igdbBodies[igdbBodies.length - 1], /platforms = \(/);
  } finally {
    if (origId === undefined) delete process.env.IGDB_CLIENT_ID; else process.env.IGDB_CLIENT_ID = origId;
    if (origSec === undefined) delete process.env.IGDB_CLIENT_SECRET; else process.env.IGDB_CLIENT_SECRET = origSec;
  }
});

test("api/igdb redacts client secret from upstream error messages", async () => {
  resetRateLimitBuckets();
  const { default: handler, resetIgdbTokenCache } = await import("../api/igdb.js");
  resetIgdbTokenCache();

  const origId = process.env.IGDB_CLIENT_ID;
  const origSec = process.env.IGDB_CLIENT_SECRET;
  process.env.IGDB_CLIENT_ID = "cid_123";
  process.env.IGDB_CLIENT_SECRET = "my_top_secret_val";

  try {
    const res = createMockRes();
    await handler(
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: { action: "details", id: 1942 },
        fetchFn: async () => {
          throw new Error("Connection failed with my_top_secret_val");
        }
      },
      res
    );
    assert.equal(res.statusCode, 502);
    assert.equal(String(res.body?.error || "").includes("my_top_secret_val"), false);
    assert.match(String(res.body?.error || ""), /\[REDACTED\]/);
  } finally {
    if (origId === undefined) delete process.env.IGDB_CLIENT_ID; else process.env.IGDB_CLIENT_ID = origId;
    if (origSec === undefined) delete process.env.IGDB_CLIENT_SECRET; else process.env.IGDB_CLIENT_SECRET = origSec;
  }
});

test("buildIgdbQuery enforces high review-count floors on popular & rating catalog queries to block 10-vote shovelware", async () => {
  const { buildIgdbQuery } = await import("../api/igdb.js");

  const pop = buildIgdbQuery({ action: "discover", preset: "popular", limit: 16 });
  assert.match(pop.body, /total_rating_count >= 250/);
  assert.match(pop.body, /sort total_rating_count desc;/);

  const rated = buildIgdbQuery({ action: "discover", preset: "catalog", sort: "rating", limit: 36 });
  assert.match(rated.body, /total_rating_count >= 180/);
  assert.match(rated.body, /total_rating >= 72/);

  const catDefault = buildIgdbQuery({ action: "discover", preset: "catalog", sort: "popular", limit: 36 });
  assert.match(catDefault.body, /total_rating_count >= 120/);
  assert.match(catDefault.body, /sort total_rating_count desc;/);

  const searchBuilt = buildIgdbQuery({ action: "search", query: "civilization", limit: 20 });
  assert.match(searchBuilt.body, /name ~ \*"civilization"\*/);
  assert.match(searchBuilt.body, /sort total_rating_count desc;/);
  assert.match(searchBuilt.fallbackBody, /search "civilization";/);
});

test("api/igdb v1.4 supports GET discover_home multiquery (1 IGDB call + 1h Edge CDN Cache-Control) and igdbService sends GET with sorted batch IDs", async () => {
  resetRateLimitBuckets();
  const { default: handler, resetIgdbTokenCache } = await import("../api/igdb.js");
  const { discoverHomeRows, fetchGamesBatch } = await import("../src/games/services/igdbService.js");
  resetIgdbTokenCache();

  const origId = process.env.IGDB_CLIENT_ID;
  const origSec = process.env.IGDB_CLIENT_SECRET;
  process.env.IGDB_CLIENT_ID = "cid_v14";
  process.env.IGDB_CLIENT_SECRET = "sec_v14";

  const upstreamUrls = [];
  const mockFetch = async (url) => {
    upstreamUrls.push(String(url));
    if (String(url).startsWith("https://id.twitch.tv/oauth2/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "tok_v14", expires_in: 3600 }) };
    }
    if (String(url) === "https://api.igdb.com/v4/multiquery") {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { name: "popular", result: [{ id: 1942, name: "The Witcher 3", total_rating: 94 }] },
          { name: "recent_hits", result: [{ id: 228525, name: "Hades II", total_rating: 90 }] },
          { name: "exclusives", result: [{ id: 7334, name: "Bloodborne", total_rating: 92 }] },
          { name: "top_rated", result: [{ id: 119133, name: "Elden Ring", total_rating: 95 }] }
        ]
      };
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  };

  try {
    const res = createMockRes();
    await handler(
      {
        method: "GET",
        headers: { origin: "http://localhost:3000" },
        url: "/api/igdb?action=discover_home",
        fetchFn: mockFetch
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "discover_home");
    assert.equal(res.body.sections.popular.length, 1);
    assert.equal(res.body.sections.exclusives[0].id, 7334);
    assert.match(res.headers["cache-control"], /s-maxage=3600/);
    assert.equal(upstreamUrls.filter((u) => u.includes("multiquery")).length, 1);

    // Client igdbService sends GET /api/igdb?action=discover_home and canonical sorted GET for batch
    const clientCalls = [];
    const clientFetch = async (url, init) => {
      clientCalls.push({ url: String(url), method: init?.method || "GET" });
      if (String(url).includes("action=discover_home")) {
        return { ok: true, status: 200, json: async () => res.body };
      }
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 7334, name: "Bloodborne" }, { id: 1942, name: "Witcher 3" }] }) };
    };
    const home = await discoverHomeRows({ fetchFn: clientFetch });
    assert.equal(home.popular[0].igdbId, 1942);
    assert.equal(clientCalls[0].method, "GET");
    assert.match(clientCalls[0].url, /\/api\/igdb\?action=discover_home/);

    await fetchGamesBatch([999111, 888222], { fetchFn: clientFetch });
    const batchCall = clientCalls.find((c) => c.url.includes("action=batch"));
    assert.ok(batchCall, "expected batch GET call");
    assert.equal(batchCall.method, "GET");
    assert.match(batchCall.url, /ids=888222%2C999111|ids=888222,999111/);
  } finally {
    if (origId === undefined) delete process.env.IGDB_CLIENT_ID; else process.env.IGDB_CLIENT_ID = origId;
    if (origSec === undefined) delete process.env.IGDB_CLIENT_SECRET; else process.env.IGDB_CLIENT_SECRET = origSec;
  }
});
