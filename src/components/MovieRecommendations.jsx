import { useState, useEffect } from "react";
import { getMovieRecommendations, getFallbackPoster, generateInputHash, generateFallbackId } from "../services/geminiService";
import { useApp } from "../context/AppContext";
import PosterImage from "./PosterImage";
import {
  Sparkles,
  Target,
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
  ThumbsDown,
  X,
  Compass,
  Layers,
  LayoutGrid,
  List
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
  { id: "any", label: "Any Vibe", icon: "✨", desc: "Peak curated cinema" },
  { id: "mind-bending", label: "Mind-Bending", icon: "🧠", desc: "Plot twists & cerebral puzzles" },
  { id: "dark-thriller", label: "Dark Thriller", icon: "🌑", desc: "Gritty neo-noir & tension" },
  { id: "fun-popcorn", label: "Fun Popcorn", icon: "🍿", desc: "High-energy crowd pleasers" },
  { id: "comfort-watch", label: "Comfort Watch", icon: "🛋️", desc: "Heartwarming & rewatchable" },
  { id: "hidden-gem", label: "Hidden Gem", icon: "💎", desc: "Underrated masterworks" }
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
      <Sparkles size={12} className="match-pill-icon" />
      <span className="match-score-num">{normalizedScore}%</span>
      <span className="match-score-label">MATCH</span>
    </div>
  );
}

export default function MovieRecommendations({
  watched = [],
  onAddToWatchlist,
  watchlist = [],
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
  const [showDnaDetails, setShowDnaDetails] = useState(false);
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "compact"

  const currentHash = generateInputHash(watched, selectedMood);
  const isCacheValid = aiRecommendationsHash && aiRecommendationsHash === currentHash && recommendations && recommendations.length > 0;

  const loadingSteps = [
    `Analyzing ${watched.length} rated films...`,
    "Synthesizing taste DNA & director affinities...",
    "Querying deep cinema catalogue...",
    "Calibrating precision match scores..."
  ];

  // Advance loading steps smoothly
  useEffect(() => {
    let timer;
    if (isLoading) {
      setActiveStep(0);
      timer = setInterval(() => {
        setActiveStep((prev) => (prev < loadingSteps.length - 1 ? prev + 1 : prev));
      }, 1600);
    } else {
      setActiveStep(0);
    }
    return () => clearInterval(timer);
  }, [isLoading, watched.length]);

  const handleGetRecommendations = async () => {
    if (watched.length < 3) {
      setError("Rate at least 3 movies in your vault to unlock AI Oracle recommendations!");
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

  // Composite key sets to avoid title collisions
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
    addAiFeedback({
      title: rec.title,
      year: rec.year,
      action: "dismissed",
      reason: reason
    });

    const updated = (recommendations || []).filter((r) => r.title !== rec.title);
    setRecommendations(updated);
    saveAiRecommendations(updated, tasteProfile, aiRecommendationsHash);
    setDismissingTitle(null);
  };

  const sortedRecommendations = (recommendations || [])
    .filter((rec) => {
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

  // Top anchor titles with posters
  const topAnchors = [...(watched || [])]
    .filter((m) => (Number(m.userRating) || Number(m.imdbRating) || 0) >= 8)
    .sort((a, b) => (Number(b.userRating) || Number(b.imdbRating) || 0) - (Number(a.userRating) || Number(a.imdbRating) || 0))
    .slice(0, 8);

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
    .slice(0, 4)
    .map(([g]) => g);

  // Empty vault state
  if (watched.length === 0) {
    return (
      <div className="ai-empty-state">
        <div className="oracle-orb-wrapper large">
          <div className="oracle-orb-pulse" />
          <div className="oracle-orb">
            <Sparkles size={32} />
          </div>
        </div>
        <h3>No Rating History Found</h3>
        <p>Rate movies in your vault to unlock personalized cinematic intelligence.</p>
      </div>
    );
  }

  const activeMoodObj = MOOD_OPTIONS.find((m) => m.id === selectedMood) || MOOD_OPTIONS[0];

  return (
    <div className="ai-recommendations">
      {/* ── Pre-run Discovery Showcase ── */}
      {!recommendations && !isLoading && (
        <div className="ai-discovery-stage">
          {/* Main Interactive Studio Deck */}
          <div className="ai-studio-deck">
            {/* Vibe Selection Strip */}
            <div className="vibe-selection-block">
              <div className="vibe-header-row">
                <span className="vibe-label">
                  <Compass size={14} className="text-accent" aria-hidden="true" />
                  Select Cinematic Mood
                </span>
                <span className="vibe-active-hint">{activeMoodObj.desc}</span>
              </div>

              <div className="vibe-chips-grid">
                {MOOD_OPTIONS.map((mood) => {
                  const isSelected = selectedMood === mood.id;
                  return (
                    <button
                      key={mood.id}
                      type="button"
                      className={`vibe-chip-card ${isSelected ? "active" : ""}`}
                      onClick={() => setSelectedMood(mood.id)}
                    >
                      <span className="vibe-icon">{mood.icon}</span>
                      <div className="vibe-meta">
                        <strong className="vibe-title">{mood.label}</strong>
                        <span className="vibe-sub">{mood.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live Vault Taste Anchors Reel */}
            {topAnchors.length > 0 && (
              <div className="vault-taste-reel-block">
                <div className="taste-reel-header">
                  <div className="reel-title-group">
                    <span className="reel-label">Your Vault Anchor Signals</span>
                    <span className="reel-genres">
                      {topGenresList.join(" • ")}
                    </span>
                  </div>
                  <span className="reel-count-tag">{topAnchors.length} High-Rated Films</span>
                </div>

                <div className="taste-reel-filmstrip">
                  {topAnchors.map((m) => {
                    const score = m.userRating || m.imdbRating || "8+";
                    return (
                      <div key={m.imdbID || m.id || m.title} className="filmstrip-item" title={`${m.title || m.Title} (${m.year || ""})`}>
                        <div className="filmstrip-poster-box">
                          <PosterImage
                            src={m.poster || m.Poster}
                            title={m.title || m.Title}
                            className="filmstrip-poster-img"
                          />
                          <span className="filmstrip-score">★ {score}</span>
                        </div>
                        <span className="filmstrip-title">{m.title || m.Title}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Instant Cinema Synthesis Action */}
            <div className="synthesis-action-bar">
              <button
                type="button"
                className="btn-synthesize-cinema"
                onClick={handleGetRecommendations}
                disabled={watched.length < 3}
              >
                <Sparkles size={18} aria-hidden="true" />
                <span>Generate {activeMoodObj.label} Recommendations</span>
              </button>

              {watched.length < 3 && (
                <div className="ai-hint-badge">
                  <AlertCircle size={14} />
                  <span>Rate at least 3 films in your Vault to calibrate taste DNA</span>
                </div>
              )}

              {error && (
                <p className="ai-error-banner" role="alert">
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
              <div className="oracle-orb-pulse" />
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
                      <Check size={16} className="check-done" />
                    ) : isCurrent ? (
                      <Loader2 size={16} className="spin-icon text-accent" />
                    ) : (
                      <div className="step-bullet" />
                    )}
                  </div>
                  <span className="step-text">{stepText}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Results State ── */}
      {recommendations && (
        <div className="ai-results-stage">
          {/* Compact Taste Genome Bar */}
          {tasteProfile && (
            <div className="taste-genome-bar">
              <div className="genome-summary-row">
                <div className="genome-left">
                  <div className="genome-badge-pill">
                    <Target size={13} className="text-accent" />
                    <span>Synthesized Taste DNA</span>
                  </div>
                  <div className="genome-tags">
                    {tasteProfile.favoriteGenres?.slice(0, 3).map((genre, i) => (
                      <span key={i} className="genome-tag">{genre}</span>
                    ))}
                    {tasteProfile.preferredEra && (
                      <span className="genome-tag era">
                        <Film size={12} className="text-accent" /> {tasteProfile.preferredEra}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-genome-toggle"
                  onClick={() => setShowDnaDetails(!showDnaDetails)}
                  aria-expanded={showDnaDetails}
                >
                  <span>{showDnaDetails ? "Hide DNA Breakdown" : "View DNA Breakdown"}</span>
                  {showDnaDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {/* Collapsible Detailed Breakdown */}
              {showDnaDetails && (
                <div className="taste-grid-expanded">
                  <div className="taste-section">
                    <span className="taste-label">Top Genre Affinities</span>
                    <div className="taste-tags">
                      {tasteProfile.favoriteGenres?.map((genre, i) => (
                        <div key={i} className="taste-tag-bar">
                          <span className="taste-tag-name">{genre}</span>
                          <div className="taste-bar-outer">
                            <div
                              className="taste-bar-inner"
                              style={{ width: `${Math.max(35, 100 - i * 15)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="taste-section">
                    <span className="taste-label">Director & Narrative Aesthetic</span>
                    <div className="taste-aesthetic-box">
                      <p>{tasteProfile.ratingStyle || "High cinematic affinity with preference for strong pacing and visual identity."}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Results Toolbar */}
          <div className="recs-toolbar">
            <div className="recs-count-group">
              <Sparkles size={16} className="text-accent" />
              <h2 className="recs-title">Curated Picks</h2>
              <span className="recs-badge">{sortedRecommendations.length} Films</span>
              {isCacheValid ? (
                <span className="cache-status-badge cached" title="Instant cache from storage">
                  <Check size={11} /> Instant Cache
                </span>
              ) : (
                <span className="cache-status-badge stale" title="Ratings or mood updated">
                  <AlertCircle size={11} /> Live Re-ranked
                </span>
              )}
            </div>

            <div className="recs-actions-group">
              {/* View mode toggle */}
              <div className="view-mode-toggle" role="group" aria-label="View Mode">
                <button
                  type="button"
                  className={`btn-view-toggle ${viewMode === "grid" ? "active" : ""}`}
                  onClick={() => setViewMode("grid")}
                  title="Grid View"
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  type="button"
                  className={`btn-view-toggle ${viewMode === "compact" ? "active" : ""}`}
                  onClick={() => setViewMode("compact")}
                  title="Compact List View"
                >
                  <List size={15} />
                </button>
              </div>

              {/* Sort controls */}
              <div className="recs-sort-controls">
                <SlidersHorizontal size={13} className="sort-icon" />
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
          </div>

          {/* ── Cinema Recommendations Grid / List ── */}
          <ul className={`recommendation-container ${viewMode === "grid" ? "recommendation-grid-2col" : "recommendation-list"}`}>
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

                  {/* Poster Image */}
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
                            <Star size={12} className="star-gold" />
                            <span className="imdb-val">
                              {parseFloat(rec.imdbRating).toFixed(1)}
                            </span>
                            <span className="imdb-lbl">IMDb</span>
                          </div>
                        )}
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

                    {/* Action Bar */}
                    <div className="rec-actions">
                      <button
                        type="button"
                        className={`btn-add-watchlist ${inWatchlist ? "added" : ""}`}
                        onClick={() => handleAdd(rec)}
                        disabled={inWatchlist || isAdding}
                      >
                        {isAdding ? (
                          <>
                            <Loader2 size={14} className="spin-icon" />
                            <span>Saving...</span>
                          </>
                        ) : inWatchlist ? (
                          <>
                            <Check size={14} />
                            <span>In Watchlist</span>
                          </>
                        ) : (
                          <>
                            <Plus size={14} />
                            <span>Plan to Watch</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        className={`btn-explain ${isExpanded ? "active" : ""}`}
                        onClick={() => handleToggleExplanation(rec)}
                      >
                        <Sparkles size={13} className="btn-explain-icon" />
                        <span>{isExpanded ? "Hide Match" : "Match Breakdown"}</span>
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>

                      <button
                        type="button"
                        className="btn-dismiss-rec"
                        onClick={() => setDismissingTitle(isDismissing ? null : rec.title)}
                        title="Dismiss recommendation"
                        aria-label="Dismiss recommendation"
                      >
                        <ThumbsDown size={13} />
                        <span>Not for me</span>
                      </button>
                    </div>

                    {/* Dismiss Popover */}
                    {isDismissing && (
                      <div className="dismiss-reasons-popover">
                        <div className="popover-header">
                          <span>Why isn't this a match?</span>
                          <button
                            type="button"
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
                              type="button"
                              className="reason-chip"
                              onClick={() => handleDismiss(rec, reason)}
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Match Breakdown Drawer */}
                    {isExpanded && (
                      <div className="rec-explanation-drawer">
                        <div className="drawer-content">
                          <p>
                            <strong>Thematic Connection:</strong> {rec.reason}
                          </p>
                          <p className="rec-detail-text">
                            Selected because of its strong stylistic overlap with your affinity for{" "}
                            <strong>{rec.genre || tasteProfile?.favoriteGenres?.[0] || "cinematic storytelling"}</strong>
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
              type="button"
              className="btn-refresh-recs"
              onClick={handleGetRecommendations}
              disabled={isLoading}
            >
              <RefreshCw size={15} className={isLoading ? "spin-icon" : ""} />
              <span>Synthesize Fresh Picks</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

