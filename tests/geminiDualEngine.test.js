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

test("getModelThinkingConfig assigns HIGH/MEDIUM to hydrogen (never LOW), LOW to 3.8/3.5, and budget:0 to 2.5", () => {
    assert.deepEqual(CURATION_MODEL_CASCADE, [
        "gemini-4-hydrogen",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-3.8-flash"
    ]);
    assert.deepEqual(FAST_INTERACTIVE_CASCADE, [
        "gemini-3.5-flash-lite",
        "gemini-4-hydrogen",
        "gemini-2.5-flash",
        "gemini-3.8-flash"
    ]);
    assert.deepEqual(getModelThinkingConfig("gemini-4-hydrogen"), { thinkingLevel: "HIGH" });
    assert.deepEqual(getModelThinkingConfig("gemini-4-hydrogen", "curation"), { thinkingLevel: "HIGH" });
    assert.deepEqual(getModelThinkingConfig("gemini-4-hydrogen", "fast"), { thinkingLevel: "MEDIUM" });
    assert.notEqual(getModelThinkingConfig("gemini-4-hydrogen", "curation")?.thinkingLevel, "LOW");
    assert.notEqual(getModelThinkingConfig("gemini-4-hydrogen", "fast")?.thinkingLevel, "LOW");
    assert.deepEqual(getModelThinkingConfig("gemini-3.8-flash"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3.5-flash-lite"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3.5-flash"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-2.5-flash"), { thinkingBudget: 0 });
});

test("executeCascade falls back from 429 on hydrogen to 3.5-flash-lite, skips degraded models on subsequent failure, and sanitizes config", async () => {
    resetSessionWorkingModels();
    const attempts = [];
    const seenConfigs = [];
    let failFlashLiteOnNextCall = false;

    const mockAi = {
        models: {
            generateContent: async ({ model, config }) => {
                attempts.push(model);
                seenConfigs.push({ model, config });
                if (model === "gemini-4-hydrogen" || model === "gemini-2.5-flash") {
                    throw new Error(`429 RESOURCE_EXHAUSTED on ${model}`);
                }
                if (model === "gemini-3.5-flash-lite" && failFlashLiteOnNextCall) {
                    throw new Error("503 transient failure");
                }
                return { text: JSON.stringify({ ok: true }), usageMetadata: { totalTokenCount: 42 } };
            }
        }
    };

    // Call 1: passes temperature/penalties/candidateCount > 1; hydrogen must omit them & use HIGH
    const res = await executeCascade(mockAi, CURATION_MODEL_CASCADE, {
        contents: "test prompt",
        config: {
            responseMimeType: "application/json",
            temperature: 0.7,
            frequencyPenalty: 0.2,
            presencePenalty: 0.2,
            candidateCount: 2
        }
    }, { cascadeType: "curation", timeoutMs: 1000 });

    assert.ok(res);
    assert.deepEqual(attempts, ["gemini-4-hydrogen", "gemini-3.5-flash-lite"]);
    assert.equal(getSessionCurationModel(), "gemini-3.5-flash-lite");

    // Verify API config rules on hydrogen attempt
    const hydrogenCfg = seenConfigs[0].config;
    assert.deepEqual(hydrogenCfg.thinkingConfig, { thinkingLevel: "HIGH" });
    assert.equal("temperature" in hydrogenCfg, false);
    assert.equal("frequencyPenalty" in hydrogenCfg, false);
    assert.equal("presencePenalty" in hydrogenCfg, false);
    assert.equal("candidateCount" in hydrogenCfg, false);
    assert.ok(hydrogenCfg.abortSignal instanceof AbortSignal);

    // Call 2: reuses healthy sessionCurationModel immediately
    attempts.length = 0;
    const res2 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, {
        contents: "test prompt 2"
    }, { cascadeType: "curation", timeoutMs: 1000 });
    assert.ok(res2);
    assert.deepEqual(attempts, ["gemini-3.5-flash-lite"]);

    // Call 3: when activeModel (3.5-flash-lite) fails later, degraded hydrogen must NOT be retried;
    // must try 2.5-flash (marked degraded) then succeed on 3.8-flash, and subsequent calls skip degraded models too
    attempts.length = 0;
    failFlashLiteOnNextCall = true;
    const res3 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, {
        contents: "test prompt 3"
    }, { cascadeType: "curation", timeoutMs: 1000 });
    assert.ok(res3);
    assert.deepEqual(attempts, ["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-3.8-flash"]);
    assert.equal(getSessionCurationModel(), "gemini-3.8-flash");
});

test("executeCascade aborts hanging model via AbortSignal within timeoutMs and falls back", async () => {
    resetSessionWorkingModels();
    let timedOutModelAttempted = false;
    let capturedAbortSignal = null;
    const attempts = [];

    const mockAi = {
        models: {
            generateContent: async ({ model, config }) => {
                attempts.push(model);
                if (model === "gemini-3.5-flash-lite") {
                    timedOutModelAttempted = true;
                    capturedAbortSignal = config?.abortSignal;
                    // Never resolves on its own
                    await new Promise(() => {});
                }
                if (model === "gemini-4-hydrogen") {
                    assert.deepEqual(config?.thinkingConfig, { thinkingLevel: "MEDIUM" });
                }
                return { text: JSON.stringify({ fallback: true }), usageMetadata: {} };
            }
        }
    };

    const start = Date.now();
    const res = await executeCascade(mockAi, FAST_INTERACTIVE_CASCADE, {
        contents: "test fast timeout"
    }, { cascadeType: "fast", timeoutMs: 150 });

    const elapsed = Date.now() - start;
    assert.ok(timedOutModelAttempted);
    assert.ok(capturedAbortSignal instanceof AbortSignal);
    assert.equal(capturedAbortSignal.aborted, true, "timed-out attempt AbortSignal must be aborted");
    assert.ok(elapsed < 1500, `Expected elapsed < 1500ms, got ${elapsed}ms`);
    assert.ok(res);
    assert.deepEqual(attempts, ["gemini-3.5-flash-lite", "gemini-4-hydrogen"]);
    assert.equal(getSessionFastModel(), "gemini-4-hydrogen");
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
