import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, GitCompareArrows, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { buildCompareUrl } from "../services/compareService";
import CompareWorkbench from "./CompareWorkbench";

export default function CompareModal({ onQuickRate }) {
  const {
    compareItems = [],
    isCompareOpen,
    closeCompareModal,
    removeCompareItem,
    toggleCompare,
    clearCompare
  } = useApp();
  const navigate = useNavigate();
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!isCompareOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    const prevFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      if (prevFocused && typeof prevFocused.focus === "function") {
        prevFocused.focus();
      }
    };
  }, [isCompareOpen]);

  useEffect(() => {
    if (!isCompareOpen) return undefined;
    function handleKeyDown(e) {
      if (e.key !== "Escape") return;
      const hasHigherDialog = Boolean(
        document.querySelector('[role="dialog"]:not([data-compare-modal="true"])')
      );
      if (hasHigherDialog) return;
      e.preventDefault();
      closeCompareModal();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCompareOpen, closeCompareModal]);

  if (!isCompareOpen) return null;

  const fullCompareHref = buildCompareUrl(compareItems);

  return createPortal(
    <div
      className="compare-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-modal-title"
      data-compare-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeCompareModal();
      }}
    >
      <div className="compare-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="compare-modal-header">
          <div className="compare-modal-title-wrap">
            <GitCompareArrows size={18} aria-hidden="true" />
            <div>
              <h2 id="compare-modal-title" className="compare-modal-title display-title">
                Side-by-Side Research Matrix
              </h2>
              <p className="compare-modal-subtitle">
                Ratings, ROI efficiency, shared creative DNA, and streaming availability
              </p>
            </div>
          </div>

          <div className="compare-modal-header-actions">
            {compareItems.length > 0 && (
              <button
                type="button"
                className="compare-modal-text-btn"
                onClick={() => {
                  clearCompare();
                  closeCompareModal();
                }}
              >
                Clear All
              </button>
            )}
            <Link
              to={fullCompareHref}
              className="compare-open-page-link"
              onClick={closeCompareModal}
            >
              <span>Open Full Compare Page</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
            <button
              ref={closeButtonRef}
              type="button"
              className="compare-modal-close"
              onClick={closeCompareModal}
              aria-label="Close compare matrix"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="compare-modal-body">
          <CompareWorkbench
            movieIdsOrItems={compareItems}
            onNavigatePerson={(personId) => {
              closeCompareModal();
              navigate(`/person/${personId}`);
            }}
            onNavigateMovie={(movieId) => {
              closeCompareModal();
              navigate(`/movie/${movieId}`);
            }}
            onNavigateExplore={(route) => {
              closeCompareModal();
              navigate(route);
            }}
            onAddFilm={(film) => toggleCompare(film)}
            onRemoveSlot={(item) => removeCompareItem(item)}
            onQuickRate={onQuickRate}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
