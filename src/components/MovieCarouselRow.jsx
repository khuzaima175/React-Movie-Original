import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import MovieCard from "./MovieCard";
import { shouldShowCarouselArrows } from "../services/dashboardService";
import { useScrollReveal } from "../hooks/useScrollReveal";

export default function MovieCarouselRow({
  title,
  movies = [],
  onSelectMovie,
  onQuickAdd,
  onAddWatched,
  watched = [],
  seeAllLink
}) {
  const scrollRef = useRef(null);
  const [canScroll, setCanScroll] = useState(false);
  const [revealRef, isRevealed] = useScrollReveal();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateOverflow = () => {
      setCanScroll(shouldShowCarouselArrows(el.scrollWidth, el.clientWidth));
    };

    updateOverflow();

    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(updateOverflow);
      ro.observe(el);
    }
    window.addEventListener("resize", updateOverflow);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [movies.length]);

  function scroll(direction) {
    if (!scrollRef.current) return;
    const amount = direction === "left" ? -480 : 480;
    scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
  }

  if (!movies || !Array.isArray(movies) || movies.length === 0) return null;

  return (
    <section
      ref={revealRef}
      className={`carousel-section cv-reveal ${isRevealed ? "is-visible" : ""}`}
      aria-label={title}
    >
      <div className="carousel-header page-rail">
        <h2 className="carousel-title">{title}</h2>
        <div className="carousel-header-right">
          {seeAllLink && (
            <Link to={seeAllLink} className="carousel-see-all">
              See all &rarr;
            </Link>
          )}
          {canScroll && (
            <div className="carousel-arrows">
              <button
                type="button"
                className="btn-carousel-arrow"
                onClick={() => scroll("left")}
                aria-label={`Scroll ${title} left`}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-carousel-arrow"
                onClick={() => scroll("right")}
                aria-label={`Scroll ${title} right`}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="page-rail">
        <div className="carousel-track" ref={scrollRef}>
        {movies.map((movie) => {
          if (!movie) return null;
          const id = movie.imdbID || movie.id;
          const isWatched = (watched || []).some(
            (w) => w && (w.imdbID === id || w.id === id || (movie.tmdbId && w.tmdbId === movie.tmdbId))
          );

          return (
            <MovieCard
              key={id}
              movie={movie}
              onSelectMovie={onSelectMovie}
              onQuickAdd={onQuickAdd}
              onAddWatched={onAddWatched}
              isWatched={isWatched}
            />
          );
        })}
        </div>
      </div>
    </section>
  );
}
