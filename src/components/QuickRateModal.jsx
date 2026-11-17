import { useEffect, useState } from "react";
import { Bookmark, Check, Star } from "lucide-react";
import { Modal } from "./ui/Modal";
import PosterImage from "./PosterImage";
import StarRatingStage from "./StarRatingStage";
import { flyToVault } from "../services/flyToVault";
import { buildSeenCollisionSet } from "../services/dashboardService";
import {
  prepareQuickRatePayload,
  prepareWatchlistPayload
} from "../services/ratingTiers";
import {
  getContextualQuickTags,
  hasQuickTagInNote,
  toggleQuickTagInNote
} from "../services/quickReviewTags";

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
  const quickTags = getContextualQuickTags(activeRating);

  function flyPoster() {
    const el = document.querySelector(".quick-rate-poster-thumb");
    flyToVault(el, poster);
  }

  function handleSaveToVault() {
    const payload = prepareQuickRatePayload({ ...movie, userNote: note }, selectedRating);
    if (!payload) return;
    flyPoster();
    onSaveWatched?.(payload);
    onClose?.();
  }

  function handlePlanToWatch() {
    const payload = prepareWatchlistPayload(movie);
    if (!payload) return;
    flyPoster();
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
          <StarRatingStage
            compact
            value={selectedRating || 0}
            hoverValue={hoverRating}
            onChange={setSelectedRating}
            onHoverChange={setHoverRating}
            ariaLabel={`Rate ${title} out of 10`}
          />

          <div className="quick-tags-row" aria-label="Quick review tags">
            {quickTags.map(({ id: tag }) => {
              const isTagActive = hasQuickTagInNote(note, tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`quick-tag-chip ${isTagActive ? "tag-active" : ""}`}
                  onClick={() => setNote((prev) => toggleQuickTagInNote(prev, tag, 200))}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            className="quick-rate-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Why you liked or disliked it (1–2 lines for AI)..."
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
