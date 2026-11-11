import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { spendTracker } from "./aiSpendTracker.js";
import {
    TMDB_KEY,
    extractTasteProfile,
    fetchCandidatePool,
    fetchEmbeddingCandidates,
    getFallbackPoster as getTmdbFallbackPoster
} from "./tmdbService.js";
import { rankCandidatePool } from "./rankerService.js";
import {
    loadDefaultEmbeddingIndex,
    buildCollabSimMapFromIndex,
    buildRepulsionMapFromIndex,
    computeUserPersonas,
    retrieveByEmbedding
} from "./embeddingService.js";

export const CURATION_MODEL_CASCADE = [
    "gemini-4-argon",
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash"
];

export const FAST_INTERACTIVE_CASCADE = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash"
];

export const MODELS = CURATION_MODEL_CASCADE;
const ARGON_MODEL = "gemini-4-argon";
const SMART_CACHE_KEY = 'cinemavault_smart_cache_v3';
const MAX_CACHE_BYTES = 500 * 1024; // 500KB Hard Cap

/**
 * Returns model-specific thinking configuration per Google API spec.
 * gemini-4-argon, 3.8-flash, and 3.5 models require thinkingLevel: "LOW" (bypasses 10-15s thinking pause, prevents 400s).
 * gemini-2.5-flash supports thinkingBudget: 0 for sub-second execution.
 */
export function getModelThinkingConfig(modelName = "") {
    const m = String(modelName || "").toLowerCase();
    if (m.includes("gemini-4-argon") || m.includes("gemini-3.8-flash") || m.includes("gemini-3.5-flash-lite") || m.includes("gemini-3.5-flash")) {
        return { thinkingLevel: "LOW" };
    }
    if (m.includes("gemini-2.5-flash")) {
        return { thinkingBudget: 0 };
    }
    return undefined;
}

let sessionCurationModel = null;
let sessionFastModel = null;
const sessionDegradedModels = new Set();

export const resetSessionWorkingModels = () => {
    sessionCurationModel = null;
    sessionFastModel = null;
    sessionDegradedModels.clear();
};

export const getSessionCurationModel = () => sessionCurationModel;
export const getSessionFastModel = () => sessionFastModel;

/**
 * Executes a resilient cascade across models with per-attempt timeout and session health memoization.
 */
export async function executeCascade(ai, cascade, requestParams, options = {}) {
    if (!ai?.models?.generateContent) {
        throw new Error("Invalid GoogleGenAI client provided to executeCascade");
    }

    const cascadeType = options.cascadeType || "curation";
    const activeModel = cascadeType === "curation" ? sessionCurationModel : sessionFastModel;

    let candidateModels = [...cascade];
    if (activeModel && candidateModels.includes(activeModel) && !sessionDegradedModels.has(activeModel)) {
        candidateModels = [activeModel, ...candidateModels.filter(m => m !== activeModel)];
    } else {
        candidateModels = candidateModels.filter(m => !sessionDegradedModels.has(m));
    }

    if (candidateModels.length === 0) {
        candidateModels = [...cascade];
    }

    let lastError = null;
    for (const model of candidateModels) {
        const isArgon = model.includes("argon");
        if (isArgon && typeof spendTracker?.canUseArgon === "function" && !spendTracker.canUseArgon()) {
            continue;
        }

        const thinkingConfig = getModelThinkingConfig(model);
        const mergedConfig = {
            ...(requestParams.config || {}),
            ...(thinkingConfig ? { thinkingConfig } : {})
        };

        const defaultTimeout = isArgon ? 12000 : 8000;
        const perAttemptTimeout = options.timeoutMs || defaultTimeout;

        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`Model ${model} timed out after ${perAttemptTimeout}ms`));
            }, perAttemptTimeout);
        });

        try {
            const callPromise = ai.models.generateContent({
                ...requestParams,
                model,
                config: mergedConfig
            });
            const response = await Promise.race([callPromise, timeoutPromise]);
            clearTimeout(timer);

            if (response?.usageMetadata && typeof spendTracker?.record === "function") {
                spendTracker.record(model, response.usageMetadata);
            }

            if (cascadeType === "curation") {
                sessionCurationModel = model;
            } else if (cascadeType === "fast") {
                sessionFastModel = model;
            }

            return response;
        } catch (err) {
            clearTimeout(timer);
            lastError = err;
            sessionDegradedModels.add(model);
            if (isArgon && typeof spendTracker?.markArgonUnavailable === "function") {
                spendTracker.markArgonUnavailable();
            }
            console.warn(`Model ${model} failed in ${cascadeType} cascade (${err.message || err}). Trying fallback...`);
        }
    }

    if (lastError) {
        console.warn(`All models in ${cascadeType} cascade failed:`, lastError.message || lastError);
    }
    return null;
}

/**
 * Sanitizes strings for prompt safety
 */
export const cleanStr = (val) => {
    if (val === null || val === undefined) return "";
    return String(val).replace(/[|\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
};

/**
 * Normalizes matchScore to a valid percentage (70 - 99)
 * Corrects LLM decimal probabilities (e.g., 0.94 -> 94) and raw 1s
 */
export const normalizeMatchScore = (val) => {
    let n = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(n) || n <= 0) return 88;
    // If LLM returned a decimal ratio (0.01 - 1.0) or edge 1
    if (n <= 1.0) {
        if (n <= 0.1) return Math.min(99, Math.max(75, Math.round(n * 1000))); // e.g. 0.09 -> 90
        return Math.min(99, Math.max(75, Math.round(n * 100)));
    }
    // If accidentally scored 1 (integer 1), map to realistic 88%
    if (n <= 5) return 88;
    return Math.min(99, Math.max(70, Math.round(n)));
};

/**
 * Resilient JSON Sanitizer & Parser
 * Handles markdown code-blocks (```json ... ```) and raw string quirks from LLMs
 */
export function sanitizeAndParseJSON(rawText) {
    if (!rawText) throw new Error("Empty response from AI engine");
    let cleaned = String(rawText).trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        cleaned = jsonMatch[1].trim();
    }
    return JSON.parse(cleaned);
}

/**
 * Master ID Cross-Referencing Collision Guard for LRU Cache
 */
export function getSmartCache(hash, watched = [], watchlist = []) {
    try {
        const cache = JSON.parse(localStorage.getItem(SMART_CACHE_KEY) || '{}');
        const entry = cache[hash];
        if (!entry || !entry.data || (Date.now() - (entry.ts || 0) > 24 * 60 * 60 * 1000)) {
            return null;
        }

        // Build master set of all known identifiers across vault and watchlist
        const currentIds = new Set([
            ...watched.flatMap(m => [
                m.imdbID ? String(m.imdbID).toLowerCase() : null,
                m.tmdbId ? String(m.tmdbId).toLowerCase() : null,
                m.id ? String(m.id).toLowerCase() : null
            ]).filter(Boolean),
            ...watchlist.flatMap(m => [
                m.imdbID ? String(m.imdbID).toLowerCase() : null,
                m.tmdbId ? String(m.tmdbId).toLowerCase() : null,
                m.id ? String(m.id).toLowerCase() : null
            ]).filter(Boolean)
        ]);

        const validRecs = (entry.data.recommendations || []).map(rec => ({
            ...rec,
            matchScore: normalizeMatchScore(rec.matchScore)
        })).filter(rec => {
            const recIds = [
                rec.imdbID ? String(rec.imdbID).toLowerCase() : null,
                rec.tmdbId ? String(rec.tmdbId).toLowerCase() : null,
                rec.id ? String(rec.id).toLowerCase() : null
            ].filter(Boolean);

            return !recIds.some(id => currentIds.has(id));
        });

        if (validRecs.length >= 4) {
            return { ...entry.data, recommendations: validRecs };
        }
    } catch (e) {
        console.warn("SmartCache read failed:", e);
    }
    return null;
}

/**
 * 500KB LRU Cache Eviction Manager (Single-Pass O(N log N) Eviction)
 */
export function setSmartCache(hash, data) {
    try {
        let cache = JSON.parse(localStorage.getItem(SMART_CACHE_KEY) || '{}');
        cache[hash] = { data, ts: Date.now() };

        const keys = Object.keys(cache);
        if (keys.length > 1) {
            // Sort keys from oldest to newest
            const sortedKeys = keys.sort((a, b) => (cache[a]?.ts || 0) - (cache[b]?.ts || 0));

            // Single serialization check
            let serialized = JSON.stringify(cache);
            let idx = 0;
            while (serialized.length * 2 > MAX_CACHE_BYTES && idx < sortedKeys.length - 1) {
                delete cache[sortedKeys[idx]];
                idx++;
            }
            if (idx > 0) {
                serialized = JSON.stringify(cache);
            }
            localStorage.setItem(SMART_CACHE_KEY, serialized);
        } else {
            localStorage.setItem(SMART_CACHE_KEY, JSON.stringify(cache));
        }
    } catch (e) {
        console.warn("SmartCache write failed, resetting cache:", e);
        try { localStorage.removeItem(SMART_CACHE_KEY); } catch (_) { }
    }
}

export function clearSmartCache(hash) {
    try {
        let cache = JSON.parse(localStorage.getItem(SMART_CACHE_KEY) || '{}');
        if (hash) {
            delete cache[hash];
            localStorage.setItem(SMART_CACHE_KEY, JSON.stringify(cache));
        } else {
            localStorage.removeItem(SMART_CACHE_KEY);
        }
    } catch (_) { }
}

const getOmdbKey = () => {
    const key = import.meta.env?.VITE_OMDB_KEY || globalThis.process?.env?.VITE_OMDB_KEY;
    if (!key || key === "undefined" || key === "null" || key.trim() === "") {
        return "";
    }
    return key.trim();
};
const OMDB_KEY = getOmdbKey();

// In-memory module cache to avoid redundant OMDb API calls during the session
const omdbMemoryCache = new Map();

/**
 * Fetch real movie data from OMDB API to replace hallucinated ratings
 */
export const fetchRealOMDBData = async (title, year, signal) => {
    try {
        if (!OMDB_KEY) return null;
        const cleanTitle = title.replace(/^["']|["']$/g, "").trim();
        const cleanYear = year ? String(year).trim().match(/\d{4}/)?.[0] : null;
        const cacheKey = `${cleanTitle.toLowerCase()}::${cleanYear || "noyear"}`;

        if (omdbMemoryCache.has(cacheKey)) {
            return omdbMemoryCache.get(cacheKey);
        }

        let url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(cleanTitle)}${cleanYear ? `&y=${cleanYear}` : ''}`;
        let response = await fetch(url, { cache: "no-store", signal });
        if (!response.ok) return null;

        let data = await response.json();

        if (data.Response !== "True" && cleanYear) {
            url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(cleanTitle)}`;
            response = await fetch(url, { cache: "no-store", signal });
            if (response.ok) {
                data = await response.json();
            }
        }

        if (data.Response === "True") {
            const formatted = {
                imdbRating: parseFloat(data.imdbRating) || null,
                imdbVotes: data.imdbVotes || "N/A",
                poster: data.Poster !== "N/A" ? data.Poster : null,
                plot: data.Plot || "",
                director: data.Director || "Unknown",
                genre: data.Genre || "Cinema",
                imdbID: data.imdbID || null,
                verifiedTitle: data.Title,
                verifiedYear: data.Year
            };
            omdbMemoryCache.set(cacheKey, formatted);
            return formatted;
        }

        return null;
    } catch (error) {
        if (error.name !== "AbortError") {
            console.warn(`OMDB fetch failed for ${title}:`, error);
        }
        return null;
    }
};

export const getFallbackPoster = getTmdbFallbackPoster;

/**
 * Generate pure JS pre-computed taste analytics based on user rating history
 */
export const buildTasteAnalytics = (watched = []) => {
    if (!watched || watched.length === 0) return null;

    const rated = watched.filter(m => typeof m.userRating === "number" && !isNaN(m.userRating) && m.userRating > 0);
    if (rated.length === 0) return null;

    const avg = (rated.reduce((s, m) => s + m.userRating, 0) / rated.length).toFixed(1);

    const liked = rated.filter(m => m.userRating >= 7);
    const genreCounts = {};

    liked.forEach(m => {
        const rawGenre = m.genre || m.Genre || "";
        if (rawGenre) {
            const genres = rawGenre.split(",").map(g => g.trim()).filter(Boolean);
            genres.forEach(g => {
                genreCounts[g] = (genreCounts[g] || 0) + 1;
            });
        }
    });

    const topGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([g, count]) => {
            const pct = Math.round((count / (liked.length || 1)) * 100);
            return `${g} (${pct}% of highly rated films)`;
        });

    const byDirector = {};
    rated.forEach(m => {
        const d = (m.director || m.Director || "").trim();
        if (d && d !== "Unknown" && d !== "N/A") {
            byDirector[d] = byDirector[d] || [];
            byDirector[d].push(m.userRating);
        }
    });

    const topDirectors = Object.entries(byDirector)
        .filter(([_, ratings]) => ratings.length >= 2)
        .map(([director, ratings]) => {
            const dirAvg = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1);
            return `${director} (avg ${dirAvg}/10 across ${ratings.length} films)`;
        })
        .sort((a, b) => {
            const avgA = parseFloat(a.split("avg ")[1]);
            const avgB = parseFloat(b.split("avg ")[1]);
            return avgB - avgA;
        })
        .slice(0, 3);

    return {
        avgRating: avg,
        totalRated: rated.length,
        topGenres,
        topDirectors
    };
};

/**
 * Generate deterministic fallback ID based on title and year using Base64URL
 */
export const generateFallbackId = (title, year) => {
    const cleanT = String(title || "unknown").toLowerCase().trim();
    const cleanY = String(year || "0000").match(/\d{4}/)?.[0] || "0000";
    const raw = `${cleanT}::${cleanY}`;
    try {
        return `local_${btoa(unescape(encodeURIComponent(raw)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '')}`;
    } catch {
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return `local_${Math.abs(hash)}`;
    }
};

/**
 * Profile-Based Sliding Window Cache Hash (Non-Mutating, Includes Anchor/Crew/Cast)
 */
export const generateProfileHash = (profile, watchlistGenres = [], mood = "any", providers = []) => {
    const lovedStr = [...(profile?.lovedGenreIds || [])].sort((a, b) => a - b).join("-");
    const hatedStr = [...(profile?.hatedKeywordIds || [])].sort((a, b) => a - b).join("-");
    const watchStr = [...(watchlistGenres || [])].slice(0, 3).sort((a, b) => a - b).join("-");
    const provStr = [...(providers || [])].sort((a, b) => String(a).localeCompare(String(b))).join("-");
    const anchorStr = String(profile?.anchorTmdbId || "none");
    const crewStr = String(profile?.topCrewMemberId || "none");
    const castStr = [...(profile?.topCastIds || [])].sort((a, b) => a - b).join("-");
    const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim() || "any";
    return `v4_${lovedStr}_${hatedStr}_${watchStr}_${provStr}_${anchorStr}_${crewStr}_${castStr}_${cleanMood}`;
};

/**
 * Backward compatibility input hasher
 */
export const generateInputHash = (watched = [], mood = "any") => {
    const watchedStr = (watched || [])
        .map(m => `${m.imdbID || m.id || m.title}:${m.userRating || 0}`)
        .sort()
        .join('|');
    const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim() || "any";
    return `${watchedStr}#${cleanMood}`;
};

/**
 * Builds Gemini prompt for diversity selection and natural-language explanations over pre-ranked candidates.
 */
export function buildGeminiReRankPrompt(profile, mood, topCandidates = [], context = {}) {
    const watched = Array.isArray(context.watched) ? context.watched : [];

    // 1. Top Anchor Films (rated >= 8★, up to 8 films)
    const anchorFilms = watched
        .filter(m => typeof m.userRating === "number" && m.userRating >= 8)
        .sort((a, b) => b.userRating - a.userRating)
        .slice(0, 8)
        .map(m => {
            const note = m.userNote || m.notes ? ` - "${cleanStr(m.userNote || m.notes).slice(0, 80)}"` : "";
            return `- "${cleanStr(m.title)}" (${m.year || m.Year || "N/A"}) [${m.userRating}/10]${note}`;
        });

    // 2. Recent Watch Streak (last 3 positively rated films with dates)
    const recentStreak = [...watched]
        .filter(m => typeof m.userRating === "number" && m.userRating >= 6 && m.dateWatched)
        .sort((a, b) => new Date(b.dateWatched) - new Date(a.dateWatched))
        .slice(0, 3)
        .map(m => `- "${cleanStr(m.title)}" (${m.year || "N/A"}) [${m.userRating}/10]`);

    // 3. Candidate Movies formatting with director, badges, matchScore, and plot snippet
    const candidatesStr = topCandidates.map(c => {
        const directorStr = c.director && c.director !== "Unknown" ? ` | Director: ${cleanStr(c.director)}` : "";
        const badgesStr = Array.isArray(c.matchReasons) && c.matchReasons.length > 0
            ? ` | Badges: [${c.matchReasons.join(", ")}]`
            : "";
        const plotSnippet = cleanStr(c.overview || c.plot || "").slice(0, 140);
        return `ID: ${c.id || c.tmdbId} | "${c.title}" (${c.year})${directorStr} | Calibrated Match: ${c.matchScore || 85}% | Genres: ${c.genre} | TMDB Rating: ${c.vote_average || 'N/A'}/10${badgesStr} | Overview: ${plotSnippet}`;
    }).join("\n");

    return `
You are an elite film critic and cinema intelligence engine.
Select a diverse top 6 from these pre-ranked TMDB candidate movies and write compelling, personalized explanations.
Do NOT invent scores—each candidate already has a calibrated ranker score.

USER TASTE PROFILE:
- Favorite Genres: ${(profile.lovedGenreNames || []).join(", ") || "Diverse / Open"}
- Selected Mood / Vibe: "${cleanStr(mood)}"
${anchorFilms.length > 0 ? `\nUSER'S FAVORITE ANCHOR FILMS:\n${anchorFilms.join("\n")}` : ""}
${recentStreak.length > 0 ? `\nRECENT WATCH STREAK:\n${recentStreak.join("\n")}` : ""}

PRE-RANKED CANDIDATE MOVIES (Top ${topCandidates.length}):
${candidatesStr}

TASK:
Perform a diversity pass over these top candidates and select 6 distinct films.
Pick the 6 strongest, most cohesive films from the candidates and write a bespoke 1-sentence reason that explicitly connects each pick to the user's anchor films, favorite directors, or collaborative badges (never write a generic plot summary).
Output strict JSON with:
1. tasteProfile: Object containing favoriteGenres (array of strings), preferredEra (string), and ratingStyle (string description).
2. recommendations: Array of 6 items with:
   - tmdbId (number matching the candidate ID)
   - title (string)
   - year (string)
   - reason (string: 1-2 sentence compelling cinematic explanation of WHY this film connects to their taste profile)
`;
}

/**
 * Merges Gemini's diversity pass and explanations with deterministic calibrated ranker matchScores.
 */
export function mergeGeminiExplanationsWithRanker(result, rankedCandidates = [], profile = {}) {
    if (!result?.recommendations || !Array.isArray(result.recommendations)) {
        throw new Error("Invalid recommendation schema returned by Gemini");
    }

    const enriched = result.recommendations.map(rec => {
        const candidate = rankedCandidates.find(
            c => c.id === rec.tmdbId || c.tmdbId === rec.tmdbId || c.title?.toLowerCase() === rec.title?.toLowerCase()
        ) || {};
        const calibratedScore = typeof candidate.matchScore === "number"
            ? candidate.matchScore
            : normalizeMatchScore(rec.matchScore);

        return {
            id: candidate.id || rec.tmdbId,
            tmdbId: candidate.id || rec.tmdbId,
            title: candidate.title || rec.title,
            year: candidate.year || rec.year,
            genre: candidate.genre || (profile.lovedGenreNames?.[0] || "Cinema"),
            poster: candidate.poster || getFallbackPoster(rec.title),
            backdrop: candidate.backdrop || null,
            imdbRating: candidate.vote_average ? String(candidate.vote_average) : null,
            matchScore: calibratedScore,
            matchReasons: Array.isArray(candidate.matchReasons) ? candidate.matchReasons : [],
            rankerProbability: candidate.rankerProbability ?? null,
            reason: rec.reason || "Matches your cinematic taste profile.",
            plot: candidate.overview || rec.reason,
            sourceBucket: candidate.sourceBucket || "TMDB",
            realData: true
        };
    });

    enriched.sort((a, b) => b.matchScore - a.matchScore);

    return {
        tasteProfile: result.tasteProfile || {
            favoriteGenres: (profile.lovedGenreNames || []).slice(0, 3),
            preferredEra: "Contemporary",
            ratingStyle: "High cinematic affinity"
        },
        recommendations: enriched
    };
}

/**
 * Turns free-text mood queries ("like Drive but funnier") into structured retrieval filters.
 */
export async function parseFreeTextMoodWithGemini(ai, rawQuery = "") {
    const cleaned = cleanStr(rawQuery);
    if (!cleaned) {
        return { moodId: "any", withGenres: [], withoutKeywords: [], minYear: null, maxYear: null };
    }
    const prompt = `Convert this movie request into structured TMDB filter JSON: "${cleaned}"`;
    const config = {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                moodId: { type: Type.STRING },
                withGenres: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                withoutKeywords: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                minYear: { type: Type.NUMBER },
                maxYear: { type: Type.NUMBER }
            },
            required: ["moodId", "withGenres", "withoutKeywords"]
        }
    };
    try {
        const res = await executeCascade(ai, FAST_INTERACTIVE_CASCADE, { contents: prompt, config }, { cascadeType: "fast" });
        if (res?.text) {
            return sanitizeAndParseJSON(res.text);
        }
    } catch (_) {}
    return { moodId: "any", withGenres: [], withoutKeywords: [], minYear: null, maxYear: null };
}

/**
 * Executes Calibrated Ranker + Gemini Explanations & Diversity Pass
 */
async function reRankCandidatesWithGemini(ai, profile, mood, candidates, options = {}) {
    const topCandidates = rankCandidatePool(
        candidates,
        {
            profile,
            collabSimMap: options.collabSimMap,
            contentSimMap: options.contentSimMap,
            repulsionMap: options.repulsionMap,
            anchorKeywords: options.anchorKeywords ?? profile?.lovedKeywordIds,
            userProviders: options.userProviders
        },
        options.rankerWeights,
        options.topK || 15
    );

    const prompt = buildGeminiReRankPrompt(profile, mood, topCandidates, {
        watched: options.watched,
        watchlist: options.watchlist
    });

    const generationConfig = {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                tasteProfile: {
                    type: Type.OBJECT,
                    properties: {
                        favoriteGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
                        preferredEra: { type: Type.STRING },
                        ratingStyle: { type: Type.STRING }
                    },
                    required: ["favoriteGenres", "preferredEra", "ratingStyle"]
                },
                recommendations: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            tmdbId: { type: Type.NUMBER },
                            title: { type: Type.STRING },
                            year: { type: Type.STRING },
                            matchScore: { type: Type.NUMBER },
                            reason: { type: Type.STRING }
                        },
                        required: ["tmdbId", "title", "year", "reason"]
                    }
                }
            },
            required: ["tasteProfile", "recommendations"]
        }
    };

    const response = await executeCascade(
        ai,
        CURATION_MODEL_CASCADE,
        { contents: prompt, config: generationConfig },
        { cascadeType: "curation" }
    );

    if (!response) {
        console.warn("All Gemini models failed to re-rank candidates, falling back to direct ranker output:", lastError?.message || lastError);
        return {
            tasteProfile: {
                favoriteGenres: (profile.lovedGenreNames || []).slice(0, 3),
                preferredEra: "Mixed",
                ratingStyle: "Varied"
            },
            recommendations: topCandidates.slice(0, 6).map(cand => ({
                id: cand.id || cand.tmdbId,
                tmdbId: cand.id || cand.tmdbId,
                title: cand.title,
                year: cand.year,
                genre: cand.genre || (profile.lovedGenreNames?.[0] || "Cinema"),
                poster: cand.poster || getFallbackPoster(cand.title),
                backdrop: cand.backdrop || null,
                imdbRating: cand.vote_average ? String(cand.vote_average) : null,
                matchScore: typeof cand.matchScore === "number" ? cand.matchScore : 85,
                matchReasons: Array.isArray(cand.matchReasons) ? cand.matchReasons : [],
                rankerProbability: cand.rankerProbability ?? null,
                reason: "Selected by the CinemaVault calibrated taste ranker.",
                plot: cand.overview || "",
                sourceBucket: cand.sourceBucket || "TMDB",
                realData: true
            }))
        };
    }

    const result = sanitizeAndParseJSON(response.text);
    return mergeGeminiExplanationsWithRanker(result, topCandidates, profile);
}

/**
 * Fallback Generative Pipeline (used when TMDB key is missing or unavailable)
 */
async function generateWithOmdbFallback(ai, watchedMovies, watchlist, onProgress, options = {}) {
    onProgress?.("Synthesizing recommendations from vault history...");

    const analytics = buildTasteAnalytics(watchedMovies);
    const header = "Title|Year|Director|Genre|Rating|UserNote";
    const rows = (watchedMovies || []).slice(0, 25).map(m =>
        `${cleanStr(m.title || m.Title)}|${cleanStr(m.year || m.Year || "N/A")}|${cleanStr(m.director || m.Director || "Unknown")}|${cleanStr(m.genre || m.Genre || "Unknown")}|${m.userRating || m.UserRating || 0}|${cleanStr(m.userNote || m.UserNote || "")}`
    ).join("\n");
    const historyData = `${header}\n${rows}`;

    const prompt = `
You are an elite film critic. Select 6 distinct movie recommendations based on this viewing history:
${historyData}

Mood requested: "${cleanStr(options.mood || 'any')}"
Return JSON with tasteProfile (favoriteGenres, preferredEra, ratingStyle) and recommendations (title, year, type, genre, matchScore, reason).
`;

    const generationConfig = {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                tasteProfile: {
                    type: Type.OBJECT,
                    properties: {
                        favoriteGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
                        preferredEra: { type: Type.STRING },
                        ratingStyle: { type: Type.STRING }
                    },
                    required: ["favoriteGenres", "preferredEra", "ratingStyle"]
                },
                recommendations: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            year: { type: Type.STRING },
                            type: { type: Type.STRING },
                            genre: { type: Type.STRING },
                            matchScore: { type: Type.NUMBER },
                            reason: { type: Type.STRING }
                        },
                        required: ["title", "year", "type", "genre", "matchScore", "reason"]
                    }
                }
            },
            required: ["tasteProfile", "recommendations"]
        }
    };

    const response = await executeCascade(
        ai,
        CURATION_MODEL_CASCADE,
        { contents: prompt, config: generationConfig },
        { cascadeType: "curation" }
    );

    if (!response) throw new Error("Fallback recommendation generation failed");

    const result = sanitizeAndParseJSON(response.text);

    if (result.recommendations && result.recommendations.length > 0) {
        onProgress?.("Verifying candidate titles with OMDb...");
        const enriched = await Promise.all(
            result.recommendations.map(async (rec) => {
                const omdbData = await fetchRealOMDBData(rec.title, rec.year);
                if (omdbData) {
                    return {
                        ...rec,
                        title: omdbData.verifiedTitle || rec.title,
                        year: omdbData.verifiedYear || rec.year,
                        imdbRating: omdbData.imdbRating || null,
                        poster: omdbData.poster || getFallbackPoster(rec.title),
                        genre: omdbData.genre || rec.genre || "Cinema",
                        imdbID: omdbData.imdbID,
                        matchScore: normalizeMatchScore(rec.matchScore),
                        realData: true
                    };
                }
                return {
                    ...rec,
                    imdbRating: null,
                    poster: getFallbackPoster(rec.title),
                    genre: rec.genre || "Cinema",
                    imdbID: generateFallbackId(rec.title, rec.year),
                    matchScore: normalizeMatchScore(rec.matchScore),
                    realData: false
                };
            })
        );
        result.recommendations = enriched;
    }

    return result;
}

/**
 * Main Recommendation Engine Entry Point
 * Hybrid Waterfall TMDB Candidate Engine + Gemini Re-Ranking
 */
export const getMovieRecommendations = async (watchedMovies = [], watchlist = [], onProgress, options = {}) => {
    const apiKey = import.meta.env?.VITE_GEMINI_KEY || globalThis.process?.env?.VITE_GEMINI_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add VITE_GEMINI_KEY to your .env file.");
    }

    const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 12000 } });
    const mood = options.mood || "any";
    const userRegion = options.userRegion || "US";
    const userProviders = options.userProviders || [];

    // 1. Synthesize statistical taste profile with mathematical weighting
    onProgress?.("Analyzing taste DNA and mathematical affinities...");
    const profile = await extractTasteProfile(watchedMovies, watchlist);

    // 2. Primary Engine: Dynamic Waterfall TMDB Retrieval + Gemini Re-Ranking
    if (TMDB_KEY) {
        try {
            onProgress?.("Harvesting 3-bucket verified candidate catalogue from TMDB...");
            const candidates = await fetchCandidatePool(profile, mood, watchedMovies, watchlist, {
                ...options,
                userRegion,
                userProviders
            });

            if (candidates && candidates.length >= 6) {
                const embeddingIndex =
                    options.embeddingIndex !== undefined
                        ? options.embeddingIndex
                        : await loadDefaultEmbeddingIndex();
                const collabSimMap =
                    options.collabSimMap ||
                    buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);
                const repulsionMap =
                    options.repulsionMap ||
                    buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);

                let mergedCandidates = candidates;
                if (embeddingIndex && options.injectEmbeddingNeighbors !== false) {
                    const personas = computeUserPersonas(profile.weightedRatings, embeddingIndex);
                    const excludeIds = new Set([
                        ...(watchedMovies || []).map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
                        ...(watchlist || []).map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
                        ...candidates.map(c => Number(c?.tmdbId ?? c?.id ?? 0))
                    ]);
                    const neighbors = retrieveByEmbedding(personas, embeddingIndex, excludeIds, 30);
                    const injected = await fetchEmbeddingCandidates(
                        neighbors,
                        watchedMovies,
                        watchlist,
                        candidates,
                        { userRegion, maxNeighbors: 30 }
                    );
                    if (injected.length > 0) {
                        mergedCandidates = [...candidates, ...injected];
                    }
                }

                onProgress?.("AI Oracle re-ranking candidates against taste DNA...");
                const result = await reRankCandidatesWithGemini(ai, profile, mood, mergedCandidates, {
                    ...options,
                    embeddingIndex,
                    collabSimMap,
                    repulsionMap,
                    watched: watchedMovies,
                    watchlist
                });
                console.log(`✅ TMDB 3-Bucket + Gemini engine completed (${result.recommendations?.length} films)`);
                return result;
            }
        } catch (tmdbErr) {
            console.warn("TMDB candidate retrieval failed, falling back to generative pipeline:", tmdbErr);
        }
    }

    // 3. Fallback Engine: Generative Gemini + OMDb Verification
    return await generateWithOmdbFallback(ai, watchedMovies, watchlist, onProgress, options);
};
