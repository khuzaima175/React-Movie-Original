import PosterImage from "./PosterImage";
import { Star, Clock, X, CheckSquare, Square, Film } from "lucide-react";

export default function WatchedMoviesList({
  watched = [],
  onDeleteWatched,
  onSelectMovie,
  isManageMode = false,
  selectedIds = [],
  onToggleSelect,
}) {
  return (
    <div className="vault-list-table-wrap">
      <div className="vault-list-header-row">
        {isManageMode && <div className="list-col-check" />}
        <div className="list-col-poster">Film</div>
        <div className="list-col-title">Title & Details</div>
        <div className="list-col-genres">Genres</div>
        <div className="list-col-runtime">Runtime</div>
        <div className="list-col-ratings">Ratings</div>
        <div className="list-col-actions">Actions</div>
      </div>

      <ul className="list list-watched-v2">
        {watched.map((movie) => {
          const id = movie.imdbID || movie.id;
          const isSelected = selectedIds.includes(id);

          return (
            <WatchedMovieRow
              key={id}
              movie={movie}
              onDeleteWatched={onDeleteWatched}
              onSelectMovie={onSelectMovie}
              isManageMode={isManageMode}
              isSelected={isSelected}
              onToggleSelect={onToggleSelect}
            />
          );
        })}
      </ul>
    </div>
  );
}

function WatchedMovieRow({
  movie,
  onDeleteWatched,
  onSelectMovie,
  isManageMode,
  isSelected,
  onToggleSelect,
}) {
  const id = movie.imdbID || movie.id;
  const title = movie.title || movie.Title || "Movie";
  const poster = movie.poster || movie.Poster;
  const year = movie.year || movie.Year;
  const imdbRating = movie.imdbRating || movie.rating;
  const userRating = movie.userRating;
  const runtime = parseInt(movie.runtime, 10) || 120;
  const genreList = (movie.genre || "Drama").split(",").map((g) => g.trim()).slice(0, 3);

  function handleRowClick(e) {
    if (isManageMode) {
      e.stopPropagation();
      onToggleSelect?.(id);
    } else {
      onSelectMovie?.(id);
    }
  }

  return (
    <li
      className={`vault-list-row ${isManageMode ? "manage-mode" : ""} ${isSelected ? "selected" : ""}`}
      onClick={handleRowClick}
      tabIndex={0}
      role="button"
      aria-label={`View details for ${title}`}
    >
      {isManageMode && (
        <div className="list-col-check">
          {isSelected ? (
            <CheckSquare size={18} className="checkbox-icon checked" aria-hidden="true" />
          ) : (
            <Square size={18} className="checkbox-icon" aria-hidden="true" />
          )}
        </div>
      )}

      <div className="list-col-poster">
        <div className="row-poster-thumb">
          <PosterImage src={poster} title={title} alt="" />
        </div>
      </div>

      <div className="list-col-title">
        <h4 className="row-title">{title}</h4>
        <span className="row-year">{year}</span>
      </div>

      <div className="list-col-genres">
        <div className="row-genre-chips">
          {genreList.map((g) => (
            <span key={g} className="row-genre-chip">
              {g}
            </span>
          ))}
        </div>
      </div>

      <div className="list-col-runtime">
        <span className="row-runtime-pill">
          <Clock size={12} aria-hidden="true" /> {runtime}m
        </span>
      </div>

      <div className="list-col-ratings">
        <div className="row-ratings-group">
          {userRating && (
            <span className="row-user-rating-badge" title="Your Rating">
              ★ {userRating}
            </span>
          )}
          {imdbRating && (
            <span className="row-imdb-badge" title="IMDb Rating">
              <Star size={11} className="icon-star-gold" aria-hidden="true" /> {imdbRating}
            </span>
          )}
        </div>
      </div>

      <div className="list-col-actions">
        {!isManageMode && (
          <button
            className="btn-delete-row"
            aria-label={`Remove ${title} from vault`}
            title="Remove from Vault"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteWatched?.(id);
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}
