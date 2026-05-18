import { useParams, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import MovieDetails from "../components/MovieDetails";

export default function MoviePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { watched, watchlist, addWatched, addToWatchlist } = useApp();

  function handleAddWatched(movie) {
    addWatched(movie);
    navigate("/vault");
  }

  function handleAddToWatchlist(movie) {
    addToWatchlist(movie);
    navigate("/vault?tab=watchlist");
  }

  function handleClose() {
    navigate(-1);
  }

  return (
    <div className="movie-page-wrapper">
      <MovieDetails
        selectedId={id}
        onCloseMovie={handleClose}
        onAddWatched={handleAddWatched}
        onAddToWatchlist={handleAddToWatchlist}
        watched={watched}
        watchlist={watchlist}
      />
    </div>
  );
}
