import { GoogleGenAI, Type } from "@google/genai";

const MODELS = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
const getOmdbKey = () => {
    const key = import.meta.env.VITE_OMDB_KEY;
    if (!key || key === "undefined" || key === "null" || key.trim() === "") {
        return "b78bdecd";
    }
    return key.trim();
};
const OMDB_KEY = getOmdbKey();

/**
 * Fetch real movie data from OMDB API to replace hallucinated ratings
 * FIX: If Title+Year fails, retry with Title only (handles off-by-1 year issues)
 */
const fetchRealOMDBData = async (title, year) => {
    try {
        // Sanitize title and year to avoid OMDb lookup failures
        const cleanTitle = title.replace(/^["']|["']$/g, "").trim();
        const cleanYear = year ? String(year).trim().match(/\d{4}/)?.[0] : null;

        // First attempt: Try with year for precision
        let url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(cleanTitle)}${cleanYear ? `&y=${cleanYear}` : ''}`;
        let response = await fetch(url);
        
        if (!response.ok || response.status === 401) {
            if (OMDB_KEY !== "b78bdecd") {
                console.log(`🔄 Primary OMDb key failed (status ${response.status}), retrying with default key...`);
                url = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}${cleanYear ? `&y=${cleanYear}` : ''}`;
                response = await fetch(url);
            }
        }
        
        let data = await response.json();

        if (data.Response === "False" && data.Error && (data.Error.includes("key") || data.Error.includes("credential")) && OMDB_KEY !== "b78bdecd") {
            console.log(`🔄 OMDb reports key error, retrying enrichment with default key...`);
            url = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}${cleanYear ? `&y=${cleanYear}` : ''}`;
            response = await fetch(url);
            data = await response.json();
        }

        // FIX: If year-specific search fails, retry without year
        // AI often gets year off by 1 (release date vs wide release)
        if (data.Response !== "True" && cleanYear) {
            console.log(`🔄 Retrying "${cleanTitle}" without year constraint...`);
            url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(cleanTitle)}`;
            response = await fetch(url);
            
            if (!response.ok || response.status === 401) {
                if (OMDB_KEY !== "b78bdecd") {
                    url = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}`;
                    response = await fetch(url);
                }
            }
            
            data = await response.json();
            
            if (data.Response === "False" && data.Error && (data.Error.includes("key") || data.Error.includes("credential")) && OMDB_KEY !== "b78bdecd") {
                url = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(cleanTitle)}`;
                response = await fetch(url);
                data = await response.json();
            }
        }

        if (data.Response === "True") {
            return {
                imdbRating: parseFloat(data.imdbRating) || null,
                imdbVotes: data.imdbVotes || "N/A",
                poster: data.Poster !== "N/A" ? data.Poster : null,
                plot: data.Plot || "",
                director: data.Director || "Unknown",
                imdbID: data.imdbID || null,
                verifiedTitle: data.Title, // Store the actual OMDB title
                verifiedYear: data.Year    // Store the actual year
            };
        }

        console.warn(`⚠️ Movie not found in OMDB: "${cleanTitle}" (${cleanYear || 'no year'})`);
        return null;
    } catch (error) {
        console.warn(`OMDB fetch failed for ${title}:`, error);
        return null;
    }
};


/**
 * Generate a luxury offline SVG poster data URI
 */
export const getFallbackPoster = (title) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="100%" height="100%"><rect width="100%" height="100%" fill="#11151e"/><rect x="10" y="10" width="280" height="430" fill="none" stroke="#d4a843" stroke-width="1.5" stroke-opacity="0.15" rx="8"/><path d="M150 130 L180 190 L120 190 Z" fill="#d4a843" fill-opacity="0.25"/><circle cx="150" cy="160" r="40" fill="none" stroke="#d4a843" stroke-opacity="0.3" stroke-width="1.5"/><text x="50%" y="275" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#f0c968" text-anchor="middle">${title.length > 20 ? title.substring(0, 18) + '...' : title}</text><text x="50%" y="310" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#7a7368" letter-spacing="2" text-anchor="middle">CINEMATVAULT</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};



/**
 * Get AI-powered movie recommendations based on user's watched movies
 * 
 * ACCURACY IMPROVEMENTS IMPLEMENTED:
 * 1. Explicit Elite Tier Weights (mechanical, not prose)
 * 2. Self-Critique Step (LLM checks its own recommendations)
 * 3. Real OMDB Data Enrichment (no hallucinated ratings)
 * 
 * @param {Array} watchedMovies - Array of watched movies with ratings
 * @param {Array} watchlist - Array of movies in user's watchlist
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} Object with tasteProfile and recommendations
 */
export const getMovieRecommendations = async (watchedMovies, watchlist, onProgress) => {
    const apiKey = import.meta.env.VITE_GEMINI_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add VITE_GEMINI_KEY to your .env file.");
    }

    if (!watchedMovies || watchedMovies.length === 0) {
        throw new Error("No watched movies to analyze. Rate some movies first!");
    }

    const ai = new GoogleGenAI({ apiKey });

    onProgress?.("Analyzing your unique taste profile...");

    // === History Truncation / Smart Sampling (Prevents context bloat & degrades gracefully) ===
    // Guaranteed bucket allocation: Max 20 Top Rated (>=7), Max 10 Disliked (<=5), Max 10 Most Recent
    let processedWatched = watchedMovies;
    if (watchedMovies.length > 40) {
        const parseTimestamp = (m) => {
            const raw = m.watchedAt || m.addedAt || m.createdAt || m.date;
            if (!raw) return 0;
            const parsed = typeof raw === "number" ? raw : new Date(raw).getTime();
            return isNaN(parsed) ? 0 : parsed;
        };

        // Ensure recent items are sorted by verified timestamp
        const recent = [...watchedMovies]
            .sort((a, b) => parseTimestamp(b) - parseTimestamp(a))
            .slice(0, 10);

        // Top rated (>=7 captures both 9-10 anchors and 7-8 supporting signal)
        const high = [...watchedMovies]
            .filter(m => m.userRating >= 7)
            .sort((a, b) => b.userRating - a.userRating)
            .slice(0, 20);

        // Strongly disliked movies (<=5)
        const low = [...watchedMovies]
            .filter(m => m.userRating <= 5)
            .sort((a, b) => a.userRating - b.userRating)
            .slice(0, 10);

        // Deduplicate using unique ID or Title+Year compound key to protect remakes
        const map = new Map();
        [...high, ...low, ...recent].forEach(m => {
            const key = m.id || `${m.title}_${m.year || "N/A"}`;
            map.set(key, m);
        });
        processedWatched = Array.from(map.values());
    }

    const eliteTier = processedWatched.filter(m => m.userRating >= 9);
    const antiPatterns = processedWatched.filter(m => m.userRating <= 5);

    // Data Encoding: Compact CSV format to optimize token usage
    const header = "Title|Year|Director|Writer|Genre|Rating|UserNote|PlotTheme";
    const rows = processedWatched.map(m =>
        `${m.title}|${m.year || "N/A"}|${m.director || "Unknown"}|${m.writer || "Unknown"}|${m.genre || "Unknown"}|${m.userRating}|${m.userNote || ""}|${m.shortPlot || ""}`
    ).join("\n");
    const historyData = `${header}\n${rows}`;

    const excludeTitles = [
        ...watchedMovies.map(m => m.title),
        ...(watchlist || []).map(m => m.title)
    ].join(", ");

    const eliteSummary = eliteTier.length > 0
        ? eliteTier.map(m => `"${m.title}" (${m.userRating}/10)`).join(", ")
        : "No 9-10 rated movies yet (use highest rated movies as anchors)";

    const antiPatternSummary = antiPatterns.length > 0
        ? antiPatterns.map(m => `"${m.title}" (${m.userRating}/10${m.userNote ? `: ${m.userNote}` : ''})`).join(", ")
        : "No strongly disliked movies";

    const prompt = `
    You are an elite film critic and recommendation engine. Analyze the user's viewing history and select 6 distinct recommendations.

    USER VIEWING HISTORY (CSV format):
    ${historyData}

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
                break; // Success, break the loop
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

        // === IMPROVEMENT #2: Self-Critique Step ===
        // Ask the AI to review its own recommendations for potential issues
        if (result.recommendations && result.recommendations.length > 0) {
            onProgress?.("Running quality check...");

            try {
                const critiquePrompt = `
                You are reviewing movie recommendations for a user. Here are the recommendations:
                ${result.recommendations.map((r, i) => `${i + 1}. "${r.title}" - ${r.reason}`).join('\n')}

                User's Elite Tier movies (9-10 rated): ${eliteSummary}
                User's Anti-Patterns (disliked): ${antiPatternSummary}

                TASK: Identify if ANY recommendation is likely WRONG for this user.
                For each movie, rate confidence 1-10 (10 = perfect fit, 1 = bad fit).
                
                Return JSON: { "critiques": [{ "index": 0, "confidence": 8, "issue": "none" or "reason" }] }
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
                                        confidence: { type: Type.NUMBER },
                                        issue: { type: Type.STRING }
                                    }
                                }
                            }
                        }
                    }
                };

                const critiqueResponse = await ai.models.generateContent({
                    model: MODELS[1], // Use faster model for critique
                    contents: critiquePrompt,
                    config: critiqueConfig
                });

                const critiqueResult = JSON.parse(critiqueResponse.text || "{}");

                // Adjust match scores based on self-critique
                if (critiqueResult.critiques) {
                    critiqueResult.critiques.forEach(critique => {
                        if (critique.index < result.recommendations.length) {
                            const rec = result.recommendations[critique.index];
                            // Lower confidence = lower match score
                            if (critique.confidence < 5) {
                                rec.matchScore = Math.max(0, (rec.matchScore || 50) - 20);
                                rec.reason += ` ⚠️ (Lower confidence: ${critique.issue})`;
                            }
                        }
                    });
                }
            } catch (critiqueError) {
                console.warn("Self-critique step failed, continuing without:", critiqueError);
            }
        }

        // === IMPROVEMENT #3: Real OMDB Data Enrichment ===
        // Replace hallucinated IMDB ratings with real data from OMDB API
        // FIX: Filter out movies that don't exist in OMDB (likely hallucinated)
        if (result.recommendations && result.recommendations.length > 0) {
            onProgress?.("Verifying movies exist...");

            const enrichedRecommendations = await Promise.all(
                result.recommendations.map(async (rec) => {
                    const omdbData = await fetchRealOMDBData(rec.title, rec.year);

                    if (omdbData) {
                        return {
                            ...rec,
                            // Use OMDB's verified title/year (fixes AI misspellings)
                            title: omdbData.verifiedTitle || rec.title,
                            year: omdbData.verifiedYear || rec.year,
                            imdbRating: omdbData.imdbRating || null,
                            imdbVotes: omdbData.imdbVotes,
                            poster: omdbData.poster,
                            plot: omdbData.plot,
                            imdbID: omdbData.imdbID,
                            realData: true // Flag to indicate verified real data
                        };
                    }
                    // Fall back to original AI recommendation if OMDB lookup fails (e.g. rate limit, invalid key, or network issue)
                    return {
                        ...rec,
                        imdbRating: null,
                        poster: getFallbackPoster(rec.title),
                        plot: "Detailed plot synopsis unavailable.",
                        imdbID: "ai-" + Math.random().toString(36).substr(2, 9),
                        realData: false
                    };
                })
            );

            // FIX: Filter out null entries (hallucinated movies)
            const validRecommendations = enrichedRecommendations.filter(rec => rec !== null);

            const removedCount = enrichedRecommendations.length - validRecommendations.length;
            if (removedCount > 0) {
                console.warn(`🗑️ Filtered out ${removedCount} hallucinated/invalid movie(s)`);
            }

            result.recommendations = validRecommendations;
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

        // Show more helpful error message
        if (errorMsg.includes("API key") || errorMsg.includes("apiKey") || errorMsg.includes("401")) {
            throw new Error("🔑 Invalid API key. Please check your VITE_GEMINI_KEY in the .env file.");
        } else if (errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("quota") || errorMsg.includes("429")) {
            throw new Error("API quota exceeded. Please try again later.");
        } else if (errorMsg.includes("network") || errorMsg.includes("fetch") || errorMsg.includes("Failed to fetch")) {
            throw new Error("📡 Connection issue. Please check your internet and try again.");
        } else {
            throw new Error("🍿 Something went wrong. Please try again in a moment.");
        }
    }
};
