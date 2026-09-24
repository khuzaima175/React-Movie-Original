import { useState, useEffect, useRef } from "react";
import {
  getMovieRecommendations,
  getFallbackPoster,
  generateProfileHash,
  generateFallbackId,
  getSmartCache,
  setSmartCache
} from "../services/geminiService";
import { bridgeTmdbToOmdb, extractTasteProfile, POPULAR_WATCH_PROVIDERS, AVAILABLE_REGIONS } from "../services/tmdbService";
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
  List,
  Play,
  Tv,
  Globe,
  RotateCcw
} from "lucide-react";

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
  let val = typeof score === "number" ? score : parseFloat(score);
  if (isNaN(val) || val <= 0) val = 88;
  // If model returned a decimal ratio (0.01 - 1.0)
  if (val <= 1.0) {
    if (val <= 0.1) val = val * 1000;
    else val = val * 100;
  } else if (val <= 5) {
    // If raw 1-5 integer was passed from legacy cache
    val = 88;
  }
  const normalizedScore = Math.min(99, Math.max(70, Math.round(val)));

  let tier = "emerald";
  if (normalizedScore < 88 && normalizedScore >= 78) {
    tier = "cyan";
  } else if (normalizedScore < 78) {
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
    userRegion,
    setUserRegion,
    userWatchProviders,
    setUserWatchProviders,
    toggleWatchProvider,
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
  const [showFilterDeck, setShowFilterDeck] = useState(false);
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "compact"

  const [tasteProfileData, setTasteProfileData] = useState(null);
  const activeRequestRef = useRef(0);

  useEffect(() => {
    let isSubscribed = true;
    async function loadTaste() {
      const data = await extractTasteProfile(watched, watchlist);
      if (isSubscribed) setTasteProfileData(data);
    }
    loadTaste();
    return () => { isSubscribed = false; };
  }, [watched, watchlist]);

  const currentHash = tasteProfileData
    ? generateProfileHash(tasteProfileData, tasteProfileData.watchlistGenreIds, selectedMood, userWatchProviders)
    : "";

  const isCacheValid = Boolean(
    aiRecommendationsHash &&
    aiRecommendationsHash === currentHash &&
    recommendations &&
    recommendations.length > 0
  );

  const loadingSteps = [
    watched.length >= 3 ? `Analyzing ${watched.length} rated films with mathematical weights...` : "Initializing cold-start vibe calibration...",
    "Querying TMDB 3-Bucket waterfall engine...",
    "Synthesizing taste DNA & time-decay affinities...",
    "Calibrating precision match scores..."
  ];

  // Advance loading steps smoothly
  useEffect(() => {
    let timer;
    if (isLoading) {
      setActiveStep(0);
      timer = setInterval(() => {
        setActiveStep((prev) => (prev < loadingSteps.length - 1 ? prev + 1 : prev));
      }, 1400);
    } else {
      setActiveStep(0);
    }
    return () => clearInterval(timer);
  }, [isLoading, watched.length]);

  // Real-time cache verification with Master ID collision filter on mount or hash change (guarded against in-flight requests)
  useEffect(() => {
    if (!recommendations && currentHash && !isLoading) {
      const cached = getSmartCache(currentHash, watched, watchlist);
      if (cached && cached.recommendations?.length >= 4) {
        setTasteProfile(cached.tasteProfile);
        setRecommendations(cached.recommendations);
        saveAiRecommendations(cached.recommendations, cached.tasteProfile, currentHash);
      }
    }
  }, [currentHash, isLoading]);

  const handleGetRecommendations = async () => {
    const requestId = ++activeRequestRef.current;
    setIsLoading(true);
    setRecommendations(null); // Clear out previous recommendations immediately to prevent ghost cards during loading
    setError("");
    setExpandedRec(null);
    setDismissingTitle(null);

    try {
      const result = await getMovieRecommendations(watched, watchlist, setProgress, {
        mood: selectedMood,
        userRegion,
        userProviders: userWatchProviders,
        feedbackLog: aiFeedbackLog
      });

      if (activeRequestRef.current !== requestId) return;

      const profile = await extractTasteProfile(watched, watchlist);
      const newHash = generateProfileHash(profile, profile.watchlistGenreIds, selectedMood, userWatchProviders);

      setTasteProfile(result.tasteProfile);
      setRecommendations(result.recommendations);
      saveAiRecommendations(result.recommendations, result.tasteProfile, newHash);
      setSmartCache(newHash, result);
      setShowFilterDeck(false);
    } catch (err) {
      if (activeRequestRef.current !== requestId) return;
      setError(err.message || "Failed to generate recommendations. Please try again.");
    } finally {
      if (activeRequestRef.current === requestId) {
        setIsLoading(false);
        setProgress("");
      }
    }
  };

  const handleResetSearch = () => {
    activeRequestRef.current++;
    setIsLoading(false);
    setProgress("");
    setError("");
    setRecommendations(null);
    setTasteProfile(null);
    saveAiRecommendations(null, null, "");
    setShowFilterDeck(false);
  };

  const handleToggleExplanation = (rec) => {
    if (expandedRec === rec.title) {
      setExpandedRec(null);
    } else {
      setExpandedRec(rec.title);
    }
  };

  // Master Composite Collision Set
  const currentIds = new Set([
    ...(watched || []).flatMap((m) => [
      m.imdbID ? String(m.imdbID).toLowerCase() : null,
      m.tmdbId ? String(m.tmdbId).toLowerCase() : null,
      m.id ? String(m.id).toLowerCase() : null,
      m.title ? `${m.title.toLowerCase().trim()}::${String(m.year || "").match(/\d{4}/)?.[0] || "0000"}` : null
    ]).filter(Boolean),
    ...(watchlist || []).flatMap((m) => [
      m.imdbID ? String(m.imdbID).toLowerCase() : null,
      m.tmdbId ? String(m.tmdbId).toLowerCase() : null,
      m.id ? String(m.id).toLowerCase() : null,
      m.title ? `${m.title.toLowerCase().trim()}::${String(m.year || "").match(/\d{4}/)?.[0] || "0000"}` : null
    ]).filter(Boolean)
  ]);

  const isAlreadyInWatchlist = (movieTitle, movieYear, imdbID, tmdbId) => {
    const cleanT = (movieTitle || "").toLowerCase().trim();
    const cleanY = String(movieYear || "").match(/\d{4}/)?.[0] || "0000";
    if (imdbID && currentIds.has(String(imdbID).toLowerCase())) return true;
    if (tmdbId && currentIds.has(String(tmdbId).toLowerCase())) return true;
    return currentIds.has(`${cleanT}::${cleanY}`);
  };

  const handleAdd = async (rec) => {
    setIsAddingMovie(rec.title);

    addAiFeedback({
      title: rec.title,
      year: rec.year,
      action: "added_watchlist"
    });

    try {
      const bridged = await bridgeTmdbToOmdb(rec, userRegion);
      if (bridged) {
        onAddToWatchlist(bridged);
      }
    } catch (err) {
      console.error("Failed to add movie via schema bridge:", err);
      const fallbackMovie = {
        imdbID: rec.imdbID || generateFallbackId(rec.title, rec.year),
        title: rec.title,
        year: rec.year || "N/A",
        poster: rec.poster || getFallbackPoster(rec.title),
        runtime: "N/A",
        genre: rec.genre || "Cinema",
        imdbRating: rec.imdbRating || "N/A",
        userRating: 0
      };
      onAddToWatchlist(fallbackMovie);
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
      const tmdbId = rec.tmdbId ? String(rec.tmdbId).toLowerCase() : null;
      const compKey = `${(rec.title || "").toLowerCase().trim()}::${String(rec.year || "").match(/\d{4}/)?.[0] || "0000"}`;
      
      const isWatched = (watched || []).some(m => {
        return (m.imdbID && m.imdbID.toLowerCase() === id) ||
               (m.tmdbId && String(m.tmdbId).toLowerCase() === tmdbId) ||
               (m.title && `${m.title.toLowerCase().trim()}::${String(m.year || "").match(/\d{4}/)?.[0] || "0000"}` === compKey);
      });

      return !isWatched;
    })
    .sort((a, b) => {
      if (sortBy === "match") return (b.matchScore || 0) - (a.matchScore || 0);
      if (sortBy === "imdb") return (parseFloat(b.imdbRating) || 0) - (parseFloat(a.imdbRating) || 0);
      if (sortBy === "year") return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
      return 0;
    });

  const activeMoodObj = MOOD_OPTIONS.find((m) => m.id === selectedMood) || MOOD_OPTIONS[0];

  const renderStudioDeck = (isDrawer = false) => (
    <div className={`ai-studio-deck ${isDrawer ? "drawer-mode" : ""}`} style={isDrawer ? { marginBottom: "2.4rem", border: "1px solid rgba(226, 177, 60, 0.35)", boxShadow: "0 12px 36px rgba(0, 0, 0, 0.45)" } : {}}>
      {isDrawer && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.6rem", paddingBottom: "1.2rem", borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <SlidersHorizontal size={16} className="text-accent" />
            <h3 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700, color: "#f4f4f2" }}>Refine Mood & Streaming Preferences</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowFilterDeck(false)}
            style={{ background: "transparent", border: "none", color: "#8a8a86", cursor: "pointer", padding: "0.4rem" }}
            aria-label="Close Filter Drawer"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Vibe Selection Strip */}
      <div className="vibe-selection-block">
        <div className="vibe-header-row">
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <Compass size={16} className="text-accent" aria-hidden="true" />
            <span className="vibe-label">1. Select Cinematic Mood</span>
          </div>
          <span className="vibe-active-hint">{activeMoodObj.label}: {activeMoodObj.desc}</span>
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

      {/* Watch Providers & Global Cinema Filter Strip */}
      <div className="vibe-selection-block" style={{ marginTop: "2rem" }}>
        <div className="vibe-header-row">
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <Tv size={16} className="text-accent" aria-hidden="true" />
            <span className="vibe-label">2. Streaming Access & Region</span>
            <span style={{ fontSize: "1.15rem", color: "#8a8a86", fontWeight: 500 }}>(Optional)</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "#1c1d20", border: "1px solid rgba(255, 255, 255, 0.12)", borderRadius: "0.8rem", padding: "0.4rem 1rem" }}>
              <Globe size={14} style={{ color: "#e2b13c" }} />
              <select
                value={userRegion}
                onChange={(e) => setUserRegion(e.target.value)}
                style={{
                  background: "transparent",
                  color: "#f4f4f2",
                  border: "none",
                  fontSize: "1.25rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  outline: "none"
                }}
                aria-label="Select Streaming Region"
              >
                {AVAILABLE_REGIONS.map((reg) => (
                  <option key={reg.code} value={reg.code} style={{ background: "#141416", color: "#f4f4f2" }}>
                    {reg.flag} {reg.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginTop: "0.4rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <p style={{ fontSize: "1.25rem", color: "#8a8a86", margin: 0 }}>
              {userWatchProviders.length === 0
                ? "✨ Recommending from the entire world cinema catalog across all platforms without restriction."
                : `🔒 Filtering recommendations to movies available on ${userWatchProviders.length} selected service${userWatchProviders.length > 1 ? "s" : ""}.`}
            </p>
            {userRegion === "GLOBAL" && userWatchProviders.length > 0 && (
              <span style={{ fontSize: "1.15rem", color: "#e2b13c", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                <span>💡 Worldwide catalog: Streaming verified against primary global catalog. Select a specific country above for local licensing.</span>
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <button
              type="button"
              onClick={() => setUserWatchProviders(POPULAR_WATCH_PROVIDERS.map(p => p.id))}
              style={{
                fontSize: "1.2rem",
                fontWeight: 600,
                color: "#8a8a86",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                padding: "0.2rem 0.4rem"
              }}
              className="hover:text-accent"
            >
              Select All
            </button>
            <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>•</span>
            <button
              type="button"
              onClick={() => setUserWatchProviders([])}
              style={{
                fontSize: "1.2rem",
                fontWeight: 600,
                color: "#8a8a86",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                padding: "0.2rem 0.4rem"
              }}
              className="hover:text-accent"
            >
              Reset (Unlimited Access)
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", marginTop: "1.2rem" }}>
          {/* All Platforms Universal Pill */}
          <button
            type="button"
            onClick={() => setUserWatchProviders([])}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.8rem",
              padding: "0.9rem 1.6rem",
              borderRadius: "0.9rem",
              fontSize: "1.3rem",
              fontWeight: 700,
              background: userWatchProviders.length === 0 ? "rgba(226, 177, 60, 0.18)" : "#1c1d20",
              color: userWatchProviders.length === 0 ? "#e2b13c" : "#b6b6b2",
              border: userWatchProviders.length === 0 ? "1px solid rgba(226, 177, 60, 0.5)" : "1px solid rgba(255, 255, 255, 0.08)",
              boxShadow: userWatchProviders.length === 0 ? "0 0 16px rgba(226, 177, 60, 0.2)" : "none",
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
          >
            <Globe size={15} />
            <span>All Platforms / Universal Access</span>
          </button>

          {POPULAR_WATCH_PROVIDERS.map((provider) => {
            const isSelected = userWatchProviders.includes(provider.id);
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => toggleWatchProvider(provider.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.7rem",
                  padding: "0.9rem 1.4rem",
                  borderRadius: "0.9rem",
                  fontSize: "1.3rem",
                  fontWeight: 600,
                  background: isSelected ? "rgba(226, 177, 60, 0.15)" : "#1c1d20",
                  color: isSelected ? "#e2b13c" : "#b6b6b2",
                  border: isSelected ? "1px solid rgba(226, 177, 60, 0.4)" : "1px solid rgba(255, 255, 255, 0.08)",
                  boxShadow: isSelected ? "0 0 12px rgba(226, 177, 60, 0.15)" : "none",
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
                className="hover:border-white/20 hover:bg-[#242528]"
              >
                <span style={{ fontSize: "1.4rem" }}>{provider.icon}</span>
                <span>{provider.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Launch CTA */}
      <div className="synthesis-action-bar" style={{ marginTop: "2.8rem", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "1.2rem" }}>
        {error && (
          <div className="ai-error-banner" style={{ width: "100%", maxWidth: "600px", marginBottom: "1rem" }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "1.2rem", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            className="btn-synthesize-cinema"
            onClick={handleGetRecommendations}
            disabled={isLoading}
            style={{
              minHeight: "5.4rem",
              padding: "1.5rem 4.4rem",
              fontSize: "1.55rem",
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              borderRadius: "1.2rem",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.2rem",
              boxShadow: "0 8px 32px -4px rgba(226, 177, 60, 0.45)"
            }}
          >
            <Sparkles size={20} className="btn-sparkle-icon" />
            <span>{isDrawer ? "Update Recommendations" : "Synthesize Recommendations"}</span>
          </button>

          {isDrawer && (
            <button
              type="button"
              onClick={handleResetSearch}
              style={{
                minHeight: "5.4rem",
                padding: "1.5rem 2.4rem",
                fontSize: "1.4rem",
                fontWeight: 600,
                borderRadius: "1.2rem",
                background: "transparent",
                color: "#8a8a86",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.8rem"
              }}
            >
              <RotateCcw size={15} />
              <span>Start Over</span>
            </button>
          )}
        </div>

        <span style={{ fontSize: "1.25rem", color: "#8a8a86", textAlign: "center" }}>
          TMDB 3-Bucket Waterfall Engine • Google Gemini Strict Re-Ranking • Zero Hallucinations
        </span>
      </div>
    </div>
  );

  return (
    <div className="ai-recommendations">
      {/* ── Pre-run Discovery Stage ── */}
      {!recommendations && !isLoading && (
        <div className="ai-discovery-stage">
          {renderStudioDeck(false)}
        </div>
      )}

      {/* ── Loading Theater ── */}
      {isLoading && (
        <div className="ai-loading-theater">
          <div className="theater-radar-box">
            <div className="radar-glow-ring" />
            <div className="radar-orbit-ring" />
            <Sparkles size={38} className="theater-main-spinner text-accent" />
          </div>

          <div className="theater-header">
            <h3 className="theater-title">Calibrating TMDB 3-Bucket Engine</h3>
            <div className="theater-status-badge">
              <Loader2 size={13} className="spin-icon" />
              <span>{progress || "Synthesizing recommendations..."}</span>
            </div>
          </div>

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
      {!isLoading && recommendations && recommendations.length > 0 && (
        <div className="ai-results-stage">
          {/* Collapsible/Expandable Studio Deck for Mood & Streaming Refinements */}
          {showFilterDeck && (
            <div className="ai-discovery-stage in-results" style={{ marginBottom: "2.4rem" }}>
              {renderStudioDeck(true)}
            </div>
          )}

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
                  <Check size={11} /> 500KB LRU Cache
                </span>
              ) : (
                <span className="cache-status-badge stale" title="Ratings or mood updated">
                  <AlertCircle size={11} /> Live 3-Bucket Re-ranked
                </span>
              )}
            </div>

            <div className="recs-actions-group">
              {/* Refine / Change Mood & Filters toggle */}
              <button
                type="button"
                className={`btn-refine-filters-toggle ${showFilterDeck ? "active" : ""}`}
                onClick={() => setShowFilterDeck(!showFilterDeck)}
                title="Change Cinematic Mood & Streaming Platforms"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.7rem",
                  padding: "0.6rem 1.2rem",
                  borderRadius: "0.8rem",
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  background: showFilterDeck ? "rgba(226, 177, 60, 0.18)" : "#1c1d20",
                  color: showFilterDeck ? "#e2b13c" : "#f4f4f2",
                  border: showFilterDeck ? "1px solid rgba(226, 177, 60, 0.45)" : "1px solid rgba(255, 255, 255, 0.1)",
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
              >
                <SlidersHorizontal size={13} className="text-accent" />
                <span>{showFilterDeck ? "Hide Filters" : "Change Mood / Filters"}</span>
                <span style={{
                  fontSize: "1.1rem",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "0.4rem",
                  background: "rgba(0, 0, 0, 0.35)",
                  color: "#e2b13c",
                  border: "1px solid rgba(226, 177, 60, 0.25)"
                }}>
                  {activeMoodObj.icon} {activeMoodObj.label}
                </span>
                {showFilterDeck ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
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
              const inWatchlist = isAlreadyInWatchlist(rec.title, rec.year, rec.imdbID, rec.tmdbId);
              const isAdding = isAddingMovie === rec.title;
              const isExpanded = expandedRec === rec.title;
              const isDismissing = dismissingTitle === rec.title;

              return (
                <li key={rec.id || index} className="recommendation-card">
                  {/* Rank Numeral */}
                  <div className="rec-rank-num">#{rankNum}</div>

                    {/* Poster Image with Direct YouTube Trailer Link */}
                    <div className="rec-poster-wrapper" style={{ position: "relative" }}>
                      <PosterImage
                        src={rec.poster}
                        title={rec.title}
                        className="rec-poster-img"
                      />
                      {(rec.trailerKey || rec.title) && (
                        <a
                          href={
                            rec.trailerKey
                              ? `https://www.youtube.com/watch?v=${rec.trailerKey}`
                              : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${rec.title} ${rec.year || ""} official trailer`)}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            position: "absolute",
                            bottom: "0.8rem",
                            right: "0.8rem",
                            width: "3.2rem",
                            height: "3.2rem",
                            borderRadius: "50%",
                            background: "rgba(0, 0, 0, 0.8)",
                            border: "1px solid rgba(226, 177, 60, 0.45)",
                            color: "#e2b13c",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            zIndex: 5
                          }}
                          className="hover:scale-110 hover:bg-[#e2b13c] hover:text-[#141416]"
                          title="Watch Official Trailer on YouTube"
                          aria-label={`Watch official trailer for ${rec.title} on YouTube (opens in new tab)`}
                        >
                          <Play size={13} fill="currentColor" />
                        </a>
                      )}
                    </div>

                  <div className="rec-content">
                    <div className="rec-header">
                      <div className="rec-title-section">
                        <h3 className="rec-movie-title">{rec.title}</h3>
                        <span className="rec-meta">
                          {rec.year} • {rec.genre}
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

                    {/* Streaming Provider Badges */}
                    {rec.streamProviders && rec.streamProviders.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.8rem" }}>
                        <span style={{ fontSize: "1.1rem", fontWeight: 600, color: "#8a8a86", textTransform: "uppercase", letterSpacing: "0.05em" }}>Stream on:</span>
                        {rec.streamProviders.slice(0, 3).map((p, pIdx) => (
                          <span
                            key={pIdx}
                            style={{
                              fontSize: "1.15rem",
                              fontWeight: 600,
                              color: "#f4f4f2",
                              background: "#1c1d20",
                              border: "1px solid rgba(255, 255, 255, 0.1)",
                              padding: "0.2rem 0.6rem",
                              borderRadius: "0.4rem"
                            }}
                          >
                            {p.name}
                          </span>
                        ))}
                      </div>
                    )}

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
                            Harvested via <strong>{rec.sourceBucket || "TMDB 3-Bucket Engine"}</strong> with strong stylistic overlap with your taste profile for{" "}
                            <strong>{rec.genre || tasteProfile?.favoriteGenres?.[0] || "cinematic storytelling"}</strong>.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Refresh Action Toolbar */}
          <div className="recs-footer" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1.2rem", flexWrap: "wrap", marginTop: "3rem" }}>
            <button
              type="button"
              className="btn-refresh-recs"
              onClick={handleGetRecommendations}
              disabled={isLoading}
            >
              <RefreshCw size={15} className={isLoading ? "spin-icon" : ""} />
              <span>Synthesize Fresh Picks</span>
            </button>

            <button
              type="button"
              className="btn-change-vibe"
              onClick={() => {
                setShowFilterDeck(true);
                window.scrollTo({ top: 120, behavior: "smooth" });
              }}
              disabled={isLoading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.8rem",
                padding: "1.2rem 2.2rem",
                borderRadius: "0.8rem",
                background: "#1c1d20",
                color: "#f4f4f2",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                fontSize: "1.35rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
            >
              <SlidersHorizontal size={14} className="text-accent" />
              <span>Change Mood & Filters</span>
            </button>

            <button
              type="button"
              className="btn-reset-search"
              onClick={handleResetSearch}
              disabled={isLoading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.8rem",
                padding: "1.2rem 2.2rem",
                borderRadius: "0.8rem",
                background: "transparent",
                color: "#8a8a86",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                fontSize: "1.35rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
            >
              <RotateCcw size={14} />
              <span>Start New Search</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
