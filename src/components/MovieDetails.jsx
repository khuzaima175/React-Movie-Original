import { useState, useEffect } from "react";
import StarRating from "./StarRating";
import { MovieDetailsSkeleton } from "./Loader";
import ErrorMessage from "./ErrorMessage";

const getOmdbKey = () => {
    const key = import.meta.env.VITE_OMDB_KEY;
    if (!key || key === "undefined" || key === "null" || key.trim() === "") {
        return "b78bdecd";
    }
    return key.trim();
};
const KEY = getOmdbKey();

export default function MovieDetails({ selectedId, onCloseMovie, onAddWatched, onAddToWatchlist, watched, watchlist }) {
    const [movie, setMovie] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [userRating, setUserRating] = useState("");
    const [userNote, setUserNote] = useState("");

    const isWatched = watched.map((movie) => movie.imdbID).includes(selectedId);
    const isWatchlist = watchlist ? watchlist.map(m => m.imdbID).includes(selectedId) : false;

    const watchedUserRating = watched.find(
        (movie) => movie.imdbID === selectedId
    )?.userRating;

    const watchedUserNote = watched.find(
        (movie) => movie.imdbID === selectedId
    )?.userNote;

    const {
        Title: title,
        Year: year,
        Poster: poster,
        Runtime: runtime,
        imdbRating,
        Plot: plot,
        Released: released,
        Actors: actors,
        Director: director,
        Writer: writer,
        Genre: genre,
    } = movie;

    const posterUrl = poster !== "N/A" ? poster : "https://via.placeholder.com/300x450/374151/9ca3af?text=No+Poster";

    function handleAdd() {
        // Capture first 15 words of plot for AI theme detection
        const shortPlot = plot ? plot.split(" ").slice(0, 15).join(" ") + "..." : "";

        const newWatchedMovie = {
            imdbID: selectedId,
            title,
            year,
            poster: posterUrl,
            imdbRating: Number(imdbRating),
            runtime: Number(runtime?.split(" ")[0] || 0),
            userRating,
            userNote,
            director,
            writer,
            genre,
            shortPlot, // For AI theme analysis (e.g., "Memory Loss", "Time Loop")
        };

        onAddWatched(newWatchedMovie);
        onCloseMovie();
    }

    function handleAddToWatchlistClick() {
        const newWatchlistMovie = {
            imdbID: selectedId,
            title,
            year,
            poster: posterUrl,
            imdbRating: Number(imdbRating),
            runtime: Number(runtime?.split(" ")[0] || 0),
            // No userRating or note for watchlist
        };
        onAddToWatchlist(newWatchlistMovie);
        onCloseMovie();
    }

    useEffect(
        function () {
            async function getMovieDetails() {
                try {
                    setIsLoading(true);
                    setError("");
                    let res = await fetch(
                        `https://www.omdbapi.com/?apikey=${KEY}&i=${selectedId}`
                    );

                    if (!res.ok || res.status === 401) {
                        if (KEY !== "b78bdecd") {
                            console.log("⚠️ Configured OMDb key failed, retrying details with default fallback key...");
                            res = await fetch(
                                `https://www.omdbapi.com/?apikey=b78bdecd&i=${selectedId}`
                            );
                        }
                    }

                    if (!res.ok) throw new Error("Failed to fetch movie details");

                    let data = await res.json();

                    if (data.Response === "False") {
                        if (data.Error && (data.Error.includes("key") || data.Error.includes("credential")) && KEY !== "b78bdecd") {
                            console.log("⚠️ OMDb response reports key error, retrying details with default fallback key...");
                            const fallbackRes = await fetch(
                                `https://www.omdbapi.com/?apikey=b78bdecd&i=${selectedId}`
                            );
                            if (fallbackRes.ok) {
                                const fallbackData = await fallbackRes.json();
                                if (fallbackData.Response === "False") throw new Error(fallbackData.Error);
                                setMovie(fallbackData);
                                return;
                            }
                        }
                        throw new Error(data.Error);
                    }

                    setMovie(data);
                } catch (err) {
                    setError(err.message);
                } finally {
                    setIsLoading(false);
                }
            }
            getMovieDetails();
        },
        [selectedId]
    );

    useEffect(
        function () {
            if (!title) return;
            document.title = `Movie | ${title}`;

            return function () {
                document.title = "CinemaVault";
            };
        },
        [title]
    );

    useEffect(
        function () {
            function callback(e) {
                if (e.code === "Escape") {
                    onCloseMovie();
                }
            }

            document.addEventListener("keydown", callback);

            return function () {
                document.removeEventListener("keydown", callback);
            };
        },
        [onCloseMovie]
    );

    return (
        <div className="details">
            {isLoading ? (
                <MovieDetailsSkeleton />
            ) : error ? (
                <ErrorMessage message={error} />
            ) : (
                <>
                    <header>
                        <button className="btn-back" onClick={onCloseMovie}>
                            &larr;
                        </button>
                        <img src={posterUrl} alt={`Poster of ${title}`} />
                        <div className="details-overview">
                            <h2>{title}</h2>
                            <p>
                                {released} &bull; {runtime}
                            </p>
                            <p>{genre}</p>
                            <p>
                                <span>⭐</span>
                                {imdbRating} IMDb rating
                            </p>
                        </div>
                    </header>

                    <section>
                        <div className="rating">
                            {!isWatched ? (
                                <>
                                    {isWatchlist && (
                                        <div className="watchlist-badge">
                                            📋 Plan to Watch
                                        </div>
                                    )}
                                    <StarRating
                                        maxRating={10}
                                        size={24}
                                        onSetRating={setUserRating}
                                    />
                                    {userRating > 0 && (
                                        <div style={{ width: '100%', marginBottom: '1rem', marginTop: '1rem' }}>
                                            <textarea
                                                className="user-note-input"
                                                placeholder="What hooked you? (e.g., 'The plot twist', 'The cinematography', 'Too slow')"
                                                value={userNote}
                                                onChange={(e) => setUserNote(e.target.value)}
                                            />
                                            <button className="btn-add" onClick={handleAdd}>
                                                + Add to list
                                            </button>
                                        </div>
                                    )}
                                    {!isWatchlist && (
                                        <button className="btn-add btn-watchlist" onClick={handleAddToWatchlistClick}>
                                            + Plan to Watch
                                        </button>
                                    )}
                                </>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                    <p>
                                        You rated this movie {watchedUserRating} <span>⭐</span>
                                    </p>
                                    {watchedUserNote && (
                                        <p style={{ fontStyle: 'italic', opacity: 0.8, fontSize: '1.4rem' }}>
                                            "{watchedUserNote}"
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                        <p>
                            <em>{plot}</em>
                        </p>
                        <p>Starring {actors}</p>
                        <p>Directed by {director}</p>
                    </section>
                </>
            )}
        </div>
    );
}
