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
  getCurationCascade,
  getLastModelInfo,
  getPreferredCascadeModel,
  resolveResultModelInfo,
  normalizeMatchScore,
  createGeminiClient,
  parseFreeTextMoodWithGemini
} from "../services/geminiService";
import { isDebugUiEnabled } from "../services/debugFlags";
import { hasUserGeminiKey, resolveGeminiKey } from "../services/apiTransport";
import {
  bridgeTmdbToOmdb,
  extractTasteProfile
} from "../services/tmdbService";
import {
  formatRecBadgeSummary,
  buildOracleLoadingSteps,
  describePipelineNotice,
  selectStudioBackdropPoster,
  resolveRecommendationAnchors,
  sanitizeOracleReason,
  formatActiveVibeNote,
  nextRefreshExcludeState,
  shouldAutoRefreshOnDrawerClose,
  summarizeOraclePreferences
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
  draftTasteRulesWithGemini
} from "../services/tasteRulesService";
import PosterImage from "./PosterImage";
import QuickRateModal from "./QuickRateModal";
import GeminiKeyModal from "./GeminiKeyModal";
import OraclePreferencesPopover from "./OraclePreferencesPopover";
import { Button, MetaLine, Select } from "./ui";
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
  RotateCcw,
  Info,
  Film,
  Orbit,
  Moon,
  Flame,
  Heart,
  Gem,
  Search
} from "lucide-react";

const MOOD_ICON_MAP = {
  any: Film,
  "mind-bending": Orbit,
  "dark-thriller": Moon,
  "fun-popcorn": Flame,
  "comfort-watch": Heart,
  "hidden-gem": Gem
};

const VIBE_EXAMPLE_PROMPTS = [
  "like Drive but quieter",
  "90s neo-noir",
  "smart sci-fi under 2h"
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
    addWatched,
    cloudUser,
    loadSampleVault
  } = useApp();
  const canTrySampleVault = !cloudUser && watched.length < 3;

  const [isLoading, setIsLoading] = useState(false);
  const [isEnhancingWithGemini, setIsEnhancingWithGemini] = useState(false);
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
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [usingOwnKey, setUsingOwnKey] = useState(() => hasUserGeminiKey());
  const [customMoodQuery, setCustomMoodQuery] = useState("");
  const [activeMoodFilters, setActiveMoodFilters] = useState(null);
  const [isParsingMood, setIsParsingMood] = useState(false);
  const [moodParseNote, setMoodParseNote] = useState("");
  const [isPrefsOpen, setIsPrefsOpen] = useState(false);
  const [prefsInitialTab, setPrefsInitialTab] = useState("streaming");
  const [isDraftingRules, setIsDraftingRules] = useState(false);

  const [tasteProfileData, setTasteProfileData] = useState(null);
  const activeRequestRef = useRef(0);
  const refreshStateRef = useRef({ key: "", seenIds: [], page: 1 });
  const deckPrefsBtnRef = useRef(null);
  const toolbarPrefsBtnRef = useRef(null);
  const [prefsAnchorRef, setPrefsAnchorRef] = useState(deckPrefsBtnRef);

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

  const debug = isDebugUiEnabled();
  const queuedModel = getPreferredCascadeModel(getCurationCascade({ personal: debug }), "curation");
  const displayedModelInfo = aiModelInfo || getLastModelInfo("curation");
  const prefsSummary = summarizeOraclePreferences({
    userRegion,
    userWatchProviders,
    tasteRules,
    usingOwnKey
  });

  const loadingSteps = buildOracleLoadingSteps({
    watchedCount: watched.length,
    queuedModel,
    debug
  });

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

  const handleOpenPrefs = (anchorRef, tab = "streaming") => {
    setPrefsAnchorRef(anchorRef);
    setPrefsInitialTab(tab);
    setIsPrefsOpen((prev) => (prev && prefsAnchorRef === anchorRef ? false : true));
  };

  const handleClosePrefs = () => {
    setIsPrefsOpen(false);
    if (
      recommendations &&
      recommendations.length > 0 &&
      shouldAutoRefreshOnDrawerClose(true, currentHash, aiRecommendationsHash, isLoading)
    ) {
      handleGetRecommendations({ forceRefresh: false });
    }
  };

  const handleCloseFilterDeck = () => {
    setShowFilterDeck(false);
    setIsPrefsOpen(false);
    if (shouldAutoRefreshOnDrawerClose(true, currentHash, aiRecommendationsHash, isLoading)) {
      handleGetRecommendations({ forceRefresh: false });
    }
  };

  const handleAddRule = (text, polarity) => {
    const cleaned = String(text || "").trim();
    if (!cleaned || !addTasteRule || (tasteRules || []).length >= MAX_TASTE_RULES) return;
    addTasteRule(cleaned, polarity, { source: "user" });
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
    } catch (err) {
      console.warn("Taste rules auto-draft failed:", err);
    } finally {
      setIsDraftingRules(false);
    }
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
    setIsEnhancingWithGemini(false);
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
        tasteRules,
        onStage3Ready: (preliminaryResult) => {
          if (activeRequestRef.current !== requestId) return;
          if (
            Array.isArray(preliminaryResult?.recommendations) &&
            preliminaryResult.recommendations.length > 0
          ) {
            const prelimStamped = attachRecSourceToRecommendations(
              preliminaryResult.recommendations,
              effectiveMood,
              new Date().toISOString(),
              "ranker-fallback"
            );
            setTasteProfile(preliminaryResult.tasteProfile);
            setRecommendations(prelimStamped);
            setMoodShortfall(preliminaryResult.moodShortfall ?? null);
            setIsLoading(false);
            setIsEnhancingWithGemini(true);
          }
        }
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
      const activeMode = liveModelInfo?.pipeline || liveModelInfo?.fallbackMode || "";
      const finalPipeline =
        activeMode === "gemini-curation" ||
        activeMode === "gemini-omdb-fallback" ||
        Boolean(liveModelInfo?.model)
          ? "gemini"
          : "ranker-fallback";
      const stampedRecommendations = attachRecSourceToRecommendations(
        result.recommendations,
        effectiveMood,
        new Date().toISOString(),
        finalPipeline
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
        setIsEnhancingWithGemini(false);
        setProgress("");
      }
    }
  };

  const handleResetSearch = () => {
    activeRequestRef.current++;
    refreshStateRef.current = { key: "", seenIds: [], page: 1 };
    setIsLoading(false);
    setIsEnhancingWithGemini(false);
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
  const badgeSummary = formatRecBadgeSummary(effectiveModelInfo, isCacheValid, queuedModel, { debug });
  const pipelineNotice = describePipelineNotice(effectiveModelInfo);
  const studioBackdropPoster = selectStudioBackdropPoster(watched);

  const renderStudioDeck = (isDrawer = false) => {
    const hasCustomQuery = Boolean(customMoodQuery.trim());
    return (
      <div className={`ai-studio-deck oracle-command-deck ${isDrawer ? "drawer-mode" : ""}`}>
        {studioBackdropPoster && !isDrawer && (
          <div className="studio-deck-backdrop" aria-hidden="true">
            <img
              src={studioBackdropPoster}
              alt=""
              className="studio-deck-backdrop-img"
              loading="lazy"
            />
            <div className="studio-deck-backdrop-scrim" />
          </div>
        )}

        {isDrawer && (
          <div className="deck-drawer-header">
            <h3 className="deck-drawer-title">Mood &amp; Vibe</h3>
            <div className="deck-drawer-actions">
              <button
                type="button"
                className="streaming-link-btn"
                onClick={handleResetSearch}
              >
                <RotateCcw size={12} aria-hidden="true" />
                <span>Start over</span>
              </button>
              <button
                type="button"
                className="deck-close-btn"
                onClick={handleCloseFilterDeck}
                aria-label="Close Mood and Vibe Filters"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Tier 1: Single Horizontal Sliding Mood Pill Rail */}
        <div className="oracle-mood-tier">
          <div className="oracle-mood-rail" role="radiogroup" aria-label="Choose a mood">
            {MOOD_OPTIONS.map((mood) => {
              const isSelected = selectedMood === mood.id;
              const MoodIcon = MOOD_ICON_MAP[mood.id] || Film;
              return (
                <button
                  key={mood.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  title={mood.desc}
                  className={`oracle-mood-pill ${isSelected ? "is-active" : ""}`}
                  onClick={() => {
                    setSelectedMood(mood.id);
                    setActiveMoodFilters(null);
                    setMoodParseNote("");
                    refreshStateRef.current = { key: "", seenIds: [], page: 1 };
                  }}
                >
                  {isSelected && (
                    <motion.span
                      layoutId={isDrawer ? "oracle-mood-pill-drawer" : "oracle-mood-pill"}
                      className="oracle-mood-pill-bg"
                      transition={{ type: "spring", stiffness: 460, damping: 34 }}
                    />
                  )}
                  <MoodIcon size={14} className="oracle-mood-pill-icon" aria-hidden="true" />
                  <span className="oracle-mood-pill-label">{mood.label}</span>
                </button>
              );
            })}
          </div>
          <p className="oracle-mood-caption">{activeMoodObj.desc}</p>
        </div>

        {/* Tier 2: Unified Vibe Command Bar */}
        <form
          className="oracle-command-bar"
          onSubmit={(e) => {
            e.preventDefault();
            if (hasCustomQuery) {
              handleApplyFreeTextMood();
            } else {
              handleGetRecommendations({
                forceRefresh: Boolean(
                  recommendations && recommendations.length > 0 && aiRecommendationsHash === currentHash
                )
              });
            }
          }}
        >
          <div className="oracle-command-input-wrap">
            <Search size={15} className="oracle-command-icon" aria-hidden="true" />
            <input
              type="text"
              className="oracle-command-input"
              value={customMoodQuery}
              onChange={(e) => setCustomMoodQuery(e.target.value)}
              placeholder='Describe a vibe (e.g., "like Drive but quieter")'
              aria-label="Custom Mood Query"
            />
            {hasCustomQuery && (
              <button
                type="button"
                className="oracle-command-clear"
                onClick={() => setCustomMoodQuery("")}
                aria-label="Clear vibe query"
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="oracle-command-actions">
            <button
              ref={deckPrefsBtnRef}
              type="button"
              className={`oracle-prefs-trigger ${prefsSummary.badgeCount > 0 ? "has-active" : ""} ${
                isPrefsOpen && prefsAnchorRef === deckPrefsBtnRef ? "is-open" : ""
              }`}
              onClick={() => handleOpenPrefs(deckPrefsBtnRef, "streaming")}
              aria-haspopup="dialog"
              aria-expanded={isPrefsOpen && prefsAnchorRef === deckPrefsBtnRef}
              title="Streaming region, platforms, Taste Rules, and AI key"
            >
              <SlidersHorizontal size={13} aria-hidden="true" />
              <span className="oracle-prefs-trigger-label">{prefsSummary.summaryText}</span>
              {prefsSummary.badgeCount > 0 && (
                <span className="oracle-prefs-badge tabular-num">{prefsSummary.badgeCount}</span>
              )}
              <ChevronDown
                size={13}
                className={`oracle-prefs-chevron ${
                  isPrefsOpen && prefsAnchorRef === deckPrefsBtnRef ? "is-open" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isLoading || isParsingMood}
            >
              <span>
                {isParsingMood
                  ? "Matching..."
                  : hasCustomQuery
                  ? "Match Vibe"
                  : isDrawer
                  ? "Update Picks"
                  : "Find Picks"}
              </span>
            </Button>
          </div>
        </form>

        {/* Compact Quick-Try Hints & Optional Onboarding */}
        <div className="oracle-command-meta">
          <div className="mood-example-pills" aria-label="Example vibes">
            <span className="mood-examples-label">Try:</span>
            {VIBE_EXAMPLE_PROMPTS.map((samplePrompt) => (
              <button
                key={samplePrompt}
                type="button"
                className="mood-example-pill"
                onClick={() => setCustomMoodQuery(samplePrompt)}
              >
                {samplePrompt}
              </button>
            ))}
          </div>

          {!isDrawer && (watched.length < 5 || canTrySampleVault) && (
            <div className="oracle-onboarding-links">
              {watched.length < 5 && onOpenTasteDeck && (
                <button
                  type="button"
                  className="oracle-inline-cta"
                  onClick={onOpenTasteDeck}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  <span>Taste Calibration (30)</span>
                </button>
              )}
              {canTrySampleVault && (
                <button
                  type="button"
                  className="oracle-inline-cta"
                  onClick={() => loadSampleVault()}
                >
                  <span>Try a sample vault</span>
                </button>
              )}
            </div>
          )}
        </div>

        {moodParseNote && <p className="mood-parse-note">{moodParseNote}</p>}

        {error && (
          <div className="ai-error-banner">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  };

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
                title={debug ? badgeSummary.tooltip : undefined}
                onClick={() => setShowAboutPicks((prev) => !prev)}
                aria-expanded={showAboutPicks}
              >
                <Info size={13} aria-hidden="true" />
                <span>About these picks</span>
              </button>

              {isEnhancingWithGemini && (
                <span className="oracle-enhancing-pill" role="status" aria-live="polite">
                  <Loader2 size={12} className="spin-icon" aria-hidden="true" />
                  <span>{debug ? "Enhancing with Gemini curation…" : "Refining picks with AI…"}</span>
                </span>
              )}

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
                  {debug && <div>{badgeSummary.tooltip}</div>}
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
                <Sparkles size={13} aria-hidden="true" />
                <span>
                  {activeMoodFilters
                    ? selectedMood !== "any"
                      ? `${activeMoodObj.label} (Custom)`
                      : "Custom Vibe"
                    : activeMoodObj.label}
                </span>
                {showFilterDeck ? (
                  <ChevronUp size={13} aria-hidden="true" />
                ) : (
                  <ChevronDown size={13} aria-hidden="true" />
                )}
              </Button>

              <button
                ref={toolbarPrefsBtnRef}
                type="button"
                className={`oracle-prefs-trigger oracle-prefs-trigger-sm ${
                  prefsSummary.badgeCount > 0 ? "has-active" : ""
                } ${isPrefsOpen && prefsAnchorRef === toolbarPrefsBtnRef ? "is-open" : ""}`}
                onClick={() => handleOpenPrefs(toolbarPrefsBtnRef, "streaming")}
                aria-haspopup="dialog"
                aria-expanded={isPrefsOpen && prefsAnchorRef === toolbarPrefsBtnRef}
                title="Streaming region, platforms, Taste Rules, and AI key"
              >
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span className="oracle-prefs-trigger-label">Filters &amp; Rules</span>
                {prefsSummary.badgeCount > 0 && (
                  <span className="oracle-prefs-badge tabular-num">{prefsSummary.badgeCount}</span>
                )}
                <ChevronDown
                  size={13}
                  className={`oracle-prefs-chevron ${
                    isPrefsOpen && prefsAnchorRef === toolbarPrefsBtnRef ? "is-open" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              <div className="recs-sort-controls">
                <Select
                  value={sortBy}
                  onChange={(val) => setSortBy(val)}
                  ariaLabel="Sort recommendations"
                  align="right"
                  size="sm"
                  options={[
                    { value: "match", label: "Sort: Best Match" },
                    { value: "imdb", label: "Sort: IMDb Score" },
                    { value: "year", label: "Sort: Release Year" }
                  ]}
                />
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleGetRecommendations({ forceRefresh: true })}
                disabled={isLoading || isEnhancingWithGemini}
                title="Refresh recommendations"
              >
                <RefreshCw size={13} className={isLoading ? "spin-icon" : ""} aria-hidden="true" />
                <span>Refresh</span>
              </Button>
            </div>
          </div>

          {pipelineNotice && (
            <p className="mood-parse-note" role="status">
              {pipelineNotice}{" "}
              {!usingOwnKey && (
                <button
                  type="button"
                  className="streaming-link-btn"
                  onClick={() => setIsKeyModalOpen(true)}
                >
                  Use your own Gemini key
                </button>
              )}
            </p>
          )}

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
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.1 }}
                  transition={{
                    duration: 0.42,
                    delay: Math.min((index % 5) * 0.045, 0.18),
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

      <OraclePreferencesPopover
        isOpen={isPrefsOpen}
        onClose={handleClosePrefs}
        triggerRef={prefsAnchorRef}
        userRegion={userRegion}
        setUserRegion={setUserRegion}
        userWatchProviders={userWatchProviders}
        setUserWatchProviders={setUserWatchProviders}
        toggleWatchProvider={toggleWatchProvider}
        tasteRules={tasteRules}
        onAddRule={handleAddRule}
        onToggleRule={toggleTasteRuleActive}
        onEditRule={updateTasteRule}
        onDeleteRule={deleteTasteRule}
        onPinRule={toggleTasteRulePin}
        onAutoDraft={handleAutoDraftRules}
        isDraftingRules={isDraftingRules}
        watchedCount={watched.length}
        usingOwnKey={usingOwnKey}
        onOpenKeyModal={() => setIsKeyModalOpen(true)}
        initialTab={prefsInitialTab}
      />

      <QuickRateModal
        movie={quickRateRec}
        watched={watched}
        watchlist={watchlist}
        onClose={() => setQuickRateRec(null)}
        onSaveWatched={addWatched}
      />

      <GeminiKeyModal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        onChanged={(active) => setUsingOwnKey(Boolean(active))}
      />
    </div>
  );
}
