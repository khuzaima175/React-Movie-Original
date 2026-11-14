import { useEffect, useMemo, useState } from "react";
import { Film, Grid2x2Plus } from "lucide-react";
import MovieCard from "./MovieCard";
import { collectCatalogMosaic } from "../services/dashboardService";

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
    <section className="home-mosaic-section" aria-label="Explore full film catalog">
      <div className="home-mosaic-header">
        <div className="home-mosaic-title-wrap">
          <h2 className="home-mosaic-heading">
            <Film size={20} className="text-accent" aria-hidden="true" />
            Explore Full Catalog
          </h2>
          <p className="home-mosaic-subtitle">
            Showing {items.length} of {totalCount} curated {totalCount === 1 ? "film" : "films"}
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
        {items.map((movie) => {
          const id = movie.imdbID || movie.id || `tmdb_${movie.tmdbId}`;
          const isWatched = (watched || []).some(
            (w) => w && (w.imdbID === id || w.id === id || (movie.tmdbId && w.tmdbId === movie.tmdbId))
          );

          return (
            <MovieCard
              key={id}
              movie={movie}
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
          <button
            type="button"
            className="home-mosaic-more-btn"
            onClick={() => setVisibleCount((prev) => prev + 24)}
          >
            <Grid2x2Plus size={16} aria-hidden="true" />
            <span>
              Show 24 More Posters ({totalCount - items.length} remaining)
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
