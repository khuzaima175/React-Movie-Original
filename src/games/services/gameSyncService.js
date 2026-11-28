/**
 * Supabase Cloud Sync helpers for `public.user_games` (isolated from `public.user_vault_items`).
 * Features keyset pagination (>1,000 rows safe), strict page-error abort (never merges truncated cloud pages),
 * delete tombstones (prevents deleted games from resurrecting), and chunked upserts.
 */

import { compactGameRecord } from "./gameVaultStorage.js";

const CLOUD_PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 250;

export function mapLocalGameToDbRow(userId, game = {}, bucket = "played") {
  const clean = compactGameRecord(game);
  if (!clean || !userId) return null;
  const isPlatinum = clean.status === "platinum";
  const status = bucket === "backlog"
    ? "backlog"
    : (isPlatinum
        ? "completed"
        : (["completed", "playing", "dropped", "played"].includes(clean.status) ? clean.status : "completed"));

  return {
    user_id: userId,
    igdb_id: clean.igdbId,
    status,
    title: clean.title,
    year: clean.year,
    cover_url: clean.coverUrl || null,
    user_rating: clean.userRating > 0 ? clean.userRating : null,
    hours_played: clean.hoursPlayed > 0 ? clean.hoursPlayed : 0,
    platform_played: clean.platformPlayed || null,
    user_note: clean.userNote || null,
    date_played: clean.datePlayed || null,
    metadata: {
      backdropUrl: clean.backdropUrl || "",
      rating10: clean.rating10,
      ratingCount: clean.ratingCount,
      genres: clean.genres,
      themes: clean.themes,
      platforms: clean.platforms,
      platformFamilies: clean.platformFamilies,
      developers: clean.developers,
      ...(isPlatinum ? { subStatus: "platinum" } : {}),
      ...(clean.ratingBreakdown ? { ratingBreakdown: clean.ratingBreakdown } : {}),
      ...(clean.quickTags?.length ? { quickTags: clean.quickTags } : {})
    },
    updated_at: clean.updatedAt || new Date().toISOString()
  };
}

export function mapDbRowToLocalGame(row = {}) {
  const igdbId = Number(row?.igdb_id ?? 0);
  if (!Number.isInteger(igdbId) || igdbId <= 0) return null;
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return compactGameRecord({
    igdbId,
    title: row.title || "Untitled Game",
    year: row.year ?? null,
    coverUrl: row.cover_url || "",
    backdropUrl: meta.backdropUrl || "",
    rating10: meta.rating10 ?? null,
    ratingCount: meta.ratingCount ?? 0,
    genres: Array.isArray(meta.genres) ? meta.genres : [],
    themes: Array.isArray(meta.themes) ? meta.themes : [],
    platforms: Array.isArray(meta.platforms) ? meta.platforms : [],
    platformFamilies: Array.isArray(meta.platformFamilies) ? meta.platformFamilies : [],
    developers: Array.isArray(meta.developers) ? meta.developers : [],
    userRating: Number(row.user_rating ?? 0) || 0,
    hoursPlayed: Number(row.hours_played ?? 0) || 0,
    status: meta.subStatus === "platinum" ? "platinum" : (row.status || "completed"),
    platformPlayed: row.platform_played || "",
    userNote: row.user_note || "",
    ...(meta.ratingBreakdown ? { ratingBreakdown: meta.ratingBreakdown } : {}),
    ...(Array.isArray(meta.quickTags) ? { quickTags: meta.quickTags } : {}),
    datePlayed: row.date_played || "",
    updatedAt: row.updated_at || new Date().toISOString()
  });
}

function getTombstoneMs(deletedTombstones, igdbId) {
  if (!deletedTombstones || typeof deletedTombstones !== "object") return 0;
  const raw = deletedTombstones[String(igdbId)];
  if (!raw) return 0;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : 0;
}

export function mergeGameListsByUpdatedAt(localList = [], cloudList = [], { deletedTombstones = null } = {}) {
  const map = new Map();
  const upsert = (item) => {
    const clean = compactGameRecord(item);
    if (!clean) return;
    const itemTs = Date.parse(clean.updatedAt || "") || 0;
    const tombTs = getTombstoneMs(deletedTombstones, clean.igdbId);
    if (tombTs > 0 && tombTs >= itemTs) {
      return;
    }
    const prev = map.get(clean.igdbId);
    if (!prev) {
      map.set(clean.igdbId, clean);
      return;
    }
    const prevTs = Date.parse(prev.updatedAt || "") || 0;
    if (itemTs >= prevTs) {
      map.set(clean.igdbId, { ...prev, ...clean });
    }
  };
  for (const g of Array.isArray(localList) ? localList : []) upsert(g);
  for (const g of Array.isArray(cloudList) ? cloudList : []) upsert(g);
  return [...map.values()].sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0));
}

/**
 * Fetches ALL rows for `userId` from `public.user_games` using keyset pagination on primary key `id`.
 * Aborts immediately on ANY page error so sync never merges a truncated dataset.
 */
export async function fetchAllCloudGames(supabase, userId, pageSize = CLOUD_PAGE_SIZE) {
  const allRows = [];
  let lastId = 0;
  const maxPages = 50; // hard safety cap = 50,000 games

  for (let page = 0; page < maxPages; page++) {
    let query = supabase
      .from("user_games")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: true });
    if (typeof query.gt === "function") {
      query = query.gt("id", lastId);
    }
    if (typeof query.limit === "function") {
      query = query.limit(pageSize);
    }

    const { data, error } = await query;
    if (error) {
      return { ok: false, error: error.message || "Cloud page fetch failed", rows: [] };
    }
    const batch = Array.isArray(data) ? data : [];
    if (batch.length === 0) break;
    allRows.push(...batch);
    if (batch.length < pageSize) break;

    let maxRowId = lastId;
    for (const row of batch) {
      const rid = Number(row?.id);
      if (Number.isInteger(rid) && rid > maxRowId) maxRowId = rid;
    }
    if (maxRowId <= lastId) break;
    lastId = maxRowId;
  }

  return { ok: true, error: null, rows: allRows };
}

export async function pullAndSyncGameVault(
  supabase,
  userId,
  { played = [], backlog = [], deletedTombstones = null } = {}
) {
  if (!supabase || !userId) return { status: "skipped", played, backlog };
  try {
    const fetched = await fetchAllCloudGames(supabase, userId, CLOUD_PAGE_SIZE);
    if (!fetched.ok) {
      // Strictly abort without merging or pushing when ANY page fails
      return { status: "error", error: fetched.error, played, backlog };
    }

    const cloudPlayed = [];
    const cloudBacklog = [];
    const cloudIdsToDelete = [];

    for (const row of fetched.rows) {
      const g = mapDbRowToLocalGame(row);
      if (!g) continue;
      const rowTs = Date.parse(g.updatedAt || "") || 0;
      const tombTs = getTombstoneMs(deletedTombstones, g.igdbId);
      if (tombTs > 0 && tombTs >= rowTs) {
        cloudIdsToDelete.push(g.igdbId);
        continue;
      }
      if (row.status === "backlog") cloudBacklog.push(g);
      else cloudPlayed.push(g);
    }

    // Propagate local deletes to cloud so removed games stay deleted across devices
    if (cloudIdsToDelete.length > 0) {
      for (const delId of cloudIdsToDelete) {
        await deleteCloudGame(supabase, userId, delId);
      }
    }

    const mergedPlayed = mergeGameListsByUpdatedAt(played, cloudPlayed, { deletedTombstones });
    const playedIds = new Set(mergedPlayed.map((g) => g.igdbId));
    const mergedBacklog = mergeGameListsByUpdatedAt(backlog, cloudBacklog, { deletedTombstones }).filter(
      (g) => !playedIds.has(g.igdbId)
    );

    const toUpsert = [
      ...mergedPlayed.map((g) => mapLocalGameToDbRow(userId, g, "played")),
      ...mergedBacklog.map((g) => mapLocalGameToDbRow(userId, g, "backlog"))
    ].filter(Boolean);

    for (let i = 0; i < toUpsert.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = toUpsert.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error: upsertErr } = await supabase
        .from("user_games")
        .upsert(chunk, { onConflict: "user_id,igdb_id" });
      if (upsertErr) {
        return { status: "error", error: upsertErr.message || "Cloud upsert failed", played, backlog };
      }
    }

    return { status: "synced", played: mergedPlayed, backlog: mergedBacklog };
  } catch (err) {
    return { status: "error", error: String(err?.message || "Sync failed"), played, backlog };
  }
}

export async function upsertCloudGame(supabase, userId, game, bucket = "played") {
  if (!supabase || !userId) return;
  const row = mapLocalGameToDbRow(userId, game, bucket);
  if (!row) return;
  try {
    await supabase.from("user_games").upsert([row], { onConflict: "user_id,igdb_id" });
  } catch {
    // non-fatal background cloud sync
  }
}

export async function deleteCloudGame(supabase, userId, igdbId) {
  if (!supabase || !userId || !igdbId) return;
  try {
    await supabase.from("user_games").delete().eq("user_id", userId).eq("igdb_id", Number(igdbId));
  } catch {
    // non-fatal background cloud sync
  }
}
