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

    // 1. Data Enrichment: Send Metadata (Director, Genre, Year) to help the AI
    // We strictly map only necessary fields to keep token count low but context high.
    const movieData = watchedMovies.map(movie => ({
        title: movie.title,
        year: movie.year,
        director: movie.director || "Unknown", // Now available!
        genre: movie.genre || "Unknown",       // Now available!
        rating: movie.userRating,
        userReview: movie.userNote || ""
    }));

    // 2. Context Awareness: Create Exclusion List (Watched + Watchlist)
    // Prevents recommending movies the user already knows about.
    const excludeTitles = [
        ...watchedMovies.map(m => m.title),
        ...(watchlist || []).map(m => m.title)
    ].join(", ");

    // 3. The "Unbiased" Prompt Strategy
    // Removed hardcoded "Inception" bias. Added "Anti-Pattern" check.
    const prompt = `
    You are an elite film critic and data scientist. Your goal is to decode the user's "Taste DNA" and find hidden gems they will love.

    USER VIEWING HISTORY:
    ${JSON.stringify(movieData, null, 2)}

    ⛔ EXCLUSION LIST (DO NOT RECOMMEND THESE):
    ${excludeTitles}

    ---------------------------------------------------
    ### ANALYSIS PROTOCOL (Mental Steps):
    1.  **Analyze "High Rated" (8-10)**:
        -   Identify the specific *Micro-Genres* (e.g., "Dystopian Cyberpunk" instead of just "Sci-Fi").
        -   Identify the *Emotional Tone* (e.g., "Melancholic," "High-Octane," "Cerebral").
        -   Look for Director/Writer patterns.

    2.  **Analyze "Low Rated" (1-5) - THE ANTI-PATTERN**:
        -   Identify specific traits the user HATES (e.g., "Shaky Cam," "Unresolved Endings," "Cheesy Dialogue").
        -   *Strictly filter out* any recommendations that match these traits.

    3.  **Review User Notes**:
        -   If the user left a review, treat it as the *highest priority* signal for their preferences.

    4.  **Selection Rules**:
        -   Select 6 movies that match the High Patterns and avoid Anti-Patterns.
        -   **Diversity**: Include 1 "Safe Bet" (High match) and 1 "Wildcard" (Different genre but same vibe).
        -   **Obscurity**: Avoid the top 20 most popular movies on IMDB (e.g., No Shawshank, Godfather, Dark Knight) unless the user is clearly a beginner. PRIORITIZE hidden gems.

    ### OUTPUT REQUIREMENTS:
    -   Return strictly a JSON object matching the defined schema.
    -   **Match Score**: 0-100 confidence level.
    -   **Reason**: Detailed explanation connecting the choice to the user's history (e.g., "Because you liked 'The Witch', you will like 'The Lighthouse' (same director, atmospheric horror)").
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

        // Extra safety: Sort recommendations by IMDB rating (highest first)
        if (result.recommendations) {
            result.recommendations.sort((a, b) => (b.imdbRating || 0) - (a.imdbRating || 0));
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
