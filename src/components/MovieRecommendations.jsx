import { useState, useEffect } from "react";
import { getMovieRecommendations, getFallbackPoster } from "../services/geminiService";
import PosterImage from "./PosterImage";
import {
  Sparkles,
  Dna,
  Target,
  BrainCircuit,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Plus,
  Check,
  ChevronDown,
  ChevronUp,
  Star,
  Film,
  SlidersHorizontal,
  AlertCircle
} from "lucide-react";

const getOmdbKey = () => {
  const key = import.meta.env.VITE_OMDB_KEY;
  if (!key || key === "undefined" || key === "null" || key.trim() === "") {
    return "b78bdecd";
  }
  return key.trim();
};
const KEY = getOmdbKey();

function MatchRing({ score }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const normalizedScore = Math.min(100, Math.max(0, score || 0));
  const strokeDashoffset = circumference - (normalizedScore / 100) * circumference;

  return (
    <div className="match-ring-wrapper" title={`${normalizedScore}% Taste Match`}>
      <svg className="match-ring-svg" viewBox="0 0 44 44">
        <circle className="match-ring-bg" cx="22" cy="22" r={radius} />
        <circle
          className="match-ring-progress"
          cx="22"
          cy="22"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
        />
      </svg>
      <div className="match-ring-text">
        <span className="match-ring-num">{normalizedScore}</span>
        <span className="match-ring-pct">%</span>
      </div>
    </div>
  );
}

export default function MovieRecommendations({
  watched,
  onAddToWatchlist,
  watchlist,
  recommendations,
  setRecommendations,
  tasteProfile,
  setTasteProfile
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [activeStep, setActiveStep] = useState(0);

  const [expandedRec, setExpandedRec] = useState(null);
  const [isAddingMovie, setIsAddingMovie] = useState(null);
  const [sortBy, setSortBy] = useState("match"); // "match" | "imdb" | "year"

  const loadingSteps = [
    `Reading your ${watched.length} rated films...`,
    "Extracting genre & director taste DNA...",
    "Scanning cinematic catalogue...",
    "Ranking precision match scores..."
  ];

  // Advance loading steps smoothly
  useEffect(() => {
    let timer;
    if (isLoading) {
      setActiveStep(0);
      timer = setInterval(() => {
        setActiveStep((prev) => (prev < loadingSteps.length - 1 ? prev + 1 : prev));
      }, 1800);
    } else {
      setActiveStep(0);
    }
    return () => clearInterval(timer);
  }, [isLoading, watched.length]);

  const handleGetRecommendations = async () => {
    if (watched.length < 3) {
      setError("Rate at least 3 movies to get personalized recommendations!");
      return;
    }

    setIsLoading(true);
    setError("");
    setRecommendations(null);
    setExpandedRec(null);

    try {
      const result = await getMovieRecommendations(watched, watchlist, setProgress);
      setTasteProfile(result.tasteProfile);
      setRecommendations(result.recommendations);
    } catch (err) {
      setError(err.message || "Failed to generate recommendations. Please try again.");
    } finally {
      setIsLoading(false);
      setProgress("");
    }
  };

  const handleToggleExplanation = (rec) => {
    if (expandedRec === rec.title) {
      setExpandedRec(null);
    } else {
      setExpandedRec(rec.title);
    }
  };

  const isAlreadyInWatchlist = (movieTitle) => {
    return watchlist?.some((m) => m.title.toLowerCase() === movieTitle.toLowerCase());
  };

  const handleAdd = async (rec) => {
    setIsAddingMovie(rec.title);

    try {
      let res = await fetch(
        `https://www.omdbapi.com/?apikey=${KEY}&t=${encodeURIComponent(rec.title)}&y=${rec.year}`
      );

      if (!res.ok || res.status === 401) {
        if (KEY !== "b78bdecd") {
          res = await fetch(
            `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(rec.title)}&y=${rec.year}`
          );
        }
      }

      let data = await res.json();

      if (
        data.Response === "False" &&
        data.Error &&
        (data.Error.includes("key") || data.Error.includes("credential")) &&
        KEY !== "b78bdecd"
      ) {
        const fallbackRes = await fetch(
          `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(rec.title)}&y=${rec.year}`
        );
        if (fallbackRes.ok) {
          data = await fallbackRes.json();
        }
      }

      if (data.Response === "True") {
        const newMovie = {
          imdbID: data.imdbID,
          title: data.Title,
          year: data.Year,
          poster: data.Poster !== "N/A" ? data.Poster : getFallbackPoster(rec.title),
          runtime: data.Runtime,
          imdbRating: data.imdbRating,
          userRating: 0
        };
        onAddToWatchlist(newMovie);
      } else {
        const newMovie = {
          imdbID: Math.random().toString(36).substr(2, 9),
          title: rec.title,
          year: rec.year,
          poster: getFallbackPoster(rec.title),
          runtime: "N/A",
          imdbRating: rec.imdbRating || "N/A",
          userRating: 0
        };
        onAddToWatchlist(newMovie);
      }
    } catch (err) {
      console.error("Failed to fetch movie data:", err);
      const newMovie = {
        imdbID: Math.random().toString(36).substr(2, 9),
        title: rec.title,
        year: rec.year,
        poster: getFallbackPoster(rec.title),
        runtime: "N/A",
        imdbRating: rec.imdbRating || "N/A",
        userRating: 0
      };
      onAddToWatchlist(newMovie);
    } finally {
      setIsAddingMovie(null);
    }
  };

  const sortedRecommendations = recommendations
    ? [...recommendations].sort((a, b) => {
        if (sortBy === "match") return (b.matchScore || 0) - (a.matchScore || 0);
        if (sortBy === "imdb") return (parseFloat(b.imdbRating) || 0) - (parseFloat(a.imdbRating) || 0);
        if (sortBy === "year") return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
        return 0;
      })
    : [];

  // Empty vault state
  if (watched.length === 0) {
    return (
      <div className="ai-empty-state">
        <div className="oracle-orb-wrapper large">
          <div className="oracle-orb-pulse"></div>
          <div className="oracle-orb">
            <Sparkles size={32} />
          </div>
        </div>
        <h3>No Rating History Yet</h3>
        <p>Start rating movies in CinemaVault to unlock personalized recommendations tailored to your taste.</p>
      </div>
    );
  }

  return (
    <div className="ai-recommendations">
      {/* ── Pre-run Empty State ── */}
      {!recommendations && !isLoading && (
        <div className="ai-trigger-section">
          <div className="ai-intro-card">
            <div className="oracle-orb-wrapper large">
              <div className="oracle-orb-pulse"></div>
              <div className="oracle-orb">
                <Sparkles size={36} />
              </div>
            </div>
            <div className="ai-intro-content">
              <h3>Discover Your Next Favorite Film</h3>
              <p>
                Analyzes your <strong>{watched.length}</strong> rated movies, cross-referencing theme, director style, and genre preference to find your highest-match picks.
              </p>

              <button
                className="btn-ai-generate"
                onClick={handleGetRecommendations}
                disabled={watched.length < 3}
              >
                <Sparkles size={18} />
                <span>Get AI Recommendations</span>
              </button>

              {watched.length < 3 && (
                <div className="ai-hint-badge">
                  <AlertCircle size={14} />
                  <span>Rate at least 3 movies to unlock recommendations</span>
                </div>
              )}
              {error && (
                <p className="ai-error">
                  <AlertCircle size={14} /> {error}
                </p>
              )}
            </div>
          </div>

          {/* 3 Mini Feature Explainer Cards */}
          <div className="ai-features-grid">
            <div className="ai-feature-card">
              <div className="feature-icon-wrapper">
                <Dna size={22} />
              </div>
              <div className="feature-text">
                <h4>Taste DNA Analysis</h4>
                <p>Deconstructs favorite genres, directors, decade bias, and rating patterns.</p>
              </div>
            </div>
            <div className="ai-feature-card">
              <div className="feature-icon-wrapper">
                <Target size={22} />
              </div>
              <div className="feature-text">
                <h4>Match Precision</h4>
                <p>Calculates a 0–100% match score using your top-rated anchors.</p>
              </div>
            </div>
            <div className="ai-feature-card">
              <div className="feature-icon-wrapper">
                <BrainCircuit size={22} />
              </div>
              <div className="feature-text">
                <h4>Deep Match Reasoning</h4>
                <p>Provides inline breakdowns explaining why each film fits your taste.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Loading Theater ── */}
      {isLoading && (
        <div className="ai-loading-theater">
          <div className="theater-header">
            <div className="oracle-orb-wrapper large">
              <div className="oracle-orb-pulse"></div>
              <div className="oracle-orb">
                <Loader2 size={32} className="spin-icon" />
              </div>
            </div>
            <h3>Oracle Engine Active</h3>
            <p className="theater-subtitle">{progress || "Synthesizing your cinematic taste profile..."}</p>
          </div>

          {/* Staged Progress Checklist */}
          <div className="theater-checklist">
            {loadingSteps.map((stepText, idx) => {
              const isDone = activeStep > idx;
              const isCurrent = activeStep === idx;
              return (
                <div key={idx} className={`theater-step ${isDone ? "done" : isCurrent ? "active" : ""}`}>
                  <div className="step-icon">
                    {isDone ? (
                      <CheckCircle2 size={18} className="check-done" />
                    ) : isCurrent ? (
                      <Loader2 size={18} className="spin-icon" />
                    ) : (
                      <div className="step-bullet"></div>
                    )}
                  </div>
                  <span className="step-text">{stepText}</span>
                </div>
              );
            })}
          </div>

          {/* Shimmer skeleton card placeholders */}
          <div className="skeleton-cards-container">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-card">
                <div className="skeleton-poster"></div>
                <div className="skeleton-details">
                  <div className="skeleton-line long"></div>
                  <div className="skeleton-line medium"></div>
                  <div className="skeleton-line short"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Results V2 State ── */}
      {recommendations && (
        <div className="ai-results">
          {tasteProfile && (
            <div className="taste-profile-card">
              <div className="taste-header">
                <Target size={20} className="taste-icon" />
                <h4>Your Taste Profile</h4>
              </div>

              <div className="taste-grid">
                <div className="taste-section">
                  <span className="taste-label">Top Genres</span>
                  <div className="taste-tags">
                    {tasteProfile.favoriteGenres?.map((genre, i) => (
                      <div key={i} className="taste-tag-bar">
                        <span className="taste-tag-name">{genre}</span>
                        <div className="taste-bar-outer">
                          <div
                            className="taste-bar-inner"
                            style={{ width: `${Math.max(40, 100 - i * 15)}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="taste-section">
                  <span className="taste-label">Preferred Era & Style</span>
                  <div className="taste-meta-badges">
                    {tasteProfile.preferredEra && (
                      <span className="taste-badge">
                        <Film size={14} /> {tasteProfile.preferredEra}
                      </span>
                    )}
                    {tasteProfile.ratingStyle && (
                      <span className="taste-badge">
                        <Star size={14} /> {tasteProfile.ratingStyle}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Toolbar with Sort Dropdown */}
          <div className="recs-toolbar">
            <div className="recs-count">
              <Sparkles size={18} className="icon-sparkle" />
              <h4>Perfect Picks For You</h4>
              <span className="recs-badge">{sortedRecommendations.length} Curated Films</span>
            </div>

            <div className="recs-sort-controls">
              <SlidersHorizontal size={14} className="sort-icon" />
              <span className="sort-label">Sort by:</span>
              <select
                className="recs-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="match">Match Score (%)</option>
                <option value="imdb">IMDb Rating</option>
                <option value="year">Release Year</option>
              </select>
            </div>
          </div>

          {/* Recommendation Cards List */}
          <ul className="recommendation-list">
            {sortedRecommendations.map((rec, index) => {
              const rankNum = index + 1;
              const inWatchlist = isAlreadyInWatchlist(rec.title);
              const isAdding = isAddingMovie === rec.title;
              const isExpanded = expandedRec === rec.title;

              return (
                <li key={index} className="recommendation-card">
                  {/* Rank Numeral (#1, #2, etc.) */}
                  <div className="rec-rank-num">#{rankNum}</div>

                  {/* Poster image */}
                  <div className="rec-poster-wrapper">
                    <PosterImage
                      src={rec.poster}
                      title={rec.title}
                      className="rec-poster-img"
                    />
                  </div>

                  <div className="rec-content">
                    <div className="rec-header">
                      <div className="rec-title-section">
                        <h5 className="rec-movie-title">{rec.title}</h5>
                        <span className="rec-meta">
                          {rec.year} • {rec.genre} {rec.type === "series" ? "• TV Series" : ""}
                        </span>
                      </div>

                      <div className="rec-ratings-group">
                        {rec.imdbRating && (
                          <div className="imdb-rating-badge" title="IMDb Rating">
                            <Star size={14} className="star-gold" />
                            <span className="imdb-val">
                              {parseFloat(rec.imdbRating).toFixed(1)}
                            </span>
                            <span className="imdb-lbl">IMDb</span>
                          </div>
                        )}

                        {/* Circular Match Score Ring */}
                        <MatchRing score={rec.matchScore} />
                      </div>
                    </div>

                    <p className="rec-reason">{rec.reason}</p>

                    <div className="rec-actions">
                      <button
                        className={`btn-explain ${isExpanded ? "active" : ""}`}
                        onClick={() => handleToggleExplanation(rec)}
                      >
                        <BrainCircuit size={15} />
                        <span>Why this match?</span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      <button
                        className={`btn-add-watchlist ${inWatchlist ? "added" : ""}`}
                        onClick={() => handleAdd(rec)}
                        disabled={inWatchlist || isAdding}
                      >
                        {isAdding ? (
                          <>
                            <Loader2 size={15} className="spin-icon" />
                            <span>Adding...</span>
                          </>
                        ) : inWatchlist ? (
                          <>
                            <Check size={15} />
                            <span>In Watchlist</span>
                          </>
                        ) : (
                          <>
                            <Plus size={15} />
                            <span>Plan to Watch</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Expandable Explanation Drawer */}
                    {isExpanded && (
                      <div className="rec-explanation-drawer">
                        <div className="drawer-content">
                          <p>
                            <strong>Rationale:</strong> {rec.reason}
                          </p>
                          <p className="rec-detail-text">
                            Aligned with your preference for{" "}
                            {rec.genre || tasteProfile?.favoriteGenres?.[0] || "quality films"}
                            {tasteProfile?.preferredEra ? ` and content from ${tasteProfile.preferredEra}` : ""}.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Refresh Action */}
          <div className="recs-footer">
            <button
              className="btn-refresh-recs"
              onClick={handleGetRecommendations}
              disabled={isLoading}
            >
              <RefreshCw size={16} className={isLoading ? "spin-icon" : ""} />
              <span>Get Fresh Recommendations</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
