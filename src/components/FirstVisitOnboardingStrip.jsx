import { useEffect, useMemo, useState } from "react";
import { Bookmark, Sparkles, SlidersHorizontal, Upload, X, Check, RefreshCw } from "lucide-react";
import { useApp } from "../context/AppContext";
import PosterImage from "./PosterImage";
import { Button } from "./ui/Button";
import { prepareQuickRatePayload, prepareWatchlistPayload } from "../services/ratingTiers";
import { buildSeenCollisionSet } from "../services/dashboardService";
import {
  INLINE_ONBOARDING_DISMISSED_KEY,
  STARTER_GENRE_FILTERS,
  retainRatedInlineStarters,
  shouldShowInlineOnboardingBanner
} from "../services/tasteDeckService";

export default function FirstVisitOnboardingStrip({
  onOpenTasteDeck,
  onOpenImport,
  livePool = []
}) {
  const {
    watched = [],
    watchlist = [],
    addWatched,
    addToWatchlist,
    hasCloudConfig = false,
    cloudUser = null,
    isAuthLoading = false,
    cloudSyncStatus = "idle",
    forYouLivePool = null,
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
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [skippedIds, setSkippedIds] = useState(() => new Set());
  const [justRatedIds, setJustRatedIds] = useState(() => ({}));
  const [batch, setBatch] = useState([]);

  const ratedCount = useMemo(
    () => (Array.isArray(watched) ? watched.filter((m) => Number(m?.userRating) > 0).length : 0),
    [watched]
  );

  const watchlistSet = useMemo(
    () => buildSeenCollisionSet([], watchlist),
    [watchlist]
  );

  const isCloudSyncPending = Boolean(
    hasCloudConfig &&
      (cloudSyncStatus === "syncing" || (cloudUser && cloudSyncStatus === "idle" && ratedCount === 0))
  );

  const visible = shouldShowInlineOnboardingBanner({
    watchedCount: ratedCount,
    dismissedFlag: dismissed ? "true" : null,
    isVaultHydrated,
    isAuthLoading,
    isCloudSyncPending
  });

  useEffect(() => {
    if (!visible) return;
    setBatch((prev) =>
      retainRatedInlineStarters(prev, {
        justRatedIds,
        skippedIds,
        watched,
        watchlist,
        livePool,
        preferredGenres: selectedGenres,
        limit: 8
      })
    );
    // Intentionally exclude `watched` when cards are already mounted so rated cards stay in place
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, skippedIds, selectedGenres, livePool]);

  const hasLiveForYou = Array.isArray(forYouLivePool?.items) && forYouLivePool.items.length > 0;
  const showUnlockedBanner = Object.keys(justRatedIds).length > 0 && ratedCount >= 3 && !dismissed;
  if ((!visible && !showUnlockedBanner) || (visible && batch.length === 0)) return null;

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

  function handleSwapUnseen() {
    const unseenIds = batch
      .filter((m) => m?.imdbID && !justRatedIds[m.imdbID])
      .map((m) => m.imdbID);
    if (unseenIds.length === 0) return;
    setSkippedIds((prev) => {
      const next = new Set(prev);
      for (const id of unseenIds) next.add(id);
      return next;
    });
  }

  function handleToggleGenre(genre) {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre].slice(0, 3)
    );
  }

  function handleQuickWatchlist(movie) {
    const payload = prepareWatchlistPayload(movie);
    if (payload) addToWatchlist?.(payload);
  }

  return (
    <section className="page-rail" aria-label="Quick taste calibration">
      <div className="rounded-[var(--r-xl)] border border-[var(--hairline-strong)] bg-[var(--surface-1)]/90 p-5 sm:p-6 shadow-[0_18px_48px_rgba(0,0,0,0.35)]">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <div className="inline-flex items-center gap-2 text-[1.15rem] uppercase tracking-[0.12em] font-semibold text-amber-300 mb-1.5">
              <Sparkles size={13} aria-hidden="true" />
              <span>Fast Taste Calibration · {Math.min(3, ratedCount)}/3 to unlock</span>
            </div>
            <h2 className="m-0 text-[2rem] sm:text-[2.2rem] font-semibold tracking-tight text-[var(--text-1)]">
              {remainingNeeded > 0
                ? `React to ${remainingNeeded} more ${remainingNeeded === 1 ? "film" : "films"} you know — Love, Like, or Not for me`
                : hasLiveForYou
                  ? "Taste Profile unlocked — “Picked For Your Taste” is live below"
                  : "Taste Profile unlocked — building your personalized Discover row…"}
            </h2>
            <p className="mt-1 mb-0 text-[1.32rem] text-[var(--text-2)]">
              Pick genres you love below to swap recognizable films in 1 tap, or import your Letterboxd history.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {batch.some((m) => !justRatedIds[m.imdbID]) && remainingNeeded > 0 && (
              <Button type="button" variant="secondary" size="sm" icon={RefreshCw} onClick={handleSwapUnseen}>
                Swap Unseen
              </Button>
            )}
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

        {/* 1-tap Genre Preference Chips to narrow starter cards immediately */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4" role="group" aria-label="Filter starter films by favorite genre">
          <button
            type="button"
            onClick={() => setSelectedGenres([])}
            className={`px-3 py-1 rounded-full text-[1.18rem] font-medium border cursor-pointer transition-colors ${
              selectedGenres.length === 0
                ? "bg-amber-400/18 border-amber-400/45 text-amber-200"
                : "bg-[var(--surface-2)] border-[var(--hairline)] text-[var(--text-3)] hover:text-[var(--text-1)]"
            }`}
          >
            All Genres
          </button>
          {STARTER_GENRE_FILTERS.map((genre) => {
            const active = selectedGenres.includes(genre);
            return (
              <button
                key={genre}
                type="button"
                aria-pressed={active}
                onClick={() => handleToggleGenre(genre)}
                className={`px-3 py-1 rounded-full text-[1.18rem] font-medium border cursor-pointer transition-colors ${
                  active
                    ? "bg-amber-400/18 border-amber-400/45 text-amber-200"
                    : "bg-[var(--surface-2)] border-[var(--hairline)] text-[var(--text-3)] hover:text-[var(--text-1)]"
                }`}
              >
                {genre}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3.5">
          {batch.map((movie) => {
            const scored = justRatedIds[movie.imdbID];
            const isQueued =
              Boolean(movie.imdbID && watchlistSet.has(`imdb:${String(movie.imdbID).toLowerCase()}`)) ||
              Boolean(movie.tmdbId && watchlistSet.has(`tmdb:${movie.tmdbId}`));
            return (
              <article
                key={movie.imdbID}
                className="flex flex-col rounded-[var(--r-md)] border border-[var(--hairline)] bg-[var(--surface-2)]/70 overflow-hidden"
              >
                <div className="relative aspect-[2/3] w-full bg-[var(--surface-3)]">
                  <PosterImage src={movie.poster} title={movie.title} />
                  {!scored && addToWatchlist && (
                    <button
                      type="button"
                      onClick={() => handleQuickWatchlist(movie)}
                      aria-label={isQueued ? `${movie.title} in Watchlist` : `Add ${movie.title} to Watchlist`}
                      title={isQueued ? "In Watchlist" : "Save to Watchlist"}
                      className={`absolute top-1.5 right-1.5 z-[2] w-[2.6rem] h-[2.6rem] rounded-full flex items-center justify-center border cursor-pointer transition-colors ${
                        isQueued
                          ? "bg-emerald-500/85 border-emerald-300/60 text-white"
                          : "bg-black/65 border-white/20 text-white/85 hover:bg-black/85"
                      }`}
                    >
                      <Bookmark size={12} fill={isQueued ? "currentColor" : "none"} aria-hidden="true" />
                    </button>
                  )}
                  {scored && (
                    <div className="absolute inset-0 bg-black/72 flex items-center justify-center text-amber-300 font-semibold text-[1.3rem] gap-1">
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
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleQuickScore(movie, 9)}
                        className="flex-1 py-1 px-1.5 rounded-[var(--r-sm)] text-[1.12rem] font-semibold bg-amber-400/15 text-amber-200 border border-amber-400/30 hover:bg-amber-400/25 transition-colors cursor-pointer"
                      >
                        Love
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickScore(movie, 7)}
                        className="flex-1 py-1 px-1.5 rounded-[var(--r-sm)] text-[1.12rem] font-medium bg-[var(--surface-3)] text-[var(--text-1)] border border-[var(--hairline)] hover:border-[var(--hairline-strong)] transition-colors cursor-pointer"
                      >
                        Like
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleQuickScore(movie, 3)}
                        title="Not for me (3/10)"
                        className="flex-1 py-0.5 px-1.5 rounded-[var(--r-sm)] text-[1.06rem] font-medium bg-rose-500/10 text-rose-200/85 border border-rose-500/20 hover:bg-rose-500/20 transition-colors cursor-pointer"
                      >
                        Not for me
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSkip(movie)}
                        title="Haven't seen — swap film"
                        aria-label={`Haven't seen ${movie.title}`}
                        className="py-0.5 px-2 rounded-[var(--r-sm)] text-[1.06rem] text-[var(--text-3)] hover:text-[var(--text-1)] bg-transparent border border-[var(--hairline)]/60 cursor-pointer"
                      >
                        Unseen
                      </button>
                    </div>
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
