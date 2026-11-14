import { useEffect, useMemo, useState } from "react";
import MovieCard from "./MovieCard";
import { Button } from "./ui";
import { collectCatalogMosaic } from "../services/dashboardService";
import { useScrollReveal } from "../hooks/useScrollReveal";

export default function HomePosterGrid({
  rows = [],
  mosaicPool = [],
  watched = [],
  onSelectMovie,
  onQuickAdd,
  onAddWatched
}) {
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [visibleCount, setVisibleCount] = useState(24);
  const [revealRef, isRevealed] = useScrollReveal();

  useEffect(() => {
    setVisibleCount(24);
  }, [selectedGenre]);

  const effectiveRows = useMemo(() => {
    if (Array.isArray(rows) && rows.length > 0) return rows;
    if (Array.isArray(mosaicPool) && mosaicPool.length > 0) {
      return [{ key: "mosaic", movies: mosaicPool }];
    }
    return [];
  }, [rows, mosaicPool]);

  const { items, totalCount, availableGenres } = useMemo(
    () => collectCatalogMosaic({ rows: effectiveRows, selectedGenre, limit: visibleCount }),
    [effectiveRows, selectedGenre, visibleCount]
  );

  if (totalCount === 0 && availableGenres.length <= 1) {
    return null;
  }

  return (
    <section
      className="home-mosaic-section page-rail"
      aria-label="Explore full film catalog"
    >
      <div
        ref={revealRef}
        className={`home-mosaic-header cv-reveal ${isRevealed ? "is-visible" : ""}`}
      >
        <div className="home-mosaic-title-wrap">
          <h2 className="home-mosaic-heading">All Films</h2>
          <p className="home-mosaic-subtitle">
            Showing {items.length} of {totalCount} {totalCount === 1 ? "film" : "films"}
          </p>
        </div>

        <div className="home-mosaic-genres" role="tablist" aria-label="Filter catalog by genre">
          {availableGenres.map((genre) => {
            const isActive = selectedGenre.toLowerCase() === genre.toLowerCase();
            return (
              <button
                key={genre}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`home-mosaic-genre-pill ${isActive ? "active" : ""}`}
                onClick={() => setSelectedGenre(genre)}
              >
                {genre}
              </button>
            );
          })}
        </div>
      </div>

      <div className="home-poster-mosaic-grid">
        {items.map((movie, idx) => {
          const id = movie.imdbID || movie.id || `tmdb_${movie.tmdbId}`;
          const isWatched = (watched || []).some(
            (w) => w && (w.imdbID === id || w.id === id || (movie.tmdbId && w.tmdbId === movie.tmdbId))
          );

          return (
            <MovieCard
              key={id}
              movie={movie}
              animateOnScroll={true}
              revealIndex={idx}
              onSelectMovie={onSelectMovie}
              onQuickAdd={onQuickAdd}
              onAddWatched={onAddWatched}
              isWatched={isWatched}
            />
          );
        })}
      </div>

      {items.length < totalCount && (
        <div className="home-mosaic-footer">
          <Button
            variant="secondary"
            onClick={() => setVisibleCount((prev) => prev + 24)}
          >
            Show 24 more ({totalCount - items.length} remaining)
          </Button>
        </div>
      )}
    </section>
  );
}
