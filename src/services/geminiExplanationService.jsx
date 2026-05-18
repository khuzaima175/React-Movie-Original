import { GoogleGenAI } from "@google/genai";

const PRIMARY_MODEL = "gemini-3.0-flash-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";

/**
 * Explains WHY a specific movie was recommended based on user's taste
 * Uses Gemini 1.5 Flash for detailed analysis
 */
export const getRecommendationExplanation = async (movieTitle, userTasteProfile, watchedMovies) => {
    const apiKey = import.meta.env.VITE_GEMINI_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is missing.");
    }

    const ai = new GoogleGenAI({ apiKey });

    // Get a snapshot of user's high-rated movies (8+)
    const favorites = watchedMovies
        .filter(m => m.userRating >= 8)
        .map(m => m.title)
        .slice(0, 5)
        .join(", ");

    const prompt = `You are a film expert. The user has been recommended "${movieTitle}".
  
Their Taste Profile:
- Favorite Genres: ${userTasteProfile?.favoriteGenres?.join(", ") || "Varied"}
- Preferred Era: ${userTasteProfile?.preferredEra || "Mixed"}
- Favorites: ${favorites || "Not enough data"}

Explain in 2-3 engaging sentences EXACTLY why "${movieTitle}" fits their taste. 
Compare it to their favorites if applicable. 
"Because you liked [Movie X], you will love the [element] in ${movieTitle}..."

Keep it conversational and convincing. Do NOT use markdown or special formatting.`;

    try {
        let response;
        try {
            response = await ai.models.generateContent({
                model: PRIMARY_MODEL,
                contents: prompt,
            });
        } catch (primaryError) {
            console.warn(`Primary explanation model failed: ${primaryError.message}. Switching to fallback.`);
            response = await ai.models.generateContent({
                model: FALLBACK_MODEL,
                contents: prompt,
            });
        }

        // Access text property directly (same pattern as geminiService.js)
        return response.text || "This movie matches your taste profile based on your viewing history.";
    } catch (error) {
        console.error("AI Explanation Service Error:", error);
        // Return a fallback instead of throwing
        return `"${movieTitle}" was chosen because it aligns with your preference for ${userTasteProfile?.favoriteGenres?.[0] || "quality"} films.`;
    }
};
