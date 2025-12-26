import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-3-flash-preview";

/**
 * Get AI-powered movie recommendations based on user's watched movies
 * Only uses: movie title + user rating (lean approach)
 * Returns: recommendations sorted by IMDB rating (highest first)
 * 
 * @param {Array} watchedMovies - Array of watched movies with ratings
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} Object with tasteProfile and recommendations
 */
export const getMovieRecommendations = async (watchedMovies, onProgress) => {
    const apiKey = process.env.REACT_APP_GEMINI_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add REACT_APP_GEMINI_KEY to your .env file.");
    }

    if (!watchedMovies || watchedMovies.length === 0) {
        throw new Error("No watched movies to analyze. Rate some movies first!");
    }

    const ai = new GoogleGenAI({ apiKey });

    onProgress?.("Analyzing your movie taste...");

    // Prepare movie data for the AI - title + user rating + user's reason
    const movieData = watchedMovies.map(movie => ({
        title: movie.title,
        myRating: movie.userRating,
        review: movie.userNote || "" // Include user's note if available
    }));

    const prompt = `
    You are an elite film recommendation engine. Your goal is to predict the user's next 5-star watch with extreme accuracy based on their rating history and THEIR EXPLICIT NOTES.

    USER DATA (Title + Rating/10 + Personal Review):
    ${JSON.stringify(movieData, null, 2)}

    ---------------------------------------------------
    ### ANALYSIS PROTOCOL (Mental Steps):
    1.  **Analyze User Reviews (Crucial)**:
        -   If the user wrote a note (e.g., "Hated the ending," "Loved the cinematography"), prioritize this over general genre trends.
        -   The "review" field contains the user's specific "Why" - use it to build a highly accurate taste profile.

    2.  **Identify the "Hate" Pattern (Ratings ≤ 6)**: 
        -   Look at the movies the user rated low. 
        -   *CRITICAL*: If they rated slow-burn or purely atmospheric movies low, you MUST filter out "Slow Pacing" from your recommendations.
        -   Assume the user dislikes boredom/wandering plots.
    
    2.  **Identify the "Love" Pattern (Ratings ≥ 8)**:
        -   Look for the common DNA (e.g., "Mind-Bending," "Non-Linear Time," "High-Stakes Action").
        -   Focus on **Density of Plot**: The user likely wants movies where every scene is a clue (Puzzle Boxes).

    3.  **Select Recommendations**:
        -   Find 6 movies/shows that are **critically acclaimed** (High IMDB) AND match the **"Fast & Complex"** criteria.
        -   **Strictly Avoid**: Generic blockbusters the user has likely seen, or "Art House" movies that are too slow.
        -   **Prioritize**: "Hidden Gems" or Cult Classics that fit the *Inception*/*Dark* vibe.

    ### OUTPUT REQUIREMENTS:
    -   **Match Score**: Assign a score (0-100) based on how well it fits the specific "High Pacing + High Intelligence" criteria.
    -   **Reason**: Explain briefly *why* it fits (e.g., "It has the complexity of Movie A but the speed of Movie B").
    -   Return the response strictly in the JSON format defined in the schema.
    `;

    try {
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            config: {
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
            }
        });

        onProgress?.("Sorting by IMDB ratings...");

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
