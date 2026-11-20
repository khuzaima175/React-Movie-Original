import { Type } from "@google/genai";
import {
  extractTasteProfile,
  fetchCandidatePool,
  fetchEmbeddingCandidates
} from "./tmdbService.js";
import {
  DEFAULT_RANKER_WEIGHTS,
  rankCandidatePool
} from "./rankerService.js";
import {
  loadDefaultEmbeddingIndex,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax,
  retrieveAlignedEmbeddingNeighbors
} from "./embeddingService.js";
import {
  EXPLORE_FOR_YOU_CASCADE,
  executeCascade,
  createGeminiClient,
  generateProfileHash,
  getLastModelInfo
} from "./geminiService.js";
import { resolveGeminiKey } from "./apiTransport.js";
import { compileActiveTasteRules } from "./tasteRulesService.js";
import { filterExploreResults } from "./exploreService.js";
import { sanitizeLine } from "./filmChatService.js";

export const EXPLORE_FOR_YOU_TARGET_COUNT = 100;
export const EXPLORE_FOR_YOU_MIN_RATED = 3;
const MAX_FOR_YOU_PROMPT_CHARS = 28000;

function getTodayIso(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function mulberry32(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeCandidateForExplore(c, fallbackScore = 72) {
  const tmdbId = Number(c.tmdbId || c.id);
  const rawScore = Number(c.forYouScore ?? c.matchScore ?? fallbackScore);
  const forYouScore = Number.isFinite(rawScore)
    ? Math.max(50, Math.min(99, Math.round(rawScore)))
    : 72;
  const ratingNum = Number(c.imdbRating ?? c.vote_average ?? 0);
  const imdbRating = Number.isFinite(ratingNum) && ratingNum > 0 ? ratingNum.toFixed(1) : "N/A";
  const year =
    c.year && c.year !== "N/A"
      ? String(c.year)
      : (typeof c.release_date === "string" && c.release_date.length >= 4
          ? c.release_date.slice(0, 4)
          : "");

  return {
    id: c.imdbID || c.id || (Number.isFinite(tmdbId) ? `tmdb_${tmdbId}` : ""),
    imdbID: c.imdbID || (Number.isFinite(tmdbId) ? `tmdb_${tmdbId}` : c.id || ""),
    tmdbId: Number.isFinite(tmdbId) ? tmdbId : null,
    title: c.title || c.Title || "Untitled",
    year,
    release_date: c.release_date || (year ? `${year}-01-01` : ""),
    poster: c.poster || c.Poster || null,
    genre: c.genre || "",
    tmdbGenreIds: Array.isArray(c.tmdbGenreIds)
      ? c.tmdbGenreIds.map(Number).filter(Number.isFinite)
      : Array.isArray(c.genre_ids)
        ? c.genre_ids.map(Number).filter(Number.isFinite)
        : [],
    imdbRating,
    vote_average: Number.isFinite(ratingNum) ? ratingNum : 0,
    vote_count: Number(c.vote_count) || 0,
    popularity: Number(c.popularity) || 0,
    runtime: Number(c.runtime) || null,
    original_language: c.original_language || "",
    originCountry: Array.isArray(c.originCountry)
      ? c.originCountry
      : Array.isArray(c.origin_country)
        ? c.origin_country
        : [],
    forYouScore,
    matchScore: forYouScore,
    vibeTag: c.vibeTag || "",
    forYouReason: c.forYouReason || c.reason || ""
  };
}

/**
 * Deterministic profile hash so Explore For You caches stay valid until the user's
 * watched ratings, taste rules, or region materially change.
 */
export function buildExploreForYouProfileHash({
  watched = [],
  watchlist = [],
  tasteRules = [],
  userRegion = "GLOBAL"
} = {}) {
  const base = generateProfileHash(watched, watchlist, "explore-for-you", userRegion, [], null, null, tasteRules);
  return `explore_fy_v1_${base}`;
}

/**
 * Builds a compact, emoji-free single-shot prompt (<= 28k chars) asking Flash-Lite
 * to score and tag up to targetCount verified TMDB candidates against the user's Vault DNA.
 */
export function buildExploreForYouBatchPrompt(
  profile = {},
  candidates = [],
  { watched = [], tasteRules = [], targetCount = EXPLORE_FOR_YOU_TARGET_COUNT } = {}
) {
  const safeWatched = Array.isArray(watched) ? watched.filter((m) => m && m.title) : [];
  const topLoved = [...safeWatched]
    .filter((m) => Number(m.userRating) >= 8)
    .sort((a, b) => Number(b.userRating) - Number(a.userRating))
    .slice(0, 18)
    .map((m) => `${sanitizeLine(m.title, 48)} (${Math.round(Number(m.userRating))}/10)`);

  const dislikes = [...safeWatched]
    .filter((m) => Number(m.userRating) > 0 && Number(m.userRating) <= 5)
    .sort((a, b) => Number(a.userRating) - Number(b.userRating))
    .slice(0, 8)
    .map((m) => `${sanitizeLine(m.title, 44)} (${Math.round(Number(m.userRating))}/10)`);

  const { activeRules } = compileActiveTasteRules(tasteRules);
  const rulesLines = activeRules
    .slice(0, 8)
    .map((r) => `- [${r.polarity === "avoid" ? "Avoid" : "Prefer"}] ${sanitizeLine(r.text, 90)}`);

  const genres = Array.isArray(profile?.lovedGenreNames) ? profile.lovedGenreNames.slice(0, 5).join(", ") : "";
  const header = [
    "You are CinemaVault's catalog curator. Score and tag the verified unseen TMDB candidates below for this viewer's personal Explore feed.",
    `Return ONLY valid JSON: {"picks":[{"id":<tmdbId>,"s":<int 55..99>,"tag":"<2-3 word vibe>","r":"<short 8-14 word reason>"}]} for up to ${Math.min(targetCount, candidates.length)} distinct candidates from the list below.`,
    "STRICT RULES: Only use exact numeric ids from CANDIDATES. Never invent ids or films. No emojis. Respect Avoid rules and low-rated misses.",
    genres ? `TOP GENRES: ${genres}` : "",
    topLoved.length > 0 ? `FAVORITE ANCHORS: ${topLoved.join("; ")}` : "",
    dislikes.length > 0 ? `DISLIKED CALIBRATION: ${dislikes.join("; ")}` : "",
    rulesLines.length > 0 ? `TASTE RULES:\n${rulesLines.join("\n")}` : "",
    "CANDIDATES (id|Title|Year|Genres|Score):"
  ].filter(Boolean).join("\n");

  const lines = [];
  let charBudget = MAX_FOR_YOU_PROMPT_CHARS - header.length - 64;
  for (const c of candidates.slice(0, 120)) {
    const id = Number(c.tmdbId || c.id);
    if (!Number.isFinite(id)) continue;
    const title = sanitizeLine(c.title || c.Title || "", 44);
    const year = sanitizeLine(c.year || (c.release_date ? c.release_date.slice(0, 4) : ""), 4);
    const genre = sanitizeLine(c.genre || "", 26);
    const score = Math.round(Number(c.matchScore ?? 75));
    const line = `${id}|${title}|${year}|${genre}|${score}`;
    if (line.length + 1 > charBudget) break;
    lines.push(line);
    charBudget -= line.length + 1;
  }

  return `${header}\n${lines.join("\n")}`;
}

/**
 * Strictly reconciles Flash-Lite output against the verified TMDB candidate pool,
 * rejecting hallucinated IDs and backfilling deterministically from the local ranker.
 */
export function mergeExploreForYouResponse(
  candidates = [],
  geminiItems = [],
  { targetCount = EXPLORE_FOR_YOU_TARGET_COUNT } = {}
) {
  const byId = new Map();
  const orderedCandidates = [];
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const normalized = normalizeCandidateForExplore(raw);
    if (!normalized.tmdbId || byId.has(normalized.tmdbId)) continue;
    byId.set(normalized.tmdbId, normalized);
    orderedCandidates.push(normalized);
  }

  const out = [];
  const seen = new Set();

  for (const pick of Array.isArray(geminiItems) ? geminiItems : []) {
    const id = Number(pick?.id ?? pick?.tmdbId);
    if (!Number.isFinite(id) || seen.has(id) || !byId.has(id)) continue;
    const base = byId.get(id);
    const rawS = Number(pick?.s ?? pick?.score ?? base.forYouScore);
    const score = Number.isFinite(rawS) ? Math.max(50, Math.min(99, Math.round(rawS))) : base.forYouScore;
    const vibeTag = sanitizeLine(pick?.tag || pick?.vibeTag || "", 32);
    const reason = sanitizeLine(pick?.r || pick?.reason || "", 120);

    seen.add(id);
    out.push({
      ...base,
      forYouScore: score,
      matchScore: score,
      vibeTag,
      forYouReason: reason
    });
    if (out.length >= targetCount) break;
  }

  // Deterministic local-ranker backfill to maintain a rich 80–100 film catalog
  for (const cand of orderedCandidates) {
    if (out.length >= targetCount) break;
    if (seen.has(cand.tmdbId)) continue;
    seen.add(cand.tmdbId);
    out.push(cand);
  }

  out.sort((a, b) => (b.forYouScore ?? 0) - (a.forYouScore ?? 0));
  return out.slice(0, targetCount);
}

/**
 * Quality-weighted shuffle: varies presentation order across sessions/clicks
 * while keeping higher-affinity films statistically biased toward the top.
 */
export function weightedShuffleForYou(items = [], seed = Date.now()) {
  if (!Array.isArray(items) || items.length <= 1) return Array.isArray(items) ? [...items] : [];
  const rng = mulberry32(seed);
  return items
    .map((item, idx) => {
      const score = Number(item?.forYouScore ?? item?.matchScore ?? 70);
      const jitter = (rng() - 0.5) * 24;
      return { item, key: score + jitter, tie: idx };
    })
    .sort((a, b) => b.key - a.key || a.tie - b.tie)
    .map((entry) => entry.item);
}

/**
 * Applies Explore Deep Filter facets and sorting locally over a cached For You pool
 * with zero additional TMDB or Gemini requests.
 */
export function filterForYouCatalog(items = [], filters = {}, watched = [], watchlist = []) {
  const annotated = filterExploreResults(items, watched, watchlist, {
    hideWatched: Boolean(filters?.hideWatched)
  });

  const genres = Array.isArray(filters?.genres) ? filters.genres.map(Number).filter(Number.isFinite) : [];
  const genreMode = filters?.genreMode === "or" ? "or" : "and";
  const withoutGenres = new Set(
    Array.isArray(filters?.withoutGenres) ? filters.withoutGenres.map(Number).filter(Number.isFinite) : []
  );
  const yearFrom = /^\d{4}$/.test(String(filters?.yearFrom || "")) ? Number(filters.yearFrom) : null;
  const yearTo = /^\d{4}$/.test(String(filters?.yearTo || "")) ? Number(filters.yearTo) : null;
  const runtimeMin = Number(filters?.runtimeMin) > 0 ? Number(filters.runtimeMin) : null;
  const runtimeMax = Number(filters?.runtimeMax) > 0 ? Number(filters.runtimeMax) : null;
  const minImdb = Number.isFinite(Number(filters?.minImdb)) && Number(filters.minImdb) > 0 ? Number(filters.minImdb) : 0;
  const minVotes = Number.isFinite(Number(filters?.minVotes)) && Number(filters.minVotes) > 0 ? Number(filters.minVotes) : 0;
  const language = String(filters?.language || "").trim().toLowerCase();
  const country = String(filters?.country || "").trim().toUpperCase();

  const filtered = annotated.filter((m) => {
    const itemGenres = Array.isArray(m.tmdbGenreIds) ? m.tmdbGenreIds.map(Number) : [];
    if (genres.length > 0) {
      const matchesGenre = genreMode === "or"
        ? genres.some((gid) => itemGenres.includes(gid))
        : genres.every((gid) => itemGenres.includes(gid));
      if (!matchesGenre) return false;
    }
    if (withoutGenres.size > 0 && itemGenres.some((gid) => withoutGenres.has(gid))) {
      return false;
    }

    const itemYear = Number(m.year);
    if (yearFrom !== null && (!Number.isFinite(itemYear) || itemYear < yearFrom)) return false;
    if (yearTo !== null && (!Number.isFinite(itemYear) || itemYear > yearTo)) return false;

    const itemRuntime = Number(m.runtime);
    if (runtimeMin !== null && Number.isFinite(itemRuntime) && itemRuntime > 0 && itemRuntime < runtimeMin) return false;
    if (runtimeMax !== null && Number.isFinite(itemRuntime) && itemRuntime > 0 && itemRuntime > runtimeMax) return false;

    const score = Number(m.imdbRating ?? m.vote_average ?? 0);
    if (minImdb > 0 && (!Number.isFinite(score) || score < minImdb)) return false;
    if (minVotes > 0 && Number(m.vote_count || 0) < minVotes) return false;

    if (language && m.original_language && m.original_language.toLowerCase() !== language) return false;
    if (country && Array.isArray(m.originCountry) && m.originCountry.length > 0 && !m.originCountry.includes(country)) {
      return false;
    }
    return true;
  });

  const sortBy = String(filters?.sortBy || "for_you");
  if (sortBy === "for_you") {
    return filtered;
  }

  return [...filtered].sort((a, b) => {
    if (sortBy === "vote_average.desc") {
      return (Number(b.imdbRating) || 0) - (Number(a.imdbRating) || 0);
    }
    if (sortBy === "primary_release_date.desc") {
      return String(b.release_date || b.year || "").localeCompare(String(a.release_date || a.year || ""));
    }
    if (sortBy === "vote_count.desc") {
      return (Number(b.vote_count) || 0) - (Number(a.vote_count) || 0);
    }
    if (sortBy === "popularity.desc") {
      return (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
    }
    return (Number(b.forYouScore) || 0) - (Number(a.forYouScore) || 0);
  });
}

function parseGeminiPicksJson(rawText) {
  if (!rawText) return [];
  const cleaned = String(rawText)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.picks)) return parsed.picks;
  if (Array.isArray(parsed?.recommendations)) return parsed.recommendations;
  return [];
}

/**
 * Generates up to 100 deeply personalized unseen films using CinemaVault's on-device
 * ML ranker + a single batched Gemini Flash-Lite call (3.5-flash-lite -> 3.1-flash-lite),
 * falling back cleanly to the deterministic local ranker whenever Gemini is unavailable.
 */
export async function generateExploreForYouPool({
  watched = [],
  watchlist = [],
  tasteRules = [],
  feedbackLog = [],
  userRegion = "GLOBAL",
  userWatchProviders = [],
  aiClient = undefined,
  candidates: injectedCandidates = null,
  embeddingIndex: injectedEmbeddingIndex = undefined,
  targetCount = EXPLORE_FOR_YOU_TARGET_COUNT,
  now = Date.now()
} = {}) {
  const profileHash = buildExploreForYouProfileHash({ watched, watchlist, tasteRules, userRegion });
  const profile = await extractTasteProfile(watched, watchlist, { now }).catch(() => ({
    lovedGenreNames: [],
    lovedGenreIds: []
  }));

  const embeddingIndex = injectedEmbeddingIndex !== undefined
    ? injectedEmbeddingIndex
    : await loadDefaultEmbeddingIndex().catch(() => null);

  let rawCandidates = Array.isArray(injectedCandidates) ? [...injectedCandidates] : null;
  const excludeIds = [
    ...(watched || []).flatMap((m) => [m?.tmdbId, m?.imdbID, m?.id]),
    ...(feedbackLog || [])
      .filter((f) => f && (f.action === "dismissed" || f.action === "already_seen"))
      .flatMap((f) => [f.tmdbId, f.imdbID, f.id])
  ].filter(Boolean);

  if (!rawCandidates) {
    const todayIso = getTodayIso(now);
    const basePool = await fetchCandidatePool(profile, "any", watched, watchlist, {
      userRegion: userRegion && userRegion !== "GLOBAL" ? userRegion : "US",
      userWatchProviders,
      now
    }).catch(() => []);

    let embPool = [];
    if (embeddingIndex) {
      const aligned = retrieveAlignedEmbeddingNeighbors(watched, embeddingIndex, {
        topK: 60,
        excludeIds
      });
      if (aligned.length > 0) {
        embPool = await fetchEmbeddingCandidates(
          aligned.map((n) => n.tmdbId),
          watched,
          watchlist,
          { userRegion: userRegion && userRegion !== "GLOBAL" ? userRegion : "US" }
        ).catch(() => []);
      }
    }

    const dedup = new Map();
    for (const c of [...basePool, ...embPool]) {
      if (!c) continue;
      const tid = Number(c.tmdbId || c.id);
      if (!Number.isFinite(tid) || dedup.has(tid)) continue;
      if (c.release_date && String(c.release_date) > todayIso) continue;
      if (!c.poster && !c.poster_path) continue;
      dedup.set(tid, c);
    }
    rawCandidates = [...dedup.values()];
  }

  let collabSimMap = null;
  let repulsionMap = null;
  if (embeddingIndex) {
    const catalogMax = getCollabCatalogMax(embeddingIndex);
    collabSimMap = buildCollabSimMapFromIndex(watched, rawCandidates, embeddingIndex, { catalogMax });
    repulsionMap = buildRepulsionMapFromIndex(watched, rawCandidates, embeddingIndex);
  }

  const ranked = rankCandidatePool(
    rawCandidates,
    {
      profile,
      mood: "any",
      excludeIds,
      collabSimMap,
      repulsionMap,
      userProviders: userWatchProviders,
      tasteRules
    },
    DEFAULT_RANKER_WEIGHTS,
    Math.max(targetCount + 20, 120)
  );

  const normalizedRanked = ranked.map(normalizeCandidateForExplore);
  const ai = aiClient !== undefined ? aiClient : createGeminiClient(resolveGeminiKey());

  if (!ai || normalizedRanked.length === 0) {
    return {
      items: mergeExploreForYouResponse(normalizedRanked, [], { targetCount }),
      profileHash,
      source: "local-ranker",
      modelUsed: null,
      generatedAt: now
    };
  }

  const prompt = buildExploreForYouBatchPrompt(profile, normalizedRanked, {
    watched,
    tasteRules,
    targetCount
  });

  const generationConfig = {
    responseMimeType: "application/json",
    maxOutputTokens: 8192,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        picks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              s: { type: Type.INTEGER },
              tag: { type: Type.STRING },
              r: { type: Type.STRING }
            },
            required: ["id", "s", "tag", "r"]
          }
        }
      },
      required: ["picks"]
    }
  };

  try {
    const prevSeq = getLastModelInfo("fast")?.seq || 0;
    const response = await executeCascade(
      ai,
      EXPLORE_FOR_YOU_CASCADE,
      { contents: prompt, config: generationConfig },
      { cascadeType: "fast" }
    );

    if (response?.text) {
      const picks = parseGeminiPicksJson(response.text);
      if (picks.length > 0) {
        const latestInfo = getLastModelInfo("fast");
        const modelUsed = latestInfo && latestInfo.seq > prevSeq ? latestInfo.model : null;
        return {
          items: mergeExploreForYouResponse(normalizedRanked, picks, { targetCount }),
          profileHash,
          source: "gemini-flash-lite",
          modelUsed,
          generatedAt: now
        };
      }
    }
  } catch (err) {
    console.warn("Explore For You Flash-Lite curation fell back to local ranker:", err?.message || err);
  }

  return {
    items: mergeExploreForYouResponse(normalizedRanked, [], { targetCount }),
    profileHash,
    source: "local-ranker",
    modelUsed: null,
    generatedAt: now
  };
}
