import { useState } from "react";
import { Film, Clock, Star, TrendingUp, Sparkles, Trophy, ChevronDown, ChevronUp, Award } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function VaultAnalyticsHeader({ watched = [] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!watched || watched.length === 0) return null;

  const totalMovies = watched.length;

  // 1. Runtime calculation
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

  // 2. Average Ratings
  const userRatings = watched.map((m) => Number(m.userRating) || Number(m.imdbRating) || 8).filter(Boolean);
  const imdbRatings = watched.map((m) => Number(m.imdbRating) || 8).filter(Boolean);

  const avgUser = userRatings.length > 0 ? (userRatings.reduce((a, b) => a + b, 0) / userRatings.length).toFixed(1) : "0.0";
  const avgImdb = imdbRatings.length > 0 ? (imdbRatings.reduce((a, b) => a + b, 0) / imdbRatings.length).toFixed(1) : "0.0";
  const ratingDelta = (Number(avgUser) - Number(avgImdb)).toFixed(1);
  const isHigherThanImdb = Number(ratingDelta) >= 0;

  // 3. Top Genres
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

  const topGenre = sortedGenres[0] ? sortedGenres[0][0] : "Cinema";
  const totalGenreHits = sortedGenres.reduce((acc, [, count]) => acc + count, 0) || 1;
  const topGenrePct = sortedGenres[0] ? Math.round((sortedGenres[0][1] / totalGenreHits) * 100) : 0;

  // 4. Rating Distribution (Histogram 6-10 stars)
  const distCounts = { 10: 0, 9: 0, 8: 0, 7: 0, 6: 0 };
  userRatings.forEach((r) => {
    const rounded = Math.min(10, Math.max(6, Math.round(r)));
    if (distCounts[rounded] !== undefined) {
      distCounts[rounded] += 1;
    }
  });
  const maxDistCount = Math.max(...Object.values(distCounts), 1);

  // 5. Director & Actor Trivia
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
    <section className="vault-analytics-compact-section" aria-label="Vault Cinema Insights">
      {/* ── Compact 4-Stat Metric Bar ── */}
      <div className="vault-summary-strip">
        {/* Metric 1: Total Watched */}
        <div className="summary-stat-cell">
          <div className="stat-cell-icon">
            <Film size={16} aria-hidden="true" />
          </div>
          <div className="stat-cell-content">
            <span className="stat-cell-label">Watched</span>
            <span className="stat-cell-value">{totalMovies} <span className="stat-cell-unit">films</span></span>
          </div>
        </div>

        {/* Metric 2: Screen Time */}
        <div className="summary-stat-cell">
          <div className="stat-cell-icon">
            <Clock size={16} aria-hidden="true" />
          </div>
          <div className="stat-cell-content">
            <span className="stat-cell-label">Screen Time</span>
            <span className="stat-cell-value">{timeString}</span>
          </div>
        </div>

        {/* Metric 3: Avg Rating */}
        <div className="summary-stat-cell">
          <div className="stat-cell-icon gold">
            <Star size={16} aria-hidden="true" />
          </div>
          <div className="stat-cell-content">
            <span className="stat-cell-label">Avg Rating</span>
            <div className="stat-rating-row">
              <span className="stat-cell-value text-accent">★ {avgUser}</span>
              <span className={`stat-delta-chip ${isHigherThanImdb ? "positive" : "neutral"}`}>
                {isHigherThanImdb ? `+${ratingDelta}` : ratingDelta} vs IMDb
              </span>
            </div>
          </div>
        </div>

        {/* Metric 4: Top Genre */}
        <div className="summary-stat-cell">
          <div className="stat-cell-icon">
            <TrendingUp size={16} aria-hidden="true" />
          </div>
          <div className="stat-cell-content">
            <span className="stat-cell-label">Top Genre</span>
            <span className="stat-cell-value">{topGenre} <span className="stat-cell-unit">({topGenrePct}%)</span></span>
          </div>
        </div>

        {/* Expand / Collapse Button */}
        <button
          className={`btn-toggle-insights ${isExpanded ? "active" : ""}`}
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          title="Toggle Detailed Histogram and Taste DNA"
        >
          <Sparkles size={14} className="sparkle-icon" aria-hidden="true" />
          <span>{isExpanded ? "Hide Insights" : "Deep Insights"}</span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* ── Collapsible Deep Insights Drawer ── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="vault-deep-insights-drawer overflow-hidden"
          >
            <div className="insights-drawer-grid">
              {/* Card 1: Ratings Histogram */}
              <div className="drawer-insight-card">
                <div className="insight-card-header">
                  <div className="insight-title-group">
                    <Trophy size={15} className="text-accent" aria-hidden="true" />
                    <h4>Ratings Distribution</h4>
                  </div>
                  <span className="insight-meta-sub">Score frequency (6★ → 10★)</span>
                </div>
                <div className="histogram-body-compact">
                  {[10, 9, 8, 7, 6].map((score) => {
                    const count = distCounts[score];
                    const pct = Math.round((count / maxDistCount) * 100);
                    return (
                      <div key={score} className="histogram-column" title={`${score}★: ${count} films`}>
                        <span className="hist-count">{count > 0 ? count : ""}</span>
                        <div className="hist-bar-track">
                          <div
                            className={`hist-bar-fill ${score === 10 ? "gold" : ""}`}
                            style={{ height: count > 0 ? `${Math.max(14, pct)}%` : "4px" }}
                          />
                        </div>
                        <span className="hist-label">{score}★</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 2: Genre Share Breakdown */}
              <div className="drawer-insight-card">
                <div className="insight-card-header">
                  <div className="insight-title-group">
                    <TrendingUp size={15} className="text-accent" aria-hidden="true" />
                    <h4>Genre Breakdown</h4>
                  </div>
                  <span className="insight-meta-sub">Top affinities</span>
                </div>
                <div className="genre-progress-list">
                  {sortedGenres.map(([genre, count]) => {
                    const pct = Math.round((count / totalGenreHits) * 100);
                    return (
                      <div key={genre} className="genre-progress-row">
                        <div className="genre-progress-meta">
                          <span className="genre-title">{genre}</span>
                          <span className="genre-pct">{pct}%</span>
                        </div>
                        <div className="genre-progress-track">
                          <div className="genre-progress-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 3: Vault Trivia & DNA */}
              <div className="drawer-insight-card trivia-card">
                <div className="insight-card-header">
                  <div className="insight-title-group">
                    <Sparkles size={15} className="text-accent" aria-hidden="true" />
                    <h4>Taste DNA & Trivia</h4>
                  </div>
                  <span className="insight-meta-sub">Computed milestones</span>
                </div>
                <div className="trivia-facts-grid">
                  <div className="trivia-fact">
                    <span className="fact-label">Top Director</span>
                    <span className="fact-value" title={topDirector}>{topDirector}</span>
                  </div>
                  <div className="trivia-fact">
                    <span className="fact-label">Top Star</span>
                    <span className="fact-value" title={topActor}>{topActor}</span>
                  </div>
                  <div className="trivia-fact">
                    <span className="fact-label">Longest Film</span>
                    <span className="fact-value" title={longestFilmStr}>{longestFilmStr}</span>
                  </div>
                  <div className="trivia-fact">
                    <span className="fact-label">Highest Rated</span>
                    <span className="fact-value text-accent font-semibold" title={topRatedFilmStr}>{topRatedFilmStr}</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
