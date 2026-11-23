import { Type } from "@google/genai";
import {
  findTmdbByTitleAndYear,
  fetchBatchFormattedDetailsMap,
  matchesWatchProviders,
  isSeriesVaultItem
} from "../../src/services/tmdbService.js";
import { isSameMovie } from "../../src/services/movieIdentity.js";
import {
  isExplicitMoodActive,
  matchesMoodCandidateGate,
  normalizeMoodFilters
} from "../../src/services/moodPolicy.js";
import {
  compileActiveTasteRules,
  candidateMatchesAvoidRule
} from "../../src/services/tasteRulesService.js";
import { cleanStr } from "../../src/services/geminiService.js";

function extractYearMonthTag(item = {}) {
  const raw = String(item.dateWatched || item.watchedDate || item.addedAt || item.createdAt || "").trim();
  if (!raw) return "";
  const ym = raw.match(/^(\d{4})-(\d{2})/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  const yOnly = raw.match(/^(\d{4})/);
  if (yOnly) return yOnly[1];
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 7);
  }
  return "";
}

function getDateSortScore(item = {}) {
  const raw = String(item.dateWatched || item.watchedDate || item.addedAt || item.createdAt || "").trim();
  if (!raw) return 0;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function formatCompactVaultLine(item = {}, { includeRating = false } = {}) {
  const title = cleanStr(item.title || item.Title || "Untitled");
  const year = cleanStr(item.year || item.Year || "N/A");
  const directorRaw = cleanStr(item.director || item.Director || "");
  const hasDirector =
    directorRaw &&
    directorRaw !== "Unknown" &&
    directorRaw !== "N/A" &&
    directorRaw !== "Imported";
  const dirPart = hasDirector ? ` | Dir: ${directorRaw}` : "";
  const ratingPart = includeRating && Number(item.userRating) > 0 ? ` [${Number(item.userRating)}/10]` : "";
  const dateTag = extractYearMonthTag(item);
  const datePart = dateTag ? ` [${dateTag}]` : "";
  const noteRaw = cleanStr(item.userNote || item.UserNote || "");
  const notePart = noteRaw ? ` — ${noteRaw.slice(0, 180)}` : "";
  const seriesTag = isSeriesVaultItem(item) ? " [SERIES]" : "";
  return `- ${title} (${year})${seriesTag}${dirPart}${ratingPart}${datePart}${notePart}`;
}

function sortNewestFirst(items = []) {
  return [...items].sort((a, b) => {
    const diff = getDateSortScore(b) - getDateSortScore(a);
    if (diff !== 0) return diff;
    return Number(b.userRating || 0) - Number(a.userRating || 0);
  });
}

/**
 * Formats a Schema v2 vault cleanly by rating tier (newest first), stripping poster URLs,
 * preserving directors/notes, and separating TV series into their own taste-signal block.
 */
export function formatTieredVault(watched = [], watchlist = [], prefs = {}) {
  const watchedList = Array.isArray(watched) ? watched.filter(Boolean) : [];
  const watchListItems = Array.isArray(watchlist) ? watchlist.filter(Boolean) : [];

  const movies = watchedList.filter((m) => !isSeriesVaultItem(m));
  const series = watchedList.filter((m) => isSeriesVaultItem(m));

  const ratedMovies = movies.filter((m) => Number(m.userRating) > 0);
  const meanRating =
    ratedMovies.length > 0
      ? ratedMovies.reduce((sum, m) => sum + Number(m.userRating), 0) / ratedMovies.length
      : 0;

  const region = cleanStr(prefs?.userRegion || "GLOBAL") || "GLOBAL";
  const providers = Array.isArray(prefs?.userWatchProviders) ? prefs.userWatchProviders.filter(Boolean) : [];
  const providerNames = providers.map((p) => {
    const str = String(p).trim();
    const mapById = { "8": "Netflix", "9": "Amazon Prime", "337": "Disney+", "1899": "Max (HBO)", "350": "Apple TV+", "15": "Hulu", "531": "Paramount+", "386": "Peacock", "258": "Criterion Channel" };
    return mapById[str] || str;
  });
  const providerStr = providerNames.length > 0 ? providerNames.join(", ") : "None (all availability)";

  const tier10 = sortNewestFirst(movies.filter((m) => Number(m.userRating) >= 10));
  const tier9 = sortNewestFirst(movies.filter((m) => Number(m.userRating) >= 9 && Number(m.userRating) < 10));
  const tier8 = sortNewestFirst(movies.filter((m) => Number(m.userRating) >= 8 && Number(m.userRating) < 9));
  const tier67 = sortNewestFirst(movies.filter((m) => Number(m.userRating) >= 6 && Number(m.userRating) < 8));
  const tierDisliked = sortNewestFirst(
    movies.filter((m) => Number(m.userRating) > 0 && Number(m.userRating) <= 5)
  );
  const unratedMovies = sortNewestFirst(movies.filter((m) => !(Number(m.userRating) > 0)));
  const sortedSeries = sortNewestFirst(series);

  const sections = [
    "=== MY STATS ===",
    `${movies.length} movies (${ratedMovies.length} rated | Mean: ${meanRating.toFixed(2)}/10) | ${series.length} series | ${watchListItems.length} watchlist | Region: ${region} | Streaming: ${providerStr}`
  ];

  const pushTier = (heading, items, opts = {}) => {
    if (items.length === 0) return;
    sections.push("", heading, ...items.map((item) => formatCompactVaultLine(item, opts)));
  };

  pushTier("=== 10/10 MASTERPIECES ===", tier10);
  pushTier("=== 9/10 FAVORITES ===", tier9);
  pushTier("=== 8/10 GREAT ===", tier8);
  pushTier("=== 6-7/10 NEAR MISSES (Liked parts, flawed — study the gap vs 9-10/10) ===", tier67, {
    includeRating: true
  });
  pushTier("=== <=5/10 DISLIKED (Avoid similar tone/tropes) ===", tierDisliked, {
    includeRating: true
  });
  pushTier("=== WATCHED (Unrated) ===", unratedMovies);
  pushTier("=== LOVED SERIES / ANIME (Tone signal only — DO NOT recommend TV series) ===", sortedSeries, {
    includeRating: true
  });
  pushTier("=== WATCHLIST (Already planned — DO NOT recommend) ===", watchListItems);

  const text = sections.join("\n");
  return {
    text,
    stats: {
      movieCount: movies.length,
      ratedMovieCount: ratedMovies.length,
      seriesCount: series.length,
      watchlistCount: watchListItems.length,
      meanRating: Number(meanRating.toFixed(2)),
      charLength: text.length,
      estimatedTokens: Math.ceil(text.length / 4)
    }
  };
}

/**
 * Builds the unconstrained full-vault curation prompt (Ideas A + C) aligned with Track 1's prose rules.
 */
export function buildFullVaultPrompt({
  vaultText = "",
  moodLabel = "Any Vibe",
  moodDirective = "Match the viewer's core taste profile across top-tier cinema.",
  vibeConstraints = [],
  tasteRules = [],
  region = "GLOBAL",
  providers = [],
  excludeTitles = [],
  requestedCount = 15,
  blindspotCount = 3
} = {}) {
  const { activeRules } = compileActiveTasteRules(tasteRules);
  const ruleLines = activeRules
    .slice()
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    .map((r) => `- [${r.pinned ? "PINNED " : ""}${r.polarity === "avoid" ? "Avoid" : "Prefer"}] ${r.text}`);

  const providerLine =
    Array.isArray(providers) && providers.length > 0
      ? `${region} (${providers.join(", ")})`
      : `${region} (No streaming restriction)`;

  const constraintLines = Array.isArray(vibeConstraints) && vibeConstraints.length > 0
    ? vibeConstraints.join(" | ")
    : "None";

  const excludeBlock =
    Array.isArray(excludeTitles) && excludeTitles.length > 0
      ? `- Exclude these previously suggested titles: ${excludeTitles.join(", ")}`
      : "";

  return `You are an elite film curator and cinema intelligence engine analyzing my COMPLETE watch history, directors, ratings, notes, series tone signals, and watchlist below.

ACTIVE REQUEST:
- Selected Mood / Vibe: "${cleanStr(moodLabel)}" — ${cleanStr(moodDirective)}
- Custom Vibe Constraints: ${constraintLines}
- Streaming Region & Services: ${providerLine}
${ruleLines.length > 0 ? `- User Steerable Taste Rules (Follow strictly):\n${ruleLines.join("\n")}` : "- User Steerable Taste Rules: None"}
${excludeBlock}

COMPLETE VAULT DIARY:
${vaultText}

INSTRUCTIONS:
1. Before recommending any movie, construct "tasteThesis" by deeply contrasting ALL rating tiers:
   - hiddenAttractors: 3 subtle tonal, structural, or thematic patterns uniting the 9–10/10 films (beyond surface genre labels).
   - nearMissTraps: 3 specific flaws or tonal ceilings explaining why the 6–7/10 near-misses stopped short of 9–10/10.
   - dealbreakers: 3 recurring tone/trope dealbreakers visible in <=5/10 dislikes.
   - tasteDrift: 1 concise sentence tracking how 2024–2026 watches evolved relative to earlier favorites.
2. Recommend ${requestedCount} theatrical feature films matched directly to that tasteThesis and the ACTIVE REQUEST (including exactly ${blindspotCount} "isBlindspot": true picks from countries, eras, or directors absent from the vault that fit the same psychological profile).
3. STRICTLY DO NOT recommend any movie already in the Watched tiers or Watchlist above.
4. DO NOT recommend TV series/miniseries or numbered sequels/Part 2+ unless an earlier installment appears in the Watched tiers.
5. AVOID lazy "IMDb/Reddit Top 50" clichés unless genuinely non-obvious; aim for a rich mix of acclaimed deep cuts, international cinema, and 2024–2026 releases where fitting.
6. CRITICAL STYLE RULES FOR "reason" AND OUTPUT:
   - Write clean, human cinema prose (1 upright editorial sentence explaining why the film fits their vibe and anchors — never generic plot summary).
   - NEVER include internal system labels, scoring jargon, badges, percentages, or model names (forbid phrases like "Taste-Twin Match", "Core Theme Match", "Genre Bullseye", "% Match", or "Gemini").
   - Include "anchorTitles": 1 to 3 exact movie titles from the 9–10/10 tiers that this pick pairs best with.
   - Return strict JSON matching the schema.`;
}

/**
 * Returns Gemini JSON responseSchema for Full-Vault runs.
 */
export function buildFullVaultResponseSchema({ includeThesis = true } = {}) {
  const properties = {};
  const required = [];

  if (includeThesis) {
    properties.tasteThesis = {
      type: Type.OBJECT,
      properties: {
        hiddenAttractors: { type: Type.ARRAY, items: { type: Type.STRING } },
        nearMissTraps: { type: Type.ARRAY, items: { type: Type.STRING } },
        dealbreakers: { type: Type.ARRAY, items: { type: Type.STRING } },
        tasteDrift: { type: Type.STRING }
      },
      required: ["hiddenAttractors", "nearMissTraps", "dealbreakers", "tasteDrift"]
    };
    required.push("tasteThesis");
  }

  properties.recommendations = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        year: { type: Type.STRING },
        anchorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
        reason: { type: Type.STRING },
        isBlindspot: { type: Type.BOOLEAN }
      },
      required: ["title", "year", "anchorTitles", "reason", "isBlindspot"]
    }
  };
  required.push("recommendations");

  return {
    type: Type.OBJECT,
    properties,
    required
  };
}

/**
 * Formats Hydrogen's tasteThesis into a compact (~<=700 token) Taste Manifesto for fast curation.
 */
export function formatDossierBlock(tasteThesis = null, maxChars = 2800) {
  if (!tasteThesis || typeof tasteThesis !== "object") return "";
  const listFmt = (arr = []) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => cleanStr(s))
      .filter(Boolean)
      .slice(0, 3)
      .map((s) => `  • ${s.slice(0, 220)}`)
      .join("\n");

  const attractors = listFmt(tasteThesis.hiddenAttractors);
  const traps = listFmt(tasteThesis.nearMissTraps);
  const dealbreakers = listFmt(tasteThesis.dealbreakers);
  const drift = cleanStr(tasteThesis.tasteDrift || "").slice(0, 280);

  const lines = [
    "HYDROGEN TASTE DOSSIER (Deep full-vault synthesis — treat as high-priority taste signal):",
    attractors ? `- Hidden Attractors (Why 9-10/10s hit):\n${attractors}` : "",
    traps ? `- Near-Miss Traps (Why 6-7/10s fell short):\n${traps}` : "",
    dealbreakers ? `- Hard Dealbreakers (From <=5/10s):\n${dealbreakers}` : "",
    drift ? `- Recent Taste Drift: ${drift}` : ""
  ].filter(Boolean);

  return lines.join("\n").slice(0, maxChars);
}

/**
 * Injects the Hydrogen Taste Dossier into Track 1's re-rank prompt right before PRE-RANKED CANDIDATE MOVIES.
 */
export function buildDossierCurationPrompt(baseReRankPrompt = "", tasteThesis = null) {
  const dossier = formatDossierBlock(tasteThesis);
  if (!dossier) return baseReRankPrompt;
  const marker = "PRE-RANKED CANDIDATE MOVIES";
  const idx = baseReRankPrompt.indexOf(marker);
  if (idx >= 0) {
    return `${baseReRankPrompt.slice(0, idx)}${dossier}\n\n${baseReRankPrompt.slice(idx)}`;
  }
  return `${baseReRankPrompt}\n\n${dossier}`;
}


const DISPOSITION_KEYS = [
  "collision_watched",
  "collision_watchlist",
  "collision_excluded",
  "duplicate_within_batch",
  "hallucinated_or_unmatched",
  "tv_series",
  "failed_provider",
  "failed_mood",
  "failed_avoid",
  "survived"
];

function extractCandidateYearNum(item = {}) {
  const m = String(item.release_date || item.releaseDate || item.year || item.Year || "").match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function medianOf(nums = []) {
  const valid = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 1 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

/**
 * Verifies generative LLM picks against TMDB, watched/watchlist/prior-batch collisions,
 * TV-series guards, streaming providers, mood gates, and avoid rules, recording exact disposition per pick.
 */
export async function verifyGenerativePicks(rawPicks = [], context = {}, deps = {}) {
  const counts = Object.fromEntries(DISPOSITION_KEYS.map((k) => [k, 0]));
  const audit = [];
  const list = Array.isArray(rawPicks) ? rawPicks : [];
  if (list.length === 0) {
    return { survivors: [], audit, counts };
  }

  const watched = Array.isArray(context.watched) ? context.watched : [];
  const watchlist = Array.isArray(context.watchlist) ? context.watchlist : [];
  const excludeIds = Array.isArray(context.excludeIds) ? context.excludeIds : [];
  const excludeMovies = Array.isArray(context.excludeMovies) ? context.excludeMovies : [];
  const userRegion = context.userRegion || "US";
  const userProviders = Array.isArray(context.userProviders) ? context.userProviders : [];
  const hasProviderFilter = userProviders.length > 0;
  const mood = context.mood ?? "any";
  const moodFilters = normalizeMoodFilters(context.moodFilters);
  const explicitMood = isExplicitMoodActive(mood, moodFilters);
  const { avoidRules } = Array.isArray(context.tasteRules) && context.tasteRules.length > 0
    ? compileActiveTasteRules(context.tasteRules)
    : { avoidRules: [] };
  const collabSimMap = context.collabSimMap instanceof Map ? context.collabSimMap : null;

  const isIdExcluded = (item) => {
    const idNum = Number(item?.tmdbId ?? item?.id ?? 0);
    if (Number.isInteger(idNum) && idNum > 0 && excludeIds.some((ex) => Number(ex?.tmdbId ?? ex?.id ?? ex) === idNum)) {
      return true;
    }
    return excludeMovies.some((ex) => isSameMovie(item, ex));
  };

  const preCheckCollision = (candidate) => {
    if (watched.some((w) => isSameMovie(candidate, w))) return "collision_watched";
    if (watchlist.some((w) => isSameMovie(candidate, w))) return "collision_watchlist";
    if (isIdExcluded(candidate)) return "collision_excluded";
    return null;
  };

  const finder = typeof deps.finder === "function"
    ? deps.finder
    : (title, year) => findTmdbByTitleAndYear(title, year, {
        strict: true,
        fetchFn: deps.fetchFn,
        apiKey: deps.apiKey,
        forceProxy: deps.forceProxy,
        signal: deps.signal
      });

  const resolved = [];
  const seenStubIds = new Set();

  for (let i = 0; i < list.length; i++) {
    const pick = list[i];
    if (!pick || typeof pick !== "object") {
      counts.hallucinated_or_unmatched += 1;
      audit.push({ index: i, rawPick: pick, status: "hallucinated_or_unmatched", detail: "Malformed pick object" });
      continue;
    }

    const title = cleanStr(pick.title || "");
    if (!title) {
      counts.hallucinated_or_unmatched += 1;
      audit.push({ index: i, rawPick: pick, status: "hallucinated_or_unmatched", detail: "Empty title" });
      continue;
    }

    if (isSeriesVaultItem(pick)) {
      counts.tv_series += 1;
      audit.push({ index: i, rawPick: pick, status: "tv_series", detail: "Marked as series in raw pick" });
      continue;
    }

    let stub = null;
    try {
      stub = await finder(title, pick.year);
    } catch (_) {
      stub = null;
    }

    if (!stub) {
      const preCollision = preCheckCollision({ title, year: pick.year });
      const status = preCollision || "hallucinated_or_unmatched";
      counts[status] += 1;
      audit.push({ index: i, rawPick: pick, status, detail: "No strict TMDB match" });
      continue;
    }

    const tmdbId = Number(stub.tmdbId ?? stub.id ?? 0);
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
      counts.hallucinated_or_unmatched += 1;
      audit.push({ index: i, rawPick: pick, status: "hallucinated_or_unmatched", detail: "Invalid TMDB ID" });
      continue;
    }

    if (isSeriesVaultItem(stub)) {
      counts.tv_series += 1;
      audit.push({ index: i, rawPick: pick, tmdbId, status: "tv_series", detail: "TMDB stub resolved as series" });
      continue;
    }

    const collision = preCheckCollision({ ...stub, tmdbId, title: stub.title || title, year: stub.year || pick.year });
    if (collision) {
      counts[collision] += 1;
      audit.push({ index: i, rawPick: pick, tmdbId, status: collision });
      continue;
    }

    if (seenStubIds.has(tmdbId)) {
      counts.duplicate_within_batch += 1;
      audit.push({ index: i, rawPick: pick, tmdbId, status: "duplicate_within_batch" });
      continue;
    }

    seenStubIds.add(tmdbId);
    resolved.push({ index: i, pick, stub, tmdbId });
  }

  let detailsMap = new Map();
  if (resolved.length > 0) {
    if (typeof deps.detailFetcher === "function") {
      await Promise.all(
        resolved.map(async ({ tmdbId }) => {
          try {
            const d = await deps.detailFetcher(tmdbId, userRegion);
            if (d) detailsMap.set(tmdbId, d);
          } catch (_) {}
        })
      );
    } else {
      try {
        detailsMap = await fetchBatchFormattedDetailsMap(
          resolved.map((r) => r.tmdbId),
          userRegion,
          {
            fetchFn: deps.fetchFn,
            apiKey: deps.apiKey,
            forceProxy: deps.forceProxy,
            bypassCache: deps.bypassCache,
            signal: deps.signal
          }
        );
      } catch (_) {
        detailsMap = new Map();
      }
    }
  }

  const survivors = [];
  for (const { index, pick, stub, tmdbId } of resolved) {
    const details = detailsMap.get(tmdbId);
    if (!details && !stub.hydrated) {
      counts.hallucinated_or_unmatched += 1;
      audit.push({ index, rawPick: pick, tmdbId, status: "hallucinated_or_unmatched", detail: "Detail hydration failed" });
      continue;
    }

    const fullCand = {
      ...stub,
      ...(details || {}),
      id: details?.tmdbId || tmdbId,
      tmdbId: details?.tmdbId || tmdbId,
      imdbID: details?.imdbID ?? stub.imdbID ?? null,
      title: details?.title || stub.title,
      year: details?.year || stub.year || "N/A",
      release_date: details?.release_date || stub.release_date || "",
      overview: details?.plot || details?.overview || stub.overview || "",
      plot: details?.plot || details?.overview || stub.overview || "",
      genre: details?.genre || stub.genre || "Cinema",
      director: details?.director || stub.director || "",
      tmdbGenreIds: Array.isArray(details?.tmdbGenreIds)
        ? details.tmdbGenreIds
        : (stub.tmdbGenreIds || stub.genre_ids || []),
      tmdbKeywords: Array.isArray(details?.tmdbKeywords)
        ? details.tmdbKeywords
        : (stub.tmdbKeywords || []),
      keywordNames: Array.isArray(details?.keywordNames)
        ? details.keywordNames
        : (stub.keywordNames || []),
      streamProviders: Array.isArray(details?.streamProviders)
        ? details.streamProviders
        : (stub.streamProviders || []),
      freeProviders: Array.isArray(details?.freeProviders)
        ? details.freeProviders
        : (stub.freeProviders || []),
      providersHydrated: true,
      hydrated: true,
      vote_count: Number(details?.vote_count ?? stub.vote_count ?? 0),
      vote_average: Number(details?.vote_average ?? stub.vote_average ?? 0),
      collabSim: collabSimMap ? Number(collabSimMap.get(tmdbId) ?? 0) : 0,
      reason: cleanStr(pick.reason || ""),
      anchorTitles: Array.isArray(pick.anchorTitles) ? pick.anchorTitles.map(cleanStr).filter(Boolean) : [],
      isBlindspot: Boolean(pick.isBlindspot)
    };

    if (isSeriesVaultItem(fullCand)) {
      counts.tv_series += 1;
      audit.push({ index, rawPick: pick, tmdbId, status: "tv_series" });
      continue;
    }

    const postCollision = preCheckCollision(fullCand);
    if (postCollision) {
      counts[postCollision] += 1;
      audit.push({ index, rawPick: pick, tmdbId, status: postCollision });
      continue;
    }

    if (survivors.some((s) => isSameMovie(s, fullCand))) {
      counts.duplicate_within_batch += 1;
      audit.push({ index, rawPick: pick, tmdbId, status: "duplicate_within_batch" });
      continue;
    }

    if (hasProviderFilter && !matchesWatchProviders(fullCand, userProviders)) {
      counts.failed_provider += 1;
      audit.push({ index, rawPick: pick, tmdbId, title: fullCand.title, status: "failed_provider" });
      continue;
    }

    if (explicitMood && !matchesMoodCandidateGate(fullCand, mood, moodFilters)) {
      counts.failed_mood += 1;
      audit.push({ index, rawPick: pick, tmdbId, title: fullCand.title, status: "failed_mood" });
      continue;
    }

    if (avoidRules.length > 0 && candidateMatchesAvoidRule(fullCand, avoidRules).matched) {
      counts.failed_avoid += 1;
      audit.push({ index, rawPick: pick, tmdbId, title: fullCand.title, status: "failed_avoid" });
      continue;
    }

    counts.survived += 1;
    audit.push({ index, rawPick: pick, tmdbId, title: fullCand.title, status: "survived" });
    survivors.push(fullCand);
  }

  return { survivors, audit, counts };
}

/**
 * Computes hard engineering metrics for one arm in a scenario.
 */
export function computeArmMetrics({
  armName,
  model,
  rawCount = 0,
  verifiedReport = null,
  finalPicks = [],
  track1FinalIds = new Set(),
  track1ShortlistIds = new Set(),
  collabSimMap = null,
  latencyMs = 0,
  usageMetadata = null
} = {}) {
  const picks = Array.isArray(finalPicks) ? finalPicks : [];
  const counts = verifiedReport?.counts || {};
  const t1Final = track1FinalIds instanceof Set ? track1FinalIds : new Set(track1FinalIds || []);
  const t1Short = track1ShortlistIds instanceof Set ? track1ShortlistIds : new Set(track1ShortlistIds || []);

  const pickIds = picks.map((p) => Number(p?.tmdbId ?? p?.id ?? 0)).filter((id) => Number.isInteger(id) && id > 0);
  const overlapWithTrack1Final = pickIds.filter((id) => t1Final.has(id)).length;
  const overlapWithTrack1Shortlist = pickIds.filter((id) => t1Short.has(id)).length;

  const voteCounts = picks.map((p) => Number(p?.vote_count ?? p?.voteCount ?? NaN)).filter((n) => Number.isFinite(n) && n > 0);
  const recent2024PlusCount = picks.filter((p) => {
    const yr = extractCandidateYearNum(p);
    return yr !== null && yr >= 2024;
  }).length;

  const collabSims = picks.map((p) => {
    const id = Number(p?.tmdbId ?? p?.id ?? 0);
    if (Number.isFinite(Number(p?.collabSim))) return Number(p.collabSim);
    if (Number.isFinite(Number(p?.features?.rawCollabSim))) return Number(p.features.rawCollabSim);
    if (collabSimMap instanceof Map && id > 0) return Number(collabSimMap.get(id) ?? 0);
    return 0;
  });

  const nonZeroCollab = collabSims.filter((v) => v > 0);
  const coldCollabCount = collabSims.filter((v) => v === 0).length;
  const meanCollabSimAll = collabSims.length > 0
    ? Number((collabSims.reduce((a, b) => a + b, 0) / collabSims.length).toFixed(4))
    : 0;
  const meanCollabSimIndexed = nonZeroCollab.length > 0
    ? Number((nonZeroCollab.reduce((a, b) => a + b, 0) / nonZeroCollab.length).toFixed(4))
    : 0;

  const wildcardCount = picks.filter((p) => p?.sourceBucket === "Gemini Wildcard").length;
  const collisionCount =
    Number(counts.collision_watched || 0) +
    Number(counts.collision_watchlist || 0) +
    Number(counts.collision_excluded || 0);
  const hallucinationOrTvCount =
    Number(counts.hallucinated_or_unmatched || 0) + Number(counts.tv_series || 0);
  const constraintViolationCount =
    Number(counts.failed_provider || 0) +
    Number(counts.failed_mood || 0) +
    Number(counts.failed_avoid || 0);

  return {
    armName,
    model,
    rawCount,
    survivedCount: verifiedReport ? verifiedReport.survivors.length : picks.length,
    finalCount: picks.length,
    collisionCount,
    hallucinationOrTvCount,
    constraintViolationCount,
    dispositionCounts: counts,
    overlapWithTrack1Final,
    overlapWithTrack1Shortlist,
    wildcardCount,
    medianVoteCount: Math.round(medianOf(voteCounts)),
    recent2024PlusCount,
    coldCollabCount,
    meanCollabSimAll,
    meanCollabSimIndexed,
    latencyMs: Math.round(Number(latencyMs) || 0),
    promptTokens: Number(usageMetadata?.promptTokenCount ?? 0),
    outputTokens: Number(usageMetadata?.candidatesTokenCount ?? 0),
    totalTokens: Number(usageMetadata?.totalTokenCount ?? 0)
  };
}


function mulberry32(seed = 1337) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringSeed(str = "") {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleWithRng(arr = [], rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getMovieIdentityKey(item = {}) {
  const tmdb = Number(item?.tmdbId ?? item?.id ?? 0);
  if (Number.isInteger(tmdb) && tmdb > 0) return `tmdb:${tmdb}`;
  const title = cleanStr(item?.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const year = cleanStr(item?.year || "").replace(/\D/g, "").slice(0, 4);
  return `ty:${title}:${year}`;
}

/**
 * Builds a Two-Pass Blind Ballot for one scenario (or multiple scenarios via offset).
 * Pass 1 hides all AI explanations and arm labels; Pass 2 randomizes anonymized pitches per movie.
 */
export function buildTwoPassBlindBallot({
  scenarioId = "scenario",
  scenarioLabel = "Scenario",
  arms = {},
  seed = null,
  startNum = 1
} = {}) {
  const rng = mulberry32(seed ?? hashStringSeed(scenarioId));
  const armNames = Object.keys(arms || {});
  const byKey = new Map();

  for (const armName of armNames) {
    const picks = Array.isArray(arms[armName]) ? arms[armName] : [];
    for (const pick of picks) {
      if (!pick) continue;
      const key = getMovieIdentityKey(pick);
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          tmdbId: Number(pick.tmdbId ?? pick.id ?? 0) || null,
          title: cleanStr(pick.title || "Untitled"),
          year: cleanStr(pick.year || "N/A"),
          director: cleanStr(pick.director || ""),
          genre: cleanStr(pick.genre || "Cinema"),
          overview: cleanStr(pick.overview || pick.plot || ""),
          arms: [],
          pitches: []
        });
      }
      const entry = byKey.get(key);
      if (!entry.arms.includes(armName)) entry.arms.push(armName);
      if (!entry.overview && (pick.overview || pick.plot)) {
        entry.overview = cleanStr(pick.overview || pick.plot);
      }
      if (!entry.director && pick.director) {
        entry.director = cleanStr(pick.director);
      }
      entry.pitches.push({
        arm: armName,
        reason: cleanStr(pick.reason || ""),
        anchorTitles: Array.isArray(pick.anchorTitles) ? pick.anchorTitles.map(cleanStr).filter(Boolean) : []
      });
    }
  }

  const shuffledMovies = shuffleWithRng(Array.from(byKey.values()), rng);
  const pitchLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const keyMovies = shuffledMovies.map((m, idx) => {
    const num = startNum + idx;
    const shuffledPitches = shuffleWithRng(m.pitches, rng).map((p, pIdx) => ({
      label: pitchLetters[pIdx] || `P${pIdx + 1}`,
      arm: p.arm,
      reason: p.reason,
      anchorTitles: p.anchorTitles
    }));
    return {
      num,
      scenarioId,
      tmdbId: m.tmdbId,
      title: m.title,
      year: m.year,
      director: m.director,
      genre: m.genre,
      overview: m.overview,
      arms: m.arms,
      pitches: shuffledPitches
    };
  });

  const pass1Lines = [
    `## PASS 1 — ${scenarioLabel} (Movies Only: Score BEFORE Reading Pass 2)`,
    "",
    "> Rate each movie `1` to `5` right after the colon (e.g., `4` or `4/5`).",
    ""
  ];

  for (const m of keyMovies) {
    const meta = [
      m.director && m.director !== "Unknown" && m.director !== "N/A" ? `Dir: ${m.director}` : "",
      m.genre || ""
    ].filter(Boolean).join(" | ");
    pass1Lines.push(`### Movie #${m.num}: ${m.title} (${m.year})`);
    if (meta) pass1Lines.push(`- **Info:** ${meta}`);
    if (m.overview) pass1Lines.push(`- **Overview:** ${m.overview}`);
    pass1Lines.push(`- Excitement (1-5): <!-- SCORE:M${m.num}:EXC -->`);
    pass1Lines.push(`- Discovery (1-5): <!-- SCORE:M${m.num}:DISC -->`);
    pass1Lines.push("");
  }

  const pass2Lines = [
    `## PASS 2 — ${scenarioLabel} (Explanations Only: Score AFTER Pass 1)`,
    "",
    "> Score how well each anonymized pitch understands your taste (`1` to `5`).",
    ""
  ];

  for (const m of keyMovies) {
    pass2Lines.push(`### Movie #${m.num}: ${m.title} (${m.year})`);
    for (const p of m.pitches) {
      const anchors = p.anchorTitles.length > 0 ? p.anchorTitles.join(", ") : "None listed";
      pass2Lines.push(`- **Pitch ${p.label}** — Anchors: ${anchors}`);
      pass2Lines.push(`  > ${p.reason || "(No reason provided)"}`);
      pass2Lines.push(`  - Pitch ${p.label} Taste Understanding (1-5): <!-- SCORE:M${m.num}:P${p.label}:TASTE -->`);
    }
    pass2Lines.push("");
  }

  const markdown = [
    `# Blind Evaluation Ballot — ${scenarioLabel}`,
    "",
    `Total unique movies: ${keyMovies.length}`,
    "",
    ...pass1Lines,
    "---",
    "",
    ...pass2Lines
  ].join("\n");

  return {
    markdown,
    key: {
      scenarioId,
      scenarioLabel,
      armNames,
      movies: keyMovies.map((m) => ({
        num: m.num,
        scenarioId: m.scenarioId,
        tmdbId: m.tmdbId,
        title: m.title,
        year: m.year,
        arms: m.arms,
        pitches: m.pitches.map((p) => ({ label: p.label, arm: p.arm }))
      }))
    }
  };
}

function parseScoreToken(line = "") {
  if (!line) return null;
  const cleaned = line.replace(/<!--[\s\S]*?-->/g, " ").trim();
  const afterColon = cleaned.includes(":") ? cleaned.slice(cleaned.indexOf(":") + 1) : cleaned;
  const match = afterColon.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*5)?/);
  if (!match) return null;
  const val = Number(match[1]);
  return Number.isFinite(val) && val >= 1 && val <= 5 ? val : null;
}

/**
 * Parses a filled-in Two-Pass Blind Ballot markdown against blind_key.json and computes per-arm averages.
 */
export function scoreBlindBallot(markdownText = "", blindKey = {}) {
  const movies = Array.isArray(blindKey?.movies) ? blindKey.movies : [];
  const armBuckets = new Map();
  const ensureArm = (arm) => {
    if (!armBuckets.has(arm)) {
      armBuckets.set(arm, { excitement: [], discovery: [], taste: [], movieCount: 0 });
    }
    return armBuckets.get(arm);
  };
  for (const arm of blindKey?.armNames || []) ensureArm(arm);

  const pass1Idx = markdownText.indexOf("## PASS 1");
  const pass2Idx = markdownText.indexOf("## PASS 2");
  const pass1Body = pass1Idx >= 0
    ? markdownText.slice(pass1Idx, pass2Idx > pass1Idx ? pass2Idx : markdownText.length)
    : markdownText;
  const pass2Body = pass2Idx >= 0 ? markdownText.slice(pass2Idx) : "";

  const splitMovieSections = (body) => {
    const map = new Map();
    const parts = body.split(/(?=^### Movie #\d+:)/m);
    for (const part of parts) {
      const hdr = part.match(/^### Movie #(\d+):/m);
      if (hdr) map.set(Number(hdr[1]), part);
    }
    return map;
  };

  const pass1Sections = splitMovieSections(pass1Body);
  const pass2Sections = splitMovieSections(pass2Body);

  let parsedMovies = 0;
  let unparsedMovies = 0;

  for (const m of movies) {
    const p1 = pass1Sections.get(m.num) || "";
    const p2 = pass2Sections.get(m.num) || "";

    const excLine = (p1.match(/^.*Excitement[^\r\n]*/im) || [""])[0];
    const discLine = (p1.match(/^.*Discovery[^\r\n]*/im) || [""])[0];
    const exc = parseScoreToken(excLine);
    const disc = parseScoreToken(discLine);

    if (exc !== null || disc !== null) {
      parsedMovies += 1;
      for (const arm of m.arms || []) {
        const b = ensureArm(arm);
        b.movieCount += 1;
        if (exc !== null) b.excitement.push(exc);
        if (disc !== null) b.discovery.push(disc);
      }
    } else {
      unparsedMovies += 1;
    }

    for (const pitch of m.pitches || []) {
      const re = new RegExp(`^.*Pitch\\s+${pitch.label}\\s+Taste[^\\r\\n]*`, "im");
      const tasteLine = (p2.match(re) || [""])[0];
      const taste = parseScoreToken(tasteLine);
      if (taste !== null) {
        ensureArm(pitch.arm).taste.push(taste);
      }
    }
  }

  const avg = (arr) => (arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null);
  const perArm = {};
  for (const [arm, b] of armBuckets.entries()) {
    const avgExcitement = avg(b.excitement);
    const avgDiscovery = avg(b.discovery);
    const avgTaste = avg(b.taste);
    const parts = [avgExcitement, avgDiscovery, avgTaste].filter((v) => v !== null);
    const composite = parts.length > 0 ? Number((parts.reduce((a, x) => a + x, 0) / parts.length).toFixed(2)) : null;
    perArm[arm] = {
      scoredMovies: b.movieCount,
      avgExcitement,
      avgDiscovery,
      avgTaste,
      composite
    };
  }

  const rows = Object.entries(perArm)
    .sort((a, b) => (b[1].composite ?? -1) - (a[1].composite ?? -1))
    .map(([arm, s]) =>
      `| ${arm} | ${s.scoredMovies} | ${s.avgExcitement ?? "—"} | ${s.avgDiscovery ?? "—"} | ${s.avgTaste ?? "—"} | **${s.composite ?? "—"}** |`
    );

  const summaryMarkdown = [
    "# Unblinded Evaluation Results",
    "",
    `- Parsed Movies: ${parsedMovies} / ${movies.length} (Unparsed: ${unparsedMovies})`,
    "",
    "| Arm | Scored Picks | Avg Excitement | Avg Discovery | Avg Taste | Composite |",
    "| :--- | :---: | :---: | :---: | :---: | :---: |",
    ...rows,
    ""
  ].join("\n");

  return {
    perArm,
    parsedMovies,
    unparsedMovies,
    summaryMarkdown
  };
}


/**
 * Combines multiple scenarios into one sequential two-pass blind ballot (Movie #1..#N).
 */
export function buildCombinedTwoPassBallot(scenarios = [], baseSeed = 2026) {
  let cursor = 1;
  const pass1Blocks = [];
  const pass2Blocks = [];
  const allMovies = [];
  const armNameSet = new Set();

  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    const single = buildTwoPassBlindBallot({
      scenarioId: sc.scenarioId,
      scenarioLabel: sc.scenarioLabel,
      arms: sc.arms,
      seed: baseSeed + i * 97,
      startNum: cursor
    });
    cursor += single.key.movies.length;
    for (const a of single.key.armNames) armNameSet.add(a);
    allMovies.push(...single.key.movies);

    const p1Idx = single.markdown.indexOf("## PASS 1");
    const p2Idx = single.markdown.indexOf("## PASS 2");
    const sepIdx = single.markdown.lastIndexOf("\n---\n", p2Idx);
    const p1Slice = single.markdown.slice(p1Idx, sepIdx > p1Idx ? sepIdx : p2Idx).trim();
    const p2Slice = single.markdown.slice(p2Idx).trim();
    pass1Blocks.push(p1Slice);
    pass2Blocks.push(p2Slice);
  }

  const markdown = [
    "# CinemaVault Blind Evaluation Ballot",
    "",
    `Total unique movie entries: ${allMovies.length} across ${scenarios.length} scenario(s).`,
    "Score ALL of Pass 1 first (Title + Overview only), then scroll down to score Pass 2 (anonymized Pitch A/B/C/D).",
    "",
    ...pass1Blocks,
    "",
    "---",
    "",
    ...pass2Blocks,
    ""
  ].join("\n");

  return {
    markdown,
    key: {
      scenarios: scenarios.map((s) => ({ scenarioId: s.scenarioId, scenarioLabel: s.scenarioLabel })),
      armNames: Array.from(armNameSet),
      movies: allMovies
    }
  };
}
