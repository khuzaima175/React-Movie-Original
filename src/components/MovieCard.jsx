import { motion } from "framer-motion";
import { Star, Plus, Check, Info, Trash2, CheckSquare, Square } from "lucide-react";
import PosterImage from "./PosterImage";

export default function MovieCard({
  movie,
  onSelectMovie,
  onAddWatched,
  onDeleteMovie,
  isWatched = false,
  isManageMode = false,
  isSelected = false,
  onToggleSelect,
  className = "",
}) {
  if (!movie) return null;

  const id = movie.imdbID || movie.id;
  const title = movie.Title || movie.title || "Movie";
  const poster = movie.Poster || movie.poster;
  const year = movie.Year || movie.year;
  const imdbRating = movie.imdbRating || movie.rating;
  const userRating = movie.userRating;

  // Perfect 10 badge check
  const isPerfectTen = Number(userRating) === 10 || Number(imdbRating) === 10;

  function handleQuickAdd(e) {
    e.stopPropagation();
    if (isWatched || !onAddWatched) return;
    onAddWatched({
      imdbID: id,
      title,
      year,
      poster: poster !== "N/A" ? poster : "",
      imdbRating: Number(imdbRating) || 8.0,
      runtime: 120,
      userRating: 9,
    });
  }

  function handleCardClick(e) {
    if (isManageMode) {
      e.stopPropagation();
      onToggleSelect?.(id);
    } else if (onSelectMovie) {
      onSelectMovie(id);
    }
  }

  function handleDeleteClick(e) {
    e.stopPropagation();
    onDeleteMovie?.(id);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -5, transition: { duration: 0.18 } }}
      className={`unified-movie-card ${isManageMode ? "manage-mode" : ""} ${
        isSelected ? "selected" : ""
      } ${className}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label={`View details for ${title}`}
    >
      <div className="unified-card-poster">
        <PosterImage src={poster} title={title} alt={`${title} poster`} />

        {/* Manage Selection Checkbox Pill */}
        {isManageMode && (
          <div className="card-manage-checkbox">
            {isSelected ? (
              <CheckSquare size={20} className="checkbox-icon checked" aria-hidden="true" />
            ) : (
              <Square size={20} className="checkbox-icon" aria-hidden="true" />
            )}
          </div>
        )}

        {/* Badges: Curated Rating Badge (Gold for 10s, Glass for rated) */}
        {!isManageMode && (userRating || isPerfectTen) && (
          <div
            className={`card-corner-badge ${isPerfectTen ? "badge-gold" : "badge-glass"}`}
            title={userRating ? `Your Rating: ${userRating}/10` : "Masterpiece 10"}
          >
            <Star size={11} className={isPerfectTen ? "icon-star-dark" : "icon-star-accent"} aria-hidden="true" />
            <span>{userRating ? userRating : "10"}</span>
          </div>
        )}

        {/* Hover Overlay Scrim */}
        <div className="unified-card-overlay">
          <div className="unified-overlay-top">
            <div className="overlay-ratings-group">
              {imdbRating && (
                <span className="unified-overlay-rating" title="IMDb Rating">
                  <Star size={11} className="icon-star-gold" aria-hidden="true" />
                  {imdbRating}
                </span>
              )}
              {userRating && (
                <span className="unified-overlay-user-rating" title="Your Rating">
                  ★ {userRating}
                </span>
              )}
            </div>
            {year && <span className="unified-overlay-year">{year}</span>}
          </div>

          <div className="unified-overlay-bottom">
            <h4 className="unified-overlay-title">{title}</h4>

            <div className="unified-overlay-actions">
              {!isManageMode && onAddWatched && (
                <button
                  className={`btn-card-action ${isWatched ? "added" : ""}`}
                  onClick={handleQuickAdd}
                  title={isWatched ? "In Vault" : "Add to Vault"}
                  aria-label={isWatched ? `${title} is in Vault` : `Add ${title} to Vault`}
                >
                  {isWatched ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                </button>
              )}

              {!isManageMode && onDeleteMovie && (
                <button
                  className="btn-card-action danger"
                  onClick={handleDeleteClick}
                  title="Remove from vault"
                  aria-label={`Remove ${title}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}

              {!isManageMode && (
                <button
                  className="btn-card-action ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectMovie?.(id);
                  }}
                  title="View details"
                  aria-label={`Details for ${title}`}
                >
                  <Info size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
