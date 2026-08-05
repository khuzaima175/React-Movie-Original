import { useRef } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import MovieCard from "./MovieCard";

export default function MovieCarouselRow({ title, movies = [], onSelectMovie, onAddWatched, watched = [], seeAllLink }) {
  const scrollRef = useRef(null);

  function scroll(direction) {
    if (!scrollRef.current) return;
    const amount = direction === "left" ? -480 : 480;
    scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
  }

  if (!movies || !Array.isArray(movies) || movies.length === 0) return null;

  return (
    <section className="carousel-section" aria-label={title}>
      <div className="carousel-header">
        <h2 className="carousel-title">{title}</h2>
        <div className="carousel-header-right">
          {seeAllLink && (
            <Link to={seeAllLink} className="carousel-see-all">
              See all &rarr;
            </Link>
          )}
          <div className="carousel-arrows">
            <button
              className="btn-carousel-arrow"
              onClick={() => scroll("left")}
              aria-label={`Scroll ${title} left`}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              className="btn-carousel-arrow"
              onClick={() => scroll("right")}
              aria-label={`Scroll ${title} right`}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="carousel-track" ref={scrollRef}>
        {movies.map((movie) => {
          if (!movie) return null;
          const id = movie.imdbID || movie.id;
          const isWatched = (watched || []).some((w) => w && (w.imdbID === id || w.id === id));

          return (
            <MovieCard
              key={id}
              movie={movie}
              onSelectMovie={onSelectMovie}
              onAddWatched={onAddWatched}
              isWatched={isWatched}
            />
          );
        })}
      </div>
    </section>
  );
}
