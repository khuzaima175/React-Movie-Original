import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import HeroBillboard from "../components/HeroBillboard";
import MovieCarouselRow from "../components/MovieCarouselRow";
import HomePosterGrid from "../components/HomePosterGrid";
import QuickRateModal from "../components/QuickRateModal";
import { loadHomeDiscoveryFeeds } from "../services/dashboardService";

export default function DashboardPage({ onOpenTasteDeck }) {
  const navigate = useNavigate();
  const { watched = [], watchlist = [], userRegion = "GLOBAL", addWatched, addToWatchlist } = useApp();
  const [feeds, setFeeds] = useState({ heroSlides: [], rows: [], mosaicPool: [], isLive: false });
  const [quickAddMovie, setQuickAddMovie] = useState(null);

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
      .catch(() => {});

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
      />

      <div className="home-rows-container">
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

        {(feeds.rows || []).map((row) => (
          <MovieCarouselRow
            key={row.key || row.title}
            title={row.title}
            movies={row.movies}
            onSelectMovie={handleSelectMovie}
            onQuickAdd={setQuickAddMovie}
            onAddWatched={addWatched}
            watched={watched}
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

        <HomePosterGrid
          rows={feeds.rows}
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
