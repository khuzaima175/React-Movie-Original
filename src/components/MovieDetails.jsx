import { useState, useEffect, useMemo } from "react";
import { MovieDetailsSkeleton } from "./Loader";
import ErrorMessage from "./ErrorMessage";
import PosterImage from "./PosterImage";
import { useApp } from "../context/AppContext";
import { findTmdbByImdbId, findTmdbByTitleAndYear, fetchTmdbMovieDetails, getFallbackPoster } from "../services/tmdbService";
import { fetchOmdbJson } from "../services/apiTransport";
import { RATING_TIERS, getRatingTier } from "../services/ratingTiers";
import { findMatchingMovie } from "../services/movieIdentity";
import {
  ArrowLeft,
  Star,
  Bookmark,
  Plus,
  Check,
  Award,
  Film,
  User,
  Clapperboard,
  Play,
  Tv,
  Sparkles,
  DollarSign,
  Globe,
  Calendar,
  Clock,
  ShieldAlert,
  Camera,
  Music,
  Tag,
  Edit3,
  ExternalLink,
  Flame,
  CheckCircle2
} from "lucide-react";

// Cache enriched detail objects for this session
const enrichedDetailsSessionCache = new Map();

const QUICK_TAGS = [
  "Masterpiece",
  "MindBlowing",
  "GreatActing",
  "Cinematography",
  "EpicScore",
  "PlotTwist",
  "MustRewatch",
  "Emotional",
  "CultClassic",
  "Iconic"
];

export default function MovieDetails({
  selectedId,
  onCloseMovie,
  onAddWatched,
  onAddToWatchlist,
  onRemoveWatchlist,
  watched = [],
  watchlist = []
}) {
  const { userRegion, addToWatchlist: contextAddToWatchlist, deleteWatchlist: contextDeleteWatchlist } = useApp();
  const [movie, setMovie] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [userRating, setUserRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [userNote, setUserNote] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Match across tmdb_<id>, numeric tmdbId, imdbID, and title+year variants
  const movieIdentity = useMemo(
    () => (!isLoading && movie ? { ...movie, selectedId } : { selectedId }),
    [isLoading, movie, selectedId]
  );

  const watchedItem = useMemo(
    () => findMatchingMovie(watched, movieIdentity),
    [watched, movieIdentity]
  );

  const watchlistItem = useMemo(
    () => findMatchingMovie(watchlist, movieIdentity),
    [watchlist, movieIdentity]
  );

  const isWatched = Boolean(watchedItem);
  const isWatchlist = Boolean(watchlistItem);

  // Sync state when watched item changes or opens
  useEffect(() => {
    if (watchedItem) {
      const existingRating = Number(watchedItem.userRating);
      setUserRating(Number.isFinite(existingRating) && existingRating > 0 ? existingRating : 0);
      setUserNote(watchedItem.userNote || "");
    } else {
      setUserRating(0);
      setUserNote("");
      setIsEditing(false);
    }
  }, [watchedItem, selectedId]);

  // Main Data Loading Pipeline: Concurrent TMDB + OMDb Hybrid Extraction
  useEffect(() => {
    if (!selectedId) return;

    if (enrichedDetailsSessionCache.has(selectedId)) {
      setMovie(enrichedDetailsSessionCache.get(selectedId));
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function loadEnrichedMovieDetails() {
      try {
        setMovie(null);
        setIsLoading(true);
        setError("");

        let omdbData = null;
        let tmdbData = null;

        const isImdbId = String(selectedId).startsWith("tt");
        const cleanTmdbId = String(selectedId).replace(/^tmdb_/, "");

        // 1. If it's an IMDb ID, query OMDb & TMDB concurrently
        if (isImdbId) {
          const omdbPromise = fetchOmdbJson(
            { i: selectedId },
            { signal: controller.signal }
          ).catch(() => null);

          const tmdbPromise = findTmdbByImdbId(selectedId)
            .then((found) => (found?.tmdbId ? fetchTmdbMovieDetails(found.tmdbId, userRegion) : null))
            .catch(() => null);

          const [omdbRes, tmdbRes] = await Promise.all([omdbPromise, tmdbPromise]);
          omdbData = omdbRes && omdbRes.Response === "True" ? omdbRes : null;
          tmdbData = tmdbRes;

          if (!tmdbData && omdbData?.Title) {
            try {
              const fallbackFound = await findTmdbByTitleAndYear(omdbData.Title, omdbData.Year);
              if (fallbackFound?.tmdbId) {
                tmdbData = await fetchTmdbMovieDetails(fallbackFound.tmdbId, userRegion);
              }
            } catch (_) {}
          }
        } else {
          // If it's a numeric or TMDB ID
          tmdbData = await fetchTmdbMovieDetails(cleanTmdbId, userRegion);
          if (tmdbData?.imdbID) {
            try {
              const json = await fetchOmdbJson(
                { i: tmdbData.imdbID },
                { signal: controller.signal }
              );
              if (json?.Response === "True") omdbData = json;
            } catch (_) {}
          }
        }

        if (!omdbData && !tmdbData) {
          throw new Error("Movie not found or failed to load cinema details.");
        }

        // Combine into unified high-res cinema model
        const title = tmdbData?.title || omdbData?.Title || "Untitled Film";
        const year = tmdbData?.year && tmdbData.year !== "N/A" ? tmdbData.year : (omdbData?.Year || "N/A");
        const poster = tmdbData?.poster || (omdbData?.Poster && omdbData.Poster !== "N/A" ? omdbData.Poster : getFallbackPoster(title));
        const backdrop = tmdbData?.backdrop || null;
        const runtime = tmdbData?.runtime && tmdbData.runtime !== "N/A" ? tmdbData.runtime : (omdbData?.Runtime || "N/A");
        const runtimeMinutes = tmdbData?.runtimeMinutes || (parseInt(runtime) || 120);
        const plot = tmdbData?.plot || omdbData?.Plot || "No synopsis available.";
        const tagline = tmdbData?.tagline || "";
        const director = tmdbData?.director && tmdbData.director !== "Unknown" ? tmdbData.director : (omdbData?.Director || "Unknown");
        const writers = tmdbData?.writers || omdbData?.Writer || null;
        const cinematographer = tmdbData?.cinematographer || null;
        const composer = tmdbData?.composer || null;
        const genres = tmdbData?.genre
          ? tmdbData.genre.split(",").map((g) => g.trim())
          : (omdbData?.Genre ? omdbData.Genre.split(",").map((g) => g.trim()) : []);

        const castDetails = tmdbData?.castDetails?.length > 0
          ? tmdbData.castDetails
          : (omdbData?.Actors ? omdbData.Actors.split(",").map((name, i) => ({ id: i, name: name.trim(), character: "Starring", profile: null })) : []);

        // Scores Matrix
        const imdbRating = omdbData?.imdbRating && omdbData.imdbRating !== "N/A"
          ? omdbData.imdbRating
          : (tmdbData?.vote_average ? String(tmdbData.vote_average) : null);
        const imdbVotes = omdbData?.imdbVotes && omdbData.imdbVotes !== "N/A" ? omdbData.imdbVotes : null;
        const tmdbRating = tmdbData?.vote_average || null;
        const tmdbVotes = tmdbData?.vote_count ? new Intl.NumberFormat().format(tmdbData.vote_count) : null;
        const metascore = omdbData?.Metascore && omdbData.Metascore !== "N/A" ? omdbData.Metascore : null;
        const rottenTomatoes = omdbData?.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value || null;

        const mpaaRating = tmdbData?.mpaaRating || (omdbData?.Rated && omdbData.Rated !== "N/A" ? omdbData.Rated : null);

        const combinedData = {
          imdbID: omdbData?.imdbID || tmdbData?.imdbID || selectedId,
          tmdbId: tmdbData?.tmdbId || null,
          title,
          year,
          released: omdbData?.Released || tmdbData?.release_date || year,
          runtime,
          runtimeMinutes,
          rated: mpaaRating,
          poster,
          backdrop,
          tagline,
          plot,
          director,
          writers,
          cinematographer,
          composer,
          genres,
          castDetails,
          actors: tmdbData?.cast || omdbData?.Actors || "",
          imdbRating,
          imdbVotes,
          tmdbRating,
          tmdbVotes,
          metascore,
          rottenTomatoes,
          trailerKey: tmdbData?.trailerKey || null,
          trailerUrl: tmdbData?.trailerUrl || null,
          streamProviders: tmdbData?.streamProviders || [],
          buyRentProviders: tmdbData?.buyRentProviders || [],
          freeProviders: tmdbData?.freeProviders || [],
          keywords: tmdbData?.keywordNames || [],
          tmdbKeywords: tmdbData?.tmdbKeywords || [],
          tmdbGenreIds: tmdbData?.tmdbGenreIds || [],
          castIds: tmdbData?.castIds || [],
          crewPersonId: tmdbData?.crewPersonId || null,
          budget: tmdbData?.budget || null,
          revenue: tmdbData?.revenue || null,
          boxOffice: omdbData?.BoxOffice && omdbData.BoxOffice !== "N/A" ? omdbData.BoxOffice : tmdbData?.revenue || null,
          productionCompanies: tmdbData?.productionCompanies || (omdbData?.Production && omdbData.Production !== "N/A" ? omdbData.Production : null),
          originCountry: tmdbData?.originCountry || (omdbData?.Country && omdbData.Country !== "N/A" ? omdbData.Country : null),
          spokenLanguages: tmdbData?.spokenLanguages || (omdbData?.Language && omdbData.Language !== "N/A" ? omdbData.Language : null)
        };

        if (isMounted) {
          enrichedDetailsSessionCache.set(selectedId, combinedData);
          setMovie(combinedData);
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted && err.name !== "AbortError") {
          setError(err.message || "Failed to load movie details");
          setIsLoading(false);
        }
      }
    }

    loadEnrichedMovieDetails();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedId, userRegion]);

  // Document title sync
  useEffect(() => {
    if (!movie?.title) return;
    document.title = `${movie.title} | CinemaVault`;
    return () => {
      document.title = "CinemaVault";
    };
  }, [movie?.title]);

  // ESC key listener to close
  useEffect(() => {
    function callback(e) {
      if (e.code === "Escape") {
        onCloseMovie();
      }
    }
    document.addEventListener("keydown", callback);
    return () => document.removeEventListener("keydown", callback);
  }, [onCloseMovie]);

  // Save to Vault
  function handleSave() {
    const numericRating = Number(userRating);
    if (!movie || !Number.isFinite(numericRating) || numericRating < 1) return;
    const shortPlot = movie.plot ? movie.plot.split(" ").slice(0, 18).join(" ") + "..." : "";

    const rawImdb = Number(movie.imdbRating) || Number(movie.tmdbRating);
    const savedMovie = {
      imdbID: movie.imdbID || selectedId,
      tmdbId: movie.tmdbId || null,
      title: movie.title,
      year: movie.year,
      poster: movie.poster,
      backdrop: movie.backdrop,
      imdbRating: Number.isFinite(rawImdb) && rawImdb > 0 ? rawImdb : null,
      runtime: Number(movie.runtimeMinutes) || (typeof movie.runtime === "string" ? parseInt(movie.runtime) : 120) || 120,
      userRating: Math.min(10, Math.max(1, Math.round(numericRating))),
      userNote: userNote.trim(),
      director: movie.director,
      cinematographer: movie.cinematographer,
      composer: movie.composer,
      writers: movie.writers,
      genre: Array.isArray(movie.genres) ? movie.genres.join(", ") : (movie.genre || "Cinema"),
      shortPlot,
      castIds: movie.castIds || [],
      crewPersonId: movie.crewPersonId || null,
      tmdbKeywords: movie.tmdbKeywords || [],
      tmdbGenreIds: movie.tmdbGenreIds || [],
      trailerKey: movie.trailerKey || null,
      streamProviders: movie.streamProviders || [],
      dateWatched: watchedItem?.dateWatched || new Date().toISOString()
    };

    onAddWatched(savedMovie);
    setIsEditing(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  function handleAddToWatchlistClick() {
    if (!movie) return;
    const rawImdb = Number(movie.imdbRating) || Number(movie.tmdbRating);
    const newWatchlistMovie = {
      imdbID: movie.imdbID || selectedId,
      tmdbId: movie.tmdbId || null,
      title: movie.title,
      year: movie.year,
      poster: movie.poster,
      backdrop: movie.backdrop,
      imdbRating: Number.isFinite(rawImdb) && rawImdb > 0 ? rawImdb : null,
      runtime: Number(movie.runtimeMinutes) || (typeof movie.runtime === "string" ? parseInt(movie.runtime) : 120) || 120,
      genre: Array.isArray(movie.genres) ? movie.genres.join(", ") : "Cinema",
      tmdbGenreIds: movie.tmdbGenreIds || [],
      trailerKey: movie.trailerKey || null,
      streamProviders: movie.streamProviders || [],
      userRating: 0
    };
    const addFn = onAddToWatchlist || contextAddToWatchlist;
    if (addFn) {
      addFn(newWatchlistMovie);
    }
  }

  function handleRemoveWatchlistClick() {
    const targetId =
      watchlistItem?.imdbID ||
      watchlistItem?.id ||
      watchlistItem?.tmdbId ||
      movie?.imdbID ||
      movie?.tmdbId ||
      selectedId;
    if (onRemoveWatchlist) {
      onRemoveWatchlist(targetId);
    } else if (contextDeleteWatchlist) {
      contextDeleteWatchlist(targetId);
    }
  }

  function handleToggleTag(tag) {
    const formattedTag = `#${tag}`;
    if (userNote.includes(formattedTag)) {
      setUserNote((prev) => prev.replace(formattedTag, "").replace(/\s\s+/g, " ").trim());
    } else {
      setUserNote((prev) => (prev ? `${prev.trim()} ${formattedTag}` : formattedTag));
    }
  }

  const activeDisplayRating = hoverRating || userRating || 0;
  const currentTier = getRatingTier(activeDisplayRating);

  return (
    <div className="netflix-detail-modal" aria-label={`Movie details for ${movie?.title || "Film"}`}>
      {isLoading ? (
        <MovieDetailsSkeleton onCloseMovie={onCloseMovie} />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : movie ? (
        <div className="netflix-modal-card luxury-detail-card">
          {/* Top Hero Cinematic Backdrop Banner */}
          <div className="movie-backdrop-hero">
            {movie.backdrop ? (
              <img
                src={movie.backdrop}
                alt={`${movie.title} cinematic backdrop`}
                className="movie-backdrop-img"
              />
            ) : (
              <div className="movie-backdrop-placeholder" />
            )}

            {/* Gradient Overlays */}
            <div className="movie-backdrop-gradient-top" />
            <div className="movie-backdrop-gradient-bottom" />

            {/* Floating Top Bar Nav */}
            <div className="movie-hero-nav-bar">
              <button className="btn-modal-back glassmorphic-btn" onClick={onCloseMovie} aria-label="Go back">
                <ArrowLeft size={18} aria-hidden="true" />
                <span>Back</span>
              </button>

              {(movie.trailerKey || movie.title) && (
                <a
                  href={
                    movie.trailerKey
                      ? `https://www.youtube.com/watch?v=${movie.trailerKey}`
                      : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${movie.title} ${movie.year || ""} official trailer`)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-hero-trailer-play"
                  aria-label={`Watch official trailer for ${movie.title} on YouTube (opens in new tab)`}
                >
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                  <span>Watch Trailer</span>
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              )}
            </div>

            {/* Hero Title & Tagline Overlay */}
            <div className="movie-hero-title-group">
              {movie.tagline && <p className="movie-hero-tagline">“{movie.tagline}”</p>}
              <h1 className="movie-hero-title display-title">{movie.title}</h1>
              <div className="movie-hero-chips">
                <span className="hero-chip"><Calendar size={13} aria-hidden="true" /> {movie.released || movie.year}</span>
                {movie.runtime && movie.runtime !== "N/A" && (
                  <span className="hero-chip"><Clock size={13} aria-hidden="true" /> {movie.runtime}</span>
                )}
                {movie.rated && (
                  <span className="hero-chip hero-chip-rated"><ShieldAlert size={13} aria-hidden="true" /> {movie.rated}</span>
                )}
                {movie.spokenLanguages && (
                  <span className="hero-chip"><Globe size={13} aria-hidden="true" /> {movie.spokenLanguages}</span>
                )}
              </div>
            </div>
          </div>

          {/* Main 2-Column Content Grid */}
          <div className="netflix-modal-body luxury-detail-body">
            {/* Left Column: Poster & Luxury Rating Deck */}
            <div className="netflix-modal-left">
              <div className="netflix-modal-poster-wrap elevated-poster-card">
                <PosterImage src={movie.poster} title={movie.title} alt={`${movie.title} poster`} />
              </div>

              {/* 🌟 LUXURY RATING & VAULT DECK */}
              <div className="luxury-rating-deck">
                {isWatched && !isEditing ? (
                  <div className="vault-saved-status-card">
                    <div className="vault-saved-header">
                      <div className="vault-emblem-badge">
                        <Check size={18} className="text-[#10b981]" aria-hidden="true" />
                      </div>
                      <div>
                        <h4 className="vault-saved-title">In Your Cinema Vault</h4>
                        <span className="vault-saved-subtitle">Saved in your Vault</span>
                      </div>
                    </div>

                    <div className="vault-saved-score-row">
                      {(() => {
                        const savedRating = Number(watchedItem?.userRating) || 0;
                        const savedTier = getRatingTier(savedRating);
                        return savedRating > 0 ? (
                          <>
                            <div className="vault-score-display">
                              <span className="vault-score-num">★ {savedRating}</span>
                              <span className="vault-score-denom">/ 10</span>
                            </div>
                            <div className="vault-tier-pill" style={{ background: savedTier.bg, borderColor: savedTier.border, color: savedTier.color }}>
                              <span>{savedTier.icon} {savedTier.label.split("(")[0]}</span>
                            </div>
                          </>
                        ) : (
                          <div className="vault-tier-pill" style={{ background: savedTier.bg, borderColor: savedTier.border, color: savedTier.color }}>
                            <span>Unrated — tap Edit below to score 1–10</span>
                          </div>
                        );
                      })()}
                    </div>

                    {watchedItem?.userNote && (
                      <div className="vault-saved-notes-box">
                        <p className="vault-saved-notes-text">"{watchedItem.userNote}"</p>
                      </div>
                    )}

                    <div className="vault-saved-actions">
                      <button
                        className="btn-edit-vault-rating"
                        onClick={() => setIsEditing(true)}
                        aria-label="Edit vault rating and personal notes"
                      >
                        <Edit3 size={15} aria-hidden="true" />
                        <span>Edit Rating / Review</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="interactive-rating-module">
                    <div className="rating-module-header">
                      <div className="rating-module-title-wrap">
                        <Flame size={16} className="text-[var(--text-3)]" aria-hidden="true" />
                        <h4 className="rating-module-title">{isWatched ? "Update Vault Entry" : "Rate & Save to Vault"}</h4>
                      </div>
                      <span className="rating-score-badge-preview" style={{ color: currentTier.color, borderColor: currentTier.border, background: currentTier.bg }}>
                        {activeDisplayRating > 0 ? `${activeDisplayRating} / 10` : "— / 10"}
                      </span>
                    </div>

                    {/* Dynamic Cinematic Tier Banner */}
                    <div
                      className="rating-tier-banner"
                      style={{
                        background: currentTier.bg,
                        borderColor: currentTier.border,
                        boxShadow: currentTier.glow
                      }}
                    >
                      <span className="tier-icon">{currentTier.icon}</span>
                      <div className="tier-text-wrap">
                        <span className="tier-name" style={{ color: currentTier.color }}>{currentTier.label}</span>
                        <span className="tier-desc">{currentTier.desc}</span>
                      </div>
                    </div>

                    {/* 10 Glowing Interactive Stars */}
                    <div
                      className="glowing-stars-bar"
                      role="radiogroup"
                      aria-label="Rating out of 10 stars"
                      onMouseLeave={() => setHoverRating(0)}
                    >
                      {Array.from({ length: 10 }, (_, i) => {
                        const starNum = i + 1;
                        const isFilled = starNum <= activeDisplayRating;
                        return (
                          <button
                            key={starNum}
                            type="button"
                            className={`star-touch-btn ${isFilled ? "is-filled" : ""}`}
                            onClick={() => {
                              setUserRating(starNum);
                              setHoverRating(0);
                            }}
                            onMouseEnter={() => setHoverRating(starNum)}
                            aria-label={`Rate ${starNum} out of 10 stars`}
                          >
                            <Star
                              size={20}
                              className={`star-svg-icon ${isFilled ? "star-active-glow" : ""}`}
                              fill={isFilled ? currentTier.color : "transparent"}
                              stroke={isFilled ? currentTier.color : "#4a4d55"}
                            />
                          </button>
                        );
                      })}
                    </div>

                    {/* 1 to 10 Numeric Dial Strip */}
                    <div
                      className="rating-numeric-dial"
                      onMouseLeave={() => setHoverRating(0)}
                    >
                      {Array.from({ length: 10 }, (_, i) => {
                        const num = i + 1;
                        const isSelected = userRating === num;
                        const isHovered = hoverRating === num;
                        return (
                          <button
                            key={num}
                            type="button"
                            className={`dial-pill ${isSelected ? "dial-selected" : ""} ${isHovered ? "dial-hovered" : ""}`}
                            onClick={() => {
                              setUserRating(num);
                              setHoverRating(0);
                            }}
                            onMouseEnter={() => setHoverRating(num)}
                            style={
                              isSelected
                                ? { background: currentTier.bg, borderColor: currentTier.border, color: currentTier.color, boxShadow: currentTier.glow }
                                : {}
                            }
                            aria-label={`Select ${num}`}
                          >
                            {num}
                          </button>
                        );
                      })}
                    </div>

                    {/* Quick Cinephile Tag Pills */}
                    <div className="quick-tags-section">
                      <span className="quick-tags-label"><Tag size={12} aria-hidden="true" /> Quick Review Tags:</span>
                      <div className="quick-tags-row">
                        {QUICK_TAGS.map((tag) => {
                          const isTagActive = userNote.includes(`#${tag}`);
                          return (
                            <button
                              key={tag}
                              type="button"
                              className={`quick-tag-chip ${isTagActive ? "tag-active" : ""}`}
                              onClick={() => handleToggleTag(tag)}
                            >
                              #{tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Personal Notes Textarea */}
                    <textarea
                      className="user-note-input luxury-notes-area"
                      placeholder="Personal notes, quotes, or unforgettable scenes..."
                      value={userNote}
                      onChange={(e) => setUserNote(e.target.value)}
                      aria-label="Personal notes on movie"
                      rows={3}
                    />

                    {/* Actions */}
                    <div className="rating-box-actions">
                      <button
                        className={`btn-vault-primary luxury-save-btn ${saveSuccess ? "is-saved" : ""}`}
                        onClick={handleSave}
                        disabled={!(Number(userRating) > 0)}
                        aria-label={isWatched ? "Update Vault Entry" : "Add to Watched Vault"}
                      >
                        {saveSuccess ? (
                          <>
                            <CheckCircle2 size={18} className="text-[#10b981]" aria-hidden="true" />
                            <span>Vault Synchronized!</span>
                          </>
                        ) : !(Number(userRating) > 0) ? (
                          <>
                            <Star size={18} aria-hidden="true" />
                            <span>Select Rating (1–10)</span>
                          </>
                        ) : isWatched ? (
                          <>
                            <Check size={18} aria-hidden="true" />
                            <span>Update Vault Entry</span>
                          </>
                        ) : (
                          <>
                            <Plus size={18} aria-hidden="true" />
                            <span>Save to Film Vault</span>
                          </>
                        )}
                      </button>

                      {isWatched && isEditing && (
                        <button
                          type="button"
                          className="btn-cancel-edit"
                          onClick={() => setIsEditing(false)}
                        >
                          Cancel Editing
                        </button>
                      )}

                      {!isWatched && (
                        <>
                          {!isWatchlist ? (
                            <button
                              type="button"
                              className="btn-vault-secondary"
                              onClick={handleAddToWatchlistClick}
                              aria-label="Add to Watchlist"
                            >
                              <Bookmark size={16} aria-hidden="true" />
                              <span>Add to Watchlist</span>
                            </button>
                          ) : (
                            <div className="watchlist-active-bar">
                              <span className="watchlist-badge">
                                <Bookmark size={14} fill="currentColor" aria-hidden="true" />
                                <span>Queued in Watchlist</span>
                              </span>
                              <button
                                type="button"
                                className="btn-watchlist-remove"
                                onClick={handleRemoveWatchlistClick}
                                aria-label="Remove from Watchlist"
                                title="Remove from Watchlist"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Rich TMDB Cinema Metadata & Cast */}
            <div className="netflix-modal-right">
              {/* Critical Scores Matrix (4 Multi-Source Cards) */}
              <div className="critical-scores-matrix">
                {/* IMDb Card */}
                {movie.imdbRating && (
                  <div className="score-matrix-card imdb-card">
                    <div className="score-card-header">
                      <Star size={16} className="text-[var(--text-3)]" fill="currentColor" aria-hidden="true" />
                      <span className="score-source-name">IMDb</span>
                    </div>
                    <div className="score-card-value">
                      <span className="score-main-num">{movie.imdbRating}</span>
                      <span className="score-sub-num">/10</span>
                    </div>
                    {movie.imdbVotes && <span className="score-meta-text">{movie.imdbVotes} votes</span>}
                  </div>
                )}

                {/* Rotten Tomatoes Card */}
                {movie.rottenTomatoes && (
                  <div className="score-matrix-card rt-card">
                    <div className="score-card-header">
                      <span className="score-emoji">🍅</span>
                      <span className="score-source-name">Rotten Tomatoes</span>
                    </div>
                    <div className="score-card-value">
                      <span className="score-main-num">{movie.rottenTomatoes}</span>
                    </div>
                    <span className="score-meta-text">Tomatometer Critic Score</span>
                  </div>
                )}

                {/* Metacritic Card */}
                {movie.metascore && (
                  <div className="score-matrix-card meta-card">
                    <div className="score-card-header">
                      <Award size={16} className="text-[#10b981]" aria-hidden="true" />
                      <span className="score-source-name">Metacritic</span>
                    </div>
                    <div className="score-card-value">
                      <span className="score-main-num metascore-pill">{movie.metascore}</span>
                      <span className="score-sub-num">/100</span>
                    </div>
                    <span className="score-meta-text">Metascore Acclaim</span>
                  </div>
                )}

                {/* TMDB Community Score Card */}
                {movie.tmdbRating && (
                  <div className="score-matrix-card tmdb-card">
                    <div className="score-card-header">
                      <Sparkles size={16} className="text-[var(--text-3)]" aria-hidden="true" />
                      <span className="score-source-name">TMDB Community</span>
                    </div>
                    <div className="score-card-value">
                      <span className="score-main-num">{movie.tmdbRating}</span>
                      <span className="score-sub-num">★</span>
                    </div>
                    {movie.tmdbVotes && <span className="score-meta-text">{movie.tmdbVotes} cinephiles</span>}
                  </div>
                )}
              </div>

              {/* Genres Row */}
              {movie.genres?.length > 0 && (
                <div className="netflix-genres-row">
                  {movie.genres.map((g) => (
                    <span key={g} className="netflix-genre-tag luxury-genre-tag">
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* Where to Stream / Watch Providers */}
              {(movie.streamProviders?.length > 0 || movie.buyRentProviders?.length > 0 || movie.freeProviders?.length > 0) && (
                <div className="streaming-providers-card">
                  <div className="stream-header-row">
                    <div className="stream-header-title">
                      <Tv size={16} className="text-[var(--text-3)]" aria-hidden="true" />
                      <span>Where to Stream</span>
                    </div>
                    <span className="stream-region-tag">Region: {userRegion || "US"}</span>
                  </div>

                  <div className="stream-sections-wrap">
                    {movie.streamProviders?.length > 0 && (
                      <div className="stream-group">
                        <span className="stream-group-label">Subscription Stream</span>
                        <div className="stream-logos-row">
                          {movie.streamProviders.map((p) => (
                            <div key={p.id} className="stream-provider-pill" title={p.name}>
                              {p.logo && <img src={p.logo} alt={p.name} className="stream-logo-img" />}
                              <span className="stream-provider-name">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {movie.freeProviders?.length > 0 && (
                      <div className="stream-group">
                        <span className="stream-group-label">Free with Ads</span>
                        <div className="stream-logos-row">
                          {movie.freeProviders.map((p) => (
                            <div key={p.id} className="stream-provider-pill stream-free-pill" title={p.name}>
                              {p.logo && <img src={p.logo} alt={p.name} className="stream-logo-img" />}
                              <span className="stream-provider-name">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {movie.buyRentProviders?.length > 0 && (
                      <div className="stream-group">
                        <span className="stream-group-label">Buy or Rent</span>
                        <div className="stream-logos-row">
                          {movie.buyRentProviders.slice(0, 5).map((p) => (
                            <div key={p.id} className="stream-provider-pill stream-rent-pill" title={p.name}>
                              {p.logo && <img src={p.logo} alt={p.name} className="stream-logo-img" />}
                              <span className="stream-provider-name">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Synopsis */}
              <div className="netflix-plot-block">
                <h3 className="section-subtitle">The Narrative</h3>
                <p className="netflix-plot-text luxury-plot-text">{movie.plot}</p>
              </div>

              {/* Cast & Characters Gallery with Headshots */}
              {movie.castDetails?.length > 0 && (
                <div className="cast-gallery-section">
                  <h3 className="section-subtitle">Starring Cast & Characters</h3>
                  <div className="cast-gallery-grid">
                    {movie.castDetails.slice(0, 8).map((actor) => (
                      <div key={actor.id || actor.name} className="cast-actor-card">
                        <div className="cast-avatar-wrap">
                          {actor.profile ? (
                            <img
                              src={actor.profile}
                              alt={actor.name}
                              className="cast-avatar-img"
                              loading="lazy"
                            />
                          ) : (
                            <div className="cast-avatar-fallback">
                              <User size={18} className="text-[#8a8a86]" aria-hidden="true" />
                            </div>
                          )}
                        </div>
                        <div className="cast-info-wrap">
                          <span className="cast-actor-name">{actor.name}</span>
                          {actor.character && (
                            <span className="cast-character-name">{actor.character}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Creative Credits Matrix */}
              <div className="netflix-credits-grid luxury-credits-grid">
                {movie.director && movie.director !== "N/A" && (
                  <div className="credit-item">
                    <span className="credit-label">
                      <Clapperboard size={14} className="text-[var(--text-3)]" aria-hidden="true" /> Director
                    </span>
                    <span className="credit-value">{movie.director}</span>
                  </div>
                )}

                {movie.writers && movie.writers !== "N/A" && (
                  <div className="credit-item">
                    <span className="credit-label">
                      <Film size={14} className="text-[var(--text-3)]" aria-hidden="true" /> Screenplay & Writers
                    </span>
                    <span className="credit-value">{movie.writers}</span>
                  </div>
                )}

                {movie.cinematographer && (
                  <div className="credit-item">
                    <span className="credit-label">
                      <Camera size={14} className="text-[var(--text-3)]" aria-hidden="true" /> Cinematography (DoP)
                    </span>
                    <span className="credit-value">{movie.cinematographer}</span>
                  </div>
                )}

                {movie.composer && (
                  <div className="credit-item">
                    <span className="credit-label">
                      <Music size={14} className="text-[var(--text-3)]" aria-hidden="true" /> Original Score
                    </span>
                    <span className="credit-value">{movie.composer}</span>
                  </div>
                )}
              </div>

              {/* Financial & Studio Production Intel */}
              {(movie.budget || movie.revenue || movie.boxOffice || movie.productionCompanies) && (
                <div className="production-intel-strip">
                  {(movie.revenue || movie.boxOffice) && (
                    <div className="intel-stat-item">
                      <span className="intel-stat-label">Worldwide Box Office</span>
                      <span className="intel-stat-value">{movie.revenue || movie.boxOffice}</span>
                    </div>
                  )}

                  {movie.budget && (
                    <div className="intel-stat-item">
                      <span className="intel-stat-label">Production Budget</span>
                      <span className="intel-stat-value">{movie.budget}</span>
                    </div>
                  )}

                  {movie.productionCompanies && (
                    <div className="intel-stat-item full-width">
                      <span className="intel-stat-label">Production Studios</span>
                      <span className="intel-stat-value studio-text">{movie.productionCompanies}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Thematic Keywords & Cinematic Tropes */}
              {movie.keywords?.length > 0 && (
                <div className="thematic-keywords-section">
                  <span className="keywords-title"><Tag size={13} aria-hidden="true" /> Cinematic Motifs & Themes</span>
                  <div className="keywords-chip-cloud">
                    {movie.keywords.map((k) => (
                      <span key={k} className="theme-keyword-chip">
                        #{k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
