import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  getMovieRecommendations,
  getFallbackPoster,
  generateProfileHash,
  generateFallbackId,
  getSmartCache,
  setSmartCache,
  CURATION_MODEL_CASCADE,
  formatModelDisplayName,
  getLastModelInfo,
  getPreferredCascadeModel,
  resolveResultModelInfo,
  normalizeMatchScore,
  createGeminiClient,
  parseFreeTextMoodWithGemini
} from "../services/geminiService";
import { resolveGeminiKey } from "../services/apiTransport";
import {
  bridgeTmdbToOmdb,
  extractTasteProfile,
  POPULAR_WATCH_PROVIDERS,
  AVAILABLE_REGIONS
} from "../services/tmdbService";
import {
  formatStreamingSummary,
  formatRecBadgeSummary,
  resolveRecommendationAnchors,
  sanitizeOracleReason
} from "../services/oracleViewHelpers";
import { useApp } from "../context/AppContext";
import PosterImage from "./PosterImage";
import { Button, MetaLine } from "./ui";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Plus,
  Check,
  ChevronDown,
  ChevronUp,
  Star,
  SlidersHorizontal,
  AlertCircle,
  X,
  Play,
  Globe,
  RotateCcw,
  Info
} from "lucide-react";

const MOOD_OPTIONS = [
  { id: "any", label: "Any Vibe", desc: "Peak curated cinema" },
  { id: "mind-bending", label: "Mind-Bending", desc: "Plot twists & cerebral puzzles" },
  { id: "dark-thriller", label: "Dark Thriller", desc: "Gritty neo-noir & tension" },
  { id: "fun-popcorn", label: "Fun Popcorn", desc: "High-energy crowd pleasers" },
  { id: "comfort-watch", label: "Comfort Watch", desc: "Heartwarming & rewatchable" },
  { id: "hidden-gem", label: "Hidden Gem", desc: "Underrated masterworks" }
];

const DISMISS_REASONS = [
  "Already seen",
  "Too slow",
  "Not my genre",
  "Predictable"
];

export default function MovieRecommendations({
  watched = [],
  onAddToWatchlist,
  watchlist = [],
  recommendations,
  setRecommendations,
  tasteProfile,
  setTasteProfile,
  onOpenTasteDeck
}) {
  const navigate = useNavigate();
  const {
    userRegion,
    setUserRegion,
    userWatchProviders,
    setUserWatchProviders,
    toggleWatchProvider,
    aiRecommendationsHash,
    aiModelInfo,
    aiFeedbackLog,
    saveAiRecommendations,
    addAiFeedback
  } = useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [activeStep, setActiveStep] = useState(0);

  const [isAddingMovie, setIsAddingMovie] = useState(null);
  const [sortBy, setSortBy] = useState("match");
  const [selectedMood, setSelectedMood] = useState("any");
  const [dismissingTitle, setDismissingTitle] = useState(null);
  const [showDnaDetails, setShowDnaDetails] = useState(false);
  const [showFilterDeck, setShowFilterDeck] = useState(false);
  const [showAboutPicks, setShowAboutPicks] = useState(false);
  const [customMoodQuery, setCustomMoodQuery] = useState("");
  const [isParsingMood, setIsParsingMood] = useState(false);
  const [moodParseNote, setMoodParseNote] = useState("");
  const [isStreamingOpen, setIsStreamingOpen] = useState(false);

  const [tasteProfileData, setTasteProfileData] = useState(null);
  const activeRequestRef = useRef(0);

  useEffect(() => {
    let isSubscribed = true;
    async function loadTaste() {
      const data = await extractTasteProfile(watched, watchlist);
      if (isSubscribed) setTasteProfileData(data);
    }
    loadTaste();
    return () => {
      isSubscribed = false;
    };
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

  const queuedModel = getPreferredCascadeModel(CURATION_MODEL_CASCADE, "curation");
  const displayedModelInfo = aiModelInfo || getLastModelInfo("curation");
  const { summaryText: streamingSummary, hasCustomFilter: hasStreamingFilter } = formatStreamingSummary(
    userRegion,
    userWatchProviders,
    AVAILABLE_REGIONS,
    POPULAR_WATCH_PROVIDERS
  );

  const loadingSteps = [
    watched.length >= 3
      ? `Analyzing ${watched.length} rated films with time-weighted affinities...`
      : "Preparing initial taste calibration...",
    "Querying TMDB discovery candidates...",
    "Ranking films against your vault history...",
    `Curating final picks via ${queuedModel ? formatModelDisplayName(queuedModel) : "Local Ranker"}...`
  ];

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

  useEffect(() => {
    if (!recommendations && currentHash && !isLoading) {
      const cached = getSmartCache(currentHash, watched, watchlist);
      if (cached && cached.recommendations?.length >= 4) {
        const cachedModelInfo = cached.modelInfo
          ? { ...cached.modelInfo, fromCache: true }
          : null;
        setTasteProfile(cached.tasteProfile);
        setRecommendations(cached.recommendations);
        saveAiRecommendations(cached.recommendations, cached.tasteProfile, currentHash, cachedModelInfo);
      }
    }
  }, [currentHash, isLoading]);

  const handleGetRecommendations = async () => {
    const requestId = ++activeRequestRef.current;
    setIsLoading(true);
    setRecommendations(null);
    setError("");
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
      const liveModelInfo = {
        ...resolveResultModelInfo(result, "curation"),
        fromCache: false
      };
      const cacheableResult = {
        ...result,
        modelInfo: liveModelInfo
      };

      setTasteProfile(result.tasteProfile);
      setRecommendations(result.recommendations);
      saveAiRecommendations(result.recommendations, result.tasteProfile, newHash, liveModelInfo);
      setSmartCache(newHash, cacheableResult);
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

  const handleApplyFreeTextMood = async () => {
    const query = customMoodQuery.trim();
    if (!query || isParsingMood) return;
    setIsParsingMood(true);
    setMoodParseNote("");
    try {
      const aiClient = createGeminiClient(resolveGeminiKey());
      if (!aiClient) {
        setMoodParseNote("Offline parser unavailable; using selected mood.");
        return;
      }
      const parsed = await parseFreeTextMoodWithGemini(aiClient, query);
      const matched = MOOD_OPTIONS.find((m) => m.id === parsed?.moodId);
      if (matched) {
        setSelectedMood(matched.id);
        setMoodParseNote(`Selected: ${matched.label}`);
      } else {
        setMoodParseNote("Kept your current mood selection.");
      }
    } catch {
      setMoodParseNote("Could not match custom mood; using preset selection.");
    } finally {
      setIsParsingMood(false);
    }
  };

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
      tmdbId: rec.tmdbId ?? rec.id ?? null,
      imdbID: rec.imdbID ?? null,
      matchScoreAtTime: rec.matchScore ?? null,
      sourceBucket: rec.sourceBucket ?? null,
      features: rec.features ?? null,
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
      tmdbId: rec.tmdbId ?? rec.id ?? null,
      imdbID: rec.imdbID ?? null,
      matchScoreAtTime: rec.matchScore ?? null,
      sourceBucket: rec.sourceBucket ?? null,
      features: rec.features ?? null,
      action: "dismissed",
      reason
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

      const isWatched = (watched || []).some((m) =>
        (m.imdbID && m.imdbID.toLowerCase() === id) ||
        (m.tmdbId && String(m.tmdbId).toLowerCase() === tmdbId) ||
        (m.title && `${m.title.toLowerCase().trim()}::${String(m.year || "").match(/\d{4}/)?.[0] || "0000"}` === compKey)
      );

      return !isWatched;
    })
    .sort((a, b) => {
      if (sortBy === "match") return (b.matchScore || 0) - (a.matchScore || 0);
      if (sortBy === "imdb") return (parseFloat(b.imdbRating) || 0) - (parseFloat(a.imdbRating) || 0);
      if (sortBy === "year") return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
      return 0;
    });

  // Only show numeric match scores when they carry information (spread >= 4 pts and > 1 distinct value)
  const scoreValues = sortedRecommendations.map((r) => normalizeMatchScore(r.matchScore));
  const hasMeaningfulScoreSpread =
    scoreValues.length > 1 &&
    new Set(scoreValues).size > 1 &&
    Math.max(...scoreValues) - Math.min(...scoreValues) >= 4;

  const activeMoodObj = MOOD_OPTIONS.find((m) => m.id === selectedMood) || MOOD_OPTIONS[0];

  const effectiveModelInfo =
    displayedModelInfo &&
    isCacheValid &&
    !getLastModelInfo("curation") &&
    !displayedModelInfo.fromCache
      ? { ...displayedModelInfo, fromCache: true }
      : displayedModelInfo;
  const badgeSummary = formatRecBadgeSummary(effectiveModelInfo, isCacheValid, queuedModel);

  const renderStudioDeck = (isDrawer = false) => (
    <div className={`ai-studio-deck ${isDrawer ? "drawer-mode" : ""}`}>
      {isDrawer && (
        <div className="deck-drawer-header">
          <h3 className="deck-drawer-title">Mood &amp; Streaming</h3>
          <button
            type="button"
            className="deck-close-btn"
            onClick={() => setShowFilterDeck(false)}
            aria-label="Close Mood & Streaming Filters"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="vibe-selection-block">
        <span className="vibe-label">Mood</span>
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
                <div className="vibe-meta">
                  <strong className="vibe-title">{mood.label}</strong>
                  <span className="vibe-sub">{mood.desc}</span>
                </div>
              </button>
            );
          })}
        </div>

        <form
          className="mood-query-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleApplyFreeTextMood();
          }}
        >
          <input
            type="text"
            className="mood-query-input"
            value={customMoodQuery}
            onChange={(e) => setCustomMoodQuery(e.target.value)}
            placeholder='Describe a vibe (e.g., "like Drive but quieter")'
            aria-label="Custom Mood Query"
          />
          <Button
            type="submit"
            variant="secondary"
            size="md"
            disabled={isParsingMood || !customMoodQuery.trim()}
          >
            {isParsingMood ? "Matching..." : "Match Vibe"}
          </Button>
          {moodParseNote && <span className="mood-parse-note">{moodParseNote}</span>}
        </form>
      </div>

      <div className="vibe-selection-block">
        <div className={`streaming-summary-bar ${hasStreamingFilter ? "is-custom" : ""}`}>
          <div className="streaming-summary-info">
            <span className="vibe-label">Where to watch</span>
            <span aria-hidden="true">·</span>
            <span className="streaming-summary-value">{streamingSummary}</span>
          </div>

          <button
            type="button"
            className="streaming-summary-toggle"
            onClick={() => setIsStreamingOpen((prev) => !prev)}
            aria-expanded={isStreamingOpen}
          >
            <span>{isStreamingOpen ? "Done" : "Edit services"}</span>
            {isStreamingOpen ? (
              <ChevronUp size={14} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} aria-hidden="true" />
            )}
          </button>
        </div>

        {isStreamingOpen && (
          <div className="streaming-drawer-body">
            <div className="streaming-toolbar-row">
              <div className="streaming-region-select">
                <Globe size={14} aria-hidden="true" />
                <select
                  value={userRegion}
                  onChange={(e) => setUserRegion(e.target.value)}
                  aria-label="Select Streaming Region"
                >
                  {AVAILABLE_REGIONS.map((reg) => (
                    <option key={reg.code} value={reg.code}>
                      {reg.flag} {reg.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="streaming-quick-links">
                <button
                  type="button"
                  className="streaming-link-btn"
                  onClick={() => setUserWatchProviders(POPULAR_WATCH_PROVIDERS.map((p) => p.id))}
                >
                  Select all
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  className="streaming-link-btn"
                  onClick={() => setUserWatchProviders([])}
                >
                  Reset
                </button>
              </div>
            </div>

            {userRegion === "GLOBAL" && userWatchProviders.length > 0 && (
              <p className="mood-parse-note">
                Choose a specific country above for accurate local streaming availability.
              </p>
            )}

            <div className="streaming-providers-grid">
              <button
                type="button"
                className={`streaming-provider-btn ${userWatchProviders.length === 0 ? "active" : ""}`}
                onClick={() => setUserWatchProviders([])}
              >
                <Globe size={14} aria-hidden="true" />
                <span>All Platforms</span>
              </button>

              {POPULAR_WATCH_PROVIDERS.map((provider) => {
                const isSelected = userWatchProviders.includes(provider.id);
                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={`streaming-provider-btn ${isSelected ? "active" : ""}`}
                    onClick={() => toggleWatchProvider(provider.id)}
                  >
                    <span>{provider.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="synthesis-action-bar">
        {error && (
          <div className="ai-error-banner">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="recs-actions-group">
          <Button
            variant="primary"
            size="lg"
            onClick={handleGetRecommendations}
            disabled={isLoading}
          >
            <span>{isDrawer ? "Update Picks" : "Find Picks"}</span>
          </Button>

          {!isDrawer && watched.length < 5 && onOpenTasteDeck && (
            <Button variant="secondary" size="lg" onClick={onOpenTasteDeck}>
              <span>Taste Calibration (30)</span>
            </Button>
          )}

          {isDrawer && (
            <Button variant="ghost" size="lg" onClick={handleResetSearch}>
              <RotateCcw size={15} aria-hidden="true" />
              <span>Start over</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  const navigateToRec = (rec) => {
    const id = rec.imdbID || (rec.tmdbId ? `tmdb_${rec.tmdbId}` : rec.id);
    if (id) navigate(`/movie/${id}`);
  };

  return (
    <div className="ai-recommendations">
      {!recommendations && !isLoading && (
        <div className="ai-discovery-stage">{renderStudioDeck(false)}</div>
      )}

      {isLoading && (
        <div className="ai-loading-theater">
          <h3 className="theater-title display-title">Curating your next watch</h3>
          <div className="theater-status-badge">
            <Loader2 size={15} className="spin-icon" aria-hidden="true" />
            <span>{progress || "Ranking candidates against your vault..."}</span>
          </div>

          <div className="theater-checklist">
            {loadingSteps.map((stepText, idx) => {
              const isDone = activeStep > idx;
              const isCurrent = activeStep === idx;
              return (
                <div
                  key={idx}
                  className={`theater-step ${isDone ? "done" : isCurrent ? "active" : ""}`}
                >
                  <div>
                    {isDone ? (
                      <Check size={15} aria-hidden="true" />
                    ) : isCurrent ? (
                      <Loader2 size={15} className="spin-icon" aria-hidden="true" />
                    ) : (
                      <div className="step-bullet" />
                    )}
                  </div>
                  <span>{stepText}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isLoading && recommendations && recommendations.length > 0 && (
        <div className="ai-results-stage">
          {showFilterDeck && renderStudioDeck(true)}

          {/* Single-Sentence Taste Summary + Link to Breakdown */}
          {tasteProfile && (
            <div className="taste-summary-block">
              <div className="taste-summary-line">
                <p className="taste-summary-sentence">
                  {watched.length > 0 ? `Based on ${watched.length} films. ` : ""}
                  You lean{" "}
                  <strong>
                    {(tasteProfile.favoriteGenres || []).slice(0, 3).join(", ") || "eclectic cinema"}
                  </strong>
                  {tasteProfile.preferredEra ? `, ${tasteProfile.preferredEra}` : ""}.
                </p>

                <button
                  type="button"
                  className="btn-breakdown-link"
                  onClick={() => setShowDnaDetails((prev) => !prev)}
                  aria-expanded={showDnaDetails}
                >
                  {showDnaDetails ? "Hide breakdown" : "View breakdown"}
                </button>
              </div>

              {showDnaDetails && (
                <div className="taste-grid-expanded">
                  <div className="taste-section">
                    <span className="taste-label">Genre Affinities</span>
                    <div className="taste-tags">
                      {(tasteProfile.favoriteGenres || []).map((genre, i) => (
                        <div key={genre} className="taste-tag-bar">
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
                    <span className="taste-label">Aesthetic Note</span>
                    <div className="taste-aesthetic-box">
                      <p>
                        {tasteProfile.ratingStyle ||
                          "Preference for deliberate pacing, visual atmosphere, and strong dramatic stakes."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Toolbar: Combined Mood/Streaming Control + Subtle Attribution Info */}
          <div className="recs-toolbar">
            <div className="recs-count-group">
              <h2 className="recs-title">Recommended for You</h2>

              <button
                type="button"
                className="about-picks-trigger"
                title={badgeSummary.tooltip}
                onClick={() => setShowAboutPicks((prev) => !prev)}
                aria-expanded={showAboutPicks}
              >
                <Info size={13} aria-hidden="true" />
                <span>About these picks</span>
              </button>

              {showAboutPicks && (
                <div className="about-picks-popover" role="status">
                  <div>
                    <strong>Status:</strong> {badgeSummary.freshnessLabel}
                  </div>
                  <div>
                    <strong>Curated by:</strong> {badgeSummary.modelLabel}
                  </div>
                  <div>{badgeSummary.tooltip}</div>
                </div>
              )}
            </div>

            <div className="recs-actions-group">
              <Button
                variant="secondary"
                size="sm"
                className={`oracle-filter-btn ${showFilterDeck ? "is-open" : ""}`}
                onClick={() => setShowFilterDeck((prev) => !prev)}
              >
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span>
                  {activeMoodObj.label}
                  {hasStreamingFilter ? " · Streaming filtered" : ""}
                </span>
                {showFilterDeck ? (
                  <ChevronUp size={13} aria-hidden="true" />
                ) : (
                  <ChevronDown size={13} aria-hidden="true" />
                )}
              </Button>

              <div className="recs-sort-controls">
                <select
                  className="recs-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort recommendations"
                >
                  <option value="match">Sort: Best Match</option>
                  <option value="imdb">Sort: IMDb Score</option>
                  <option value="year">Sort: Release Year</option>
                </select>
              </div>
            </div>
          </div>

          {/* Single-Column Editorial Curated List */}
          <ul className="recommendation-list-editorial">
            {sortedRecommendations.map((rec, index) => {
              const rankLabel = String(index + 1).padStart(2, "0");
              const inWatchlist = isAlreadyInWatchlist(rec.title, rec.year, rec.imdbID, rec.tmdbId);
              const isAdding = isAddingMovie === rec.title;
              const isDismissing = dismissingTitle === rec.title;
              const imdbVal = rec.imdbRating && rec.imdbRating !== "N/A"
                ? parseFloat(rec.imdbRating).toFixed(1)
                : null;
              const anchors = resolveRecommendationAnchors(rec, watched, 3);

              return (
                <motion.li
                  key={rec.id || rec.tmdbId || index}
                  className="recommendation-row"
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.12 }}
                  transition={{
                    duration: 0.45,
                    delay: Math.min(index * 0.04, 0.16),
                    ease: [0.22, 1, 0.36, 1]
                  }}
                >
                  <div className="rec-rank-num" aria-hidden="true">
                    {rankLabel}
                  </div>

                  <div
                    className="rec-poster-wrapper"
                    onClick={() => navigateToRec(rec)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${rec.title}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigateToRec(rec);
                      }
                    }}
                  >
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
                        className="rec-trailer-btn"
                        onClick={(e) => e.stopPropagation()}
                        title="Watch Official Trailer"
                        aria-label={`Watch trailer for ${rec.title}`}
                      >
                        <Play size={12} fill="currentColor" aria-hidden="true" />
                      </a>
                    )}
                  </div>

                  <div className="rec-content">
                    <div className="rec-header">
                      <button
                        type="button"
                        className="rec-title-btn"
                        onClick={() => navigateToRec(rec)}
                      >
                        <h3 className="rec-movie-title display-title">{rec.title}</h3>
                      </button>

                      {hasMeaningfulScoreSpread && rec.matchScore && (
                        <span className="rec-score-muted" title="Estimated affinity score">
                          {normalizeMatchScore(rec.matchScore)}% match
                        </span>
                      )}
                    </div>

                    <MetaLine
                      items={[rec.year, rec.genre]}
                      rating={imdbVal ? `${imdbVal} IMDb` : null}
                      ratingTone="neutral"
                    />

                    <p className="rec-reason-prose">{sanitizeOracleReason(rec.reason)}</p>

                    {anchors.length > 0 && (
                      <div className="rec-anchors-strip">
                        <span className="rec-anchors-label">Because you rated</span>
                        <div className="rec-anchors-list">
                          {anchors.map((anchor) => (
                            <button
                              key={anchor.id}
                              type="button"
                              className="rec-anchor-chip"
                              onClick={() => navigate(`/movie/${anchor.id}`)}
                              title={`${anchor.title} (${anchor.year || ""})`}
                            >
                              <span className="rec-anchor-thumb">
                                <PosterImage src={anchor.poster} title={anchor.title} alt="" />
                              </span>
                              <span>{anchor.title}</span>
                              {anchor.userRating > 0 && (
                                <span className="rec-anchor-rating">
                                  <Star size={11} fill="currentColor" aria-hidden="true" />
                                  {anchor.userRating}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {rec.streamProviders && rec.streamProviders.length > 0 && (
                      <span className="rec-stream-inline">
                        Available on {rec.streamProviders.slice(0, 3).map((p) => p.name).join(", ")}
                      </span>
                    )}

                    <div className="rec-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        className={`btn-oracle-watchlist ${inWatchlist ? "is-saved" : ""}`}
                        onClick={() => handleAdd(rec)}
                        disabled={inWatchlist || isAdding}
                      >
                        {isAdding ? (
                          <>
                            <Loader2 size={14} className="spin-icon" aria-hidden="true" />
                            <span>Saving...</span>
                          </>
                        ) : inWatchlist ? (
                          <>
                            <Check size={14} aria-hidden="true" />
                            <span>In Watchlist</span>
                          </>
                        ) : (
                          <>
                            <Plus size={14} aria-hidden="true" />
                            <span>Add to Watchlist</span>
                          </>
                        )}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDismissingTitle(isDismissing ? null : rec.title)}
                      >
                        Not for me
                      </Button>
                    </div>

                    {isDismissing && (
                      <div className="dismiss-reasons-popover">
                        <div className="popover-header">
                          <span>Why skip this film?</span>
                          <button
                            type="button"
                            className="btn-close-popover"
                            onClick={() => setDismissingTitle(null)}
                            aria-label="Close"
                          >
                            <X size={14} aria-hidden="true" />
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
                  </div>
                </motion.li>
              );
            })}
          </ul>

          <div className="recs-footer">
            <Button
              variant="primary"
              size="md"
              onClick={handleGetRecommendations}
              disabled={isLoading}
            >
              <RefreshCw size={14} className={isLoading ? "spin-icon" : ""} aria-hidden="true" />
              <span>Refresh picks</span>
            </Button>

            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setShowFilterDeck(true);
                window.scrollTo({ top: 100, behavior: "smooth" });
              }}
              disabled={isLoading}
            >
              <span>Change mood &amp; streaming</span>
            </Button>

            <Button variant="ghost" size="md" onClick={handleResetSearch} disabled={isLoading}>
              <span>Start over</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
