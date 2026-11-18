import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import MovieCard from "./MovieCard";
import { shouldShowCarouselArrows } from "../services/dashboardService";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { useHorizontalWheelScroll } from "../hooks/useHorizontalWheelScroll";

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
  const dragRef = useRef({ active: false, startX: 0, startLeft: 0, moved: false, suppressClick: false });
  const [canScroll, setCanScroll] = useState(false);
  const [edges, setEdges] = useState({ start: false, end: true });
  const [revealRef, isRevealed] = useScrollReveal();
  useHorizontalWheelScroll([movies.length], scrollRef);

  function updateEdges() {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateOverflow = () => {
      setCanScroll(shouldShowCarouselArrows(el.scrollWidth, el.clientWidth));
      updateEdges();
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

  // Mouse drag-to-scroll (touch already scrolls natively)
  function handlePointerDown(e) {
    if (e.pointerType !== "mouse" || e.button !== 0 || !scrollRef.current) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startLeft: scrollRef.current.scrollLeft,
      moved: false,
      suppressClick: false
    };
  }

  function handlePointerMove(e) {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag.active || !el) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 6) {
      drag.moved = true;
      el.classList.add("is-dragging");
    }
    if (drag.moved) el.scrollLeft = drag.startLeft - dx;
  }

  function endDrag() {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    scrollRef.current?.classList.remove("is-dragging");
    if (drag.moved) {
      drag.suppressClick = true;
      // Clear in case no click follows (pointer released off a card)
      window.setTimeout(() => {
        dragRef.current.suppressClick = false;
      }, 0);
    }
  }

  function handleClickCapture(e) {
    if (dragRef.current.suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current.suppressClick = false;
    }
  }

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
              See all <span className="carousel-see-all-arrow" aria-hidden="true">&rarr;</span>
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
        <div
          className={`carousel-track ${edges.start ? "fade-start" : ""} ${
            edges.end && canScroll ? "fade-end" : ""
          }`}
          ref={scrollRef}
          onScroll={updateEdges}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={handleClickCapture}
        >
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
