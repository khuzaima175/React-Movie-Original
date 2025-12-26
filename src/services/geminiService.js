import { GoogleGenAI, Type } from "@google/genai";

const PRIMARY_MODEL = "gemini-3.0-flash-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";

/**
 * Get AI-powered movie recommendations based on user's watched movies
 * Only uses: movie title + user rating (lean approach)
 * Returns: recommendations sorted by IMDB rating (highest first)
 * 
 * @param {Array} watchedMovies - Array of watched movies with ratings
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} Object with tasteProfile and recommendations
 */
export const getMovieRecommendations = async (watchedMovies, watchlist, onProgress) => {
    const apiKey = process.env.REACT_APP_GEMINI_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add REACT_APP_GEMINI_KEY to your .env file.");
    }

    if (!watchedMovies || watchedMovies.length === 0) {
        throw new Error("No watched movies to analyze. Rate some movies first!");
    }

    const ai = new GoogleGenAI({ apiKey });

    onProgress?.("Analyzing your unique taste profile...");

    // 1. Data Enrichment: Use CSV format to save ~40% tokens while preserving context
    // AI understands CSV perfectly and this is far more efficient than JSON
    const header = "Title|Year|Director|Writer|Genre|Rating|UserNote|PlotTheme";
    const rows = watchedMovies.map(m =>
        `${m.title}|${m.year || "N/A"}|${m.director || "Unknown"}|${m.writer || "Unknown"}|${m.genre || "Unknown"}|${m.userRating}|${m.userNote || ""}|${m.shortPlot || ""}`
    ).join("\n");
    const historyData = `${header}\n${rows}`;

    // 2. Context Awareness: Create Exclusion List (Watched + Watchlist)
    // Prevents recommending movies the user already knows about.
    const excludeTitles = [
        ...watchedMovies.map(m => m.title),
        ...(watchlist || []).map(m => m.title)
    ].join(", ");

    const prompt = `
    You are an elite film critic and data scientist. Your goal is to decode the user's "Taste DNA" and find hidden gems they will love.

    USER VIEWING HISTORY (CSV format - Title|Year|Director|Writer|Genre|Rating|UserNote|PlotTheme):
    ${historyData}

    ⛔ EXCLUSION LIST (DO NOT RECOMMEND THESE):
    ${excludeTitles}

    ---------------------------------------------------
    ### 🧠 ANALYSIS EXAMPLES (HOW YOU MUST THINK):

    *Example 1:*
    User History: Liked "John Wick" (10/10), Hated "The Godfather" (3/10).
    ❌ BAD LOGIC: "They like crime movies. Recommend 'Scarface'."
    ✅ GOOD LOGIC: "User prefers high-kinetic action and visual storytelling. They dislike slow-burn, dialogue-heavy dramas. Recommend 'The Raid' or 'Dredd'."

    *Example 2:*
    User History: Liked "Her" (9/10), Liked "Eternal Sunshine" (10/10).
    ❌ BAD LOGIC: "Recommend a rom-com like 'The Proposal'."
    ✅ GOOD LOGIC: "User likes 'Melancholic Sci-Fi' and exploring human connection through a surreal lens. Recommend 'After Yang' or 'The Lobster'."

    ---------------------------------------------------
    ### ANALYSIS PROTOCOL (Mental Steps):
    1.  **The "Elite" Tier (Ratings 9-10 ONLY)**:
        -   These are the user's TRUE north. Base 80% of recommendations on the Vibe/Director/Writer of these movies.
        -   *Example:* If they rated 'Inception' 10 but 'Coherence' 7, they want polished, big-budget mind-benders, NOT low-budget indie puzzles.

    1b. **The "Good" Tier (Ratings 7-8)**:
        -   Treat these as "Enjoyable but Flawed". 
        -   Do NOT use these as the primary basis for a recommendation unless they share a Writer/Director with a 9-10.

    2.  **Analyze PlotTheme Patterns**:
        -   Look for recurring themes in the PlotTheme column (e.g., "memory loss", "time loop", "revenge").
        -   If 3+ movies share a theme keyword, prioritize recommendations with that theme.

    3.  **Analyze "Low Rated" (1-5) - THE ANTI-PATTERN**:
        -   Identify specific traits the user HATES (e.g., "Shaky Cam," "Cheesy Dialogue").
        -   *Strictly filter out* any recommendations that match these traits.

    4.  **Review User Notes**:
        -   Treat user reviews as the *highest priority* signal.

    5.  **Selection Rules**:
        -   Select 6 movies: 1 Safe Bet, 1 Wildcard, 4 Hidden Gems.
        -   **Diversity**: Do NOT recommend more than 2 movies from the same director.
        -   **Obscurity**: Avoid the top 50 most popular movies on IMDB unless the user is a beginner.

    ### 📝 OUTPUT REASONING RULES (CRITICAL):
    -   The "reason" field MUST compare the recommendation to a specific movie the user watched.
    -   Format: "Similar to [Movie A] because of [Trait X], but with the [Trait Y] of [Movie B]."
    -   Example: "Similar to 'Inception' because of the mind-bending plot, but with the gritty atmosphere of 'The Batman'."

    ### OUTPUT REQUIREMENTS:
    -   Return strictly a JSON object matching the schema.
    -   **Match Score**: 0-100 confidence level.
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
                                imdbRating: { type: Type.NUMBER },
                                matchScore: { type: Type.NUMBER },
                                reason: { type: Type.STRING }
                            },
                            required: ["title", "year", "type", "genre", "imdbRating", "matchScore", "reason"]
                        }
                    }
                },
                required: ["tasteProfile", "recommendations"]
            }
        };

        let response;
        try {
            console.log(`🤖 Trying Primary Model: ${PRIMARY_MODEL}`);
            response = await ai.models.generateContent({
                model: PRIMARY_MODEL,
                contents: prompt,
                config: generationConfig
            });
        } catch (primaryError) {
            console.warn(`⚠️ Primary model failed. Switching to fallback: ${FALLBACK_MODEL}`, primaryError);
            onProgress?.("Primary AI busy, switching to backup...");
            try {
                response = await ai.models.generateContent({
                    model: FALLBACK_MODEL,
                    contents: prompt,
                    config: generationConfig
                });
            } catch (fallbackError) {
                console.error("❌ Both models failed", fallbackError);
                throw fallbackError; // Throw the error to be handled by the outer catch block
            }
        }

        onProgress?.("Finalizing your curated list...");

        let jsonStr = response.text || "{}";
        jsonStr = jsonStr.replace(/^```json\n|\n```$/g, "").trim();

        const result = JSON.parse(jsonStr);

        // Sort by Match Score (Personalized) first to avoid hallucinated rating issues
        if (result.recommendations) {
            result.recommendations.sort((a, b) => {
                if (b.matchScore !== a.matchScore) {
                    return (b.matchScore || 0) - (a.matchScore || 0);
                }
                return (b.imdbRating || 0) - (a.imdbRating || 0);
            });
        }

        return result;

    } catch (error) {
        console.error("AI Recommendation Error:", error);

        const errorMsg = error.message || "";

        // Show more helpful error message
        if (errorMsg.includes("API key") || errorMsg.includes("apiKey") || errorMsg.includes("401")) {
            throw new Error("🔑 Invalid API key. Please check your REACT_APP_GEMINI_KEY in the .env file.");
        } else if (errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("quota") || errorMsg.includes("429")) {
            throw new Error("API quota exceeded. Please try again later.");
        } else if (errorMsg.includes("network") || errorMsg.includes("fetch") || errorMsg.includes("Failed to fetch")) {
            throw new Error("📡 Connection issue. Please check your internet and try again.");
        } else {
            throw new Error("🍿 Something went wrong. Please try again in a moment.");
        }
    }
};
