import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckSquare,
  ArrowUpDown,
  Search,
  X,
  SlidersHorizontal,
  LayoutGrid,
  List,
  ChevronDown,
  ChevronUp,
  Star,
  Filter,
  Cloud,
  MoreHorizontal
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Menu, StatCell, Tabs } from "./ui";
import { buildRatingHistogramBins } from "../services/vaultStats";

export default function VaultBanner({
  watched = [],
  watchlist = [],
  activeTab = "watched",
  onTabChange,
  isManageMode = false,
  onToggleManageMode,
  onOpenBackup,
  onOpenCloudSync,
  hasCloudConfig = false,
  cloudUser = null,
  cloudSyncStatus = "idle",
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
  totalCount = 0
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
  timeString += `${hours}h`;
  if (days === 0) timeString += ` ${mins}m`;

  const userRatings = watched
    .map((m) => Number(m.userRating))
    .filter((r) => Number.isFinite(r) && r > 0);
  const imdbRatings = watched
    .map((m) => Number(m.imdbRating))
    .filter((r) => Number.isFinite(r) && r > 0);
  const avgUser =
    userRatings.length > 0
      ? (userRatings.reduce((a, b) => a + b, 0) / userRatings.length).toFixed(1)
      : "—";
  const avgImdb =
    imdbRatings.length > 0
      ? (imdbRatings.reduce((a, b) => a + b, 0) / imdbRatings.length).toFixed(1)
      : null;
  const ratingDelta =
    userRatings.length > 0 && avgImdb !== null
      ? (Number(avgUser) - Number(avgImdb)).toFixed(1)
      : null;
  const isHigherThanImdb = Number(ratingDelta) >= 0;

  // Top Genres & Distribution
  const genreCounts = {};
  watched.forEach((m) => {
    const genres = (m.genre || "Drama").split(",").map((g) => g.trim());
    genres.forEach((g) => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
  });
  const sortedGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const topGenre = sortedGenres[0] ? sortedGenres[0][0] : "—";
  const totalGenreHits = sortedGenres.reduce((acc, [, count]) => acc + count, 0) || 1;

  // Rating Histogram (1★ - 10★)
  const { bins: histogramBins } = buildRatingHistogramBins(watched);

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
  const topDirector = topDirectorEntry
    ? `${topDirectorEntry[0]} (${topDirectorEntry[1]})`
    : "Diverse Directors";

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
  const topActor = topActorEntry
    ? `${topActorEntry[0]} (${topActorEntry[1]})`
    : "Ensemble Casts";

  const longestFilm = [...watched].sort(
    (a, b) => (parseInt(b.runtime, 10) || 0) - (parseInt(a.runtime, 10) || 0)
  )[0];
  const longestFilmStr = longestFilm
    ? `${longestFilm.title || longestFilm.Title} (${parseInt(longestFilm.runtime, 10) || 120}m)`
    : "N/A";

  const topRatedFilm = [...watched]
    .filter((m) => Number(m.userRating) > 0)
    .sort((a, b) => Number(b.userRating) - Number(a.userRating))[0];
  const topRatedFilmStr = topRatedFilm
    ? `${topRatedFilm.title || topRatedFilm.Title} (★ ${topRatedFilm.userRating})`
    : "N/A";

  const isFiltered = searchQuery.trim() !== "" || selectedGenre !== "All";
  const cloudMenuLabel = cloudUser
    ? cloudSyncStatus === "syncing"
      ? "Syncing to Cloud..."
      : cloudSyncStatus === "error"
        ? "Cloud Sync Error"
        : `Cloud Synced (${cloudUser.email || "connected"})`
    : hasCloudConfig
      ? "Cloud Sync (Sign in)"
      : "Cloud Sync Status";

  return (
    <div className="vault-studio-header-spacious" aria-label="Vault Control Center">
      {/* ── Tier 1: Editorial Header & Typographic Stats ── */}
      <div className="studio-hero-tier">
        <div className="studio-hero-left">
          <h1 className="vault-spacious-title display-title">My Vault</h1>

          {totalMovies > 0 && (
            <div className="vault-stats-strip">
              <StatCell label="Screen time" value={timeString} />
              <StatCell
                label="Your avg"
                subtext={
                  ratingDelta !== null
                    ? `${isHigherThanImdb ? "+" : ""}${ratingDelta} vs IMDb`
                    : null
                }
                value={
                  <>
                    <Star
                      size={16}
                      className="vault-stat-star"
                      fill="currentColor"
                      aria-hidden="true"
                    />
                    <span>{avgUser}</span>
                  </>
                }
              />
              <StatCell label="Top genre" value={topGenre} />
            </div>
          )}
        </div>

        <div className="studio-hero-actions">
          {isManageMode && (
            <Button variant="primary" size="sm" onClick={onToggleManageMode}>
              Done
            </Button>
          )}

          {activeTab === "watched" && totalMovies > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsInsightsOpen((prev) => !prev)}
              aria-expanded={isInsightsOpen}
            >
              <span>{isInsightsOpen ? "Hide Insights" : "Insights"}</span>
              {isInsightsOpen ? (
                <ChevronUp size={14} aria-hidden="true" />
              ) : (
                <ChevronDown size={14} aria-hidden="true" />
              )}
            </Button>
          )}

          <Link to="/ai" className="vault-action-link">
            Taste Profile &rarr;
          </Link>

          <Menu>
            <Menu.Trigger
              className="nav-utility-trigger"
              aria-label="Vault actions menu"
              title="Manage, Import / Export, Cloud Sync"
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Panel align="right">
              <Menu.Label>Vault Actions</Menu.Label>
              <Menu.Item icon={CheckSquare} onClick={onToggleManageMode}>
                {isManageMode ? "Done Managing" : "Manage Selection"}
              </Menu.Item>
              <Menu.Item icon={ArrowUpDown} onClick={onOpenBackup}>
                Import / Export Vault
              </Menu.Item>
              {onOpenCloudSync && (
                <>
                  <Menu.Divider />
                  <Menu.Item icon={Cloud} onClick={onOpenCloudSync}>
                    {cloudMenuLabel}
                  </Menu.Item>
                </>
              )}
            </Menu.Panel>
          </Menu>
        </div>
      </div>

      {/* ── Collapsible Insights Drawer ── */}
      <AnimatePresence>
        {isInsightsOpen && activeTab === "watched" && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="studio-insights-drawer-wrapper"
          >
            <div className="studio-insights-glass-card">
              <div className="insights-three-col-grid">
                <div className="insight-panel-card">
                  <div className="panel-title-bar">
                    <h4>Score Distribution</h4>
                    <span className="panel-sub-label">1★ → 10★</span>
                  </div>

                  <div className="histogram-bars-spacious">
                    {histogramBins.map(({ score, label, count, heightPct }) => (
                      <div
                        key={score}
                        className="hist-column-item"
                        title={`${label}: ${count} films`}
                      >
                        <span className="hist-count-num">{count > 0 ? count : ""}</span>
                        <div className="hist-track-housing">
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: count > 0 ? `${Math.max(14, heightPct)}%` : "3px" }}
                            transition={{ duration: 0.4, delay: (10 - score) * 0.03 }}
                            className={`hist-bar-fill ${score === 10 ? "gold" : ""}`}
                          />
                        </div>
                        <span className="hist-label-text">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="insight-panel-card">
                  <div className="panel-title-bar">
                    <h4>Genre Affinities</h4>
                    <span className="panel-sub-label">Share of watched</span>
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
                              transition={{ duration: 0.45, ease: "easeOut" }}
                              className="genre-progress-fill"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="insight-panel-card">
                  <div className="panel-title-bar">
                    <h4>Collection Milestones</h4>
                    <span className="panel-sub-label">Across {totalMovies} films</span>
                  </div>

                  <div className="dna-metrics-grid">
                    <div className="dna-metric-card">
                      <span className="dna-label">Top Director</span>
                      <span className="dna-value" title={topDirector}>
                        {topDirector}
                      </span>
                    </div>
                    <div className="dna-metric-card">
                      <span className="dna-label">Top Lead</span>
                      <span className="dna-value" title={topActor}>
                        {topActor}
                      </span>
                    </div>
                    <div className="dna-metric-card">
                      <span className="dna-label">Longest Film</span>
                      <span className="dna-value" title={longestFilmStr}>
                        {longestFilmStr}
                      </span>
                    </div>
                    <div className="dna-metric-card">
                      <span className="dna-label">Highest Rated</span>
                      <span className="dna-value is-gold" title={topRatedFilmStr}>
                        {topRatedFilmStr}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tier 2: Underline Tabs & Clean Filters ── */}
      <div className="studio-toolbar-tier">
        <Tabs
          tabs={[
            { id: "watched", label: "Watched", count: watched.length },
            { id: "watchlist", label: "Watchlist", count: watchlist.length }
          ]}
          activeTab={activeTab}
          onChange={onTabChange}
        />

        <div className="studio-controls-cluster">
          <div className="spacious-search-box">
            <Search size={14} className="search-icon-muted" aria-hidden="true" />
            <input
              type="text"
              placeholder={`Search ${activeTab === "watched" ? "watched" : "watchlist"}...`}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="spacious-search-input"
              aria-label="Filter collection"
            />
            {searchQuery && (
              <button
                type="button"
                className="btn-clear-spacious-search"
                onClick={() => onSearchChange("")}
                aria-label="Clear search"
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>

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

          <div className="spacious-view-toggle">
            <button
              type="button"
              className={`btn-view-choice ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => onViewModeChange("grid")}
              title="Poster Grid View"
              aria-label="Grid view"
            >
              <LayoutGrid size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`btn-view-choice ${viewMode === "list" ? "active" : ""}`}
              onClick={() => onViewModeChange("list")}
              title="Table List View"
              aria-label="List view"
            >
              <List size={15} aria-hidden="true" />
            </button>
          </div>

          {isFiltered && (
            <span className="spacious-count-indicator desktop-only">
              <strong>{filteredCount}</strong>/{totalCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
