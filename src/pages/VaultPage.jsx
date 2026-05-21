import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import WatchedSummary from "../components/WatchedSummary";
import WatchedMoviesList from "../components/WatchedMoviesList";
import RandomPicker from "../components/RandomPicker";
import EmptyState from "../components/EmptyState";
import BackupManagerModal from "../components/BackupManagerModal";

export default function VaultPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { watched, watchlist, deleteWatched, deleteWatchlist } = useApp();

  const [activeTab, setActiveTab] = useState(
    searchParams.get("tab") === "watchlist" ? "watchlist" : "watched"
  );
  const [sortBy, setSortBy] = useState("input");
  const [isBackupOpen, setIsBackupOpen] = useState(false);

  // Sync tab if URL param changes
  useEffect(() => {
    if (searchParams.get("tab") === "watchlist") setActiveTab("watchlist");
  }, [searchParams]);

  let watchedSorted = watched;
  if (sortBy === "rating") watchedSorted = [...watched].sort((a, b) => b.imdbRating - a.imdbRating);
  if (sortBy === "userRating") watchedSorted = [...watched].sort((a, b) => b.userRating - a.userRating);
  if (sortBy === "runtime") watchedSorted = [...watched].sort((a, b) => a.runtime - b.runtime);

  function handleSelectMovie(id) {
    navigate(`/movie/${id}`);
  }

  return (
    <div className="vault-page">
      {/* ── Header ── */}
      <div className="vault-header">
        <div className="vault-header-text">
          <h1 className="vault-header-title">My Vault</h1>
          <p className="vault-header-meta">
            {watched.length} films watched · {watchlist.length} on your list
          </p>
        </div>
        <div className="vault-header-actions">
          <button
            className="vault-settings-btn"
            onClick={() => setIsBackupOpen(true)}
            title="Backup & Portability"
          >
            ⚙️ Manage Vault
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

      {/* ── Body ── */}
      <div className="vault-body">
        {activeTab === "watched" && (
          <>
            {/* Stats strip — replaces WatchedSummary which is now too small */}
            <WatchedSummary watched={watched} />

            <div className="vault-sort-row">
              <span className="vault-sort-label">
                {watched.length} {watched.length === 1 ? "film" : "films"}
              </span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
              >
                <option value="input">Input order</option>
                <option value="rating">IMDb rating</option>
                <option value="userRating">Your rating</option>
                <option value="runtime">Runtime</option>
              </select>
            </div>

            {watched.length > 0 ? (
              <WatchedMoviesList
                watched={watchedSorted}
                onDeleteWatched={deleteWatched}
                onSelectMovie={handleSelectMovie}
              />
            ) : (
              <EmptyState
                message="No movies yet. Search and rate movies to fill your vault!"
                icon="📽️"
              />
            )}
          </>
        )}

        {activeTab === "watchlist" && (
          <>
            <RandomPicker watchlist={watchlist} onSelectMovie={handleSelectMovie} />
            <div className="vault-sort-row">
              <span className="vault-sort-label">
                {watchlist.length} {watchlist.length === 1 ? "title" : "titles"} queued
              </span>
            </div>
            {watchlist.length > 0 ? (
              <WatchedMoviesList
                watched={watchlist}
                onDeleteWatched={deleteWatchlist}
                onSelectMovie={handleSelectMovie}
              />
            ) : (
              <EmptyState message="Your watchlist is empty." icon="📋" />
            )}
          </>
        )}
      </div>
      <BackupManagerModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
      />
    </div>
  );
}
