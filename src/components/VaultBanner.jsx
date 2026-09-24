import { useState } from "react";
import {
  Film,
  Bookmark,
  Sparkles,
  CheckSquare,
  XSquare,
  Settings,
  Search,
  X,
  SlidersHorizontal,
  LayoutGrid,
  List,
  ChevronDown,
  ChevronUp,
  Clock,
  Star,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function VaultBanner({
  watched = [],
  watchlist = [],
  activeTab = "watched",
  onTabChange,
  isManageMode = false,
  onToggleManageMode,
  onOpenBackup,
  searchQuery = "",
  onSearchChange,
  selectedGenre = "All",
  onGenreSelect,
  genresList = [],
  sortBy = "input",
  onSortChange,
  viewMode = "grid",
  onViewModeChange,
  filteredCount = 0,
  totalCount = 0,
}) {
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);

  // Background collage posters
  const collagePosters = watched
    .map((m) => m.poster || m.Poster)
    .filter((p) => p && p !== "N/A")
    .slice(0, 10);

  // Computed Cinema Metrics
  const totalMovies = watched.length;
  const totalMinutes = watched.reduce((acc, m) => {
    const r = parseInt(m.runtime, 10);
    return acc + (isNaN(r) ? 120 : r);
  }, 0);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;
  let timeString = "";
  if (days > 0) timeString += `${days}d `;
  timeString += `${hours}h ${mins}m`;

  const userRatings = watched.map((m) => Number(m.userRating) || Number(m.imdbRating) || 8).filter(Boolean);
  const imdbRatings = watched.map((m) => Number(m.imdbRating) || 8).filter(Boolean);
  const avgUser = userRatings.length > 0 ? (userRatings.reduce((a, b) => a + b, 0) / userRatings.length).toFixed(1) : "0.0";
  const avgImdb = imdbRatings.length > 0 ? (imdbRatings.reduce((a, b) => a + b, 0) / imdbRatings.length).toFixed(1) : "0.0";
  const ratingDelta = (Number(avgUser) - Number(avgImdb)).toFixed(1);
  const isHigherThanImdb = Number(ratingDelta) >= 0;

  // Top Genres & Distribution
  const genreCounts = {};
  watched.forEach((m) => {
    const genres = (m.genre || "Drama").split(",").map((g) => g.trim());
    genres.forEach((g) => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
  });
  const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const topGenre = sortedGenres[0] ? sortedGenres[0][0] : "Cinema";
  const totalGenreHits = sortedGenres.reduce((acc, [, count]) => acc + count, 0) || 1;

  // Rating Histogram (6★ - 10★)
  const distCounts = { 10: 0, 9: 0, 8: 0, 7: 0, 6: 0 };
  userRatings.forEach((r) => {
    const rounded = Math.min(10, Math.max(6, Math.round(r)));
    if (distCounts[rounded] !== undefined) distCounts[rounded] += 1;
  });
  const maxDistCount = Math.max(...Object.values(distCounts), 1);

  // Trivia
  const directorCounts = {};
  watched.forEach((m) => {
    if (m.director && m.director !== "N/A" && m.director !== "Unknown") {
      m.director.split(",").forEach((d) => {
        const name = d.trim();
        directorCounts[name] = (directorCounts[name] || 0) + 1;
      });
    }
  });
  const topDirectorEntry = Object.entries(directorCounts).sort((a, b) => b[1] - a[1])[0];
  const topDirector = topDirectorEntry ? `${topDirectorEntry[0]} (${topDirectorEntry[1]} films)` : "Diverse Directors";

  const actorCounts = {};
  watched.forEach((m) => {
    if (m.actors && m.actors !== "N/A") {
      m.actors.split(",").forEach((a) => {
        const name = a.trim();
        actorCounts[name] = (actorCounts[name] || 0) + 1;
      });
    }
  });
  const topActorEntry = Object.entries(actorCounts).sort((a, b) => b[1] - a[1])[0];
  const topActor = topActorEntry ? `${topActorEntry[0]} (${topActorEntry[1]} films)` : "Ensemble Casts";

  const longestFilm = [...watched].sort((a, b) => (parseInt(b.runtime) || 0) - (parseInt(a.runtime) || 0))[0];
  const longestFilmStr = longestFilm ? `${longestFilm.title || longestFilm.Title} (${parseInt(longestFilm.runtime) || 120}m)` : "N/A";

  const topRatedFilm = [...watched].sort((a, b) => (Number(b.userRating) || 0) - (Number(a.userRating) || 0))[0];
  const topRatedFilmStr = topRatedFilm ? `${topRatedFilm.title || topRatedFilm.Title} (★ ${topRatedFilm.userRating || topRatedFilm.imdbRating})` : "N/A";

  return (
    <div className="vault-studio-header" aria-label="Vault Control Hub">
      {/* ── Ambient Backdrop Vignette ── */}
      <div className="vault-studio-backdrop">
        {collagePosters.length > 0 ? (
          <div className="backdrop-mosaic-grid">
            {collagePosters.map((src, idx) => (
              <div key={idx} className="mosaic-cell">
                <img src={src} alt="" aria-hidden="true" loading="lazy" />
              </div>
            ))}
          </div>
        ) : (
          <div className="backdrop-ambient-glow" />
        )}
        <div className="backdrop-scrim-gradient" />
      </div>

      {/* ── Main Studio Control Content ── */}
      <div className="vault-studio-content">
        {/* Row 1: Studio Identity & Action Hub */}
        <div className="studio-top-row">
          <div className="studio-identity-group">
            <div className="vault-title-wrap">
              <span className="live-studio-dot" aria-hidden="true" />
              <h1 className="vault-studio-title">My Vault</h1>
            </div>

            {/* Micro Cinema Stats Pills */}
            <div className="studio-metrics-pills">
              <span className="metric-chip">
                <Film size={12} className="chip-icon text-accent" aria-hidden="true" />
                <strong>{totalMovies}</strong> films
              </span>
              {totalMinutes > 0 && (
                <span className="metric-chip">
                  <Clock size={12} className="chip-icon" aria-hidden="true" />
                  {timeString}
                </span>
              )}
              {totalMovies > 0 && (
                <span className="metric-chip gold">
                  <Star size={12} className="chip-icon gold" aria-hidden="true" />
                  <strong>★ {avgUser}</strong>
                  <span className="metric-sub-delta">
                    ({isHigherThanImdb ? `+${ratingDelta}` : ratingDelta} vs IMDb)
                  </span>
                </span>
              )}
              {topGenre && totalMovies > 0 && (
                <span className="metric-chip desktop-only">
                  <TrendingUp size={12} className="chip-icon" aria-hidden="true" />
                  {topGenre}
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons Group */}
          <div className="studio-actions-group">
            {/* Deep Insights Toggle Button */}
            {activeTab === "watched" && totalMovies > 0 && (
              <button
                className={`btn-studio-action btn-insights-trigger ${isInsightsOpen ? "active" : ""}`}
                onClick={() => setIsInsightsOpen((prev) => !prev)}
                aria-expanded={isInsightsOpen}
                title="Toggle Deep Insights & Taste DNA"
              >
                <Sparkles size={14} className="icon-sparkle" aria-hidden="true" />
                <span className="btn-text">{isInsightsOpen ? "Hide Insights" : "Insights & DNA"}</span>
                {isInsightsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            )}

            {/* Manage Mode Toggle */}
            <button
              className={`btn-studio-action ${isManageMode ? "manage-active" : ""}`}
              onClick={onToggleManageMode}
              title={isManageMode ? "Exit Selection Mode" : "Manage Vault (Select & Bulk Delete)"}
            >
              {isManageMode ? (
                <>
                  <XSquare size={14} aria-hidden="true" />
                  <span className="btn-text">Done Selection</span>
                </>
              ) : (
                <>
                  <CheckSquare size={14} aria-hidden="true" />
                  <span className="btn-text">Manage</span>
                </>
              )}
            </button>

            {/* Portability / Backup */}
            <button
              className="btn-studio-action ghost"
              onClick={onOpenBackup}
              title="Backup, Export & Import Collection"
            >
              <Settings size={14} aria-hidden="true" />
              <span className="btn-text desktop-only">Portability</span>
            </button>
          </div>
        </div>

        {/* ── Collapsible Glass Insights Drawer ── */}
        <AnimatePresence>
          {isInsightsOpen && activeTab === "watched" && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="studio-insights-drawer-wrapper"
            >
              <div className="studio-insights-card">
                <div className="insights-grid-layout">
                  {/* Column 1: Rating Histogram */}
                  <div className="insight-panel-col">
                    <div className="panel-col-header">
                      <div className="col-header-title">
                        <Trophy size={14} className="text-accent" aria-hidden="true" />
                        <h4>Score Histogram</h4>
                      </div>
                      <span className="col-header-sub">Score Frequency (6★ → 10★)</span>
                    </div>

                    <div className="histogram-bars-compact">
                      {[10, 9, 8, 7, 6].map((score) => {
                        const count = distCounts[score];
                        const pct = Math.round((count / maxDistCount) * 100);
                        return (
                          <div key={score} className="hist-col-item" title={`${score}★: ${count} films`}>
                            <span className="hist-val-num">{count > 0 ? count : ""}</span>
                            <div className="hist-track-wrap">
                              <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: count > 0 ? `${Math.max(16, pct)}%` : "4px" }}
                                transition={{ duration: 0.4, delay: (10 - score) * 0.05 }}
                                className={`hist-fill-bar ${score === 10 ? "gold" : ""}`}
                              />
                            </div>
                            <span className="hist-score-lbl">{score}★</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Column 2: Genre Affinities */}
                  <div className="insight-panel-col">
                    <div className="panel-col-header">
                      <div className="col-header-title">
                        <TrendingUp size={14} className="text-accent" aria-hidden="true" />
                        <h4>Genre Affinities</h4>
                      </div>
                      <span className="col-header-sub">Dominant Taste</span>
                    </div>

                    <div className="genre-meter-list">
                      {sortedGenres.map(([genre, count]) => {
                        const pct = Math.round((count / totalGenreHits) * 100);
                        return (
                          <div key={genre} className="genre-meter-row">
                            <div className="genre-meter-labels">
                              <span className="genre-meter-name">{genre}</span>
                              <span className="genre-meter-pct">{pct}%</span>
                            </div>
                            <div className="genre-meter-track">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.5, ease: "easeOut" }}
                                className="genre-meter-fill"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Column 3: Taste DNA Trivia */}
                  <div className="insight-panel-col">
                    <div className="panel-col-header">
                      <div className="col-header-title">
                        <Sparkles size={14} className="text-accent" aria-hidden="true" />
                        <h4>Taste DNA</h4>
                      </div>
                      <span className="col-header-sub">Vault Milestones</span>
                    </div>

                    <div className="dna-facts-grid">
                      <div className="dna-fact-box">
                        <span className="dna-fact-label">Top Director</span>
                        <span className="dna-fact-val" title={topDirector}>{topDirector}</span>
                      </div>
                      <div className="dna-fact-box">
                        <span className="dna-fact-label">Top Lead</span>
                        <span className="dna-fact-val" title={topActor}>{topActor}</span>
                      </div>
                      <div className="dna-fact-box">
                        <span className="dna-fact-label">Longest Runtime</span>
                        <span className="dna-fact-val" title={longestFilmStr}>{longestFilmStr}</span>
                      </div>
                      <div className="dna-fact-box">
                        <span className="dna-fact-label">Top Rated</span>
                        <span className="dna-fact-val text-accent font-semibold" title={topRatedFilmStr}>{topRatedFilmStr}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Row 2: Unified Navigation & Filter Bar */}
        <div className="studio-controls-bar">
          {/* Left: Buttery Sliding Tabs */}
          <div className="studio-segmented-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === "watched"}
              className={`studio-tab-btn ${activeTab === "watched" ? "active" : ""}`}
              onClick={() => onTabChange("watched")}
            >
              {activeTab === "watched" && (
                <motion.div
                  layoutId="vaultActiveTabPill"
                  className="studio-tab-indicator"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Film size={14} className="tab-btn-icon" aria-hidden="true" />
              <span className="tab-btn-text">Watched</span>
              <span className="tab-pill-badge">{watched.length}</span>
            </button>

            <button
              role="tab"
              aria-selected={activeTab === "watchlist"}
              className={`studio-tab-btn ${activeTab === "watchlist" ? "active" : ""}`}
              onClick={() => onTabChange("watchlist")}
            >
              {activeTab === "watchlist" && (
                <motion.div
                  layoutId="vaultActiveTabPill"
                  className="studio-tab-indicator"
                  transition={{ type: "spring", stiffness: 450, damping: 32 }}
                />
              )}
              <Bookmark size={14} className="tab-btn-icon" aria-hidden="true" />
              <span className="tab-btn-text">Plan to Watch</span>
              <span className="tab-pill-badge">{watchlist.length}</span>
            </button>
          </div>

          {/* Center/Right: Quick Search & Genre Filter */}
          <div className="studio-filters-group">
            {/* Search Input */}
            <div className="studio-search-field">
              <Search size={14} className="search-field-icon" aria-hidden="true" />
              <input
                type="text"
                placeholder={`Search ${activeTab === "watched" ? "watched films" : "watchlist"}...`}
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="studio-search-input"
                aria-label="Filter vault movies"
              />
              {searchQuery && (
                <button
                  className="btn-clear-search-pill"
                  onClick={() => onSearchChange("")}
                  aria-label="Clear search query"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Genre Filter Chips (Horizontal Swipe) */}
            <div className="studio-genre-chips" role="group" aria-label="Genre filters">
              {genresList.map((genre) => (
                <button
                  key={genre}
                  className={`studio-genre-pill ${selectedGenre === genre ? "active" : ""}`}
                  onClick={() => onGenreSelect(genre)}
                >
                  {genre}
                </button>
              ))}
            </div>

            {/* Secondary Controls: Sort & View Toggle */}
            <div className="studio-view-controls">
              <div className="studio-sort-wrapper">
                <SlidersHorizontal size={13} className="sort-icon-muted" aria-hidden="true" />
                <select
                  value={sortBy}
                  onChange={(e) => onSortChange(e.target.value)}
                  className="studio-sort-select"
                  aria-label="Sort collection by"
                >
                  <option value="input">Date Added</option>
                  <option value="userRating">Your Rating</option>
                  <option value="rating">IMDb Score</option>
                  <option value="runtime">Runtime</option>
                  <option value="title">Title (A-Z)</option>
                </select>
              </div>

              {/* View Mode Toggle */}
              <div className="studio-view-toggle-pills">
                <button
                  className={`view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
                  onClick={() => onViewModeChange("grid")}
                  title="Grid Poster View"
                  aria-label="Grid view"
                >
                  <LayoutGrid size={15} aria-hidden="true" />
                </button>
                <button
                  className={`view-mode-btn ${viewMode === "list" ? "active" : ""}`}
                  onClick={() => onViewModeChange("list")}
                  title="Table List View"
                  aria-label="List view"
                >
                  <List size={15} aria-hidden="true" />
                </button>
              </div>

              <span className="studio-count-lbl desktop-only">
                <strong>{filteredCount}</strong>/{totalCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
