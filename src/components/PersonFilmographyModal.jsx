import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowUpRight, RotateCcw, Star, User, X } from "lucide-react";
import PersonFilmographyExplorer from "./PersonFilmographyExplorer";
import {
  annotateCreditsWithVaultState,
  computePersonVaultStats,
  fetchPersonProfileAndCredits,
  resolvePersonDefaultDepartment
} from "../services/personService";

export default function PersonFilmographyModal({
  personTarget,
  watched = [],
  watchlist = [],
  onClose,
  onSelectMovie,
  onQuickRate,
  onAddToWatchlist,
  onOpenFullProfile
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeDepartment, setActiveDepartment] = useState("all");
  const [retryNonce, setRetryNonce] = useState(0);
  const closeButtonRef = useRef(null);

  const targetId = personTarget?.id ?? null;
  const targetName = personTarget?.name ?? "";
  const targetRoleHint = personTarget?.roleHint ?? "";
  const targetProfile = personTarget?.profile ?? null;
  const isOpen = Boolean(personTarget);

  useEffect(() => {
    if (!isOpen) return undefined;
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
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(e) {
      if (e.key !== "Escape") return;
      // Leave Escape to higher dialogs such as QuickRateModal when stacked
      const hasOtherDialog = Boolean(
        document.querySelector('[role="dialog"]:not([data-person-modal="true"])')
      );
      if (hasOtherDialog) return;
      e.preventDefault();
      onClose?.();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setData(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let httpStatus = null;
    setLoading(true);
    setError(null);

    fetchPersonProfileAndCredits(
      { id: targetId, name: targetName, roleHint: targetRoleHint },
      {
        signal: controller.signal,
        forceRefresh: retryNonce > 0,
        onHttpError: (status) => {
          httpStatus = status;
        }
      }
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        if (!res) {
          setData(null);
          setError(
            httpStatus === 429
              ? "TMDB rate limit reached. Please wait a moment and try again."
              : "Could not find TMDB filmography details for this credit."
          );
          setLoading(false);
          return;
        }
        setData(res);
        setActiveDepartment(resolvePersonDefaultDepartment(targetRoleHint, res.credits));
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setData(null);
        setError("Network issue while loading filmography. Please retry.");
        setLoading(false);
      });

    return () => controller.abort();
  }, [isOpen, targetId, targetName, targetRoleHint, retryNonce]);

  const credits = data?.credits || [];
  const person = data?.person || null;

  const stats = useMemo(() => {
    const annotated = annotateCreditsWithVaultState(credits, watched, watchlist);
    return computePersonVaultStats(annotated);
  }, [credits, watched, watchlist]);

  if (!isOpen) return null;

  const displayName = person?.name || targetName || "Filmography";
  const avatarSrc = person?.profileUrl || targetProfile;
  const knownFor = person?.knownForDepartment || targetRoleHint || "Contributor";
  const resolvedId = person?.id || targetId;

  return createPortal(
    <div
      className="person-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="person-modal-title"
      data-person-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="person-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="person-modal-header">
          <div className="person-modal-identity">
            <div className="person-modal-avatar">
              {avatarSrc ? (
                <img src={avatarSrc} alt={displayName} />
              ) : (
                <User size={28} aria-hidden="true" />
              )}
            </div>

            <div className="person-modal-titles">
              <div className="person-modal-kicker">
                <span>{knownFor}</span>
                {credits.length > 0 && (
                  <>
                    <span aria-hidden="true">•</span>
                    <span className="tabular-num">{credits.length} Films</span>
                  </>
                )}
              </div>

              <h2 id="person-modal-title" className="person-modal-name">
                {displayName}
              </h2>

              {person?.biography && (
                <p className="person-modal-bio-snippet">{person.biography}</p>
              )}

              {!loading && credits.length > 0 && (
                <div className="person-modal-affinity">
                  <span className="person-affinity-chip tabular-num">
                    {stats.watchedCount} Watched
                  </span>
                  {stats.averageVaultRating !== null && (
                    <span className="person-affinity-chip is-gold tabular-num">
                      <Star size={12} className="fill-current" aria-hidden="true" />
                      Avg {stats.averageVaultRating}/10
                    </span>
                  )}
                  {stats.watchlistCount > 0 && (
                    <span className="person-affinity-chip tabular-num">
                      {stats.watchlistCount} Watchlist
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="person-modal-actions">
            {resolvedId && onOpenFullProfile && (
              <button
                type="button"
                onClick={() => onOpenFullProfile(resolvedId, activeDepartment)}
                className="person-btn-secondary"
              >
                <span>View Full Profile</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            )}

            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="person-modal-close"
              aria-label="Close person filmography"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="person-modal-body">
          {loading ? (
            <div className="person-skeleton-grid" aria-label="Loading filmography">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="person-skeleton-card" />
              ))}
            </div>
          ) : error ? (
            <div className="person-state-box">
              <AlertCircle size={28} className="text-[var(--text-3)]" aria-hidden="true" />
              <p className="text-[1.45rem] font-semibold text-[var(--text-1)]">{error}</p>
              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="person-btn-secondary"
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          ) : (
            <PersonFilmographyExplorer
              credits={credits}
              activeDepartment={activeDepartment}
              onDepartmentChange={setActiveDepartment}
              showSearch={false}
              watched={watched}
              watchlist={watchlist}
              onSelectMovie={onSelectMovie}
              onQuickRate={onQuickRate}
              onAddToWatchlist={onAddToWatchlist}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
