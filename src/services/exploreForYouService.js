import { Type } from "@google/genai";
import {
  extractTasteProfile,
  fetchCandidatePool,
  fetchEmbeddingCandidates,
  enrichCandidatePoolMetadata,
  expandProviderIds
} from "./tmdbService.js";
import {
  DEFAULT_RANKER_WEIGHTS,
  rankCandidatePool
} from "./rankerService.js";
import { derivePersonalizedRankerWeights } from "./onlineLearningService.js";
import { computeExploreEmbeddingSignals } from "./embeddingWorkerClient.js";
import {
  loadDefaultContentIndex,
  buildContentSimMap
} from "./contentSimService.js";
import {
  loadDefaultDnaIndex,
  buildDnaSimMap
} from "./dnaService.js";
import {
  EXPLORE_FOR_YOU_CASCADE,
  executeCascade,
  createGeminiClient,
  getLastModelInfo
} from "./geminiService.js";
import { resolveGeminiKey } from "./apiTransport.js";
import { compileActiveTasteRules } from "./tasteRulesService.js";
import { filterExploreResults } from "./exploreService.js";
import { sanitizeLine } from "./filmChatService.js";

export const EXPLORE_FOR_YOU_TARGET_COUNT = 250;
export const EXPLORE_FOR_YOU_AI_BATCH_LIMIT = 100;
export const EXPLORE_FOR_YOU_MIN_RATED = 3;
export const EXPLORE_FOR_YOU_WAVE1_POOL_SIZE = 80;
export const EXPLORE_FOR_YOU_WAVE1_NEIGHBORS = 40;
export const EXPLORE_FOR_YOU_ENRICH_LIMIT = 120;
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

function fnv1aHex(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseRuntimeMinutes(candidate) {
  const numeric = Number(candidate?.runtimeMinutes ?? candidate?.runtime);
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
  if (typeof candidate?.runtime === "string") {
    const match = candidate.runtime.match(/(\d+)/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function parseOriginCountries(candidate) {
  const raw = candidate?.originCountry ?? candidate?.origin_country;
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw
          .map((c) => String(c || "").trim().toUpperCase())
          .filter((c) => /^[A-Z]{2}$/.test(c))
      )
    );
  }
  if (typeof raw === "string" && raw.trim()) {
    return Array.from(
      new Set(
        raw
          .split(/[,/|]+/)
          .map((c) => c.trim().toUpperCase())
          .filter((c) => /^[A-Z]{2}$/.test(c))
      )
    );
  }
  return [];
}

function parseOriginalLanguage(candidate) {
  const direct = String(candidate?.original_language || "").trim().toLowerCase();
  if (/^[a-z]{2,3}$/.test(direct)) return direct;
  const spoken = String(candidate?.spokenLanguages || "").trim().toLowerCase();
  if (/^[a-z]{2,3}$/.test(spoken)) return spoken;
  return "";
}

function extractNumericIds(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const item of list) {
    const num = Number(typeof item === "object" && item !== null ? (item.id ?? item.provider_id) : item);
    if (Number.isSafeInteger(num) && num > 0) seen.add(num);
  }
  return [...seen];
}

/**
 * Generates a concise, emoji-free editorial vibe tag purely from metadata so
 * math-ranked catalog entries look cohesive alongside AI-tagged flagship picks.
 */
export function buildMathVibeTag(candidate = {}) {
  const genres = String(candidate?.genre || "")
    .split(/[,•/|]+/)
    .map((g) => g.trim())
    .filter((g) => g && g.toLowerCase() !== "cinema");
  const primary = genres[0] || "Cinema";
  const secondary = genres[1] || "";
  const year = Number(candidate?.year || String(candidate?.release_date || "").slice(0, 4));
  const rating = Number(candidate?.imdbRating ?? candidate?.vote_average ?? 0);

  if (secondary) {
    return sanitizeLine(`${primary} ${secondary}`, 28);
  }
  if (Number.isFinite(year) && year > 0 && year < 1990) {
    return sanitizeLine(`Classic ${primary}`, 28);
  }
  if (Number.isFinite(rating) && rating >= 7.8) {
    return sanitizeLine(`Acclaimed ${primary}`, 28);
  }
  return sanitizeLine(`Curated ${primary}`, 28);
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

  const personIds = extractNumericIds([
    ...(Array.isArray(c.personIds) ? c.personIds : []),
    ...(Array.isArray(c.castIds) ? c.castIds : []),
    ...(c.crewPersonId ? [c.crewPersonId] : [])
  ]).slice(0, 20);

  const keywordIds = extractNumericIds(
    Array.isArray(c.keywordIds) ? c.keywordIds : c.tmdbKeywords
  ).slice(0, 25);

  const providerIds = extractNumericIds([
    ...(Array.isArray(c.providerIds) ? c.providerIds : []),
    ...(Array.isArray(c.streamProviders) ? c.streamProviders : []),
    ...(Array.isArray(c.freeProviders) ? c.freeProviders : [])
  ]).slice(0, 20);

  const existingTag = sanitizeLine(c.vibeTag || "", 32);

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
    runtime: parseRuntimeMinutes(c),
    original_language: parseOriginalLanguage(c),
    originCountry: parseOriginCountries(c),
    personIds,
    keywordIds,
    providerIds,
    forYouScore,
    matchScore: forYouScore,
    vibeTag: existingTag || buildMathVibeTag({ ...c, year, imdbRating }),
    forYouReason: c.forYouReason || c.reason || ""
  };
}

/**
 * Deterministic profile hash so Explore For You caches invalidate whenever the user's
 * watched library, ratings, notes, watchlist, taste rules, or region change.
 */
export function buildExploreForYouProfileHash({
  watched = [],
  watchlist = [],
  tasteRules = [],
  userRegion = "GLOBAL"
} = {}) {
  const normalizedRegion = String(userRegion || "GLOBAL").trim().toUpperCase() || "GLOBAL";

  const watchedSig = (Array.isArray(watched) ? watched : [])
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const id = String(m.tmdbId ?? m.imdbID ?? m.id ?? m.title ?? "").trim().toLowerCase();
      const rating = Number(m.userRating ?? m.UserRating ?? 0);
      const note = String(m.userNote || "").trim().slice(0, 60);
      return `${id}:${Number.isFinite(rating) ? rating : 0}:${note}`;
    })
    .sort()
    .join("|");

  const watchlistSig = (Array.isArray(watchlist) ? watchlist : [])
    .filter((m) => m && typeof m === "object")
    .map((m) => String(m.tmdbId ?? m.imdbID ?? m.id ?? m.title ?? "").trim().toLowerCase())
    .sort()
    .join("|");

  const { activeRules } = compileActiveTasteRules(tasteRules);
  const rulesSig = activeRules
    .map((r) => `${r.polarity}:${r.pinned ? "1" : "0"}:${String(r.text || "").trim().toLowerCase()}`)
    .sort()
    .join("|");

  const raw = `v3::${normalizedRegion}::W[${watchedSig}]::WL[${watchlistSig}]::R[${rulesSig}]`;
  return `explore_fy_v3_${fnv1aHex(raw)}_${fnv1aHex(`${raw.length}:${raw.split("").reverse().join("")}`)}`;
}

/**
 * Builds a compact, emoji-free single-shot prompt (<= 28k chars) asking Flash-Lite
 * to score and tag up to EXPLORE_FOR_YOU_AI_BATCH_LIMIT top verified TMDB candidates.
 */
export function buildExploreForYouBatchPrompt(
  profile = {},
  candidates = [],
  { watched = [], tasteRules = [], targetCount = EXPLORE_FOR_YOU_AI_BATCH_LIMIT } = {}
) {
  const aiCap = Math.min(Number(targetCount) || EXPLORE_FOR_YOU_AI_BATCH_LIMIT, EXPLORE_FOR_YOU_AI_BATCH_LIMIT);
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
    `Return ONLY valid JSON: {"picks":[{"id":<tmdbId>,"s":<int 55..99>,"tag":"<2-3 word vibe>","r":"<short 8-14 word reason>"}]} for up to ${Math.min(aiCap, candidates.length)} distinct candidates from the list below.`,
    "STRICT RULES: Only use exact numeric ids from CANDIDATES. Never invent ids or films. No emojis. Respect Avoid rules and low-rated misses.",
    genres ? `TOP GENRES: ${genres}` : "",
    topLoved.length > 0 ? `FAVORITE ANCHORS: ${topLoved.join("; ")}` : "",
    dislikes.length > 0 ? `DISLIKED CALIBRATION: ${dislikes.join("; ")}` : "",
    rulesLines.length > 0 ? `TASTE RULES:\n${rulesLines.join("\n")}` : "",
    "CANDIDATES (id|Title|Year|Genres|Score):"
  ].filter(Boolean).join("\n");

  const lines = [];
  let charBudget = MAX_FOR_YOU_PROMPT_CHARS - header.length - 64;
  for (const c of candidates.slice(0, Math.min(120, Math.max(aiCap, 100)))) {
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
 * rejecting hallucinated IDs and backfilling deterministically from the local ML ranker.
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
    const vibeTag = sanitizeLine(pick?.tag || pick?.vibeTag || "", 32) || base.vibeTag;
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

  // Deterministic local-ranker backfill to maintain the full expanded 250+ film library
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

  const personId = Number(filters?.person?.id);
  const hasPersonFilter = Number.isSafeInteger(personId) && personId > 0;
  const keywordIdsFilter = Array.isArray(filters?.keywords)
    ? filters.keywords.map((kw) => Number(kw?.id ?? kw)).filter((id) => Number.isSafeInteger(id) && id > 0)
    : [];
  const expandedProviderFilter = Array.isArray(filters?.providers) && filters.providers.length > 0
    ? new Set(expandProviderIds(filters.providers))
    : null;

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

    const itemRuntime = parseRuntimeMinutes(m);
    if (runtimeMin !== null && (!itemRuntime || itemRuntime < runtimeMin)) return false;
    if (runtimeMax !== null && (!itemRuntime || itemRuntime > runtimeMax)) return false;

    const score = Number(m.imdbRating ?? m.vote_average ?? 0);
    if (minImdb > 0 && (!Number.isFinite(score) || score < minImdb)) return false;
    if (minVotes > 0 && Number(m.vote_count || 0) < minVotes) return false;

    if (language) {
      const itemLang = parseOriginalLanguage(m);
      if (!itemLang || itemLang !== language) return false;
    }

    if (country) {
      const countries = parseOriginCountries(m);
      if (countries.length === 0 || !countries.includes(country)) return false;
    }

    if (hasPersonFilter) {
      const itemPeople = extractNumericIds([
        ...(Array.isArray(m.personIds) ? m.personIds : []),
        ...(Array.isArray(m.castIds) ? m.castIds : []),
        ...(m.crewPersonId ? [m.crewPersonId] : [])
      ]);
      if (!itemPeople.includes(personId)) return false;
    }

    if (keywordIdsFilter.length > 0) {
      const itemKeywords = extractNumericIds(
        Array.isArray(m.keywordIds) ? m.keywordIds : m.tmdbKeywords
      );
      if (!keywordIdsFilter.every((kid) => itemKeywords.includes(kid))) return false;
    }

    if (expandedProviderFilter && expandedProviderFilter.size > 0) {
      const itemProviders = extractNumericIds([
        ...(Array.isArray(m.providerIds) ? m.providerIds : []),
        ...(Array.isArray(m.streamProviders) ? m.streamProviders : []),
        ...(Array.isArray(m.freeProviders) ? m.freeProviders : [])
      ]);
      if (!itemProviders.some((pid) => expandedProviderFilter.has(pid))) return false;
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
 * Generates an expanded ~250-film personalized unseen catalog using CinemaVault's full
 * on-device ML stack (25k CVEM v1 embeddings + content embeddings + DNA + logistic ranker)
 * in 3 progressive waves:
 *   - Wave 1 (~1-2s): Fast TMDB Discover + top 40 CVEM neighbors -> instant poster render
 *   - Wave 2 (~4-8s): Background expansion to ~250 films with top-120 deep metadata cap
 *   - Wave 3 (background): Single Flash-Lite batch pass polishing top 100 flagship picks
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
  contentIndex: injectedContentIndex = undefined,
  dnaIndex: injectedDnaIndex = undefined,
  fetchCandidatePoolFn = fetchCandidatePool,
  fetchEmbeddingFn = fetchEmbeddingCandidates,
  enrichPoolFn = enrichCandidatePoolMetadata,
  onPreliminaryReady = null,
  onStageUpdate = null,
  signal = null,
  targetCount = EXPLORE_FOR_YOU_TARGET_COUNT,
  now = Date.now()
} = {}) {
  const resolvedRegion = userRegion && userRegion !== "GLOBAL" ? userRegion : "US";
  const profileHash = buildExploreForYouProfileHash({ watched, watchlist, tasteRules, userRegion });

  const emitStage = (payload) => {
    if (typeof onStageUpdate === "function" && !signal?.aborted) {
      try {
        onStageUpdate(payload);
      } catch {
        // ignore UI callback errors
      }
    }
  };

  const emitPreliminary = (payload) => {
    if (typeof onPreliminaryReady === "function" && !signal?.aborted && Array.isArray(payload?.items) && payload.items.length > 0) {
      try {
        onPreliminaryReady(payload);
      } catch {
        // ignore UI callback errors
      }
    }
  };

  emitStage({ stage: "profile", label: "Scanning your Taste DNA & local movie map…", count: 0, target: targetCount });

  const [profile, contentIndex, dnaIndex] = await Promise.all([
    extractTasteProfile(watched, watchlist, { now }).catch(() => ({
      lovedGenreNames: [],
      lovedGenreIds: [],
      weightedRatings: []
    })),
    injectedContentIndex !== undefined
      ? Promise.resolve(injectedContentIndex)
      : loadDefaultContentIndex().catch(() => null),
    injectedDnaIndex !== undefined
      ? Promise.resolve(injectedDnaIndex)
      : loadDefaultDnaIndex().catch(() => null)
  ]);

  if (signal?.aborted) {
    return { items: [], profileHash, source: "local-ranker", modelUsed: null, generatedAt: now, aborted: true };
  }

  const excludeIds = [
    ...(watched || []).flatMap((m) => [m?.tmdbId, m?.imdbID, m?.id]),
    ...(watchlist || []).flatMap((m) => [m?.tmdbId, m?.imdbID, m?.id]),
    ...(feedbackLog || [])
      .filter((f) => f && (f.action === "dismissed" || f.action === "already_seen"))
      .flatMap((f) => [f.tmdbId, f.imdbID, f.id])
  ].filter(Boolean);

  const numericExcludeSet = new Set([
    ...(watched || []).map((m) => Number(m?.tmdbId ?? m?.id ?? 0)),
    ...(watchlist || []).map((m) => Number(m?.tmdbId ?? m?.id ?? 0)),
    ...excludeIds.map((id) => Number(id || 0))
  ]);
  numericExcludeSet.delete(0);

  const repulsionWeight =
    Math.abs(DEFAULT_RANKER_WEIGHTS.repulsion) / DEFAULT_RANKER_WEIGHTS.collabSim;

  const embSignals = await computeExploreEmbeddingSignals({
    weightedRatings: profile.weightedRatings,
    excludeNumericIds: [...numericExcludeSet],
    topK: 240,
    repulsionWeight,
    embeddingIndex: injectedEmbeddingIndex
  }).catch(() => ({
    embeddingIndex: null,
    collabSimMap: null,
    repulsionMap: null,
    collabCatalogMax: null,
    alignedNeighbors: []
  }));

  if (signal?.aborted) {
    return { items: [], profileHash, source: "local-ranker", modelUsed: null, generatedAt: now, aborted: true };
  }

  const embeddingIndex = embSignals.embeddingIndex ?? (injectedEmbeddingIndex !== undefined ? injectedEmbeddingIndex : null);
  const collabSimMap = embSignals.collabSimMap || null;
  const repulsionMap = embSignals.repulsionMap || null;
  const collabCatalogMax = embSignals.collabCatalogMax ?? null;
  const aligned = Array.isArray(embSignals.alignedNeighbors) ? embSignals.alignedNeighbors : [];

  const rankerWeights = derivePersonalizedRankerWeights(
    feedbackLog,
    watched,
    DEFAULT_RANKER_WEIGHTS
  );

  const poolGoal = Math.max(targetCount + 40, 300);
  const todayIso = getTodayIso(now);

  const dedupeAndFilterRaw = (list) => {
    const dedup = new Map();
    for (const c of list || []) {
      if (!c) continue;
      const tid = Number(c.tmdbId || c.id);
      if (!Number.isFinite(tid) || dedup.has(tid)) continue;
      if (c.release_date && String(c.release_date) > todayIso) continue;
      if (!c.poster && !c.poster_path) continue;
      dedup.set(tid, c);
    }
    return [...dedup.values()];
  };

  const rankAndNormalizePool = (rawPool, limit = poolGoal) => {
    const contentSimMap = contentIndex
      ? buildContentSimMap(profile.weightedRatings, contentIndex, rawPool, {
          collabIndex: embeddingIndex,
          collabSimMap,
          enableStructuredFallback: true,
          coldOnly: true
        })
      : null;
    const dnaSimMap = dnaIndex ? buildDnaSimMap(profile.weightedRatings, dnaIndex) : null;
    const ranked = rankCandidatePool(
      rawPool,
      {
        profile,
        mood: "any",
        excludeIds,
        collabSimMap,
        contentSimMap,
        dnaSimMap,
        repulsionMap,
        collabCatalogMax,
        userProviders: userWatchProviders,
        tasteRules
      },
      rankerWeights,
      limit
    );
    return ranked.map(normalizeCandidateForExplore);
  };

  let normalizedRanked = [];
  let mathBaselineItems = [];

  if (Array.isArray(injectedCandidates)) {
    normalizedRanked = rankAndNormalizePool([...injectedCandidates], poolGoal);
    mathBaselineItems = mergeExploreForYouResponse(normalizedRanked, [], { targetCount });
    emitPreliminary({
      items: mathBaselineItems,
      profileHash,
      source: "local-ranker",
      stage: "wave2",
      modelUsed: null,
      generatedAt: now
    });
  } else {
    // WAVE 1 (~1-2s): Fast Discover + top 40 CVEM neighbors in parallel — NO 300-item enrichment block!
    const wave1Aligned = aligned.slice(0, 60);
    const [wave1Base, wave1Emb] = await Promise.all([
      fetchCandidatePoolFn(profile, "any", watched, watchlist, {
        poolSize: EXPLORE_FOR_YOU_WAVE1_POOL_SIZE,
        userRegion: resolvedRegion,
        userWatchProviders,
        now
      }).catch(() => []),
      wave1Aligned.length > 0
        ? fetchEmbeddingFn(wave1Aligned, watched, watchlist, [], {
            userRegion: resolvedRegion,
            userProviders: userWatchProviders,
            maxNeighbors: EXPLORE_FOR_YOU_WAVE1_NEIGHBORS,
            maxScan: 60
          }).catch(() => [])
        : Promise.resolve([])
    ]);

    if (signal?.aborted) {
      return { items: [], profileHash, source: "local-ranker", modelUsed: null, generatedAt: now, aborted: true };
    }

    const wave1Raw = dedupeAndFilterRaw([...wave1Base, ...wave1Emb]);
    const wave1Normalized = rankAndNormalizePool(wave1Raw, Math.max(wave1Raw.length, 120));
    const wave1Items = mergeExploreForYouResponse(wave1Normalized, [], { targetCount });

    if (wave1Items.length > 0) {
      emitPreliminary({
        items: wave1Items,
        profileHash,
        source: "local-ranker",
        stage: "wave1",
        modelUsed: null,
        generatedAt: now
      });
      emitStage({
        stage: "wave2",
        label: `Expanding library (${wave1Items.length} → ${targetCount} films)…`,
        count: wave1Items.length,
        target: targetCount
      });
    }

    if (signal?.aborted) {
      return { items: wave1Items, profileHash, source: "local-ranker", modelUsed: null, generatedAt: now, aborted: true };
    }

    // WAVE 2 (background): Expand to full ~250 films and cap deep enrichment at top 120
    const wave2Aligned = aligned.slice(60, 240);
    const [wave2Base, wave2Emb] = await Promise.all([
      fetchCandidatePoolFn(profile, "any", watched, watchlist, {
        poolSize: 160,
        pageOffset: 1,
        userRegion: resolvedRegion,
        userWatchProviders,
        now
      }).catch(() => []),
      wave2Aligned.length > 0
        ? fetchEmbeddingFn(wave2Aligned, watched, watchlist, wave1Raw, {
            userRegion: resolvedRegion,
            userProviders: userWatchProviders,
            maxNeighbors: 120,
            maxScan: 180
          }).catch(() => [])
        : Promise.resolve([])
    ]);

    if (signal?.aborted) {
      return { items: wave1Items, profileHash, source: "local-ranker", modelUsed: null, generatedAt: now, aborted: true };
    }

    const mergedWave2Raw = dedupeAndFilterRaw([...wave1Raw, ...wave2Base, ...wave2Emb]);
    // Pre-rank so deep metadata enrichment runs ONLY on the top EXPLORE_FOR_YOU_ENRICH_LIMIT (120) films
    const preRankedRaw = rankCandidatePool(
      mergedWave2Raw,
      {
        profile,
        mood: "any",
        excludeIds,
        collabSimMap,
        contentSimMap: null,
        dnaSimMap: null,
        repulsionMap,
        collabCatalogMax,
        userProviders: userWatchProviders,
        tasteRules
      },
      rankerWeights,
      poolGoal
    );
    const enrichCap = Math.min(preRankedRaw.length, EXPLORE_FOR_YOU_ENRICH_LIMIT);
    const topToEnrich = preRankedRaw.slice(0, enrichCap);
    const tailCandidates = preRankedRaw.slice(enrichCap);
    const enrichedTop = await enrichPoolFn(topToEnrich, {
      maxEnrich: enrichCap,
      userRegion: resolvedRegion
    }).catch(() => topToEnrich);

    if (signal?.aborted) {
      return { items: wave1Items, profileHash, source: "local-ranker", modelUsed: null, generatedAt: now, aborted: true };
    }

    const combinedFinalRaw = dedupeAndFilterRaw([...enrichedTop, ...tailCandidates]);
    normalizedRanked = rankAndNormalizePool(combinedFinalRaw, poolGoal);
    mathBaselineItems = mergeExploreForYouResponse(normalizedRanked, [], { targetCount });

    emitPreliminary({
      items: mathBaselineItems,
      profileHash,
      source: "local-ranker",
      stage: "wave2",
      modelUsed: null,
      generatedAt: now
    });
  }

  if (signal?.aborted) {
    return {
      items: mathBaselineItems,
      profileHash,
      source: "local-ranker",
      modelUsed: null,
      generatedAt: now,
      aborted: true
    };
  }

  const ai = aiClient !== undefined ? aiClient : createGeminiClient(resolveGeminiKey());

  if (!ai || normalizedRanked.length === 0) {
    return {
      items: mathBaselineItems,
      profileHash,
      source: "local-ranker",
      modelUsed: null,
      generatedAt: now
    };
  }

  emitStage({
    stage: "wave3",
    label: "Polishing top picks with AI…",
    count: mathBaselineItems.length,
    target: targetCount
  });

  // Single Flash-Lite call refines top <=100 flagship picks while math populates the full ~250 catalog
  const aiBatchCandidates = normalizedRanked.slice(0, EXPLORE_FOR_YOU_AI_BATCH_LIMIT);
  const prompt = buildExploreForYouBatchPrompt(profile, aiBatchCandidates, {
    watched,
    tasteRules,
    targetCount: EXPLORE_FOR_YOU_AI_BATCH_LIMIT
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
      { cascadeType: "fast", timeoutMs: 25000, maxCascadeDurationMs: 45000 }
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
    items: mathBaselineItems,
    profileHash,
    source: "local-ranker",
    modelUsed: null,
    generatedAt: now
  };
}
