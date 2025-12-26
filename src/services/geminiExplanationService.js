import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3-flash-preview";

/**
 * Explains WHY a specific movie was recommended based on user's taste
 * Uses Gemini 1.5 Flash for detailed analysis
 */
export const getRecommendationExplanation = async (movieTitle, userTasteProfile, watchedMovies) => {
    const apiKey = process.env.REACT_APP_GEMINI_KEY;

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
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
        });

        // Access text property directly (same pattern as geminiService.js)
        return response.text || "This movie matches your taste profile based on your viewing history.";
    } catch (error) {
        console.error("AI Explanation Service Error:", error);
        // Return a fallback instead of throwing
        return `"${movieTitle}" was chosen because it aligns with your preference for ${userTasteProfile?.favoriteGenres?.[0] || "quality"} films.`;
    }
};
