import { createContext, useContext, useState, useEffect } from "react";

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

  useEffect(() => {
    safeSetItem("watchedMovies", watched || []);
  }, [watched]);

  useEffect(() => {
    safeSetItem("watchlist", watchlist || []);
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem("cinemavault_user_region", userRegion);
    } catch (_) {}
  }, [userRegion]);

  useEffect(() => {
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
    safeSetItem("cinemavault_feedback_v1", aiFeedbackLog || []);
  }, [aiFeedbackLog]);

  function saveAiRecommendations(recs, profile, hash) {
    setAiRecommendations(recs);
    setAiTasteProfile(profile);
    setAiRecommendationsHash(hash || "");
  }

  function addAiFeedback(feedbackItem) {
    if (!feedbackItem || !feedbackItem.title) return;
    setAiFeedbackLog((prev) => {
      const filtered = (prev || []).filter(
        (f) => f.title.toLowerCase() !== feedbackItem.title.toLowerCase()
      );
      const updated = [
        ...filtered,
        {
          ...feedbackItem,
          ts: new Date().toISOString()
        }
      ];
      return updated.slice(-15);
    });
  }

  function addWatched(movie) {
    if (!movie) return;
    const movieId = movie.imdbID || movie.id || movie.tmdbId;
    if (!movieId) return;
    const normalizedMovie = { ...movie, imdbID: movie.imdbID || movieId };
    if (watched.some((m) => (m.imdbID || m.id || m.tmdbId) === movieId)) return;
    setWatched((prev) => [...(prev || []), normalizedMovie]);
    setWatchlist((prev) => (prev || []).filter((m) => (m.imdbID || m.id || m.tmdbId) !== movieId));
  }

  function deleteWatched(id) {
    if (!id) return;
    setWatched((prev) => (prev || []).filter((m) => (m.imdbID || m.id || m.tmdbId) !== id));
  }

  function addToWatchlist(movie) {
    if (!movie) return;
    const movieId = movie.imdbID || movie.id || movie.tmdbId;
    if (!movieId) return;
    const normalizedMovie = { ...movie, imdbID: movie.imdbID || movieId };
    if ((watchlist || []).some((m) => (m.imdbID || m.id || m.tmdbId) === movieId)) return;
    setWatchlist((prev) => [...(prev || []), normalizedMovie]);
  }

  function deleteWatchlist(id) {
    if (!id) return;
    setWatchlist((prev) => (prev || []).filter((m) => (m.imdbID || m.id || m.tmdbId) !== id));
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
        aiRecommendations,
        setAiRecommendations,
        aiTasteProfile,
        setAiTasteProfile,
        aiRecommendationsHash,
        setAiRecommendationsHash,
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
