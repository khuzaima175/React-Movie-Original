import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-3-flash-preview";

/**
 * Sends a message to the AI movie assistant with user context.
 * 
 * @param {string} userMessage - The user's current message
 * @param {Array} chatHistory - Array of { role: "user" | "model", text: "..." }
 * @param {Array} watchedMovies - The user's watched movie history
 * @returns {Promise<string>} - The AI's response
 */
export const sendChatMessage = async (userMessage, chatHistory, watchedMovies) => {
    const apiKey = process.env.REACT_APP_GEMINI_KEY;
    if (!apiKey) throw new Error("API Key missing");

    const ai = new GoogleGenAI({ apiKey });

    // 1. Construct the System Context with User Data
    const movieContext = watchedMovies.map(m =>
        `- ${m.title} (${m.userRating}/10)${m.userNote ? ` Note: "${m.userNote}"` : ""}`
    ).join("\n") || "No watched movies yet.";

    const systemInstruction = `
    You are a dedicated AI Movie Assistant. Your goal is to discuss cinema and give recommendations based on the user's history.

    USER'S WATCHED HISTORY:
    ${movieContext}

    STRICT GUIDELINES:
    1.  **Topic restriction**: You ONLY discuss movies, TV shows, directors, acting, and cinema history.
    2.  **Redirect**: If asked about anything else (life, code, math, politics), politely say: "I can only help you with movies! 🎬" and steer back to cinema.
    3.  **Personalization**: ALWAYS reference their watched history when possible. (e.g., "Since you rated ${watchedMovies[0]?.title || "your movies"} highly...")
    4.  **Tone**: Friendly, enthusiastic film buff. Keep answers concise (max 3-4 sentences unless asked for a deep dive).
    `;

    // 2. Build the history as a SINGLE TEXT PROMPT (More robust than object structure)
    // We format it as a script for the AI to follow
    let prompt = `${systemInstruction}\n\nCHAT HISTORY:\n`;

    chatHistory.forEach(msg => {
        prompt += `${msg.role === "user" ? "User" : "AI"}: ${msg.text}\n`;
    });

    prompt += `User: ${userMessage}\nAI:`;

    try {
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt, // Sending as simple text
        });

        // Add some safety checks for the response property
        const text = response.text ||
            (response.candidates && response.candidates[0]?.content?.parts?.[0]?.text) ||
            "I'm having trouble connecting to the cinema database right now.";

        return text;
    } catch (error) {
        console.error("Chat Error:", error);

        // Parse the error for user-friendly messages
        const errorMessage = error.message || "";

        if (errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("quota")) {
            return "🎬 AI is taking a coffee break! The API quota has been exceeded. Please try again later or update your API key.";
        }

        if (errorMessage.includes("API Key") || errorMessage.includes("401")) {
            return "🔑 Invalid API key. Please check your Gemini API key configuration.";
        }

        if (errorMessage.includes("network") || errorMessage.includes("fetch")) {
            return "📡 Connection issue. Please check your internet and try again.";
        }

        return "🍿 Oops! Something went wrong. Please try again in a moment.";
    }
};
