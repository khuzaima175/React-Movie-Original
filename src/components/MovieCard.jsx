import { motion } from "framer-motion";
import { Star, Plus, Check, Info, Trash2, CheckSquare, Square } from "lucide-react";
import PosterImage from "./PosterImage";
import { buildQuickAddWatchedMovie } from "../services/csvImport";

export default function MovieCard({
  movie,
  onSelectMovie,
  onQuickAdd,
  onAddWatched,
  onDeleteMovie,
  isWatched = false,
  isManageMode = false,
  isSelected = false,
  onToggleSelect,
  showCaption = false,
  className = ""
}) {
  if (!movie) return null;

  const id = movie.imdbID || movie.id;
  const title = movie.Title || movie.title || "Movie";
  const poster = movie.Poster || movie.poster;
  const year = movie.Year || movie.year;
  const imdbRating = movie.imdbRating || movie.rating;
  const userRating = movie.userRating;
  const numericUserRating = Number(userRating);
  const hasUserRating = Number.isFinite(numericUserRating) && numericUserRating > 0;

  function handleQuickAdd(e) {
    e.stopPropagation();
    if (isWatched) return;
    if (onQuickAdd) {
      onQuickAdd(movie);
      return;
    }
    if (!onAddWatched) return;
    onAddWatched(buildQuickAddWatchedMovie(movie));
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2, transition: { duration: 0.16 } }}
      className={`unified-movie-card ${isManageMode ? "manage-mode" : ""} ${
        isSelected ? "selected" : ""
      } ${className}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label={`View details for ${title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick(e);
        }
      }}
    >
      <div className="unified-card-poster">
        <PosterImage src={poster} title={title} alt={`${title} poster`} />

        {isManageMode && (
          <div className="card-manage-checkbox">
            {isSelected ? (
              <CheckSquare size={18} aria-hidden="true" />
            ) : (
              <Square size={18} aria-hidden="true" />
            )}
          </div>
        )}

        <div className="unified-card-overlay">
          <div className="unified-overlay-top">
            <div className="overlay-ratings-group">
              {hasUserRating && (
                <span className="unified-overlay-user-rating" title="Your Rating">
                  <Star size={11} fill="currentColor" aria-hidden="true" />
                  <span>{numericUserRating}</span>
                </span>
              )}
              {imdbRating && imdbRating !== "N/A" && (
                <span className="unified-overlay-rating" title="IMDb Rating">
                  <span>{imdbRating}</span>
                </span>
              )}
            </div>
            {year && year !== "N/A" && <span className="unified-overlay-year">{year}</span>}
          </div>

          <div className="unified-overlay-bottom">
            <h4 className="unified-overlay-title">{title}</h4>

            <div className="unified-overlay-actions">
              {!isManageMode && (onQuickAdd || onAddWatched) && (
                <button
                  type="button"
                  className={`btn-card-action ${isWatched ? "added" : ""}`}
                  onClick={handleQuickAdd}
                  title={isWatched ? "In Vault" : "Rate or Save"}
                  aria-label={isWatched ? `${title} is in Vault` : `Rate or save ${title}`}
                >
                  {isWatched ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                </button>
              )}

              {!isManageMode && onDeleteMovie && (
                <button
                  type="button"
                  className="btn-card-action danger"
                  onClick={handleDeleteClick}
                  title="Remove"
                  aria-label={`Remove ${title}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}

              {!isManageMode && (
                <button
                  type="button"
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

      {showCaption && (
        <div className="poster-caption">
          <h4 className="poster-caption-title">{title}</h4>
          <div className="poster-caption-meta">
            <span>{year && year !== "N/A" ? year : "—"}</span>
            {hasUserRating ? (
              <span className="poster-caption-rating" title="Your Rating">
                <Star size={11} fill="currentColor" aria-hidden="true" />
                <span>{numericUserRating}</span>
              </span>
            ) : imdbRating && imdbRating !== "N/A" ? (
              <span className="poster-caption-imdb" title="IMDb Rating">
                <Star size={11} fill="currentColor" aria-hidden="true" />
                <span>{imdbRating}</span>
              </span>
            ) : null}
          </div>
        </div>
      )}
    </motion.div>
  );
}
