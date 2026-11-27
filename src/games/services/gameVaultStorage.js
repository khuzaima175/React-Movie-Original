/**
 * Isolated IndexedDB + localStorage Vault Storage and Import/Export for GameVault.
 * Strictly isolated from CinemaVault's `cinemavault_vault_v1` database.
 */

export const GAME_VAULT_IDB_NAME = "gamevault_vault_v1";
export const GAME_VAULT_IDB_STORE = "kv";
export const GAME_PLAYED_STORAGE_KEY = "gamevault_played_v1";
export const GAME_BACKLOG_STORAGE_KEY = "gamevault_backlog_v1";

export const GAME_STATUS_OPTIONS = Object.freeze([
  { id: "completed", label: "Completed" },
  { id: "playing", label: "Playing" },
  { id: "dropped", label: "Dropped" },
  { id: "played", label: "Played" }
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

export function compactGameRecord(game = {}) {
  const igdbId = Number(game?.igdbId ?? game?.id ?? 0);
  if (!Number.isInteger(igdbId) || igdbId <= 0) return null;
  const rating = Number(game?.userRating ?? 0);
  const hours = Number(game?.hoursPlayed ?? 0);
  return {
    igdbId,
    title: String(game?.title || game?.name || "Untitled Game").trim(),
    year: Number.isFinite(Number(game?.year)) && Number(game?.year) > 0 ? Number(game.year) : null,
    coverUrl: String(game?.coverUrl || "").trim(),
    backdropUrl: String(game?.backdropUrl || "").trim(),
    rating10: Number.isFinite(Number(game?.rating10)) ? Number(game.rating10) : null,
    ratingCount: Number(game?.ratingCount ?? 0) || 0,
    genres: Array.isArray(game?.genres) ? game.genres.slice(0, 6) : [],
    themes: Array.isArray(game?.themes) ? game.themes.slice(0, 6) : [],
    platforms: Array.isArray(game?.platforms) ? game.platforms.slice(0, 6) : [],
    platformFamilies: Array.isArray(game?.platformFamilies) ? game.platformFamilies : [],
    developers: Array.isArray(game?.developers) ? game.developers.slice(0, 3) : [],
    userRating: Number.isFinite(rating) && rating > 0 ? Math.min(10, Math.max(1, Math.round(rating))) : 0,
    hoursPlayed: Number.isFinite(hours) && hours > 0 ? Math.round(hours * 10) / 10 : 0,
    status: String(game?.status || "completed").toLowerCase(),
    platformPlayed: String(game?.platformPlayed || "").trim(),
    userNote: String(game?.userNote || "").trim().slice(0, 1200),
    datePlayed: game?.datePlayed || new Date().toISOString().slice(0, 10),
    updatedAt: game?.updatedAt || new Date().toISOString()
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
