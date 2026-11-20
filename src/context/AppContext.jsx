import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { normalizeFeedbackEvent, recordRatedMovieConversion } from "../services/feedbackService.js";
import { resolveMovieRecSource } from "../services/vaultStats.js";
import {
  extractTmdbNumericId,
  findMatchingMovie,
  isSameMovie,
  mergeMovieEntryFields,
  removeMovieEntries,
  upsertMovieEntry
} from "../services/movieIdentity.js";
import { hasTmdbBackend } from "../services/apiTransport.js";
import {
  backfillMissingTmdbIds,
  fetchTmdbMovieDetails,
  hasCompleteTmdbMetadata,
  isSeriesVaultItem
} from "../services/tmdbService.js";
import { getSupabaseClient, hasSupabaseConfig } from "../services/supabaseClient.js";
import { normalizeTasteRules } from "../services/tasteRulesService.js";
import {
  COMPARE_STORAGE_KEY,
  parseStoredCompareItems,
  toggleCompareItem
} from "../services/compareService.js";
import {
  getCanonicalMovieKey,
  mapLocalMovieToDbRow,
  pullAndSyncCloudVault
} from "../services/vaultSyncService.js";
import { isSampleItem, mergeSampleVault } from "../services/sampleVaultService.js";
import { STORAGE_PURGE_ORDER, safeSetStorageItem } from "../services/storageEviction.js";

export { STORAGE_PURGE_ORDER };

const AppContext = createContext(null);
const DELETED_VAULT_KEYS_STORAGE = "cinemavault_deleted_keys_v1";
const LAST_SYNCED_AT_STORAGE = "cinemavault_last_synced_at_v1";

/**
 * Safe LocalStorage setter with tiered LRU eviction policy & 2-stage vault compaction.
 */
export const safeSetItem = (key, value) => safeSetStorageItem(key, value);

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

  const [tasteRules, setTasteRulesState] = useState(() => {
    try {
      const saved = localStorage.getItem("cinemavault_taste_rules_v1");
      return saved ? normalizeTasteRules(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });

  const [aiRecommendations, setAiRecommendations] = useState(() => {
    try {
      const saved = localStorage.getItem("cinemavault_recs_v1");
      const parsed = saved && saved !== "undefined" ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length >= 7 ? parsed : null;
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
      const savedRecs = localStorage.getItem("cinemavault_recs_v1");
      const parsedRecs = savedRecs && savedRecs !== "undefined" ? JSON.parse(savedRecs) : null;
      if (!Array.isArray(parsedRecs) || parsedRecs.length < 7) {
        return "";
      }
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

  const [compareItems, setCompareItems] = useState(() => {
    try {
      return parseStoredCompareItems(sessionStorage.getItem(COMPARE_STORAGE_KEY));
    } catch {
      return [];
    }
  });
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [compareNotice, setCompareNotice] = useState("");

  const [hasCloudConfig] = useState(() => hasSupabaseConfig());
  const [cloudUser, setCloudUser] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState(() => {
    try {
      return localStorage.getItem(LAST_SYNCED_AT_STORAGE) || null;
    } catch {
      return null;
    }
  });
  const [cloudError, setCloudError] = useState(null);

  const watchedRef = useRef(watched);
  const watchlistRef = useRef(watchlist);
  const compareItemsRef = useRef(compareItems);
  const compareNoticeTimerRef = useRef(null);
  const userRegionRef = useRef(userRegion);
  const userWatchProvidersRef = useRef(userWatchProviders);
  const cloudUserRef = useRef(null);
  const lastSyncedAtRef = useRef(lastSyncedAt);
  const deletedVaultKeysRef = useRef((() => {
    try {
      const raw = localStorage.getItem(DELETED_VAULT_KEYS_STORAGE);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  })());
  const pendingUpsertsRef = useRef(new Map());
  const pendingDeletesRef = useRef(new Set());
  const syncTimerRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const lastAutoSyncedUserIdRef = useRef(null);
  const backfillStartedRef = useRef(false);

  const persistDeletedVaultKeys = useCallback((nextMap) => {
    const entries = Object.entries(nextMap || {}).slice(-1000);
    const trimmed = Object.fromEntries(entries);
    deletedVaultKeysRef.current = trimmed;
    try {
      safeSetItem(DELETED_VAULT_KEYS_STORAGE, trimmed);
    } catch (_) {}
  }, []);

  const persistLastSyncedAt = useCallback((iso) => {
    lastSyncedAtRef.current = iso || null;
    setLastSyncedAt(iso || null);
    try {
      if (iso) localStorage.setItem(LAST_SYNCED_AT_STORAGE, iso);
      else localStorage.removeItem(LAST_SYNCED_AT_STORAGE);
    } catch (_) {}
  }, []);

  useEffect(() => {
    watchedRef.current = watched || [];
    safeSetItem("watchedMovies", watched || []);
  }, [watched]);

  useEffect(() => {
    watchlistRef.current = watchlist || [];
    safeSetItem("watchlist", watchlist || []);
  }, [watchlist]);

  useEffect(() => {
    compareItemsRef.current = compareItems || [];
    try {
      sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(compareItems || []));
    } catch (_) {}
  }, [compareItems]);

  useEffect(() => () => {
    if (compareNoticeTimerRef.current) clearTimeout(compareNoticeTimerRef.current);
  }, []);

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
    safeSetItem("cinemavault_taste_rules_v1", normalizeTasteRules(tasteRules || []));
  }, [tasteRules]);

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
      const nonSampleUpserts = upsertEntries.filter(([, entry]) => !isSampleItem(entry?.movie));
      if (nonSampleUpserts.length > 0) {
        const rows = nonSampleUpserts.map(([, entry]) =>
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
      persistLastSyncedAt(new Date().toISOString());
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

      const { error: profileError } = await supabase
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
      if (profileError) throw profileError;

      const nowIso = new Date().toISOString();
      await pullAndSyncCloudVault(supabase, {
        userId: userObj.id,
        localWatched: watchedRef.current || [],
        localWatchlist: watchlistRef.current || [],
        nowIso,
        deletedKeys: deletedVaultKeysRef.current || {},
        lastSyncedAt: lastSyncedAtRef.current || null,
        onMerged: ({ mergedWatched, mergedWatchlist }) => {
          watchedRef.current = mergedWatched;
          watchlistRef.current = mergedWatchlist;
          setWatched(mergedWatched);
          setWatchlist(mergedWatchlist);
        }
      });

      const syncedTimestamp = new Date().toISOString();
      lastAutoSyncedUserIdRef.current = userObj.id;
      setCloudSyncStatus("synced");
      persistLastSyncedAt(syncedTimestamp);
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
        persistLastSyncedAt(null);
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

  useEffect(() => {
    if (backfillStartedRef.current || !hasTmdbBackend()) return undefined;
    const CHECKED_KEY = "cinemavault_tmdb_backfill_checked_v1";
    const controller = new AbortController();

    function loadCheckedKeys() {
      try {
        const raw = localStorage.getItem(CHECKED_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed : []);
      } catch (_) {
        return new Set();
      }
    }

    function saveCheckedKeys(keysSet) {
      try {
        safeSetItem(CHECKED_KEY, [...keysSet].slice(-500));
      } catch (_) {}
    }

    function mergeBackfilledListPure(currentList, snapshotList, updatedList) {
      if (!Array.isArray(currentList) || !Array.isArray(updatedList)) return currentList;
      const enriched = [];
      for (let i = 0; i < updatedList.length; i++) {
        if (updatedList[i] && updatedList[i] !== snapshotList?.[i]) {
          enriched.push(updatedList[i]);
        }
      }
      if (enriched.length === 0) return currentList;

      let anyChanged = false;
      const mergedItems = currentList.map((liveItem) => {
        if (!liveItem) return liveItem;
        const match = enriched.find((cand) => isSameMovie(liveItem, cand));
        if (!match) return liveItem;
        const hasValidLivePoster =
          typeof liveItem.poster === "string" && liveItem.poster.trim() !== "" && liveItem.poster !== "N/A";
        const resolvedLiveImdb =
          /^tt\d+$/i.test(String(liveItem.imdbID || "").trim())
            ? liveItem.imdbID
            : (/^tt\d+$/i.test(String(match.imdbID || "").trim()) ? match.imdbID : liveItem.imdbID);
        anyChanged = true;
        return {
          ...liveItem,
          ...(resolvedLiveImdb ? { imdbID: resolvedLiveImdb } : {}),
          tmdbId: liveItem.tmdbId ?? match.tmdbId ?? null,
          poster: hasValidLivePoster ? liveItem.poster : (match.poster || liveItem.poster),
          ...(match.Type && !liveItem.Type ? { Type: match.Type } : {}),
          ...(Array.isArray(match.tmdbGenreIds) && !Array.isArray(liveItem.tmdbGenreIds) ? { tmdbGenreIds: match.tmdbGenreIds } : {}),
          ...(Array.isArray(match.tmdbKeywords) && !Array.isArray(liveItem.tmdbKeywords) ? { tmdbKeywords: match.tmdbKeywords } : {}),
          ...(Array.isArray(match.castIds) && !Array.isArray(liveItem.castIds) ? { castIds: match.castIds } : {}),
          ...(match.crewPersonId !== undefined && liveItem.crewPersonId == null ? { crewPersonId: match.crewPersonId } : {}),
          ...(match.genre && !liveItem.genre ? { genre: match.genre } : {}),
          ...(match.director && (!liveItem.director || liveItem.director === "Unknown") ? { director: match.director } : {}),
          ...(match.release_date && !liveItem.release_date ? { release_date: match.release_date } : {}),
          ...(match.title && !liveItem.title ? { title: match.title } : {}),
          ...(match.year && !liveItem.year ? { year: match.year } : {}),
          ...(match.backdrop && !liveItem.backdrop ? { backdrop: match.backdrop } : {})
        };
      });
      if (!anyChanged) return currentList;

      const deduped = [];
      for (const item of mergedItems) {
        if (!item) continue;
        const existingIdx = deduped.findIndex((kept) => isSameMovie(kept, item));
        if (existingIdx >= 0) {
          const kept = deduped[existingIdx];
          deduped[existingIdx] = {
            ...item,
            ...kept,
            userRating: Number(kept.userRating) > 0 ? kept.userRating : item.userRating,
            dateWatched: kept.dateWatched || item.dateWatched,
            userNote: kept.userNote || item.userNote,
            recSource: kept.recSource || item.recSource,
            tmdbKeywords: Array.isArray(kept.tmdbKeywords) ? kept.tmdbKeywords : item.tmdbKeywords,
            castIds: Array.isArray(kept.castIds) ? kept.castIds : item.castIds,
            tmdbGenreIds: Array.isArray(kept.tmdbGenreIds) ? kept.tmdbGenreIds : item.tmdbGenreIds,
            crewPersonId: kept.crewPersonId ?? item.crewPersonId
          };
        } else {
          deduped.push(item);
        }
      }
      return deduped;
    }

    function queueBackfilledCloudUpserts(liveList, snapshotList, updatedList, status) {
      if (!cloudUserRef.current?.id || !Array.isArray(liveList) || !Array.isArray(updatedList)) return false;
      let queued = false;
      const mergedList = mergeBackfilledListPure(liveList, snapshotList, updatedList);
      if (mergedList === liveList) return false;

      const liveSet = new Set(liveList);
      const nextKeys = new Set(mergedList.map((m) => getCanonicalMovieKey(m)).filter(Boolean));
      for (const liveItem of liveList) {
        const oldKey = liveItem ? getCanonicalMovieKey(liveItem) : "";
        if (oldKey && !nextKeys.has(oldKey)) {
          pendingUpsertsRef.current.delete(oldKey);
          pendingDeletesRef.current.add(oldKey);
          queued = true;
        }
      }
      for (const mergedItem of mergedList) {
        if (!mergedItem || liveSet.has(mergedItem)) continue;
        const newKey = getCanonicalMovieKey(mergedItem);
        if (newKey) {
          pendingDeletesRef.current.delete(newKey);
          pendingUpsertsRef.current.set(newKey, { movie: mergedItem, status });
          queued = true;
        }
      }
      return queued;
    }

    const timerId = setTimeout(async () => {
      if (backfillStartedRef.current || controller.signal.aborted) return;
      backfillStartedRef.current = true;

      const watchedSnap = Array.isArray(watchedRef.current) ? watchedRef.current : [];
      const watchlistSnap = Array.isArray(watchlistRef.current) ? watchlistRef.current : [];
      if (watchedSnap.length === 0 && watchlistSnap.length === 0) return;

      const checkedSet = loadCheckedKeys();
      try {
        const res = await backfillMissingTmdbIds(watchedSnap, watchlistSnap, {
          maxItems: 40,
          maxLookups: 15,
          userRegion: userRegionRef.current || "US",
          alreadyChecked: checkedSet,
          signal: controller.signal
        });
        if (controller.signal.aborted) return;

        if (Array.isArray(res.checkedKeys) && res.checkedKeys.length > 0) {
          for (const key of res.checkedKeys) checkedSet.add(key);
          saveCheckedKeys(checkedSet);
        }

        if (res.updatedCount > 0) {
          const liveWatched = Array.isArray(watchedRef.current) ? watchedRef.current : [];
          const liveWatchlist = Array.isArray(watchlistRef.current) ? watchlistRef.current : [];
          const queuedW = queueBackfilledCloudUpserts(liveWatched, watchedSnap, res.watched, "watched");
          const queuedWl = queueBackfilledCloudUpserts(liveWatchlist, watchlistSnap, res.watchlist, "watchlist");
          setWatched((prev) => mergeBackfilledListPure(prev, watchedSnap, res.watched));
          setWatchlist((prev) => mergeBackfilledListPure(prev, watchlistSnap, res.watchlist));
          if (queuedW || queuedWl) {
            scheduleCloudFlush();
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn("Background TMDB backfill failed:", err);
        }
      }
    }, 800);

    return () => {
      clearTimeout(timerId);
      controller.abort();
    };
  }, [scheduleCloudFlush]);

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
    persistLastSyncedAt(null);
    persistDeletedVaultKeys({});
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
        persistLastSyncedAt(new Date().toISOString());
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
    const movieId = movie.imdbID || movie.id || (movie.tmdbId ? `tmdb_${movie.tmdbId}` : "");
    if (!movieId) return;
    const updatedAt = movie.updatedAt || new Date().toISOString();
    const existingWatched = findMatchingMovie(watchedRef.current || [], movie);
    // Preserve an existing real IMDb ID when a later update arrives from a TMDB-only card.
    const resolvedImdbId =
      (/^tt\d+$/i.test(String(movie.imdbID || "")) && movie.imdbID) ||
      (/^tt\d+$/i.test(String(existingWatched?.imdbID || "")) && existingWatched.imdbID) ||
      movie.imdbID ||
      existingWatched?.imdbID ||
      movieId;
    const normalizedMovie = { ...movie, imdbID: resolvedImdbId, updatedAt };
    const { removed: removedWatchlist } = removeMovieEntries(watchlistRef.current || [], normalizedMovie);
    const resolvedRecSource = resolveMovieRecSource(
      normalizedMovie,
      aiRecommendations,
      [existingWatched, ...(removedWatchlist || [])],
      updatedAt
    );
    const clearStudioKeys = ["ratingBreakdown", "watchMeta"].filter(
      (key) =>
        Object.prototype.hasOwnProperty.call(normalizedMovie, key) &&
        (normalizedMovie[key] === null || normalizedMovie[key] === undefined)
    );
    const mergedEntry = mergeMovieEntryFields(
      existingWatched || {},
      {
        ...normalizedMovie,
        ...(resolvedRecSource ? { recSource: resolvedRecSource } : {})
      },
      clearStudioKeys
    );
    delete mergedEntry.isSample;

    setWatched((prev) => upsertMovieEntry(prev, mergedEntry, { clearKeys: clearStudioKeys }));
    setWatchlist((prev) => removeMovieEntries(prev, mergedEntry).nextList);
    const addedCanonicalKey = getCanonicalMovieKey(mergedEntry);
    if (addedCanonicalKey && deletedVaultKeysRef.current?.[addedCanonicalKey]) {
      const nextDeleted = { ...deletedVaultKeysRef.current };
      delete nextDeleted[addedCanonicalKey];
      persistDeletedVaultKeys(nextDeleted);
    }
    if (Number(movie.userRating) > 0) {
      setAiFeedbackLog((prev) => recordRatedMovieConversion(mergedEntry, prev, aiRecommendations, 500));
    }
    if (cloudUserRef.current?.id) {
      const movieKey = getCanonicalMovieKey(mergedEntry);
      if (movieKey) {
        const staleKeys = new Set();
        const oldWatchedKey = existingWatched ? getCanonicalMovieKey(existingWatched) : "";
        if (oldWatchedKey && oldWatchedKey !== movieKey) staleKeys.add(oldWatchedKey);
        for (const wlItem of removedWatchlist) {
          const oldWlKey = getCanonicalMovieKey(wlItem);
          if (oldWlKey && oldWlKey !== movieKey) staleKeys.add(oldWlKey);
        }
        for (const staleKey of staleKeys) {
          pendingUpsertsRef.current.delete(staleKey);
          pendingDeletesRef.current.add(staleKey);
        }
        pendingDeletesRef.current.delete(movieKey);
        pendingUpsertsRef.current.set(movieKey, { movie: mergedEntry, status: "watched" });
        scheduleCloudFlush();
      }
    }

    const addedTmdbId = extractTmdbNumericId(mergedEntry.tmdbId);
    if (addedTmdbId && !hasCompleteTmdbMetadata(mergedEntry) && !isSeriesVaultItem(mergedEntry) && hasTmdbBackend()) {
      fetchTmdbMovieDetails(addedTmdbId, userRegionRef.current || "US")
        .then((details) => {
          if (!details || !details.tmdbId) return;
          const patch = {
            imdbID: /^tt\d+$/i.test(String(mergedEntry.imdbID || ""))
              ? mergedEntry.imdbID
              : (details.imdbID || mergedEntry.imdbID),
            tmdbId: details.tmdbId,
            tmdbKeywords: Array.isArray(details.tmdbKeywords) ? details.tmdbKeywords : [],
            castIds: Array.isArray(details.castIds) ? details.castIds : [],
            crewPersonId: details.crewPersonId ?? mergedEntry.crewPersonId ?? null,
            collectionId: details.collectionId ?? mergedEntry.collectionId ?? null,
            collectionName: details.collectionName ?? mergedEntry.collectionName ?? null,
            ...(Array.isArray(details.tmdbGenreIds) && details.tmdbGenreIds.length > 0 ? { tmdbGenreIds: details.tmdbGenreIds } : {}),
            ...(!mergedEntry.release_date && details.release_date ? { release_date: details.release_date } : {}),
            ...((!mergedEntry.director || mergedEntry.director === "Unknown") && details.director ? { director: details.director } : {}),
            ...(!mergedEntry.genre && details.genre ? { genre: details.genre } : {}),
            ...(!mergedEntry.Type ? { Type: "movie" } : {})
          };
          setWatched((prev) => {
            const existingLive = findMatchingMovie(prev || [], mergedEntry);
            if (!existingLive) return prev;
            const nextEntry = {
              ...existingLive,
              ...patch,
              imdbID: /^tt\d+$/i.test(String(existingLive.imdbID || ""))
                ? existingLive.imdbID
                : (details.imdbID || existingLive.imdbID)
            };
            return upsertMovieEntry(prev, nextEntry);
          });
          if (cloudUserRef.current?.id) {
            const existingLive = findMatchingMovie(watchedRef.current || [], mergedEntry);
            const finalMovie = {
              ...(existingLive || mergedEntry),
              ...patch,
              imdbID: /^tt\d+$/i.test(String((existingLive || mergedEntry).imdbID || ""))
                ? (existingLive || mergedEntry).imdbID
                : (details.imdbID || (existingLive || mergedEntry).imdbID)
            };
            const newKey = getCanonicalMovieKey(finalMovie);
            const oldKey = getCanonicalMovieKey(existingLive || mergedEntry);
            if (oldKey && newKey && oldKey !== newKey) {
              pendingUpsertsRef.current.delete(oldKey);
              pendingDeletesRef.current.add(oldKey);
            }
            if (newKey) {
              pendingDeletesRef.current.delete(newKey);
              pendingUpsertsRef.current.set(newKey, { movie: finalMovie, status: "watched" });
              scheduleCloudFlush();
            }
          }
        })
        .catch(() => {});
    }
  }

  /**
   * Removes matching entries from either vault list and queues any cloud deletions.
   */
  function removeVaultItems(listRef, setList, idOrMovie) {
    if (!idOrMovie) return;
    const { removed } = removeMovieEntries(listRef.current || [], idOrMovie);
    setList((prev) => removeMovieEntries(prev, idOrMovie).nextList);
    const keysToDelete = removed.length > 0
      ? removed.map((m) => getCanonicalMovieKey(m)).filter(Boolean)
      : [
          typeof idOrMovie === "object"
            ? getCanonicalMovieKey(idOrMovie)
            : getCanonicalMovieKey({ imdbID: idOrMovie, id: idOrMovie })
        ].filter(Boolean);
    if (keysToDelete.length > 0) {
      const nowIso = new Date().toISOString();
      const nextDeleted = { ...(deletedVaultKeysRef.current || {}) };
      for (const key of keysToDelete) {
        nextDeleted[key] = nowIso;
      }
      persistDeletedVaultKeys(nextDeleted);
    }
    if (cloudUserRef.current?.id) {
      for (const key of keysToDelete) {
        pendingUpsertsRef.current.delete(key);
        pendingDeletesRef.current.add(key);
      }
      if (keysToDelete.length > 0) scheduleCloudFlush();
    }
  }

  function deleteWatched(id) {
    removeVaultItems(watchedRef, setWatched, id);
  }

  function addToWatchlist(movie) {
    if (!movie) return;
    const movieId = movie.imdbID || movie.id || (movie.tmdbId ? `tmdb_${movie.tmdbId}` : "");
    if (!movieId) return;
    const updatedAt = movie.updatedAt || new Date().toISOString();
    const resolvedRecSource = resolveMovieRecSource(movie, aiRecommendations, [], updatedAt);
    const normalizedMovie = {
      ...movie,
      imdbID: movie.imdbID || movieId,
      updatedAt,
      ...(resolvedRecSource ? { recSource: resolvedRecSource } : {})
    };
    if (findMatchingMovie(watchlistRef.current, normalizedMovie)) return;
    setWatchlist((prev) => (findMatchingMovie(prev, normalizedMovie) ? prev : [...(prev || []), normalizedMovie]));
    const wlCanonicalKey = getCanonicalMovieKey(normalizedMovie);
    if (wlCanonicalKey && deletedVaultKeysRef.current?.[wlCanonicalKey]) {
      const nextDeleted = { ...deletedVaultKeysRef.current };
      delete nextDeleted[wlCanonicalKey];
      persistDeletedVaultKeys(nextDeleted);
    }
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
    removeVaultItems(watchlistRef, setWatchlist, id);
  }

  function toggleWatchProvider(providerId) {
    setUserWatchProviders((prev) => {
      if (prev.includes(providerId)) {
        return prev.filter((id) => id !== providerId);
      }
      return [...prev, providerId];
    });
  }

  const setTasteRules = useCallback((nextOrUpdater) => {
    setTasteRulesState((prev) => {
      const next = typeof nextOrUpdater === "function" ? nextOrUpdater(prev || []) : nextOrUpdater;
      return normalizeTasteRules(next || []);
    });
  }, []);

  const addTasteRule = useCallback((text, polarity = "prefer", opts = {}) => {
    setTasteRulesState((prev) =>
      normalizeTasteRules([
        ...(prev || []),
        {
          text,
          polarity,
          pinned: Boolean(opts.pinned),
          active: opts.active !== false,
          source: opts.source || "user",
          updatedAt: Date.now()
        }
      ])
    );
  }, []);

  const updateTasteRule = useCallback((id, patch = {}) => {
    setTasteRulesState((prev) =>
      normalizeTasteRules((prev || []).map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)))
    );
  }, []);

  const deleteTasteRule = useCallback((id) => {
    setTasteRulesState((prev) => (prev || []).filter((r) => r.id !== id));
  }, []);

  const toggleTasteRuleActive = useCallback((id) => {
    setTasteRulesState((prev) =>
      normalizeTasteRules((prev || []).map((r) => (r.id === id ? { ...r, active: !r.active, updatedAt: Date.now() } : r)))
    );
  }, []);

  const toggleTasteRulePin = useCallback((id) => {
    setTasteRulesState((prev) =>
      normalizeTasteRules((prev || []).map((r) => (r.id === id ? { ...r, pinned: !r.pinned, updatedAt: Date.now() } : r)))
    );
  }, []);

  const showCompareNotice = useCallback((message) => {
    if (compareNoticeTimerRef.current) {
      clearTimeout(compareNoticeTimerRef.current);
    }
    setCompareNotice(message);
    if (message) {
      compareNoticeTimerRef.current = setTimeout(() => {
        setCompareNotice("");
      }, 3500);
    }
  }, []);

  const clearCompareNotice = useCallback(() => showCompareNotice(""), [showCompareNotice]);

  const toggleCompare = useCallback(
    (movie) => {
      const current = compareItemsRef.current || [];
      const result = toggleCompareItem(current, movie);
      if (result.action === "full") {
        showCompareNotice("Compare tray full (max 3 films). Remove a slot first.");
        return result;
      }
      if (result.action === "added" || result.action === "removed") {
        compareItemsRef.current = result.items;
        setCompareItems(result.items);
        showCompareNotice("");
      }
      return result;
    },
    [showCompareNotice]
  );

  const removeCompareItem = useCallback(
    (idOrMovie) => {
      const { nextList } = removeMovieEntries(compareItemsRef.current || [], idOrMovie);
      compareItemsRef.current = nextList;
      setCompareItems(nextList);
      showCompareNotice("");
    },
    [showCompareNotice]
  );

  const clearCompare = useCallback(() => {
    compareItemsRef.current = [];
    setCompareItems([]);
    showCompareNotice("");
  }, [showCompareNotice]);

  const openCompareModal = useCallback(() => setIsCompareOpen(true), []);
  const closeCompareModal = useCallback(() => setIsCompareOpen(false), []);

  const hasSampleData =
    (watched || []).some((m) => isSampleItem(m)) ||
    (watchlist || []).some((m) => isSampleItem(m));

  const loadSampleVault = useCallback(() => {
    if (cloudUserRef.current || cloudUser) {
      return { ok: false, reason: "signed-in" };
    }
    const currentWatched = watchedRef.current || [];
    if (currentWatched.length >= 3) {
      return { ok: false, reason: "vault-not-empty" };
    }

    const { watched: nextWatched, watchlist: nextWatchlist } = mergeSampleVault({
      currentWatched,
      currentWatchlist: watchlistRef.current || [],
      isSameMovieFn: isSameMovie
    });

    watchedRef.current = nextWatched;
    watchlistRef.current = nextWatchlist;
    setWatched(nextWatched);
    setWatchlist(nextWatchlist);
    return { ok: true };
  }, [cloudUser]);

  const clearSampleVault = useCallback(() => {
    const nextWatched = (watchedRef.current || []).filter((m) => !isSampleItem(m));
    const nextWatchlist = (watchlistRef.current || []).filter((m) => !isSampleItem(m));
    watchedRef.current = nextWatched;
    watchlistRef.current = nextWatchlist;
    setWatched(nextWatched);
    setWatchlist(nextWatchlist);
  }, []);

  return (
    <AppContext.Provider
      value={{
        watched: watched || [],
        setWatched,
        watchlist: watchlist || [],
        setWatchlist,
        hasSampleData,
        loadSampleVault,
        clearSampleVault,
        userRegion,
        setUserRegion,
        userWatchProviders,
        setUserWatchProviders,
        toggleWatchProvider,
        tasteRules,
        setTasteRules,
        addTasteRule,
        updateTasteRule,
        deleteTasteRule,
        toggleTasteRuleActive,
        toggleTasteRulePin,
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
        compareItems: compareItems || [],
        compareNotice,
        clearCompareNotice,
        toggleCompare,
        removeCompareItem,
        clearCompare,
        isCompareOpen,
        openCompareModal,
        closeCompareModal
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useOptionalApp() {
  return useContext(AppContext);
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
