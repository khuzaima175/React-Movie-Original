import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { goBackOrHome, hasBrowserHistory } from "../services/navHelpers";
import MovieDetails from "../components/MovieDetails";

export default function MoviePage({ onQuickRate }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { watched, watchlist, addWatched, addToWatchlist, deleteWatchlist } = useApp();
  const [resolvedTitle, setResolvedTitle] = useState("");

  useEffect(() => {
    window.scrollTo(0, 0);
    setResolvedTitle("");
  }, [id]);

  const knownTitle = useMemo(() => {
    const target = String(id || "").toLowerCase();
    const match = [...(watched || []), ...(watchlist || [])].find(
      (m) =>
        String(m?.imdbID || "").toLowerCase() === target ||
        (m?.tmdbId && `tmdb_${m.tmdbId}`.toLowerCase() === target) ||
        String(m?.id || "").toLowerCase() === target
    );
    return match?.title || match?.Title || "";
  }, [id, watched, watchlist]);

  useDocumentTitle(resolvedTitle || knownTitle || "Film Details");

  function handleAddWatched(movie) {
    addWatched(movie);
  }

  function handleAddToWatchlist(movie) {
    addToWatchlist(movie);
  }

  function handleRemoveWatchlist(movieId) {
    deleteWatchlist(movieId);
  }

  function handleClose() {
    goBackOrHome(navigate, hasBrowserHistory());
  }

  return (
    <div className="movie-page-wrapper">
      <MovieDetails
        selectedId={id}
        onCloseMovie={handleClose}
        onAddWatched={handleAddWatched}
        onAddToWatchlist={handleAddToWatchlist}
        onRemoveWatchlist={handleRemoveWatchlist}
        onQuickRate={onQuickRate}
        onTitleResolved={setResolvedTitle}
        watched={watched}
        watchlist={watchlist}
      />
    </div>
  );
}

