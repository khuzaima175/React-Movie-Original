import { useState, useEffect } from "react";
import { getMovieRecommendations, getFallbackPoster, generateInputHash, generateFallbackId } from "../services/geminiService";
import { useApp } from "../context/AppContext";
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
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  X,
  Compass
} from "lucide-react";

const getOmdbKey = () => {
  const key = import.meta.env.VITE_OMDB_KEY;
  if (!key || key === "undefined" || key === "null" || key.trim() === "") {
    return "b78bdecd";
  }
  return key.trim();
};
const KEY = getOmdbKey();

const MOOD_OPTIONS = [
  { id: "any", label: "✨ Any Vibe" },
  { id: "mind-bending", label: "🧠 Mind-Bending" },
  { id: "dark-thriller", label: "🔥 Dark Thriller" },
  { id: "fun-popcorn", label: "🍿 Fun Popcorn" },
  { id: "comfort-watch", label: "🛋️ Comfort Watch" },
  { id: "hidden-gem", label: "💎 Hidden Gem" }
];

const DISMISS_REASONS = [
  "Already seen",
  "Too slow",
  "Not my genre",
  "Predictable"
];

function TasteMatchBadge({ score }) {
  const normalizedScore = Math.min(100, Math.max(0, Math.round(score || 0)));

  let tier = "emerald";
  if (normalizedScore < 85 && normalizedScore >= 75) {
    tier = "cyan";
  } else if (normalizedScore < 75) {
    tier = "indigo";
  }

  return (
    <div className={`taste-match-pill tier-${tier}`} title={`${normalizedScore}% Taste Match`}>
      <Sparkles size={13} className="match-pill-icon" />
      <span className="match-score-num">{normalizedScore}%</span>
      <span className="match-score-label">MATCH</span>
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
  const {
    aiRecommendationsHash,
    aiFeedbackLog,
    saveAiRecommendations,
    addAiFeedback
  } = useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [activeStep, setActiveStep] = useState(0);

  const [expandedRec, setExpandedRec] = useState(null);
  const [isAddingMovie, setIsAddingMovie] = useState(null);
  const [sortBy, setSortBy] = useState("match"); // "match" | "imdb" | "year"
  const [selectedMood, setSelectedMood] = useState("any");
  const [dismissingTitle, setDismissingTitle] = useState(null);

  const currentHash = generateInputHash(watched, selectedMood);
  const isCacheValid = aiRecommendationsHash && aiRecommendationsHash === currentHash && recommendations && recommendations.length > 0;

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
    setDismissingTitle(null);

    try {
      const result = await getMovieRecommendations(watched, watchlist, setProgress, {
        mood: selectedMood,
        feedbackLog: aiFeedbackLog
      });
      const newHash = generateInputHash(watched, selectedMood);
      setTasteProfile(result.tasteProfile);
      setRecommendations(result.recommendations);
      saveAiRecommendations(result.recommendations, result.tasteProfile, newHash);
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

  // Composite key sets to avoid title collisions (e.g. A Star is Born / The Thing remakes)
  const watchedKeySet = new Set(
    (watched || []).flatMap((m) => [
      m.imdbID?.toLowerCase(),
      m.title ? `${m.title.toLowerCase().trim()}::${String(m.year || "").match(/\d{4}/)?.[0] || "0000"}` : null
    ]).filter(Boolean)
  );

  const watchlistKeySet = new Set(
    (watchlist || []).flatMap((m) => [
      m.imdbID?.toLowerCase(),
      m.title ? `${m.title.toLowerCase().trim()}::${String(m.year || "").match(/\d{4}/)?.[0] || "0000"}` : null
    ]).filter(Boolean)
  );

  const isAlreadyInWatchlist = (movieTitle, movieYear, imdbID) => {
    const cleanT = (movieTitle || "").toLowerCase().trim();
    const cleanY = String(movieYear || "").match(/\d{4}/)?.[0] || "0000";
    if (imdbID && watchlistKeySet.has(imdbID.toLowerCase())) return true;
    return watchlistKeySet.has(`${cleanT}::${cleanY}`);
  };

  const handleAdd = async (rec) => {
    setIsAddingMovie(rec.title);

    // Record positive feedback
    addAiFeedback({
      title: rec.title,
      year: rec.year,
      action: "added_watchlist"
    });

    try {
      let res = await fetch(
        `https://www.omdbapi.com/?apikey=${KEY}&t=${encodeURIComponent(rec.title)}&y=${rec.year}`,
        { cache: "no-store" }
      );

      if (!res.ok || res.status === 401) {
        if (KEY !== "b78bdecd") {
          res = await fetch(
            `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(rec.title)}&y=${rec.year}`,
            { cache: "no-store" }
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
          `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(rec.title)}&y=${rec.year}`,
          { cache: "no-store" }
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
          imdbID: generateFallbackId(rec.title, rec.year),
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
        imdbID: generateFallbackId(rec.title, rec.year),
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

  const handleDismiss = (rec, reason) => {
    // Record negative feedback
    addAiFeedback({
      title: rec.title,
      year: rec.year,
      action: "dismissed",
      reason: reason
    });

    // Remove from current displayed recommendations and persist to storage
    const updated = (recommendations || []).filter((r) => r.title !== rec.title);
    setRecommendations(updated);
    saveAiRecommendations(updated, tasteProfile, aiRecommendationsHash);
    setDismissingTitle(null);
  };

  const sortedRecommendations = (recommendations || [])
    .filter((rec) => {
      // Exclude titles that the user watched in this session
      const id = rec.imdbID?.toLowerCase();
      const compKey = `${(rec.title || "").toLowerCase().trim()}::${String(rec.year || "").match(/\d{4}/)?.[0] || "0000"}`;
      if (id && watchedKeySet.has(id)) return false;
      if (watchedKeySet.has(compKey)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "match") return (b.matchScore || 0) - (a.matchScore || 0);
      if (sortBy === "imdb") return (parseFloat(b.imdbRating) || 0) - (parseFloat(a.imdbRating) || 0);
      if (sortBy === "year") return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
      return 0;
    });

  // Compute real taste DNA preview for pre-run state
  const topAnchors = [...(watched || [])]
    .filter((m) => (Number(m.userRating) || Number(m.imdbRating) || 0) >= 8.5)
    .sort((a, b) => (Number(b.userRating) || Number(b.imdbRating) || 0) - (Number(a.userRating) || Number(a.imdbRating) || 0))
    .slice(0, 4);

  const genreHits = {};
  (watched || []).forEach((m) => {
    if (m.genre) {
      m.genre.split(",").forEach((g) => {
        const name = g.trim();
        genreHits[name] = (genreHits[name] || 0) + 1;
      });
    }
  });
  const topGenresList = Object.entries(genreHits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

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
      {/* ── Pre-run Discovery & Taste Showcase State ── */}
      {!recommendations && !isLoading && (
        <div className="ai-discovery-stage">
          {/* Cinema Taste Intelligence Showcase Card */}
          <div className="ai-taste-showcase-card">
            <div className="showcase-top">
              <div className="showcase-header-left">
                <div className="showcase-badge">
                  <Sparkles size={13} className="text-accent" aria-hidden="true" />
                  <span>Cinematic Intelligence Engine</span>
                </div>
                <h2 className="showcase-title">Synthesize Your Next Cinema Obsession</h2>
                <p className="showcase-subtitle">
                  Autonomous film synthesis trained on your <strong>{watched.length} rated titles</strong>. Cross-references narrative themes, director styles, and IMDb verified metadata.
                </p>
              </div>
            </div>

            {/* Live Taste DNA Signals derived from real vault */}
            <div className="showcase-dna-strip">
              {topAnchors.length > 0 && (
                <div className="showcase-dna-col">
                  <span className="dna-strip-label">Primary Anchors</span>
                  <div className="dna-anchors-pills">
                    {topAnchors.map((m) => (
                      <span key={m.imdbID || m.id || m.title} className="dna-anchor-pill">
                        <Star size={11} className="text-accent fill-current" />
                        <strong>{m.title || m.Title}</strong>
                        <span className="anchor-score">★ {m.userRating || m.imdbRating}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {topGenresList.length > 0 && (
                <div className="showcase-dna-col">
                  <span className="dna-strip-label">Dominant Taste DNA</span>
                  <div className="dna-anchors-pills">
                    {topGenresList.map((genre) => (
                      <span key={genre} className="dna-genre-pill">
                        {genre}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Vibe & Mood Selector embedded seamlessly */}
            <div className="showcase-mood-section">
              <span className="mood-section-label">
                <Compass size={14} className="text-accent" />
                Select Desired Vibe or Direction:
              </span>
              <div className="showcase-mood-chips">
                {MOOD_OPTIONS.map((mood) => (
                  <button
                    key={mood.id}
                    className={`showcase-mood-pill ${selectedMood === mood.id ? "active" : ""}`}
                    onClick={() => setSelectedMood(mood.id)}
                  >
                    {mood.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Big Shimmering Action Button */}
            <div className="showcase-action-row">
              <button
                className="btn-synthesize-cinema"
                onClick={handleGetRecommendations}
                disabled={watched.length < 3}
              >
                <Sparkles size={18} aria-hidden="true" />
                <span>Synthesize 6 Curated Recommendations</span>
              </button>

              {watched.length < 3 && (
                <div className="ai-hint-badge">
                  <AlertCircle size={14} />
                  <span>Rate at least 3 movies in your Vault to unlock synthesis</span>
                </div>
              )}

              {error && (
                <p className="ai-error-banner">
                  <AlertCircle size={15} /> {error}
                </p>
              )}
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
                <Loader2 size={32} className="spin-icon text-accent" />
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

      {/* ── Results State ── */}
      {recommendations && (
        <div className="ai-results-stage">
          {tasteProfile && (
            <div className="taste-profile-card">
              <div className="taste-header">
                <Target size={18} className="taste-icon" />
                <h4>Synthesized Taste DNA Profile</h4>
              </div>

              <div className="taste-grid">
                <div className="taste-section">
                  <span className="taste-label">Top Genre Affinities</span>
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
                  <span className="taste-label">Detected Era & Aesthetic</span>
                  <div className="taste-meta-badges">
                    {tasteProfile.preferredEra && (
                      <span className="taste-badge">
                        <Film size={14} className="text-accent" /> {tasteProfile.preferredEra}
                      </span>
                    )}
                    {tasteProfile.ratingStyle && (
                      <span className="taste-badge">
                        <Star size={14} className="text-accent" /> {tasteProfile.ratingStyle}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Toolbar with Sort Dropdown, Mood Changer & Cache Badge */}
          <div className="recs-toolbar">
            <div className="recs-count">
              <Sparkles size={18} className="icon-sparkle" />
              <h4>Curated Recommendations</h4>
              <span className="recs-badge">{sortedRecommendations.length} Films</span>
              {isCacheValid ? (
                <span className="cache-status-badge cached" title="Instant cache from storage">
                  <CheckCircle2 size={12} /> Instant Cache
                </span>
              ) : (
                <span className="cache-status-badge stale" title="Ratings or mood updated">
                  <AlertCircle size={12} /> Live Re-ranked
                </span>
              )}
            </div>

            <div className="recs-sort-controls">
              <SlidersHorizontal size={14} className="sort-icon" />
              <span className="sort-label">Sort:</span>
              <select
                className="recs-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort recommendations"
              >
                <option value="match">Match Score (%)</option>
                <option value="imdb">IMDb Score</option>
                <option value="year">Release Year</option>
              </select>
            </div>
          </div>

          {/* Recommendation Cards List */}
          <ul className="recommendation-list">
            {sortedRecommendations.map((rec, index) => {
              const rankNum = index + 1;
              const inWatchlist = isAlreadyInWatchlist(rec.title, rec.year, rec.imdbID);
              const isAdding = isAddingMovie === rec.title;
              const isExpanded = expandedRec === rec.title;
              const isDismissing = dismissingTitle === rec.title;

              return (
                <li key={index} className="recommendation-card">
                  {/* Rank Numeral */}
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
                        <h3 className="rec-movie-title">{rec.title}</h3>
                        <span className="rec-meta">
                          {rec.year} • {rec.genre} {rec.type === "series" ? "• TV Series" : ""}
                        </span>
                      </div>

                      <div className="rec-ratings-group">
                        {rec.imdbRating && (
                          <div className="imdb-rating-badge" title="Verified IMDb Rating">
                            <Star size={13} className="star-gold" />
                            <span className="imdb-val">
                              {parseFloat(rec.imdbRating).toFixed(1)}
                            </span>
                            <span className="imdb-lbl">IMDb</span>
                          </div>
                        )}

                        {/* Taste Match Score Badge */}
                        <TasteMatchBadge score={rec.matchScore} />
                      </div>
                    </div>

                    {/* Styled Critique Box */}
                    <div className="rec-reason-box">
                      <p className="rec-reason">
                        <span className="reason-quote-mark">“</span>
                        {rec.reason}
                        <span className="reason-quote-mark">”</span>
                      </p>
                    </div>

                    <div className="rec-actions">
                      <button
                        className={`btn-add-watchlist ${inWatchlist ? "added" : ""}`}
                        onClick={() => handleAdd(rec)}
                        disabled={inWatchlist || isAdding}
                      >
                        {isAdding ? (
                          <>
                            <Loader2 size={15} className="spin-icon" />
                            <span>Saving...</span>
                          </>
                        ) : inWatchlist ? (
                          <>
                            <Check size={15} />
                            <span>In Plan to Watch</span>
                          </>
                        ) : (
                          <>
                            <Plus size={15} />
                            <span>Plan to Watch</span>
                          </>
                        )}
                      </button>

                      <button
                        className={`btn-explain ${isExpanded ? "active" : ""}`}
                        onClick={() => handleToggleExplanation(rec)}
                      >
                        <Sparkles size={14} className="btn-explain-icon" />
                        <span>{isExpanded ? "Hide Breakdown" : "Match Breakdown"}</span>
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>

                      <button
                        className="btn-dismiss-rec"
                        onClick={() => setDismissingTitle(isDismissing ? null : rec.title)}
                        title="Dismiss recommendation"
                      >
                        <ThumbsDown size={14} />
                        <span>Not for me</span>
                      </button>
                    </div>

                    {/* Popover Reason Chips for Dismissal */}
                    {isDismissing && (
                      <div className="dismiss-reasons-popover">
                        <div className="popover-header">
                          <span>Why isn't this a match?</span>
                          <button
                            className="btn-close-popover"
                            onClick={() => setDismissingTitle(null)}
                            aria-label="Close"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <div className="reason-chips">
                          {DISMISS_REASONS.map((reason) => (
                            <button
                              key={reason}
                              className="reason-chip"
                              onClick={() => handleDismiss(rec, reason)}
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Expandable Explanation Drawer */}
                    {isExpanded && (
                      <div className="rec-explanation-drawer">
                        <div className="drawer-content">
                          <p>
                            <strong>Thematic Connection:</strong> {rec.reason}
                          </p>
                          <p className="rec-detail-text">
                            Selected because of its strong stylistic overlap with your affinity for{" "}
                            <strong>{rec.genre || tasteProfile?.favoriteGenres?.[0] || "cinematic gems"}</strong>
                            {tasteProfile?.preferredEra ? ` and filmmaking from ${tasteProfile.preferredEra}` : ""}.
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
              <span>Synthesize Fresh Picks</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
