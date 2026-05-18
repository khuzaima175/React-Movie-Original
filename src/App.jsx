import { useState, useEffect } from "react";
import NavBar from "./components/NavBar";
import Search from "./components/Search";
import NumResults from "./components/NumResults";
import Main from "./components/Main";
import Box from "./components/Box";
import MovieList from "./components/MovieList";
import MovieDetails from "./components/MovieDetails";
import WatchedSummary from "./components/WatchedSummary";
import WatchedMoviesList from "./components/WatchedMoviesList";
import { MovieListSkeleton } from "./components/Loader";
import ErrorMessage from "./components/ErrorMessage";
import EmptyState from "./components/EmptyState";
import RandomPicker from "./components/RandomPicker";
import MovieRecommendations from "./components/MovieRecommendations";
import AIChat from "./components/AIChat";
import AnimatedBackground from "./components/AnimatedBackground";
import { useDebounce } from "./hooks/useDebounce";

const KEY = import.meta.env.VITE_OMDB_KEY || "b78bdecd";

export default function App() {
  const [movies, setMovies] = useState([]);
  const [watched, setWatched] = useState(() => {
    // Load watched movies from localStorage on initial render
    const savedWatched = localStorage.getItem("watchedMovies");
    return savedWatched ? JSON.parse(savedWatched) : [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem("watchlist");
    return saved ? JSON.parse(saved) : [];
  });
  const [activeTab, setActiveTab] = useState("watched"); // 'watched' or 'watchlist'
  const [sortBy, setSortBy] = useState("input");
  const [type, setType] = useState(""); // '' for all, 'movie', 'series'

  // AI Recommendations state (persists across tab switches)
  const [aiRecommendations, setAiRecommendations] = useState(null);
  const [aiTasteProfile, setAiTasteProfile] = useState(null);

  const debouncedQuery = useDebounce(query, 500);

  // Save watched movies to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("watchedMovies", JSON.stringify(watched));
  }, [watched]);

  useEffect(() => {
    localStorage.setItem("watchlist", JSON.stringify(watchlist));
  }, [watchlist]);

  function handleSelectMovie(id) {
    setSelectedId((selectedId) => (selectedId === id ? null : id));
  }

  function handleCloseMovie() {
    setSelectedId(null);
  }

  function handleAddWatched(movie) {
    // Prevent duplicates
    const isAlreadyWatched = watched.some(m => m.imdbID === movie.imdbID);
    if (!isAlreadyWatched) {
      setWatched((watched) => [...watched, movie]);
      // Remove from watchlist if it's there
      setWatchlist((list) => list.filter((m) => m.imdbID !== movie.imdbID));
      setActiveTab("watched"); // Switch to watched view
    }
  }

  function handleAddToWatchlist(movie) {
    const isAlreadyInWatchlist = watchlist.some(m => m.imdbID === movie.imdbID);
    if (!isAlreadyInWatchlist) {
      setWatchlist((list) => [...list, movie]);
      setActiveTab("watchlist"); // Switch to watchlist view
    }
  }

  function handleDeleteWatched(id) {
    setWatched((watched) => watched.filter((movie) => movie.imdbID !== id));
  }

  function handleDeleteWatchlist(id) {
    setWatchlist((list) => list.filter((movie) => movie.imdbID !== id));
  }

  useEffect(
    function () {
      const controller = new AbortController();

      async function fetchMovies() {
        try {
          setIsLoading(true);
          setError("");

          const res = await fetch(
            `https://www.omdbapi.com/?apikey=${KEY}&s=${debouncedQuery}${type ? `&type=${type}` : ''}`,
            { signal: controller.signal }
          );

          if (!res.ok)
            throw new Error("Something went wrong fetching movies");

          const data = await res.json();

          if (data.Response === "False") throw new Error("Movie not found");

          setMovies(data.Search);
          setError("");
        } catch (err) {
          if (err.name !== "AbortError") {
            console.error(err.message);
            setError(err.message);
          }
        } finally {
          setIsLoading(false);
        }
      }

      if (debouncedQuery.length < 3) {
        setMovies([]);
        setError("");
        return;
      }

      handleCloseMovie();
      fetchMovies();

      return function () {
        controller.abort();
      };
    },
    [debouncedQuery, type]
  );

  let watchedSorted;
  if (sortBy === "input") watchedSorted = watched;
  if (sortBy === "rating")
    watchedSorted = [...watched].sort((a, b) => b.imdbRating - a.imdbRating);
  if (sortBy === "userRating")
    watchedSorted = [...watched].sort((a, b) => b.userRating - a.userRating);
  if (sortBy === "runtime")
    watchedSorted = [...watched].sort((a, b) => a.runtime - b.runtime);

  return (
    <>
      <AnimatedBackground />
      <NavBar>
        <Search query={query} setQuery={setQuery} type={type} setType={setType} />
        <NumResults movies={movies} />
      </NavBar>

      <Main>
        <Box>
          {isLoading && <MovieListSkeleton />}
          {!isLoading && !error && movies.length > 0 && (
            <MovieList movies={movies} onSelectMovie={handleSelectMovie} />
          )}
          {!isLoading && !error && movies.length === 0 && !debouncedQuery && (
            <EmptyState
              message="Search for a movie to get started"
              icon="🍿"
              onSearch={setQuery}
            />
          )}
          {error && <ErrorMessage message={error} />}
        </Box>

        <Box>
          {selectedId ? (
            <MovieDetails
              selectedId={selectedId}
              onCloseMovie={handleCloseMovie}
              onAddWatched={handleAddWatched}
              onAddToWatchlist={handleAddToWatchlist}
              watched={watched}
              watchlist={watchlist}
            />
          ) : (
            <>
              <div className="tab-container">
                <button
                  className={`btn-tab ${activeTab === "watched" ? "active" : ""}`}
                  onClick={() => setActiveTab("watched")}
                >
                  Watched
                </button>
                <button
                  className={`btn-tab ${activeTab === "watchlist" ? "active" : ""}`}
                  onClick={() => setActiveTab("watchlist")}
                >
                  Plan to Watch
                </button>
                <button
                  className={`btn-tab ${activeTab === "ai" ? "active" : ""}`}
                  onClick={() => setActiveTab("ai")}
                >
                  🤖 AI Picks
                </button>
                <button
                  className={`btn-tab ${activeTab === "chat" ? "active" : ""}`}
                  onClick={() => setActiveTab("chat")}
                >
                  💬 Chat
                </button>
              </div>

              {activeTab === "watched" && (
                <>
                  <WatchedSummary watched={watched} />
                  <div className="sort-container">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="sort-select"
                    >
                      <option value="input">Sort by input order</option>
                      <option value="rating">Sort by IMDb rating</option>
                      <option value="userRating">Sort by user rating</option>
                      <option value="runtime">Sort by runtime</option>
                    </select>
                  </div>
                  {watched.length > 0 ? (
                    <WatchedMoviesList
                      watched={watchedSorted}
                      onDeleteWatched={handleDeleteWatched}
                    />
                  ) : (
                    <EmptyState
                      message="No movies in your watched list yet. Search and rate movies to add them!"
                      icon="📽️"
                    />
                  )}
                </>
              )}

              {activeTab === "watchlist" && (
                <>
                  <RandomPicker watchlist={watchlist} onSelectMovie={handleSelectMovie} />
                  <p className="watchlist-count">
                    {watchlist.length} {watchlist.length === 1 ? "title" : "titles"} in your watchlist
                  </p>
                  {watchlist.length > 0 ? (
                    <WatchedMoviesList
                      watched={watchlist}
                      onDeleteWatched={handleDeleteWatchlist}
                    />
                  ) : (
                    <EmptyState
                      message="Your watchlist is empty."
                      icon="📋"
                    />
                  )}
                </>
              )}

              {activeTab === "ai" && (
                <MovieRecommendations
                  watched={watched}
                  onAddToWatchlist={handleAddToWatchlist}
                  watchlist={watchlist}
                  recommendations={aiRecommendations}
                  setRecommendations={setAiRecommendations}
                  tasteProfile={aiTasteProfile}
                  setTasteProfile={setAiTasteProfile}
                />
              )}

              {activeTab === "chat" && (
                <AIChat watched={watched} />
              )}
            </>
          )}
        </Box>
      </Main>
    </>
  );
}