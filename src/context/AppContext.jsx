import { createContext, useContext, useState, useEffect } from "react";

const AppContext = createContext(null);

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
    try {
      localStorage.setItem("watchedMovies", JSON.stringify(watched || []));
    } catch (e) {
      console.warn("Error saving watchedMovies:", e);
    }
  }, [watched]);

  useEffect(() => {
    try {
      localStorage.setItem("watchlist", JSON.stringify(watchlist || []));
    } catch (e) {
      console.warn("Error saving watchlist:", e);
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      if (aiRecommendations) {
        localStorage.setItem("cinemavault_recs_v1", JSON.stringify(aiRecommendations));
      } else {
        localStorage.removeItem("cinemavault_recs_v1");
      }
    } catch (e) {
      console.warn("Error saving cinemavault_recs_v1:", e);
    }
  }, [aiRecommendations]);

  useEffect(() => {
    try {
      if (aiTasteProfile) {
        localStorage.setItem("cinemavault_taste_v1", JSON.stringify(aiTasteProfile));
      } else {
        localStorage.removeItem("cinemavault_taste_v1");
      }
    } catch (e) {
      console.warn("Error saving cinemavault_taste_v1:", e);
    }
  }, [aiTasteProfile]);

  useEffect(() => {
    try {
      if (aiRecommendationsHash) {
        localStorage.setItem("cinemavault_recs_hash_v1", aiRecommendationsHash);
      } else {
        localStorage.removeItem("cinemavault_recs_hash_v1");
      }
    } catch (e) {
      console.warn("Error saving cinemavault_recs_hash_v1:", e);
    }
  }, [aiRecommendationsHash]);

  useEffect(() => {
    try {
      localStorage.setItem("cinemavault_feedback_v1", JSON.stringify(aiFeedbackLog || []));
    } catch (e) {
      console.warn("Error saving cinemavault_feedback_v1:", e);
    }
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
      // Cap at 15 most recent items to avoid prompt bloat
      return updated.slice(-15);
    });
  }

  function addWatched(movie) {
    if (!movie || !movie.imdbID) return;
    if (watched.some((m) => m.imdbID === movie.imdbID)) return;
    setWatched((prev) => [...(prev || []), movie]);
    setWatchlist((prev) => (prev || []).filter((m) => m.imdbID !== movie.imdbID));
  }

  function deleteWatched(id) {
    if (!id) return;
    setWatched((prev) => (prev || []).filter((m) => m.imdbID !== id));
  }

  function addToWatchlist(movie) {
    if (!movie || !movie.imdbID) return;
    if ((watchlist || []).some((m) => m.imdbID === movie.imdbID)) return;
    setWatchlist((prev) => [...(prev || []), movie]);
  }

  function deleteWatchlist(id) {
    if (!id) return;
    setWatchlist((prev) => (prev || []).filter((m) => m.imdbID !== id));
  }

  return (
    <AppContext.Provider
      value={{
        watched: watched || [],
        setWatched,
        watchlist: watchlist || [],
        setWatchlist,
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
