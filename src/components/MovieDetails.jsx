import { useState, useEffect } from "react";
import StarRating from "./StarRating";
import { MovieDetailsSkeleton } from "./Loader";
import ErrorMessage from "./ErrorMessage";
import PosterImage from "./PosterImage";
import { ArrowLeft, Star, Bookmark, Plus, Check, Award, Film, User, Clapperboard } from "lucide-react";

const getOmdbKey = () => {
  const key = import.meta.env.VITE_OMDB_KEY;
  if (!key || key === "undefined" || key === "null" || key.trim() === "") {
    return "b78bdecd";
  }
  return key.trim();
};
const KEY = getOmdbKey();

export default function MovieDetails({ selectedId, onCloseMovie, onAddWatched, onAddToWatchlist, watched = [], watchlist = [] }) {
  const [movie, setMovie] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [userRating, setUserRating] = useState(8);
  const [userNote, setUserNote] = useState("");

  const isWatched = (watched || []).some((m) => m.imdbID === selectedId);
  const isWatchlist = (watchlist || []).some((m) => m.imdbID === selectedId);

  const watchedItem = (watched || []).find((m) => m.imdbID === selectedId);
  const watchedUserRating = watchedItem?.userRating;
  const watchedUserNote = watchedItem?.userNote;

  const {
    Title: title,
    Year: year,
    Poster: poster,
    Runtime: runtime,
    imdbRating,
    Metascore: metascore,
    Plot: plot,
    Released: released,
    Actors: actors,
    Director: director,
    Writer: writer,
    Genre: genre,
    Rated: rated,
  } = movie;

  function handleAdd() {
    const shortPlot = plot ? plot.split(" ").slice(0, 15).join(" ") + "..." : "";

    const newWatchedMovie = {
      imdbID: selectedId,
      title,
      year,
      poster: poster !== "N/A" ? poster : "",
      imdbRating: Number(imdbRating) || 8.0,
      runtime: Number(runtime?.split(" ")[0] || 120),
      userRating: userRating || 8,
      userNote,
      director,
      writer,
      genre,
      shortPlot,
    };

    onAddWatched(newWatchedMovie);
    onCloseMovie();
  }

  function handleAddToWatchlistClick() {
    const newWatchlistMovie = {
      imdbID: selectedId,
      title,
      year,
      poster: poster !== "N/A" ? poster : "",
      imdbRating: Number(imdbRating) || 8.0,
      runtime: Number(runtime?.split(" ")[0] || 120),
      genre,
    };
    onAddToWatchlist(newWatchlistMovie);
    onCloseMovie();
  }

  useEffect(() => {
    async function getMovieDetails() {
      try {
        setIsLoading(true);
        setError("");
        let res = await fetch(`https://www.omdbapi.com/?apikey=${KEY}&i=${selectedId}`);

        if (!res.ok || res.status === 401) {
          if (KEY !== "b78bdecd") {
            res = await fetch(`https://www.omdbapi.com/?apikey=b78bdecd&i=${selectedId}`);
          }
        }

        if (!res.ok) throw new Error("Failed to fetch movie details");

        let data = await res.json();
        if (data.Response === "False") throw new Error(data.Error);
        setMovie(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }
    if (selectedId) getMovieDetails();
  }, [selectedId]);

  useEffect(() => {
    if (!title) return;
    document.title = `${title} | CinemaVault`;
    return () => {
      document.title = "CinemaVault";
    };
  }, [title]);

  useEffect(() => {
    function callback(e) {
      if (e.code === "Escape") {
        onCloseMovie();
      }
    }
    document.addEventListener("keydown", callback);
    return () => document.removeEventListener("keydown", callback);
  }, [onCloseMovie]);

  const actorsList = actors ? actors.split(",").map((a) => a.trim()) : [];
  const genreList = genre ? genre.split(",").map((g) => g.trim()) : [];

  return (
    <div className="netflix-detail-modal" aria-label={`Movie details for ${title || "Film"}`}>
      {isLoading ? (
        <MovieDetailsSkeleton />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <div className="netflix-modal-card">
          {/* Top Bar Navigation */}
          <div className="netflix-modal-topbar">
            <button className="btn-modal-back" onClick={onCloseMovie} aria-label="Go back">
              <ArrowLeft size={18} aria-hidden="true" />
              <span>Back</span>
            </button>
          </div>

          {/* Main 2-Column Content Grid */}
          <div className="netflix-modal-body">
            {/* Left Column: Poster Card & Personal Rating Box */}
            <div className="netflix-modal-left">
              <div className="netflix-modal-poster-wrap">
                <PosterImage src={poster} title={title} alt={`${title} poster`} />
              </div>

              {/* Action / Rating Box */}
              <div className="netflix-user-rating-box">
                {!isWatched ? (
                  <>
                    <h4 className="rating-box-title">Rate & Save to Vault</h4>
                    <StarRating
                      maxRating={10}
                      size={22}
                      onSetRating={setUserRating}
                      defaultRating={8}
                    />

                    <textarea
                      className="user-note-input"
                      placeholder="Personal notes (e.g. 'Epic score', 'Great twist')..."
                      value={userNote}
                      onChange={(e) => setUserNote(e.target.value)}
                      aria-label="Personal notes on movie"
                    />

                    <div className="rating-box-actions">
                      <button className="btn-vault-primary" onClick={handleAdd} aria-label="Add to watched list">
                        <Plus size={16} aria-hidden="true" /> Add to Vault
                      </button>

                      {!isWatchlist ? (
                        <button className="btn-vault-secondary" onClick={handleAddToWatchlistClick} aria-label="Add to watchlist">
                          <Bookmark size={16} aria-hidden="true" /> Plan to Watch
                        </button>
                      ) : (
                        <span className="watchlist-badge">
                          <Bookmark size={14} aria-hidden="true" /> Queued in Watchlist
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="vault-rated-badge-box">
                    <div className="vault-rated-header">
                      <Check size={18} className="icon-emerald" aria-hidden="true" />
                      <span>In Your Vault</span>
                    </div>
                    <div className="vault-user-score">
                      <span>Your Rating:</span>
                      <span className="user-score-gold">★ {watchedUserRating} / 10</span>
                    </div>
                    {watchedUserNote && (
                      <p className="vault-user-note">"{watchedUserNote}"</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Cinema Details & Credits */}
            <div className="netflix-modal-right">
              {/* Title & Badges */}
              <div className="netflix-title-block">
                <h1 className="netflix-movie-title">{title}</h1>
                
                <div className="netflix-meta-badges">
                  <span className="meta-badge-item">{released || year}</span>
                  {runtime && <span className="meta-badge-item">{runtime}</span>}
                  {rated && rated !== "N/A" && <span className="meta-badge-rated">{rated}</span>}
                  
                  {imdbRating && (
                    <span className="meta-badge-imdb">
                      <Star size={14} className="icon-star-gold" aria-hidden="true" />
                      {imdbRating} IMDb
                    </span>
                  )}
                  {metascore && metascore !== "N/A" && (
                    <span className="meta-badge-meta">
                      <Award size={14} aria-hidden="true" />
                      {metascore} Metascore
                    </span>
                  )}
                </div>
              </div>

              {/* Genres */}
              <div className="netflix-genres-row">
                {genreList.map((g) => (
                  <span key={g} className="netflix-genre-tag">
                    {g}
                  </span>
                ))}
              </div>

              {/* Plot Synopsis */}
              <div className="netflix-plot-block">
                <h3 className="section-subtitle">Synopsis</h3>
                <p className="netflix-plot-text">{plot}</p>
              </div>

              {/* Credits & Cast */}
              <div className="netflix-credits-grid">
                {director && director !== "N/A" && (
                  <div className="credit-item">
                    <span className="credit-label">
                      <Clapperboard size={14} aria-hidden="true" /> Director
                    </span>
                    <span className="credit-value">{director}</span>
                  </div>
                )}

                {writer && writer !== "N/A" && (
                  <div className="credit-item">
                    <span className="credit-label">
                      <Film size={14} aria-hidden="true" /> Writers
                    </span>
                    <span className="credit-value">{writer}</span>
                  </div>
                )}

                {actorsList.length > 0 && (
                  <div className="credit-item full-row">
                    <span className="credit-label">
                      <User size={14} aria-hidden="true" /> Starring Cast
                    </span>
                    <div className="cast-chips-wrap">
                      {actorsList.map((actor) => (
                        <span key={actor} className="cast-chip">
                          {actor}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
