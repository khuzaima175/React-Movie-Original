import { useState, useEffect } from "react";
import StarRating from "../StarRating";
import { MovieDetailsSkeleton } from "./Loader";
import ErrorMessage from "./ErrorMessage";

const KEY = process.env.REACT_APP_OMDB_KEY || "b78bdecd";

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
        Genre: genre,
    } = movie;

    const posterUrl = poster !== "N/A" ? poster : "https://via.placeholder.com/300x450/374151/9ca3af?text=No+Poster";

    function handleAdd() {
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
            genre,
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
                    const res = await fetch(
                        `https://www.omdbapi.com/?apikey=${KEY}&i=${selectedId}`
                    );

                    if (!res.ok) throw new Error("Failed to fetch movie details");

                    const data = await res.json();

                    if (data.Response === "False") throw new Error(data.Error);

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
                document.title = "Movie Tracker";
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
                                    <StarRating
                                        maxRating={10}
                                        size={24}
                                        onSetRating={setUserRating}
                                    />
                                    {userRating > 0 && (
                                        <div style={{ width: '100%', marginBottom: '1rem', marginTop: '1rem' }}>
                                            <textarea
                                                className="user-note-input"
                                                placeholder="Why do you like/dislike this? (Optional - Helps AI)"
                                                value={userNote}
                                                onChange={(e) => setUserNote(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '1rem',
                                                    borderRadius: '8px',
                                                    border: '1px solid #ffffff20',
                                                    background: '#ffffff10',
                                                    color: '#fff',
                                                    resize: 'vertical',
                                                    minHeight: '60px',
                                                    fontFamily: 'inherit'
                                                }}
                                            />
                                            <button className="btn-add" onClick={handleAdd}>
                                                + Add to list
                                            </button>
                                        </div>
                                    )}
                                    {!isWatchlist && (
                                        <button className="btn-add btn-watchlist" style={{ marginTop: "0.5rem", backgroundColor: "var(--color-accent)" }} onClick={handleAddToWatchlistClick}>
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
