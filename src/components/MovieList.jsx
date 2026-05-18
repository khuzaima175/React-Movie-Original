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
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <h3>{movie.Title}</h3>
        <p>
          <span>🗓</span>
          <span>{movie.Year}</span>
          <span style={{ marginLeft: "0.8rem", fontSize: "1.1rem", color: "var(--text-dim)", background: "rgba(255,255,255,0.06)", padding: "0.15rem 0.6rem", borderRadius: "2rem", border: "1px solid var(--border)" }}>
            {typeLabel}
          </span>
        </p>
      </div>
    </li>
  );
}
