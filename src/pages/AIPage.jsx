import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import MovieRecommendations from "../components/MovieRecommendations";
import AIChat from "../components/AIChat";
import SampleVaultBanner from "../components/SampleVaultBanner";
import { Button, Tabs } from "../components/ui";
import {
  parseAiPageParams,
  loadFilmFocusCache,
  saveFilmFocusCache
} from "../services/filmChatService";
import { findMatchingMovie } from "../services/movieIdentity";
import {
  findTmdbByImdbId,
  fetchTmdbMovieDetails,
  getFallbackPoster
} from "../services/tmdbService";
import { fetchOmdbJson } from "../services/apiTransport";
import { SlidersHorizontal } from "lucide-react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

function normalizeResolvedFocusMovie(rawMovie, parsedParams = {}) {
  if (!rawMovie && !parsedParams.movieKey && !parsedParams.tmdbId) return null;
  const source = rawMovie || {};
  const castArr = Array.isArray(source.cast)
    ? source.cast
    : Array.isArray(source.castDetails)
      ? source.castDetails.map((c) => c?.name).filter(Boolean)
      : (typeof source.cast === "string" && source.cast !== "N/A")
        ? source.cast.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
  const keywordsArr = Array.isArray(source.keywords) && source.keywords.length > 0
    ? source.keywords
    : (Array.isArray(source.keywordNames) ? source.keywordNames : []);
  const title = source.title || source.Title || parsedParams.title || "Untitled Film";

  return {
    ...source,
    imdbID: source.imdbID || parsedParams.imdbID || (parsedParams.tmdbId ? `tmdb_${parsedParams.tmdbId}` : null),
    tmdbId: source.tmdbId ?? parsedParams.tmdbId ?? null,
    title,
    year: source.year || source.Year || "",
    poster: source.poster || (source.Poster && source.Poster !== "N/A" ? source.Poster : null) || getFallbackPoster(title),
    director: source.director || source.Director || "",
    writers: source.writers || source.Writer || "",
    genre: Array.isArray(source.genres) ? source.genres.join(", ") : (source.genre || source.Genre || ""),
    runtime: source.runtime || source.Runtime || "",
    imdbRating: source.imdbRating ?? null,
    plot: source.plot || source.Plot || source.overview || source.shortPlot || "",
    cast: castArr,
    keywords: keywordsArr
  };
}

export default function AIPage({ onOpenTasteDeck }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    watched = [],
    watchlist = [],
    addToWatchlist,
    userRegion,
    aiRecommendations,
    setAiRecommendations,
    aiTasteProfile,
    setAiTasteProfile
  } = useApp();

  const parsedParams = useMemo(() => parseAiPageParams(searchParams), [searchParams]);
  const aiSection = parsedParams.tab;

  const lookupKey = useMemo(() => {
    if (aiSection !== "chat") return null;
    return parsedParams.imdbID || (parsedParams.tmdbId ? `tmdb_${parsedParams.tmdbId}` : parsedParams.movieKey);
  }, [aiSection, parsedParams]);

  const [fetchedFocusState, setFetchedFocusState] = useState({ key: null, movie: null });
  useDocumentTitle("Film Oracle");
  const fetchedFocus = fetchedFocusState?.key === lookupKey ? fetchedFocusState.movie : null;

  useEffect(() => {
    if (!lookupKey) {
      setFetchedFocusState({ key: null, movie: null });
      return;
    }

    const activeKey = lookupKey;
    const cached = loadFilmFocusCache(activeKey);
    if (cached && cached.plot && (cached.director || cached.cast?.length)) {
      setFetchedFocusState({ key: activeKey, movie: cached });
      return;
    }

    const vaultFallback = findMatchingMovie(watched, {
      imdbID: parsedParams.imdbID || parsedParams.movieKey,
      tmdbId: parsedParams.tmdbId,
      title: parsedParams.title
    }) || findMatchingMovie(watchlist, {
      imdbID: parsedParams.imdbID || parsedParams.movieKey,
      tmdbId: parsedParams.tmdbId,
      title: parsedParams.title
    });

    if (cached) {
      setFetchedFocusState({ key: activeKey, movie: cached });
    } else if (vaultFallback) {
      setFetchedFocusState({
        key: activeKey,
        movie: normalizeResolvedFocusMovie(vaultFallback, parsedParams)
      });
    } else {
      setFetchedFocusState({
        key: activeKey,
        movie: normalizeResolvedFocusMovie(null, parsedParams)
      });
    }

    let cancelled = false;

    async function hydrateFocusedFilm() {
      try {
        let resolvedTmdbId = parsedParams.tmdbId;
        if (!resolvedTmdbId && parsedParams.imdbID) {
          const stub = await findTmdbByImdbId(parsedParams.imdbID);
          resolvedTmdbId = stub?.tmdbId || null;
        }

        const [tmdbData, omdbData] = await Promise.all([
          resolvedTmdbId ? fetchTmdbMovieDetails(resolvedTmdbId, userRegion || "US") : Promise.resolve(null),
          parsedParams.imdbID ? fetchOmdbJson({ i: parsedParams.imdbID, plot: "full" }).catch(() => null) : Promise.resolve(null)
        ]);

        if (cancelled || (!tmdbData && (!omdbData || omdbData.Response === "False"))) return;

        const validOmdb = omdbData && omdbData.Response !== "False" ? omdbData : null;
        const merged = normalizeResolvedFocusMovie(
          {
            ...(vaultFallback || {}),
            ...(cached || {}),
            ...(validOmdb || {}),
            ...(tmdbData || {}),
            imdbID: tmdbData?.imdbID || validOmdb?.imdbID || parsedParams.imdbID || vaultFallback?.imdbID || null,
            tmdbId: tmdbData?.tmdbId || resolvedTmdbId || vaultFallback?.tmdbId || null,
            plot: tmdbData?.plot || validOmdb?.Plot || cached?.plot || vaultFallback?.shortPlot || "",
            director: (tmdbData?.director && tmdbData.director !== "Unknown") ? tmdbData.director : (validOmdb?.Director || cached?.director || ""),
            writers: tmdbData?.writers || validOmdb?.Writer || cached?.writers || "",
            poster: tmdbData?.poster || (validOmdb?.Poster && validOmdb.Poster !== "N/A" ? validOmdb.Poster : null) || cached?.poster || vaultFallback?.poster || null,
            imdbRating: validOmdb?.imdbRating && validOmdb.imdbRating !== "N/A"
              ? validOmdb.imdbRating
              : (tmdbData?.vote_average ? String(tmdbData.vote_average) : null)
          },
          parsedParams
        );

        if (!cancelled && merged) {
          saveFilmFocusCache(merged);
          setFetchedFocusState({ key: activeKey, movie: merged });
        }
      } catch (err) {
        console.warn("Focused film hydration failed:", err);
      }
    }

    hydrateFocusedFilm();
    return () => {
      cancelled = true;
    };
  }, [lookupKey, parsedParams.imdbID, parsedParams.tmdbId, parsedParams.movieKey, parsedParams.title, userRegion]);

  const focusedMovie = useMemo(() => {
    if (!lookupKey) return null;
    const base = fetchedFocus || loadFilmFocusCache(lookupKey) || normalizeResolvedFocusMovie(null, parsedParams);
    if (!base) return null;
    const vaultEntry = findMatchingMovie(watched, base);
    const watchlistEntry = findMatchingMovie(watchlist, base);
    return {
      ...base,
      isWatched: Boolean(vaultEntry),
      isWatchlist: Boolean(watchlistEntry),
      userRating: vaultEntry?.userRating ?? base.userRating ?? null,
      userNote: vaultEntry?.userNote ?? base.userNote ?? "",
      vaultEntry: vaultEntry || null,
      watchlistEntry: watchlistEntry || null
    };
  }, [lookupKey, fetchedFocus, watched, watchlist, parsedParams]);

  function handleTabChange(nextTab) {
    if (nextTab === "chat") {
      const next = new URLSearchParams(searchParams);
      next.set("tab", "chat");
      setSearchParams(next);
      return;
    }
    setSearchParams({ tab: "recs" });
  }

  function handleClearFocusedMovie() {
    setFetchedFocusState({ key: null, movie: null });
    setSearchParams({ tab: "chat" });
  }

  return (
    <div className={`ai-page-wrapper ${aiSection === "chat" ? "chat-mode" : ""}`}>
      <div className="ai-page-container page-rail">
        <header className="ai-studio-header">
          <div className="ai-header-top">
            <div className="ai-studio-brand">
              <h1 className="ai-studio-title display-title">Film Oracle</h1>
              <p className="ai-studio-desc">
                Personalized picks and film conversation tuned to your rated library.
              </p>
            </div>

            {onOpenTasteDeck && (
              <div className="ai-header-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  className="ai-calibrate-btn"
                  onClick={onOpenTasteDeck}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  <span>Taste Calibration</span>
                </Button>
              </div>
            )}
          </div>

          <div className="ai-subnav-bar">
            <Tabs
              tabs={[
                { id: "recs", label: "Picks" },
                { id: "chat", label: "Film Companion" }
              ]}
              activeTab={aiSection}
              onChange={handleTabChange}
            />
          </div>
        </header>

        <SampleVaultBanner />

        <main className="ai-page-body">
          {aiSection === "recs" && (
            <MovieRecommendations
              watched={watched}
              onAddToWatchlist={addToWatchlist}
              watchlist={watchlist}
              recommendations={aiRecommendations}
              setRecommendations={setAiRecommendations}
              tasteProfile={aiTasteProfile}
              setTasteProfile={setAiTasteProfile}
              onOpenTasteDeck={onOpenTasteDeck}
            />
          )}

          {aiSection === "chat" && (
            <AIChat
              watched={watched}
              watchlist={watchlist}
              focusKey={lookupKey}
              focusedMovie={focusedMovie}
              onClearFocusedMovie={handleClearFocusedMovie}
            />
          )}
        </main>
      </div>
    </div>
  );
}
