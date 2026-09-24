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
  Filter,
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
    <div className="vault-studio-header-spacious" aria-label="Vault Control Center">
      {/* ── Tier 1: Spacious Title & Executive Actions ── */}
      <div className="studio-hero-tier">
        <div className="studio-hero-left">
          <div className="hero-title-line">
            <span className="live-studio-pulse" aria-hidden="true" />
            <h1 className="vault-spacious-title">My Vault</h1>
            <span className="vault-count-pill">{totalMovies} titles</span>
          </div>

          <p className="vault-spacious-meta">
            <span>{timeString} screen time</span>
            {totalMovies > 0 && (
              <>
                <span className="meta-sep">•</span>
                <span className="meta-star-stat">
                  <Star size={13} className="text-accent fill-current" aria-hidden="true" />
                  <strong>{avgUser}</strong> avg ({isHigherThanImdb ? `+${ratingDelta}` : ratingDelta} vs IMDb)
                </span>
                {topGenre && (
                  <>
                    <span className="meta-sep">•</span>
                    <span className="meta-genre-tag">Top: <strong>{topGenre}</strong></span>
                  </>
                )}
              </>
            )}
          </p>
        </div>

        {/* Executive Action Buttons */}
        <div className="studio-hero-actions">
          {activeTab === "watched" && totalMovies > 0 && (
            <button
              className={`btn-executive btn-insights-glow ${isInsightsOpen ? "active" : ""}`}
              onClick={() => setIsInsightsOpen((prev) => !prev)}
              aria-expanded={isInsightsOpen}
              title="Toggle Detailed Histogram and Taste DNA"
            >
              <Sparkles size={15} className="text-accent" aria-hidden="true" />
              <span>{isInsightsOpen ? "Close DNA" : "Taste DNA"}</span>
              {isInsightsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}

          <button
            className={`btn-executive ${isManageMode ? "manage-active" : ""}`}
            onClick={onToggleManageMode}
            title={isManageMode ? "Exit Selection Mode" : "Manage Vault (Bulk Move & Delete)"}
          >
            {isManageMode ? (
              <>
                <XSquare size={15} aria-hidden="true" />
                <span>Done</span>
              </>
            ) : (
              <>
                <CheckSquare size={15} aria-hidden="true" />
                <span>Manage</span>
              </>
            )}
          </button>

          <button
            className="btn-executive ghost"
            onClick={onOpenBackup}
            title="Backup & Portability"
          >
            <Settings size={15} aria-hidden="true" />
            <span className="desktop-only">Backup</span>
          </button>
        </div>
      </div>

      {/* ── Collapsible Glass Insights Drawer ── */}
      <AnimatePresence>
        {isInsightsOpen && activeTab === "watched" && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -10 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -10 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="studio-insights-drawer-wrapper"
          >
            <div className="studio-insights-glass-card">
              <div className="insights-three-col-grid">
                {/* Column 1: Rating Histogram */}
                <div className="insight-panel-card">
                  <div className="panel-title-bar">
                    <div className="panel-title-text">
                      <Trophy size={15} className="text-accent" aria-hidden="true" />
                      <h4>Score Distribution</h4>
                    </div>
                    <span className="panel-sub-label">6★ → 10★ frequency</span>
                  </div>

                  <div className="histogram-bars-spacious">
                    {[10, 9, 8, 7, 6].map((score) => {
                      const count = distCounts[score];
                      const pct = Math.round((count / maxDistCount) * 100);
                      return (
                        <div key={score} className="hist-column-item" title={`${score}★: ${count} films`}>
                          <span className="hist-count-num">{count > 0 ? count : ""}</span>
                          <div className="hist-track-housing">
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: count > 0 ? `${Math.max(16, pct)}%` : "4px" }}
                              transition={{ duration: 0.45, delay: (10 - score) * 0.05 }}
                              className={`hist-bar-fill ${score === 10 ? "gold" : ""}`}
                            />
                          </div>
                          <span className="hist-label-text">{score}★</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Column 2: Genre Affinities */}
                <div className="insight-panel-card">
                  <div className="panel-title-bar">
                    <div className="panel-title-text">
                      <TrendingUp size={15} className="text-accent" aria-hidden="true" />
                      <h4>Genre Affinities</h4>
                    </div>
                    <span className="panel-sub-label">Dominant affinities</span>
                  </div>

                  <div className="genre-progress-group">
                    {sortedGenres.map(([genre, count]) => {
                      const pct = Math.round((count / totalGenreHits) * 100);
                      return (
                        <div key={genre} className="genre-progress-item">
                          <div className="genre-progress-labels">
                            <span className="genre-name">{genre}</span>
                            <span className="genre-pct">{pct}%</span>
                          </div>
                          <div className="genre-progress-track">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.5, ease: "easeOut" }}
                              className="genre-progress-fill"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Column 3: Taste DNA Trivia */}
                <div className="insight-panel-card">
                  <div className="panel-title-bar">
                    <div className="panel-title-text">
                      <Sparkles size={15} className="text-accent" aria-hidden="true" />
                      <h4>Taste DNA</h4>
                    </div>
                    <span className="panel-sub-label">Collection milestones</span>
                  </div>

                  <div className="dna-metrics-grid">
                    <div className="dna-metric-card">
                      <span className="dna-label">Top Director</span>
                      <span className="dna-value" title={topDirector}>{topDirector}</span>
                    </div>
                    <div className="dna-metric-card">
                      <span className="dna-label">Top Lead</span>
                      <span className="dna-value" title={topActor}>{topActor}</span>
                    </div>
                    <div className="dna-metric-card">
                      <span className="dna-label">Longest Runtime</span>
                      <span className="dna-value" title={longestFilmStr}>{longestFilmStr}</span>
                    </div>
                    <div className="dna-metric-card">
                      <span className="dna-label">Highest Rated</span>
                      <span className="dna-value text-accent font-semibold" title={topRatedFilmStr}>{topRatedFilmStr}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tier 2: Spacious Navigation & Filter Toolbar ── */}
      <div className="studio-toolbar-tier">
        {/* Left: Clean Sliding Pill Tabs */}
        <div className="studio-tabs-cluster" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "watched"}
            className={`spacious-tab-pill ${activeTab === "watched" ? "active" : ""}`}
            onClick={() => onTabChange("watched")}
          >
            {activeTab === "watched" && (
              <motion.div
                layoutId="vaultSpaciousTabHighlight"
                className="spacious-tab-highlight"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <Film size={15} className="tab-icon" aria-hidden="true" />
            <span className="tab-title">Watched</span>
            <span className="tab-badge">{watched.length}</span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "watchlist"}
            className={`spacious-tab-pill ${activeTab === "watchlist" ? "active" : ""}`}
            onClick={() => onTabChange("watchlist")}
          >
            {activeTab === "watchlist" && (
              <motion.div
                layoutId="vaultSpaciousTabHighlight"
                className="spacious-tab-highlight"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
              />
            )}
            <Bookmark size={15} className="tab-icon" aria-hidden="true" />
            <span className="tab-title">Plan to Watch</span>
            <span className="tab-badge">{watchlist.length}</span>
          </button>
        </div>

        {/* Right: Clean, Uncluttered Search & Filters */}
        <div className="studio-controls-cluster">
          {/* Quick Search Input */}
          <div className="spacious-search-box">
            <Search size={14} className="search-icon-muted" aria-hidden="true" />
            <input
              type="text"
              placeholder={`Search ${activeTab === "watched" ? "watched films" : "watchlist"}...`}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="spacious-search-input"
              aria-label="Filter collection"
            />
            {searchQuery && (
              <button
                className="btn-clear-spacious-search"
                onClick={() => onSearchChange("")}
                aria-label="Clear search"
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Genre Dropdown Select */}
          <div className="spacious-filter-select-wrap">
            <Filter size={13} className="select-icon-muted" aria-hidden="true" />
            <select
              value={selectedGenre}
              onChange={(e) => onGenreSelect(e.target.value)}
              className="spacious-filter-select"
              aria-label="Filter by genre"
            >
              {genresList.map((genre) => (
                <option key={genre} value={genre}>
                  {genre === "All" ? "All Genres" : genre}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Dropdown */}
          <div className="spacious-filter-select-wrap">
            <SlidersHorizontal size={13} className="select-icon-muted" aria-hidden="true" />
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="spacious-filter-select"
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
          <div className="spacious-view-toggle">
            <button
              className={`btn-view-choice ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => onViewModeChange("grid")}
              title="Poster Grid View"
              aria-label="Grid view"
            >
              <LayoutGrid size={15} aria-hidden="true" />
            </button>
            <button
              className={`btn-view-choice ${viewMode === "list" ? "active" : ""}`}
              onClick={() => onViewModeChange("list")}
              title="Table List View"
              aria-label="List view"
            >
              <List size={15} aria-hidden="true" />
            </button>
          </div>

          <span className="spacious-count-indicator desktop-only">
            <strong>{filteredCount}</strong>/{totalCount}
          </span>
        </div>
      </div>
    </div>
  );
}
