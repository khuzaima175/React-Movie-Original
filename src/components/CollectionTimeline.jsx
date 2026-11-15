import { Link } from "react-router-dom";
import { Check, Bookmark, Star, Layers } from "lucide-react";
import PosterImage from "./PosterImage";

export default function CollectionTimeline({ timeline, loading = false }) {
  if (loading && !timeline) {
    return (
      <section className="rabbit-hole-section" aria-label="Franchise Timeline Loading">
        <div className="rabbit-hole-header">
          <div>
            <div className="rabbit-hole-kicker">Franchise Timeline</div>
            <h2 className="rabbit-hole-title">Loading Series Order…</h2>
          </div>
        </div>
        <div className="collection-timeline-strip">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="collection-part-skeleton" />
          ))}
        </div>
      </section>
    );
  }

  if (!timeline || !Array.isArray(timeline.parts) || timeline.parts.length < 2) {
    return null;
  }

  const pct = timeline.totalCount > 0
    ? Math.round((timeline.watchedCount / timeline.totalCount) * 100)
    : 0;

  return (
    <section className="rabbit-hole-section" aria-label={`${timeline.name} Chronological Timeline`}>
      <div className="rabbit-hole-header">
        <div className="rabbit-hole-title-group">
          <div className="rabbit-hole-kicker">
            <Layers size={12} aria-hidden="true" />
            <span>Franchise Timeline</span>
          </div>
          <h2 className="rabbit-hole-title">{timeline.name}</h2>
        </div>

        <div className="collection-progress-pill" aria-label={`Watched ${timeline.watchedCount} of ${timeline.totalCount}`}>
          <span className="tabular-num">
            {timeline.watchedCount} of {timeline.totalCount} Watched
          </span>
          <span className="collection-progress-bar" aria-hidden="true">
            <span className="collection-progress-fill" style={{ width: `${pct}%` }} />
          </span>
        </div>
      </div>

      <div className="collection-timeline-strip" role="list">
        {timeline.parts.map((part, idx) => {
          const targetId = part.imdbID || `tmdb_${part.tmdbId}`;
          const cardBody = (
            <>
              <div className="collection-part-top">
                <span className="collection-part-step tabular-num">Part {idx + 1}</span>
                <span className="collection-part-year tabular-num">{part.year}</span>
              </div>

              <div className="collection-part-poster">
                <PosterImage src={part.poster} title={part.title} alt={`${part.title} poster`} />
                {part.isCurrent && (
                  <span className="collection-current-badge">Viewing Now</span>
                )}
              </div>

              <div className="collection-part-meta">
                <h3 className="collection-part-title" title={part.title}>
                  {part.title}
                </h3>
                <div className="collection-part-status">
                  {part.isWatched ? (
                    <span className="collection-status-chip is-watched">
                      <Check size={11} aria-hidden="true" />
                      <span>
                        {Number(part.userRating) > 0 ? `${part.userRating}/10` : "Watched"}
                      </span>
                    </span>
                  ) : part.isWatchlist ? (
                    <span className="collection-status-chip is-watchlist">
                      <Bookmark size={11} aria-hidden="true" />
                      <span>Watchlist</span>
                    </span>
                  ) : part.vote_average ? (
                    <span className="collection-status-chip is-tmdb">
                      <Star size={11} aria-hidden="true" />
                      <span>{part.vote_average} TMDB</span>
                    </span>
                  ) : (
                    <span className="collection-status-chip">Queued</span>
                  )}
                </div>
              </div>
            </>
          );

          if (part.isCurrent) {
            return (
              <div
                key={part.tmdbId}
                role="listitem"
                aria-current="page"
                className="collection-part-card is-current"
              >
                {cardBody}
              </div>
            );
          }

          return (
            <Link
              key={part.tmdbId}
              role="listitem"
              to={`/movie/${encodeURIComponent(targetId)}`}
              className="collection-part-card"
            >
              {cardBody}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
