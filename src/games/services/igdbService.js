/**
 * IGDB v4 Client & Normalizer for GameVault.
 * Communicates strictly through `/api/igdb` (both in Vercel production and Vite local dev middleware),
 * caching game cards & dossiers in memory + IndexedDB (`gamevault_igdb_cache_v1`).
 */

const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload";
const IDB_NAME = "gamevault_igdb_cache_v1";
const IDB_STORE = "games";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

const PC_PLATFORM_IDS = new Set([6, 14, 3]);
const PLAYSTATION_IDS = new Set([167, 48, 9, 8, 7, 46, 38]);
const XBOX_IDS = new Set([169, 49, 12, 11]);
const NINTENDO_IDS = new Set([130, 508, 41, 5, 21, 37, 20, 4, 19]);

export const GAME_GENRES = Object.freeze([
  { id: 12, name: "RPG" },
  { id: 31, name: "Adventure" },
  { id: 5, name: "Shooter" },
  { id: 32, name: "Indie" },
  { id: 15, name: "Strategy" },
  { id: 8, name: "Platformer" },
  { id: 25, name: "Hack & Slash" },
  { id: 9, name: "Puzzle" },
  { id: 13, name: "Simulator" },
  { id: 4, name: "Fighting" },
  { id: 10, name: "Racing" },
  { id: 16, name: "Turn-Based Strategy" },
  { id: 24, name: "Tactical" },
  { id: 34, name: "Visual Novel" },
  { id: 35, name: "Card & Board" }
]);

export const GAME_PLATFORM_FAMILIES = Object.freeze([
  { id: "all", label: "All Platforms" },
  { id: "pc", label: "PC" },
  { id: "playstation", label: "PlayStation" },
  { id: "nintendo", label: "Nintendo" },
  { id: "xbox", label: "Xbox" }
]);

const memCache = new Map();
const inflightRequests = new Map();

export function buildIgdbImageUrl(imageId = "", size = "cover_big_2x") {
  const clean = String(imageId || "").trim();
  if (!clean) return "";
  return `${IGDB_IMAGE_BASE}/t_${size}/${clean}.jpg`;
}

export function extractPlatformFamilies(platforms = []) {
  const fams = [];
  const seen = new Set();
  const add = (f) => {
    if (!seen.has(f)) {
      seen.add(f);
      fams.push(f);
    }
  };
  for (const p of Array.isArray(platforms) ? platforms : []) {
    const id = Number(typeof p === "object" ? p?.id : p);
    const name = String(typeof p === "object" ? (p?.name || p?.abbreviation || "") : "").toLowerCase();
    if (PC_PLATFORM_IDS.has(id) || /\b(pc|windows|linux|mac)\b/.test(name)) add("pc");
    if (PLAYSTATION_IDS.has(id) || /playstation|ps[1-5]|psp|vita/.test(name)) add("playstation");
    if (XBOX_IDS.has(id) || /xbox/.test(name)) add("xbox");
    if (NINTENDO_IDS.has(id) || /nintendo|switch|wii|gamecube|game boy|3ds|\bds\b/.test(name)) add("nintendo");
  }
  return fams;
}

export function normalizeIgdbGame(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const igdbId = Number(raw.id ?? raw.igdbId ?? 0);
  if (!Number.isInteger(igdbId) || igdbId <= 0) return null;

  const ts = Number(raw.first_release_date);
  let year = raw.year ? Number(raw.year) : null;
  let releaseDate = raw.releaseDate || "";
  if (Number.isFinite(ts) && ts > 0) {
    const d = new Date(ts * 1000);
    if (!Number.isNaN(d.getTime())) {
      year = d.getUTCFullYear();
      releaseDate = d.toISOString().slice(0, 10);
    }
  }

  const totalRating = Number(raw.total_rating);
  const rating10 = Number.isFinite(totalRating) && totalRating > 0
    ? Math.round((totalRating / 10) * 10) / 10
    : (Number.isFinite(Number(raw.rating10)) ? Number(raw.rating10) : null);

  const coverId = raw.cover?.image_id || "";
  const coverUrl = raw.coverUrl || buildIgdbImageUrl(coverId, "cover_big_2x");
  const artworkId = raw.artworks?.[0]?.image_id || "";
  const firstScreenId = raw.screenshots?.[0]?.image_id || "";
  const backdropUrl = raw.backdropUrl || buildIgdbImageUrl(artworkId || firstScreenId || coverId, "1080p");

  const screenshots = Array.isArray(raw.screenshots)
    ? raw.screenshots
        .map((s) => (typeof s === "string" ? s : buildIgdbImageUrl(s?.image_id, "screenshot_big")))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const developers = [];
  const publishers = [];
  for (const ic of Array.isArray(raw.involved_companies) ? raw.involved_companies : []) {
    const cname = String(ic?.company?.name || "").trim();
    if (!cname) continue;
    if (ic.developer && !developers.includes(cname)) developers.push(cname);
    if (ic.publisher && !publishers.includes(cname)) publishers.push(cname);
  }

  const genres = Array.isArray(raw.genres)
    ? raw.genres.map((g) => (typeof g === "string" ? g : g?.name)).filter(Boolean)
    : [];
  const genreIds = Array.isArray(raw.genres)
    ? raw.genres.map((g) => Number(g?.id)).filter((n) => Number.isInteger(n) && n > 0)
    : (Array.isArray(raw.genreIds) ? raw.genreIds : []);
  const themes = Array.isArray(raw.themes)
    ? raw.themes.map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean)
    : [];
  const themeIds = Array.isArray(raw.themes)
    ? raw.themes.map((t) => Number(t?.id)).filter((n) => Number.isInteger(n) && n > 0)
    : (Array.isArray(raw.themeIds) ? raw.themeIds : []);
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms.map((p) => (typeof p === "string" ? p : (p?.abbreviation || p?.name))).filter(Boolean)
    : [];
  const platformFamilies = Array.isArray(raw.platformFamilies)
    ? raw.platformFamilies
    : extractPlatformFamilies(raw.platforms);

  const trailerObj = Array.isArray(raw.videos)
    ? (raw.videos.find((v) => /trailer|official/i.test(v?.name || "")) || raw.videos[0])
    : null;
  const trailerKey = raw.trailerKey || (trailerObj?.video_id ? String(trailerObj.video_id).trim() : "");

  const isExclusive = platformFamilies.length === 1 && platformFamilies[0] !== "pc";

  return {
    igdbId,
    title: String(raw.name || raw.title || "Untitled Game").trim(),
    year: Number.isFinite(year) ? year : null,
    releaseDate,
    coverUrl,
    backdropUrl,
    screenshots,
    trailerKey,
    totalRating: Number.isFinite(totalRating) ? Math.round(totalRating) : null,
    rating10,
    ratingCount: Number(raw.total_rating_count ?? raw.ratingCount ?? 0) || 0,
    hypes: Number(raw.hypes ?? 0) || 0,
    genres,
    genreIds,
    themes,
    themeIds,
    platforms: [...new Set(platforms)].slice(0, 8),
    platformFamilies,
    isExclusive,
    developers: developers.length > 0 ? developers.slice(0, 4) : (Array.isArray(raw.developers) ? raw.developers : []),
    publishers: publishers.length > 0 ? publishers.slice(0, 3) : (Array.isArray(raw.publishers) ? raw.publishers : []),
    perspectives: Array.isArray(raw.player_perspectives)
      ? raw.player_perspectives.map((p) => p?.name).filter(Boolean)
      : (Array.isArray(raw.perspectives) ? raw.perspectives : []),
    modes: Array.isArray(raw.game_modes)
      ? raw.game_modes.map((m) => m?.name).filter(Boolean)
      : (Array.isArray(raw.modes) ? raw.modes : []),
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.map((k) => (typeof k === "string" ? k : k?.name)).filter(Boolean).slice(0, 15)
      : [],
    franchises: [
      ...(Array.isArray(raw.franchises) ? raw.franchises.map((f) => (typeof f === "string" ? f : f?.name)) : []),
      ...(Array.isArray(raw.collections) ? raw.collections.map((c) => (typeof c === "string" ? c : c?.name)) : [])
    ].filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx).slice(0, 4),
    similarGameIds: Array.isArray(raw.similar_games)
      ? raw.similar_games.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 16)
      : (Array.isArray(raw.similarGameIds) ? raw.similarGameIds : []),
    summary: String(raw.summary || "").trim(),
    storyline: String(raw.storyline || "").trim(),
    igdbUrl: String(raw.url || raw.igdbUrl || "").trim()
  };
}

function openCacheDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(key) {
  const mem = memCache.get(key);
  if (mem && Date.now() - mem.ts < CACHE_TTL_MS) return mem.data;
  const db = await openCacheDb();
  if (!db) return null;
  try {
    const rec = await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (rec && Date.now() - rec.ts < CACHE_TTL_MS) {
      memCache.set(key, rec);
      return rec.data;
    }
    return null;
  } finally {
    db.close?.();
  }
}

async function idbSet(key, data) {
  const rec = { ts: Date.now(), data };
  memCache.set(key, rec);
  const db = await openCacheDb();
  if (!db) return;
  try {
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(rec, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close?.();
  }
}

async function requestIgdbProxy(payload, options = {}) {
  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : fetch;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(payload || {})) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "ids" && Array.isArray(v)) {
      const sorted = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
      if (sorted.length > 0) params.set("ids", sorted.join(","));
    } else {
      params.set(k, String(v));
    }
  }
  const queryUrl = `/api/igdb?${params.toString()}`;
  const useGet = queryUrl.length <= 1600;
  const res = useGet
    ? await fetchFn(queryUrl, {
        method: "GET",
        ...(options.signal ? { signal: options.signal } : {})
      })
    : await fetchFn("/api/igdb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        ...(options.signal ? { signal: options.signal } : {})
      });
  if (!res || !res.ok) {
    const msg = res ? `IGDB proxy HTTP ${res.status}` : "IGDB proxy unreachable";
    throw new Error(msg);
  }
  return await res.json();
}

export async function searchGames(query = "", { limit = 18, signal = null, fetchFn = null } = {}) {
  const clean = String(query || "").trim();
  if (!clean) return [];
  const data = await requestIgdbProxy({ action: "search", query: clean, limit }, { signal, fetchFn });
  const normalized = (data?.items || []).map(normalizeIgdbGame).filter(Boolean);
  const target = clean.toLowerCase();
  normalized.sort((a, b) => {
    const aExact = a.title.toLowerCase() === target ? 1 : 0;
    const bExact = b.title.toLowerCase() === target ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return (b.ratingCount || 0) - (a.ratingCount || 0);
  });
  return normalized;
}

export async function fetchGameDetails(igdbId, { signal = null, fetchFn = null } = {}) {
  const id = Number(igdbId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const cacheKey = `detail:${id}`;
  const cached = await idbGet(cacheKey);
  if (cached) return cached;

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const promise = requestIgdbProxy({ action: "details", id }, { signal, fetchFn })
    .then(async (data) => {
      const game = normalizeIgdbGame(data?.item || data?.items?.[0]);
      if (game) {
        await idbSet(cacheKey, game);
        await idbSet(`card:${id}`, game);
      }
      return game;
    })
    .finally(() => {
      inflightRequests.delete(cacheKey);
    });

  inflightRequests.set(cacheKey, promise);
  return promise;
}

export async function fetchGamesBatch(igdbIds = [], { signal = null, fetchFn = null } = {}) {
  const cleanIds = [...new Set(
    (Array.isArray(igdbIds) ? igdbIds : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
  )];
  if (cleanIds.length === 0) return [];

  const resultMap = new Map();
  const missing = [];
  for (const id of cleanIds) {
    const cached = await idbGet(`card:${id}`);
    if (cached) {
      resultMap.set(id, cached);
    } else {
      missing.push(id);
    }
  }

  // Fetch missing IDs in parallel chunks of 60 (canonical sorted GET URLs hit Vercel Edge CDN)
  const chunkPromises = [];
  for (let i = 0; i < missing.length; i += 60) {
    const chunk = missing.slice(i, i + 60);
    chunkPromises.push(
      requestIgdbProxy({ action: "batch", ids: chunk }, { signal, fetchFn })
        .then(async (data) => {
          for (const raw of data?.items || []) {
            const game = normalizeIgdbGame(raw);
            if (game) {
              resultMap.set(game.igdbId, game);
              await idbSet(`card:${game.igdbId}`, game);
            }
          }
        })
        .catch(() => {})
    );
  }
  await Promise.all(chunkPromises);

  return cleanIds.map((id) => resultMap.get(id)).filter(Boolean);
}

/**
 * Fetches all 4 Discover homepage rows (Popular, Recent Hits, Console Exclusives, All-Time Acclaimed)
 * in ONE IGDB multiquery + Vercel Edge CDN-cached GET request.
 */
export async function discoverHomeRows({ signal = null, fetchFn = null } = {}) {
  const cacheKey = "disc:home_bundle_v1";
  const mem = memCache.get(cacheKey);
  if (mem && Date.now() - mem.ts < 1000 * 60 * 15) {
    return mem.data;
  }

  try {
    const data = await requestIgdbProxy({ action: "discover_home" }, { signal, fetchFn });
    if (data?.sections && typeof data.sections === "object") {
      const normalized = {
        popular: (data.sections.popular || []).map(normalizeIgdbGame).filter(Boolean),
        recent_hits: (data.sections.recent_hits || []).map(normalizeIgdbGame).filter(Boolean),
        exclusives: (data.sections.exclusives || []).map(normalizeIgdbGame).filter(Boolean),
        top_rated: (data.sections.top_rated || []).map(normalizeIgdbGame).filter(Boolean)
      };
      memCache.set(cacheKey, { ts: Date.now(), data: normalized });
      for (const list of Object.values(normalized)) {
        for (const g of list) {
          memCache.set(`card:${g.igdbId}`, { ts: Date.now(), data: g });
        }
      }
      return normalized;
    }
  } catch {
    // Fallback to individual discover calls if multiquery endpoint unavailable
  }

  const [popular, recent_hits, exclusives, top_rated] = await Promise.all([
    discoverGames({ preset: "popular", limit: 18 }, { signal, fetchFn }),
    discoverGames({ preset: "recent_hits", limit: 16 }, { signal, fetchFn }),
    discoverGames({ preset: "exclusives", limit: 16 }, { signal, fetchFn }),
    discoverGames({ preset: "top_rated", limit: 16 }, { signal, fetchFn })
  ]);
  const fallbackBundle = { popular, recent_hits, exclusives, top_rated };
  memCache.set(cacheKey, { ts: Date.now(), data: fallbackBundle });
  return fallbackBundle;
}

export async function discoverGames(
  {
    preset = "top_rated",
    genreId = null,
    platformFamily = "all",
    minYear = null,
    maxYear = null,
    sort = "",
    page = 1,
    limit = 24
  } = {},
  { signal = null, fetchFn = null } = {}
) {
  const cacheKey = `disc:${preset}:${genreId || ""}:${platformFamily}:${minYear || ""}:${maxYear || ""}:${sort}:${page}:${limit}`;
  const mem = memCache.get(cacheKey);
  if (mem && Date.now() - mem.ts < 1000 * 60 * 15) {
    return mem.data;
  }

  const data = await requestIgdbProxy(
    {
      action: "discover",
      preset,
      genreId: genreId || undefined,
      platformFamily: platformFamily !== "all" ? platformFamily : undefined,
      minYear: minYear || undefined,
      maxYear: maxYear || undefined,
      sort: sort || undefined,
      page,
      limit
    },
    { signal, fetchFn }
  );
  const items = (data?.items || []).map(normalizeIgdbGame).filter(Boolean);
  memCache.set(cacheKey, { ts: Date.now(), data: items });
  for (const g of items) {
    memCache.set(`card:${g.igdbId}`, { ts: Date.now(), data: g });
  }
  return items;
}
