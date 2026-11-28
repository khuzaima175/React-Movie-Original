import { enforceApiSecurity } from "./_security.js";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
const IGDB_MULTIQUERY_URL = "https://api.igdb.com/v4/multiquery";
const REDIS_TOKEN_KEY = "igdb:twitch_token:v1";

const VALID_GAME_TYPES = "(0,4,8,9,10)";

const CARD_FIELDS = [
  "id",
  "name",
  "game_type",
  "first_release_date",
  "total_rating",
  "total_rating_count",
  "rating_count",
  "hypes",
  "cover.image_id",
  "artworks.image_id",
  "screenshots.image_id",
  "genres.id",
  "genres.name",
  "themes.id",
  "themes.name",
  "platforms.id",
  "platforms.name",
  "platforms.abbreviation",
  "involved_companies.company.id",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "summary"
].join(",");

const DETAIL_FIELDS = [
  CARD_FIELDS,
  "storyline",
  "url",
  "videos.video_id",
  "videos.name",
  "player_perspectives.name",
  "game_modes.name",
  "keywords.name",
  "franchises.name",
  "collections.name",
  "similar_games",
  "websites.url",
  "websites.category"
].join(",");

const PLATFORM_FAMILY_IDS = {
  pc: [6, 14, 3],
  playstation: [167, 48, 9, 8, 7, 46, 38],
  xbox: [169, 49, 12, 11],
  nintendo: [130, 508, 41, 5, 21, 37, 20, 4, 19]
};

let cachedToken = { accessToken: "", expiresAt: 0 };

export function resetIgdbTokenCache() {
  cachedToken = { accessToken: "", expiresAt: 0 };
}

function sanitizeMessage(message, secrets = []) {
  let text = String(message || "Upstream IGDB request failed");
  for (const s of secrets) {
    if (s && typeof s === "string") {
      text = text.split(s).join("[REDACTED]");
    }
  }
  return text;
}

function sanitizeSearchTerm(raw = "") {
  return String(raw || "")
    .replace(/["\\;\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseRequestPayload(req) {
  if (req.method === "GET") {
    const q = req.query || {};
    const idsRaw = typeof q.ids === "string"
      ? q.ids.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    return {
      action: typeof q.action === "string" ? q.action.trim() : "",
      query: q.query,
      id: q.id,
      ids: idsRaw,
      preset: q.preset,
      genreId: q.genreId,
      platformFamily: q.platformFamily,
      minYear: q.minYear,
      maxYear: q.maxYear,
      sort: q.sort,
      page: q.page,
      limit: q.limit
    };
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body && typeof req.body === "object" ? req.body : {};
}

export function buildIgdbQuery(payload = {}) {
  const action = String(payload?.action || "").trim();
  const baseWhere = [`game_type = ${VALID_GAME_TYPES}`, "version_parent = null"];

  if (action === "search") {
    const clean = sanitizeSearchTerm(payload.query);
    if (!clean) {
      return { error: "Missing search query" };
    }
    const limit = clampInt(payload.limit, 1, 30, 18);
    const body = [
      `search "${clean}";`,
      `fields ${CARD_FIELDS};`,
      `where ${baseWhere.join(" & ")};`,
      `limit ${limit};`
    ].join(" ");
    return { action, endpoint: IGDB_GAMES_URL, body };
  }

  if (action === "details") {
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: "Invalid game id" };
    }
    const body = `fields ${DETAIL_FIELDS}; where id = ${id}; limit 1;`;
    return { action, endpoint: IGDB_GAMES_URL, body };
  }

  if (action === "batch") {
    const rawIds = Array.isArray(payload.ids) ? payload.ids : [];
    const deduped = [];
    const seen = new Set();
    for (const raw of rawIds) {
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0 && !seen.has(n)) {
        seen.add(n);
        deduped.push(n);
        if (deduped.length >= 80) break;
      }
    }
    if (deduped.length === 0) {
      return { error: "Missing valid game ids" };
    }
    const body = `fields ${CARD_FIELDS}; where id = (${deduped.join(",")}); limit ${deduped.length};`;
    return { action, endpoint: IGDB_GAMES_URL, body };
  }

  if (action === "discover_home") {
    const nowSec = Math.floor(Date.now() / 1000);
    const ts2024 = Math.floor(Date.UTC(2024, 0, 1) / 1000);
    const base = [...baseWhere, "cover != null"].join(" & ");
    const body = [
      `query games "popular" { fields ${CARD_FIELDS}; where ${base} & total_rating_count >= 250 & total_rating >= 70; sort total_rating_count desc; limit 18; };`,
      `query games "recent_hits" { fields ${CARD_FIELDS}; where ${base} & first_release_date >= ${ts2024} & first_release_date <= ${nowSec + 86400 * 30} & total_rating_count >= 35 & total_rating >= 68; sort total_rating_count desc; limit 16; };`,
      `query games "exclusives" { fields ${CARD_FIELDS}; where ${base} & platforms = (167,48,130,508,9,41,5) & platforms != (6) & total_rating_count >= 80; sort total_rating_count desc; limit 16; };`,
      `query games "top_rated" { fields ${CARD_FIELDS}; where ${base} & total_rating >= 82 & total_rating_count >= 220; sort total_rating desc; limit 16; };`
    ].join("\n");
    return { action, endpoint: IGDB_MULTIQUERY_URL, body };
  }

  if (action === "discover") {
    const preset = String(payload.preset || "catalog").trim().toLowerCase();
    const limit = clampInt(payload.limit, 1, 48, 24);
    const page = clampInt(payload.page, 1, 10, 1);
    const offset = (page - 1) * limit;
    const where = [...baseWhere, "cover != null"];

    const nowSec = Math.floor(Date.now() / 1000);
    const ts2023 = Math.floor(Date.UTC(2023, 0, 1) / 1000);
    const ts2024 = Math.floor(Date.UTC(2024, 0, 1) / 1000);
    let sortClause = "sort total_rating_count desc;";

    if (preset === "popular") {
      where.push("total_rating_count >= 250", "total_rating >= 70");
      sortClause = "sort total_rating_count desc;";
    } else if (preset === "top_rated") {
      where.push("total_rating >= 82", "total_rating_count >= 220");
      sortClause = "sort total_rating desc;";
    } else if (preset === "recent_hits") {
      where.push(`first_release_date >= ${ts2024}`, `first_release_date <= ${nowSec + 86400 * 30}`, "total_rating_count >= 35", "total_rating >= 68");
      sortClause = "sort total_rating_count desc;";
    } else if (preset === "exclusives") {
      where.push("platforms = (167,48,130,508,9,41,5)", "platforms != (6)", "total_rating_count >= 80");
      sortClause = "sort total_rating_count desc;";
    } else if (preset === "indie_gems") {
      where.push("genres = (32)", "total_rating >= 80", "total_rating_count >= 60");
      sortClause = "sort total_rating_count desc;";
    } else if (preset === "upcoming") {
      where.push(`first_release_date >= ${nowSec}`, "hypes >= 25");
      sortClause = "sort hypes desc;";
    }

    const genreId = Number(payload.genreId);
    const hasGenre = Number.isInteger(genreId) && genreId > 0;
    if (hasGenre) {
      where.push(`genres = (${genreId})`);
    }

    const famKey = String(payload.platformFamily || "").trim().toLowerCase();
    if (famKey && PLATFORM_FAMILY_IDS[famKey]) {
      where.push(`platforms = (${PLATFORM_FAMILY_IDS[famKey].join(",")})`);
    }

    const minYear = Number(payload.minYear);
    if (Number.isInteger(minYear) && minYear >= 1970 && minYear <= 2035) {
      where.push(`first_release_date >= ${Math.floor(Date.UTC(minYear, 0, 1) / 1000)}`);
    }

    const maxYear = Number(payload.maxYear);
    if (Number.isInteger(maxYear) && maxYear >= 1970 && maxYear <= 2035) {
      where.push(`first_release_date <= ${Math.floor(Date.UTC(maxYear, 11, 31, 23, 59, 59) / 1000)}`);
    }

    const sortPref = String(payload.sort || "").trim().toLowerCase();
    if (sortPref === "rating") {
      where.push("total_rating >= 72", `total_rating_count >= ${hasGenre ? 90 : 180}`);
      sortClause = "sort total_rating desc;";
    } else if (sortPref === "recent") {
      where.push(`first_release_date >= ${ts2023}`, `first_release_date <= ${nowSec + 86400 * 30}`, `total_rating_count >= ${hasGenre ? 15 : 30}`);
      sortClause = "sort first_release_date desc;";
    } else if (sortPref === "hypes") {
      where.push("hypes >= 15");
      sortClause = "sort hypes desc;";
    } else if (sortPref === "popular" || preset === "catalog") {
      where.push(`total_rating_count >= ${hasGenre ? 50 : 120}`);
      sortClause = "sort total_rating_count desc;";
    }

    const body = `fields ${CARD_FIELDS}; where ${where.join(" & ")}; ${sortClause} limit ${limit}; offset ${offset};`;
    return { action, endpoint: IGDB_GAMES_URL, body };
  }

  return { error: `Invalid or disallowed IGDB action: ${action || "(empty)"}` };
}

async function readSharedRedisToken(fetchFn) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) return "";
  try {
    const res = await fetchFn(`${url}/get/${encodeURIComponent(REDIS_TOKEN_KEY)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res || !res.ok) return "";
    const json = await res.json();
    return typeof json?.result === "string" ? json.result.trim() : "";
  } catch {
    return "";
  }
}

async function writeSharedRedisToken(accessToken, ttlSec, fetchFn) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token || !accessToken) return;
  try {
    await fetchFn(`${url}/set/${encodeURIComponent(REDIS_TOKEN_KEY)}/${encodeURIComponent(accessToken)}?EX=${Math.max(60, Math.floor(ttlSec))}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    // non-fatal: in-memory cache still holds token
  }
}

async function fetchTwitchAccessToken(clientId, clientSecret, fetchFn, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken.accessToken && cachedToken.expiresAt > now + 120_000) {
    return cachedToken.accessToken;
  }

  if (!forceRefresh) {
    const shared = await readSharedRedisToken(fetchFn);
    if (shared) {
      cachedToken = { accessToken: shared, expiresAt: now + 600_000 };
      return shared;
    }
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials"
  });
  const resp = await fetchFn(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  if (!resp || !resp.ok) {
    throw new Error(`Twitch OAuth failed (HTTP ${resp?.status || 502})`);
  }
  const data = await resp.json();
  const accessToken = String(data?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("Twitch OAuth returned empty access_token");
  }
  const expiresInSec = Math.max(120, Number(data?.expires_in) || 3600);
  cachedToken = {
    accessToken,
    expiresAt: now + expiresInSec * 1000
  };
  await writeSharedRedisToken(accessToken, Math.max(60, expiresInSec - 300), fetchFn);
  return accessToken;
}

export default async function handler(req, res) {
  if (!(await enforceApiSecurity(req, res, { bucket: "igdb", maxRequests: 90, windowMs: 60_000 }))) {
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader?.("Allow", "POST, GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const clientId = (process.env.IGDB_CLIENT_ID || process.env.TWITCH_CLIENT_ID || "").trim();
  const clientSecret = (process.env.IGDB_CLIENT_SECRET || process.env.TWITCH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    return res.status(503).json({ error: "Server IGDB credentials are not configured" });
  }

  const payload = parseRequestPayload(req);
  const built = buildIgdbQuery(payload);
  if (built.error) {
    return res.status(400).json({ error: built.error });
  }

  const fetchFn = typeof req.fetchFn === "function" ? req.fetchFn : fetch;
  let token = "";

  try {
    token = await fetchTwitchAccessToken(clientId, clientSecret, fetchFn, false);

    const targetUrl = built.endpoint || IGDB_GAMES_URL;
    const runQuery = async (bearer) =>
      fetchFn(targetUrl, {
        method: "POST",
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          "Content-Type": "text/plain"
        },
        body: built.body
      });

    let upstream = await runQuery(token);
    if (upstream && upstream.status === 401) {
      token = await fetchTwitchAccessToken(clientId, clientSecret, fetchFn, true);
      upstream = await runQuery(token);
    }

    if (!upstream || !upstream.ok) {
      const detail = typeof upstream?.text === "function" ? await upstream.text() : "";
      return res.status(upstream?.status || 502).json({
        error: sanitizeMessage(detail || `IGDB HTTP ${upstream?.status || 502}`, [clientSecret, token])
      });
    }

    const rows = await upstream.json();
    const cacheHeader = built.action === "search"
      ? "public, s-maxage=300, stale-while-revalidate=600"
      : "public, s-maxage=3600, stale-while-revalidate=86400";
    res.setHeader?.("Cache-Control", cacheHeader);

    if (built.action === "discover_home") {
      const sections = { popular: [], recent_hits: [], exclusives: [], top_rated: [] };
      if (Array.isArray(rows)) {
        for (const entry of rows) {
          const name = String(entry?.name || "");
          if (Object.prototype.hasOwnProperty.call(sections, name) && Array.isArray(entry?.result)) {
            sections[name] = entry.result;
          }
        }
      }
      return res.status(200).json({
        action: "discover_home",
        sections
      });
    }

    const items = Array.isArray(rows) ? rows : [];
    return res.status(200).json({
      action: built.action,
      items,
      item: built.action === "details" ? (items[0] || null) : undefined
    });
  } catch (err) {
    return res.status(502).json({
      error: sanitizeMessage(err?.message, [clientSecret, token])
    });
  }
}
