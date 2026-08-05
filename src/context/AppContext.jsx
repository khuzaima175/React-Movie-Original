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

  const [aiRecommendations, setAiRecommendations] = useState(null);
  const [aiTasteProfile, setAiTasteProfile] = useState(null);

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
