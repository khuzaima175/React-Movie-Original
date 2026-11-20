import { sanitizeLine } from "./filmChatService.js";
import { findMatchingMovie } from "./movieIdentity.js";

export const DEFAULT_MAX_INLINE_CHAT_CARDS = 8;

/**
 * Extracts unique movie recommendations formatted as **Title** (YYYY) or "Title" (YYYY)
 * from assistant chat replies, up to maxCards.
 */
export function parseMovieCardsFromText(text, maxCards = DEFAULT_MAX_INLINE_CHAT_CARDS) {
  if (!text) return [];
  const regex = /(?:\*\*([^*]+?)\*\*|"([^"\n]+)")\s*\(((?:19|20)\d\d)\)/g;
  const movies = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawTitle = (match[1] || match[2] || "").replace(/\s*\(\d{4}\)$/, "").trim();
    const year = match[3];
    if (!rawTitle) continue;
    if (!movies.some((m) => m.title.toLowerCase() === rawTitle.toLowerCase())) {
      movies.push({ title: rawTitle, year });
    }
    if (movies.length >= maxCards) break;
  }
  return movies;
}

/**
 * Splits a markdown-flavored chat reply into safe structural blocks (heading, paragraph,
 * unordered list, ordered list) without allowing raw HTML injection.
 */
export function parseChatMessageBlocks(text) {
  if (!text) return [];
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraphLines = [];
  let listType = null;
  let listItems = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const joined = paragraphLines.join(" ").trim();
    if (joined) blocks.push({ type: "paragraph", text: joined });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems = [];
      return;
    }
    blocks.push({ type: listType, items: [...listItems] });
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: headingMatch[1].trim() });
      continue;
    }

    const olMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(olMatch[1].trim());
      continue;
    }

    const ulMatch = line.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ulMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

/**
 * Generates concise, emoji-free starter prompts tuned to the user's Vault and Watchlist.
 */
export function buildCompanionStarterPrompts({
  watched = [],
  watchlist = []
} = {}) {
  const sortedFavorites = [...(watched || [])]
    .filter((m) => m && m.title && Number(m.userRating) >= 8)
    .sort((a, b) => Number(b.userRating || 0) - Number(a.userRating || 0));

  const topAnchor = sortedFavorites[0]?.title
    ? sanitizeLine(sortedFavorites[0].title, 48)
    : null;

  const firstPrompt = topAnchor
    ? `5 unseen films like ${topAnchor}`
    : "5 mind-bending sci-fi films to start my Vault";

  const secondPrompt =
    (watchlist?.length || 0) > 0
      ? "Pick the best film from my Watchlist for tonight"
      : "Best 90s neo-noir and psychological thrillers";

  const thirdPrompt =
    (watched?.length || 0) >= 3
      ? "Analyze my Taste DNA, favorite directors, and blind spots"
      : "Critically acclaimed hidden gems under 2 hours";

  const fourthPrompt = "Plan a Friday night double feature with a connecting theme";

  return [firstPrompt, secondPrompt, thirdPrompt, fourthPrompt];
}

/**
 * Builds compact, adaptive 1-click follow-up actions after an assistant turn settles.
 */
export function buildCompanionFollowUpPrompts({
  watchedCount = 0,
  watchlistCount = 0,
  hasFocusedMovie = false
} = {}) {
  if (hasFocusedMovie) {
    return [
      "What 3 unseen films match its tone and craft?",
      "Compare this to my highest-rated films"
    ];
  }

  const chips = [
    "Give me 3 deeper hidden-gem alternatives",
    "Pair two of these into a double feature"
  ];
  if (watchlistCount > 0) {
    chips.push("Check how these stack up against my Watchlist");
  } else if (watchedCount >= 3) {
    chips.push("What blind spots am I missing in this style?");
  }
  return chips;
}

/**
 * Separates already-watched Vault references from new unseen recommendation mentions
 * so chat replies render watched references as compact chips and reserve full poster
 * cards strictly for unseen recommendations.
 */
export function partitionChatMovieCards(parsedCards = [], watched = [], watchlist = []) {
  const referenceChips = [];
  const recommendedCards = [];

  for (const item of parsedCards || []) {
    if (!item || !item.title) continue;
    const watchedMatch = findMatchingMovie(watched || [], {
      title: item.title,
      Title: item.title,
      year: item.year
    });
    if (watchedMatch) {
      referenceChips.push({
        title: watchedMatch.title || watchedMatch.Title || item.title,
        year: watchedMatch.year || watchedMatch.Year || item.year || "",
        imdbID: watchedMatch.imdbID || null,
        tmdbId: watchedMatch.tmdbId || null,
        userRating: Number(watchedMatch.userRating) || 0
      });
    } else {
      const watchlistMatch = findMatchingMovie(watchlist || [], {
        title: item.title,
        Title: item.title,
        year: item.year
      });
      recommendedCards.push({
        ...item,
        inWatchlist: Boolean(watchlistMatch)
      });
    }
  }

  return { referenceChips, recommendedCards };
}
