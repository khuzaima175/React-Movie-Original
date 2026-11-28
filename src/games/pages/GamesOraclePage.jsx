import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bookmark,
  Check,
  Cpu,
  MessageSquare,
  RefreshCw,
  Send,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
  ThumbsDown,
  X
} from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { GAME_PLATFORM_FAMILIES, fetchGameDetails, fetchGamesBatch } from "../services/igdbService";
import {
  DEFAULT_GAME_TUNER_STATE,
  applyFranchiseDiversityCap,
  applyGameTuner,
  buildGameRecommendationIds,
  filterDuplicateGameEditions,
  rankBacklogForNextPlay,
  rankGameCandidates
} from "../services/gameRankerService";
import { getDefaultPlatformFocus, isGameCompatibleWithRig } from "../services/gameRigService";
import {
  GAME_ORACLE_MOODS,
  askGameCompanionChat,
  curateGamesWithOracle
} from "../services/gameOracleService";
import { Select } from "../../components/ui/Select";
import { Tabs } from "../../components/ui/Tabs";
import GameTasteTunerBar from "../components/GameTasteTunerBar";
import { flyToVault } from "../../services/flyToVault";
import { EASE } from "../../motion";

const PLATFORM_OPTIONS = GAME_PLATFORM_FAMILIES.map((pf) => ({
  value: pf.id,
  label: pf.label
}));

const MOOD_SELECT_OPTIONS = GAME_ORACLE_MOODS.map((m) => ({
  value: m.id,
  label: m.label
}));

const CHAT_STARTERS = [
  "What's the single best 15-hour game matching my vault?",
  "Rank my backlog for what I should install tonight.",
  "Recommend 3 underrated gems outside my usual comfort zone.",
  "What makes my top-rated games share the same DNA?"
];

export default function GamesOraclePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    played,
    backlog,
    playedById,
    backlogIds,
    dismissedIds,
    dismissGame,
    models,
    modelsLoading,
    rigProfile,
    setOnboardingOpen,
    setRateTarget,
    toggleBacklogGame
  } = useGameVault();

  const initialTab = searchParams.get("tab") === "chat" ? "chat" : "picks";
  const pinnedGameIdParam = Number(searchParams.get("game") || 0);

  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedMood, setSelectedMood] = useState("any");
  const [customVibe, setCustomVibe] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [platformFamily, setPlatformFamily] = useState(() => getDefaultPlatformFocus(rigProfile));
  const [tuner, setTuner] = useState(DEFAULT_GAME_TUNER_STATE);
  const [picks, setPicks] = useState([]);
  const [shownIds, setShownIds] = useState(() => new Set());
  const [source, setSource] = useState("");
  const [deepNotice, setDeepNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [deepLoading, setDeepLoading] = useState(false);
  const [error, setError] = useState("");
  const autoLoadedRef = useRef(false);

  // Game Companion Chat state
  const [pinnedGame, setPinnedGame] = useState(null);
  const [allowSpoilers, setAllowSpoilers] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const chatEndRef = useRef(null);

  useEffect(() => {
    document.title = "Game Oracle | GameVault";
  }, []);

  useEffect(() => {
    if (searchParams.get("tab") === "chat") setActiveTab("chat");
  }, [searchParams]);

  useEffect(() => {
    if (!pinnedGameIdParam) return undefined;
    let active = true;
    fetchGameDetails(pinnedGameIdParam)
      .then((g) => {
        if (active && g) setPinnedGame(g);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pinnedGameIdParam]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatBusy]);

  const playedByTitle = useMemo(() => {
    const m = new Map();
    for (const g of played) {
      if (g?.title) m.set(String(g.title).toLowerCase(), g.igdbId);
    }
    return m;
  }, [played]);

  async function handleGenerate({
    refresh = false,
    useGemini = true,
    curationMode = "standard",
    moodOverride = selectedMood,
    platformOverride = platformFamily,
    vibeOverride = customVibe,
    preserveExistingOnLoad = false
  } = {}) {
    if (played.length === 0) return;
    const isDeep = curationMode === "deep";
    if (isDeep) {
      setDeepLoading(true);
    } else if (!preserveExistingOnLoad) {
      setLoading(true);
    }
    setError("");
    setDeepNotice("");
    try {
      const moodObj = GAME_ORACLE_MOODS.find((m) => m.id === moodOverride);
      const hasMoodBias = Boolean(moodObj?.tunerBias);
      const { allIds, maps } = buildGameRecommendationIds(played, backlog, models, {
        warmLimit: isDeep ? 90 : (hasMoodBias ? 88 : 70),
        coldLimit: isDeep ? 36 : (hasMoodBias ? 34 : 26),
        excludeBacklog: false,
        dismissedIds,
        antiBubble: tuner.antiBubble
      });
      const hydrated = await fetchGamesBatch(allIds);
      let deduped = filterDuplicateGameEditions(hydrated, played, models?.editionAliases);
      if (rigProfile?.completed && rigProfile?.respectRigLimits) {
        const rigFiltered = deduped.filter((g) => isGameCompatibleWithRig(g, rigProfile).compatible);
        if (rigFiltered.length >= 12) deduped = rigFiltered;
      }
      const excludeList = [...dismissedIds, ...(refresh ? [...shownIds] : [])];
      let ranked = rankGameCandidates(deduped, played, backlog, models, maps, { dismissedIds });
      if (hasMoodBias) {
        ranked = applyGameTuner(ranked, moodObj.tunerBias, {
          contentIndex: models.contentIndex,
          tunerAxes: models.tunerAxes,
          editionAliases: models.editionAliases,
          played
        });
      }
      ranked = applyFranchiseDiversityCap(ranked, { maxPerFranchise: 1, headWindow: 18 });
      const vibe = [moodObj?.prompt, vibeOverride.trim()].filter(Boolean).join(". ");

      // When auto-initializing or curating standard picks without an existing slate, show instant local picks first
      if (preserveExistingOnLoad) {
        const instant = await curateGamesWithOracle({
          played,
          candidates: ranked,
          vibe,
          platformFamily: platformOverride,
          count: 12,
          excludeIds: excludeList,
          useGemini: false
        });
        if (instant.picks.length > 0) {
          setPicks(instant.picks);
          setSource(instant.source);
        }
      }

      const result = await curateGamesWithOracle({
        played,
        candidates: ranked,
        vibe,
        platformFamily: platformOverride,
        count: 12,
        excludeIds: excludeList,
        useGemini,
        mode: curationMode
      });
      setPicks(result.picks);
      setSource(result.source);
      if (isDeep && result.source !== "gemini-deep") {
        setDeepNotice(
          result.source === "gemini"
            ? "Hydrogen quota or timeout reached — curated with Flash Lite instead."
            : "AI models unavailable right now — showing on-device taste picks."
        );
      }
      setShownIds((prev) => new Set([...prev, ...result.picks.map((p) => p.igdbId)]));
    } catch {
      if (!preserveExistingOnLoad) {
        setError("Could not load picks right now. Please try again.");
      }
    } finally {
      if (isDeep) setDeepLoading(false);
      else setLoading(false);
    }
  }

  // Instant initial slate on mount + fast Flash-Lite upgrade in background (saves Hydrogen's 20/day quota for "More Accurate Picks")
  useEffect(() => {
    if (
      activeTab !== "picks" ||
      autoLoadedRef.current ||
      modelsLoading ||
      played.length === 0 ||
      picks.length > 0 ||
      (!models.easeIndex && !models.contentIndex)
    ) {
      return;
    }
    autoLoadedRef.current = true;
    handleGenerate({ refresh: false, useGemini: true, curationMode: "standard", preserveExistingOnLoad: true });
  }, [activeTab, modelsLoading, played.length, picks.length, models]);

  function handleBacklogTonight() {
    if (backlog.length === 0) return;
    const ranked = rankBacklogForNextPlay(backlog, played, models, { dismissedIds });
    setPicks(
      ranked.slice(0, 12).map((g) => ({
        ...g,
        anchorTitles: g.anchorTitles?.length > 0 ? g.anchorTitles : played.slice(0, 2).map((p) => p.title),
        pitch:
          g.summary?.slice(0, 165) ||
          "Picked from your personal Backlog based on your highest-rated games."
      }))
    );
    setSource("backlog-ml");
  }

  function handleDismissPick(igdbId) {
    dismissGame(igdbId);
    setPicks((prev) => prev.filter((p) => p.igdbId !== igdbId));
  }

  async function handleSendChat(e, overridePrompt = "") {
    e?.preventDefault?.();
    const text = (overridePrompt || chatInput).trim();
    if (!text || chatBusy) return;
    const userMsg = { id: Date.now(), role: "user", text };
    const nextHistory = [...chatMessages, userMsg];
    setChatMessages(nextHistory);
    setChatInput("");
    setChatBusy(true);
    try {
      const reply = await askGameCompanionChat({
        message: text,
        history: chatMessages,
        played,
        backlog,
        pinnedGame,
        allowSpoilers
      });
      setChatMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: "assistant", text: reply || "I couldn't generate a response right now." }
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          text: "Could not reach Gemini right now. Your on-device recommendations are still ready in Discover and Explore."
        }
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  // Live-tune the displayed Oracle slate cleanly when the user adjusts dials
  const tunedPicks = useMemo(() => {
    if (picks.length === 0) return [];
    const neutral =
      tuner.era === 0 && tuner.familiarity === 0 && tuner.pacing === 0 && tuner.tone === 0 && !tuner.antiBubble;
    if (neutral) return picks;
    return applyGameTuner(picks, tuner, {
      contentIndex: models.contentIndex,
      tunerAxes: models.tunerAxes,
      editionAliases: models.editionAliases,
      played
    });
  }, [picks, tuner, models, played]);

  const spotlight = tunedPicks[0] || null;
  const gridPicks = tunedPicks.slice(1);

  return (
    <div className="gv-page page-rail">
      {/* Header */}
      <div className="gv-oracle-header">
        <div>
          <h1 className="gv-page-title">Game Oracle</h1>
          <p className="gv-page-subtitle">
            Personalized picks and companion chat tuned to your played library.
          </p>
        </div>

        <button
          type="button"
          className="gv-btn gv-btn-sm"
          onClick={() => setOnboardingOpen(true)}
        >
          <Cpu size={14} aria-hidden="true" />
          Taste &amp; Rig Setup
        </button>
      </div>

      {/* Editorial Underline Subnav */}
      <div className="gv-oracle-subnav">
        <Tabs
          layoutIdPrefix="gv-oracle"
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: "picks", label: "Picks" },
            { id: "chat", label: "Game Companion" }
          ]}
        />
      </div>

      {/* TAB 1: PICKS */}
      {activeTab === "picks" && (
        <>
          {/* Compact Single-Row Control Bar (Mirrors CinemaVault Film Oracle) */}
          <div className="gv-oracle-toolbar">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="gv-section-title">Recommended for You</h2>
              {source && (
                <span className={`gv-pill ${source === "gemini-deep" ? "gv-pill-match" : ""}`}>
                  {source === "gemini-deep"
                    ? "Hydrogen Deep Curated"
                    : source === "gemini"
                      ? "AI Curated · Flash Lite"
                      : source === "backlog-ml"
                        ? "From Backlog"
                        : "On-Device Taste Model"}
                </span>
              )}
            </div>

            <div className="gv-oracle-toolbar-controls">
              <Select
                value={selectedMood}
                onChange={(nextMood) => {
                  setSelectedMood(nextMood);
                  if (played.length > 0) {
                    handleGenerate({ refresh: false, useGemini: false, moodOverride: nextMood });
                  }
                }}
                options={MOOD_SELECT_OPTIONS}
                ariaLabel="Mood or gameplay vibe"
                size="sm"
              />

              <Select
                value={platformFamily}
                onChange={(nextPlatform) => {
                  setPlatformFamily(nextPlatform);
                  if (played.length > 0) {
                    handleGenerate({ refresh: false, useGemini: false, platformOverride: nextPlatform });
                  }
                }}
                options={PLATFORM_OPTIONS}
                ariaLabel="Platform focus"
                size="sm"
              />

              <button
                type="button"
                className={`gv-btn gv-btn-sm ${promptOpen || customVibe.trim() ? "gv-btn-accent" : ""}`}
                onClick={() => setPromptOpen((v) => !v)}
              >
                <SlidersHorizontal size={13} aria-hidden="true" />
                Vibe Request
              </button>

              {backlog.length > 0 && (
                <button
                  type="button"
                  className="gv-btn gv-btn-sm"
                  onClick={handleBacklogTonight}
                  title="Rank your Backlog for tonight"
                >
                  <Bookmark size={13} aria-hidden="true" />
                  Backlog ({backlog.length})
                </button>
              )}

              <button
                type="button"
                disabled={loading || deepLoading || modelsLoading || played.length === 0}
                className="gv-btn gv-btn-sm gv-btn-primary"
                onClick={() => handleGenerate({ refresh: picks.length > 0, useGemini: true, curationMode: "standard" })}
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden="true" />
                {loading ? "Curating..." : picks.length > 0 ? "Refresh" : "Curate Picks"}
              </button>

              <button
                type="button"
                disabled={loading || deepLoading || modelsLoading || played.length === 0}
                className="gv-btn gv-btn-sm gv-btn-accent"
                onClick={() => handleGenerate({ refresh: false, useGemini: true, curationMode: "deep" })}
                title="Deep taste curation with Gemini 4 Hydrogen (High Thinking)"
              >
                <Sparkles size={13} className={deepLoading ? "animate-pulse" : ""} aria-hidden="true" />
                {deepLoading ? "Thinking deeply..." : "More Accurate Picks"}
              </button>
            </div>
          </div>

          {/* Collapsible Optional Vibe Prompt */}
          {promptOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleGenerate({ refresh: false, useGemini: true });
              }}
              className="gv-oracle-prompt-bar"
            >
              <input
                type="text"
                value={customVibe}
                onChange={(e) => setCustomVibe(e.target.value)}
                placeholder="e.g. atmospheric dark fantasy under 25 hours, or tactical roguelike..."
                className="gv-input flex-1 min-w-[20rem]"
                aria-label="Optional specific request"
              />
              <button
                type="submit"
                disabled={loading || played.length === 0}
                className="gv-btn gv-btn-sm gv-btn-primary"
              >
                <Sparkles size={13} aria-hidden="true" />
                Curate with AI
              </button>
            </form>
          )}

          {/* Sleek Collapsed Live Taste Tuner */}
          <GameTasteTunerBar value={tuner} onChange={setTuner} />

          {deepLoading && (
            <div
              className="mt-4 px-4 py-3 rounded-lg border flex items-center gap-3 text-[1.28rem]"
              style={{
                background: "var(--gv-accent-dim)",
                borderColor: "var(--gv-accent-border)",
                color: "var(--gv-accent)"
              }}
            >
              <Sparkles size={15} className="animate-pulse shrink-0" aria-hidden="true" />
              <span>
                Gemini 4 Hydrogen (High Thinking) is analyzing your vault &amp; 55 candidates — current picks stay ready below.
              </span>
            </div>
          )}

          {deepNotice && !deepLoading && (
            <p className="text-[1.25rem] text-text-3 mt-3">{deepNotice}</p>
          )}

          {error && <p className="text-[1.35rem] text-danger mt-4">{error}</p>}

          {played.length === 0 ? (
            <div className="gv-panel text-center py-12 mt-4">
              <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">Log at least 1 game first</h3>
              <p className="text-[1.35rem] text-text-3 mb-5">
                Rate a few games on Discover or import your library so Game Oracle learns your taste.
              </p>
              <Link to="/games" className="gv-btn gv-btn-primary">
                Go to Discover
              </Link>
            </div>
          ) : loading && picks.length === 0 ? (
            <div className="gv-skeleton mt-5" style={{ height: "28rem" }} />
          ) : (
            <>
              {/* #1 Top Pick Spotlight */}
              {spotlight && (
                <section className="gv-oracle-spotlight" aria-label="Top Pick Tonight">
                  {(spotlight.backdropUrl || spotlight.coverUrl) && (
                    <img src={spotlight.backdropUrl || spotlight.coverUrl} alt="" className="gv-oracle-spotlight-bg" />
                  )}
                  <div className="gv-oracle-spotlight-inner">
                    <Link to={`/game/${spotlight.igdbId}`}>
                      <img src={spotlight.coverUrl} alt={spotlight.title} className="gv-oracle-spotlight-cover" />
                    </Link>
                    <div className="flex flex-col gap-3 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="gv-pill gv-pill-accent">#1 Top Pick</span>
                        <span className="gv-badge-match tabular-num">
                          {spotlight.matchScore}% Match
                          {spotlight.estRating ? ` · Est. ${spotlight.estRating.toFixed(1)}` : ""}
                        </span>
                        {spotlight.year && <span className="gv-pill tabular-num">{spotlight.year}</span>}
                        {spotlight.rating10 && <span className="gv-pill">IGDB {spotlight.rating10.toFixed(1)}</span>}
                      </div>

                      <Link
                        to={`/game/${spotlight.igdbId}`}
                        className="gv-hero-title"
                        style={{ fontSize: "clamp(2.2rem, 3vw, 3.2rem)", textDecoration: "none" }}
                      >
                        {spotlight.title}
                      </Link>

                      {spotlight.anchorTitles?.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-[1.22rem] text-text-3">
                          <span>Because you rated</span>
                          {spotlight.anchorTitles.map((t) => {
                            const aid = playedByTitle.get(t.toLowerCase());
                            return aid ? (
                              <Link key={t} to={`/game/${aid}`} className="gv-pill" style={{ textDecoration: "none" }}>
                                {t}
                              </Link>
                            ) : (
                              <span key={t} className="text-text-1 font-medium">{t}</span>
                            );
                          })}
                        </div>
                      )}

                      <p className="text-[1.42rem] leading-relaxed text-text-2">{spotlight.pitch}</p>

                      <div className="flex flex-wrap gap-2.5 mt-1">
                        <Link to={`/game/${spotlight.igdbId}`} className="gv-btn gv-btn-primary gv-btn-sm">
                          View Details
                        </Link>
                        {!playedById.has(spotlight.igdbId) && (
                          <button
                            type="button"
                            className="gv-btn gv-btn-sm"
                            onClick={(e) => {
                              if (!backlogIds.has(spotlight.igdbId) && spotlight.coverUrl) {
                                flyToVault(e.currentTarget, spotlight.coverUrl);
                              }
                              toggleBacklogGame(spotlight);
                            }}
                          >
                            {backlogIds.has(spotlight.igdbId) ? <Check size={13} /> : <Bookmark size={13} />}
                            {backlogIds.has(spotlight.igdbId) ? "In Backlog" : "Backlog"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="gv-btn gv-btn-sm"
                          onClick={() => setRateTarget({ ...spotlight, ...(playedById.get(spotlight.igdbId) || {}) })}
                        >
                          <Star size={13} /> Rate
                        </button>
                        <button
                          type="button"
                          className="gv-btn gv-btn-sm gv-btn-ghost"
                          onClick={() => handleDismissPick(spotlight.igdbId)}
                        >
                          <ThumbsDown size={13} /> Not for me
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* #2-#12 Editorial 2-Column Picks Grid */}
              {gridPicks.length > 0 && (
                <div className="gv-oracle-grid">
                  <AnimatePresence mode="popLayout">
                    {gridPicks.map((pick, idx) => {
                      const logged = playedById.get(pick.igdbId);
                      const inBacklog = backlogIds.has(pick.igdbId);
                      return (
                        <motion.article
                          key={pick.igdbId}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.24, delay: Math.min(idx * 0.03, 0.2), ease: EASE }}
                          className="gv-oracle-card"
                        >
                          <Link to={`/game/${pick.igdbId}`}>
                            <img src={pick.coverUrl} alt={pick.title} className="gv-oracle-cover" loading="lazy" />
                          </Link>
                          <div className="flex flex-col min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="text-[1.15rem] font-bold text-text-3 tabular-num">
                                #{String(idx + 2).padStart(2, "0")}
                              </span>
                              <span className="gv-badge-match tabular-num">{pick.matchScore}% Match</span>
                              {pick.year && <span className="text-[1.2rem] text-text-3 tabular-num">{pick.year}</span>}
                            </div>
                            <Link to={`/game/${pick.igdbId}`} className="gv-card-title" style={{ fontSize: "1.6rem" }}>
                              {pick.title}
                            </Link>
                            {pick.anchorTitles?.length > 0 && (
                              <div className="text-[1.18rem] mt-1 truncate" style={{ color: "var(--gv-accent)" }}>
                                Because you liked {pick.anchorTitles.join(" & ")}
                              </div>
                            )}
                            <p className="gv-oracle-pitch">{pick.pitch}</p>
                            <div className="flex flex-wrap gap-2 mt-auto pt-1">
                              <button
                                type="button"
                                className={`gv-btn gv-btn-sm ${logged ? "gv-btn-accent" : ""}`}
                                onClick={() => setRateTarget({ ...pick, ...(logged || {}) })}
                              >
                                <Star size={13} /> {logged ? `${logged.userRating}/10` : "Rate"}
                              </button>
                              {!logged && (
                                <button
                                  type="button"
                                  className="gv-btn gv-btn-sm"
                                  onClick={(e) => {
                                    if (!inBacklog && pick.coverUrl) flyToVault(e.currentTarget, pick.coverUrl);
                                    toggleBacklogGame(pick);
                                  }}
                                >
                                  {inBacklog ? <Check size={13} /> : <Bookmark size={13} />}
                                  {inBacklog ? "Saved" : "Backlog"}
                                </button>
                              )}
                              <button
                                type="button"
                                className="gv-btn gv-btn-sm gv-btn-ghost"
                                onClick={() => handleDismissPick(pick.igdbId)}
                                title="Not for me"
                                aria-label={`Dismiss ${pick.title}`}
                              >
                                <ThumbsDown size={13} />
                              </button>
                            </div>
                          </div>
                        </motion.article>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* TAB 2: GAME COMPANION CHAT */}
      {activeTab === "chat" && (
        <div className="gv-chat-shell">
          {pinnedGame && (
            <div className="gv-panel flex flex-wrap items-center justify-between gap-3" style={{ marginBottom: 0, padding: "1.2rem 1.5rem" }}>
              <div className="flex items-center gap-3 min-w-0">
                {pinnedGame.coverUrl && (
                  <img
                    src={pinnedGame.coverUrl}
                    alt={pinnedGame.title}
                    style={{ width: "3.6rem", height: "4.8rem", objectFit: "cover", borderRadius: "5px" }}
                  />
                )}
                <div className="min-w-0">
                  <span className="gv-eyebrow" style={{ marginBottom: 0 }}>Discussing Pinned Game</span>
                  <div className="text-[1.5rem] font-semibold text-text-1 truncate">{pinnedGame.title}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`gv-chip gv-chip-sm ${allowSpoilers ? "is-active" : ""}`}
                  onClick={() => setAllowSpoilers((v) => !v)}
                >
                  <Shield size={12} style={{ display: "inline", marginRight: "0.35rem" }} />
                  {allowSpoilers ? "Spoilers On" : "Spoiler-Safe"}
                </button>
                <button
                  type="button"
                  className="gv-btn gv-btn-sm"
                  onClick={() => {
                    setPinnedGame(null);
                    setSearchParams({ tab: "chat" });
                  }}
                  aria-label="Unpin game"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="gv-chat-feed">
            {chatMessages.length === 0 ? (
              <div className="my-auto text-center py-6">
                <MessageSquare size={30} className="mx-auto mb-3 opacity-80" style={{ color: "var(--gv-accent)" }} />
                <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">
                  {pinnedGame ? `Ask anything about ${pinnedGame.title}` : "Ask Game Companion"}
                </h3>
                <p className="text-[1.3rem] text-text-3 mb-5">
                  Grounded in your {played.length} logged game(s) &amp; {backlog.length} backlog title(s). Spoiler-safe by default.
                </p>
                <div className="gv-chip-group justify-center">
                  {(pinnedGame
                    ? [
                        `Is ${pinnedGame.title} worth playing based on my vault?`,
                        `How long does ${pinnedGame.title} take and how difficult is it?`,
                        `What games feel closest to ${pinnedGame.title}?`
                      ]
                    : CHAT_STARTERS
                  ).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="gv-chip gv-chip-sm"
                      onClick={(e) => handleSendChat(e, prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className={`gv-chat-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}`}
                >
                  {msg.text}
                </motion.div>
              ))
            )}
            {chatBusy && <div className="gv-chat-bubble is-assistant opacity-70">Thinking...</div>}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendChat} className="flex gap-3">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={pinnedGame ? `Ask about ${pinnedGame.title}...` : "Ask about builds, length, difficulty, or what to play next..."}
              className="gv-input flex-1"
            />
            <button type="submit" disabled={chatBusy || !chatInput.trim()} className="gv-btn gv-btn-primary">
              <Send size={15} /> Ask
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
