import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Star, Plus, Check, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const HERO_SLIDES = [
  {
    imdbID: "tt1375666",
    title: "Inception",
    year: "2010",
    imdbRating: "8.8",
    runtime: "148 min",
    genre: "Action • Sci-Fi • Thriller",
    plot: "A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O., but his tragic past may doom the mission.",
    backdrop: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1920&auto=format&fit=crop",
    poster: "https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_QL75_UX380_CR0,0,380,562_.jpg"
  },
  {
    imdbID: "tt0468569",
    title: "The Dark Knight",
    year: "2008",
    imdbRating: "9.1",
    runtime: "152 min",
    genre: "Action • Crime • Drama",
    plot: "When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests of his ability to fight injustice.",
    backdrop: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=1920&auto=format&fit=crop",
    poster: "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_QL75_UX380_CR0,0,380,562_.jpg"
  },
  {
    imdbID: "tt0816692",
    title: "Interstellar",
    year: "2014",
    imdbRating: "8.7",
    runtime: "169 min",
    genre: "Sci-Fi • Drama • Adventure",
    plot: "When Earth becomes uninhabitable, a team of ex-NASA pilots embarks on the most important mission in human history: traveling beyond this galaxy to discover whether mankind has a future among the stars.",
    backdrop: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1920&auto=format&fit=crop",
    poster: "https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg"
  },
  {
    imdbID: "tt15398776",
    title: "Oppenheimer",
    year: "2023",
    imdbRating: "8.2",
    runtime: "180 min",
    genre: "Biography • Drama • History",
    plot: "The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb during World War II.",
    backdrop: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1920&auto=format&fit=crop",
    poster: "https://m.media-amazon.com/images/M/MV5BN2JkMDc5MGQtZjg3YS00NmFiLWIyZmQtZTJmNTM5MjVmYTQ4XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg"
  }
];

export default function HeroBillboard({ watched = [], onAddWatched }) {
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  const slide = HERO_SLIDES[currentIndex];
  const isWatched = (watched || []).some((m) => m && m.imdbID === slide.imdbID);

  function handleQuickAdd() {
    if (isWatched || !onAddWatched) return;
    onAddWatched({
      imdbID: slide.imdbID,
      title: slide.title,
      year: slide.year,
      poster: slide.poster,
      imdbRating: Number(slide.imdbRating),
      runtime: 160,
      userRating: 9,
      genre: slide.genre,
    });
  }

  return (
    <div className="hero-billboard" aria-label="Featured Film Billboard">
      <AnimatePresence mode="wait">
        <motion.div
          key={slide.imdbID}
          className="hero-backdrop"
          style={{ backgroundImage: `url(${slide.backdrop})` }}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
        />
      </AnimatePresence>

      <div className="hero-scrim-left" />
      <div className="hero-scrim-bottom" />

      <div className="hero-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.imdbID}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="hero-text-block"
          >
            <div className="hero-meta-badges">
              <span className="hero-badge-featured">Featured Spotlight</span>
              <span className="hero-rating">
                <Star size={14} className="icon-star-gold" aria-hidden="true" />
                {slide.imdbRating}
              </span>
              <span className="hero-meta-item">{slide.year}</span>
              <span className="hero-meta-item">{slide.runtime}</span>
            </div>

            <h1 className="hero-title">{slide.title}</h1>
            <p className="hero-genre">{slide.genre}</p>
            <p className="hero-plot">{slide.plot}</p>

            <div className="hero-actions">
              <button
                className={`btn-hero-primary ${isWatched ? "added" : ""}`}
                onClick={handleQuickAdd}
                aria-label={isWatched ? `${slide.title} in Vault` : `Add ${slide.title} to Vault`}
              >
                {isWatched ? (
                  <>
                    <Check size={18} aria-hidden="true" /> In Vault
                  </>
                ) : (
                  <>
                    <Plus size={18} aria-hidden="true" /> Add to Vault
                  </>
                )}
              </button>

              <button
                className="btn-hero-secondary"
                onClick={() => navigate(`/movie/${slide.imdbID}`)}
                aria-label={`View details for ${slide.title}`}
              >
                <Info size={18} aria-hidden="true" /> Details
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Manual Slide Controls */}
      <div className="hero-controls">
        <button
          className="btn-hero-arrow"
          onClick={() => setCurrentIndex((prev) => (prev === 0 ? HERO_SLIDES.length - 1 : prev - 1))}
          aria-label="Previous featured movie"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>

        <div className="hero-indicators">
          {HERO_SLIDES.map((s, idx) => (
            <button
              key={s.imdbID}
              className={`hero-dot ${idx === currentIndex ? "active" : ""}`}
              onClick={() => setCurrentIndex(idx)}
              aria-label={`Go to slide ${idx + 1}: ${s.title}`}
            />
          ))}
        </div>

        <button
          className="btn-hero-arrow"
          onClick={() => setCurrentIndex((prev) => (prev + 1) % HERO_SLIDES.length)}
          aria-label="Next featured movie"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
