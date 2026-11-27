/**
 * Supabase Cloud Sync helpers for `public.user_games` (isolated from `public.user_vault_items`).
 * Gracefully no-ops in guest mode or when Supabase is unconfigured.
 */

import { compactGameRecord } from "./gameVaultStorage.js";

export function mapLocalGameToDbRow(userId, game = {}, bucket = "played") {
  const clean = compactGameRecord(game);
  if (!clean || !userId) return null;
  const status = bucket === "backlog"
    ? "backlog"
    : (["completed", "playing", "dropped", "played"].includes(clean.status) ? clean.status : "completed");

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
      developers: clean.developers
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
    status: row.status || "completed",
    platformPlayed: row.platform_played || "",
    userNote: row.user_note || "",
    datePlayed: row.date_played || "",
    updatedAt: row.updated_at || new Date().toISOString()
  });
}

export function mergeGameListsByUpdatedAt(localList = [], cloudList = []) {
  const map = new Map();
  const upsert = (item) => {
    const clean = compactGameRecord(item);
    if (!clean) return;
    const prev = map.get(clean.igdbId);
    if (!prev) {
      map.set(clean.igdbId, clean);
      return;
    }
    const prevTs = Date.parse(prev.updatedAt || "") || 0;
    const nextTs = Date.parse(clean.updatedAt || "") || 0;
    if (nextTs >= prevTs) {
      map.set(clean.igdbId, { ...prev, ...clean });
    }
  };
  for (const g of Array.isArray(localList) ? localList : []) upsert(g);
  for (const g of Array.isArray(cloudList) ? cloudList : []) upsert(g);
  return [...map.values()].sort((a, b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0));
}

export async function pullAndSyncGameVault(supabase, userId, { played = [], backlog = [] } = {}) {
  if (!supabase || !userId) return { status: "skipped", played, backlog };
  try {
    const { data, error } = await supabase
      .from("user_games")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      return { status: "error", error: error.message, played, backlog };
    }

    const cloudPlayed = [];
    const cloudBacklog = [];
    for (const row of Array.isArray(data) ? data : []) {
      const g = mapDbRowToLocalGame(row);
      if (!g) continue;
      if (row.status === "backlog") cloudBacklog.push(g);
      else cloudPlayed.push(g);
    }

    const mergedPlayed = mergeGameListsByUpdatedAt(played, cloudPlayed);
    const playedIds = new Set(mergedPlayed.map((g) => g.igdbId));
    const mergedBacklog = mergeGameListsByUpdatedAt(backlog, cloudBacklog).filter((g) => !playedIds.has(g.igdbId));

    const toUpsert = [
      ...mergedPlayed.map((g) => mapLocalGameToDbRow(userId, g, "played")),
      ...mergedBacklog.map((g) => mapLocalGameToDbRow(userId, g, "backlog"))
    ].filter(Boolean);

    if (toUpsert.length > 0) {
      await supabase.from("user_games").upsert(toUpsert, { onConflict: "user_id,igdb_id" });
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
