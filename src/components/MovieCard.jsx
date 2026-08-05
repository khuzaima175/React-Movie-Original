import { Star, Plus, Check, Info } from "lucide-react";
import PosterImage from "./PosterImage";

export default function MovieCard({ movie, onSelectMovie, onAddWatched, isWatched = false, className = "" }) {
  if (!movie) return null;

  const id = movie.imdbID || movie.id;
  const title = movie.Title || movie.title || "Movie";
  const poster = movie.Poster || movie.poster;
  const year = movie.Year || movie.year;
  const rating = movie.imdbRating || movie.rating;

  function handleQuickAdd(e) {
    e.stopPropagation();
    if (isWatched || !onAddWatched) return;
    onAddWatched({
      imdbID: id,
      title,
      year,
      poster: poster !== "N/A" ? poster : "",
      imdbRating: Number(rating) || 8.0,
      runtime: 120,
      userRating: 9,
    });
  }

  function handleCardClick() {
    if (onSelectMovie) {
      onSelectMovie(id);
    }
  }

  return (
    <div
      className={`unified-movie-card ${className}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label={`View details for ${title}`}
    >
      <div className="unified-card-poster">
        <PosterImage src={poster} title={title} alt={`${title} poster`} />
        
        {/* Hover Overlay Scrim */}
        <div className="unified-card-overlay">
          <div className="unified-overlay-top">
            {rating && (
              <span className="unified-overlay-rating" aria-label={`Rating: ${rating} out of 10`}>
                <Star size={12} className="icon-star-gold" aria-hidden="true" />
                {rating}
              </span>
            )}
            {year && <span className="unified-overlay-year">{year}</span>}
          </div>

          <div className="unified-overlay-bottom">
            <h4 className="unified-overlay-title">{title}</h4>
            
            <div className="unified-overlay-actions">
              {onAddWatched && (
                <button
                  className={`btn-card-action ${isWatched ? "added" : ""}`}
                  onClick={handleQuickAdd}
                  title={isWatched ? "In Vault" : "Add to Vault"}
                  aria-label={isWatched ? `${title} is in Vault` : `Add ${title} to Vault`}
                >
                  {isWatched ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                </button>
              )}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
