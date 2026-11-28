import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import GameCard from "./GameCard";

export default function GameCarouselRow({
  title,
  subtitle = "",
  games = [],
  showMatch = false,
  seeAllTo = "",
  seeAllLabel = "See all",
  loading = false
}) {
  const scrollRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startLeft: 0, moved: false, suppressClick: false });
  const [canScroll, setCanScroll] = useState(false);
  const [edges, setEdges] = useState({ start: false, end: true });
  const [revealRef, isRevealed] = useScrollReveal({
    rootMargin: "0px 0px -36px 0px",
    threshold: 0.05,
    eagerOffset: -30
  });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 12;
    setCanScroll(overflow);
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    updateEdges();
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(updateEdges);
      ro.observe(el);
    }
    window.addEventListener("resize", updateEdges);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateEdges);
    };
  }, [games.length, updateEdges]);

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

  function scrollByDir(dir) {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -560 : 560, behavior: "smooth" });
  }

  return (
    <section
      ref={revealRef}
      className={`gv-carousel-section ${isRevealed ? "is-revealed" : ""}`}
    >
      <div className="gv-carousel-header">
        <div>
          <h2 className="gv-section-title">{title}</h2>
          {subtitle && <p className="gv-section-sub">{subtitle}</p>}
        </div>

        <div className="gv-carousel-header-right">
          {seeAllTo && (
            <Link to={seeAllTo} className="gv-carousel-see-all">
              {seeAllLabel} →
            </Link>
          )}
          {canScroll && (
            <div className="gv-carousel-arrows">
              <button
                type="button"
                className="gv-carousel-arrow"
                onClick={() => scrollByDir("left")}
                disabled={!edges.start}
                aria-label={`Scroll ${title} left`}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                className="gv-carousel-arrow"
                onClick={() => scrollByDir("right")}
                disabled={!edges.end}
                aria-label={`Scroll ${title} right`}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="gv-carousel-track">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="gv-skeleton" style={{ aspectRatio: "3/4.5" }} />
          ))}
        </div>
      ) : (
        <div className={`gv-carousel-wrap ${edges.start ? "fade-left" : ""} ${edges.end ? "fade-right" : ""}`}>
          <div
            ref={scrollRef}
            className="gv-carousel-track"
            onScroll={updateEdges}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClickCapture={handleClickCapture}
          >
            {games.map((game, idx) => (
              <GameCard key={game.igdbId} game={game} showMatch={showMatch} index={idx} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
