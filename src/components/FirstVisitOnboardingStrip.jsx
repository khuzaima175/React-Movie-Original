import { useMemo, useState } from "react";
import { Sparkles, SlidersHorizontal, Upload, X, Check } from "lucide-react";
import { useApp } from "../context/AppContext";
import PosterImage from "./PosterImage";
import { Button } from "./ui/Button";
import { prepareQuickRatePayload } from "../services/ratingTiers";
import {
  INLINE_ONBOARDING_DISMISSED_KEY,
  selectInlineStarterFilms,
  shouldShowInlineOnboardingBanner
} from "../services/tasteDeckService";

export default function FirstVisitOnboardingStrip({
  onOpenTasteDeck,
  onOpenImport
}) {
  const {
    watched = [],
    watchlist = [],
    addWatched,
    cloudUser,
    loadSampleVault,
    isVaultHydrated = true
  } = useApp();

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(INLINE_ONBOARDING_DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [skippedIds, setSkippedIds] = useState(() => new Set());
  const [justRatedIds, setJustRatedIds] = useState(() => ({}));

  const ratedCount = useMemo(
    () => (Array.isArray(watched) ? watched.filter((m) => Number(m?.userRating) > 0).length : 0),
    [watched]
  );

  const visible = shouldShowInlineOnboardingBanner({
    watchedCount: ratedCount,
    dismissedFlag: dismissed ? "true" : null,
    isVaultHydrated
  });

  const starterFilms = useMemo(() => {
    if (!visible) return [];
    return selectInlineStarterFilms({ watched, watchlist, limit: 12 })
      .filter((m) => !skippedIds.has(m.imdbID))
      .slice(0, 8);
  }, [visible, watched, watchlist, skippedIds]);

  if (!visible || starterFilms.length === 0) return null;

  const canTrySampleVault = !cloudUser && watched.length < 3;
  const remainingNeeded = Math.max(0, 3 - ratedCount);

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(INLINE_ONBOARDING_DISMISSED_KEY, "true");
    } catch {
      // ignore storage availability errors
    }
  }

  function handleQuickScore(movie, score) {
    const payload = prepareQuickRatePayload(movie, score);
    if (!payload) return;
    setJustRatedIds((prev) => ({ ...prev, [movie.imdbID]: score }));
    addWatched?.(payload);
  }

  function handleSkip(movie) {
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.add(movie.imdbID);
      return next;
    });
  }

  return (
    <section className="page-rail" aria-label="Quick taste calibration">
      <div className="rounded-[var(--r-xl)] border border-[var(--hairline-strong)] bg-[var(--surface-1)]/90 p-5 sm:p-6 shadow-[0_18px_48px_rgba(0,0,0,0.35)]">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <div className="inline-flex items-center gap-2 text-[1.15rem] uppercase tracking-[0.12em] font-semibold text-amber-300 mb-1.5">
              <Sparkles size={13} aria-hidden="true" />
              <span>Instant Taste Profile · {ratedCount}/3 rated</span>
            </div>
            <h2 className="m-0 text-[2rem] sm:text-[2.2rem] font-semibold tracking-tight text-[var(--text-1)]">
              {remainingNeeded > 0
                ? `Pick ${remainingNeeded} more ${remainingNeeded === 1 ? "film" : "films"} you know to unlock personalized picks`
                : "Taste Profile unlocked"}
            </h2>
            <p className="mt-1 mb-0 text-[1.35rem] text-[var(--text-2)]">
              Tap Love or Like on a few titles, or import your Letterboxd history in seconds.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenImport && (
              <Button type="button" variant="secondary" size="sm" icon={Upload} onClick={onOpenImport}>
                Import Letterboxd / CSV
              </Button>
            )}
            {canTrySampleVault && (
              <Button type="button" variant="secondary" size="sm" onClick={() => loadSampleVault?.()}>
                Try Sample Vault
              </Button>
            )}
            {onOpenTasteDeck && (
              <Button type="button" variant="ghost" size="sm" icon={SlidersHorizontal} onClick={onOpenTasteDeck}>
                Full 30-Film Deck
              </Button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss quick onboarding"
              className="inline-flex items-center justify-center w-[3.2rem] h-[3.2rem] rounded-[var(--r-md)] border border-[var(--hairline)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:border-[var(--hairline-strong)] transition-colors cursor-pointer bg-transparent"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3.5">
          {starterFilms.map((movie) => {
            const scored = justRatedIds[movie.imdbID];
            return (
              <article
                key={movie.imdbID}
                className="flex flex-col rounded-[var(--r-md)] border border-[var(--hairline)] bg-[var(--surface-2)]/70 overflow-hidden"
              >
                <div className="relative aspect-[2/3] w-full bg-[var(--surface-3)]">
                  <PosterImage src={movie.poster} title={movie.title} />
                  {scored && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-amber-300 font-semibold text-[1.3rem] gap-1">
                      <Check size={15} aria-hidden="true" />
                      <span>{scored}/10</span>
                    </div>
                  )}
                </div>
                <div className="p-2.5 flex flex-col gap-2 flex-1 justify-between">
                  <div>
                    <h3 className="m-0 text-[1.25rem] font-semibold text-[var(--text-1)] line-clamp-1" title={movie.title}>
                      {movie.title}
                    </h3>
                    <span className="text-[1.1rem] text-[var(--text-3)]">
                      {movie.year} · {movie.primaryGenre}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleQuickScore(movie, 9)}
                      className="flex-1 py-1 px-1.5 rounded-[var(--r-sm)] text-[1.15rem] font-semibold bg-amber-400/15 text-amber-200 border border-amber-400/30 hover:bg-amber-400/25 transition-colors cursor-pointer"
                    >
                      Love
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickScore(movie, 7)}
                      className="flex-1 py-1 px-1.5 rounded-[var(--r-sm)] text-[1.15rem] font-medium bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--hairline)] hover:border-[var(--hairline-strong)] transition-colors cursor-pointer"
                    >
                      Like
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSkip(movie)}
                      aria-label={`Skip ${movie.title}`}
                      className="py-1 px-1.5 rounded-[var(--r-sm)] text-[1.1rem] text-[var(--text-3)] hover:text-[var(--text-1)] bg-transparent border border-transparent cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
