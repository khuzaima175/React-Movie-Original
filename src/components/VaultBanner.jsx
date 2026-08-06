import { Settings, Film, Bookmark, Sparkles, CheckSquare, XSquare } from "lucide-react";

export default function VaultBanner({
  watched = [],
  watchlist = [],
  activeTab = "watched",
  onTabChange,
  isManageMode = false,
  onToggleManageMode,
  onOpenBackup,
}) {
  // Extract posters for background collage
  const collagePosters = watched
    .map((m) => m.poster || m.Poster)
    .filter((p) => p && p !== "N/A")
    .slice(0, 12);

  // Compute total runtime
  const totalMinutes = watched.reduce((acc, m) => {
    const r = parseInt(m.runtime, 10);
    return acc + (isNaN(r) ? 120 : r);
  }, 0);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  // Compute avg rating
  const userRatings = watched.map((m) => Number(m.userRating) || Number(m.imdbRating) || 8).filter(Boolean);
  const imdbRatings = watched.map((m) => Number(m.imdbRating) || 8).filter(Boolean);
  const avgUser = userRatings.length > 0 ? (userRatings.reduce((a, b) => a + b, 0) / userRatings.length).toFixed(1) : "0.0";
  const avgImdb = imdbRatings.length > 0 ? (imdbRatings.reduce((a, b) => a + b, 0) / imdbRatings.length).toFixed(1) : "0.0";
  const delta = (Number(avgUser) - Number(avgImdb)).toFixed(1);

  // Top genres for tagline
  const genreCounts = {};
  watched.forEach((m) => {
    (m.genre || "Drama").split(",").forEach((g) => {
      const name = g.trim();
      genreCounts[name] = (genreCounts[name] || 0) + 1;
    });
  });
  const topGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g);

  const genreTag = topGenres.length > 0 ? topGenres.join(" & ") : "Cinema";
  const deltaText = Number(delta) >= 0 ? `~+${delta} above IMDb` : `~${delta} vs IMDb`;

  return (
    <div className="vault-banner-hero">
      {/* Dynamic Poster Collage Backdrop */}
      <div className="vault-banner-mosaic">
        {collagePosters.length > 0 ? (
          collagePosters.map((posterSrc, idx) => (
            <div key={idx} className="mosaic-tile">
              <img src={posterSrc} alt="" aria-hidden="true" loading="lazy" />
            </div>
          ))
        ) : (
          <div className="mosaic-fallback-gradient" />
        )}
      </div>

      {/* Radial Scrim & Dark Overlay */}
      <div className="vault-banner-scrim" />

      {/* Hero Banner Content */}
      <div className="vault-banner-content">
        <div className="banner-top-row">
          <div className="banner-left">
            <div className="banner-badge">
              <Sparkles size={13} className="banner-badge-icon" aria-hidden="true" />
              <span>Personal Cinema Collection</span>
            </div>

            <h1 className="vault-banner-title">My Vault</h1>

            <p className="vault-banner-meta">
              <span>{watched.length} films</span>
              <span className="dot">•</span>
              <span>{hours}h {mins}m logged</span>
              <span className="dot">•</span>
              <span className="meta-star">★ {avgUser} avg</span>
            </p>

            {watched.length > 0 && (
              <p className="vault-banner-tagline">
                Leans <strong>{genreTag}</strong> — you rate {deltaText}.
              </p>
            )}
          </div>

          <div className="banner-right">
            <button
              className={`vault-manage-btn ${isManageMode ? "active" : ""}`}
              onClick={onToggleManageMode}
              title={isManageMode ? "Exit Manage Mode" : "Manage Vault (Select & Bulk Delete)"}
            >
              {isManageMode ? (
                <>
                  <XSquare size={16} aria-hidden="true" /> Done Selection
                </>
              ) : (
                <>
                  <CheckSquare size={16} aria-hidden="true" /> Manage Vault
                </>
              )}
            </button>

            <button
              className="vault-settings-ghost-btn"
              onClick={onOpenBackup}
              title="Backup & Portability"
            >
              <Settings size={16} aria-hidden="true" /> Portability
            </button>
          </div>
        </div>

        {/* Integrated Bottom Tab Bar */}
        <div className="vault-segmented-tabs">
          <button
            className={`tab-pill ${activeTab === "watched" ? "active" : ""}`}
            onClick={() => onTabChange("watched")}
          >
            <Film size={15} aria-hidden="true" />
            <span>Watched</span>
            <span className="tab-count-badge">{watched.length}</span>
          </button>

          <button
            className={`tab-pill ${activeTab === "watchlist" ? "active" : ""}`}
            onClick={() => onTabChange("watchlist")}
          >
            <Bookmark size={15} aria-hidden="true" />
            <span>Plan to Watch</span>
            <span className="tab-count-badge">{watchlist.length}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
