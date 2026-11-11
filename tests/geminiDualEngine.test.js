import test from "node:test";
import assert from "node:assert/strict";
import {
    getModelThinkingConfig,
    CURATION_MODEL_CASCADE,
    FAST_INTERACTIVE_CASCADE,
    executeCascade,
    resetSessionWorkingModels,
    getSessionCurationModel,
    getSessionFastModel
} from "../src/services/geminiService.js";

test("getModelThinkingConfig assigns LOW to argon, 3.8, and 3.5, and budget:0 to 2.5", () => {
    assert.deepEqual(getModelThinkingConfig("gemini-4-argon"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3.8-flash"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3.5-flash-lite"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3.5-flash"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-2.5-flash"), { thinkingBudget: 0 });
});

test("executeCascade falls back from 429 quota error on Argon to next model and caches sessionCurationModel", async () => {
    resetSessionWorkingModels();
    const attempts = [];
    const mockAi = {
        models: {
            generateContent: async ({ model }) => {
                attempts.push(model);
                if (model === "gemini-4-argon") {
                    throw new Error("429 RESOURCE_EXHAUSTED: limit 0 on Free Tier");
                }
                return { text: JSON.stringify({ ok: true }), usageMetadata: { totalTokenCount: 42 } };
            }
        }
    };

    const res = await executeCascade(mockAi, CURATION_MODEL_CASCADE, {
        contents: "test prompt",
        config: { responseMimeType: "application/json" }
    }, { cascadeType: "curation", timeoutMs: 1000 });

    assert.ok(res);
    assert.equal(attempts[0], "gemini-4-argon");
    assert.equal(attempts[1], "gemini-3.8-flash");
    assert.equal(getSessionCurationModel(), "gemini-3.8-flash");

    // Second call should immediately reuse sessionCurationModel
    attempts.length = 0;
    const res2 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, {
        contents: "test prompt 2"
    }, { cascadeType: "curation", timeoutMs: 1000 });
    assert.ok(res2);
    assert.equal(attempts[0], "gemini-3.8-flash");
    assert.equal(attempts.length, 1);
});

test("executeCascade aborts hanging model within timeoutMs and tries next model", async () => {
    resetSessionWorkingModels();
    let timedOutModelAttempted = false;
    const mockAi = {
        models: {
            generateContent: async ({ model }) => {
                if (model === "gemini-3.8-flash") {
                    timedOutModelAttempted = true;
                    // Never resolves
                    await new Promise(() => {});
                }
                return { text: JSON.stringify({ fallback: true }), usageMetadata: {} };
            }
        }
    };

    const start = Date.now();
    const res = await executeCascade(mockAi, FAST_INTERACTIVE_CASCADE, {
        contents: "test fast timeout"
    }, { cascadeType: "fast", timeoutMs: 200 });

    const elapsed = Date.now() - start;
    assert.ok(timedOutModelAttempted);
    assert.ok(elapsed < 1500, `Expected elapsed < 1500ms, got ${elapsed}ms`);
    assert.ok(res);
    assert.equal(getSessionFastModel(), "gemini-3.5-flash-lite");
});

test("buildGeminiReRankPrompt includes anchor films, recent streak, and candidate matchReasons", async () => {
    const { buildGeminiReRankPrompt } = await import("../src/services/geminiService.js");
    const profile = { lovedGenreNames: ["Sci-Fi", "Drama"] };
    const candidates = [{
        id: 27205,
        title: "Inception",
        year: "2010",
        genre: "Sci-Fi",
        matchScore: 95,
        matchReasons: ["🧬 High Taste-Twin Match", "🎬 Favorite Filmmaker"],
        overview: "A thief enters the dreams of others."
    }];
    const watched = [
        { title: "Interstellar", year: "2014", userRating: 10, userNote: "Masterpiece", dateWatched: "2026-03-01" },
        { title: "Arrival", year: "2016", userRating: 9, userNote: "Great sound design", dateWatched: "2026-03-05" }
    ];

    const prompt = buildGeminiReRankPrompt(profile, "mind-bending", candidates, { watched, watchlist: [] });
    assert.match(prompt, /"Interstellar" \(2014\) \[10\/10\]/);
    assert.match(prompt, /Masterpiece/);
    assert.match(prompt, /High Taste-Twin Match/);
    assert.match(prompt, /Favorite Filmmaker/);
});
