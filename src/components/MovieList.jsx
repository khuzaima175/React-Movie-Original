export default function MovieList({ movies, onSelectMovie }) {
  return (
    <ul className="list list-movies">
      {movies?.map((movie) => (
        <Movie movie={movie} key={movie.imdbID} onSelectMovie={onSelectMovie} />
      ))}
    </ul>
  );
}

function Movie({ movie, onSelectMovie }) {
  const posterUrl =
    movie.Poster !== "N/A"
      ? movie.Poster
      : "https://via.placeholder.com/100x150/0e1118/7a7368?text=No+Poster";

  const typeLabel = movie.Type === "series" ? "Series" : movie.Type === "game" ? "Game" : "Film";

  return (
    <li onClick={() => onSelectMovie(movie.imdbID)}>
      <img src={posterUrl} alt={`${movie.Title} poster`} />
      <div className="movie-info-container">
        <h3>{movie.Title}</h3>
        <div className="movie-meta-row">
          <span className="movie-year">🗓 {movie.Year}</span>
          <span className="type-badge">{typeLabel}</span>
        </div>
      </div>
    </li>
  );
}
