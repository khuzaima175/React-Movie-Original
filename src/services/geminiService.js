import { GoogleGenAI, Type } from "@google/genai";

const MODELS = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash"];

/**
 * Sanitizes strings for CSV/prompt injection safety
 */
export const cleanStr = (val) => {
    if (val === null || val === undefined) return "";
    return String(val).replace(/[|\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
};

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
 * FIX: If Title+Year fails, retry with Title only (handles off-by-1 year issues)
 */
export const fetchRealOMDBData = async (title, year, signal) => {
    try {
        const cleanTitle = title.replace(/^["']|["']$/g, "").trim();
        const cleanYear = year ? String(year).trim().match(/\d{4}/)?.[0] : null;
        const cacheKey = `${cleanTitle.toLowerCase()}::${cleanYear || "noyear"}`;

        if (omdbMemoryCache.has(cacheKey)) {
            return omdbMemoryCache.get(cacheKey);
        }

        // First attempt: Try with year for precision
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

        // If year-specific search fails, retry without year (AI often gets release dates off by 1)
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
                imdbID: data.imdbID || null,
                verifiedTitle: data.Title,
                verifiedYear: data.Year
            };
            omdbMemoryCache.set(cacheKey, formatted);
            return formatted;
        }

        console.warn(`⚠️ Movie not found in OMDB: "${cleanTitle}" (${cleanYear || 'no year'})`);
        return null;
    } catch (error) {
        if (error.name !== "AbortError") {
            console.warn(`OMDB fetch failed for ${title}:`, error);
        }
        return null;
    }
};

/**
 * Generate a luxury offline SVG poster data URI
 */
export const getFallbackPoster = (title = "Film") => {
    const clean = String(title || "Film").replace(/["<>]/g, "");
    const displayTitle = clean.length > 20 ? clean.substring(0, 18) + '...' : clean;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="100%" height="100%"><rect width="100%" height="100%" fill="#141416"/><rect x="10" y="10" width="280" height="430" fill="none" stroke="#e2b13c" stroke-width="1.5" stroke-opacity="0.2" rx="4"/><path d="M150 130 L180 190 L120 190 Z" fill="#e2b13c" fill-opacity="0.2"/><circle cx="150" cy="160" r="40" fill="none" stroke="#e2b13c" stroke-opacity="0.35" stroke-width="1.5"/><text x="50%" y="275" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="600" fill="#f4f4f2" text-anchor="middle">${displayTitle}</text><text x="50%" y="310" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="500" fill="#b6b6b2" letter-spacing="2" text-anchor="middle">CINEMAVAULT</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/**
 * Generate pure JS pre-computed taste analytics based on user rating history
 */
export const buildTasteAnalytics = (watched = []) => {
    if (!watched || watched.length === 0) return null;

    const rated = watched.filter(m => typeof m.userRating === "number" && !isNaN(m.userRating) && m.userRating > 0);
    if (rated.length === 0) return null;

    const avg = (rated.reduce((s, m) => s + m.userRating, 0) / rated.length).toFixed(1);

    // Highly rated movies (>= 7)
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

    // Top Directors (min 2 films)
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
 * Helper to parse timestamps safely
 */
export const parseTimestamp = (m) => {
    if (!m) return 0;
    const raw = m.watchedAt || m.addedAt || m.createdAt || m.date;
    if (!raw) return 0;
    const parsed = typeof raw === "number" ? raw : new Date(raw).getTime();
    return isNaN(parsed) ? 0 : parsed;
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
 * Generate a deterministic fingerprint hash of watched ratings, mood, and recency bias.
 * NOTE: Decoupled from watchlist items to prevent false cache invalidations, but
 * includes the 10 most recent film IDs + timestamps to invalidate when recency bias changes.
 */
export const generateInputHash = (watched = [], mood = "any") => {
    const watchedStr = (watched || [])
        .map(m => `${m.imdbID || m.id || m.title}:${m.userRating || 0}:${(m.userNote || "").trim()}`)
        .sort()
        .join('|');
    
    const recentFingerprint = [...(watched || [])]
        .sort((a, b) => parseTimestamp(b) - parseTimestamp(a))
        .slice(0, 10)
        .map(m => `${m.imdbID || m.id || m.title}:${parseTimestamp(m)}`)
        .join(',');

    const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim() || "any";
    return `${watchedStr}#${cleanMood}#${recentFingerprint}`;
};

/**
 * Get AI-powered movie recommendations based on user's watched movies
 */
export const getMovieRecommendations = async (watchedMovies, watchlist, onProgress, options = {}) => {
    const apiKey = import.meta.env.VITE_GEMINI_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add VITE_GEMINI_KEY to your .env file.");
    }

    if (!watchedMovies || watchedMovies.length === 0) {
        throw new Error("No watched movies to analyze. Rate some movies first!");
    }

    const ai = new GoogleGenAI({ apiKey });

    onProgress?.("Analyzing your unique taste profile...");

    // Compute statistical summary
    const analytics = buildTasteAnalytics(watchedMovies);

    // === Stratified Tier Sampling with 3-Tier Multi-Comparator & Hard Cap (25) ===
    let processedWatched = watchedMovies;
    if (watchedMovies.length > 35) {
        // 1. ELITE ANCHORS (9-10): Chained comparator (Rating > Note > Recency), hard-capped at 25
        const elite = [...watchedMovies]
            .filter(m => m.userRating >= 9)
            .sort((a, b) => {
                // Tier 1: Highest Rating (10 beats 9)
                if (b.userRating !== a.userRating) return b.userRating - a.userRating;
                // Tier 2: User notes present (informative notes beat empty notes)
                const aHasNote = Boolean(a.userNote && a.userNote.trim());
                const bHasNote = Boolean(b.userNote && b.userNote.trim());
                if (aHasNote !== bHasNote) return bHasNote ? 1 : -1;
                // Tier 3: Recency (newest first)
                return parseTimestamp(b) - parseTimestamp(a);
            })
            .slice(0, 25);

        // 2. SUPPORTING TIER (7-8): Sampled and capped at 15
        const supporting = [...watchedMovies]
            .filter(m => m.userRating >= 7 && m.userRating <= 8)
            .sort((a, b) => {
                if (b.userRating !== a.userRating) return b.userRating - a.userRating;
                return parseTimestamp(b) - parseTimestamp(a);
            })
            .slice(0, 15);

        // 3. ANTI-PATTERNS (<= 5): Lowest rated with criticism notes
        const low = [...watchedMovies]
            .filter(m => m.userRating <= 5)
            .sort((a, b) => a.userRating - b.userRating)
            .slice(0, 10);

        // 4. RECENT WATCHES (Latest 10)
        const recent = [...watchedMovies]
            .sort((a, b) => parseTimestamp(b) - parseTimestamp(a))
            .slice(0, 10);

        // Deduplicate: Elite priority preserved via Map first-write
        const map = new Map();
        [...elite, ...supporting, ...low, ...recent].forEach(m => {
            const key = m.imdbID || m.id || `${m.title}_${m.year || "N/A"}`;
            if (!map.has(key)) map.set(key, m);
        });
        processedWatched = Array.from(map.values());
    }

    const eliteTier = processedWatched.filter(m => m.userRating >= 9);
    const antiPatterns = processedWatched.filter(m => m.userRating <= 5);

    // Data Encoding: Compact CSV without wasteful shortPlot (saves ~3,000 tokens)
    const header = "Title|Year|Director|Genre|Rating|UserNote";
    const rows = processedWatched.map(m =>
        `${cleanStr(m.title)}|${cleanStr(m.year || "N/A")}|${cleanStr(m.director || "Unknown")}|${cleanStr(m.genre || "Unknown")}|${m.userRating}|${cleanStr(m.userNote)}`
    ).join("\n");
    const historyData = `${header}\n${rows}`;

    const dismissedTitles = (options.feedbackLog || [])
        .filter(f => f.action === "dismissed")
        .map(f => cleanStr(f.title));

    const excludeTitles = [
        ...watchedMovies.map(m => cleanStr(m.title)),
        ...(watchlist || []).map(m => cleanStr(m.title)),
        ...dismissedTitles
    ].filter(Boolean).join(", ");

    const watchlistTitles = (watchlist || []).length > 0
        ? (watchlist || []).map(m => `"${cleanStr(m.title)}"`).join(", ")
        : "None";

    const eliteSummary = eliteTier.length > 0
        ? eliteTier.map(m => `"${cleanStr(m.title)}" (${m.userRating}/10${m.userNote ? `: ${cleanStr(m.userNote)}` : ''})`).join(", ")
        : "Highest rated films in viewing history";

    const antiPatternSummary = antiPatterns.length > 0
        ? antiPatterns.map(m => `"${cleanStr(m.title)}" (${m.userRating}/10${m.userNote ? `: ${cleanStr(m.userNote)}` : ''})`).join(", ")
        : "No strongly disliked movies";

    // Format precomputed analytics block
    const analyticsBlock = analytics ? `
    📊 PRECOMPUTED TASTE ANALYTICS:
    - User Average Rating: ${analytics.avgRating}/10 across ${analytics.totalRated} films
    - Top Favorite Genres: ${analytics.topGenres.join("; ") || "Diverse"}
    - Top Directors: ${analytics.topDirectors.join("; ") || "Various"}
    ` : "";

    // Format feedback log block if available
    const feedbackList = options.feedbackLog || [];
    const feedbackBlock = feedbackList.length > 0 ? `
    💬 RECENT FEEDBACK ON PAST RECOMMENDATIONS:
    ${feedbackList.map(f => `- ${cleanStr(f.title)} (${f.action === 'added_watchlist' ? 'Interested/Saved' : `Dismissed: ${cleanStr(f.reason) || 'Not for me'}`})`).join("\n")}
    ` : "";

    // Format requested mood if specified
    const moodBlock = options.mood && options.mood !== "any" ? `
    🎭 USER REQUESTED MOOD / DIRECTION:
    The user specifically requested movies matching this mood: "${cleanStr(options.mood)}". Prioritize recommendations that capture this vibe!
    ` : "";

    const prompt = `
    You are an elite film critic and recommendation engine. Analyze the user's viewing history and select 6 distinct recommendations.

    ${analyticsBlock}

    USER VIEWING HISTORY (Compact CSV format):
    ${historyData}

    👀 WATCHLIST INTENT SIGNAL:
    User saved these films (curious about them): ${watchlistTitles}
    → Use these titles to infer genre/tone interest, but DO NOT recommend these exact titles!

    ${moodBlock}

    ${feedbackBlock}

    ⛔ EXCLUSION LIST (DO NOT RECOMMEND THESE):
    ${excludeTitles}

    ---------------------------------------------------
    ### 🎯 PRIORITY RULES:
    
    1. PRIMARY ANCHORS (User Rated 9-10/10):
    ${eliteSummary}
    → Every recommendation MUST share thematic, stylistic, or storytelling qualities with at least ONE anchor movie.

    2. DISQUALIFYING ANTI-PATTERNS (User Rated <= 5/10):
    ${antiPatternSummary}
    → DISQUALIFY any movie matching key traits/flaws of these disliked films.

    3. USER REVIEWS & NOTES:
    → Give highest priority to specific user feedback written in UserNote.

    ---------------------------------------------------
    ### 🧠 ANALYSIS & SELECTION RULES:
    - Select exactly 6 movies (1 Safe Bet, 1 Wildcard, 4 Hidden Gems).
    - Diversity: Max 2 movies from the same director.
    - Reason format: "Similar to [Movie A] because of [Trait X], but with the [Trait Y] of [Movie B]."

    ### OUTPUT REQUIREMENTS:
    - Return strictly JSON matching the schema.
    - Match Score: 0-100 confidence score based on alignment with primary anchors.
    `;

    try {
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
                        }
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
        let lastError;
        for (let i = 0; i < MODELS.length; i++) {
            const currentModel = MODELS[i];
            try {
                console.log(`🤖 Trying Model: ${currentModel}`);
                response = await ai.models.generateContent({
                    model: currentModel,
                    contents: prompt,
                    config: generationConfig
                });
                break;
            } catch (error) {
                lastError = error;
                console.warn(`⚠️ Model ${currentModel} failed:`, error.message || error);
                if (i < MODELS.length - 1) {
                    onProgress?.(`AI busy, switching to backup model (${MODELS[i + 1]})...`);
                }
            }
        }

        if (!response) {
            console.error("❌ All models failed");
            throw lastError || new Error("All AI models failed to generate content");
        }

        onProgress?.("Validating recommendations...");

        let jsonStr = response.text || "{}";
        jsonStr = jsonStr.replace(/^```json\n|\n```$/g, "").trim();

        const result = JSON.parse(jsonStr);

        // === Dual-Pass Self-Critique with Native Type.BOOLEAN Schema ===
        if (result.recommendations && result.recommendations.length > 0) {
            onProgress?.("Running quality check...");

            try {
                const critiquePrompt = `
                You are reviewing movie recommendations for a user. Here are the recommendations:
                ${result.recommendations.map((r, i) => `${i}. "${r.title}" (${r.year}) - Reason: ${r.reason}`).join('\n')}

                User's Elite Tier movies (9-10 rated): ${eliteSummary}
                User's Anti-Patterns (disliked): ${antiPatternSummary}

                TASK: For each candidate, evaluate whether it violates disliked anti-patterns and if its tone matches the user.
                `;

                const critiqueConfig = {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            critiques: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        index: { type: Type.NUMBER },
                                        violatesAntiPattern: { type: Type.BOOLEAN },
                                        matchesPreferredTone: { type: Type.BOOLEAN },
                                        issue: { type: Type.STRING }
                                    },
                                    required: ["index", "violatesAntiPattern", "matchesPreferredTone", "issue"]
                                }
                            }
                        },
                        required: ["critiques"]
                    }
                };

                const critiqueResponse = await ai.models.generateContent({
                    model: MODELS[1],
                    contents: critiquePrompt,
                    config: critiqueConfig
                });

                const critiqueResult = JSON.parse(critiqueResponse.text || "{}");

                if (critiqueResult.critiques && Array.isArray(critiqueResult.critiques)) {
                    critiqueResult.critiques.forEach(critique => {
                        if (typeof critique.index === "number" && critique.index < result.recommendations.length) {
                            const rec = result.recommendations[critique.index];
                            if (critique.violatesAntiPattern === true) {
                                rec.matchScore = Math.max(0, (rec.matchScore || 50) - 25);
                                rec.reason += ` ⚠️ Note: ${cleanStr(critique.issue || "Potential tone mismatch with your anti-patterns")}`;
                            } else if (critique.matchesPreferredTone === false) {
                                rec.matchScore = Math.max(0, (rec.matchScore || 50) - 10);
                            }
                        }
                    });
                }
            } catch (critiqueError) {
                console.warn("Self-critique step failed, continuing without:", critiqueError);
            }
        }

        // === Real OMDB Data Enrichment & Verification ===
        if (result.recommendations && result.recommendations.length > 0) {
            onProgress?.("Verifying movies exist...");

            const enrichedRecommendations = await Promise.all(
                result.recommendations.map(async (rec) => {
                    const omdbData = await fetchRealOMDBData(rec.title, rec.year);

                    if (omdbData) {
                        return {
                            ...rec,
                            title: omdbData.verifiedTitle || rec.title,
                            year: omdbData.verifiedYear || rec.year,
                            imdbRating: omdbData.imdbRating || null,
                            imdbVotes: omdbData.imdbVotes,
                            poster: omdbData.poster,
                            plot: omdbData.plot,
                            imdbID: omdbData.imdbID,
                            realData: true
                        };
                    }
                    return {
                        ...rec,
                        imdbRating: null,
                        poster: getFallbackPoster(rec.title),
                        plot: "Detailed plot synopsis unavailable.",
                        imdbID: generateFallbackId(rec.title, rec.year),
                        realData: false
                    };
                })
            );

            result.recommendations = enrichedRecommendations;
        }

        // Sort by Match Score first, then by real IMDB rating
        if (result.recommendations) {
            result.recommendations.sort((a, b) => {
                if (b.matchScore !== a.matchScore) {
                    return (b.matchScore || 0) - (a.matchScore || 0);
                }
                return (b.imdbRating || 0) - (a.imdbRating || 0);
            });
        }

        console.log(`✅ ${result.recommendations?.length || 0} verified recommendations ready`);
        return result;

    } catch (error) {
        console.error("AI Recommendation Error:", error);
        const errorMsg = error.message || "";

        if (errorMsg.includes("API key") || errorMsg.includes("apiKey") || errorMsg.includes("401")) {
            throw new Error("🔑 Invalid API key. Please check your VITE_GEMINI_KEY in the .env file.");
        } else if (errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("quota") || errorMsg.includes("429")) {
            throw new Error("API quota exceeded. Please try again later.");
        } else if (errorMsg.includes("network") || errorMsg.includes("fetch") || errorMsg.includes("Failed to fetch")) {
            throw new Error("📡 Connection issue. Please check your internet and try again.");
        } else {
            throw new Error(errorMsg || "🍿 Something went wrong. Please try again in a moment.");
        }
    }
};
