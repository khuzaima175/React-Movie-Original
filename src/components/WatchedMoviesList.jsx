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
    <li onClick={() => onSelectMovie?.(movie.imdbID)}>
      <img src={movie.poster} alt={`${movie.title} poster`} />
      <div className="movie-info-container">
        <h3>{movie.title}</h3>
        <div className="movie-meta-row watched-stats">
          <span className="stat-rating">⭐ {movie.imdbRating}</span>
          <span className="stat-user-rating">🌟 {movie.userRating}</span>
          <span className="stat-runtime">⏳ {movie.runtime}m</span>
        </div>
      </div>
      <button
        className="btn-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDeleteWatched(movie.imdbID);
        }}
      >
        ✕
      </button>
    </li>
  );
}
