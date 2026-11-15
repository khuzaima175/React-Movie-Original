import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, GitCompareArrows, RotateCcw } from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  COMPARE_MAX_ITEMS,
  buildCompareUrl,
  parseCompareUrlIds
} from "../services/compareService";
import { isSameMovie } from "../services/movieIdentity";
import { getCanonicalMovieKey } from "../services/vaultSyncService";
import CompareWorkbench from "../components/CompareWorkbench";

export default function ComparePage({ onQuickRate }) {
  const { compareItems = [], toggleCompare, removeCompareItem, clearCompare } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlIds = useMemo(() => parseCompareUrlIds(searchParams), [searchParams]);
  const hasUrlIds = urlIds.length > 0;
  const activeSlots = hasUrlIds ? urlIds : compareItems;

  useEffect(() => {
    document.title =
      activeSlots.length >= 2
        ? `Compare (${activeSlots.length}) | CinemaVault`
        : "Compare Films | CinemaVault";
  }, [activeSlots.length]);

  function handleAddFilm(film) {
    if (!film) return;
    if (hasUrlIds) {
      const token = getCanonicalMovieKey(film) || film.imdbID || (film.tmdbId ? `tmdb_${film.tmdbId}` : "");
      if (!token) return;
      if (urlIds.some((id) => isSameMovie(id, film)) || urlIds.length >= COMPARE_MAX_ITEMS) return;
      const nextUrl = buildCompareUrl([...urlIds, token]);
      const qs = nextUrl.includes("?") ? nextUrl.split("?")[1] : "";
      setSearchParams(qs, { replace: false });
      return;
    }
    toggleCompare(film);
  }

  function handleRemoveSlot(item) {
    if (hasUrlIds) {
      const nextIds = urlIds.filter((id) => !isSameMovie(id, item));
      if (nextIds.length === 0) {
        setSearchParams("", { replace: false });
      } else {
        const nextUrl = buildCompareUrl(nextIds);
        setSearchParams(nextUrl.split("?")[1] || "", { replace: false });
      }
      return;
    }
    removeCompareItem(item);
  }

  function handleClear() {
    if (hasUrlIds) {
      setSearchParams("", { replace: false });
    }
    clearCompare();
  }

  return (
    <div className="compare-page page-rail">
      <header className="compare-page-header">
        <div className="compare-page-heading">
          <button
            type="button"
            className="compare-back-link"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Back</span>
          </button>

          <div className="compare-page-kicker">
            <GitCompareArrows size={13} aria-hidden="true" />
            <span>Decision &amp; Research Matrix</span>
          </div>
          <h1 className="compare-page-title display-title">Side-by-Side Comparison</h1>
        </div>

        {activeSlots.length > 0 && (
          <div className="compare-page-header-actions">
            <button
              type="button"
              className="compare-modal-text-btn"
              onClick={handleClear}
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>Clear Slots</span>
            </button>
          </div>
        )}
      </header>

      <CompareWorkbench
        movieIdsOrItems={activeSlots}
        onNavigatePerson={(personId) => navigate(`/person/${personId}`)}
        onNavigateMovie={(movieId) => navigate(`/movie/${movieId}`)}
        onNavigateExplore={(route) => navigate(route)}
        onAddFilm={handleAddFilm}
        onRemoveSlot={handleRemoveSlot}
        onQuickRate={onQuickRate}
      />
    </div>
  );
}
