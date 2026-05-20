import { useState, useEffect } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useDebounce } from "../hooks/useDebounce";
import Search from "../components/Search";
import NumResults from "../components/NumResults";
import MovieList from "../components/MovieList";
import EmptyState from "../components/EmptyState";
import ErrorMessage from "../components/ErrorMessage";
import { MovieListSkeleton } from "../components/Loader";
import WatchedSummary from "../components/WatchedSummary";
import WatchedMoviesList from "../components/WatchedMoviesList";

const getOmdbKey = () => {
    const key = import.meta.env.VITE_OMDB_KEY;
    if (!key || key === "undefined" || key === "null" || key.trim() === "") {
        return "b78bdecd";
    }
    return key.trim();
};
const KEY = getOmdbKey();

export default function DashboardPage() {
  const navigate = useNavigate();
  const { 
    watched, 
    watchlist, 
    deleteWatched,
    searchQuery: query,
    setSearchQuery: setQuery,
    searchType: type,
    setSearchType: setType
  } = useApp();

  const [movies, setMovies] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState("input");

  const debouncedQuery = useDebounce(query, 500);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchMovies() {
      try {
        setIsLoading(true);
        setError("");
        
        let res = await fetch(
          `https://www.omdbapi.com/?apikey=${KEY}&s=${debouncedQuery}${type ? `&type=${type}` : ""}`,
          { signal: controller.signal }
        );
        
        // Handle 401 Unauthorized or general network response failure by retrying with default key
        if (!res.ok || res.status === 401) {
          if (KEY !== "b78bdecd") {
            console.log("⚠️ Configured OMDb key failed, retrying search with default fallback key...");
            res = await fetch(
              `https://www.omdbapi.com/?apikey=b78bdecd&s=${debouncedQuery}${type ? `&type=${type}` : ""}`,
              { signal: controller.signal }
            );
          }
        }
        
        if (!res.ok) throw new Error("Something went wrong fetching movies");
        
        const data = await res.json();
        
        if (data.Response === "False") {
          // If the OMDb response explicitly indicates a key authorization issue
          if (data.Error && (data.Error.includes("key") || data.Error.includes("credential")) && KEY !== "b78bdecd") {
            console.log("⚠️ OMDb response reports key error, retrying search with default fallback key...");
            const fallbackRes = await fetch(
              `https://www.omdbapi.com/?apikey=b78bdecd&s=${debouncedQuery}${type ? `&type=${type}` : ""}`,
              { signal: controller.signal }
            );
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              if (fallbackData.Response === "False") throw new Error(fallbackData.Error || "Movie not found");
              setMovies(fallbackData.Search || []);
              setError("");
              return;
            }
          }
          throw new Error(data.Error || "Movie not found");
        }
        
        setMovies(data.Search || []);
        setError("");
      } catch (err) {
        if (err.name !== "AbortError") {
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

    fetchMovies();
    return () => controller.abort();
  }, [debouncedQuery, type]);

  // Clicking a movie navigates to its dedicated page
  function handleSelectMovie(id) {
    navigate(`/movie/${id}`);
  }

  let watchedSorted = watched;
  if (sortBy === "rating") watchedSorted = [...watched].sort((a, b) => b.imdbRating - a.imdbRating);
  if (sortBy === "userRating") watchedSorted = [...watched].sort((a, b) => b.userRating - a.userRating);
  if (sortBy === "runtime") watchedSorted = [...watched].sort((a, b) => a.runtime - b.runtime);

  return (
    <div className="dashboard-layout">
      {/* ── Hero / Search ── */}
      <div className="dashboard-hero compact">
        <div className="dashboard-search-wrap">
          <Search query={query} setQuery={setQuery} type={type} setType={setType} />
          <NumResults movies={movies} />
        </div>
      </div>

      {/* ── Two panels ── */}
      <div className="dashboard-panels">
        {/* LEFT — Results */}
        <div className="dashboard-panel">
          <div className="panel-header">
            <span className="panel-title">
              {movies.length > 0 ? `${movies.length} Results` : "Browse"}
            </span>
            {movies.length > 0 && (
              <span className="panel-title" style={{ fontStyle: "italic", textTransform: "none", letterSpacing: 0 }}>
                click to rate
              </span>
            )}
          </div>
          <div className="box-content">
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
          </div>
        </div>

        {/* RIGHT — Vault preview */}
        <div className="dashboard-panel">
          <div className="panel-header">
            <span className="panel-title">Your Vault</span>
            <NavLink to="/vault" className="panel-action-link">
              View all →
            </NavLink>
          </div>
          <div className="box-content">
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
              <WatchedMoviesList watched={watchedSorted} onDeleteWatched={deleteWatched} />
            ) : (
              <EmptyState
                message="Click any movie to rate it and fill your vault!"
                icon="📽️"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
