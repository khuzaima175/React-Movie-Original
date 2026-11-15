import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { sendChatMessage } from "../services/geminiChatService";
import { buildMovieChatStarterPrompts } from "../services/filmChatService";
import { findMatchingMovie } from "../services/movieIdentity";
import { getCanonicalMovieKey } from "../services/vaultSyncService";
import { fetchOmdbJson } from "../services/apiTransport";
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
  ExternalLink
} from "lucide-react";

const SUGGESTED_PROMPTS = [
  "Something like Inception",
  "Which directors do I love?",
  "Best 90s thrillers?",
  "Surprise me with a hidden gem"
];

const inlineMovieCache = new Map();

function InlineMovieCard({ title, year }) {
  const { watchlist, addToWatchlist } = useApp();
  const [movieData, setMovieData] = useState(null);
  const [isAdding, setIsAdding] = useState(false);

  const inWatchlist = watchlist?.some(
    (m) => m.title.toLowerCase() === title.toLowerCase()
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
        if (data?.Response === "True") {
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

  const handleAdd = () => {
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
      imdbRating: movieData?.imdbRating || "N/A",
      userRating: 0
    };
    addToWatchlist(movieObj);
    setTimeout(() => setIsAdding(false), 400);
  };

  return (
    <div className="chat-inline-movie-card">
      <div className="inline-poster-wrapper">
        <PosterImage
          src={movieData?.Poster}
          title={title}
          className="inline-poster-img"
        />
      </div>
      <div className="inline-info">
        <h5 className="inline-title">{movieData?.Title || title}</h5>
        <span className="inline-meta">
          {movieData?.Year || year || "N/A"}{" "}
          {movieData?.Genre ? `• ${movieData.Genre.split(",")[0]}` : ""}
        </span>
        {movieData?.imdbRating && movieData.imdbRating !== "N/A" && (
          <div className="inline-rating">
            <Star size={12} fill="currentColor" />
            <span>{movieData.imdbRating}</span>
          </div>
        )}
      </div>
      <button
        className={`btn-inline-add ${inWatchlist ? "added" : ""}`}
        onClick={handleAdd}
        disabled={inWatchlist || isAdding}
      >
        {inWatchlist ? <Check size={14} /> : <Plus size={14} />}
        <span>{inWatchlist ? "Added" : "Watchlist"}</span>
      </button>
    </div>
  );
}

// Convert basic **bold** and *italic* markers cleanly without HTML injection
function renderFormattedChatText(text) {
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

// Extract movie recommendations like **Movie Title** (Year) or "Movie Title" (Year)
function parseMovieCardsFromText(text) {
  if (!text) return [];
  const regex = /(?:\*\*([^*]+)\*\*|\"([^\"]+)\")\s*\(((?:19|20)\d\d)\)/g;
  const movies = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const title = match[1] || match[2];
    const year = match[3];
    if (title && !movies.some((m) => m.title.toLowerCase() === title.toLowerCase())) {
      movies.push({ title: title.trim(), year });
    }
  }
  return movies.slice(0, 3); // cap at 3 inline cards per bubble
}

const GENERAL_WELCOME_TEXT =
  "Hello! I've analyzed your viewing history. Ask me for personalized recommendations, director deep-dives, or hidden gems!";

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
  const { watchlist: contextWatchlist, tasteRules } = useApp();
  const activeWatchlist = watchlistProp || contextWatchlist || [];

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

  useEffect(() => {
    setError(false);
  }, [threadKey]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading, threadKey]);

  const activeStarterPrompts = useMemo(() => {
    if (!focusedMovie) return SUGGESTED_PROMPTS;
    const prompts = buildMovieChatStarterPrompts(focusedMovie, {
      isWatched: focusedIsWatched,
      spoilerSafe
    });
    return prompts.length > 0 ? prompts : SUGGESTED_PROMPTS;
  }, [focusedMovie, focusedIsWatched, spoilerSafe]);

  const focusMovieRoute = useMemo(() => {
    if (!focusedMovie) return null;
    const routeId =
      focusedMovie.imdbID ||
      (focusedMovie.tmdbId ? `tmdb_${focusedMovie.tmdbId}` : null);
    return routeId ? `/movie/${encodeURIComponent(routeId)}` : null;
  }, [focusedMovie]);

  const handleToggleSpoilerSafe = () => {
    if (!focusedKey) return;
    setSpoilerPrefsByKey((prev) => ({
      ...prev,
      [focusedKey]: !spoilerSafe
    }));
  };

  const handleSendMessage = async (textToSend) => {
    const query = textToSend || input.trim();
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

      const responseText = await sendChatMessage(
        query,
        seededMessages.slice(1),
        watched,
        tasteRules,
        activeMoviePayload,
        focusedMovie ? { spoilerSafe } : {}
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

  return (
    <div className="ai-chat-wrapper">
      <div className="ai-chat-container">
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
          {messages.map((msg, index) => {
            const detectedMovies =
              msg.role === "model" ? parseMovieCardsFromText(msg.text) : [];

            return (
              <div key={index} className={`chat-bubble-wrapper ${msg.role}`}>
                {msg.role === "model" && (
                  <div className="chat-avatar bot-avatar">
                    <Sparkles size={16} />
                  </div>
                )}

                <div className={`chat-bubble ${msg.role} ${msg.isError ? "error" : ""}`}>
                  <p className="bubble-text">{renderFormattedChatText(msg.text)}</p>

                  {/* Render inline movie cards if Oracle recommended movies */}
                  {detectedMovies.length > 0 && (
                    <div className="chat-inline-movies-grid">
                      {detectedMovies.map((m, i) => (
                        <InlineMovieCard key={i} title={m.title} year={m.year} />
                      ))}
                    </div>
                  )}

                  <div className="bubble-meta-row">
                    {msg.role === "model" && msg.modelInfo?.model ? (
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
              </div>
            );
          })}

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

        {/* Suggested Prompt Chips */}
        {messages.length <= 2 && !isLoading && (
          <div className="chat-prompts-container">
            <span className="prompts-label">{focusedMovie ? `Explore ${focusedMovie.title}:` : "Suggested prompts:"}</span>
            <div className="prompts-chips">
              {activeStarterPrompts.map((promptText, idx) => (
                <button
                  key={`${threadKey}-${idx}`}
                  className="prompt-chip"
                  onClick={() => handleSendMessage(promptText)}
                >
                  <Sparkles size={13} />
                  <span>{promptText}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Docked Input Form */}
        <form className="chat-input-form" onSubmit={handleFormSubmit}>
          <div className="chat-input-wrapper">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                focusedMovie
                  ? `Ask about ${focusedMovie.title} (craft, themes, spoilers ${spoilerSafe ? "off" : "on"})...`
                  : "Ask Oracle for movie recommendations, director insights..."
              }
              disabled={isLoading}
              className="chat-text-input"
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
    </div>
  );
}
