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
    const posterUrl = movie.Poster !== "N/A" ? movie.Poster : "https://via.placeholder.com/100x150/374151/9ca3af?text=No+Poster";

    return (
        <li onClick={() => onSelectMovie(movie.imdbID)}>
            <img src={posterUrl} alt={`${movie.Title} poster`} />
            <h3>{movie.Title}</h3>
            <div>
                <p>
                    <span>🗓</span>
                    <span>{movie.Year}</span>
                </p>
            </div>
        </li>
    );
}
