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
  sanitizeOracleReason,
  formatActiveVibeNote,
  nextRefreshExcludeState,
  shouldAutoRefreshOnDrawerClose
} from "../services/oracleViewHelpers";
import {
  DEFAULT_RECOMMENDATION_COUNT,
  MIN_VALID_CACHE_COUNT,
  MOOD_OPTIONS,
  buildMoodFilterHashSegment,
  isExplicitMoodActive,
  normalizeMoodFilters,
  parseFreeTextMoodFallback
} from "../services/moodPolicy";
import { useApp } from "../context/AppContext";
import { attachRecSourceToRecommendations } from "../services/vaultStats";
import {
  MAX_TASTE_RULES,
  MAX_RULE_TEXT_LENGTH,
  draftTasteRulesWithGemini
} from "../services/tasteRulesService";
import PosterImage from "./PosterImage";
import QuickRateModal from "./QuickRateModal";
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
  Info,
  Pin,
  Pencil,
  Trash2
} from "lucide-react";

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
    tasteRules = [],
    setTasteRules,
    addTasteRule,
    updateTasteRule,
    deleteTasteRule,
    toggleTasteRuleActive,
    toggleTasteRulePin,
    aiRecommendationsHash,
    aiModelInfo,
    aiFeedbackLog,
    saveAiRecommendations,
    addAiFeedback,
    addWatched
  } = useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [activeStep, setActiveStep] = useState(0);

  const [isAddingMovie, setIsAddingMovie] = useState(null);
  const [sortBy, setSortBy] = useState("match");
  const [selectedMood, setSelectedMood] = useState("any");
  const [dismissingTitle, setDismissingTitle] = useState(null);
  const [quickRateRec, setQuickRateRec] = useState(null);
  const [moodShortfall, setMoodShortfall] = useState(null);
  const [showDnaDetails, setShowDnaDetails] = useState(false);
  const [showFilterDeck, setShowFilterDeck] = useState(false);
  const [showAboutPicks, setShowAboutPicks] = useState(false);
  const [customMoodQuery, setCustomMoodQuery] = useState("");
  const [activeMoodFilters, setActiveMoodFilters] = useState(null);
  const [isParsingMood, setIsParsingMood] = useState(false);
  const [moodParseNote, setMoodParseNote] = useState("");
  const [isStreamingOpen, setIsStreamingOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [newRuleText, setNewRuleText] = useState("");
  const [newRulePolarity, setNewRulePolarity] = useState("prefer");
  const [isDraftingRules, setIsDraftingRules] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingRuleText, setEditingRuleText] = useState("");

  const [tasteProfileData, setTasteProfileData] = useState(null);
  const activeRequestRef = useRef(0);
  const refreshStateRef = useRef({ key: "", seenIds: [], page: 1 });

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
    ? generateProfileHash(
        tasteProfileData,
        tasteProfileData.watchlistGenreIds,
        selectedMood,
        userWatchProviders,
        activeMoodFilters,
        userRegion,
        watched,
        tasteRules
      )
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
    if ((!recommendations || aiRecommendationsHash !== currentHash) && currentHash && !isLoading) {
      const cached = getSmartCache(currentHash, watched, watchlist);
      if (cached && cached.recommendations?.length >= MIN_VALID_CACHE_COUNT) {
        const cachedModelInfo = cached.modelInfo
          ? { ...cached.modelInfo, fromCache: true }
          : null;
        setTasteProfile(cached.tasteProfile);
        setRecommendations(cached.recommendations);
        saveAiRecommendations(cached.recommendations, cached.tasteProfile, currentHash, cachedModelInfo);
      }
    }
  }, [currentHash, isLoading, aiRecommendationsHash]);

  const handleCloseFilterDeck = () => {
    setShowFilterDeck(false);
    setIsStreamingOpen(false);
    setIsRulesOpen(false);
    setEditingRuleId(null);
    if (shouldAutoRefreshOnDrawerClose(true, currentHash, aiRecommendationsHash, isLoading)) {
      handleGetRecommendations({ forceRefresh: false });
    }
  };

  const handleAddRuleSubmit = (e) => {
    e.preventDefault();
    const cleaned = newRuleText.trim();
    if (!cleaned || !addTasteRule || (tasteRules || []).length >= MAX_TASTE_RULES) return;
    addTasteRule(cleaned, newRulePolarity, { source: "user" });
    setNewRuleText("");
    setIsRulesOpen(true);
  };

  const handleAutoDraftRules = async () => {
    if (isDraftingRules || watched.length === 0) return;
    setIsDraftingRules(true);
    try {
      const profile = tasteProfileData || (await extractTasteProfile(watched, watchlist));
      const key = resolveGeminiKey();
      const ai = createGeminiClient(key);
      const drafted = await draftTasteRulesWithGemini(ai, {
        watched,
        profile,
        feedbackLog: aiFeedbackLog,
        existingRules: tasteRules
      });
      if (setTasteRules && Array.isArray(drafted) && drafted.length > 0) {
        setTasteRules(drafted);
      }
      setIsRulesOpen(true);
    } catch (err) {
      console.warn("Taste rules auto-draft failed:", err);
    } finally {
      setIsDraftingRules(false);
    }
  };

  const handleSaveRuleEdit = (ruleId) => {
    const cleaned = editingRuleText.trim();
    if (cleaned && updateTasteRule) {
      updateTasteRule(ruleId, { text: cleaned });
    }
    setEditingRuleId(null);
    setEditingRuleText("");
  };

  const handleGetRecommendations = async (invokeOpts = {}) => {
    const requestId = ++activeRequestRef.current;
    const isForcedRefresh = invokeOpts?.forceRefresh === true;
    const effectiveMood = invokeOpts?.moodOverride ?? selectedMood;
    const effectiveFilters =
      invokeOpts?.moodFiltersOverride !== undefined ? invokeOpts.moodFiltersOverride : activeMoodFilters;
    const vibeKey = `${effectiveMood}::${buildMoodFilterHashSegment(effectiveFilters)}`;

    let excludeIds = [];
    let page = 1;
    if (isForcedRefresh && refreshStateRef.current.key === vibeKey) {
      const nextRefresh = nextRefreshExcludeState(refreshStateRef.current, recommendations, true);
      refreshStateRef.current = { key: vibeKey, seenIds: nextRefresh.seenIds, page: nextRefresh.page };
      excludeIds = nextRefresh.excludeIds;
      page = nextRefresh.page;
    } else {
      refreshStateRef.current = { key: vibeKey, seenIds: [], page: 1 };
    }

    setIsLoading(true);
    setRecommendations(null);
    setError("");
    setDismissingTitle(null);

    try {
      const result = await getMovieRecommendations(watched, watchlist, setProgress, {
        mood: effectiveMood,
        moodFilters: effectiveFilters,
        excludeIds,
        page,
        targetCount: DEFAULT_RECOMMENDATION_COUNT,
        userRegion,
        userProviders: userWatchProviders,
        feedbackLog: aiFeedbackLog,
        tasteRules
      });

      if (activeRequestRef.current !== requestId) return;

      const profile = await extractTasteProfile(watched, watchlist);
      const newHash = generateProfileHash(
        profile,
        profile.watchlistGenreIds,
        effectiveMood,
        userWatchProviders,
        effectiveFilters,
        userRegion,
        watched,
        tasteRules
      );
      setMoodShortfall(result?.moodShortfall ?? null);
      const liveModelInfo = {
        ...resolveResultModelInfo(result, "curation"),
        fromCache: false
      };
      const stampedRecommendations = attachRecSourceToRecommendations(
        result.recommendations,
        effectiveMood
      );
      const cacheableResult = {
        ...result,
        recommendations: stampedRecommendations,
        modelInfo: liveModelInfo
      };

      setTasteProfile(result.tasteProfile);
      setRecommendations(stampedRecommendations);
      saveAiRecommendations(stampedRecommendations, result.tasteProfile, newHash, liveModelInfo);
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
    refreshStateRef.current = { key: "", seenIds: [], page: 1 };
    setIsLoading(false);
    setProgress("");
    setError("");
    setSelectedMood("any");
    setActiveMoodFilters(null);
    setCustomMoodQuery("");
    setMoodParseNote("");
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
      let parsed = null;
      try {
        const aiClient = createGeminiClient(resolveGeminiKey());
        parsed = aiClient ? await parseFreeTextMoodWithGemini(aiClient, query) : null;
      } catch {
        parsed = null;
      }

      const hasAiSignal = Boolean(
        (parsed?.moodId && parsed.moodId !== "any") ||
          parsed?.withGenres?.length > 0 ||
          parsed?.withoutKeywords?.length > 0 ||
          parsed?.minYear ||
          parsed?.maxYear
      );
      const fallback = parseFreeTextMoodFallback(query);
      const normalized = normalizeMoodFilters({
        ...(hasAiSignal ? parsed : fallback || {}),
        query
      });
      const matched = MOOD_OPTIONS.find((m) => m.id === normalized?.moodId);
      const nextMood = matched && matched.id !== "any" ? matched.id : selectedMood;

      refreshStateRef.current = { key: "", seenIds: [], page: 1 };
      setSelectedMood(nextMood);
      setActiveMoodFilters(normalized);
      setMoodParseNote(formatActiveVibeNote(normalized, MOOD_OPTIONS) || `Applied vibe: "${query}"`);

      setIsParsingMood(false);
      await handleGetRecommendations({
        forceRefresh: false,
        moodOverride: nextMood,
        moodFiltersOverride: normalized
      });
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
        onAddToWatchlist({
          ...bridged,
          ...(rec?.recSource ? { recSource: rec.recSource } : {})
        });
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
        userRating: 0,
        ...(rec?.recSource ? { recSource: rec.recSource } : {})
      };
      onAddToWatchlist(fallbackMovie);
    } finally {
      setIsAddingMovie(null);
    }
  };

  const handleDismiss = (rec, reason) => {
    const isAlreadySeen = reason === "Already seen";
    addAiFeedback({
      title: rec.title,
      year: rec.year,
      tmdbId: rec.tmdbId ?? rec.id ?? null,
      imdbID: rec.imdbID ?? null,
      matchScoreAtTime: rec.matchScore ?? null,
      sourceBucket: rec.sourceBucket ?? null,
      features: rec.features ?? null,
      action: isAlreadySeen ? "already_seen" : "dismissed",
      reason
    });

    const updated = (recommendations || []).filter((r) => r.title !== rec.title);
    setRecommendations(updated);
    saveAiRecommendations(updated, tasteProfile, aiRecommendationsHash);
    setDismissingTitle(null);
    if (isAlreadySeen) {
      const parsedTmdbId = Number(rec.tmdbId ?? rec.id);
      const validTmdbId = Number.isSafeInteger(parsedTmdbId) && parsedTmdbId > 0 ? parsedTmdbId : null;
      setQuickRateRec({
        ...rec,
        Title: rec.title || rec.Title || "",
        Year: String(rec.year || rec.Year || ""),
        Poster: rec.posterUrl || rec.poster || rec.Poster || "",
        imdbID: rec.imdbID || (validTmdbId ? `tmdb_${validTmdbId}` : rec.id || ""),
        tmdbId: validTmdbId
      });
    }
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
      if (sortBy === "match") return (b.matchScore ?? -1) - (a.matchScore ?? -1);
      if (sortBy === "imdb") return (parseFloat(b.imdbRating) || 0) - (parseFloat(a.imdbRating) || 0);
      if (sortBy === "year") return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
      return 0;
    });

  // Only show numeric match scores when they carry information (spread >= 4 pts and > 1 distinct value)
  const scoreValues = sortedRecommendations
    .map((r) => normalizeMatchScore(r.matchScore))
    .filter((v) => v !== null);
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
            onClick={handleCloseFilterDeck}
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
                onClick={() => {
                  setSelectedMood(mood.id);
                  setActiveMoodFilters(null);
                  setMoodParseNote("");
                  refreshStateRef.current = { key: "", seenIds: [], page: 1 };
                }}
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

      <div className="taste-rules-section">
        <div className="taste-rules-summary-bar">
          <div className="streaming-summary-info">
            <span className="streaming-summary-label">Taste Rules</span>
            <span aria-hidden="true">·</span>
            <span className="streaming-summary-value">
              {(tasteRules || []).length === 0
                ? "No custom rules"
                : `${(tasteRules || []).filter((r) => r.active !== false).length} active${
                    (tasteRules || []).some((r) => r.pinned)
                      ? ` (${(tasteRules || []).filter((r) => r.pinned).length} pinned)`
                      : ""
                  }`}
            </span>
          </div>

          <div className="taste-rules-summary-actions">
            <button
              type="button"
              className="taste-rules-draft-btn"
              onClick={handleAutoDraftRules}
              disabled={isDraftingRules || watched.length === 0}
              title={watched.length === 0 ? "Rate at least 1 film to auto-draft rules" : "Synthesize Prefer/Avoid rules from your rated Vault"}
            >
              {isDraftingRules ? (
                <Loader2 size={13} className="spin-icon" aria-hidden="true" />
              ) : (
                <Sparkles size={13} aria-hidden="true" />
              )}
              <span>{isDraftingRules ? "Drafting..." : "Auto-Draft Rules from Vault"}</span>
            </button>

            <button
              type="button"
              className="streaming-summary-toggle"
              onClick={() => setIsRulesOpen((prev) => !prev)}
              aria-expanded={isRulesOpen}
            >
              <span>{isRulesOpen ? "Done" : "Edit rules"}</span>
              {isRulesOpen ? (
                <ChevronUp size={14} aria-hidden="true" />
              ) : (
                <ChevronDown size={14} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {!isRulesOpen && (tasteRules || []).length > 0 && (
          <div className="taste-rules-preview-strip">
            {(tasteRules || []).map((rule) => (
              <button
                key={rule.id}
                type="button"
                className={`taste-rule-pill is-${rule.polarity} ${rule.active !== false ? "is-active" : "is-inactive"} ${rule.pinned ? "is-pinned" : ""}`}
                onClick={() => toggleTasteRuleActive && toggleTasteRuleActive(rule.id)}
                title="Click to pause or activate rule"
              >
                <span className="rule-polarity-tag">{rule.polarity === "avoid" ? "Avoid" : "Prefer"}</span>
                <span className="rule-text-span">{rule.text}</span>
              </button>
            ))}
          </div>
        )}

        {isRulesOpen && (
          <div className="taste-rules-drawer-body">
            <form className="taste-rule-form" onSubmit={handleAddRuleSubmit}>
              <div className="rule-polarity-switch" role="group" aria-label="Rule polarity">
                <button
                  type="button"
                  className={`polarity-btn ${newRulePolarity === "prefer" ? "is-selected prefer" : ""}`}
                  onClick={() => setNewRulePolarity("prefer")}
                >
                  Prefer
                </button>
                <button
                  type="button"
                  className={`polarity-btn ${newRulePolarity === "avoid" ? "is-selected avoid" : ""}`}
                  onClick={() => setNewRulePolarity("avoid")}
                >
                  Avoid
                </button>
              </div>
              <input
                type="text"
                className="taste-rule-input"
                maxLength={MAX_RULE_TEXT_LENGTH}
                value={newRuleText}
                onChange={(e) => setNewRuleText(e.target.value)}
                placeholder={
                  newRulePolarity === "avoid"
                    ? 'e.g. "No slow-burn period dramas" or "No horror"'
                    : 'e.g. "Prefer cyberpunk noir under 130m"'
                }
                aria-label="New Taste Rule"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!newRuleText.trim() || (tasteRules || []).length >= MAX_TASTE_RULES}
              >
                <Plus size={13} aria-hidden="true" />
                <span>Add</span>
              </Button>
            </form>

            {(tasteRules || []).length === 0 ? (
              <p className="taste-rules-empty">
                Add up to {MAX_TASTE_RULES} persistent Prefer or Avoid rules, or click Auto-Draft above to extract patterns from your Vault.
              </p>
            ) : (
              <ul className="taste-rules-list">
                {(tasteRules || []).map((rule) => (
                  <li
                    key={rule.id}
                    className={`taste-rule-item is-${rule.polarity} ${rule.active !== false ? "is-active" : "is-inactive"}`}
                  >
                    {editingRuleId === rule.id ? (
                      <div className="taste-rule-edit-row">
                        <input
                          type="text"
                          className="taste-rule-input"
                          maxLength={MAX_RULE_TEXT_LENGTH}
                          value={editingRuleText}
                          onChange={(e) => setEditingRuleText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveRuleEdit(rule.id);
                            } else if (e.key === "Escape") {
                              setEditingRuleId(null);
                            }
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="rule-icon-btn"
                          onClick={() => handleSaveRuleEdit(rule.id)}
                          aria-label="Save rule edit"
                        >
                          <Check size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="rule-icon-btn"
                          onClick={() => setEditingRuleId(null)}
                          aria-label="Cancel rule edit"
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="taste-rule-toggle-main"
                          onClick={() => toggleTasteRuleActive && toggleTasteRuleActive(rule.id)}
                          title={rule.active !== false ? "Click to pause rule" : "Click to enable rule"}
                        >
                          <span className="rule-polarity-tag">
                            {rule.polarity === "avoid" ? "Avoid" : "Prefer"}
                          </span>
                          <span className="rule-text-span">{rule.text}</span>
                        </button>
                        <div className="taste-rule-item-actions">
                          <button
                            type="button"
                            className={`rule-icon-btn ${rule.pinned ? "is-pinned" : ""}`}
                            onClick={() => toggleTasteRulePin && toggleTasteRulePin(rule.id)}
                            aria-label={rule.pinned ? "Unpin rule" : "Pin rule"}
                            title={rule.pinned ? "Pinned to prompt top" : "Pin rule"}
                          >
                            <Pin size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="rule-icon-btn"
                            onClick={() => {
                              setEditingRuleId(rule.id);
                              setEditingRuleText(rule.text);
                            }}
                            aria-label="Edit rule"
                            title="Edit rule"
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="rule-icon-btn danger"
                            onClick={() => deleteTasteRule && deleteTasteRule(rule.id)}
                            aria-label="Delete rule"
                            title="Delete rule"
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
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
            onClick={() =>
              handleGetRecommendations({
                forceRefresh: Boolean(recommendations && recommendations.length > 0 && aiRecommendationsHash === currentHash)
              })
            }
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
                  {badgeSummary.hydrationLabel && (
                    <div>
                      <strong>Pool coverage:</strong> {badgeSummary.hydrationLabel}
                    </div>
                  )}
                  <div>{badgeSummary.tooltip}</div>
                </div>
              )}
            </div>

            <div className="recs-actions-group">
              <Button
                variant="secondary"
                size="sm"
                className={`oracle-filter-btn ${showFilterDeck ? "is-open" : ""}`}
                onClick={() => (showFilterDeck ? handleCloseFilterDeck() : setShowFilterDeck(true))}
              >
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span>
                  {activeMoodFilters
                    ? selectedMood !== "any"
                      ? `${activeMoodObj.label} (Custom)`
                      : "Custom Vibe"
                    : activeMoodObj.label}
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
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.38,
                    delay: Math.min(index * 0.035, 0.14),
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

                      {hasMeaningfulScoreSpread && normalizeMatchScore(rec.matchScore) !== null && (
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

                    {(() => {
                      const availableList = [
                        ...(Array.isArray(rec.streamProviders) ? rec.streamProviders : []),
                        ...(Array.isArray(rec.freeProviders) ? rec.freeProviders : [])
                      ];
                      if (availableList.length === 0) return null;
                      return (
                        <span className="rec-stream-inline">
                          Available on {availableList.slice(0, 3).map((p) => p.name).join(", ")}
                        </span>
                      );
                    })()}

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

          {(moodShortfall ||
            (isExplicitMoodActive(selectedMood, activeMoodFilters) &&
              sortedRecommendations.length > 0 &&
              sortedRecommendations.length < DEFAULT_RECOMMENDATION_COUNT)) && (
            <div className="mood-parse-note" role="status">
              <span>
                Only {sortedRecommendations.length} of {moodShortfall?.requested || DEFAULT_RECOMMENDATION_COUNT} films matched your strict mood and streaming filters. Try widening your vibe or platforms for more picks.{" "}
              </span>
              <button
                type="button"
                className="streaming-link-btn"
                onClick={() => setShowFilterDeck(true)}
              >
                Widen vibe &amp; filters
              </button>
            </div>
          )}

          <div className="recs-footer">
            <Button
              variant="primary"
              size="md"
              onClick={() => handleGetRecommendations({ forceRefresh: true })}
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

      <QuickRateModal
        movie={quickRateRec}
        watched={watched}
        watchlist={watchlist}
        onClose={() => setQuickRateRec(null)}
        onSaveWatched={addWatched}
      />
    </div>
  );
}
