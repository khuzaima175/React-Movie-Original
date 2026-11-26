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
import {
  YEARLY_GOAL_STORAGE_KEY,
  buildMonthlyDiaryGroups,
  computeYearlyDiaryStats,
  normalizeWatchHistory
} from "../services/diaryService";
import PosterImage from "../components/PosterImage";
import { Bookmark, Calendar, Film, Compass, RotateCcw, Search, Star, Upload } from "lucide-react";
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
    raw === "watchlist" || raw === "lists" || raw === "checklists" || raw === "diary" ? raw : "watched";

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
  const currentYear = new Date().getFullYear();
  const [diaryYear, setDiaryYear] = useState(currentYear);
  const diaryYearChoices = useMemo(() => {
    const years = new Set([currentYear]);
    for (const movie of Array.isArray(watched) ? watched : []) {
      for (const entry of normalizeWatchHistory(movie)) {
        const yr = Number(String(entry.watchedAt || "").slice(0, 4));
        if (Number.isInteger(yr) && yr >= 1970 && yr <= currentYear + 1) {
          years.add(yr);
        }
      }
    }
    return [...years].sort((a, b) => b - a).slice(0, 8);
  }, [watched, currentYear]);
  const [yearlyGoal, setYearlyGoal] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(YEARLY_GOAL_STORAGE_KEY));
      return Number.isFinite(saved) && saved > 0 ? saved : 50;
    } catch {
      return 50;
    }
  });
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(String(yearlyGoal));
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
        {activeTab === "diary" ? (
          (() => {
            const yearStats = computeYearlyDiaryStats(watched, diaryYear);
            const monthGroups = buildMonthlyDiaryGroups(watched, { year: diaryYear });
            const goalPct = yearlyGoal > 0 ? Math.min(100, Math.round((yearStats.count / yearlyGoal) * 100)) : 0;
            const yearChoices = diaryYearChoices;

            return (
              <section className="flex flex-col gap-6" aria-label="Chronological Watch Diary">
                <div className="rounded-[var(--r-xl)] border border-[var(--hairline-strong)] bg-[var(--surface-1)] p-5 sm:p-6 flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <span className="text-[1.15rem] uppercase tracking-[0.12em] font-semibold text-amber-300">
                        {diaryYear} Watch Goal
                      </span>
                      <h2 className="m-0 mt-1 text-[2.2rem] font-semibold text-[var(--text-1)] tabular-num">
                        {yearStats.count} / {yearlyGoal} films{" "}
                        <span className="text-[1.45rem] font-normal text-[var(--text-2)]">({goalPct}%)</span>
                      </h2>
                      <p className="m-0 mt-1 text-[1.3rem] text-[var(--text-3)] tabular-num">
                        {Math.round(yearStats.totalMinutes / 60)}h watched · {yearStats.rewatchCount} rewatches
                        {yearStats.avgRating ? ` · ${yearStats.avgRating}/10 avg` : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="together-role-toggle flex-wrap" role="group" aria-label="Filter diary year">
                        {yearChoices.map((yr) => (
                          <button
                            key={yr}
                            type="button"
                            className={diaryYear === yr ? "is-active" : ""}
                            onClick={() => setDiaryYear(yr)}
                          >
                            {yr}
                          </button>
                        ))}
                      </div>

                      {!isEditingGoal ? (
                        <button
                          type="button"
                          onClick={() => {
                            setGoalDraft(String(yearlyGoal));
                            setIsEditingGoal(true);
                          }}
                          className="px-3 py-1.5 rounded-[var(--r-md)] border border-[var(--hairline-strong)] bg-[var(--surface-2)] text-[1.25rem] text-[var(--text-1)] cursor-pointer"
                        >
                          Edit Goal
                        </button>
                      ) : (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const parsed = Math.max(1, Math.min(1000, Math.round(Number(goalDraft) || 50)));
                            setYearlyGoal(parsed);
                            setIsEditingGoal(false);
                            try {
                              localStorage.setItem(YEARLY_GOAL_STORAGE_KEY, String(parsed));
                            } catch {
                              // ignore storage errors
                            }
                          }}
                        >
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={goalDraft}
                            onChange={(e) => setGoalDraft(e.target.value)}
                            aria-label="Yearly film goal"
                            className="w-[7rem] px-2.5 py-1 rounded-[var(--r-sm)] bg-[var(--surface-2)] border border-[var(--hairline-strong)] text-[1.3rem] text-[var(--text-1)]"
                          />
                          <button
                            type="submit"
                            className="px-3 py-1 rounded-[var(--r-sm)] bg-amber-400/20 border border-amber-400/40 text-amber-200 text-[1.25rem] font-semibold cursor-pointer"
                          >
                            Save
                          </button>
                        </form>
                      )}
                    </div>
                  </div>

                  <div className="w-full h-[0.7rem] rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all duration-300"
                      style={{ width: `${goalPct}%` }}
                    />
                  </div>
                </div>

                {monthGroups.length === 0 ? (
                  <div className="watched-empty-card">
                    <Calendar size={30} className="empty-icon-quiet" aria-hidden="true" />
                    <h3>No dated watches logged in {diaryYear}</h3>
                    <p>Rate any film or click &ldquo;Log Rewatch&rdquo; on a film page to build your chronological diary.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    {monthGroups.map((group) => (
                      <div key={group.monthKey} className="flex flex-col gap-3">
                        <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2">
                          <h3 className="m-0 text-[1.65rem] font-semibold text-[var(--text-1)]">
                            {group.monthLabel}
                          </h3>
                          <span className="text-[1.25rem] text-[var(--text-3)] tabular-num">
                            {group.entries.length} {group.entries.length === 1 ? "watch" : "watches"}
                          </span>
                        </div>

                        <div className="flex flex-col gap-2">
                          {group.entries.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => entry.movieId && handleSelectMovie(entry.movieId)}
                              className="flex items-center justify-between gap-4 p-3 rounded-[var(--r-lg)] border border-[var(--hairline)] bg-[var(--surface-1)] hover:border-[var(--hairline-strong)] text-left cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-3.5 min-w-0">
                                <span className="w-[4.6rem] text-[1.25rem] font-semibold text-[var(--text-3)] tabular-num shrink-0">
                                  {entry.watchedAt.slice(5, 10)}
                                </span>
                                <div className="w-[3.4rem] h-[5rem] rounded-[0.4rem] overflow-hidden bg-[var(--surface-2)] shrink-0">
                                  <PosterImage src={entry.poster} title={entry.title} />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <strong className="text-[1.45rem] text-[var(--text-1)] truncate">
                                      {entry.title}
                                    </strong>
                                    {entry.year && (
                                      <span className="text-[1.25rem] text-[var(--text-3)]">{entry.year}</span>
                                    )}
                                    {entry.isRewatch && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] text-[1.1rem] text-[var(--text-2)]">
                                        <RotateCcw size={10} aria-hidden="true" />
                                        Rewatch
                                      </span>
                                    )}
                                  </div>
                                  {entry.note && (
                                    <p className="m-0 mt-0.5 text-[1.25rem] text-[var(--text-2)] truncate max-w-[56rem]">
                                      {entry.note}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                {entry.format && entry.format !== "streaming" && (
                                  <span className="text-[1.15rem] uppercase tracking-wider text-[var(--text-3)] hidden sm:inline">
                                    {entry.format}
                                  </span>
                                )}
                                {entry.rating && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-200 text-[1.25rem] font-semibold tabular-num">
                                    <Star size={11} fill="currentColor" aria-hidden="true" />
                                    {entry.rating}/10
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })()
        ) : activeTab === "lists" || activeTab === "checklists" ? (
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
