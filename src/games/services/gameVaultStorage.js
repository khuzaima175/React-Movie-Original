/**
 * Isolated IndexedDB + localStorage Vault Storage and Import/Export for GameVault.
 * Strictly isolated from CinemaVault's `cinemavault_vault_v1` database.
 */

export const GAME_VAULT_IDB_NAME = "gamevault_vault_v1";
export const GAME_VAULT_IDB_STORE = "kv";
export const GAME_IGDB_CACHE_IDB_NAME = "gamevault_igdb_cache_v1";
export const GAME_PLAYED_STORAGE_KEY = "gamevault_played_v1";
export const GAME_BACKLOG_STORAGE_KEY = "gamevault_backlog_v1";
export const GAME_DISMISSED_STORAGE_KEY = "gamevault_dismissed_v1";
export const GAME_DELETED_TOMBSTONES_KEY = "gamevault_deleted_tombstones_v1";
export const GAME_RIG_STORAGE_KEY_REF = "gamevault_rig_profile_v1";
const TOMBSTONE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export const GAME_STATUS_OPTIONS = Object.freeze([
  { id: "completed", label: "Completed" },
  { id: "platinum", label: "100% Platinum" },
  { id: "playing", label: "Playing" },
  { id: "on_hold", label: "Unfinished / Paused" },
  { id: "tried_bored", label: "Tried — Got Bored" },
  { id: "dropped", label: "Dropped" },
  { id: "played", label: "Played" }
]);

export const GAME_STATUS_SHORT_LABELS = Object.freeze({
  completed: "Completed",
  platinum: "100%",
  playing: "Playing",
  on_hold: "Paused",
  tried_bored: "Bored Early",
  dropped: "Dropped",
  played: "Played"
});

export const GAME_CRAFT_ASPECTS = Object.freeze([
  { id: "gameplay", label: "Gameplay & Combat" },
  { id: "story", label: "Story & World" },
  { id: "pacing", label: "Pacing & Immersion" },
  { id: "visuals", label: "Visuals & Art" },
  { id: "audio", label: "Sound & OST" },
  { id: "replayability", label: "Replayability" }
]);

export const GAME_QUICK_TAGS = Object.freeze([
  "#Masterpiece",
  "#PeakBossFights",
  "#AddictiveLoop",
  "#DeepStory",
  "#RichOpenWorld",
  "#ChoicesMatter",
  "#UnforgettableOST",
  "#EmotionalEnding",
  "#Atmospheric",
  "#TightPacing",
  "#TacticalDepth",
  "#CozyVibes",
  "#PureFun",
  "#GreatCoop",
  "#HiddenGem",
  "#SlowStart",
  "#TooGrindy",
  "#Janky"
]);

function openGameDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(GAME_VAULT_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(GAME_VAULT_IDB_STORE)) {
          db.createObjectStore(GAME_VAULT_IDB_STORE);
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
  const db = await openGameDb();
  if (!db) return undefined;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(GAME_VAULT_IDB_STORE, "readonly");
      const req = tx.objectStore(GAME_VAULT_IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } finally {
    db.close?.();
  }
}

async function idbSet(key, val) {
  const db = await openGameDb();
  if (!db) return;
  try {
    await new Promise((resolve) => {
      const tx = db.transaction(GAME_VAULT_IDB_STORE, "readwrite");
      tx.objectStore(GAME_VAULT_IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close?.();
  }
}

function readLocalFallback(key) {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalFallback(key, list) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // ignore storage quota errors when IDB is primary
  }
}

function sanitizeCraftBreakdown(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  let count = 0;
  for (const a of GAME_CRAFT_ASPECTS) {
    const v = Number(raw[a.id]);
    if (Number.isFinite(v) && v >= 1 && v <= 5) {
      out[a.id] = Math.round(v);
      count++;
    }
  }
  return count > 0 ? out : null;
}

export function compactGameRecord(game = {}) {
  const igdbId = Number(game?.igdbId ?? game?.id ?? 0);
  if (!Number.isInteger(igdbId) || igdbId <= 0) return null;
  const rating = Number(game?.userRating ?? 0);
  const hours = Number(game?.hoursPlayed ?? 0);
  const breakdown = sanitizeCraftBreakdown(game?.ratingBreakdown);
  const quickTags = Array.isArray(game?.quickTags)
    ? [...new Set(game.quickTags.map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 8)
    : [];
  return {
    igdbId,
    title: String(game?.title || game?.name || "Untitled Game").trim(),
    year: Number.isFinite(Number(game?.year)) && Number(game?.year) > 0 ? Number(game.year) : null,
    coverUrl: String(game?.coverUrl || "").trim(),
    backdropUrl: String(game?.backdropUrl || "").trim(),
    rating10: Number.isFinite(Number(game?.rating10)) ? Number(game.rating10) : null,
    ratingCount: Number(game?.ratingCount ?? 0) || 0,
    genres: Array.isArray(game?.genres) && game.genres.length > 0
      ? game.genres.slice(0, 6)
      : (game?.primaryGenre ? [String(game.primaryGenre).trim()] : []),
    themes: Array.isArray(game?.themes) ? game.themes.slice(0, 6) : [],
    platforms: Array.isArray(game?.platforms) ? game.platforms.slice(0, 6) : [],
    platformFamilies: Array.isArray(game?.platformFamilies) ? game.platformFamilies : [],
    developers: Array.isArray(game?.developers) ? game.developers.slice(0, 3) : [],
    userRating: Number.isFinite(rating) && rating > 0 ? Math.min(10, Math.max(1, Math.round(rating))) : 0,
    hoursPlayed: Number.isFinite(hours) && hours > 0 ? Math.round(hours * 10) / 10 : 0,
    status: String(game?.status || "completed").toLowerCase(),
    platformPlayed: String(game?.platformPlayed || "").trim(),
    userNote: String(game?.userNote || "").trim().slice(0, 1200),
    ...(breakdown ? { ratingBreakdown: breakdown } : {}),
    ...(quickTags.length > 0 ? { quickTags } : {}),
    datePlayed: game?.datePlayed || new Date().toISOString().slice(0, 10),
    updatedAt: game?.updatedAt || new Date().toISOString()
  };
}

/**
 * Computes rich GameVault analytics for the Editorial Gaming DNA Banner (1-10 histogram, top genres,
 * platforms, playtime, completion & platinum rates).
 */
export function computeGameVaultStats(played = [], backlog = []) {
  const list = Array.isArray(played) ? played : [];
  const histogram = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
  const genreCounts = new Map();
  const platformCounts = new Map();
  let ratingSum = 0;
  let ratedCount = 0;
  let totalHours = 0;
  let completedCount = 0;
  let platinumCount = 0;
  let playingCount = 0;

  for (const g of list) {
    const r = Number(g?.userRating ?? 0);
    if (Number.isFinite(r) && r >= 1 && r <= 10) {
      const bucket = Math.round(r);
      histogram[bucket] = (histogram[bucket] || 0) + 1;
      ratingSum += r;
      ratedCount++;
    }
    totalHours += Math.max(0, Number(g?.hoursPlayed ?? 0) || 0);
    const st = String(g?.status || "completed").toLowerCase();
    if (st === "platinum") {
      platinumCount++;
      completedCount++;
    } else if (st === "completed") {
      completedCount++;
    } else if (st === "playing") {
      playingCount++;
    }
    for (const genre of g?.genres || []) {
      const k = String(genre).trim();
      if (k) genreCounts.set(k, (genreCounts.get(k) || 0) + 1);
    }
    const plat = String(g?.platformPlayed || g?.platforms?.[0] || "").trim();
    if (plat) platformCounts.set(plat, (platformCounts.get(plat) || 0) + 1);
  }

  const maxHistCount = Math.max(1, ...Object.values(histogram));
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count, pct: list.length > 0 ? Math.round((count / list.length) * 100) : 0 }));
  const topPlatforms = [...platformCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => ({ name, count }));

  return {
    totalLogged: list.length,
    backlogCount: Array.isArray(backlog) ? backlog.length : 0,
    ratedCount,
    avgRating: ratedCount > 0 ? Math.round((ratingSum / ratedCount) * 10) / 10 : null,
    totalHours: Math.round(totalHours * 10) / 10,
    completedCount,
    platinumCount,
    playingCount,
    completionRate: list.length > 0 ? Math.round((completedCount / list.length) * 100) : 0,
    histogram,
    maxHistCount,
    topGenres,
    topPlatforms
  };
}

/**
 * Computes live percentile & same-tier anchor games for StarRatingStage calibration strip.
 */
export function computeGameVaultCalibration(played = [], targetScore = 0, excludeIgdbId = null) {
  const exclude = Number(excludeIgdbId);
  const rated = (Array.isArray(played) ? played : []).filter((g) => {
    const r = Number(g?.userRating ?? 0);
    return Number.isFinite(r) && r >= 1 && r <= 10 && Number(g?.igdbId) !== exclude;
  });
  const ratedCount = rated.length;
  const score = Number(targetScore);

  if (ratedCount === 0) {
    return { ratedCount: 0, topPercentile: null, summaryText: "", anchorMovies: [] };
  }
  if (!Number.isFinite(score) || score < 1) {
    return {
      ratedCount,
      topPercentile: null,
      summaryText: `Scrub 1–10 to benchmark against your ${ratedCount} rated games`,
      anchorMovies: []
    };
  }

  const strictlyHigher = rated.filter((g) => Number(g.userRating) > score).length;
  const topPercentile = Math.max(1, Math.min(99, Math.round(((strictlyHigher + 1) / (ratedCount + 1)) * 100)));

  const sameTier = rated
    .filter((g) => Math.round(Number(g.userRating)) === Math.round(score))
    .slice(0, 2);
  const anchors = (sameTier.length > 0
    ? sameTier
    : [...rated]
        .sort((a, b) => Math.abs(Number(a.userRating) - score) - Math.abs(Number(b.userRating) - score))
        .slice(0, 2)
  ).map((g) => ({
    imdbID: String(g.igdbId),
    igdbId: g.igdbId,
    title: g.title,
    userRating: g.userRating
  }));

  return {
    ratedCount,
    topPercentile,
    summaryText: `Ranks in the top ${topPercentile}% of your ${ratedCount} rated games`,
    anchorMovies: anchors
  };
}

export async function loadGameVault() {
  const [idbPlayed, idbBacklog] = await Promise.all([
    idbGet(GAME_PLAYED_STORAGE_KEY),
    idbGet(GAME_BACKLOG_STORAGE_KEY)
  ]);
  const played = Array.isArray(idbPlayed) ? idbPlayed : readLocalFallback(GAME_PLAYED_STORAGE_KEY);
  const backlog = Array.isArray(idbBacklog) ? idbBacklog : readLocalFallback(GAME_BACKLOG_STORAGE_KEY);
  return { played, backlog };
}

export async function saveGameVaultSlice(key, list = []) {
  const clean = (Array.isArray(list) ? list : []).map(compactGameRecord).filter(Boolean);
  writeLocalFallback(key, clean);
  await idbSet(key, clean);
  return clean;
}

export function loadGameDeletedTombstones(nowMs = Date.now()) {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(GAME_DELETED_TOMBSTONES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const pruned = {};
    for (const [k, ts] of Object.entries(parsed)) {
      const id = Number(k);
      const ms = Date.parse(String(ts || ""));
      if (Number.isInteger(id) && id > 0 && Number.isFinite(ms) && nowMs - ms <= TOMBSTONE_TTL_MS) {
        pruned[String(id)] = new Date(ms).toISOString();
      }
    }
    return pruned;
  } catch {
    return {};
  }
}

function writeGameDeletedTombstones(map) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(GAME_DELETED_TOMBSTONES_KEY, JSON.stringify(map || {}));
  } catch {
    // ignore storage quota errors
  }
}

export function recordGameDeletedTombstone(igdbId, deletedAt = new Date().toISOString()) {
  const id = Number(igdbId);
  if (!Number.isInteger(id) || id <= 0) return {};
  const map = loadGameDeletedTombstones();
  map[String(id)] = deletedAt;
  writeGameDeletedTombstones(map);
  return map;
}

export function clearGameDeletedTombstone(igdbId) {
  const id = Number(igdbId);
  if (!Number.isInteger(id) || id <= 0) return {};
  const map = loadGameDeletedTombstones();
  if (Object.prototype.hasOwnProperty.call(map, String(id))) {
    delete map[String(id)];
    writeGameDeletedTombstones(map);
  }
  return map;
}

function deleteIndexedDbSafe(name) {
  if (typeof indexedDB === "undefined" || typeof indexedDB.deleteDatabase !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Completely wipes all local GameVault user data (IndexedDB + localStorage) on account sign-out.
 */
export async function clearAllLocalGameVaultData() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(GAME_PLAYED_STORAGE_KEY);
      localStorage.removeItem(GAME_BACKLOG_STORAGE_KEY);
      localStorage.removeItem(GAME_DISMISSED_STORAGE_KEY);
      localStorage.removeItem(GAME_DELETED_TOMBSTONES_KEY);
      localStorage.removeItem(GAME_RIG_STORAGE_KEY_REF);
    }
  } catch {
    // ignore storage errors
  }
  await Promise.all([
    deleteIndexedDbSafe(GAME_VAULT_IDB_NAME),
    deleteIndexedDbSafe(GAME_IGDB_CACHE_IDB_NAME)
  ]);
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("gamevault:local-cleared"));
    }
  } catch {
    // ignore in non-DOM test environments
  }
}

export function buildGameExportPayload({ played = [], backlog = [] } = {}) {
  return {
    schema: "gamevault_backup_v1",
    exportedAt: new Date().toISOString(),
    played: (played || []).map(compactGameRecord).filter(Boolean),
    backlog: (backlog || []).map(compactGameRecord).filter(Boolean)
  };
}

/**
 * Parses GameVault JSON backups, CSV rows (`title,rating,hours,status` or `appid,hours`),
 * OR plain lists of Steam AppIDs (resolved instantaneously via `game_steam_to_igdb.json`!).
 */
export function parseGameImport(rawText = "", { steamMap = null } = {}) {
  const text = String(rawText || "").trim();
  if (!text) return { played: [], backlog: [], resolvedIgdbIds: [], unresolvedSteamIds: [] };

  // 1. JSON Backup or JSON array
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const played = parsed.map(compactGameRecord).filter(Boolean);
        return { played, backlog: [], resolvedIgdbIds: [], unresolvedSteamIds: [] };
      }
      if (parsed && typeof parsed === "object") {
        const played = Array.isArray(parsed.played) ? parsed.played.map(compactGameRecord).filter(Boolean) : [];
        const backlog = Array.isArray(parsed.backlog) ? parsed.backlog.map(compactGameRecord).filter(Boolean) : [];
        return { played, backlog, resolvedIgdbIds: [], unresolvedSteamIds: [] };
      }
    } catch {
      // fall through to Steam AppID / CSV parser
    }
  }

  // 2. Steam AppID list (comma/whitespace/newline separated integers or Steam store URLs)
  const steamTokens = [];
  const urlRe = /store\.steampowered\.com\/app\/(\d+)/gi;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    steamTokens.push(m[1]);
  }
  if (steamTokens.length === 0) {
    const tokens = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length > 0 && tokens.every((t) => /^\d{2,8}$/.test(t))) {
      steamTokens.push(...tokens);
    }
  }

  if (steamTokens.length > 0 && steamMap && typeof steamMap === "object") {
    const resolved = [];
    const seen = new Set();
    const unresolved = [];
    for (const appId of steamTokens) {
      const gid = Number(steamMap[String(appId)]);
      if (Number.isInteger(gid) && gid > 0) {
        if (!seen.has(gid)) {
          seen.add(gid);
          resolved.push(gid);
        }
      } else {
        unresolved.push(appId);
      }
    }
    return { played: [], backlog: [], resolvedIgdbIds: resolved, unresolvedSteamIds: unresolved };
  }

  // 3. CSV with igdbId or steamAppId column
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines[0].includes(",")) {
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idxIgdb = headers.findIndex((h) => h === "igdbid" || h === "igdb_id");
    const idxSteam = headers.findIndex((h) => h === "appid" || h === "app_id" || h === "steam_id" || h === "steamappid");
    const idxRating = headers.findIndex((h) => h === "rating" || h === "userrating" || h === "user_rating");
    const idxHours = headers.findIndex((h) => h === "hours" || h === "hoursplayed" || h === "playtime");
    const idxTitle = headers.findIndex((h) => h === "title" || h === "name");
    const played = [];
    const resolvedIgdbIds = [];
    const unresolvedSteamIds = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      let gid = idxIgdb >= 0 ? Number(cols[idxIgdb]) : 0;
      if ((!Number.isInteger(gid) || gid <= 0) && idxSteam >= 0 && steamMap) {
        const mapped = Number(steamMap[String(cols[idxSteam])]);
        if (Number.isInteger(mapped) && mapped > 0) gid = mapped;
        else if (cols[idxSteam]) unresolvedSteamIds.push(cols[idxSteam]);
      }
      if (Number.isInteger(gid) && gid > 0) {
        const title = idxTitle >= 0 ? cols[idxTitle] : "";
        const userRating = idxRating >= 0 ? Number(cols[idxRating]) || 0 : 0;
        const hoursPlayed = idxHours >= 0 ? Number(cols[idxHours]) || 0 : 0;
        if (title) {
          played.push(compactGameRecord({ igdbId: gid, title, userRating, hoursPlayed, status: "completed" }));
        } else {
          resolvedIgdbIds.push(gid);
        }
      }
    }
    return { played, backlog: [], resolvedIgdbIds, unresolvedSteamIds };
  }

  return { played: [], backlog: [], resolvedIgdbIds: [], unresolvedSteamIds: [] };
}
