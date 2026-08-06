import { Film, Clock, Star, TrendingUp, Sparkles, Trophy, Award, Calendar } from "lucide-react";

export default function VaultAnalyticsHeader({ watched = [] }) {
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

  const totalGenreHits = sortedGenres.reduce((acc, [, count]) => acc + count, 0) || 1;

  // 4. Rating Distribution (Histogram 6-10 stars)
  const distCounts = { 10: 0, 9: 0, 8: 0, 7: 0, 6: 0 };
  userRatings.forEach((r) => {
    const rounded = Math.min(10, Math.max(6, Math.round(r)));
    if (distCounts[rounded] !== undefined) {
      distCounts[rounded] += 1;
    }
  });
  const maxDistCount = Math.max(...Object.values(distCounts), 1);

  // 5. Vault Trivia Computations
  // Director trivia
  const directorCounts = {};
  watched.forEach((m) => {
    if (m.director && m.director !== "N/A") {
      m.director.split(",").forEach((d) => {
        const name = d.trim();
        directorCounts[name] = (directorCounts[name] || 0) + 1;
      });
    }
  });
  const topDirectorEntry = Object.entries(directorCounts).sort((a, b) => b[1] - a[1])[0];
  const topDirector = topDirectorEntry ? `${topDirectorEntry[0]} (${topDirectorEntry[1]} films)` : "Various Directors";

  // Actor trivia
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

  // Longest film
  const longestFilm = [...watched].sort((a, b) => (parseInt(b.runtime) || 0) - (parseInt(a.runtime) || 0))[0];
  const longestFilmStr = longestFilm ? `${longestFilm.title || longestFilm.Title} (${parseInt(longestFilm.runtime) || 120}m)` : "N/A";

  // Highest rated film
  const topRatedFilm = [...watched].sort((a, b) => (Number(b.userRating) || 0) - (Number(a.userRating) || 0))[0];
  const topRatedFilmStr = topRatedFilm ? `${topRatedFilm.title || topRatedFilm.Title} (${topRatedFilm.userRating || topRatedFilm.imdbRating}★)` : "N/A";

  // Decade spread
  const decadeCounts = {};
  watched.forEach((m) => {
    const year = parseInt(m.year || m.Year, 10);
    if (!isNaN(year)) {
      const decade = `${Math.floor(year / 10) * 10}s`;
      decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
    }
  });
  const topDecadeEntry = Object.entries(decadeCounts).sort((a, b) => b[1] - a[1])[0];
  const topDecadeStr = topDecadeEntry ? `${topDecadeEntry[0]} (${Math.round((topDecadeEntry[1] / totalMovies) * 100)}%)` : "Modern Era";

  // Mini Sparkline Data (Simulated 12-week activity for visualization)
  const sparklineHeights = [15, 30, 20, 45, 60, 40, 80, 50, 75, 90, 65, 100];

  return (
    <section className="vault-analytics-container" aria-label="Vault Cinema Insights">
      {/* ── Insights Strip v2 ── */}
      <div className="vault-insights-strip">
        {/* Stat 1: Total Watched */}
        <div className="vault-stat-card-v2">
          <div className="stat-card-header">
            <div className="vault-icon-badge cyan">
              <Film size={18} aria-hidden="true" />
            </div>
            <span className="vault-delta-chip cyan">+{totalMovies} total</span>
          </div>
          <div className="stat-card-body">
            <span className="stat-v2-label">Total Watched</span>
            <div className="stat-v2-main-row">
              <span className="stat-v2-value">{totalMovies}</span>
              <span className="stat-v2-unit">films logged</span>
            </div>
          </div>
          {/* Mini 12-Week Activity Sparkline */}
          <div className="stat-v2-sparkline" title="12-Week Viewing Activity">
            {sparklineHeights.map((h, i) => (
              <div
                key={i}
                className="sparkline-bar"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>

        {/* Stat 2: Total Screen Time */}
        <div className="vault-stat-card-v2">
          <div className="stat-card-header">
            <div className="vault-icon-badge cyan">
              <Clock size={18} aria-hidden="true" />
            </div>
            <span className="vault-delta-chip cyan">{totalMinutes.toLocaleString()} mins</span>
          </div>
          <div className="stat-card-body">
            <span className="stat-v2-label">Screen Time</span>
            <div className="stat-v2-main-row">
              <span className="stat-v2-value">{timeString}</span>
            </div>
          </div>
          {/* Mini Monthly Goal Ring / Bar */}
          <div className="stat-v2-progress-wrap">
            <div className="stat-v2-progress-info">
              <span>Goal Progress (30h/mo)</span>
              <span>{Math.min(100, Math.round((totalMinutes / 1800) * 100))}%</span>
            </div>
            <div className="stat-v2-progress-track">
              <div
                className="stat-v2-progress-fill"
                style={{ width: `${Math.min(100, Math.round((totalMinutes / 1800) * 100))}%` }}
              />
            </div>
          </div>
        </div>

        {/* Stat 3: Avg Rating (You vs IMDb) */}
        <div className="vault-stat-card-v2">
          <div className="stat-card-header">
            <div className="vault-icon-badge cyan">
              <Star size={18} className="icon-star-gold-pure" aria-hidden="true" />
            </div>
            <span className={`vault-delta-chip ${isHigherThanImdb ? "cyan" : "gold"}`}>
              {isHigherThanImdb ? `+${ratingDelta}` : ratingDelta} vs IMDb
            </span>
          </div>
          <div className="stat-card-body">
            <span className="stat-v2-label">Your Avg Rating</span>
            <div className="stat-v2-main-row">
              <span className="stat-v2-value star-gold">★ {avgUser}</span>
            </div>
          </div>
          {/* Comparison Bar (You vs IMDb) */}
          <div className="stat-v2-comparison-bars">
            <div className="comp-bar-item">
              <span className="comp-label">You: {avgUser}</span>
              <div className="comp-track">
                <div className="comp-fill user" style={{ width: `${(Number(avgUser) / 10) * 100}%` }} />
              </div>
            </div>
            <div className="comp-bar-item">
              <span className="comp-label">IMDb: {avgImdb}</span>
              <div className="comp-track">
                <div className="comp-fill imdb" style={{ width: `${(Number(avgImdb) / 10) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Stat 4: Top Genre Breakdown */}
        <div className="vault-stat-card-v2 wide">
          <div className="stat-card-header">
            <div className="vault-icon-badge cyan">
              <TrendingUp size={18} aria-hidden="true" />
            </div>
            <span className="stat-v2-label">Top Genre Share</span>
          </div>
          <div className="vault-genre-bars-v2">
            {sortedGenres.map(([genre, count]) => {
              const pct = Math.round((count / totalGenreHits) * 100);
              return (
                <div key={genre} className="vault-genre-item-v2">
                  <div className="genre-item-meta">
                    <span className="genre-name">{genre}</span>
                    <span className="genre-pct">{pct}%</span>
                  </div>
                  <div className="genre-track-v2">
                    <div className="genre-fill-v2" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── New Insights Row: Ratings Histogram & Vault Trivia ── */}
      <div className="vault-insights-row-2">
        {/* Card 1: Ratings Distribution Histogram */}
        <div className="vault-insight-card histogram-card">
          <div className="insight-card-header">
            <div className="insight-title-wrap">
              <Trophy size={16} className="cyan-icon" aria-hidden="true" />
              <h4>Ratings Distribution</h4>
            </div>
            <span className="insight-subtitle">Score frequency (6★ → 10★)</span>
          </div>
          <div className="histogram-body">
            {[10, 9, 8, 7, 6].map((score) => {
              const count = distCounts[score];
              const pct = Math.round((count / maxDistCount) * 100);
              return (
                <div key={score} className="histogram-col" title={`${score}★: ${count} films`}>
                  <span className="col-count">{count > 0 ? count : ""}</span>
                  <div className="col-bar-wrap">
                    <div
                      className={`col-bar ${score === 10 ? "gold-pure" : ""}`}
                      style={{ height: count > 0 ? `${Math.max(12, pct)}%` : "4px" }}
                    />
                  </div>
                  <span className="col-label">{score}★</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 2: Vault Trivia Facts */}
        <div className="vault-insight-card trivia-card">
          <div className="insight-card-header">
            <div className="insight-title-wrap">
              <Sparkles size={16} className="cyan-icon" aria-hidden="true" />
              <h4>Vault Trivia & Taste DNA</h4>
            </div>
            <span className="insight-subtitle">Computed collection facts</span>
          </div>

          <div className="trivia-grid">
            <div className="trivia-item">
              <span className="trivia-label">Top Director</span>
              <span className="trivia-value" title={topDirector}>{topDirector}</span>
            </div>
            <div className="trivia-item">
              <span className="trivia-label">Top Star / Actor</span>
              <span className="trivia-value" title={topActor}>{topActor}</span>
            </div>
            <div className="trivia-item">
              <span className="trivia-label">Longest Experience</span>
              <span className="trivia-value" title={longestFilmStr}>{longestFilmStr}</span>
            </div>
            <div className="trivia-item">
              <span className="trivia-label">Highest Rated</span>
              <span className="trivia-value gold" title={topRatedFilmStr}>{topRatedFilmStr}</span>
            </div>
            <div className="trivia-item full-width">
              <span className="trivia-label">Dominant Film Era</span>
              <span className="trivia-value" title={topDecadeStr}>{topDecadeStr}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
