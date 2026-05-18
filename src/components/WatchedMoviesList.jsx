export default function WatchedMoviesList({ watched, onDeleteWatched }) {
  return (
    <ul className="list list-watched">
      {watched.map((movie) => (
        <WatchedMovie
          movie={movie}
          key={movie.imdbID}
          onDeleteWatched={onDeleteWatched}
        />
      ))}
    </ul>
  );
}

function WatchedMovie({ movie, onDeleteWatched }) {
  return (
    <li style={{ position: "relative" }}>
      <img src={movie.poster} alt={`${movie.title} poster`} />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h3>{movie.title}</h3>
        <div style={{ display: "flex", gap: "1.4rem", flexWrap: "wrap" }}>
          <p>
            <span>⭐</span>
            <span style={{ color: "var(--gold)", fontWeight: 600 }}>{movie.imdbRating}</span>
          </p>
          <p>
            <span>🌟</span>
            <span style={{ color: "var(--gold-light)", fontWeight: 600 }}>{movie.userRating}</span>
          </p>
          <p>
            <span style={{ color: "var(--text-dim)" }}>⏳ {movie.runtime} min</span>
          </p>
        </div>
      </div>
      <button
        className="btn-delete"
        onClick={() => onDeleteWatched(movie.imdbID)}
      >
        ✕
      </button>
    </li>
  );
}
