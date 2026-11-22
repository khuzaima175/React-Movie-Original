import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useApp } from "../context/AppContext";
import { sendChatMessage } from "../services/geminiChatService";
import { buildMovieChatStarterPrompts } from "../services/filmChatService";
import {
  parseMovieCardsFromText,
  parseChatMessageBlocks,
  buildCompanionStarterPrompts,
  buildCompanionFollowUpPrompts,
  partitionChatMovieCards
} from "../services/chatCardHelpers";
import { findMatchingMovie } from "../services/movieIdentity";
import { getCanonicalMovieKey } from "../services/vaultSyncService";
import { fetchOmdbJson, hasUserGeminiKey } from "../services/apiTransport";
import { isDebugUiEnabled } from "../services/debugFlags";
import GeminiKeyModal from "./GeminiKeyModal";
import {
  getFallbackPoster,
  generateFallbackId,
  FAST_INTERACTIVE_CASCADE,
  formatModelDisplayName,
  getLastModelInfo,
  getPreferredCascadeModel
} from "../services/geminiService";
import PosterImage from "./PosterImage";
import {
  Sparkles,
  Send,
  User,
  Star,
  Plus,
  Check,
  Cpu,
  ShieldCheck,
  Eye,
  X,
  ExternalLink,
  KeyRound,
  RotateCcw,
  Film,
  ArrowUpRight
} from "lucide-react";

const inlineMovieCache = new Map();

function InlineMovieCard({ title, year, watched = [], watchlist = [] }) {
  const { addToWatchlist } = useApp();
  const [movieData, setMovieData] = useState(null);
  const [isAdding, setIsAdding] = useState(false);

  const probeCandidate = useMemo(
    () => ({
      title,
      year,
      imdbID: movieData?.imdbID || null
    }),
    [title, year, movieData?.imdbID]
  );

  const watchedMatch = useMemo(
    () => findMatchingMovie(watched, probeCandidate),
    [watched, probeCandidate]
  );

  const watchlistMatch = useMemo(
    () => findMatchingMovie(watchlist, probeCandidate),
    [watchlist, probeCandidate]
  );

  useEffect(() => {
    const cleanTitle = title.replace(/^["']|["']$/g, "").trim();
    const cacheKey = `${cleanTitle.toLowerCase()}::${year || "noyear"}`;

    if (inlineMovieCache.has(cacheKey)) {
      setMovieData(inlineMovieCache.get(cacheKey));
      return;
    }

    const controller = new AbortController();

    async function fetchDetails() {
      try {
        const data = await fetchOmdbJson(
          { t: cleanTitle, ...(year ? { y: year } : {}) },
          { signal: controller.signal }
        );
        if (!controller.signal.aborted && data?.Response === "True") {
          inlineMovieCache.set(cacheKey, data);
          setMovieData(data);
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Inline movie fetch failed:", err);
        }
      }
    }

    fetchDetails();

    return () => {
      controller.abort();
    };
  }, [title, year]);

  const routeId =
    movieData?.imdbID ||
    watchedMatch?.imdbID ||
    watchlistMatch?.imdbID ||
    (watchedMatch?.tmdbId ? `tmdb_${watchedMatch.tmdbId}` : null) ||
    (watchlistMatch?.tmdbId ? `tmdb_${watchlistMatch.tmdbId}` : null);
  const detailPath = routeId ? `/movie/${encodeURIComponent(routeId)}` : null;

  const handleAdd = () => {
    if (watchedMatch || watchlistMatch || isAdding) return;
    setIsAdding(true);
    const movieObj = {
      imdbID: movieData?.imdbID || generateFallbackId(title, year),
      title: movieData?.Title || title,
      year: movieData?.Year || year || "N/A",
      poster:
        movieData?.Poster && movieData.Poster !== "N/A"
          ? movieData.Poster
          : getFallbackPoster(title),
      runtime: movieData?.Runtime || "N/A",
      genre: movieData?.Genre || "",
      imdbRating: movieData?.imdbRating || "N/A",
      userRating: 0
    };
    addToWatchlist(movieObj);
    setTimeout(() => setIsAdding(false), 350);
  };

  const posterContent = (
    <PosterImage
      src={movieData?.Poster || watchedMatch?.poster || watchlistMatch?.poster}
      title={movieData?.Title || title}
      className="inline-poster-img"
    />
  );

  const ratingScore = Number(watchedMatch?.userRating);

  return (
    <div className="chat-inline-movie-card">
      {detailPath ? (
        <Link to={detailPath} className="inline-poster-wrapper inline-poster-link" aria-label={`Open ${movieData?.Title || title}`}>
          {posterContent}
        </Link>
      ) : (
        <div className="inline-poster-wrapper">{posterContent}</div>
      )}

      <div className="inline-info">
        {detailPath ? (
          <Link to={detailPath} className="inline-title-link">
            <h5 className="inline-title">{movieData?.Title || title}</h5>
            <ArrowUpRight size={13} className="inline-title-arrow" aria-hidden="true" />
          </Link>
        ) : (
          <h5 className="inline-title">{movieData?.Title || title}</h5>
        )}

        <span className="inline-meta">
          {movieData?.Year || year || "N/A"}{" "}
          {movieData?.Genre ? `• ${movieData.Genre.split(",")[0].trim()}` : ""}
        </span>

        {movieData?.imdbRating && movieData.imdbRating !== "N/A" && (
          <div className="inline-rating">
            <Star size={12} fill="currentColor" aria-hidden="true" />
            <span>{movieData.imdbRating}</span>
          </div>
        )}
      </div>

      {watchedMatch ? (
        <span className="inline-vault-badge" title="Already in your Watched Vault">
          <Star size={12} fill="currentColor" aria-hidden="true" />
          <span>{Number.isFinite(ratingScore) && ratingScore > 0 ? `${Math.round(ratingScore)}/10` : "Watched"}</span>
        </span>
      ) : (
        <button
          type="button"
          className={`btn-inline-add ${watchlistMatch ? "added" : ""}`}
          onClick={handleAdd}
          disabled={Boolean(watchlistMatch) || isAdding}
        >
          {watchlistMatch ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          <span>{watchlistMatch ? "In Watchlist" : "Watchlist"}</span>
        </button>
      )}
    </div>
  );
}

// Convert basic **bold** and *italic* markers cleanly without HTML injection
function renderInlineSegments(text) {
  if (!text) return null;
  const parts = String(text).split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function ChatMessageBody({ text }) {
  const blocks = useMemo(() => parseChatMessageBlocks(text), [text]);
  if (blocks.length === 0) {
    return <p className="bubble-text">{renderInlineSegments(text)}</p>;
  }

  return (
    <div className="chat-md-blocks">
      {blocks.map((block, idx) => {
        if (block.type === "heading") {
          return (
            <h4 key={idx} className="chat-md-heading">
              {renderInlineSegments(block.text)}
            </h4>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={idx} className="chat-md-list is-ordered">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInlineSegments(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={idx} className="chat-md-list">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInlineSegments(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx} className="bubble-text">
            {renderInlineSegments(block.text)}
          </p>
        );
      })}
    </div>
  );
}

const GENERAL_WELCOME_TEXT =
  "Ready when you are. Ask for unseen picks tuned to your Vault, have me choose from your Watchlist tonight, compare directors, or build a double feature.";

function buildThreadWelcomeMessage(focusedMovie, isWatched, spoilerSafe) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (!focusedMovie) {
    return { role: "model", text: GENERAL_WELCOME_TEXT, time };
  }

  const cleanYear = focusedMovie.year && focusedMovie.year !== "N/A" ? ` (${focusedMovie.year})` : "";
  const titleLabel = `**${focusedMovie.title || "this film"}**${cleanYear}`;
  const ratedNum = Number(focusedMovie.vaultEntry?.userRating ?? focusedMovie.userRating);
  const ratedSuffix =
    isWatched && Number.isFinite(ratedNum) && ratedNum > 0
      ? ` — rated **${Math.round(ratedNum)}/10** in your Vault`
      : "";

  const spoilerClause = spoilerSafe
    ? "Spoiler-Safe mode is ON: major twists and endings stay hidden unless you toggle spoilers on."
    : "Spoilers are allowed: ask freely about the ending, themes, craft, or next watches.";

  return {
    role: "model",
    text: `Focused on ${titleLabel}${ratedSuffix}. ${spoilerClause}`,
    time
  };
}

export default function AIChat({
  watched = [],
  watchlist: watchlistProp = null,
  focusKey = null,
  focusedMovie = null,
  onClearFocusedMovie = null
}) {
  const {
    watchlist: contextWatchlist,
    tasteRules,
    aiFeedbackLog,
    userRegion,
    userWatchProviders
  } = useApp();
  const activeWatchlist = watchlistProp || contextWatchlist || [];
  const debug = isDebugUiEnabled();
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [usingOwnKey, setUsingOwnKey] = useState(() => hasUserGeminiKey());

  const focusedKey = useMemo(() => {
    if (focusKey) return focusKey;
    if (!focusedMovie || typeof focusedMovie !== "object") return null;
    return (
      getCanonicalMovieKey(focusedMovie) ||
      focusedMovie.imdbID ||
      (focusedMovie.tmdbId ? `tmdb_${focusedMovie.tmdbId}` : focusedMovie.title || null)
    );
  }, [focusKey, focusedMovie]);

  const vaultEntry = useMemo(
    () => (focusedMovie ? findMatchingMovie(watched, focusedMovie) : null),
    [watched, focusedMovie]
  );

  const watchlistEntry = useMemo(
    () => (focusedMovie ? findMatchingMovie(activeWatchlist, focusedMovie) : null),
    [activeWatchlist, focusedMovie]
  );

  const focusedIsWatched = Boolean(vaultEntry || focusedMovie?.isWatched);
  const [spoilerPrefsByKey, setSpoilerPrefsByKey] = useState({});
  const spoilerSafe = focusedKey
    ? (spoilerPrefsByKey[focusedKey] ?? !focusedIsWatched)
    : true;

  const threadKey = focusedKey || "__general__";
  const [threadsByKey, setThreadsByKey] = useState({});

  const messages = useMemo(() => {
    if (Array.isArray(threadsByKey[threadKey]) && threadsByKey[threadKey].length > 0) {
      return threadsByKey[threadKey];
    }
    return [buildThreadWelcomeMessage(focusedMovie, focusedIsWatched, spoilerSafe)];
  }, [threadsByKey, threadKey, focusedMovie, focusedIsWatched, spoilerSafe]);

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeChatModelInfo, setActiveChatModelInfo] = useState(() => getLastModelInfo("fast"));
  const chatContainerRef = useRef(null);
  const composerRef = useRef(null);

  useEffect(() => {
    setError(false);
  }, [threadKey]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading, threadKey]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const activeStarterPrompts = useMemo(() => {
    if (focusedMovie) {
      const prompts = buildMovieChatStarterPrompts(focusedMovie, {
        isWatched: focusedIsWatched,
        spoilerSafe
      });
      if (prompts.length > 0) return prompts;
    }
    return buildCompanionStarterPrompts({
      watched,
      watchlist: activeWatchlist
    });
  }, [focusedMovie, focusedIsWatched, spoilerSafe, watched, activeWatchlist]);

  const followUpPrompts = useMemo(
    () =>
      buildCompanionFollowUpPrompts({
        watchedCount: watched.length,
        watchlistCount: activeWatchlist.length,
        hasFocusedMovie: Boolean(focusedMovie)
      }),
    [watched.length, activeWatchlist.length, focusedMovie]
  );

  const focusMovieRoute = useMemo(() => {
    if (!focusedMovie) return null;
    const routeId =
      focusedMovie.imdbID ||
      (focusedMovie.tmdbId ? `tmdb_${focusedMovie.tmdbId}` : null);
    return routeId ? `/movie/${encodeURIComponent(routeId)}` : null;
  }, [focusedMovie]);

  const activeRuleCount = useMemo(
    () => (Array.isArray(tasteRules) ? tasteRules.filter((r) => r && r.enabled !== false).length : 0),
    [tasteRules]
  );

  const handleToggleSpoilerSafe = () => {
    if (!focusedKey) return;
    setSpoilerPrefsByKey((prev) => ({
      ...prev,
      [focusedKey]: !spoilerSafe
    }));
  };

  const handleResetThread = () => {
    if (isLoading) return;
    setError(false);
    setThreadsByKey((prev) => {
      if (!prev[threadKey]) return prev;
      const next = { ...prev };
      delete next[threadKey];
      return next;
    });
  };

  const handleSendMessage = async (textToSend) => {
    const query = (textToSend ?? input).trim();
    if (!query || isLoading) return;

    if (!textToSend) setInput("");
    setError(false);

    const targetThreadKey = threadKey;
    const currentTime = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    const userMessageObj = { role: "user", text: query, time: currentTime };
    const seededMessages = [...messages, userMessageObj];

    setThreadsByKey((prev) => {
      const existing = prev[targetThreadKey];
      return {
        ...prev,
        [targetThreadKey]: existing ? [...existing, userMessageObj] : seededMessages
      };
    });
    setIsLoading(true);

    try {
      const prevSeq = getLastModelInfo("fast")?.seq || 0;
      const activeMoviePayload = focusedMovie
        ? {
            ...focusedMovie,
            isWatched: focusedIsWatched,
            isWatchlist: Boolean(watchlistEntry || focusedMovie.isWatchlist),
            userRating: vaultEntry?.userRating ?? focusedMovie.userRating ?? null,
            userNote: vaultEntry?.userNote ?? focusedMovie.userNote ?? "",
            vaultEntry: vaultEntry || focusedMovie.vaultEntry || null,
            watchlistEntry: watchlistEntry || focusedMovie.watchlistEntry || null
          }
        : null;

      const chatOptions = {
        watchlist: activeWatchlist,
        feedbackLog: aiFeedbackLog,
        userRegion: userRegion || "US",
        userWatchProviders: userWatchProviders || [],
        ...(focusedMovie ? { spoilerSafe } : {})
      };

      const responseText = await sendChatMessage(
        query,
        seededMessages.slice(1),
        watched,
        tasteRules,
        activeMoviePayload,
        chatOptions
      );
      const latestFast = getLastModelInfo("fast");
      const turnModelInfo = latestFast && latestFast.seq > prevSeq ? latestFast : null;
      if (turnModelInfo) {
        setActiveChatModelInfo(turnModelInfo);
      }

      const botReply = {
        role: "model",
        text: responseText,
        modelInfo: turnModelInfo,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      };

      setThreadsByKey((prev) => {
        const existing = prev[targetThreadKey] || seededMessages;
        return {
          ...prev,
          [targetThreadKey]: [...existing, botReply]
        };
      });
    } catch (err) {
      setError(true);
      const errReply = {
        role: "model",
        text: "Connection issue. Unable to consult the Oracle right now.",
        isError: true,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      };
      setThreadsByKey((prev) => {
        const existing = prev[targetThreadKey] || seededMessages;
        return {
          ...prev,
          [targetThreadKey]: [...existing, errReply]
        };
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleSendMessage();
  };

  const handleComposerKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const hasConversationTurns = messages.length > 1;

  return (
    <div className="ai-chat-wrapper">
      <div className="ai-chat-container">
        {/* Clean Editorial Workspace Header */}
        <div className="chat-companion-header">
          <div className="chat-context-strip">
            <Film size={14} className="chat-context-icon" aria-hidden="true" />
            <span className="chat-context-label">
              Tuned to <strong>{watched.length}</strong> rated
              {activeWatchlist.length > 0 ? <> · <strong>{activeWatchlist.length}</strong> queued</> : null}
              {userRegion ? <> · {userRegion === "GLOBAL" ? "All regions" : userRegion}</> : null}
              {activeRuleCount > 0 ? <> · {activeRuleCount} rules</> : null}
            </span>
          </div>

          <div className="chat-header-controls">
            <button
              type="button"
              onClick={() => setIsKeyModalOpen(true)}
              className={`chat-header-btn ${usingOwnKey ? "is-active" : ""}`}
            >
              <KeyRound size={12} aria-hidden="true" />
              <span>{usingOwnKey ? "Personal key" : "AI key"}</span>
            </button>

            {hasConversationTurns && (
              <button
                type="button"
                onClick={handleResetThread}
                disabled={isLoading}
                className="chat-header-btn"
                title="Start a fresh conversation thread"
              >
                <RotateCcw size={12} aria-hidden="true" />
                <span>New chat</span>
              </button>
            )}
          </div>
        </div>

        {debug && (
          <div
            className={`chat-model-bar ${activeChatModelInfo?.isFallback ? "fallback" : ""}`}
            title={
              activeChatModelInfo?.cooldownModels?.length
                ? `Skipped/Fallback from: ${activeChatModelInfo.cooldownModels.map((c) => `${c.model} (${c.reason})`).join(", ")}`
                : "Active Film Companion Gemini cascade model"
            }
          >
            <Cpu size={12} />
            <span>
              {activeChatModelInfo?.model
                ? `${activeChatModelInfo.isFallback ? "Fallback Model" : "Active Model"}: ${formatModelDisplayName(activeChatModelInfo.model)} (${activeChatModelInfo.model})`
                : (() => {
                    const queued = getPreferredCascadeModel(FAST_INTERACTIVE_CASCADE, "fast");
                    return queued
                      ? `Queued Model: ${formatModelDisplayName(queued)} (${queued})`
                      : "All Gemini models in cooldown";
                  })()}
            </span>
          </div>
        )}

        {/* Focused Film Context Bar */}
        {focusedMovie && (
          <div className="chat-focus-banner">
            <div className="chat-focus-film-info">
              <div className="chat-focus-poster-wrap">
                <PosterImage
                  src={focusedMovie.poster}
                  title={focusedMovie.title}
                  className="chat-focus-poster"
                />
              </div>
              <div className="chat-focus-meta">
                <div className="chat-focus-title-row">
                  {focusMovieRoute ? (
                    <Link to={focusMovieRoute} className="chat-focus-title-link">
                      <span>{focusedMovie.title}</span>
                      {focusedMovie.year && focusedMovie.year !== "N/A" && (
                        <span className="chat-focus-year">({focusedMovie.year})</span>
                      )}
                      <ExternalLink size={12} aria-hidden="true" />
                    </Link>
                  ) : (
                    <span className="chat-focus-title-text">
                      {focusedMovie.title}
                      {focusedMovie.year && focusedMovie.year !== "N/A" ? ` (${focusedMovie.year})` : ""}
                    </span>
                  )}

                  {focusedIsWatched && Number(vaultEntry?.userRating ?? focusedMovie.userRating) > 0 ? (
                    <span className="chat-focus-vault-pill is-rated">
                      ★ {Math.round(Number(vaultEntry?.userRating ?? focusedMovie.userRating))}/10
                    </span>
                  ) : watchlistEntry || focusedMovie.isWatchlist ? (
                    <span className="chat-focus-vault-pill">Queued in Watchlist</span>
                  ) : null}
                </div>

                {(focusedMovie.director || focusedMovie.genre) && (
                  <p className="chat-focus-subline">
                    {[
                      focusedMovie.director && focusedMovie.director !== "Unknown" && focusedMovie.director !== "N/A"
                        ? `Dir. ${focusedMovie.director}`
                        : null,
                      focusedMovie.genre
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>

            <div className="chat-focus-controls">
              <button
                type="button"
                className={`chat-spoiler-toggle ${spoilerSafe ? "is-safe" : "is-spoilers"}`}
                onClick={handleToggleSpoilerSafe}
                aria-pressed={spoilerSafe}
                title={
                  spoilerSafe
                    ? "Spoiler-Safe mode ON — click to allow ending/twist discussion"
                    : "Spoilers allowed — click to shield twists and endings"
                }
              >
                {spoilerSafe ? <ShieldCheck size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
                <span>{spoilerSafe ? "Spoiler-Safe: ON" : "Spoilers: Allowed"}</span>
              </button>

              {onClearFocusedMovie && (
                <button
                  type="button"
                  className="chat-clear-focus"
                  onClick={onClearFocusedMovie}
                  aria-label="Clear film focus and return to general chat"
                >
                  <X size={13} aria-hidden="true" />
                  <span>Clear Focus</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Messages list */}
        <div className="chat-messages" ref={chatContainerRef} aria-live="polite">
          {!hasConversationTurns && !isLoading ? (
            <motion.div
              key={`welcome-${threadKey}`}
              className="chat-welcome-stage"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="chat-welcome-emblem" aria-hidden="true">
                <Sparkles size={22} />
              </div>
              <h2 className="chat-welcome-title display-title">
                {focusedMovie ? `Discuss ${focusedMovie.title}` : "Film Companion"}
              </h2>
              <p className="chat-welcome-sub">
                {focusedMovie
                  ? `Ask about themes, craft, or similar watches (${spoilerSafe ? "spoiler-safe mode on" : "spoilers allowed"}).`
                  : `Grounded in your ${watched.length} rated ${watched.length === 1 ? "film" : "films"}${
                      activeWatchlist.length > 0 ? ` and ${activeWatchlist.length} queued watches` : ""
                    }.`}
              </p>
              <div className="chat-welcome-grid">
                {activeStarterPrompts.slice(0, 4).map((promptText, idx) => (
                  <button
                    type="button"
                    key={`${threadKey}-welcome-${idx}`}
                    className="chat-welcome-card"
                    onClick={() => handleSendMessage(promptText)}
                  >
                    <span className="chat-welcome-card-text">{promptText}</span>
                    <ArrowUpRight size={15} className="chat-welcome-card-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            messages.map((msg, index) => {
              const detectedMovies =
                msg.role === "model" ? parseMovieCardsFromText(msg.text, 24) : [];
              const { referenceChips, recommendedCards } =
                detectedMovies.length > 0
                  ? partitionChatMovieCards(detectedMovies, watched, activeWatchlist, 8)
                  : { referenceChips: [], recommendedCards: [] };

              return (
                <motion.div
                  key={index}
                  className={`chat-bubble-wrapper ${msg.role}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                  {msg.role === "model" && (
                    <div className="chat-avatar bot-avatar">
                      <Sparkles size={16} />
                    </div>
                  )}

                  <div className={`chat-bubble ${msg.role} ${msg.isError ? "error" : ""}`}>
                    {msg.role === "model" ? (
                      <ChatMessageBody text={msg.text} />
                    ) : (
                      <p className="bubble-text">{renderInlineSegments(msg.text)}</p>
                    )}

                    {/* Compact inline Vault chips for already-watched references */}
                    {referenceChips.length > 0 && (
                      <div className="chat-ref-chips-bar" aria-label="Referenced films from your Vault">
                        <span className="chat-ref-chips-label">From your Vault:</span>
                        {referenceChips.map((ref, refIdx) => {
                          const refId =
                            ref.imdbID || (ref.tmdbId ? `tmdb_${ref.tmdbId}` : ref.id || null);
                          const label = `${ref.title}${ref.userRating > 0 ? ` · ${Math.round(ref.userRating)}/10` : ""}`;
                          return refId ? (
                            <Link
                              key={`${ref.title}-${refIdx}`}
                              to={`/movie/${encodeURIComponent(refId)}`}
                              className="chat-ref-chip"
                            >
                              <Star size={11} fill="currentColor" aria-hidden="true" />
                              <span>{label}</span>
                            </Link>
                          ) : (
                            <span key={`${ref.title}-${refIdx}`} className="chat-ref-chip">
                              <Star size={11} fill="currentColor" aria-hidden="true" />
                              <span>{label}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Full interactive poster cards reserved for unseen recommendations */}
                    {recommendedCards.length > 0 && (
                      <div className="chat-inline-movies-grid">
                        {recommendedCards.map((m, i) => (
                          <InlineMovieCard
                            key={`${m.title}-${m.year || i}`}
                            title={m.title}
                            year={m.year}
                            watched={watched}
                            watchlist={activeWatchlist}
                          />
                        ))}
                      </div>
                    )}

                    <div className="bubble-meta-row">
                      {debug && msg.role === "model" && msg.modelInfo?.model ? (
                        <span
                          className={`bubble-model-tag ${msg.modelInfo.isFallback ? "fallback" : ""}`}
                          title={
                            msg.modelInfo.cooldownModels?.length
                              ? `Fallback from: ${msg.modelInfo.cooldownModels.map((c) => `${c.model} (${c.reason})`).join(", ")}`
                              : `Answered by ${msg.modelInfo.displayName || msg.modelInfo.model}`
                          }
                        >
                          <Cpu size={10} />
                          {msg.modelInfo.model}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="bubble-timestamp">{msg.time}</span>
                    </div>
                  </div>

                  {msg.role === "user" && (
                    <div className="chat-avatar user-avatar">
                      <User size={16} />
                    </div>
                  )}
                </motion.div>
              );
            })
          )}

          {/* Typing Indicator */}
          {isLoading && (
            <div className="chat-bubble-wrapper model">
              <div className="chat-avatar bot-avatar">
                <Sparkles size={16} />
              </div>
              <div className="chat-bubble model typing">
                <div className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Starter Prompts before multi-turn engagement */}
        {hasConversationTurns && messages.length <= 2 && !isLoading && (
          <div className="chat-prompts-container">
            <span className="prompts-label">{focusedMovie ? `Explore ${focusedMovie.title}:` : "Try asking:"}</span>
            <div className="prompts-chips">
              {activeStarterPrompts.map((promptText, idx) => (
                <button
                  type="button"
                  key={`${threadKey}-${idx}`}
                  className="prompt-chip"
                  onClick={() => handleSendMessage(promptText)}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  <span>{promptText}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Adaptive Follow-Ups after multi-turn replies */}
        {messages.length > 2 && !isLoading && (
          <div className="chat-followups-strip">
            {followUpPrompts.map((promptText, idx) => (
              <button
                type="button"
                key={`followup-${idx}`}
                className="chat-followup-chip"
                onClick={() => handleSendMessage(promptText)}
              >
                <span>{promptText}</span>
              </button>
            ))}
          </div>
        )}

        {/* Docked Auto-Expanding Input Form */}
        <form className="chat-input-form" onSubmit={handleFormSubmit}>
          <div className="chat-input-wrapper">
            <textarea
              ref={composerRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                focusedMovie
                  ? `Ask about ${focusedMovie.title} (spoilers ${spoilerSafe ? "off" : "on"})...`
                  : "Ask about movies, your Watchlist, directors..."
              }
              disabled={isLoading}
              className="chat-text-input chat-textarea"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="btn-chat-send"
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>

      <GeminiKeyModal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        onChanged={(hasKey) => setUsingOwnKey(Boolean(hasKey))}
      />
    </div>
  );
}
