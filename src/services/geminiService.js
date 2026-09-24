import { GoogleGenAI, Type } from "@google/genai";
import {
    TMDB_KEY,
    extractTasteProfile,
    fetchCandidatePool,
    getFallbackPoster as getTmdbFallbackPoster
} from "./tmdbService";

const MODELS = ["gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
const SMART_CACHE_KEY = 'cinemavault_smart_cache_v3';
const MAX_CACHE_BYTES = 500 * 1024; // 500KB Hard Cap

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
        try { localStorage.removeItem(SMART_CACHE_KEY); } catch (_) {}
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
    } catch (_) {}
}

const getOmdbKey = () => {
    const key = import.meta.env.VITE_OMDB_KEY;
    if (!key || key === "undefined" || key === "null" || key.trim() === "") {
        return "b78bdecd";
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
        const cleanTitle = title.replace(/^["']|["']$/g, "").trim();
        const cleanYear = year ? String(year).trim().match(/\d{4}/)?.[0] : null;
        const cacheKey = `${cleanTitle.toLowerCase()}::${cleanYear || "noyear"}`;

        if (omdbMemoryCache.has(cacheKey)) {
            return omdbMemoryCache.get(cacheKey);
        }

        let url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(cleanTitle)}${cleanYear ? `&y=${cleanYear}` : ''}`;
        let response = await fetch(url, { cache: "no-store", signal });

        if (!response.ok || response.status === 401) {
            if (OMDB_KEY !== "b78bdecd") {
                url = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}${cleanYear ? `&y=${cleanYear}` : ''}`;
                response = await fetch(url, { cache: "no-store", signal });
            }
        }

        let data = await response.json();

        if (data.Response === "False" && data.Error && (data.Error.includes("key") || data.Error.includes("credential")) && OMDB_KEY !== "b78bdecd") {
            url = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}${cleanYear ? `&y=${cleanYear}` : ''}`;
            response = await fetch(url, { cache: "no-store", signal });
            data = await response.json();
        }

        if (data.Response !== "True" && cleanYear) {
            url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(cleanTitle)}`;
            response = await fetch(url, { cache: "no-store", signal });

            if (!response.ok || response.status === 401) {
                if (OMDB_KEY !== "b78bdecd") {
                    url = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}`;
                    response = await fetch(url, { cache: "no-store", signal });
                }
            }

            data = await response.json();

            if (data.Response === "False" && data.Error && (data.Error.includes("key") || data.Error.includes("credential")) && OMDB_KEY !== "b78bdecd") {
                url = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}`;
                response = await fetch(url, { cache: "no-store", signal });
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
 * Profile-Based Sliding Window Cache Hash
 */
export const generateProfileHash = (profile, watchlistGenres = [], mood = "any", providers = []) => {
    const lovedStr = (profile?.lovedGenreIds || []).sort().join("-");
    const hatedStr = (profile?.hatedKeywordIds || []).sort().join("-");
    const watchStr = (watchlistGenres || []).slice(0, 3).sort().join("-");
    const provStr = (providers || []).sort().join("-");
    const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim() || "any";
    return `v3_${lovedStr}_${hatedStr}_${watchStr}_${provStr}_${cleanMood}`;
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
 * Executes Single-Pass TMDB Candidate Re-Ranking via Gemini
 */
async function reRankCandidatesWithGemini(ai, profile, mood, candidates, options = {}) {
    const prompt = `
You are an elite film critic and cinema intelligence engine.
Re-rank these REAL candidate movies retrieved from TMDB according to the user's taste profile.

USER TASTE PROFILE:
- Favorite Genres: ${profile.lovedGenreNames.join(", ") || "Diverse / Open"}
- Selected Mood / Vibe: "${cleanStr(mood)}"

CANDIDATE MOVIES (Guaranteed real titles from TMDB):
${candidates.map(c => `ID: ${c.id} | "${c.title}" (${c.year}) | Genres: ${c.genre} | TMDB Rating: ${c.vote_average || 'N/A'}/10 | Overview: ${c.overview}`).join("\n")}

TASK:
Select and re-rank the TOP 6 best matching films. Output strict JSON with:
1. tasteProfile: Object containing favoriteGenres (array of strings), preferredEra (string), and ratingStyle (string description).
2. recommendations: Array of exactly 6 items with:
   - tmdbId (number matching the candidate ID)
   - title (string)
   - year (string)
   - matchScore (integer from 75 to 98, representing match percentage with taste profile)
   - reason (string: 1-2 sentence compelling cinematic explanation of WHY this film connects to their taste profile)
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
                            tmdbId: { type: Type.NUMBER },
                            title: { type: Type.STRING },
                            year: { type: Type.STRING },
                            matchScore: { type: Type.NUMBER },
                            reason: { type: Type.STRING }
                        },
                        required: ["tmdbId", "title", "year", "matchScore", "reason"]
                    }
                }
            },
            required: ["tasteProfile", "recommendations"]
        }
    };

    let response;
    let lastError;

    for (let i = 0; i < MODELS.length; i++) {
        const currentModel = MODELS[i];
        try {
            response = await ai.models.generateContent({
                model: currentModel,
                contents: prompt,
                config: generationConfig
            });
            break;
        } catch (err) {
            lastError = err;
            console.warn(`Model ${currentModel} failed for re-ranking:`, err.message || err);
        }
    }

    if (!response) {
        throw lastError || new Error("All Gemini models failed to re-rank candidates");
    }

    const result = sanitizeAndParseJSON(response.text);

    if (!result.recommendations || !Array.isArray(result.recommendations)) {
        throw new Error("Invalid recommendation schema returned by Gemini");
    }

    // Match LLM ranked results back to guaranteed real TMDB candidates
    const enriched = result.recommendations.map(rec => {
        const candidate = candidates.find(c => c.id === rec.tmdbId || c.title?.toLowerCase() === rec.title?.toLowerCase()) || {};
        return {
            id: candidate.id || rec.tmdbId,
            tmdbId: candidate.id || rec.tmdbId,
            title: candidate.title || rec.title,
            year: candidate.year || rec.year,
            genre: candidate.genre || (profile.lovedGenreNames[0] || "Cinema"),
            poster: candidate.poster || getFallbackPoster(rec.title),
            backdrop: candidate.backdrop || null,
            imdbRating: candidate.vote_average ? String(candidate.vote_average) : null,
            matchScore: normalizeMatchScore(rec.matchScore),
            reason: rec.reason || "Matches your cinematic taste profile.",
            plot: candidate.overview || rec.reason,
            sourceBucket: candidate.sourceBucket || "TMDB",
            realData: true
        };
    });

    enriched.sort((a, b) => b.matchScore - a.matchScore);

    return {
        tasteProfile: result.tasteProfile || {
            favoriteGenres: profile.lovedGenreNames.slice(0, 3),
            preferredEra: "Contemporary",
            ratingStyle: "High cinematic affinity"
        },
        recommendations: enriched
    };
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

    let response;
    for (const modelName of MODELS) {
        try {
            response = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
                config: generationConfig
            });
            break;
        } catch (e) {
            console.warn(`Fallback model ${modelName} failed:`, e.message || e);
        }
    }

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
    const apiKey = import.meta.env.VITE_GEMINI_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add VITE_GEMINI_KEY to your .env file.");
    }

    const ai = new GoogleGenAI({ apiKey });
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
                userRegion,
                userProviders
            });

            if (candidates && candidates.length >= 6) {
                onProgress?.("AI Oracle re-ranking candidates against taste DNA...");
                const result = await reRankCandidatesWithGemini(ai, profile, mood, candidates, options);
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
