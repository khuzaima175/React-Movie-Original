import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bookmark,
  Check,
  Compass,
  MessageSquare,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Star,
  ThumbsDown,
  X
} from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { GAME_PLATFORM_FAMILIES, fetchGameDetails, fetchGamesBatch } from "../services/igdbService";
import {
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
import ScrollRevealSection from "../../components/ScrollRevealSection";
import { flyToVault } from "../../services/flyToVault";
import { EASE, springSnappy } from "../../motion";

const PLATFORM_OPTIONS = GAME_PLATFORM_FAMILIES.map((pf) => ({
  value: pf.id,
  label: pf.label
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
    setRateTarget,
    toggleBacklogGame
  } = useGameVault();

  const initialTab = searchParams.get("tab") === "chat" ? "chat" : "picks";
  const pinnedGameIdParam = Number(searchParams.get("game") || 0);

  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedMood, setSelectedMood] = useState("any");
  const [customVibe, setCustomVibe] = useState("");
  const [platformFamily, setPlatformFamily] = useState(() => getDefaultPlatformFocus(rigProfile));
  const [picks, setPicks] = useState([]);
  const [shownIds, setShownIds] = useState(() => new Set());
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  async function handleGenerate(e, { refresh = false } = {}) {
    e?.preventDefault?.();
    if (played.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const { allIds, maps } = buildGameRecommendationIds(played, backlog, models, {
        warmLimit: 70,
        coldLimit: 26,
        excludeBacklog: false
      });
      const hydrated = await fetchGamesBatch(allIds);
      let deduped = filterDuplicateGameEditions(hydrated, played);
      if (rigProfile?.completed && rigProfile?.respectRigLimits) {
        const rigFiltered = deduped.filter((g) => isGameCompatibleWithRig(g, rigProfile).compatible);
        if (rigFiltered.length >= 12) deduped = rigFiltered;
      }
      const excludeList = [...dismissedIds, ...(refresh ? [...shownIds] : [])];
      const ranked = rankGameCandidates(deduped, played, backlog, models, maps);
      const moodObj = GAME_ORACLE_MOODS.find((m) => m.id === selectedMood);
      const vibe = [moodObj?.prompt, customVibe.trim()].filter(Boolean).join(". ");

      const result = await curateGamesWithOracle({
        played,
        candidates: ranked,
        vibe,
        platformFamily,
        count: 12,
        excludeIds: excludeList,
        useGemini: true
      });
      setPicks(result.picks);
      setSource(result.source);
      setShownIds((prev) => new Set([...prev, ...result.picks.map((p) => p.igdbId)]));
    } catch {
      setError("Could not generate recommendations right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleBacklogTonight() {
    if (backlog.length === 0) return;
    const ranked = rankBacklogForNextPlay(backlog, played, models);
    setPicks(
      ranked.slice(0, 12).map((g) => ({
        ...g,
        anchorTitles: played.slice(0, 2).map((p) => p.title),
        pitch:
          g.summary?.slice(0, 165) ||
          "Ranked directly from your personal Backlog queue using EASE^R + 128-D neural taste matching."
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
          text: "Could not reach Gemini right now. Your local ML Discover & Explore tools still work 100% offline."
        }
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  const spotlight = picks[0] || null;
  const gridPicks = picks.slice(1);

  return (
    <div className="gv-page page-rail">
      <ScrollRevealSection className="gv-section-header">
        <div>
          <span className="gv-kicker">
            <Compass size={13} /> Local ML + Editorial AI Curation
          </span>
          <h1 className="gv-hero-title" style={{ fontSize: "clamp(2.4rem, 3.6vw, 3.6rem)" }}>
            Game Oracle
          </h1>
          <p className="gv-section-sub">
            Your local EASE^R + Spectral-EASE + BGE-large models lock the mathematical match %; Gemini curates the pitch.
          </p>
        </div>

        {/* Sliding Dual-Tab Switcher: Curated Picks | Game Companion */}
        <div className="flex flex-wrap items-center gap-3">
          {source && activeTab === "picks" && (
            <span className="gv-pill gv-pill-match">
              <Sparkles size={13} />
              {source === "gemini"
                ? "Local ML + Gemini Curated"
                : source === "backlog-ml"
                  ? "Backlog Ranked ($0.00 ML)"
                  : "Local ML Engine (Offline)"}
            </span>
          )}
          <div className="gv-segmented-bar" role="tablist" aria-label="Oracle mode">
            {[
              { id: "picks", label: "Curated Picks", icon: Sparkles },
              { id: "chat", label: "Game Companion", icon: MessageSquare }
            ].map((t) => {
              const active = activeTab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`gv-segmented-btn ${active ? "is-active" : ""}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  {active && (
                    <motion.span layoutId="gv-oracle-tab-pill" className="gv-segmented-bg" transition={springSnappy} />
                  )}
                  <span className="gv-segmented-label">
                    <Icon size={13} aria-hidden="true" />
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </ScrollRevealSection>

      {/* TAB 1: CURATED PICKS */}
      {activeTab === "picks" && (
        <>
          <ScrollRevealSection as="div" delay={0.04}>
            <form onSubmit={(e) => handleGenerate(e, { refresh: false })} className="gv-panel flex flex-col gap-5">
              <div>
                <label className="block text-[1.2rem] font-semibold text-text-2 mb-2.5">
                  Pick a Mood or Gameplay Vibe
                </label>
                <div className="gv-chip-group">
                  {GAME_ORACLE_MOODS.map((m) => {
                    const active = selectedMood === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`gv-chip ${active ? "is-active" : ""}`}
                        onClick={() => setSelectedMood(m.id)}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="md:col-span-2">
                  <label htmlFor="gv-vibe-input" className="block text-[1.2rem] font-semibold text-text-2 mb-2">
                    Optional Specific Request
                  </label>
                  <input
                    id="gv-vibe-input"
                    type="text"
                    value={customVibe}
                    onChange={(e) => setCustomVibe(e.target.value)}
                    placeholder="e.g. atmospheric dark fantasy under 25 hours, or tactical roguelike for Steam Deck..."
                    className="gv-input"
                  />
                </div>
                <div>
                  <span className="block text-[1.2rem] font-semibold text-text-2 mb-2">Platform Focus</span>
                  <Select
                    value={platformFamily}
                    onChange={setPlatformFamily}
                    options={PLATFORM_OPTIONS}
                    ariaLabel="Platform Focus"
                    fullWidth
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={loading || modelsLoading || played.length === 0}
                  className="gv-btn gv-btn-primary"
                >
                  <Sparkles size={15} />
                  {loading ? "Consulting Local Models & Oracle..." : "Generate 12 Personalized Picks"}
                </button>

                {picks.length > 0 && (
                  <button
                    type="button"
                    disabled={loading}
                    className="gv-btn"
                    onClick={(e) => handleGenerate(e, { refresh: true })}
                  >
                    <RefreshCw size={14} /> Refresh New Batch
                  </button>
                )}

                {backlog.length > 0 && (
                  <button
                    type="button"
                    className="gv-btn"
                    onClick={handleBacklogTonight}
                    title="Rank your own Backlog queue instantaneously ($0.00 AI)"
                  >
                    <Bookmark size={14} /> Pick From My Backlog ({backlog.length})
                  </button>
                )}

                {played.length === 0 && (
                  <span className="text-[1.3rem] text-text-3">
                    Log at least 1 game on <Link to="/games" className="text-accent underline">Discover</Link> first.
                  </span>
                )}
              </div>
            </form>
          </ScrollRevealSection>

          {error && <p className="text-[1.4rem] text-danger mb-6">{error}</p>}

          {/* #01 Top Pick Full-Bleed Spotlight Hero */}
          {spotlight && (
            <ScrollRevealSection className="gv-oracle-spotlight" delay={0.05}>
              {(spotlight.backdropUrl || spotlight.coverUrl) && (
                <img src={spotlight.backdropUrl || spotlight.coverUrl} alt="" className="gv-oracle-spotlight-bg" />
              )}
              <div className="gv-oracle-spotlight-inner">
                <Link to={`/game/${spotlight.igdbId}`}>
                  <img src={spotlight.coverUrl} alt={spotlight.title} className="gv-oracle-spotlight-cover" />
                </Link>
                <div className="flex flex-col gap-3 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="gv-pill gv-pill-accent">#01 Top Pick Tonight</span>
                    <span className="gv-badge-match tabular-num">
                      {spotlight.matchScore}% Match
                      {spotlight.estRating ? ` · Est. ${spotlight.estRating.toFixed(1)}` : ""}
                    </span>
                    {spotlight.year && <span className="gv-pill tabular-num">{spotlight.year}</span>}
                    {spotlight.rating10 && <span className="gv-pill">IGDB {spotlight.rating10.toFixed(1)}</span>}
                  </div>
                  <Link to={`/game/${spotlight.igdbId}`} className="gv-hero-title" style={{ fontSize: "clamp(2.2rem, 3vw, 3.2rem)", textDecoration: "none" }}>
                    {spotlight.title}
                  </Link>
                  {spotlight.anchorTitles?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-[1.22rem] text-text-3">
                      <span>Because you loved</span>
                      {spotlight.anchorTitles.map((t) => {
                        const aid = playedByTitle.get(t.toLowerCase());
                        return aid ? (
                          <Link key={t} to={`/game/${aid}`} className="gv-pill gv-pill-accent" style={{ textDecoration: "none" }}>
                            {t}
                          </Link>
                        ) : (
                          <span key={t} className="text-accent font-medium">{t}</span>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[1.45rem] leading-relaxed text-text-2">{spotlight.pitch}</p>
                  <div className="flex flex-wrap gap-2.5 mt-1">
                    <Link to={`/game/${spotlight.igdbId}`} className="gv-btn gv-btn-primary gv-btn-sm">
                      Inspect Dossier
                    </Link>
                    <button
                      type="button"
                      className="gv-btn gv-btn-sm"
                      onClick={() => setRateTarget({ ...spotlight, ...(playedById.get(spotlight.igdbId) || {}) })}
                    >
                      <Star size={13} /> Rate
                    </button>
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
                        {backlogIds.has(spotlight.igdbId) ? "Saved" : "Backlog"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="gv-btn gv-btn-sm"
                      onClick={() => handleDismissPick(spotlight.igdbId)}
                      title="Hide this recommendation"
                    >
                      <ThumbsDown size={13} /> Not for me
                    </button>
                  </div>
                </div>
              </div>
            </ScrollRevealSection>
          )}

          {/* #02-#12 Animated 2-Column Editorial Grid */}
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
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                      transition={{ duration: 0.3, delay: Math.min(idx, 10) * 0.04, ease: EASE }}
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
                          {pick.isColdStart && <span className="gv-pill">Cold-Start AI</span>}
                          {pick.year && <span className="text-[1.2rem] text-text-3 tabular-num">{pick.year}</span>}
                        </div>
                        <Link to={`/game/${pick.igdbId}`} className="gv-card-title" style={{ fontSize: "1.65rem" }}>
                          {pick.title}
                        </Link>
                        {pick.anchorTitles?.length > 0 && (
                          <div className="text-[1.18rem] text-accent mt-1 truncate">
                            Because you loved {pick.anchorTitles.join(" & ")}
                          </div>
                        )}
                        <p className="gv-oracle-pitch">{pick.pitch}</p>
                        <div className="gv-card-reasons mb-3">
                          {(pick.matchReasons || []).slice(0, 2).map((r) => (
                            <span key={r} className="gv-reason-chip">{r}</span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-auto">
                          <button
                            type="button"
                            className={`gv-btn gv-btn-sm ${logged ? "gv-btn-primary" : ""}`}
                            onClick={() => setRateTarget({ ...pick, ...(logged || {}) })}
                          >
                            <Star size={13} /> {logged ? `Rated ${logged.userRating}/10` : "Rate"}
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
                            className="gv-btn gv-btn-sm"
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

      {/* TAB 2: GAME COMPANION CHAT */}
      {activeTab === "chat" && (
        <ScrollRevealSection className="gv-chat-shell">
          {pinnedGame && (
            <div className="gv-panel flex flex-wrap items-center justify-between gap-3" style={{ marginBottom: 0, padding: "1.2rem 1.6rem" }}>
              <div className="flex items-center gap-3 min-w-0">
                {pinnedGame.coverUrl && (
                  <img
                    src={pinnedGame.coverUrl}
                    alt={pinnedGame.title}
                    style={{ width: "3.6rem", height: "4.8rem", objectFit: "cover", borderRadius: "5px" }}
                  />
                )}
                <div className="min-w-0">
                  <div className="gv-kicker">Discussing Pinned Game</div>
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
                  {allowSpoilers ? "Spoilers Allowed" : "Spoiler-Safe On"}
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
                <MessageSquare size={32} className="mx-auto mb-3 text-accent opacity-80" />
                <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">
                  {pinnedGame ? `Ask anything about ${pinnedGame.title}` : "Ask GameVault Companion"}
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
              placeholder={pinnedGame ? `Ask about ${pinnedGame.title}...` : "Ask about builds, play length, boss difficulty, or what to play next..."}
              className="gv-input flex-1"
            />
            <button type="submit" disabled={chatBusy || !chatInput.trim()} className="gv-btn gv-btn-primary">
              <Send size={15} /> Ask
            </button>
          </form>
        </ScrollRevealSection>
      )}
    </div>
  );
}
