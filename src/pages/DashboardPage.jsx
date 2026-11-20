import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { useApp } from "../context/AppContext";
import HeroBillboard from "../components/HeroBillboard";
import MovieCarouselRow from "../components/MovieCarouselRow";
import RowSkeleton from "../components/RowSkeleton";
import HomePosterGrid from "../components/HomePosterGrid";
import QuickRateModal from "../components/QuickRateModal";
import { loadHomeDiscoveryFeeds, buildPersonalizedHomeRow } from "../services/dashboardService";
import { loadLatestLocalExploreForYouFallback } from "../services/exploreForYouCache";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const HOME_FOR_YOU_MIN_RATED = 3;

export default function DashboardPage({ onOpenTasteDeck }) {
  useDocumentTitle("Discover");
  const navigate = useNavigate();
  const {
    watched = [],
    watchlist = [],
    tasteRules = [],
    userRegion = "GLOBAL",
    forYouLivePool = null,
    addWatched,
    addToWatchlist
  } = useApp();
  const [feeds, setFeeds] = useState({ heroSlides: [], rows: [], mosaicPool: [], isLive: false });
  const [hasLoadedFeeds, setHasLoadedFeeds] = useState(false);
  const [cachedForYouItems, setCachedForYouItems] = useState([]);
  const [quickAddMovie, setQuickAddMovie] = useState(null);

  const ratedCount = useMemo(
    () => (Array.isArray(watched) ? watched.filter((m) => Number(m?.userRating) > 0).length : 0),
    [watched]
  );

  const vaultTasteSignature = useMemo(() => {
    const sample = (Array.isArray(watched) ? watched : [])
      .slice(0, 10)
      .map((m) => `${m?.tmdbId || m?.imdbID || m?.title}:${m?.userRating || 0}`)
      .join("|");
    return `${ratedCount}:${watched.length}:${sample}`;
  }, [watched, ratedCount]);

  useEffect(() => {
    if (ratedCount < HOME_FOR_YOU_MIN_RATED) {
      setCachedForYouItems([]);
      return undefined;
    }
    let active = true;
    loadLatestLocalExploreForYouFallback()
      .then((fallback) => {
        if (active) {
          setCachedForYouItems(fallback?.items?.length > 0 ? fallback.items : []);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ratedCount, vaultTasteSignature]);

  const activeForYouSource =
    Array.isArray(forYouLivePool?.items) && forYouLivePool.items.length > 0
      ? forYouLivePool.items
      : cachedForYouItems;

  const personalizedTasteRow = useMemo(
    () =>
      ratedCount >= HOME_FOR_YOU_MIN_RATED
        ? buildPersonalizedHomeRow({
            forYouItems: activeForYouSource,
            watched,
            watchlist,
            tasteRules,
            limit: 20
          })
        : null,
    [ratedCount, activeForYouSource, watched, watchlist, tasteRules]
  );

  const resolvedRows = useMemo(() => {
    const baseRows = Array.isArray(feeds.rows) ? feeds.rows : [];
    if (!personalizedTasteRow) return baseRows;
    const tasteKeys = new Set(
      personalizedTasteRow.movies.flatMap((m) => [
        m.tmdbId ? `tmdb:${m.tmdbId}` : null,
        m.imdbID ? `imdb:${String(m.imdbID).toLowerCase()}` : null
      ]).filter(Boolean)
    );
    const dedupedOtherRows = baseRows
      .filter((r) => r.key !== "taste")
      .map((row) => ({
        ...row,
        movies: (row.movies || []).filter((m) => {
          if (m.tmdbId && tasteKeys.has(`tmdb:${m.tmdbId}`)) return false;
          if (m.imdbID && tasteKeys.has(`imdb:${String(m.imdbID).toLowerCase()}`)) return false;
          return true;
        })
      }))
      .filter((row) => row.movies.length > 0);
    return [personalizedTasteRow, ...dedupedOtherRows];
  }, [feeds.rows, personalizedTasteRow]);

  useEffect(() => {
    let isActive = true;
    const regionForDiscover = userRegion && userRegion !== "GLOBAL" ? userRegion : "US";

    loadHomeDiscoveryFeeds({
      watched,
      watchlist,
      userRegion: regionForDiscover
    })
      .then((result) => {
        if (isActive && result) {
          setFeeds(result);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isActive) setHasLoadedFeeds(true);
      });

    return () => {
      isActive = false;
    };
  }, [watched, watchlist, userRegion]);

  function handleSelectMovie(id) {
    navigate(`/movie/${id}`);
  }

  return (
    <div className="home-content-first">
      <HeroBillboard
        slides={feeds.heroSlides}
        watched={watched}
        watchlist={watchlist}
        onAddWatched={addWatched}
        onAddToWatchlist={addToWatchlist}
        onOpenTasteDeck={onOpenTasteDeck}
        loading={!hasLoadedFeeds}
      />

      <div className="home-rows-container">
        {!hasLoadedFeeds && (!feeds.rows || feeds.rows.length === 0) && (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}
        {watchlist && watchlist.length > 0 && (
          <MovieCarouselRow
            title="Watchlist"
            movies={watchlist}
            onSelectMovie={handleSelectMovie}
            onQuickAdd={setQuickAddMovie}
            onAddWatched={addWatched}
            watched={watched}
            seeAllLink="/vault?tab=watchlist"
          />
        )}

        {resolvedRows.map((row) => (
          <MovieCarouselRow
            key={row.key || row.title}
            title={row.title}
            movies={row.movies}
            onSelectMovie={handleSelectMovie}
            onQuickAdd={setQuickAddMovie}
            onAddWatched={addWatched}
            watched={watched}
            seeAllLink={row.seeAllLink}
          />
        ))}

        {watched && watched.length > 0 && (
          <MovieCarouselRow
            title="Your Vault Highlights"
            movies={watched}
            onSelectMovie={handleSelectMovie}
            onQuickAdd={setQuickAddMovie}
            onAddWatched={addWatched}
            watched={watched}
            seeAllLink="/vault"
          />
        )}

        <div className="page-rail">
          <div className="dashboard-explore-banner">
            <div className="dashboard-explore-copy">
              <h3>Research &amp; Filter the Full Catalog</h3>
              <p>Dial in exact genres, motifs, runtime, acclaim floor, directors, and streaming hubs.</p>
            </div>
            <Link to="/explore" className="dashboard-explore-link">
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span>Open Deep Filter &rarr;</span>
            </Link>
          </div>
        </div>

        <HomePosterGrid
          rows={resolvedRows}
          mosaicPool={feeds.mosaicPool}
          watched={watched}
          onSelectMovie={handleSelectMovie}
          onQuickAdd={setQuickAddMovie}
          onAddWatched={addWatched}
        />
      </div>

      <QuickRateModal
        movie={quickAddMovie}
        watched={watched}
        watchlist={watchlist}
        onClose={() => setQuickAddMovie(null)}
        onSaveWatched={addWatched}
        onAddToWatchlist={addToWatchlist}
      />
    </div>
  );
}
