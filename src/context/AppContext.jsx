import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { normalizeFeedbackEvent, recordRatedMovieConversion } from "../services/feedbackService.js";
import { getSupabaseClient, hasSupabaseConfig } from "../services/supabaseClient.js";
import {
  getCanonicalMovieKey,
  mapLocalMovieToDbRow,
  mergeLocalAndCloudVault
} from "../services/vaultSyncService.js";

const AppContext = createContext(null);

/**
 * Safe LocalStorage setter with tiered LRU eviction policy.
 * Evicts derivative AI caches first to protect primary user movie data.
 */
export const safeSetItem = (key, value) => {
  const serialized = JSON.stringify(value);
  try {
    localStorage.setItem(key, serialized);
    return true;
  } catch (e) {
    if (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014) {
      console.warn("⚠️ LocalStorage quota exceeded. Purging non-critical AI caches to protect user vault...");
      
      const purgeOrder = [
        "cinemavault_smart_cache_v3",
        "cinemavault_explanations_v1",
        "cinemavault_recs_model_v1",
        "cinemavault_recs_v1",
        "cinemavault_recs_hash_v1",
        "cinemavault_feedback_v1"
      ];

      for (const purgeKey of purgeOrder) {
        if (purgeKey !== key) {
          localStorage.removeItem(purgeKey);
          try {
            localStorage.setItem(key, serialized);
            console.log(`✅ Recovered storage by purging ${purgeKey}`);
            return true;
          } catch (_) {
            // Continue to next eviction candidate
          }
        }
      }

      console.error("❌ Critical: Storage completely full even after derivative cache eviction.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("storage-critical-error", {
            detail: "Your browser storage is nearly full. Please export a JSON backup from My Vault > Portability."
          })
        );
      }
      return false;
    }
    console.error(`Storage error saving ${key}:`, e);
    return false;
  }
};

export function AppProvider({ children }) {
  const [watched, setWatched] = useState(() => {
    try {
      const saved = localStorage.getItem("watchedMovies");
      return saved && saved !== "undefined" ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Error parsing watchedMovies from localStorage:", e);
      return [];
    }
  });

  const [watchlist, setWatchlist] = useState(() => {
    try {
      const saved = localStorage.getItem("watchlist");
      return saved && saved !== "undefined" ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Error parsing watchlist from localStorage:", e);
      return [];
    }
  });

  const [userRegion, setUserRegion] = useState(() => {
    try {
      return localStorage.getItem("cinemavault_user_region") || "GLOBAL";
    } catch {
      return "GLOBAL";
    }
  });

  const [userWatchProviders, setUserWatchProviders] = useState(() => {
    try {
      const saved = localStorage.getItem("cinemavault_user_providers");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [aiRecommendations, setAiRecommendations] = useState(() => {
    try {
      const saved = localStorage.getItem("cinemavault_recs_v1");
      return saved && saved !== "undefined" ? JSON.parse(saved) : null;
    } catch (e) {
      console.warn("Error parsing cinemavault_recs_v1 from localStorage:", e);
      return null;
    }
  });

  const [aiTasteProfile, setAiTasteProfile] = useState(() => {
    try {
      const saved = localStorage.getItem("cinemavault_taste_v1");
      return saved && saved !== "undefined" ? JSON.parse(saved) : null;
    } catch (e) {
      console.warn("Error parsing cinemavault_taste_v1 from localStorage:", e);
      return null;
    }
  });

  const [aiRecommendationsHash, setAiRecommendationsHash] = useState(() => {
    try {
      return localStorage.getItem("cinemavault_recs_hash_v1") || "";
    } catch (e) {
      return "";
    }
  });

  const [aiModelInfo, setAiModelInfo] = useState(() => {
    try {
      const saved = localStorage.getItem("cinemavault_recs_model_v1");
      return saved && saved !== "undefined" ? JSON.parse(saved) : null;
    } catch (e) {
      console.warn("Error parsing cinemavault_recs_model_v1 from localStorage:", e);
      return null;
    }
  });

  const [aiFeedbackLog, setAiFeedbackLog] = useState(() => {
    try {
      const saved = localStorage.getItem("cinemavault_feedback_v1");
      return saved && saved !== "undefined" ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Error parsing cinemavault_feedback_v1 from localStorage:", e);
      return [];
    }
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState("");

  const [hasCloudConfig] = useState(() => hasSupabaseConfig());
  const [cloudUser, setCloudUser] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [cloudError, setCloudError] = useState(null);

  const watchedRef = useRef(watched);
  const watchlistRef = useRef(watchlist);
  const userRegionRef = useRef(userRegion);
  const userWatchProvidersRef = useRef(userWatchProviders);
  const cloudUserRef = useRef(null);
  const pendingUpsertsRef = useRef(new Map());
  const pendingDeletesRef = useRef(new Set());
  const syncTimerRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const lastAutoSyncedUserIdRef = useRef(null);

  useEffect(() => {
    watchedRef.current = watched || [];
    safeSetItem("watchedMovies", watched || []);
  }, [watched]);

  useEffect(() => {
    watchlistRef.current = watchlist || [];
    safeSetItem("watchlist", watchlist || []);
  }, [watchlist]);

  useEffect(() => {
    userRegionRef.current = userRegion || "GLOBAL";
    try {
      localStorage.setItem("cinemavault_user_region", userRegion);
    } catch (_) {}
  }, [userRegion]);

  useEffect(() => {
    userWatchProvidersRef.current = Array.isArray(userWatchProviders) ? userWatchProviders : [];
    safeSetItem("cinemavault_user_providers", userWatchProviders || []);
  }, [userWatchProviders]);

  useEffect(() => {
    if (aiRecommendations) {
      safeSetItem("cinemavault_recs_v1", aiRecommendations);
    } else {
      localStorage.removeItem("cinemavault_recs_v1");
    }
  }, [aiRecommendations]);

  useEffect(() => {
    if (aiTasteProfile) {
      safeSetItem("cinemavault_taste_v1", aiTasteProfile);
    } else {
      localStorage.removeItem("cinemavault_taste_v1");
    }
  }, [aiTasteProfile]);

  useEffect(() => {
    if (aiRecommendationsHash) {
      safeSetItem("cinemavault_recs_hash_v1", aiRecommendationsHash);
    } else {
      localStorage.removeItem("cinemavault_recs_hash_v1");
    }
  }, [aiRecommendationsHash]);

  useEffect(() => {
    if (aiModelInfo) {
      safeSetItem("cinemavault_recs_model_v1", aiModelInfo);
    } else {
      localStorage.removeItem("cinemavault_recs_model_v1");
    }
  }, [aiModelInfo]);

  useEffect(() => {
    safeSetItem("cinemavault_feedback_v1", aiFeedbackLog || []);
  }, [aiFeedbackLog]);

  function saveAiRecommendations(recs, profile, hash, modelInfo = undefined) {
    setAiRecommendations(recs);
    setAiTasteProfile(profile);
    setAiRecommendationsHash(hash || "");
    if (modelInfo !== undefined) {
      setAiModelInfo(modelInfo);
    } else if (!recs) {
      setAiModelInfo(null);
    }
  }

  function addAiFeedback(feedbackItem) {
    if (!feedbackItem || !feedbackItem.title) return;
    setAiFeedbackLog((prev) => normalizeFeedbackEvent(feedbackItem, prev, 500));
  }

  const flushCloudMutations = useCallback(async () => {
    const supabase = getSupabaseClient();
    const activeUser = cloudUserRef.current;
    if (!supabase || !activeUser?.id) return;

    const upsertEntries = Array.from(pendingUpsertsRef.current.entries());
    const deleteKeys = Array.from(pendingDeletesRef.current.values());
    if (upsertEntries.length === 0 && deleteKeys.length === 0) return;

    pendingUpsertsRef.current.clear();
    pendingDeletesRef.current.clear();

    setCloudSyncStatus("syncing");
    setCloudError(null);

    try {
      const nowIso = new Date().toISOString();
      if (upsertEntries.length > 0) {
        const rows = upsertEntries.map(([, entry]) =>
          mapLocalMovieToDbRow(
            entry.movie,
            entry.status,
            activeUser.id,
            entry.movie?.updatedAt || nowIso
          )
        );
        for (let i = 0; i < rows.length; i += 100) {
          const chunk = rows.slice(i, i + 100);
          const { error } = await supabase
            .from("user_vault_items")
            .upsert(chunk, { onConflict: "user_id,movie_key" });
          if (error) throw error;
        }
      }

      if (deleteKeys.length > 0) {
        const { error } = await supabase
          .from("user_vault_items")
          .delete()
          .eq("user_id", activeUser.id)
          .in("movie_key", deleteKeys);
        if (error) throw error;
      }

      setCloudSyncStatus("synced");
      setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      for (const [key, entry] of upsertEntries) {
        if (!pendingUpsertsRef.current.has(key) && !pendingDeletesRef.current.has(key)) {
          pendingUpsertsRef.current.set(key, entry);
        }
      }
      for (const key of deleteKeys) {
        if (!pendingUpsertsRef.current.has(key)) {
          pendingDeletesRef.current.add(key);
        }
      }
      setCloudSyncStatus("error");
      setCloudError(err?.message || "Failed to sync changes to cloud.");
    }
  }, []);

  const scheduleCloudFlush = useCallback(() => {
    if (!cloudUserRef.current?.id || !hasCloudConfig) return;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      flushCloudMutations();
    }, 700);
  }, [flushCloudMutations, hasCloudConfig]);

  const syncVaultWithCloud = useCallback(async (targetUser) => {
    const userObj = targetUser || cloudUserRef.current;
    const supabase = getSupabaseClient();
    if (!supabase || !userObj?.id || syncInFlightRef.current) {
      return { ok: false };
    }

    syncInFlightRef.current = true;
    setCloudSyncStatus("syncing");
    setCloudError(null);

    try {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      await flushCloudMutations();
      setCloudSyncStatus("syncing");

      await supabase
        .from("profiles")
        .upsert(
          {
            id: userObj.id,
            user_region: userRegionRef.current || "GLOBAL",
            preferred_providers: Array.isArray(userWatchProvidersRef.current)
              ? userWatchProvidersRef.current
              : []
          },
          { onConflict: "id", ignoreDuplicates: true }
        );

      const { data: cloudRows, error: fetchError } = await supabase
        .from("user_vault_items")
        .select("*")
        .eq("user_id", userObj.id)
        .order("updated_at", { ascending: false });

      if (fetchError) throw fetchError;

      const nowIso = new Date().toISOString();
      const { mergedWatched, mergedWatchlist, toUpsertCloud } = mergeLocalAndCloudVault({
        localWatched: watchedRef.current || [],
        localWatchlist: watchlistRef.current || [],
        cloudRows: cloudRows || [],
        userId: userObj.id,
        nowIso
      });

      watchedRef.current = mergedWatched;
      watchlistRef.current = mergedWatchlist;
      setWatched(mergedWatched);
      setWatchlist(mergedWatchlist);

      for (let i = 0; i < toUpsertCloud.length; i += 100) {
        const chunk = toUpsertCloud.slice(i, i + 100);
        const { error: upsertError } = await supabase
          .from("user_vault_items")
          .upsert(chunk, { onConflict: "user_id,movie_key" });
        if (upsertError) throw upsertError;
      }

      const syncedTimestamp = new Date().toISOString();
      lastAutoSyncedUserIdRef.current = userObj.id;
      setCloudSyncStatus("synced");
      setLastSyncedAt(syncedTimestamp);
      return { ok: true };
    } catch (err) {
      setCloudSyncStatus("error");
      setCloudError(err?.message || "Failed to sync vault with cloud.");
      return { ok: false, error: err?.message };
    } finally {
      syncInFlightRef.current = false;
    }
  }, [flushCloudMutations]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    let cancelled = false;

    async function resolveInitialAuth() {
      try {
        let normalizedUser = null;
        if (typeof supabase.auth.getClaims === "function") {
          const { data } = await supabase.auth.getClaims();
          if (data?.claims?.sub) {
            normalizedUser = {
              id: data.claims.sub,
              email: data.claims.email || null
            };
          }
        }
        if (!normalizedUser && typeof supabase.auth.getUser === "function") {
          const { data } = await supabase.auth.getUser();
          if (data?.user?.id) {
            normalizedUser = {
              id: data.user.id,
              email: data.user.email || null
            };
          }
        }
        if (cancelled) return;
        if (normalizedUser) {
          cloudUserRef.current = normalizedUser;
          setCloudUser(normalizedUser);
          if (lastAutoSyncedUserIdRef.current !== normalizedUser.id) {
            syncVaultWithCloud(normalizedUser);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("Supabase initial session check failed:", err);
        }
      }
    }

    resolveInitialAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (!session?.user?.id) {
        if (syncTimerRef.current) {
          clearTimeout(syncTimerRef.current);
          syncTimerRef.current = null;
        }
        pendingUpsertsRef.current.clear();
        pendingDeletesRef.current.clear();
        lastAutoSyncedUserIdRef.current = null;
        cloudUserRef.current = null;
        setCloudUser(null);
        setCloudSyncStatus("idle");
        setCloudError(null);
        setLastSyncedAt(null);
        return;
      }

      const nextUser = {
        id: session.user.id,
        email: session.user.email || null
      };
      cloudUserRef.current = nextUser;
      setCloudUser(nextUser);

      if (
        (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") &&
        lastAutoSyncedUserIdRef.current !== nextUser.id
      ) {
        syncVaultWithCloud(nextUser);
      }
    });

    return () => {
      cancelled = true;
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      authListener?.subscription?.unsubscribe?.();
    };
  }, [syncVaultWithCloud]);

  async function signInWithEmailOtp(email) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return { ok: false, error: "Supabase cloud sync is not configured." };
    }
    const trimmedEmail = String(email || "").trim();
    if (!trimmedEmail) {
      return { ok: false, error: "Email address is required." };
    }
    setCloudError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined
      }
    });
    if (error) {
      setCloudError(error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, error: null };
  }

  async function signOutCloud() {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    pendingUpsertsRef.current.clear();
    pendingDeletesRef.current.clear();
    lastAutoSyncedUserIdRef.current = null;

    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    cloudUserRef.current = null;
    setCloudUser(null);
    setCloudSyncStatus("idle");
    setCloudError(null);
    setLastSyncedAt(null);
  }

  async function syncCloudNow() {
    return syncVaultWithCloud(cloudUserRef.current);
  }

  async function applyVaultImportSnapshot({
    mergedWatched = [],
    mergedWatchlist = [],
    replaceMode = false
  } = {}) {
    const nowIso = new Date().toISOString();
    const prevWatchedByKey = new Map(
      (watchedRef.current || []).map((m) => [getCanonicalMovieKey(m), m])
    );
    const prevWatchlistByKey = new Map(
      (watchlistRef.current || []).map((m) => [getCanonicalMovieKey(m), m])
    );

    const stampedWatched = (mergedWatched || []).map((item) => {
      const key = getCanonicalMovieKey(item);
      const prev = key ? prevWatchedByKey.get(key) : null;
      const changed =
        replaceMode ||
        !prev ||
        Number(prev.userRating || 0) !== Number(item.userRating || 0) ||
        String(prev.userNote || "") !== String(item.userNote || "");
      return changed ? { ...item, updatedAt: nowIso } : item;
    });

    const stampedWatchlist = (mergedWatchlist || []).map((item) => {
      const key = getCanonicalMovieKey(item);
      const prev = key ? prevWatchlistByKey.get(key) : null;
      const changed = replaceMode || !prev;
      return changed ? { ...item, updatedAt: nowIso } : item;
    });

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    pendingUpsertsRef.current.clear();
    pendingDeletesRef.current.clear();

    watchedRef.current = stampedWatched;
    watchlistRef.current = stampedWatchlist;
    setWatched(stampedWatched);
    setWatchlist(stampedWatchlist);

    const activeUser = cloudUserRef.current;
    const supabase = getSupabaseClient();
    if (!supabase || !activeUser?.id) return;

    setCloudSyncStatus("syncing");
    setCloudError(null);
    try {
      const rows = [
        ...stampedWatched.map((m) =>
          mapLocalMovieToDbRow(m, "watched", activeUser.id, m.updatedAt || nowIso)
        ),
        ...stampedWatchlist.map((m) =>
          mapLocalMovieToDbRow(m, "watchlist", activeUser.id, m.updatedAt || nowIso)
        )
      ].filter((r) => r.movie_key);

      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error: upsertErr } = await supabase
          .from("user_vault_items")
          .upsert(chunk, { onConflict: "user_id,movie_key" });
        if (upsertErr) throw upsertErr;
      }

      if (replaceMode) {
        const keepKeys = new Set(rows.map((r) => r.movie_key));
        const { data: existingRows, error: fetchErr } = await supabase
          .from("user_vault_items")
          .select("movie_key")
          .eq("user_id", activeUser.id);
        if (fetchErr) throw fetchErr;
        const staleKeys = (existingRows || [])
          .map((r) => r.movie_key)
          .filter((k) => k && !keepKeys.has(k));
        for (let i = 0; i < staleKeys.length; i += 100) {
          const chunk = staleKeys.slice(i, i + 100);
          const { error: delErr } = await supabase
            .from("user_vault_items")
            .delete()
            .eq("user_id", activeUser.id)
            .in("movie_key", chunk);
          if (delErr) throw delErr;
        }
        setCloudSyncStatus("synced");
        setLastSyncedAt(new Date().toISOString());
      } else {
        await syncVaultWithCloud(activeUser);
      }
    } catch (err) {
      setCloudSyncStatus("error");
      setCloudError(err?.message || "Failed to sync imported vault to cloud.");
    }
  }

  function addWatched(movie) {
    if (!movie) return;
    const movieId = movie.imdbID || movie.id || movie.tmdbId;
    if (!movieId) return;
    const updatedAt = movie.updatedAt || new Date().toISOString();
    const normalizedMovie = { ...movie, imdbID: movie.imdbID || movieId, updatedAt };
    const existingWatched = (watchedRef.current || []).find(
      (m) => (m.imdbID || m.id || m.tmdbId) === movieId
    );
    const mergedEntry = existingWatched ? { ...existingWatched, ...normalizedMovie } : normalizedMovie;

    setWatched((prev) => {
      const exists = (prev || []).some((m) => (m.imdbID || m.id || m.tmdbId) === movieId);
      if (exists) {
        return (prev || []).map((m) => ((m.imdbID || m.id || m.tmdbId) === movieId ? { ...m, ...normalizedMovie } : m));
      }
      return [...(prev || []), normalizedMovie];
    });
    setWatchlist((prev) => (prev || []).filter((m) => (m.imdbID || m.id || m.tmdbId) !== movieId));
    if (Number(movie.userRating) > 0) {
      setAiFeedbackLog((prev) => recordRatedMovieConversion(movie, prev, aiRecommendations, 500));
    }
    if (cloudUserRef.current?.id) {
      const movieKey = getCanonicalMovieKey(mergedEntry);
      if (movieKey) {
        pendingDeletesRef.current.delete(movieKey);
        pendingUpsertsRef.current.set(movieKey, { movie: mergedEntry, status: "watched" });
        scheduleCloudFlush();
      }
    }
  }

  function deleteWatched(id) {
    if (!id) return;
    const removed = (watchedRef.current || []).filter((m) => (m.imdbID || m.id || m.tmdbId) === id);
    setWatched((prev) => (prev || []).filter((m) => (m.imdbID || m.id || m.tmdbId) !== id));
    if (cloudUserRef.current?.id) {
      const keysToDelete = removed.length > 0
        ? removed.map((m) => getCanonicalMovieKey(m)).filter(Boolean)
        : [getCanonicalMovieKey({ imdbID: id, id })].filter(Boolean);
      for (const key of keysToDelete) {
        pendingUpsertsRef.current.delete(key);
        pendingDeletesRef.current.add(key);
      }
      if (keysToDelete.length > 0) scheduleCloudFlush();
    }
  }

  function addToWatchlist(movie) {
    if (!movie) return;
    const movieId = movie.imdbID || movie.id || movie.tmdbId;
    if (!movieId) return;
    const updatedAt = movie.updatedAt || new Date().toISOString();
    const normalizedMovie = { ...movie, imdbID: movie.imdbID || movieId, updatedAt };
    if ((watchlistRef.current || []).some((m) => (m.imdbID || m.id || m.tmdbId) === movieId)) return;
    setWatchlist((prev) => [...(prev || []), normalizedMovie]);
    if (cloudUserRef.current?.id) {
      const movieKey = getCanonicalMovieKey(normalizedMovie);
      if (movieKey) {
        pendingDeletesRef.current.delete(movieKey);
        pendingUpsertsRef.current.set(movieKey, { movie: normalizedMovie, status: "watchlist" });
        scheduleCloudFlush();
      }
    }
  }

  function deleteWatchlist(id) {
    if (!id) return;
    const removed = (watchlistRef.current || []).filter((m) => (m.imdbID || m.id || m.tmdbId) === id);
    setWatchlist((prev) => (prev || []).filter((m) => (m.imdbID || m.id || m.tmdbId) !== id));
    if (cloudUserRef.current?.id) {
      const keysToDelete = removed.length > 0
        ? removed.map((m) => getCanonicalMovieKey(m)).filter(Boolean)
        : [getCanonicalMovieKey({ imdbID: id, id })].filter(Boolean);
      for (const key of keysToDelete) {
        pendingUpsertsRef.current.delete(key);
        pendingDeletesRef.current.add(key);
      }
      if (keysToDelete.length > 0) scheduleCloudFlush();
    }
  }

  function toggleWatchProvider(providerId) {
    setUserWatchProviders((prev) => {
      if (prev.includes(providerId)) {
        return prev.filter((id) => id !== providerId);
      }
      return [...prev, providerId];
    });
  }

  return (
    <AppContext.Provider
      value={{
        watched: watched || [],
        setWatched,
        watchlist: watchlist || [],
        setWatchlist,
        userRegion,
        setUserRegion,
        userWatchProviders,
        setUserWatchProviders,
        toggleWatchProvider,
        addWatched,
        deleteWatched,
        addToWatchlist,
        deleteWatchlist,
        hasCloudConfig,
        cloudUser,
        cloudSyncStatus,
        lastSyncedAt,
        cloudError,
        signInWithEmailOtp,
        signOutCloud,
        syncCloudNow,
        applyVaultImportSnapshot,
        aiRecommendations,
        setAiRecommendations,
        aiTasteProfile,
        setAiTasteProfile,
        aiRecommendationsHash,
        setAiRecommendationsHash,
        aiModelInfo,
        setAiModelInfo,
        aiFeedbackLog,
        saveAiRecommendations,
        addAiFeedback,
        searchQuery,
        setSearchQuery,
        searchType,
        setSearchType,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
