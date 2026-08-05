import { Film, Clock, Star, Award, TrendingUp } from "lucide-react";

export default function VaultAnalyticsHeader({ watched = [] }) {
  if (!watched || watched.length === 0) return null;

  const totalMovies = watched.length;

  // Calculate total runtime minutes
  const totalMinutes = watched.reduce((acc, m) => acc + (Number(m.runtime) || 120), 0);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;

  let timeString = "";
  if (days > 0) timeString += `${days}d `;
  timeString += `${hours}h ${mins}m`;

  // Calculate average ratings
  const avgImdb = (
    watched.reduce((acc, m) => acc + (Number(m.imdbRating) || 0), 0) / totalMovies
  ).toFixed(1);

  const avgUser = (
    watched.reduce((acc, m) => acc + (Number(m.userRating) || 0), 0) / totalMovies
  ).toFixed(1);

  // Genre breakdown calculation
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

  return (
    <div className="vault-analytics-header" aria-label="Vault Cinema Analytics">
      <div className="vault-analytics-grid">
        {/* Stat 1: Total Watched */}
        <div className="vault-stat-card">
          <div className="vault-stat-icon-wrap cyan">
            <Film size={22} aria-hidden="true" />
          </div>
          <div className="vault-stat-info">
            <span className="vault-stat-label">Total Watched</span>
            <span className="vault-stat-value">{totalMovies}</span>
            <span className="vault-stat-sub">movies & series</span>
          </div>
        </div>

        {/* Stat 2: Screen Time */}
        <div className="vault-stat-card">
          <div className="vault-stat-icon-wrap purple">
            <Clock size={22} aria-hidden="true" />
          </div>
          <div className="vault-stat-info">
            <span className="vault-stat-label">Total Screen Time</span>
            <span className="vault-stat-value">{timeString}</span>
            <span className="vault-stat-sub">{totalMinutes.toLocaleString()} minutes logged</span>
          </div>
        </div>

        {/* Stat 3: Ratings Average */}
        <div className="vault-stat-card">
          <div className="vault-stat-icon-wrap gold">
            <Star size={22} aria-hidden="true" />
          </div>
          <div className="vault-stat-info">
            <span className="vault-stat-label">Your Avg Rating</span>
            <div className="vault-stat-rating-row">
              <span className="vault-stat-value gold">★ {avgUser}</span>
              <span className="vault-stat-imdb">IMDb avg ★ {avgImdb}</span>
            </div>
            <span className="vault-stat-sub">Personal Taste Profile</span>
          </div>
        </div>

        {/* Stat 4: Top Genre Distribution */}
        <div className="vault-stat-card wide">
          <div className="vault-stat-icon-wrap emerald">
            <TrendingUp size={22} aria-hidden="true" />
          </div>
          <div className="vault-stat-info full-width">
            <span className="vault-stat-label">Top Genre Breakdown</span>
            <div className="vault-genre-bars">
              {sortedGenres.map(([genre, count]) => {
                const pct = Math.round((count / totalGenreHits) * 100);
                return (
                  <div key={genre} className="vault-genre-bar-item">
                    <div className="vault-genre-bar-header">
                      <span className="vault-genre-name">{genre}</span>
                      <span className="vault-genre-pct">{pct}%</span>
                    </div>
                    <div className="vault-genre-track">
                      <div className="vault-genre-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
