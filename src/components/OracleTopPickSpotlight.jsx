import { Link } from "react-router-dom";
import { Bookmark, Check, Eye, Loader2, Play, Sparkles, Star, ThumbsDown } from "lucide-react";
import PosterImage from "./PosterImage";
import { calibratePredictedRating } from "../services/tasteMatchService";
import { resolveRecommendationAnchors, sanitizeOracleReason } from "../services/oracleViewHelpers";

export default function OracleTopPickSpotlight({
  pick,
  watched = [],
  inWatchlist = false,
  isAdding = false,
  showNumericMatch = true,
  onAddWatchlist,
  onAlreadySeen,
  onDismiss,
  onWatchTrailer
}) {
  if (!pick) return null;

  const detailId = pick.imdbID || pick.id || (pick.tmdbId ? `tmdb_${pick.tmdbId}` : "");
  const matchScore = Number(pick.matchScore);
  const hasMatch = showNumericMatch && Number.isFinite(matchScore) && matchScore >= 50;
  const estRating = hasMatch ? calibratePredictedRating({ matchPct: matchScore, watched }) : null;
  const anchors = resolveRecommendationAnchors(pick, watched, 3);
  const cleanReason = sanitizeOracleReason(pick.reason || "");
  const backdropUrl = pick.backdrop || pick.backdropUrl || pick.poster || "";

  return (
    <article className="oracle-spotlight-card" aria-label={`Top Pick Tonight: ${pick.title}`}>
      {backdropUrl && (
        <div
          className="oracle-spotlight-backdrop"
          style={{ backgroundImage: `url(${backdropUrl})` }}
          aria-hidden="true"
        />
      )}
      <div className="oracle-spotlight-scrim" aria-hidden="true" />

      <div className="oracle-spotlight-body">
        <Link to={`/movie/${detailId}`} className="oracle-spotlight-poster-link">
          <div className="oracle-spotlight-poster">
            <PosterImage src={pick.poster} title={pick.title} alt={`${pick.title} poster`} />
          </div>
        </Link>

        <div className="oracle-spotlight-content">
          <div className="oracle-spotlight-kicker-row">
            <span className="oracle-spotlight-kicker">
              <Sparkles size={13} aria-hidden="true" />
              #1 Top Pick Tonight
            </span>
            {hasMatch && (
              <span className="oracle-spotlight-match tabular-num">
                {Math.round(matchScore)}% Match
                {estRating != null ? ` · Est. ${estRating}/10` : ""}
              </span>
            )}
          </div>

          <h2 className="oracle-spotlight-title">
            <Link to={`/movie/${detailId}`} className="oracle-spotlight-title-link">
              {pick.title}
            </Link>
          </h2>

          <div className="oracle-spotlight-meta">
            {pick.year && <span>{pick.year}</span>}
            {pick.genre && <span>{pick.genre}</span>}
            {pick.imdbRating && pick.imdbRating !== "N/A" && (
              <span className="oracle-spotlight-imdb tabular-num">
                <Star size={12} fill="currentColor" aria-hidden="true" />
                {pick.imdbRating}
              </span>
            )}
          </div>

          {cleanReason && <p className="oracle-spotlight-reason">{cleanReason}</p>}

          {anchors.length > 0 && (
            <div className="oracle-spotlight-anchors">
              <span className="oracle-spotlight-anchors-label">Because you rated</span>
              {anchors.map((a) => (
                <Link key={a.id} to={`/movie/${a.id}`} className="oracle-spotlight-anchor-chip">
                  {a.title}
                  {a.userRating > 0 ? ` · ${Math.round(a.userRating)}★` : ""}
                </Link>
              ))}
            </div>
          )}

          <div className="oracle-spotlight-actions">
            <button
              type="button"
              className="oracle-spotlight-btn-primary"
              onClick={() => onAddWatchlist?.(pick)}
              disabled={inWatchlist || isAdding}
            >
              {isAdding ? (
                <Loader2 size={15} className="spin-icon" aria-hidden="true" />
              ) : inWatchlist ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Bookmark size={15} aria-hidden="true" />
              )}
              <span>{isAdding ? "Saving..." : inWatchlist ? "In Watchlist" : "Add to Watchlist"}</span>
            </button>

            {onWatchTrailer && (
              <button
                type="button"
                className="oracle-spotlight-btn-secondary"
                onClick={() => onWatchTrailer(pick)}
              >
                <Play size={14} aria-hidden="true" />
                <span>Trailer</span>
              </button>
            )}

            <button
              type="button"
              className="oracle-spotlight-btn-secondary"
              onClick={() => onAlreadySeen?.(pick)}
            >
              <Eye size={14} aria-hidden="true" />
              <span>Already Seen</span>
            </button>

            <button
              type="button"
              className="oracle-spotlight-btn-ghost"
              onClick={() => onDismiss?.(pick)}
              aria-label={`Dismiss ${pick.title}`}
            >
              <ThumbsDown size={14} aria-hidden="true" />
              <span>Not for me</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
