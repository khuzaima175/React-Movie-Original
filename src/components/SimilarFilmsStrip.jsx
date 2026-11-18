import { Link } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import MovieCard from "./MovieCard";
import { buildExploreRoute } from "../services/exploreService";
import { useHorizontalWheelScroll } from "../hooks/useHorizontalWheelScroll";

const ORIGIN_LABEL = {
  hybrid: "Strong Match",
  "vault-vector": "DNA Vector",
  tmdb: "Related"
};

export default function SimilarFilmsStrip({
  films = [],
  sourceTitle = "",
  genreIds = [],
  loading = false,
  onSelectMovie,
  onQuickRate
}) {
  const stripRef = useHorizontalWheelScroll([films?.length || 0, loading]);

  if (loading && (!films || films.length === 0)) {
    return (
      <section className="rabbit-hole-section" aria-label="Similar Films Loading">
        <div className="rabbit-hole-header">
          <div>
            <div className="rabbit-hole-kicker">Aesthetic &amp; Thematic Kin</div>
            <h2 className="rabbit-hole-title">Movies Like This</h2>
          </div>
        </div>
        <div className="similar-films-strip">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="similar-film-skeleton" />
          ))}
        </div>
      </section>
    );
  }

  if (!Array.isArray(films) || films.length === 0) {
    return null;
  }

  const exploreMoreUrl = genreIds.length > 0
    ? buildExploreRoute({ genres: genreIds.slice(0, 2) })
    : "/explore";

  return (
    <section className="rabbit-hole-section" aria-label="Movies Like This">
      <div className="rabbit-hole-header">
        <div className="rabbit-hole-title-group">
          <div className="rabbit-hole-kicker">
            <Sparkles size={12} aria-hidden="true" />
            <span>
              {sourceTitle ? `Because it matches ${sourceTitle}` : "Aesthetic & Thematic Kin"}
            </span>
          </div>
          <h2 className="rabbit-hole-title">Movies Like This</h2>
        </div>

        <Link to={exploreMoreUrl} className="rabbit-hole-explore-link">
          <span>Open in Explore</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      <div ref={stripRef} className="similar-films-strip" role="list">
        {films.map((film) => {
          const targetId = film.imdbID || film.id || `tmdb_${film.tmdbId}`;
          const originTag = ORIGIN_LABEL[film.matchOrigin] || null;
          return (
            <div key={film.tmdbId || targetId} className="similar-film-item" role="listitem">
              {originTag && (
                <span className={`similar-origin-pill origin-${film.matchOrigin}`}>
                  {originTag}
                </span>
              )}
              <MovieCard
                movie={film}
                showCaption={true}
                isWatched={Boolean(film.isWatched)}
                onSelectMovie={(id) => onSelectMovie?.(id)}
                onQuickAdd={onQuickRate}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
