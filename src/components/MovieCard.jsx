import { motion } from "framer-motion";
import { Star, Plus, Check, Info, Trash2, CheckSquare, Square, GitCompareArrows } from "lucide-react";
import PosterImage from "./PosterImage";
import { useOptionalApp } from "../context/AppContext";
import { buildQuickAddWatchedMovie } from "../services/csvImport";
import { isSameMovie } from "../services/movieIdentity";
import { useScrollReveal } from "../hooks/useScrollReveal";

export default function MovieCard({
  movie,
  onSelectMovie,
  onQuickAdd,
  onAddWatched,
  onDeleteMovie,
  onToggleCompare,
  isInCompare,
  showCompareButton = true,
  isWatched = false,
  isManageMode = false,
  isSelected = false,
  onToggleSelect,
  showCaption = false,
  animateOnScroll = false,
  revealIndex = 0,
  className = ""
}) {
  const appCtx = useOptionalApp();
  const [revealRef, isRevealed] = useScrollReveal({
    rootMargin: "120px 0px 40px 0px",
    threshold: 0,
    disabled: !animateOnScroll || !movie
  });

  if (!movie) return null;

  const resolvedToggleCompare = onToggleCompare || appCtx?.toggleCompare || null;
  const resolvedIsInCompare =
    typeof isInCompare === "boolean"
      ? isInCompare
      : Boolean(appCtx?.compareItems?.some((item) => isSameMovie(item, movie)));

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
      ref={animateOnScroll ? revealRef : undefined}
      initial={animateOnScroll ? { opacity: 0, y: 20 } : { opacity: 1, y: 0 }}
      animate={{
        opacity: !animateOnScroll || isRevealed ? 1 : 0,
        y: !animateOnScroll || isRevealed ? 0 : 20
      }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        duration: 0.42,
        delay: animateOnScroll ? Math.min((revealIndex % 7) * 0.032, 0.2) : 0,
        ease: [0.22, 1, 0.36, 1]
      }}
      whileHover={{ y: -3, transition: { duration: 0.16 } }}
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

              {!isManageMode && showCompareButton && resolvedToggleCompare && (
                <button
                  type="button"
                  className={`btn-card-action ${resolvedIsInCompare ? "added" : "ghost"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    resolvedToggleCompare(movie);
                  }}
                  title={resolvedIsInCompare ? "Remove from Compare" : "Add to Compare"}
                  aria-pressed={resolvedIsInCompare}
                  aria-label={resolvedIsInCompare ? `Remove ${title} from Compare` : `Add ${title} to Compare`}
                >
                  {resolvedIsInCompare ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <GitCompareArrows size={14} aria-hidden="true" />
                  )}
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
