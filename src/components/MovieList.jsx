import PosterImage from "./PosterImage";

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
  const typeLabel = movie.Type === "series" ? "Series" : movie.Type === "game" ? "Game" : "Film";

  return (
    <li onClick={() => onSelectMovie(movie.imdbID)} tabIndex={0} role="button" aria-label={`Select ${movie.Title}`}>
      <div className="movie-poster-wrap">
        <PosterImage src={movie.Poster} title={movie.Title} alt={`${movie.Title} poster`} />
      </div>
      <div className="movie-info-container">
        <h3>{movie.Title}</h3>
        <div className="movie-meta-row">
          <span className="movie-year">{movie.Year}</span>
          <span className="type-badge">{typeLabel}</span>
        </div>
      </div>
    </li>
  );
}
