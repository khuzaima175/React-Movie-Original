import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import VaultAnalyticsHeader from "../components/VaultAnalyticsHeader";
import MovieCard from "../components/MovieCard";
import WatchedMoviesList from "../components/WatchedMoviesList";
import RandomPicker from "../components/RandomPicker";
import EmptyState from "../components/EmptyState";
import BackupManagerModal from "../components/BackupManagerModal";
import ToastNotification from "../components/ToastNotification";
import { LayoutGrid, List, SlidersHorizontal, Settings } from "lucide-react";

export default function VaultPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { watched = [], watchlist = [], addWatched, deleteWatched, deleteWatchlist } = useApp();

  const [activeTab, setActiveTab] = useState(
    searchParams.get("tab") === "watchlist" ? "watchlist" : "watched"
  );
  const [sortBy, setSortBy] = useState("input");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Sync tab if URL param changes
  useEffect(() => {
    if (searchParams.get("tab") === "watchlist") setActiveTab("watchlist");
  }, [searchParams]);

  // Extract unique genres for filter chips
  const currentList = activeTab === "watched" ? watched : watchlist;
  const genresSet = new Set(["All"]);
  currentList.forEach((m) => {
    if (m.genre) {
      m.genre.split(",").forEach((g) => genresSet.add(g.trim()));
    }
  });
  const genresList = Array.from(genresSet).slice(0, 8);

  // Filter by genre
  let filtered = currentList.filter((m) => {
    if (selectedGenre === "All") return true;
    return m.genre && m.genre.includes(selectedGenre);
  });

  // Sort list
  if (sortBy === "rating") filtered = [...filtered].sort((a, b) => (Number(b.imdbRating) || 0) - (Number(a.imdbRating) || 0));
  if (sortBy === "userRating") filtered = [...filtered].sort((a, b) => (Number(b.userRating) || 0) - (Number(a.userRating) || 0));
  if (sortBy === "runtime") filtered = [...filtered].sort((a, b) => (Number(a.runtime) || 0) - (Number(b.runtime) || 0));
  if (sortBy === "title") filtered = [...filtered].sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  function handleSelectMovie(id) {
    navigate(`/movie/${id}`);
  }

  function handleDeleteItem(id) {
    const targetItem = currentList.find((m) => m.imdbID === id);
    if (!targetItem) return;

    if (activeTab === "watched") {
      deleteWatched(id);
    } else {
      deleteWatchlist(id);
    }

    setToast({
      title: targetItem.title,
      item: targetItem,
      tab: activeTab,
    });

    setTimeout(() => {
      setToast(null);
    }, 5000);
  }

  function handleUndo(item) {
    if (!item) return;
    if (toast?.tab === "watched") {
      addWatched(item);
    } else {
      // Re-add to watchlist
    }
    setToast(null);
  }

  return (
    <div className="vault-page">
      {/* ── Header ── */}
      <div className="vault-header">
        <div className="vault-header-text">
          <h1 className="vault-header-title">My Vault</h1>
          <p className="vault-header-meta">
            {watched.length} films watched · {watchlist.length} queued
          </p>
        </div>
        <div className="vault-header-actions">
          <button
            className="vault-settings-btn"
            onClick={() => setIsBackupOpen(true)}
            title="Backup & Portability"
          >
            <Settings size={16} aria-hidden="true" /> Manage Vault
          </button>
        </div>
      </div>

      {/* ── Tab row ── */}
      <div className="vault-tabs-row">
        <button
          className={`vault-tab ${activeTab === "watched" ? "active" : ""}`}
          onClick={() => setActiveTab("watched")}
        >
          🎬 Watched ({watched.length})
        </button>
        <button
          className={`vault-tab ${activeTab === "watchlist" ? "active" : ""}`}
          onClick={() => setActiveTab("watchlist")}
        >
          📋 Plan to Watch ({watchlist.length})
        </button>
      </div>

      {/* ── Analytics Dashboard Strip (For Watched tab) ── */}
      {activeTab === "watched" && <VaultAnalyticsHeader watched={watched} />}

      {/* ── Body ── */}
      <div className="vault-body">
        {/* ── Toolbar: Genre Filters & View Mode Controls ── */}
        <div className="vault-toolbar">
          <div className="vault-genre-chips">
            {genresList.map((genre) => (
              <button
                key={genre}
                className={`genre-chip ${selectedGenre === genre ? "active" : ""}`}
                onClick={() => setSelectedGenre(genre)}
              >
                {genre}
              </button>
            ))}
          </div>

          <div className="vault-toolbar-right">
            <div className="vault-sort-select-wrap">
              <SlidersHorizontal size={14} className="sort-icon" aria-hidden="true" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
                aria-label="Sort movies by"
              >
                <option value="input">Date Added</option>
                <option value="rating">IMDb Rating</option>
                <option value="userRating">Your Rating</option>
                <option value="runtime">Runtime</option>
                <option value="title">Title (A-Z)</option>
              </select>
            </div>

            <div className="vault-view-toggles">
              <button
                className={`btn-view-toggle ${viewMode === "grid" ? "active" : ""}`}
                onClick={() => setViewMode("grid")}
                title="Poster Grid View"
                aria-label="Grid view"
              >
                <LayoutGrid size={16} aria-hidden="true" />
              </button>
              <button
                className={`btn-view-toggle ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
                title="Compact List View"
                aria-label="List view"
              >
                <List size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Movie Content Render (Grid vs List) ── */}
        {activeTab === "watched" && (
          <>
            {filtered.length > 0 ? (
              viewMode === "grid" ? (
                <div className="vault-grid">
                  {filtered.map((movie) => (
                    <MovieCard
                      key={movie.imdbID || movie.id}
                      movie={movie}
                      onSelectMovie={handleSelectMovie}
                      onAddWatched={null}
                      isWatched={true}
                    />
                  ))}
                </div>
              ) : (
                <WatchedMoviesList
                  watched={filtered}
                  onDeleteWatched={handleDeleteItem}
                  onSelectMovie={handleSelectMovie}
                />
              )
            ) : (
              <EmptyState
                message="No movies found in your vault for this filter."
                icon="📽️"
              />
            )}
          </>
        )}

        {activeTab === "watchlist" && (
          <>
            <RandomPicker watchlist={watchlist} onSelectMovie={handleSelectMovie} />
            {filtered.length > 0 ? (
              viewMode === "grid" ? (
                <div className="vault-grid">
                  {filtered.map((movie) => (
                    <MovieCard
                      key={movie.imdbID || movie.id}
                      movie={movie}
                      onSelectMovie={handleSelectMovie}
                      onAddWatched={addWatched}
                      isWatched={false}
                    />
                  ))}
                </div>
              ) : (
                <WatchedMoviesList
                  watched={filtered}
                  onDeleteWatched={handleDeleteItem}
                  onSelectMovie={handleSelectMovie}
                />
              )
            ) : (
              <EmptyState message="Your watchlist is empty." icon="📋" />
            )}
          </>
        )}
      </div>

      {/* ── Modals & Toast ── */}
      <BackupManagerModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
      />

      <ToastNotification
        toast={toast}
        onUndo={handleUndo}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
