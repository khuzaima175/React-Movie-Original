import { createClient } from "@supabase/supabase-js";
import { diffWatchlistProviders, verifyCronAuthorization } from "./_alertHelpers.js";

function getServiceSupabase() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function fetchTmdbProvidersForMovie(tmdbId, region, apiKey) {
  const res = await fetch(
    `https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${encodeURIComponent(apiKey)}`,
    { cache: "no-store" }
  );
  if (res.status === 429) {
    return { rateLimited: true, providers: [], link: null };
  }
  if (!res.ok) {
    return { rateLimited: false, providers: [], link: null };
  }
  const data = await res.json();
  const rCode = region && region !== "GLOBAL" ? region : "US";
  const regionObj = data?.results?.[rCode] || data?.results?.US || null;
  const flatrate = Array.isArray(regionObj?.flatrate) ? regionObj.flatrate : [];
  const free = Array.isArray(regionObj?.free) ? regionObj.free : [];
  const providers = [...flatrate, ...free].map((p) => ({
    id: Number(p.provider_id),
    name: p.provider_name || "Streaming"
  }));
  return {
    rateLimited: false,
    providers,
    link: typeof regionObj?.link === "string" ? regionObj.link : null
  };
}

export default async function handler(req, res) {
  if (!verifyCronAuthorization(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const tmdbKey = String(process.env.TMDB_API_KEY || process.env.VITE_TMDB_KEY || "").trim();
  const supabase = getServiceSupabase();
  if (!tmdbKey || !supabase) {
    return res.status(200).json({ ok: true, skipped: true, reason: "Missing TMDB or Supabase service credentials" });
  }

  try {
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, user_region, preferred_providers")
      .not("preferred_providers", "eq", "{}");

    if (profErr) throw profErr;
    const activeProfiles = (profiles || []).filter(
      (p) => Array.isArray(p.preferred_providers) && p.preferred_providers.length > 0
    );
    if (activeProfiles.length === 0) {
      return res.status(200).json({ ok: true, checkedMovies: 0, alertsInserted: 0 });
    }

    const userIds = activeProfiles.map((p) => p.id);
    const profileById = new Map(activeProfiles.map((p) => [p.id, p]));

    const { data: watchlistRows, error: wlErr } = await supabase
      .from("user_vault_items")
      .select("user_id, tmdb_id, title, poster")
      .eq("status", "watchlist")
      .in("user_id", userIds)
      .not("tmdb_id", "is", null);

    if (wlErr) throw wlErr;
    const validWl = (watchlistRows || []).filter((r) => Number(r.tmdb_id) > 0);
    if (validWl.length === 0) {
      return res.status(200).json({ ok: true, checkedMovies: 0, alertsInserted: 0 });
    }

    const { data: existingSnapshots } = await supabase
      .from("watchlist_provider_snapshots")
      .select("user_id, tmdb_id, region, provider_ids")
      .in("user_id", userIds);

    const snapshotMap = new Map();
    for (const s of existingSnapshots || []) {
      snapshotMap.set(`${s.user_id}::${s.tmdb_id}::${s.region}`, s.provider_ids || []);
    }

    // Batch-deduplicate TMDB watch/providers calls by (tmdb_id, region)
    const uniqueLookups = new Map();
    for (const row of validWl) {
      const prof = profileById.get(row.user_id);
      const region = prof?.user_region && prof.user_region !== "GLOBAL" ? prof.user_region : "US";
      const k = `${row.tmdb_id}::${region}`;
      if (!uniqueLookups.has(k)) {
        uniqueLookups.set(k, { tmdbId: row.tmdb_id, region });
      }
    }

    const lookupEntries = [...uniqueLookups.entries()];
    const tmdbResults = new Map();
    const CONCURRENCY = 5;
    let cursor = 0;
    let hitRateLimit = false;

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, lookupEntries.length) }, async () => {
        while (cursor < lookupEntries.length && !hitRateLimit) {
          const [key, target] = lookupEntries[cursor++];
          const resData = await fetchTmdbProvidersForMovie(target.tmdbId, target.region, tmdbKey);
          if (resData.rateLimited) {
            hitRateLimit = true;
            break;
          }
          tmdbResults.set(key, resData);
        }
      })
    );

    const snapshotsToUpsert = [];
    const notificationsToInsert = [];
    const nowIso = new Date().toISOString();

    for (const row of validWl) {
      const prof = profileById.get(row.user_id);
      const region = prof?.user_region && prof.user_region !== "GLOBAL" ? prof.user_region : "US";
      const lookup = tmdbResults.get(`${row.tmdb_id}::${region}`);
      if (!lookup) continue;

      const currentIds = lookup.providers.map((p) => p.id);
      const snapKey = `${row.user_id}::${row.tmdb_id}::${region}`;
      const previousIds = snapshotMap.has(snapKey) ? snapshotMap.get(snapKey) : null;

      const diff = diffWatchlistProviders({
        previousProviderIds: previousIds,
        currentProviderIds: currentIds,
        userPreferredProviderIds: prof.preferred_providers
      });

      snapshotsToUpsert.push({
        user_id: row.user_id,
        tmdb_id: row.tmdb_id,
        region,
        provider_ids: currentIds,
        checked_at: nowIso
      });

      if (!diff.isBaseline && diff.newlyAvailableIds.length > 0) {
        const providerNameMap = new Map(lookup.providers.map((p) => [p.id, p.name]));
        for (const pid of diff.newlyAvailableIds) {
          notificationsToInsert.push({
            user_id: row.user_id,
            type: "watchlist_available",
            tmdb_id: row.tmdb_id,
            title: row.title || "Watchlisted Film",
            poster: row.poster || null,
            provider_id: pid,
            provider_name: providerNameMap.get(pid) || "Streaming",
            watch_link: lookup.link || null
          });
        }
      }
    }

    if (snapshotsToUpsert.length > 0) {
      await supabase
        .from("watchlist_provider_snapshots")
        .upsert(snapshotsToUpsert, { onConflict: "user_id,tmdb_id,region" });
    }

    if (notificationsToInsert.length > 0) {
      await supabase
        .from("user_notifications")
        .upsert(notificationsToInsert, {
          onConflict: "user_id,type,tmdb_id,provider_id",
          ignoreDuplicates: true
        });
    }

    return res.status(200).json({
      ok: true,
      checkedMovies: tmdbResults.size,
      alertsInserted: notificationsToInsert.length,
      rateLimited: hitRateLimit
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Cron watchlist alerts failed" });
  }
}
