import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { goBackOrHome, hasBrowserHistory } from "../services/navHelpers";
import MovieDetails from "../components/MovieDetails";

export default function MoviePage({ onQuickRate }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { watched, watchlist, addWatched, addToWatchlist, deleteWatchlist } = useApp();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

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
        watched={watched}
        watchlist={watchlist}
      />
    </div>
  );
}

