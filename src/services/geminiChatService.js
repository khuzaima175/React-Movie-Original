import { FAST_INTERACTIVE_CASCADE, executeCascade, createGeminiClient } from "./geminiService.js";
import { resolveGeminiKey } from "./apiTransport.js";
import { compileActiveTasteRules } from "./tasteRulesService.js";
import { sanitizePromptLine, serializeFilmDossierForPrompt } from "./filmChatService.js";

const MAX_WATCHED_CONTEXT_ENTRIES = 120;
const MAX_WATCHLIST_CONTEXT_ENTRIES = 30;
const MAX_FEEDBACK_CONTEXT_ENTRIES = 30;
const MAX_CHAT_HISTORY_TURNS = 12;
const MAX_TURN_CHARS = 1200;

function summarizeVaultTaste(watchedMovies = []) {
  const items = Array.isArray(watchedMovies) ? watchedMovies.filter(Boolean) : [];
  if (items.length === 0) return "";

  const rated = items.filter((m) => Number(m.userRating) > 0);
  const avg = rated.length
    ? (rated.reduce((sum, m) => sum + Number(m.userRating), 0) / rated.length).toFixed(1)
    : null;

  const genreScores = new Map();
  const directorCounts = new Map();

  for (const m of items) {
    const rating = Number(m.userRating) || 6;
    const rawGenres = typeof m.genre === "string"
      ? m.genre.split(",")
      : Array.isArray(m.genres) ? m.genres : [];
    for (const g of rawGenres) {
      const clean = sanitizePromptLine(g, 32);
      if (!clean || clean === "N/A") continue;
      genreScores.set(clean, (genreScores.get(clean) || 0) + rating);
    }

    if (m.director && m.director !== "Unknown" && m.director !== "N/A") {
      for (const d of String(m.director).split(",")) {
        const cleanDir = sanitizePromptLine(d, 48);
        if (!cleanDir) continue;
        const prev = directorCounts.get(cleanDir) || { count: 0, total: 0 };
        directorCounts.set(cleanDir, { count: prev.count + 1, total: prev.total + rating });
      }
    }
  }

  const topGenres = [...genreScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g);

  const topDirectors = [...directorCounts.entries()]
    .sort((a, b) => (b[1].count - a[1].count) || (b[1].total - a[1].total))
    .slice(0, 4)
    .map(([d, meta]) => `${d} (${meta.count})`);

  const parts = [`${items.length} films logged`];
  if (avg) parts.push(`avg rating ${avg}/10`);
  if (topGenres.length > 0) parts.push(`top genres: ${topGenres.join(", ")}`);
  if (topDirectors.length > 0) parts.push(`top directors: ${topDirectors.join(", ")}`);
  return parts.join(" | ");
}

function selectRepresentativeWatched(watchedMovies = [], limit = MAX_WATCHED_CONTEXT_ENTRIES) {
  const items = Array.isArray(watchedMovies) ? watchedMovies.filter((m) => m && m.title) : [];
  if (items.length <= limit) return { selected: items, omittedCount: 0 };

  const seen = new Set();
  const selected = [];
  const pushUnique = (item) => {
    const key = String(item.imdbID || item.tmdbId || item.title).toLowerCase();
    if (seen.has(key) || selected.length >= limit) return;
    seen.add(key);
    selected.push(item);
  };

  // Prioritize recent watches, standout highs, and low calibration anchors.
  const byRecent = [...items].sort((a, b) =>
    String(b.dateWatched || b.updatedAt || "").localeCompare(String(a.dateWatched || a.updatedAt || ""))
  );
  byRecent.slice(0, 35).forEach(pushUnique);

  const byHigh = [...items].sort((a, b) => Number(b.userRating || 0) - Number(a.userRating || 0));
  byHigh.slice(0, 45).forEach(pushUnique);

  const byLow = [...items]
    .filter((m) => Number(m.userRating) > 0 && Number(m.userRating) <= 5)
    .sort((a, b) => Number(a.userRating) - Number(b.userRating));
  byLow.slice(0, 20).forEach(pushUnique);

  items.forEach(pushUnique);
  return { selected, omittedCount: Math.max(0, items.length - selected.length) };
}

function formatWatchedLine(m) {
  const title = sanitizePromptLine(m.title, 90);
  const year = sanitizePromptLine(m.year, 8);
  const rating = Number(m.userRating) > 0 ? `${Math.round(Number(m.userRating))}/10` : "unrated";
  const dir = m.director && m.director !== "Unknown" && m.director !== "N/A"
    ? ` | Dir: ${sanitizePromptLine(m.director, 45)}`
    : "";
  const note = m.userNote ? ` | Note: "${sanitizePromptLine(m.userNote, 110)}"` : "";
  return `- ${title} (${rating})${year && year !== "N/A" ? ` [${year}]` : ""}${dir}${note}`;
}

/**
 * Constructs the full Film Companion prompt string with Vault DNA, Watchlist queue,
 * dismissed/already-seen exclusions, streaming preferences, optional focused film dossier,
 * and bounded turn history.
 */
export function buildChatPromptPayload(
  userMessage,
  chatHistory = [],
  watchedMovies = [],
  tasteRules = [],
  activeMovieContext = null,
  chatOptions = {}
) {
  const tasteSummary = summarizeVaultTaste(watchedMovies);
  const { selected: selectedWatched, omittedCount } = selectRepresentativeWatched(watchedMovies);

  const movieContext = selectedWatched.length > 0
    ? [
        ...selectedWatched.map(formatWatchedLine),
        omittedCount > 0 ? `- ...plus ${omittedCount} additional rated/logged entries.` : ""
      ].filter(Boolean).join("\n")
    : "No watched movies yet.";

  const watchlistItems = Array.isArray(chatOptions?.watchlist)
    ? chatOptions.watchlist.filter((m) => m && m.title).slice(0, MAX_WATCHLIST_CONTEXT_ENTRIES)
    : [];
  const watchlistBlock = watchlistItems.length > 0
    ? `\n\n    USER'S WATCHLIST (${watchlistItems.length} queued):\n${watchlistItems
        .map((m) => {
          const title = sanitizePromptLine(m.title, 80);
          const year = m.year && m.year !== "N/A" ? ` (${sanitizePromptLine(m.year, 8)})` : "";
          const score = m.imdbRating && m.imdbRating !== "N/A" ? ` - IMDb ${sanitizePromptLine(m.imdbRating, 6)}` : "";
          return `    - ${title}${year}${score}`;
        })
        .join("\n")}`
    : "";

  const feedbackItems = Array.isArray(chatOptions?.feedbackLog)
    ? chatOptions.feedbackLog
        .filter((f) => f && f.title && (f.action === "dismissed" || f.action === "already_seen"))
        .slice(-MAX_FEEDBACK_CONTEXT_ENTRIES)
    : [];
  const feedbackBlock = feedbackItems.length > 0
    ? `\n\n    DISMISSED / ALREADY SEEN (Never recommend as new picks):\n${feedbackItems
        .map((f) => {
          const title = sanitizePromptLine(f.title, 80);
          const year = f.year && f.year !== "N/A" ? ` (${sanitizePromptLine(f.year, 8)})` : "";
          return `    - ${title}${year} [${f.action}]`;
        })
        .join("\n")}`
    : "";

  const region = sanitizePromptLine(chatOptions?.userRegion || "", 12);
  const providers = Array.isArray(chatOptions?.userWatchProviders)
    ? chatOptions.userWatchProviders.filter(Boolean).slice(0, 10)
    : [];
  const regionBlock = region
    ? `\n\n    STREAMING REGION: ${region}${providers.length > 0 ? ` (preferred provider IDs: ${providers.join(", ")})` : ""}`
    : "";

  const { activeRules } = compileActiveTasteRules(tasteRules);
  const rulesContext = activeRules.length > 0
    ? `\n\n    USER'S ACTIVE TASTE RULES (Respect strictly):\n${activeRules.map((r) => `    - [${r.polarity === "avoid" ? "Avoid" : "Prefer"}] ${sanitizePromptLine(r.text, 140)}`).join("\n")}`
    : "";

  let focusBlock = "";
  if (activeMovieContext && typeof activeMovieContext === "object") {
    const spoilerSafe =
      typeof chatOptions?.spoilerSafe === "boolean"
        ? chatOptions.spoilerSafe
        : !activeMovieContext.isWatched;
    const dossier = serializeFilmDossierForPrompt(
      activeMovieContext,
      activeMovieContext.vaultEntry || null,
      activeMovieContext.watchlistEntry || null,
      { spoilerSafe }
    );
    if (dossier) {
      focusBlock = `\n\n    FOCUSED FILM DOSSIER (Primary topic of this conversation):\n    ${dossier}`;
    }
  }

  const focusGuideline = focusBlock
    ? `\n    6.  **Focused Film Companion**: Keep this film (${sanitizePromptLine(activeMovieContext.title, 120) || "selected film"}) central unless the user pivots to comparisons or next watches. Respect the Spoiler Policy above strictly.`
    : "";

  const systemInstruction = `
    You are CinemaVault's Film Companion—an incisive, widely read cinephile and programming curator. Discuss cinema deeply, answer watch-next questions using the user's actual taste profile and watchlist queue, build double features, compare filmmakers, and explain craft.

    ${tasteSummary ? `USER'S TASTE SUMMARY:\n    ${tasteSummary}\n\n    ` : ""}USER'S WATCHED VAULT:
    ${movieContext}${watchlistBlock}${feedbackBlock}${regionBlock}${rulesContext}${focusBlock}

    STRICT GUIDELINES:
    1.  **Scope**: Discuss movies, television series, directors, screenwriters, cinematography, scores, comparisons, and the user's Vault/Watchlist. If asked about unrelated non-screen topics (code, math, politics, medical advice), respond calmly without emojis: "I specialize in cinema, television, filmmakers, and your CinemaVault library—ask me what to watch next or dive into any film."
    2.  **Anti-Repeat Curation Rule**: When recommending NEW films to watch, NEVER recommend titles already listed in USER'S WATCHED VAULT or DISMISSED / ALREADY SEEN (unless the user explicitly asks to revisit or compare watched films). When picking from USER'S WATCHLIST, clearly mark "(In your Watchlist)".
    3.  **Personalization**: Connect insights directly to the user's ratings, notes, directors, low-rated calibration misses, active Taste Rules, and streaming region.
    4.  **Clarity & Structure**: Use crisp paragraphs and structured numbered lists when giving multiple picks, double features, or comparisons. No emojis. Keep reasons specific and insightful—avoid generic blurbs.
    5.  **Card Formatting**: Whenever recommending or spotlighting specific films, always format every film title as **Movie Title** (YYYY) so interactive film cards render automatically for each pick.${focusGuideline}
    `;

  let prompt = `${systemInstruction}\n\nCHAT HISTORY:\n`;
  const recentHistory = Array.isArray(chatHistory) ? chatHistory.slice(-MAX_CHAT_HISTORY_TURNS) : [];

  recentHistory.forEach((msg) => {
    const roleName = msg.role === "user" ? "User" : "AI";
    const text = String(msg.text || "");
    const bounded = text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS - 1)}…` : text;
    prompt += `${roleName}: ${bounded}\n`;
  });

  const lastMsg = recentHistory[recentHistory.length - 1];
  if (!lastMsg || lastMsg.text !== userMessage || lastMsg.role !== "user") {
    prompt += `User: ${userMessage}\n`;
  }
  prompt += `AI:`;

  return prompt;
}

/**
 * Maps raw Gemini/proxy/network errors to calm, emoji-free user-facing chat messages.
 */
export function mapChatErrorToMessage(error) {
  const parts = [
    error?.errorCode,
    error?.error?.errorCode,
    error?.message,
    error?.error?.message,
    typeof error === "string" ? error : ""
  ].filter(Boolean).join(" ");

  if (/RESOURCE_EXHAUSTED|quota|All chat models failed|PROXY_RATE_LIMIT/i.test(parts)) {
    return "Shared AI companion is at capacity right now. Try again in a few minutes, or use your own free Gemini key.";
  }
  if (/API Key|401/i.test(parts)) {
    return "The AI service is not configured on this deployment.";
  }
  if (/network|fetch/i.test(parts)) {
    return "Connection issue. Check your internet and try again.";
  }
  return "Something went wrong. Please try again in a moment.";
}

export const sendChatMessage = async (
  userMessage,
  chatHistory,
  watchedMovies,
  tasteRules = [],
  activeMovieContext = null,
  chatOptions = {}
) => {
  const ai = createGeminiClient(resolveGeminiKey());
  if (!ai) {
    return mapChatErrorToMessage(new Error("Gemini API Key missing"));
  }

  const prompt = buildChatPromptPayload(
    userMessage,
    chatHistory,
    watchedMovies,
    tasteRules,
    activeMovieContext,
    chatOptions
  );

  try {
    const response = await executeCascade(
      ai,
      FAST_INTERACTIVE_CASCADE,
      { contents: prompt },
      { cascadeType: "fast" }
    );

    if (!response) {
      throw new Error("All chat models failed");
    }

    const text = response.text ||
      (response.candidates && response.candidates[0]?.content?.parts?.[0]?.text) ||
      "I'm having trouble connecting to the cinema database right now.";

    return text;
  } catch (error) {
    console.error("Chat Error:", error);
    return mapChatErrorToMessage(error);
  }
};
