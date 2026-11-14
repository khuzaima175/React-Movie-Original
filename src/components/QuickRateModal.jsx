import { useEffect, useState } from "react";
import { Bookmark, Check, Flame, Star } from "lucide-react";
import { Modal } from "./ui/Modal";
import PosterImage from "./PosterImage";
import { buildSeenCollisionSet } from "../services/dashboardService";
import {
  getRatingTier,
  prepareQuickRatePayload,
  prepareWatchlistPayload
} from "../services/ratingTiers";

export default function QuickRateModal({
  movie,
  watched = [],
  watchlist = [],
  onClose,
  onSaveWatched,
  onAddToWatchlist
}) {
  const [selectedRating, setSelectedRating] = useState(null);
  const [hoverRating, setHoverRating] = useState(0);
  const [note, setNote] = useState("");

  const movieIdentity = movie
    ? movie.imdbID || movie.id || (movie.tmdbId ? `tmdb_${movie.tmdbId}` : movie.title)
    : "";

  useEffect(() => {
    setSelectedRating(null);
    setHoverRating(0);
    setNote("");
  }, [movieIdentity]);

  if (!movie) return null;

  const title = movie.Title || movie.title || "Movie";
  const poster = movie.Poster || movie.poster;
  const year = movie.Year || movie.year;
  const rawImdb = movie.imdbRating || movie.rating;
  const imdbRating = rawImdb && Number(rawImdb) > 0 ? String(rawImdb) : null;

  const movieKeys = buildSeenCollisionSet([movie], []);
  const watchedKeys = buildSeenCollisionSet(watched, []);
  const watchlistKeys = buildSeenCollisionSet([], watchlist);
  const isAlreadyWatched = [...movieKeys].some((key) => watchedKeys.has(key));
  const isAlreadyWatchlisted = [...movieKeys].some((key) => watchlistKeys.has(key));

  const activeRating = hoverRating || selectedRating || 0;
  const activeTier = getRatingTier(activeRating);

  function handleSaveToVault() {
    const payload = prepareQuickRatePayload({ ...movie, userNote: note }, selectedRating);
    if (!payload) return;
    onSaveWatched?.(payload);
    onClose?.();
  }

  function handlePlanToWatch() {
    const payload = prepareWatchlistPayload(movie);
    if (!payload) return;
    onAddToWatchlist?.(payload);
    onClose?.();
  }

  return (
    <Modal
      isOpen={Boolean(movie)}
      onClose={onClose}
      title={isAlreadyWatchlisted ? "Rate & Move to Vault" : "Rate or Save Film"}
      size="sm"
    >
      <div className="quick-rate-modal-body">
        <div className="quick-rate-movie-head">
          <div className="quick-rate-poster-thumb">
            <PosterImage src={poster} title={title} alt={`${title} poster`} />
          </div>
          <div className="quick-rate-movie-meta">
            <h3 className="quick-rate-movie-title">{title}</h3>
            <div className="quick-rate-meta-badges">
              {year && <span className="quick-rate-year">{year}</span>}
              {imdbRating && (
                <span className="quick-rate-imdb">
                  <Star size={12} fill="currentColor" aria-hidden="true" />
                  {imdbRating} IMDb
                </span>
              )}
              {isAlreadyWatchlisted && (
                <span className="quick-rate-watchlist-tag">In Watchlist</span>
              )}
            </div>
            {movie.genre && <p className="quick-rate-genre">{movie.genre}</p>}
          </div>
        </div>

        <div className="quick-rate-picker">
          <div className="quick-rate-picker-head">
            <span className="quick-rate-picker-label">
              <Flame size={15} className="text-[var(--text-3)]" aria-hidden="true" />
              Your Rating (1–10)
            </span>
            <span
              className="quick-rate-tier-pill"
              style={{
                color: activeTier.color,
                background: activeTier.bg,
                borderColor: activeTier.border
              }}
            >
              {activeRating > 0 ? `${activeRating}/10 • ${activeTier.icon} ${activeTier.label.split("(")[0].trim()}` : "Tap a score"}
            </span>
          </div>

          <div
            className="quick-rate-number-grid"
            role="radiogroup"
            aria-label={`Rate ${title} out of 10`}
            onMouseLeave={() => setHoverRating(0)}
          >
            {Array.from({ length: 10 }, (_, idx) => {
              const score = idx + 1;
              const isSelected = selectedRating === score;
              const isHovered = hoverRating === score;
              const scoreTier = getRatingTier(score);
              return (
                <button
                  key={score}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`Rate ${score} out of 10`}
                  className={`quick-rate-pill-btn ${isSelected ? "is-selected" : ""} ${isHovered ? "is-hovered" : ""}`}
                  style={
                    isSelected
                      ? {
                          background: scoreTier.bg,
                          borderColor: scoreTier.border,
                          color: scoreTier.color
                        }
                      : undefined
                  }
                  onMouseEnter={() => setHoverRating(score)}
                  onClick={() => setSelectedRating(score)}
                >
                  {score}
                </button>
              );
            })}
          </div>

          <input
            type="text"
            className="quick-rate-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={180}
            placeholder="Quick note (optional)..."
            aria-label="Optional quick note"
          />
        </div>

        <div className="quick-rate-actions">
          {onAddToWatchlist && !isAlreadyWatchlisted && !isAlreadyWatched && (
            <button
              type="button"
              className="btn-quick-watchlist"
              onClick={handlePlanToWatch}
            >
              <Bookmark size={15} aria-hidden="true" />
              <span>Add to Watchlist</span>
            </button>
          )}

          <div className="quick-rate-primary-group">
            <button
              type="button"
              className="btn-quick-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-quick-save"
              disabled={!selectedRating}
              onClick={handleSaveToVault}
            >
              <Check size={15} aria-hidden="true" />
              <span>{selectedRating ? `Save ★ ${selectedRating} to Vault` : "Select 1–10 Rating"}</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
