import { createContext, useContext, useState, useEffect } from "react";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [watched, setWatched] = useState(() => {
    const saved = localStorage.getItem("watchedMovies");
    return saved ? JSON.parse(saved) : [];
  });

  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem("watchlist");
    return saved ? JSON.parse(saved) : [];
  });

  const [aiRecommendations, setAiRecommendations] = useState(null);
  const [aiTasteProfile, setAiTasteProfile] = useState(null);

  useEffect(() => {
    localStorage.setItem("watchedMovies", JSON.stringify(watched));
  }, [watched]);

  useEffect(() => {
    localStorage.setItem("watchlist", JSON.stringify(watchlist));
  }, [watchlist]);

  function addWatched(movie) {
    if (watched.some((m) => m.imdbID === movie.imdbID)) return;
    setWatched((prev) => [...prev, movie]);
    setWatchlist((prev) => prev.filter((m) => m.imdbID !== movie.imdbID));
  }

  function deleteWatched(id) {
    setWatched((prev) => prev.filter((m) => m.imdbID !== id));
  }

  function addToWatchlist(movie) {
    if (watchlist.some((m) => m.imdbID === movie.imdbID)) return;
    setWatchlist((prev) => [...prev, movie]);
  }

  function deleteWatchlist(id) {
    setWatchlist((prev) => prev.filter((m) => m.imdbID !== id));
  }

  return (
    <AppContext.Provider
      value={{
        watched, watchlist,
        addWatched, deleteWatched,
        addToWatchlist, deleteWatchlist,
        aiRecommendations, setAiRecommendations,
        aiTasteProfile, setAiTasteProfile,
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
