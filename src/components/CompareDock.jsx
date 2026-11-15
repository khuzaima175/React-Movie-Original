import { useLocation } from "react-router-dom";
import { GitCompareArrows, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { COMPARE_MAX_ITEMS } from "../services/compareService";
import PosterImage from "./PosterImage";
import { Button } from "./ui";

export default function CompareDock() {
  const {
    compareItems = [],
    compareNotice = "",
    clearCompareNotice,
    removeCompareItem,
    clearCompare,
    openCompareModal,
    isCompareOpen
  } = useApp();
  const location = useLocation();

  if (location.pathname === "/compare" || isCompareOpen) return null;
  if (compareItems.length === 0 && !compareNotice) return null;

  return (
    <aside className="compare-dock-wrap" aria-label="Film Comparison Dock">
      {compareNotice && (
        <div className="compare-dock-notice" role="status">
          <span>{compareNotice}</span>
          <button
            type="button"
            className="compare-dock-notice-dismiss"
            onClick={clearCompareNotice}
            aria-label="Dismiss compare notice"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      {compareItems.length > 0 && (
        <div className="compare-dock-pill">
          <div className="compare-dock-slots">
            {compareItems.map((item) => {
              const key = item.id || item.imdbID || `tmdb_${item.tmdbId}`;
              return (
                <div key={key} className="compare-dock-chip">
                  <div className="compare-dock-thumb">
                    <PosterImage src={item.poster} title={item.title} alt={item.title} />
                  </div>
                  <div className="compare-dock-chip-meta">
                    <span className="compare-dock-chip-title">{item.title}</span>
                    {item.year && <span className="compare-dock-chip-year tabular-num">{item.year}</span>}
                  </div>
                  <button
                    type="button"
                    className="compare-dock-chip-remove"
                    onClick={() => removeCompareItem(item)}
                    aria-label={`Remove ${item.title} from Compare`}
                    title={`Remove ${item.title}`}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              );
            })}

            {compareItems.length === 1 && (
              <div className="compare-dock-hint">
                <GitCompareArrows size={14} aria-hidden="true" />
                <span>Pick 1 more film to compare</span>
              </div>
            )}
          </div>

          <div className="compare-dock-actions">
            <button
              type="button"
              className="compare-dock-clear"
              onClick={clearCompare}
            >
              Clear
            </button>
            <Button
              variant="primary"
              disabled={compareItems.length < 2}
              onClick={openCompareModal}
              aria-label={`Compare ${compareItems.length} of ${COMPARE_MAX_ITEMS} films`}
            >
              <GitCompareArrows size={15} aria-hidden="true" />
              <span className="tabular-num">
                Compare ({compareItems.length}/{COMPARE_MAX_ITEMS})
              </span>
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
