import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import VaultBanner from "../components/VaultBanner";
import VaultBulkBar from "../components/VaultBulkBar";
import MovieCard from "../components/MovieCard";
import WatchedMoviesList from "../components/WatchedMoviesList";
import EmptyState from "../components/EmptyState";
import BackupManagerModal from "../components/BackupManagerModal";
import ToastNotification from "../components/ToastNotification";
import { Bookmark, Sparkles, Compass } from "lucide-react";

export default function VaultPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { watched = [], watchlist = [], addWatched, deleteWatched, deleteWatchlist, addToWatchlist } = useApp();

  const [activeTab, setActiveTab] = useState(
    searchParams.get("tab") === "watchlist" ? "watchlist" : "watched"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("input");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  const [isManageMode, setIsManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Sync tab if URL param changes
  useEffect(() => {
    if (searchParams.get("tab") === "watchlist") {
      setActiveTab("watchlist");
    } else if (searchParams.get("tab") === "watched") {
      setActiveTab("watched");
    }
  }, [searchParams]);

  function handleTabChange(newTab) {
    setActiveTab(newTab);
    setSelectedIds([]);
    setIsManageMode(false);
    setSearchParams({ tab: newTab });
  }

  // Active dataset
  const currentList = activeTab === "watched" ? watched : watchlist;

  // Extract unique genres for filter chips
  const genresList = useMemo(() => {
    const set = new Set(["All"]);
    currentList.forEach((m) => {
      if (m.genre) {
        m.genre.split(",").forEach((g) => set.add(g.trim()));
      }
    });
    return Array.from(set).slice(0, 9);
  }, [currentList]);

  // Search & Filter
  const filtered = useMemo(() => {
    let result = currentList;

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (m) =>
          (m.title || m.Title || "").toLowerCase().includes(q) ||
          (m.genre || "").toLowerCase().includes(q) ||
          (m.director || "").toLowerCase().includes(q)
      );
    }

    // Genre filter
    if (selectedGenre !== "All") {
      result = result.filter((m) => m.genre && m.genre.includes(selectedGenre));
    }

    // Sorting
    const sorted = [...result];
    if (sortBy === "rating") {
      sorted.sort((a, b) => (Number(b.imdbRating) || 0) - (Number(a.imdbRating) || 0));
    } else if (sortBy === "userRating") {
      sorted.sort((a, b) => (Number(b.userRating) || 0) - (Number(a.userRating) || 0));
    } else if (sortBy === "runtime") {
      sorted.sort((a, b) => (Number(parseInt(b.runtime)) || 0) - (Number(parseInt(a.runtime)) || 0));
    } else if (sortBy === "title") {
      sorted.sort((a, b) => (a.title || a.Title || "").localeCompare(b.title || b.Title || ""));
    }

    return sorted;
  }, [currentList, searchQuery, selectedGenre, sortBy]);

  function handleSelectMovie(id) {
    navigate(`/movie/${id}`);
  }

  function handleDeleteSingle(id) {
    const targetItem = currentList.find((m) => (m.imdbID || m.id) === id);
    if (!targetItem) return;

    if (activeTab === "watched") {
      deleteWatched(id);
    } else {
      deleteWatchlist(id);
    }

    setToast({
      title: targetItem.title || targetItem.Title,
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
      addToWatchlist(item);
    }
    setToast(null);
  }

  // ── Manage Vault Mode Bulk Operations ──
  function handleToggleSelect(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  function handleSelectAll() {
    setSelectedIds(filtered.map((m) => m.imdbID || m.id));
  }

  function handleDeselectAll() {
    setSelectedIds([]);
  }

  function handleBulkDelete() {
    if (selectedIds.length === 0) return;

    const count = selectedIds.length;
    selectedIds.forEach((id) => {
      if (activeTab === "watched") {
        deleteWatched(id);
      } else {
        deleteWatchlist(id);
      }
    });

    setToast({
      title: `${count} ${count === 1 ? "item" : "items"} removed`,
      item: null,
      tab: activeTab,
    });

    setSelectedIds([]);
    setIsManageMode(false);
  }

  function handleBulkMove() {
    if (selectedIds.length === 0) return;

    const count = selectedIds.length;
    selectedIds.forEach((id) => {
      const item = currentList.find((m) => (m.imdbID || m.id) === id);
      if (!item) return;

      if (activeTab === "watched") {
        // Move to watchlist
        addToWatchlist(item);
        deleteWatched(id);
      } else {
        // Move to watched
        addWatched(item);
        deleteWatchlist(id);
      }
    });

    setToast({
      title: `Moved ${count} ${count === 1 ? "item" : "items"} to ${
        activeTab === "watched" ? "Plan to Watch" : "Watched"
      }`,
      item: null,
      tab: activeTab,
    });

    setSelectedIds([]);
    setIsManageMode(false);
  }

  return (
    <div className="vault-page-container">
      {/* ── 1. Unified Cinematic Studio Hub (Header, Metrics, Insights Drawer, Tabs & Controls) ── */}
      <VaultBanner
        watched={watched}
        watchlist={watchlist}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isManageMode={isManageMode}
        onToggleManageMode={() => {
          setIsManageMode((prev) => !prev);
          setSelectedIds([]);
        }}
        onOpenBackup={() => setIsBackupOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedGenre={selectedGenre}
        onGenreSelect={setSelectedGenre}
        genresList={genresList}
        sortBy={sortBy}
        onSortChange={setSortBy}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filteredCount={filtered.length}
        totalCount={currentList.length}
      />

      {/* ── 2. Main Collection Grid / List View ── */}
      <div className="vault-collection-body">
        {filtered.length > 0 ? (
          viewMode === "grid" ? (
            <div className="vault-grid">
              {filtered.map((movie) => {
                const id = movie.imdbID || movie.id;
                const isSelected = selectedIds.includes(id);

                return (
                  <MovieCard
                    key={id}
                    movie={movie}
                    onSelectMovie={handleSelectMovie}
                    onDeleteMovie={handleDeleteSingle}
                    onAddWatched={activeTab === "watchlist" ? addWatched : null}
                    isWatched={activeTab === "watched"}
                    isManageMode={isManageMode}
                    isSelected={isSelected}
                    onToggleSelect={handleToggleSelect}
                  />
                );
              })}
            </div>
          ) : (
            <WatchedMoviesList
              watched={filtered}
              onDeleteWatched={handleDeleteSingle}
              onSelectMovie={handleSelectMovie}
              isManageMode={isManageMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
            />
          )
        ) : (
          /* Empty States */
          <div className="vault-empty-wrapper">
            {currentList.length === 0 ? (
              activeTab === "watchlist" ? (
                <div className="watchlist-empty-card">
                  <div className="empty-glow-ring">
                    <Bookmark size={32} className="cyan-icon" aria-hidden="true" />
                  </div>
                  <h3>Nothing Queued Yet</h3>
                  <p>Build your upcoming cinema watchlist — bookmark films from home or search.</p>
                  <button className="btn-empty-cta" onClick={() => navigate("/")}>
                    <Compass size={16} aria-hidden="true" /> Discover Films
                  </button>
                </div>
              ) : (
                <div className="watched-empty-card">
                  <div className="empty-glow-ring">
                    <Sparkles size={32} className="cyan-icon" aria-hidden="true" />
                  </div>
                  <h3>Your Vault is Empty</h3>
                  <p>Start rating movies and logging screen time to generate custom analytics & trivia.</p>
                  <button className="btn-empty-cta" onClick={() => navigate("/")}>
                    <Compass size={16} aria-hidden="true" /> Explore Movies
                  </button>
                </div>
              )
            ) : (
              <div className="filter-empty-card">
                <EmptyState message="No films match your search or genre filter." icon="🔍" />
                <button
                  className="btn-clear-filters-cta"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedGenre("All");
                  }}
                >
                  Reset Filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 5. Manage Vault Floating Bulk Bar ── */}
      {isManageMode && (
        <VaultBulkBar
          selectedCount={selectedIds.length}
          totalItemsCount={filtered.length}
          activeTab={activeTab}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onBulkDelete={handleBulkDelete}
          onBulkMove={handleBulkMove}
          onCancel={() => {
            setIsManageMode(false);
            setSelectedIds([]);
          }}
        />
      )}

      {/* ── 6. Modals & Toast Notifications ── */}
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
