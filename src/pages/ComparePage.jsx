import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, GitCompareArrows, RotateCcw } from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  addUrlCompareSlot,
  buildCompareUrl,
  parseCompareUrlIds,
  removeUrlCompareSlot
} from "../services/compareService";
import { goBackOrHome, hasBrowserHistory } from "../services/navHelpers";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import CompareWorkbench from "../components/CompareWorkbench";

export default function ComparePage({ onQuickRate }) {
  const { compareItems = [], toggleCompare, removeCompareItem, clearCompare } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlIds = useMemo(() => parseCompareUrlIds(searchParams), [searchParams]);
  const [urlSessionStarted, setUrlSessionStarted] = useState(
    () => parseCompareUrlIds(searchParams).length > 0 || searchParams.has("ids")
  );
  const resolvedSlotsRef = useRef([]);

  useEffect(() => {
    if (urlIds.length > 0 || searchParams.has("ids")) {
      setUrlSessionStarted(true);
    }
  }, [urlIds.length, searchParams]);

  const isUrlMode = urlIds.length > 0 || urlSessionStarted;
  const activeSlots = isUrlMode ? urlIds : compareItems;

  useDocumentTitle(
    activeSlots.length >= 2 ? `Compare (${activeSlots.length})` : "Compare"
  );

  const handleResolvedSlotsChange = useCallback((slots) => {
    resolvedSlotsRef.current = Array.isArray(slots) ? slots : [];
  }, []);

  function handleAddFilm(film) {
    if (!film) return;
    if (isUrlMode) {
      const { action, ids } = addUrlCompareSlot(urlIds, resolvedSlotsRef.current, film);
      if (action !== "added") return;
      const nextUrl = buildCompareUrl(ids);
      const qs = nextUrl.includes("?") ? nextUrl.split("?")[1] : "";
      setSearchParams(qs, { replace: false });
      return;
    }
    toggleCompare(film);
  }

  function handleRemoveSlot(item) {
    if (isUrlMode) {
      const nextIds = removeUrlCompareSlot(urlIds, resolvedSlotsRef.current, item);
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
    if (isUrlMode) {
      setSearchParams("", { replace: false });
      return;
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
            onClick={() => goBackOrHome(navigate, hasBrowserHistory())}
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
        onResolvedSlotsChange={handleResolvedSlotsChange}
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
