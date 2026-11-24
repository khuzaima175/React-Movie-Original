import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "../context/AppContext";
import VaultBanner from "../components/VaultBanner";
import VaultBulkBar from "../components/VaultBulkBar";
import VaultListsPanel from "../components/VaultListsPanel";
import SampleVaultBanner from "../components/SampleVaultBanner";
import MovieCard from "../components/MovieCard";
import WatchedMoviesList from "../components/WatchedMoviesList";
import ToastNotification from "../components/ToastNotification";
import QuickRateModal from "../components/QuickRateModal";
import { CANON_CHECKLISTS } from "../services/listsService";
import { buildBulkMoveWatchedItem } from "../services/csvImport";
import { Bookmark, Film, Compass, Search, Upload } from "lucide-react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function VaultPage({ onOpenBackup, onOpenCloudSync }) {
  useDocumentTitle("My Vault");
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    watched = [],
    watchlist = [],
    customLists = [],
    addWatched,
    deleteWatched,
    deleteWatchlist,
    addToWatchlist,
    hasCloudConfig,
    cloudUser,
    cloudSyncStatus,
    loadSampleVault
  } = useApp();
  const canTrySampleVault = !cloudUser && watched.length < 3;

  const resolveInitialTab = (raw) =>
    raw === "watchlist" || raw === "lists" || raw === "checklists" ? raw : "watched";

  const [activeTab, setActiveTab] = useState(() => resolveInitialTab(searchParams.get("tab")));
  const [selectedListId, setSelectedListId] = useState(() => searchParams.get("list") || null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("input");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [selectedRating, setSelectedRating] = useState(null);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  const [isManageMode, setIsManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [quickAddMovie, setQuickAddMovie] = useState(null);
  const [toast, setToast] = useState(null);
  const getInitialGridBatch = () =>
    typeof window !== "undefined" && window.innerWidth <= 900 ? 36 : 60;
  const [visibleGridCount, setVisibleGridCount] = useState(getInitialGridBatch);
  const loadMoreSentinelRef = useRef(null);

  // Sync tab if URL param changes
  useEffect(() => {
    const paramTab = searchParams.get("tab");
    if (paramTab) {
      setActiveTab(resolveInitialTab(paramTab));
    }
    const listParam = searchParams.get("list");
    if (listParam !== selectedListId) {
      setSelectedListId(listParam || null);
    }
  }, [searchParams, selectedListId]);

  function handleTabChange(newTab) {
    setActiveTab(newTab);
    setSelectedIds([]);
    setSelectedRating(null);
    setIsManageMode(false);
    setSelectedListId(null);
    setSearchParams({ tab: newTab });
  }

  function handleSelectListId(listId) {
    setSelectedListId(listId || null);
    if (listId) {
      setActiveTab("lists");
      setSearchParams({ tab: "lists", list: listId });
    } else {
      setSearchParams({ tab: activeTab });
    }
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

    // Interactive Rating Sparkline Filter
    if (activeTab === "watched" && selectedRating !== null) {
      result = result.filter((m) => Math.round(Number(m.userRating)) === selectedRating);
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
  }, [currentList, searchQuery, selectedGenre, sortBy, activeTab, selectedRating]);

  useEffect(() => {
    setVisibleGridCount(getInitialGridBatch());
  }, [activeTab, searchQuery, selectedGenre, selectedRating, sortBy]);

  const visibleGridItems = useMemo(
    () => (viewMode === "grid" ? filtered.slice(0, visibleGridCount) : filtered),
    [filtered, viewMode, visibleGridCount]
  );

  const hasMoreGridItems = viewMode === "grid" && visibleGridCount < filtered.length;

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!hasMoreGridItems || !sentinel || typeof window.IntersectionObserver !== "function") {
      return undefined;
    }
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleGridCount((c) => c + 36);
        }
      },
      { rootMargin: "420px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreGridItems, visibleGridItems.length]);

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
      message: `${count} ${count === 1 ? "item" : "items"} removed from ${
        activeTab === "watched" ? "Vault" : "Watchlist"
      }`,
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
        addWatched(buildBulkMoveWatchedItem(item));
        deleteWatchlist(id);
      }
    });

    setToast({
      message: `Moved ${count} ${count === 1 ? "item" : "items"} to ${
        activeTab === "watched" ? "Watchlist" : "Watched"
      }`,
      item: null,
      tab: activeTab,
    });

    setSelectedIds([]);
    setIsManageMode(false);
  }

  return (
    <div className="vault-page-container page-rail">
      {/* ── 1. Unified Cinematic Studio Hub (Header, Metrics, Insights Drawer, Tabs & Controls) ── */}
      <VaultBanner
        watched={watched}
        watchlist={watchlist}
        customListsCount={customLists.length}
        checklistsCount={CANON_CHECKLISTS.length}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isManageMode={isManageMode}
        onToggleManageMode={() => {
          setIsManageMode((prev) => !prev);
          setSelectedIds([]);
        }}
        onOpenBackup={onOpenBackup}
        onOpenCloudSync={onOpenCloudSync}
        hasCloudConfig={hasCloudConfig}
        cloudUser={cloudUser}
        cloudSyncStatus={cloudSyncStatus}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedGenre={selectedGenre}
        onGenreSelect={setSelectedGenre}
        selectedRating={selectedRating}
        onSelectRating={(score) => setSelectedRating((prev) => (prev === score ? null : score))}
        genresList={genresList}
        sortBy={sortBy}
        onSortChange={setSortBy}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filteredCount={filtered.length}
        totalCount={currentList.length}
      />

      <SampleVaultBanner onOpenImport={() => onOpenBackup?.("import")} />

      {/* ── 2. Main Collection Grid / List View ── */}
      <div className="vault-collection-body">
        {activeTab === "lists" || activeTab === "checklists" ? (
          <VaultListsPanel
            mode={activeTab}
            selectedListId={selectedListId}
            onSelectListId={handleSelectListId}
          />
        ) : filtered.length > 0 ? (
          <AnimatePresence mode="wait">
            {viewMode === "grid" ? (
              <motion.div
                key="vault-grid"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                <div className="vault-grid">
                  {visibleGridItems.map((movie, idx) => {
                    const id = movie.imdbID || movie.id;
                    const isSelected = selectedIds.includes(id);

                    return (
                      <MovieCard
                        key={id}
                        movie={movie}
                        animateOnScroll={true}
                        revealIndex={idx}
                        onSelectMovie={handleSelectMovie}
                        onDeleteMovie={handleDeleteSingle}
                        onQuickAdd={activeTab === "watchlist" ? setQuickAddMovie : null}
                        onAddWatched={activeTab === "watchlist" ? addWatched : null}
                        isWatched={activeTab === "watched"}
                        isManageMode={isManageMode}
                        isSelected={isSelected}
                        onToggleSelect={handleToggleSelect}
                        showCaption={true}
                      />
                    );
                  })}
                </div>
                {hasMoreGridItems && (
                  <div
                    ref={loadMoreSentinelRef}
                    className="flex justify-center pt-6"
                  >
                    <button
                      type="button"
                      className="btn-clear-filters-cta"
                      onClick={() => setVisibleGridCount((c) => c + 36)}
                    >
                      Show more ({filtered.length - visibleGridCount} remaining)
                    </button>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="vault-list"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                <WatchedMoviesList
                  watched={filtered}
                  onDeleteWatched={handleDeleteSingle}
                  onSelectMovie={handleSelectMovie}
                  isManageMode={isManageMode}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
                />
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          /* Empty States */
          <div className="vault-empty-wrapper">
            {currentList.length === 0 ? (
              activeTab === "watchlist" ? (
                <div className="watchlist-empty-card">
                  <Bookmark size={32} className="empty-icon-quiet" aria-hidden="true" />
                  <h3>Your Watchlist is Empty</h3>
                  <p>Bookmark upcoming films from Discover or Search to queue them here.</p>
                  <button type="button" className="btn-empty-cta" onClick={() => navigate("/")}>
                    <Compass size={16} aria-hidden="true" /> Discover Films
                  </button>
                </div>
              ) : (
                <div className="watched-empty-card">
                  <Film size={32} className="empty-icon-quiet" aria-hidden="true" />
                  <h3>Your Vault is Empty</h3>
                  <p>
                    Rate films you have watched or import your Letterboxd / IMDb history to unlock taste insights and recommendations.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {onOpenBackup && (
                      <button
                        type="button"
                        className="btn-empty-cta"
                        onClick={() => onOpenBackup("import")}
                      >
                        <Upload size={16} aria-hidden="true" /> Import Letterboxd / IMDb CSV
                      </button>
                    )}
                    <button type="button" className="btn-empty-cta" onClick={() => navigate("/")}>
                      <Compass size={16} aria-hidden="true" /> Explore Movies
                    </button>
                    {canTrySampleVault && (
                      <button
                        type="button"
                        className="btn-empty-cta"
                        onClick={() => loadSampleVault()}
                      >
                        Try a sample vault
                      </button>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="filter-empty-card">
                <Search size={32} className="empty-icon-quiet" aria-hidden="true" />
                <h3>No films match your filters</h3>
                <p>Try clearing your search query or switching back to all genres.</p>
                <button
                  type="button"
                  className="btn-clear-filters-cta"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedGenre("All");
                    setSelectedRating(null);
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
      <QuickRateModal
        movie={quickAddMovie}
        watched={watched}
        watchlist={watchlist}
        onClose={() => setQuickAddMovie(null)}
        onSaveWatched={addWatched}
      />

      <ToastNotification
        toast={toast}
        onUndo={handleUndo}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
