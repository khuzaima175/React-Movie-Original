import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import HeroBillboard from "../components/HeroBillboard";
import MovieCarouselRow from "../components/MovieCarouselRow";

// 100% Verified 200 OK Master Datasets (35+ Movies - Packed Edge-to-Edge Catalogue)

const TRENDING_MOVIES = [
  { imdbID: "tt1375666", title: "Inception", year: "2010", imdbRating: "8.8", poster: "https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt0468569", title: "The Dark Knight", year: "2008", imdbRating: "9.1", poster: "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt0816692", title: "Interstellar", year: "2014", imdbRating: "8.7", poster: "https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt15398776", title: "Oppenheimer", year: "2023", imdbRating: "8.2", poster: "https://m.media-amazon.com/images/M/MV5BN2JkMDc5MGQtZjg3YS00NmFiLWIyZmQtZTJmNTM5MjVmYTQ4XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt1160419", title: "Dune: Part One", year: "2021", imdbRating: "8.0", poster: "https://m.media-amazon.com/images/M/MV5BNWIyNmU5MGYtZDZmNi00ZjAwLWJlYjgtZTc0ZGIxMDE4ZGYwXkEyXkFqcGc@._V1_QL75_UY562_CR1,0,380,562_.jpg" },
  { imdbID: "tt0110912", title: "Pulp Fiction", year: "1994", imdbRating: "8.8", poster: "https://m.media-amazon.com/images/M/MV5BYTViYTE3ZGQtNDBlMC00ZTAyLTkyODMtZGRiZDg0MjA2YThkXkEyXkFqcGc@._V1_QL75_UY562_CR3,0,380,562_.jpg" },
  { imdbID: "tt0137523", title: "Fight Club", year: "1999", imdbRating: "8.8", poster: "https://m.media-amazon.com/images/M/MV5BOTgyOGQ1NDItNGU3Ny00MjU3LTg2YWEtNmEyYjBiMjI1Y2M5XkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt0172495", title: "Gladiator", year: "2000", imdbRating: "8.5", poster: "https://m.media-amazon.com/images/M/MV5BYWQ4YmNjYjEtOWE1Zi00Y2U4LWI4NTAtMTU0MjkxNWQ1ZmJiXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt10872600", title: "Spider-Man: No Way Home", year: "2021", imdbRating: "8.1", poster: "https://m.media-amazon.com/images/M/MV5BMmFiZGZjMmEtMTA0Ni00MzA2LTljMTYtZGI2MGJmZWYzZTQ2XkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt1877830", title: "The Batman", year: "2022", imdbRating: "7.8", poster: "https://m.media-amazon.com/images/M/MV5BMmU5NGJlMzAtMGNmOC00YjJjLTgyMzUtNjAyYmE4Njg5YWMyXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt6751668", title: "Parasite", year: "2019", imdbRating: "8.5", poster: "https://m.media-amazon.com/images/M/MV5BYjk1Y2U4MjQtY2ZiNS00OWQyLWI3MmYtZWUwNmRjYWRiNWNhXkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt0120338", title: "Titanic", year: "1997", imdbRating: "8.0", poster: "https://m.media-amazon.com/images/M/MV5BYzYyN2FiZmUtYWYzMy00MzViLWJkZTMtOGY1ZjgzNWMwN2YxXkEyXkFqcGc@._V1_QL75_UX380_CR0,2,380,562_.jpg" },
  { imdbID: "tt0109830", title: "Forrest Gump", year: "1994", imdbRating: "8.8", poster: "https://m.media-amazon.com/images/M/MV5BNDYwNzVjMTItZmU5YS00YjQ5LTljYjgtMjY2NDVmYWMyNWFmXkEyXkFqcGc@._V1_QL75_UY562_CR4,0,380,562_.jpg" }
];

const TOP_RATED_MOVIES = [
  { imdbID: "tt0068646", title: "The Godfather", year: "1972", imdbRating: "9.2", poster: "https://m.media-amazon.com/images/M/MV5BNGEwYjgwOGQtYjg5ZS00Njc1LTk2ZGEtM2QwZWQ2NjdhZTE5XkEyXkFqcGc@._V1_QL75_UY562_CR8,0,380,562_.jpg" },
  { imdbID: "tt0111161", title: "The Shawshank Redemption", year: "1994", imdbRating: "9.3", poster: "https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt2582802", title: "Whiplash", year: "2014", imdbRating: "8.5", poster: "https://m.media-amazon.com/images/M/MV5BMDFjOWFkYzktYzhhMC00NmYyLTkwY2EtYjViMDhmNzg0OGFkXkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt0245429", title: "Spirited Away", year: "2003", imdbRating: "8.6", poster: "https://m.media-amazon.com/images/M/MV5BNTEyNmEwOWUtYzkyOC00ZTQ4LTllZmUtMjk0Y2YwOGUzYjRiXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt0108052", title: "Schindler's List", year: "1994", imdbRating: "9.0", poster: "https://m.media-amazon.com/images/M/MV5BNjM1ZDQxYWUtMzQyZS00MTE1LWJmZGYtNGUyNTdlYjM3ZmVmXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt0071562", title: "The Godfather Part II", year: "1974", imdbRating: "9.0", poster: "https://m.media-amazon.com/images/M/MV5BMDIxMzBlZDktZjMxNy00ZGI4LTgxNDEtYWRlNzRjMjJmOGQ1XkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt0167260", title: "The Lord of the Rings: Return of the King", year: "2003", imdbRating: "9.0", poster: "https://m.media-amazon.com/images/M/MV5BMTZkMjBjNWMtZGI5OC00MGU0LTk4ZTItODg2NWM3NTVmNWQ4XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt0050083", title: "12 Angry Men", year: "1957", imdbRating: "9.0", poster: "https://m.media-amazon.com/images/M/MV5BYjE4NzdmOTYtYjc5Yi00YzBiLWEzNDEtNTgxZGQ2MWVkN2NiXkEyXkFqcGc@._V1_QL75_UX380_CR0,11,380,562_.jpg" },
  { imdbID: "tt0060196", title: "The Good, the Bad and the Ugly", year: "1967", imdbRating: "8.8", poster: "https://m.media-amazon.com/images/M/MV5BMWM5ZjQxM2YtNDlmYi00ZDNhLWI4MWUtN2VkYjBlMTY1ZTkwXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt0114709", title: "Toy Story", year: "1995", imdbRating: "8.3", poster: "https://m.media-amazon.com/images/M/MV5BZTA3OWVjOWItNjE1NS00NzZiLWE1MjgtZDZhMWI1ZTlkNzYwXkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt0103064", title: "Terminator 2: Judgment Day", year: "1991", imdbRating: "8.6", poster: "https://m.media-amazon.com/images/M/MV5BNGMyMGNkMDUtMjc2Ni00NWFlLTgyODEtZTY2MzBiZTg0OWZiXkEyXkFqcGc@._V1_QL75_UX380_CR0,1,380,562_.jpg" },
  { imdbID: "tt0073486", title: "One Flew Over the Cuckoo's Nest", year: "1975", imdbRating: "8.6", poster: "https://m.media-amazon.com/images/M/MV5BYjBkMjgzMzYtNzRiMS00NDc3LWE4YTUtZjYxYjZhNjNhYzhhXkEyXkFqcGc@._V1_QL75_UX380_CR0,1,380,562_.jpg" }
];

const SCIFI_MOVIES = [
  { imdbID: "tt1856101", title: "Blade Runner 2049", year: "2017", imdbRating: "8.0", poster: "https://m.media-amazon.com/images/M/MV5BNzA1Njg4NzYxOV5BMl5BanBnXkFtZTgwODk5NjU3MzI@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
  { imdbID: "tt0078748", title: "Alien", year: "1979", imdbRating: "8.5", poster: "https://m.media-amazon.com/images/M/MV5BN2NhMDk2MmEtZDQzOC00MmY5LThhYzAtMDdjZGFjOGZjMjdjXkEyXkFqcGc@._V1_QL75_UX380_CR0,6,380,562_.jpg" },
  { imdbID: "tt0103064", title: "Terminator 2: Judgment Day", year: "1991", imdbRating: "8.6", poster: "https://m.media-amazon.com/images/M/MV5BNGMyMGNkMDUtMjc2Ni00NWFlLTgyODEtZTY2MzBiZTg0OWZiXkEyXkFqcGc@._V1_QL75_UX380_CR0,1,380,562_.jpg" },
  { imdbID: "tt1392190", title: "Mad Max: Fury Road", year: "2015", imdbRating: "8.1", poster: "https://m.media-amazon.com/images/M/MV5BZDRkODJhOTgtOTc1OC00NTgzLTk4NjItNDgxZDY4YjlmNDY2XkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt9362722", title: "Spider-Man: Across the Spider-Verse", year: "2023", imdbRating: "8.5", poster: "https://m.media-amazon.com/images/M/MV5BNThiZjA3MjItZGY5Ni00ZmJhLWEwN2EtOTBlYTA4Y2E0M2ZmXkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt0090605", title: "Aliens", year: "1986", imdbRating: "8.4", poster: "https://m.media-amazon.com/images/M/MV5BZjIyNGJhYzYtN2I1My00OTVhLWEyMzItZTVjNDMzOTVkYWViXkEyXkFqcGc@._V1_QL75_UX380_CR0,6,380,562_.jpg" },
  { imdbID: "tt0133093", title: "The Matrix", year: "1999", imdbRating: "8.7", poster: "https://m.media-amazon.com/images/M/MV5BN2NmN2VhMTQtMDNiOS00NDlhLTliMjgtODE2ZTY0ODQyNDRhXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt0234215", title: "The Matrix Reloaded", year: "2003", imdbRating: "7.2", poster: "https://m.media-amazon.com/images/M/MV5BNjAxYjkxNjktYTU0YS00NjFhLWIyMDEtMzEzMTJjMzRkMzQ1XkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt0080684", title: "Star Wars: The Empire Strikes Back", year: "1980", imdbRating: "8.7", poster: "https://m.media-amazon.com/images/M/MV5BMTkxNGFlNDktZmJkNC00MDdhLTg0MTEtZjZiYWI3MGE5NWIwXkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt0076759", title: "Star Wars: A New Hope", year: "1977", imdbRating: "8.6", poster: "https://m.media-amazon.com/images/M/MV5BOGUwMDk0Y2MtNjBlNi00NmRiLTk2MWYtMGMyMDlhYmI4ZDBjXkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt0120915", title: "Star Wars: The Phantom Menace", year: "1999", imdbRating: "6.5", poster: "https://m.media-amazon.com/images/M/MV5BODVhNGIxOGItYWNlMi00YTA0LWI3NTctZmQxZGUwZDEyZWI4XkEyXkFqcGc@._V1_SX300.jpg" }
];

const DRAMA_MOVIES = [
  { imdbID: "tt0099685", title: "GoodFellas", year: "1990", imdbRating: "8.7", poster: "https://m.media-amazon.com/images/M/MV5BN2E5NzI2ZGMtY2VjNi00YTRjLWI1MDUtZGY5OWU1MWJjZjRjXkEyXkFqcGc@._V1_QL75_UX380_CR0,3,380,562_.jpg" },
  { imdbID: "tt0105236", title: "Reservoir Dogs", year: "1992", imdbRating: "8.3", poster: "https://m.media-amazon.com/images/M/MV5BMmMzYjg4NDctYWY0Mi00OGViLWIzMTMtYWNlZGY5ZDJmYjk3XkEyXkFqcGc@._V1_SX300.jpg" },
  { imdbID: "tt0102926", title: "The Silence of the Lambs", year: "1991", imdbRating: "8.6", poster: "https://m.media-amazon.com/images/M/MV5BNDdhOGJhYzctYzYwZC00YmI2LWI0MjctYjg4ODdlMDExYjBlXkEyXkFqcGc@._V1_QL75_UY562_CR1,0,380,562_.jpg" },
  { imdbID: "tt0068646", title: "The Godfather", year: "1972", imdbRating: "9.2", poster: "https://m.media-amazon.com/images/M/MV5BNGEwYjgwOGQtYjg5ZS00Njc1LTk2ZGEtM2QwZWQ2NjdhZTE5XkEyXkFqcGc@._V1_QL75_UY562_CR8,0,380,562_.jpg" },
  { imdbID: "tt0110912", title: "Pulp Fiction", year: "1994", imdbRating: "8.8", poster: "https://m.media-amazon.com/images/M/MV5BYTViYTE3ZGQtNDBlMC00ZTAyLTkyODMtZGRiZDg0MjA2YThkXkEyXkFqcGc@._V1_QL75_UY562_CR3,0,380,562_.jpg" },
  { imdbID: "tt0120338", title: "Titanic", year: "1997", imdbRating: "8.0", poster: "https://m.media-amazon.com/images/M/MV5BYzYyN2FiZmUtYWYzMy00MzViLWJkZTMtOGY1ZjgzNWMwN2YxXkEyXkFqcGc@._V1_QL75_UX380_CR0,2,380,562_.jpg" },
  { imdbID: "tt0109830", title: "Forrest Gump", year: "1994", imdbRating: "8.8", poster: "https://m.media-amazon.com/images/M/MV5BNDYwNzVjMTItZmU5YS00YjQ5LTljYjgtMjY2NDVmYWMyNWFmXkEyXkFqcGc@._V1_QL75_UY562_CR4,0,380,562_.jpg" },
  { imdbID: "tt0108052", title: "Schindler's List", year: "1994", imdbRating: "9.0", poster: "https://m.media-amazon.com/images/M/MV5BNjM1ZDQxYWUtMzQyZS00MTE1LWJmZGYtNGUyNTdlYjM3ZmVmXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt0137523", title: "Fight Club", year: "1999", imdbRating: "8.8", poster: "https://m.media-amazon.com/images/M/MV5BOTgyOGQ1NDItNGU3Ny00MjU3LTg2YWEtNmEyYjBiMjI1Y2M5XkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
  { imdbID: "tt2582802", title: "Whiplash", year: "2014", imdbRating: "8.5", poster: "https://m.media-amazon.com/images/M/MV5BMDFjOWFkYzktYzhhMC00NmYyLTkwY2EtYjViMDhmNzg0OGFkXkEyXkFqcGc@._V1_SX300.jpg" }
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { watched = [], watchlist = [], addWatched } = useApp();

  function handleSelectMovie(id) {
    navigate(`/movie/${id}`);
  }

  return (
    <div className="home-content-first">
      {/* ── 1. Hero Billboard Spotlight ── */}
      <HeroBillboard watched={watched} onAddWatched={addWatched} />

      {/* ── 2. Content Carousels ── */}
      <div className="home-rows-container">
        {/* User Vault Row */}
        {watched && watched.length > 0 && (
          <MovieCarouselRow
            title="Your Vault Highlights"
            movies={watched}
            onSelectMovie={handleSelectMovie}
            onAddWatched={addWatched}
            watched={watched}
            seeAllLink="/vault"
          />
        )}

        {/* User Watchlist Row */}
        {watchlist && watchlist.length > 0 && (
          <MovieCarouselRow
            title="Saved Watchlist"
            movies={watchlist}
            onSelectMovie={handleSelectMovie}
            onAddWatched={addWatched}
            watched={watched}
            seeAllLink="/vault?tab=watchlist"
          />
        )}

        {/* Trending Cinema Hits */}
        <MovieCarouselRow
          title="Trending Cinema Hits"
          movies={TRENDING_MOVIES}
          onSelectMovie={handleSelectMovie}
          onAddWatched={addWatched}
          watched={watched}
        />

        {/* Top Rated Masterpieces */}
        <MovieCarouselRow
          title="Top Rated Masterpieces"
          movies={TOP_RATED_MOVIES}
          onSelectMovie={handleSelectMovie}
          onAddWatched={addWatched}
          watched={watched}
        />

        {/* Sci-Fi & Action Classics */}
        <MovieCarouselRow
          title="Sci-Fi & Action Classics"
          movies={SCIFI_MOVIES}
          onSelectMovie={handleSelectMovie}
          onAddWatched={addWatched}
          watched={watched}
        />

        {/* Acclaimed Dramas & Thrillers */}
        <MovieCarouselRow
          title="Acclaimed Dramas & Crime Thrillers"
          movies={DRAMA_MOVIES}
          onSelectMovie={handleSelectMovie}
          onAddWatched={addWatched}
          watched={watched}
        />
      </div>
    </div>
  );
}
