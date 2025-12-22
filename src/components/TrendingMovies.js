import { useState, useEffect } from "react";

const KEY = process.env.REACT_APP_OMDB_KEY || "b78bdecd";

// Popular movie titles to show as suggestions
const TRENDING_SEARCHES = [
    "Inception",
    "The Dark Knight",
    "Interstellar",
    "Parasite",
    "Oppenheimer",
    "Dune",
    "Avatar",
    "The Matrix"
];

export default function TrendingMovies({ onSelectMovie }) {
    const [trendingMovies, setTrendingMovies] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchTrending() {
            setIsLoading(true);
            const movies = [];

            // Fetch 4 random trending movies
            const shuffled = [...TRENDING_SEARCHES].sort(() => 0.5 - Math.random());
            const selected = shuffled.slice(0, 4);

            for (const title of selected) {
                try {
                    const res = await fetch(
                        `https://www.omdbapi.com/?apikey=${KEY}&t=${encodeURIComponent(title)}`
                    );
                    const data = await res.json();
                    if (data.Response === "True") {
                        movies.push(data);
                    }
                } catch (err) {
                    console.error("Error fetching trending:", err);
                }
            }

            setTrendingMovies(movies);
            setIsLoading(false);
        }

        fetchTrending();
    }, []);

    if (isLoading) {
        return (
            <div className="trending-section">
                <h3 className="trending-title">🔥 Popular Movies</h3>
                <div className="trending-grid">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="trending-card skeleton">
                            <div className="skeleton-poster-large"></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="trending-section">
            <h3 className="trending-title">🔥 Popular Movies</h3>
            <div className="trending-grid">
                {trendingMovies.map((movie) => (
                    <div
                        key={movie.imdbID}
                        className="trending-card"
                        onClick={() => onSelectMovie(movie.imdbID)}
                    >
                        <img
                            src={movie.Poster !== "N/A" ? movie.Poster : "https://via.placeholder.com/150x225/374151/9ca3af?text=No+Poster"}
                            alt={movie.Title}
                        />
                        <div className="trending-info">
                            <p className="trending-name">{movie.Title}</p>
                            <p className="trending-meta">
                                <span>⭐ {movie.imdbRating}</span>
                                <span>{movie.Year}</span>
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
