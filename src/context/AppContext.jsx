import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import {
  getSupabaseClient,
  getSupabaseClientAsync,
  hasStoredSupabaseSession,
  hasSupabaseConfig
} from "../services/supabaseClient.js";
import { normalizeTasteRules } from "../services/tasteRulesService.js";
import {
  COMPARE_STORAGE_KEY,
  parseStoredCompareItems,
  toggleCompareItem
} from "../services/compareService.js";
import {
  getCanonicalMovieKey,
  mapLocalMovieToDbRow,
  mapLocalListToDbRow,
  pullAndSyncCloudVault,
  pullAndSyncCloudLists,
  pullAndSyncProfilePreferences
} from "../services/vaultSyncService.js";
import {
  CUSTOM_LISTS_STORAGE_KEY,
  clonePublicListToLocal,
  createCustomList,
  deleteCustomList,
  getActiveCustomLists,
  renameCustomList,
  setListVisibility,
  toggleMovieInList
} from "../services/listsService.js";
import {
  signUpWithEmailPassword,
  signInWithEmailPassword,
  signInWithMagicLink,
  signInWithOAuthProvider,
  sendPasswordResetEmail,
  updateAccountPassword,
  updateAccountProfile
} from "../services/authService.js";
import {
  clearExploreForYouCache,
  saveExploreForYouCache
} from "../services/exploreForYouCache.js";
import {
  createInitialBackgroundJobs,
  transitionJobState
} from "../services/backgroundJobService.js";
import { isSampleItem, mergeSampleVault } from "../services/sampleVaultService.js";
import { STORAGE_PURGE_ORDER, safeSetStorageItem } from "../services/storageEviction.js";
import {
  loadVaultFromStorage,
  mergeHydratedVaultSlice,
  saveVaultSlice
} from "../services/vaultStorageService.js";

export { STORAGE_PURGE_ORDER };

const AppContext = createContext(null);
const CompareContext = createContext(null);
const DELETED_VAULT_KEYS_STORAGE = "cinemavault_deleted_keys_v1";
const LAST_SYNCED_AT_STORAGE = "cinemavault_last_synced_at_v1";
const LOCAL_PREFS_UPDATED_AT_STORAGE = "cinemavault_prefs_updated_at_v1";

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

  const [customListsRaw, setCustomListsRaw] = useState(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_LISTS_STORAGE_KEY);
      return saved && saved !== "undefined" ? JSON.parse(saved) : [];
    } catch {
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
  const [backgroundJobs, setBackgroundJobs] = useState(() => createInitialBackgroundJobs());
  const [forYouLivePool, setForYouLivePool] = useState({
    profileHash: null,
    items: [],
    source: null,
    fromCache: null,
    generatedAt: 0,
    error: ""
  });
  const forYouJobIdRef = useRef(0);
  const oracleJobIdRef = useRef(0);
  const forYouJobControllerRef = useRef(null);
  const forYouInFlightHashRef = useRef(null);

  const [hasCloudConfig] = useState(() => hasSupabaseConfig());
  const [cloudUser, setCloudUser] = useState(null);
  const [cloudProfile, setCloudProfile] = useState({ displayName: "" });
  const [isAuthLoading, setIsAuthLoading] = useState(() => hasSupabaseConfig() && hasStoredSupabaseSession());
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("idle");
  const [isVaultHydrated, setIsVaultHydrated] = useState(() => typeof indexedDB === "undefined");
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
  const customListsRawRef = useRef(customListsRaw);
  const isVaultHydratedRef = useRef(isVaultHydrated);
  const vaultHydrationPromiseRef = useRef(null);
  const vaultPersistMountedRef = useRef({ watched: false, watchlist: false, customLists: false });
  const dirtyVaultBeforeHydrationRef = useRef({ watched: false, watchlist: false, customLists: false });
  const pendingListUpsertsRef = useRef(new Map());
  const compareItemsRef = useRef(compareItems);
  const compareNoticeTimerRef = useRef(null);
  const userRegionRef = useRef(userRegion);
  const userWatchProvidersRef = useRef(userWatchProviders);
  const tasteRulesRef = useRef(tasteRules);
  const cloudUserRef = useRef(null);
  const cloudProfileRef = useRef({ displayName: "" });
  const lastSyncedAtRef = useRef(lastSyncedAt);
  const authListenerBoundRef = useRef(false);
  const authSubscriptionRef = useRef(null);
  const initAuthPromiseRef = useRef(null);
  const sessionEpochRef = useRef(0);
  const cloudProfileHydratedRef = useRef(false);
  const localPrefsUpdatedAtRef = useRef((() => {
    try {
      return localStorage.getItem(LOCAL_PREFS_UPDATED_AT_STORAGE) || null;
    } catch {
      return null;
    }
  })());
  const profileSyncTimerRef = useRef(null);
  const suppressProfileSyncRef = useRef(false);
  const prefsEffectMountedRef = useRef({ region: false, providers: false, rules: false });
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
    let active = true;
    const promise = loadVaultFromStorage()
      .then((res) => {
        if (!active) return;
        const nextWatched = mergeHydratedVaultSlice(
          watchedRef.current,
          res.watched,
          dirtyVaultBeforeHydrationRef.current.watched
        );
        const nextWatchlist = mergeHydratedVaultSlice(
          watchlistRef.current,
          res.watchlist,
          dirtyVaultBeforeHydrationRef.current.watchlist
        );
        const nextCustomLists =
          dirtyVaultBeforeHydrationRef.current.customLists
            ? customListsRawRef.current
            : (Array.isArray(res.customLists) && res.customLists.length > 0
                ? res.customLists
                : customListsRawRef.current);
        watchedRef.current = nextWatched;
        watchlistRef.current = nextWatchlist;
        customListsRawRef.current = nextCustomLists;
        isVaultHydratedRef.current = true;
        setWatched(nextWatched);
        setWatchlist(nextWatchlist);
        setCustomListsRaw(nextCustomLists);
        setIsVaultHydrated(true);
        if (dirtyVaultBeforeHydrationRef.current.watched) {
          saveVaultSlice("watchedMovies", nextWatched);
        }
        if (dirtyVaultBeforeHydrationRef.current.watchlist) {
          saveVaultSlice("watchlist", nextWatchlist);
        }
        if (dirtyVaultBeforeHydrationRef.current.customLists) {
          saveVaultSlice("customLists", nextCustomLists);
        }
      })
      .catch(() => {
        if (!active) return;
        isVaultHydratedRef.current = true;
        setIsVaultHydrated(true);
      });
    vaultHydrationPromiseRef.current = promise;
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    watchedRef.current = watched || [];
    if (!vaultPersistMountedRef.current.watched) {
      vaultPersistMountedRef.current.watched = true;
      return;
    }
    if (!isVaultHydratedRef.current) {
      dirtyVaultBeforeHydrationRef.current.watched = true;
      return;
    }
    saveVaultSlice("watchedMovies", watched || []);
  }, [watched]);

  useEffect(() => {
    watchlistRef.current = watchlist || [];
    if (!vaultPersistMountedRef.current.watchlist) {
      vaultPersistMountedRef.current.watchlist = true;
      return;
    }
    if (!isVaultHydratedRef.current) {
      dirtyVaultBeforeHydrationRef.current.watchlist = true;
      return;
    }
    saveVaultSlice("watchlist", watchlist || []);
  }, [watchlist]);

  useEffect(() => {
    customListsRawRef.current = customListsRaw || [];
    if (!vaultPersistMountedRef.current.customLists) {
      vaultPersistMountedRef.current.customLists = true;
      return;
    }
    if (!isVaultHydratedRef.current) {
      dirtyVaultBeforeHydrationRef.current.customLists = true;
      return;
    }
    saveVaultSlice("customLists", customListsRaw || []);
  }, [customListsRaw]);

  useEffect(() => {
    compareItemsRef.current = compareItems || [];
    try {
      sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(compareItems || []));
    } catch (_) {}
  }, [compareItems]);

  useEffect(() => () => {
    if (compareNoticeTimerRef.current) clearTimeout(compareNoticeTimerRef.current);
  }, []);

  const persistLocalPrefsUpdatedAt = useCallback((iso) => {
    localPrefsUpdatedAtRef.current = iso || null;
    try {
      if (iso) localStorage.setItem(LOCAL_PREFS_UPDATED_AT_STORAGE, iso);
      else localStorage.removeItem(LOCAL_PREFS_UPDATED_AT_STORAGE);
    } catch (_) {}
  }, []);

  const scheduleProfileFlush = useCallback(() => {
    if (!cloudUserRef.current?.id || !hasCloudConfig || suppressProfileSyncRef.current) return;
    if (profileSyncTimerRef.current) {
      clearTimeout(profileSyncTimerRef.current);
    }
    const targetUserId = cloudUserRef.current.id;
    const epoch = sessionEpochRef.current;
    profileSyncTimerRef.current = setTimeout(async () => {
      profileSyncTimerRef.current = null;
      if (sessionEpochRef.current !== epoch || cloudUserRef.current?.id !== targetUserId) return;
      const supabase = await getSupabaseClientAsync();
      if (!supabase || sessionEpochRef.current !== epoch || cloudUserRef.current?.id !== targetUserId) {
        return;
      }
      try {
        const prefFields = {
          user_region: userRegionRef.current || "GLOBAL",
          preferred_providers: Array.isArray(userWatchProvidersRef.current)
            ? userWatchProvidersRef.current
            : [],
          taste_rules: normalizeTasteRules(tasteRulesRef.current || [])
        };
        let writeError = null;
        if (cloudProfileHydratedRef.current) {
          const { error } = await supabase
            .from("profiles")
            .upsert(
              {
                id: targetUserId,
                display_name: cloudProfileRef.current?.displayName || null,
                ...prefFields
              },
              { onConflict: "id" }
            );
          writeError = error;
        } else {
          // Never clobber display_name before initial profile hydration finishes
          const { error } = await supabase
            .from("profiles")
            .update(prefFields)
            .eq("id", targetUserId);
          writeError = error;
        }
        if (writeError) {
          console.warn("Profile preference flush failed:", writeError.message);
          return;
        }
        if (sessionEpochRef.current === epoch && cloudUserRef.current?.id === targetUserId) {
          persistLastSyncedAt(new Date().toISOString());
        }
      } catch {
        // Non-fatal; will reconcile on next full sync
      }
    }, 900);
  }, [hasCloudConfig, persistLastSyncedAt]);

  useEffect(() => {
    userRegionRef.current = userRegion || "GLOBAL";
    try {
      localStorage.setItem("cinemavault_user_region", userRegion);
    } catch (_) {}
    if (!prefsEffectMountedRef.current.region) {
      prefsEffectMountedRef.current.region = true;
      return;
    }
    if (!suppressProfileSyncRef.current) {
      persistLocalPrefsUpdatedAt(new Date().toISOString());
      scheduleProfileFlush();
    }
  }, [userRegion, persistLocalPrefsUpdatedAt, scheduleProfileFlush]);

  useEffect(() => {
    userWatchProvidersRef.current = Array.isArray(userWatchProviders) ? userWatchProviders : [];
    safeSetItem("cinemavault_user_providers", userWatchProviders || []);
    if (!prefsEffectMountedRef.current.providers) {
      prefsEffectMountedRef.current.providers = true;
      return;
    }
    if (!suppressProfileSyncRef.current) {
      persistLocalPrefsUpdatedAt(new Date().toISOString());
      scheduleProfileFlush();
    }
  }, [userWatchProviders, persistLocalPrefsUpdatedAt, scheduleProfileFlush]);

  useEffect(() => {
    const normalized = normalizeTasteRules(tasteRules || []);
    tasteRulesRef.current = normalized;
    safeSetItem("cinemavault_taste_rules_v1", normalized);
    if (!prefsEffectMountedRef.current.rules) {
      prefsEffectMountedRef.current.rules = true;
      return;
    }
    if (!suppressProfileSyncRef.current) {
      persistLocalPrefsUpdatedAt(new Date().toISOString());
      scheduleProfileFlush();
    }
  }, [tasteRules, persistLocalPrefsUpdatedAt, scheduleProfileFlush]);

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
    const supabase = getSupabaseClient() || (await getSupabaseClientAsync());
    const activeUser = cloudUserRef.current;
    if (!supabase || !activeUser?.id) return;

    const upsertEntries = Array.from(pendingUpsertsRef.current.entries());
    const deleteKeys = Array.from(pendingDeletesRef.current.values());
    const listUpserts = Array.from(pendingListUpsertsRef.current.values());
    if (upsertEntries.length === 0 && deleteKeys.length === 0 && listUpserts.length === 0) return;

    pendingUpsertsRef.current.clear();
    pendingDeletesRef.current.clear();
    pendingListUpsertsRef.current.clear();

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

      if (listUpserts.length > 0) {
        const listRows = listUpserts.map((l) => mapLocalListToDbRow(l, activeUser.id, l.updatedAt || nowIso));
        const { error: listErr } = await supabase
          .from("user_lists")
          .upsert(listRows, { onConflict: "id" });
        if (listErr && listErr.code !== "42P01" && listErr.code !== "PGRST205") {
          throw listErr;
        }
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
    const supabase = await getSupabaseClientAsync();
    if (!supabase || !userObj?.id || syncInFlightRef.current) {
      return { ok: false };
    }

    const epoch = sessionEpochRef.current;
    syncInFlightRef.current = true;
    setCloudSyncStatus("syncing");
    setCloudError(null);

    try {
      if (vaultHydrationPromiseRef.current) {
        await vaultHydrationPromiseRef.current.catch(() => {});
      }
      if (sessionEpochRef.current !== epoch || cloudUserRef.current?.id !== userObj.id) {
        return { ok: false };
      }
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      if (profileSyncTimerRef.current) {
        clearTimeout(profileSyncTimerRef.current);
        profileSyncTimerRef.current = null;
      }
      await flushCloudMutations();
      if (sessionEpochRef.current !== epoch || cloudUserRef.current?.id !== userObj.id) {
        return { ok: false };
      }
      setCloudSyncStatus("syncing");

      const mergedPrefs = await pullAndSyncProfilePreferences(supabase, {
        userId: userObj.id,
        localPrefs: {
          displayName: cloudProfileRef.current?.displayName || userObj.displayName || "",
          userRegion: userRegionRef.current || "GLOBAL",
          userWatchProviders: Array.isArray(userWatchProvidersRef.current)
            ? userWatchProvidersRef.current
            : [],
          tasteRules: tasteRulesRef.current || []
        },
        lastSyncedAt: lastSyncedAtRef.current || null,
        localPrefsUpdatedAt: localPrefsUpdatedAtRef.current || null
      });

      if (sessionEpochRef.current !== epoch || cloudUserRef.current?.id !== userObj.id) {
        return { ok: false };
      }

      cloudProfileHydratedRef.current = true;
      suppressProfileSyncRef.current = true;
      const nextProfile = { displayName: mergedPrefs.displayName || "" };
      cloudProfileRef.current = nextProfile;
      setCloudProfile(nextProfile);
      if (mergedPrefs.userRegion && mergedPrefs.userRegion !== userRegionRef.current) {
        userRegionRef.current = mergedPrefs.userRegion;
        setUserRegion(mergedPrefs.userRegion);
      }
      if (
        JSON.stringify(mergedPrefs.userWatchProviders) !==
        JSON.stringify(userWatchProvidersRef.current)
      ) {
        userWatchProvidersRef.current = mergedPrefs.userWatchProviders;
        setUserWatchProviders(mergedPrefs.userWatchProviders);
      }
      if (
        JSON.stringify(mergedPrefs.tasteRules) !==
        JSON.stringify(normalizeTasteRules(tasteRulesRef.current || []))
      ) {
        tasteRulesRef.current = mergedPrefs.tasteRules;
        setTasteRulesState(mergedPrefs.tasteRules);
      }
      requestAnimationFrame(() => {
        suppressProfileSyncRef.current = false;
      });

      const nowIso = new Date().toISOString();
      await pullAndSyncCloudVault(supabase, {
        userId: userObj.id,
        localWatched: watchedRef.current || [],
        localWatchlist: watchlistRef.current || [],
        nowIso,
        deletedKeys: deletedVaultKeysRef.current || {},
        lastSyncedAt: lastSyncedAtRef.current || null,
        onMerged: ({ mergedWatched, mergedWatchlist }) => {
          if (sessionEpochRef.current !== epoch || cloudUserRef.current?.id !== userObj.id) {
            return;
          }
          watchedRef.current = mergedWatched;
          watchlistRef.current = mergedWatchlist;
          setWatched(mergedWatched);
          setWatchlist(mergedWatchlist);
        }
      });

      await pullAndSyncCloudLists(supabase, {
        userId: userObj.id,
        localLists: customListsRawRef.current || [],
        nowIso,
        onMerged: (mergedLists) => {
          if (sessionEpochRef.current !== epoch || cloudUserRef.current?.id !== userObj.id) {
            return;
          }
          customListsRawRef.current = mergedLists;
          setCustomListsRaw(mergedLists);
        }
      });

      if (sessionEpochRef.current !== epoch || cloudUserRef.current?.id !== userObj.id) {
        return { ok: false };
      }

      const syncedTimestamp = new Date().toISOString();
      lastAutoSyncedUserIdRef.current = userObj.id;
      setCloudSyncStatus("synced");
      persistLastSyncedAt(syncedTimestamp);
      return { ok: true };
    } catch (err) {
      if (sessionEpochRef.current === epoch && cloudUserRef.current?.id === userObj.id) {
        setCloudSyncStatus("error");
        setCloudError(err?.message || "Failed to sync vault with cloud.");
      }
      return { ok: false, error: err?.message };
    } finally {
      syncInFlightRef.current = false;
    }
  }, [flushCloudMutations, persistLastSyncedAt]);

  const initAuthSession = useCallback(async () => {
    if (!hasCloudConfig) {
      setIsAuthLoading(false);
      return null;
    }
    if (initAuthPromiseRef.current) {
      return initAuthPromiseRef.current;
    }

    const startEpoch = sessionEpochRef.current;
    const run = (async () => {
      const supabase = await getSupabaseClientAsync();
      if (!supabase) {
        setIsAuthLoading(false);
        return null;
      }

      if (!authListenerBoundRef.current) {
        authListenerBoundRef.current = true;
        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === "PASSWORD_RECOVERY") {
            setIsPasswordRecovery(true);
          }
          if (!session?.user?.id) {
            sessionEpochRef.current += 1;
            cloudProfileHydratedRef.current = false;
            if (syncTimerRef.current) {
              clearTimeout(syncTimerRef.current);
              syncTimerRef.current = null;
            }
            if (profileSyncTimerRef.current) {
              clearTimeout(profileSyncTimerRef.current);
              profileSyncTimerRef.current = null;
            }
            pendingUpsertsRef.current.clear();
            pendingDeletesRef.current.clear();
            lastAutoSyncedUserIdRef.current = null;
            cloudUserRef.current = null;
            cloudProfileRef.current = { displayName: "" };
            setCloudUser(null);
            setCloudProfile({ displayName: "" });
            setCloudSyncStatus("idle");
            setCloudError(null);
            persistLastSyncedAt(null);
            return;
          }

          const nextUser = {
            id: session.user.id,
            email: session.user.email || null,
            displayName: session.user.user_metadata?.display_name || ""
          };
          if (cloudUserRef.current?.id && cloudUserRef.current.id !== nextUser.id) {
            sessionEpochRef.current += 1;
            cloudProfileHydratedRef.current = false;
          }
          cloudUserRef.current = nextUser;
          setCloudUser(nextUser);

          if (
            (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") &&
            lastAutoSyncedUserIdRef.current !== nextUser.id
          ) {
            syncVaultWithCloud(nextUser);
          }
        });
        authSubscriptionRef.current = authListener?.subscription || null;
      }

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
              email: data.user.email || null,
              displayName: data.user.user_metadata?.display_name || ""
            };
          }
        }
        if (sessionEpochRef.current !== startEpoch) {
          return supabase;
        }
        if (normalizedUser) {
          cloudUserRef.current = normalizedUser;
          setCloudUser(normalizedUser);
          if (lastAutoSyncedUserIdRef.current !== normalizedUser.id) {
            syncVaultWithCloud(normalizedUser);
          }
        }
        return supabase;
      } catch (err) {
        console.warn("Supabase initial session check failed:", err);
        return supabase;
      } finally {
        setIsAuthLoading(false);
        initAuthPromiseRef.current = null;
      }
    })();

    initAuthPromiseRef.current = run;
    return run;
  }, [hasCloudConfig, persistLastSyncedAt, syncVaultWithCloud]);

  useEffect(() => {
    if (hasCloudConfig && hasStoredSupabaseSession()) {
      initAuthSession();
    } else {
      setIsAuthLoading(false);
    }
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      if (profileSyncTimerRef.current) {
        clearTimeout(profileSyncTimerRef.current);
        profileSyncTimerRef.current = null;
      }
      authSubscriptionRef.current?.unsubscribe?.();
      authSubscriptionRef.current = null;
      authListenerBoundRef.current = false;
    };
  }, [hasCloudConfig, initAuthSession]);

  useEffect(() => {
    if (!isVaultHydrated || backfillStartedRef.current || !hasTmdbBackend()) return undefined;
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
  }, [scheduleCloudFlush, isVaultHydrated]);

  async function signUpWithPassword({ email, password, displayName = "" } = {}) {
    const supabase = await initAuthSession();
    if (!supabase) {
      return { ok: false, needsEmailConfirmation: false, alreadyRegistered: false, user: null, error: "Supabase cloud sync is not configured." };
    }
    setCloudError(null);
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined;
    const res = await signUpWithEmailPassword(supabase, {
      email,
      password,
      displayName,
      emailRedirectTo: redirectTo
    });
    if (!res.ok) {
      setCloudError(res.error);
      return res;
    }
    if (displayName.trim()) {
      const nextProfile = { displayName: displayName.trim().slice(0, 60) };
      cloudProfileRef.current = nextProfile;
      setCloudProfile(nextProfile);
    }
    return res;
  }

  async function signInWithPassword({ email, password } = {}) {
    const supabase = await initAuthSession();
    if (!supabase) {
      return { ok: false, user: null, error: "Supabase cloud sync is not configured." };
    }
    setCloudError(null);
    const res = await signInWithEmailPassword(supabase, { email, password });
    if (!res.ok) {
      setCloudError(res.error);
    }
    return res;
  }

  async function signInWithEmailOtp(email) {
    const supabase = await initAuthSession();
    if (!supabase) {
      return { ok: false, error: "Supabase cloud sync is not configured." };
    }
    setCloudError(null);
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/account` : undefined;
    const res = await signInWithMagicLink(supabase, {
      email,
      emailRedirectTo: redirectTo
    });
    if (!res.ok) {
      setCloudError(res.error);
    }
    return res;
  }

  async function signInWithOAuth(provider = "google") {
    const supabase = await initAuthSession();
    if (!supabase) {
      return { ok: false, url: null, error: "Supabase cloud sync is not configured." };
    }
    setCloudError(null);
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined;
    const res = await signInWithOAuthProvider(supabase, { provider, redirectTo });
    if (!res.ok) {
      setCloudError(res.error);
    }
    return res;
  }

  async function sendPasswordReset(email) {
    const supabase = await initAuthSession();
    if (!supabase) {
      return { ok: false, error: "Supabase cloud sync is not configured." };
    }
    setCloudError(null);
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth?mode=reset` : undefined;
    const res = await sendPasswordResetEmail(supabase, { email, redirectTo });
    if (!res.ok) {
      setCloudError(res.error);
    }
    return res;
  }

  async function updatePassword(newPassword) {
    const supabase = await initAuthSession();
    if (!supabase) {
      return { ok: false, error: "Supabase cloud sync is not configured." };
    }
    setCloudError(null);
    const res = await updateAccountPassword(supabase, { newPassword });
    if (res.ok) {
      setIsPasswordRecovery(false);
    } else {
      setCloudError(res.error);
    }
    return res;
  }

  async function updateDisplayName(displayName) {
    const supabase = await initAuthSession();
    const activeUser = cloudUserRef.current;
    if (!supabase || !activeUser?.id) {
      return { ok: false, displayName: "", error: "Sign in to update your profile." };
    }
    setCloudError(null);
    const res = await updateAccountProfile(supabase, { userId: activeUser.id, displayName });
    if (res.ok) {
      const nextProfile = { displayName: res.displayName };
      cloudProfileRef.current = nextProfile;
      setCloudProfile(nextProfile);
    } else {
      setCloudError(res.error);
    }
    return res;
  }

  const clearPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);

  async function signOutCloud({ clearLocal = false } = {}) {
    sessionEpochRef.current += 1;
    cloudProfileHydratedRef.current = false;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (profileSyncTimerRef.current) {
      clearTimeout(profileSyncTimerRef.current);
      profileSyncTimerRef.current = null;
    }
    pendingUpsertsRef.current.clear();
    pendingDeletesRef.current.clear();
    lastAutoSyncedUserIdRef.current = null;
    cloudUserRef.current = null;
    cloudProfileRef.current = { displayName: "" };

    const supabase = getSupabaseClient() || (await getSupabaseClientAsync());
    if (supabase) {
      await supabase.auth.signOut();
    }
    setCloudUser(null);
    setCloudProfile({ displayName: "" });
    setIsPasswordRecovery(false);
    setCloudSyncStatus("idle");
    setCloudError(null);
    persistLastSyncedAt(null);
    persistDeletedVaultKeys({});

    if (clearLocal) {
      abortAndResetBackgroundJobs();
      suppressProfileSyncRef.current = true;
      watchedRef.current = [];
      watchlistRef.current = [];
      tasteRulesRef.current = [];
      userRegionRef.current = "GLOBAL";
      userWatchProvidersRef.current = [];
      compareItemsRef.current = [];
      setWatched([]);
      setWatchlist([]);
      setTasteRulesState([]);
      setUserRegion("GLOBAL");
      setUserWatchProviders([]);
      setAiFeedbackLog([]);
      setCompareItems([]);
      setAiRecommendations(null);
      setAiTasteProfile(null);
      setAiRecommendationsHash("");
      setAiModelInfo(null);
      persistLocalPrefsUpdatedAt(null);
      try {
        sessionStorage.removeItem(COMPARE_STORAGE_KEY);
        localStorage.removeItem("cinemavault_tmdb_backfill_checked_v1");
      } catch (_) {}
      clearExploreForYouCache().catch(() => {});
      requestAnimationFrame(() => {
        suppressProfileSyncRef.current = false;
      });
    }
  }

  async function syncCloudNow() {
    return syncVaultWithCloud(cloudUserRef.current);
  }

  async function applyVaultImportSnapshot({
    mergedWatched = [],
    mergedWatchlist = [],
    mergedLists = undefined,
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

    abortAndResetBackgroundJobs();
    watchedRef.current = stampedWatched;
    watchlistRef.current = stampedWatchlist;
    setWatched(stampedWatched);
    setWatchlist(stampedWatchlist);
    if (Array.isArray(mergedLists)) {
      customListsRawRef.current = mergedLists;
      setCustomListsRaw(mergedLists);
    }

    const activeUser = cloudUserRef.current;
    const supabase = getSupabaseClient() || (await getSupabaseClientAsync());
    if (!supabase || !activeUser?.id) return;

    setCloudSyncStatus("syncing");
    setCloudError(null);
    try {
      const rows = [
        ...stampedWatched
          .filter((m) => !isSampleItem(m))
          .map((m) => mapLocalMovieToDbRow(m, "watched", activeUser.id, m.updatedAt || nowIso)),
        ...stampedWatchlist
          .filter((m) => !isSampleItem(m))
          .map((m) => mapLocalMovieToDbRow(m, "watchlist", activeUser.id, m.updatedAt || nowIso))
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
    delete normalizedMovie.isSample;
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

  const abortAndResetBackgroundJobs = useCallback(() => {
    forYouJobIdRef.current += 1;
    oracleJobIdRef.current += 1;
    if (forYouJobControllerRef.current) {
      try {
        forYouJobControllerRef.current.abort();
      } catch {
        // ignore
      }
      forYouJobControllerRef.current = null;
    }
    forYouInFlightHashRef.current = null;
    setForYouLivePool({
      profileHash: "",
      items: [],
      source: "math",
      fromCache: "",
      generatedAt: null,
      error: ""
    });
    setBackgroundJobs(createInitialBackgroundJobs());
  }, []);

  const allocateOracleJobId = useCallback(() => {
    oracleJobIdRef.current += 1;
    return oracleJobIdRef.current;
  }, []);

  const dismissBackgroundJobNotice = useCallback((jobKey) => {
    setBackgroundJobs((prev) => transitionJobState(prev, jobKey, { dismissed: true }));
  }, []);

  const reportOracleJobProgress = useCallback((patch = {}) => {
    setBackgroundJobs((prev) =>
      transitionJobState(prev, "oracle", {
        targetRoute: "/ai",
        ...patch
      })
    );
  }, []);

  const startForYouBackgroundJob = useCallback(
    async ({ profileHash, forceRefresh = false } = {}) => {
      const activeWatched = watchedRef.current || [];
      const activeWatchlist = watchlistRef.current || [];
      const activeRules = tasteRulesRef.current || [];
      const activeRegion = userRegionRef.current || "GLOBAL";
      const activeProviders = userWatchProvidersRef.current || [];
      const activeUserId = cloudUserRef.current?.id || null;
      const sampleActive =
        activeWatched.some((m) => isSampleItem(m)) ||
        activeWatchlist.some((m) => isSampleItem(m));

      if (activeWatched.length < 3) return null;

      // Avoid duplicate concurrent run for the exact same profile hash unless forceRefresh
      if (
        !forceRefresh &&
        forYouJobControllerRef.current &&
        forYouInFlightHashRef.current === profileHash
      ) {
        return null;
      }

      if (forYouJobControllerRef.current) {
        try {
          forYouJobControllerRef.current.abort();
        } catch {
          // ignore
        }
      }

      const controller = new AbortController();
      forYouJobControllerRef.current = controller;
      forYouInFlightHashRef.current = profileHash || "active";
      const jobId = ++forYouJobIdRef.current;

      setForYouLivePool((prev) => ({ ...prev, error: "" }));
      setBackgroundJobs((prev) =>
        transitionJobState(prev, "forYou", {
          jobId,
          status: "running",
          stage: "profile",
          label: "Scanning your Taste DNA & local movie map…",
          targetRoute: "/explore?mode=for-you"
        })
      );

      let pendingCacheWrite = Promise.resolve();
      try {
        const { generateExploreForYouPool } = await import("../services/exploreForYouService.js");
        const result = await generateExploreForYouPool({
          watched: activeWatched,
          watchlist: activeWatchlist,
          tasteRules: activeRules,
          feedbackLog: aiFeedbackLog || [],
          userRegion: activeRegion,
          userWatchProviders: activeProviders,
          signal: controller.signal,
          onStageUpdate: (stageInfo) => {
            if (jobId !== forYouJobIdRef.current || controller.signal.aborted) return;
            setBackgroundJobs((prev) =>
              transitionJobState(prev, "forYou", {
                jobId,
                status: "running",
                stage: stageInfo?.stage || "running",
                label: stageInfo?.label || "Curating Movies You'll Like…"
              })
            );
          },
          onPreliminaryReady: (prelim) => {
            if (jobId !== forYouJobIdRef.current || controller.signal.aborted) return;
            if (Array.isArray(prelim?.items) && prelim.items.length > 0) {
              setForYouLivePool({
                profileHash: prelim.profileHash,
                items: prelim.items,
                source: prelim.source,
                fromCache: prelim.stage || "math-live",
                generatedAt: prelim.generatedAt,
                error: ""
              });
              if (prelim.stage === "wave2") {
                pendingCacheWrite = saveExploreForYouCache({
                  profileHash: prelim.profileHash,
                  items: prelim.items,
                  source: prelim.source,
                  modelUsed: null,
                  generatedAt: prelim.generatedAt,
                  isPreliminary: true,
                  userId: null,
                  hasSampleData: sampleActive
                }).catch(() => {});
              }
            }
          }
        });

        if (jobId !== forYouJobIdRef.current || result?.aborted || controller.signal.aborted) {
          return null;
        }

        setForYouLivePool({
          profileHash: result.profileHash,
          items: result.items,
          source: result.source,
          fromCache: "fresh",
          generatedAt: result.generatedAt,
          error: ""
        });
        setBackgroundJobs((prev) =>
          transitionJobState(prev, "forYou", {
            jobId,
            status: "done",
            stage: "done",
            count: result.items.length,
            label: `Your ${result.items.length} personalized matches are ready`
          })
        );

        await pendingCacheWrite;
        if (jobId === forYouJobIdRef.current && !controller.signal.aborted) {
          saveExploreForYouCache({
            profileHash: result.profileHash,
            items: result.items,
            source: result.source,
            modelUsed: result.modelUsed,
            generatedAt: result.generatedAt,
            isPreliminary: false,
            userId: activeUserId,
            hasSampleData: sampleActive
          }).catch(() => {});
        }
        return result;
      } catch (err) {
        if (jobId === forYouJobIdRef.current && !controller.signal.aborted) {
          setForYouLivePool((prev) => ({
            ...prev,
            error: "Could not build personalized Explore picks right now. Try refreshing."
          }));
          setBackgroundJobs((prev) =>
            transitionJobState(prev, "forYou", {
              jobId,
              status: "error",
              label: "Could not refresh Movies You'll Like"
            })
          );
        }
        return null;
      } finally {
        if (forYouJobControllerRef.current === controller) {
          forYouJobControllerRef.current = null;
          forYouInFlightHashRef.current = null;
        }
      }
    },
    [aiFeedbackLog]
  );

  const clearSampleVault = useCallback(() => {
    abortAndResetBackgroundJobs();
    const nextWatched = (watchedRef.current || []).filter((m) => !isSampleItem(m));
    const nextWatchlist = (watchlistRef.current || []).filter((m) => !isSampleItem(m));
    watchedRef.current = nextWatched;
    watchlistRef.current = nextWatchlist;
    setWatched(nextWatched);
    setWatchlist(nextWatchlist);
  }, [abortAndResetBackgroundJobs]);

  const commitCustomListsUpdate = useCallback(
    (nextLists, touchedId = null) => {
      customListsRawRef.current = nextLists;
      setCustomListsRaw(nextLists);
      if (cloudUserRef.current?.id && touchedId) {
        const target = nextLists.find((l) => l.id === touchedId);
        if (target) {
          pendingListUpsertsRef.current.set(target.id, target);
          scheduleCloudFlush();
        }
      }
      return nextLists;
    },
    [scheduleCloudFlush]
  );

  const createCustomListAction = useCallback(
    (payload) => {
      const next = createCustomList(customListsRawRef.current, payload);
      const created = next[0] || null;
      commitCustomListsUpdate(next, created?.id || null);
      return created;
    },
    [commitCustomListsUpdate]
  );

  const renameCustomListAction = useCallback(
    (listId, payload) => {
      const next = renameCustomList(customListsRawRef.current, listId, payload);
      commitCustomListsUpdate(next, listId);
    },
    [commitCustomListsUpdate]
  );

  const deleteCustomListAction = useCallback(
    (listId) => {
      const next = deleteCustomList(customListsRawRef.current, listId);
      commitCustomListsUpdate(next, listId);
    },
    [commitCustomListsUpdate]
  );

  const toggleMovieInListAction = useCallback(
    (listId, movie) => {
      const res = toggleMovieInList(customListsRawRef.current, listId, movie);
      commitCustomListsUpdate(res.lists, listId);
      return res;
    },
    [commitCustomListsUpdate]
  );

  const setListVisibilityAction = useCallback(
    (listId, visibility) => {
      const next = setListVisibility(customListsRawRef.current, listId, visibility);
      commitCustomListsUpdate(next, listId);
      return next.find((l) => l.id === listId) || null;
    },
    [commitCustomListsUpdate]
  );

  const cloneChecklistToCustomList = useCallback(
    (checklist) => {
      if (!checklist) return null;
      return createCustomListAction({
        name: checklist.name,
        description: checklist.description || "",
        sourceChecklistId: checklist.id,
        initialItems: checklist.items || []
      });
    },
    [createCustomListAction]
  );

  const clonePublicListAction = useCallback(
    (publicList) => {
      const res = clonePublicListToLocal(customListsRawRef.current, publicList);
      if (res.clonedList) {
        commitCustomListsUpdate(res.lists, res.clonedList.id);
      }
      return res.clonedList;
    },
    [commitCustomListsUpdate]
  );

  const customLists = useMemo(
    () => getActiveCustomLists(customListsRaw),
    [customListsRaw]
  );

  const compareContextValue = useMemo(
    () => ({
      compareItems: compareItems || [],
      toggleCompare
    }),
    [compareItems, toggleCompare]
  );

  return (
    <AppContext.Provider
      value={{
        watched: watched || [],
        setWatched,
        watchlist: watchlist || [],
        setWatchlist,
        customLists,
        customListsRaw: customListsRaw || [],
        createCustomListAction,
        renameCustomListAction,
        deleteCustomListAction,
        toggleMovieInListAction,
        setListVisibilityAction,
        cloneChecklistToCustomList,
        clonePublicListAction,
        isVaultHydrated,
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
        cloudProfile,
        isAuthLoading,
        isPasswordRecovery,
        clearPasswordRecovery,
        initAuthSession,
        cloudSyncStatus,
        lastSyncedAt,
        cloudError,
        signUpWithPassword,
        signInWithPassword,
        signInWithEmailOtp,
        signInWithOAuth,
        sendPasswordReset,
        updatePassword,
        updateDisplayName,
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
        closeCompareModal,
        backgroundJobs,
        forYouLivePool,
        setForYouLivePool,
        startForYouBackgroundJob,
        allocateOracleJobId,
        oracleJobIdRef,
        reportOracleJobProgress,
        dismissBackgroundJobNotice
      }}
    >
      <CompareContext.Provider value={compareContextValue}>
        {children}
      </CompareContext.Provider>
    </AppContext.Provider>
  );
}

export function useCompareState() {
  return useContext(CompareContext);
}

export function useOptionalApp() {
  return useContext(AppContext);
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
