import PosterImage from "./PosterImage";
import { Star, Clock, X } from "lucide-react";

export default function WatchedMoviesList({ watched, onDeleteWatched, onSelectMovie }) {
  return (
    <ul className="list list-watched">
      {watched.map((movie) => (
        <WatchedMovie
          movie={movie}
          key={movie.imdbID}
          onDeleteWatched={onDeleteWatched}
          onSelectMovie={onSelectMovie}
        />
      ))}
    </ul>
  );
}

function WatchedMovie({ movie, onDeleteWatched, onSelectMovie }) {
  return (
    <li onClick={() => onSelectMovie?.(movie.imdbID)} tabIndex={0} role="button" aria-label={`View details for ${movie.title}`}>
      <div className="movie-poster-wrap">
        <PosterImage src={movie.poster} title={movie.title} alt={`${movie.title} poster`} />
      </div>
      <div className="movie-info-container">
        <h3>{movie.title}</h3>
        <div className="movie-meta-row watched-stats">
          <span className="stat-rating">
            <Star size={13} className="icon-star-filled" aria-hidden="true" /> {movie.imdbRating}
          </span>
          <span className="stat-user-rating">
            <Star size={13} className="icon-user-star" aria-hidden="true" /> {movie.userRating}
          </span>
          <span className="stat-runtime">
            <Clock size={13} aria-hidden="true" /> {movie.runtime}m
          </span>
        </div>
      </div>
      <button
        className="btn-delete"
        aria-label={`Remove ${movie.title} from vault`}
        onClick={(e) => {
          e.stopPropagation();
          onDeleteWatched(movie.imdbID);
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}
