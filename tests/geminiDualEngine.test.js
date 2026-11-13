import test from "node:test";
import assert from "node:assert/strict";
import {
    getModelThinkingConfig,
    CURATION_MODEL_CASCADE,
    FAST_INTERACTIVE_CASCADE,
    executeCascade,
    resetSessionWorkingModels,
    getSessionCurationModel,
    getSessionFastModel,
    classifyGeminiError,
    modelCooldowns,
    setClockForTests,
    getWorkingModelStorageKey,
    WORKING_MODEL_TTL_MS,
    QUOTA_COOLDOWN_MS,
    DAILY_QUOTA_COOLDOWN_MS,
    TRANSIENT_COOLDOWN_MS,
    FATAL_COOLDOWN_MS
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

function createMemoryStorage() {
    const data = new Map();
    return {
        getItem(k) { return data.has(k) ? data.get(k) : null; },
        setItem(k, v) { data.set(k, String(v)); },
        removeItem(k) { data.delete(k); },
        dump() { return Object.fromEntries(data.entries()); }
    };
}

test("classifyGeminiError classifies quota, transient, invalid_config, and auth_fatal accurately", () => {
    assert.equal(classifyGeminiError({ status: 429, message: "Too Many Requests" }), "quota");
    assert.equal(classifyGeminiError(new Error("RESOURCE_EXHAUSTED: rate exceeded")), "quota");
    assert.equal(classifyGeminiError(new Error("exceeded your current quota")), "quota");

    assert.equal(classifyGeminiError({ status: 503, message: "Service Unavailable" }), "transient");
    assert.equal(classifyGeminiError({ status: 504, message: "Gateway Timeout" }), "transient");
    assert.equal(classifyGeminiError(new Error("Model x timed out after 400 ms")), "transient");
    assert.equal(classifyGeminiError(Object.assign(new Error("aborted"), { name: "AbortError" })), "transient");
    assert.equal(classifyGeminiError(new TypeError("fetch failed")), "transient");

    assert.equal(classifyGeminiError({ status: 400, message: "Bad request" }), "invalid_config");
    assert.equal(classifyGeminiError(new Error("INVALID_ARGUMENT: thinkingLevel LOW rejected")), "invalid_config");

    assert.equal(classifyGeminiError({ status: 401, message: "Unauthorized" }), "auth_fatal");
    assert.equal(classifyGeminiError({ status: 403, message: "PERMISSION_DENIED" }), "auth_fatal");
    assert.equal(classifyGeminiError({ status: 404, message: "NOT_FOUND" }), "auth_fatal");
});

test("modelCooldowns applies parsed retryDelay, daily RPD, transient, and fatal TTLs and recovers after clock expiry", async () => {
    let fakeNow = 1_700_000_000_000;
    setClockForTests(() => fakeNow);
    resetSessionWorkingModels();
    try {
        const attempts = [];
        const errorsByModel = {
            "gemini-4-hydrogen": new Error("429 RESOURCE_EXHAUSTED; Please retry in 45s."),
            "gemini-3.5-flash-lite": Object.assign(new Error("429 RESOURCE_EXHAUSTED limit: 0"), { status: 429 }),
            "gemini-2.5-flash": new Error("503 Service Unavailable"),
            "gemini-3.8-flash": new Error("400 INVALID_ARGUMENT")
        };

        const mockAi = {
            models: {
                generateContent: async ({ model }) => {
                    attempts.push(model);
                    if (errorsByModel[model]) throw errorsByModel[model];
                    return { text: JSON.stringify({ model }), usageMetadata: {} };
                }
            }
        };

        // Call 1: all 4 fail with distinct cooldown durations
        const r1 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "p1" }, { cascadeType: "curation" });
        assert.equal(r1, null);
        assert.deepEqual(attempts, CURATION_MODEL_CASCADE);

        assert.deepEqual(modelCooldowns.get("gemini-4-hydrogen"), { untilMs: fakeNow + 45_000, reason: "quota" });
        assert.deepEqual(modelCooldowns.get("gemini-3.5-flash-lite"), { untilMs: fakeNow + DAILY_QUOTA_COOLDOWN_MS, reason: "quota" });
        assert.deepEqual(modelCooldowns.get("gemini-2.5-flash"), { untilMs: fakeNow + TRANSIENT_COOLDOWN_MS, reason: "transient" });
        assert.deepEqual(modelCooldowns.get("gemini-3.8-flash"), { untilMs: fakeNow + FATAL_COOLDOWN_MS, reason: "invalid_config" });

        // At +30s, transient 2.5-flash cooldown expires while the others remain active
        fakeNow += TRANSIENT_COOLDOWN_MS;
        attempts.length = 0;
        delete errorsByModel["gemini-2.5-flash"];
        const r2 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "p2" }, { cascadeType: "curation" });
        assert.ok(r2);
        assert.deepEqual(attempts, ["gemini-2.5-flash"]);

        // At +45s total, hydrogen parsed retryDelay (45s) has expired; default cascade order puts preferred 2.5-flash first,
        // so simulate 2.5-flash failing (transient) and verify expired hydrogen is retried instead of staying permanently blocked
        fakeNow += 15_000; // +45_000 total
        delete errorsByModel["gemini-4-hydrogen"];
        errorsByModel["gemini-2.5-flash"] = new Error("503 down again");
        attempts.length = 0;
        const r3 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "p3" }, { cascadeType: "curation" });
        assert.ok(r3);
        assert.deepEqual(attempts, ["gemini-2.5-flash", "gemini-4-hydrogen"]);
        assert.equal(getSessionCurationModel(), "gemini-4-hydrogen");

        // Verify un-delayed 429 defaults to QUOTA_COOLDOWN_MS (120_000ms)
        errorsByModel["gemini-4-hydrogen"] = new Error("429 RESOURCE_EXHAUSTED");
        delete errorsByModel["gemini-2.5-flash"];
        fakeNow += TRANSIENT_COOLDOWN_MS;
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "p4" }, { cascadeType: "curation" });
        assert.equal(modelCooldowns.get("gemini-4-hydrogen").untilMs, fakeNow + QUOTA_COOLDOWN_MS);
    } finally {
        setClockForTests(null);
        resetSessionWorkingModels();
    }
});

test("executeCascade all-on-cooldown fallback tries only the single model whose cooldown expires soonest", async () => {
    resetSessionWorkingModels();
    const baseNow = 2_000_000_000_000;
    modelCooldowns.set("gemini-4-hydrogen", { untilMs: baseNow + 120_000, reason: "quota" });
    modelCooldowns.set("gemini-3.5-flash-lite", { untilMs: baseNow + 600_000, reason: "quota" });
    modelCooldowns.set("gemini-2.5-flash", { untilMs: baseNow + 10_000, reason: "transient" });
    modelCooldowns.set("gemini-3.8-flash", { untilMs: baseNow + 1_800_000, reason: "auth_fatal" });

    const attempts = [];
    let shouldFail = false;
    const mockAi = {
        models: {
            generateContent: async ({ model }) => {
                attempts.push(model);
                if (shouldFail) throw new Error("503 still down");
                return { text: JSON.stringify({ recovered: model }), usageMetadata: {} };
            }
        }
    };

    // Case 1: soonest-expiring model fails -> ONLY that single model is attempted
    shouldFail = true;
    const resFail = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "all cool fail" }, {
        cascadeType: "curation",
        now: () => baseNow
    });
    assert.equal(resFail, null);
    assert.deepEqual(attempts, ["gemini-2.5-flash"]);

    // Case 2: set 3.5-flash-lite to expire even sooner than the updated 2.5-flash cooldown and succeed -> clears its cooldown
    modelCooldowns.set("gemini-3.5-flash-lite", { untilMs: baseNow + 5_000, reason: "transient" });
    attempts.length = 0;
    shouldFail = false;
    const resOk = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "all cool ok" }, {
        cascadeType: "curation",
        now: () => baseNow
    });
    assert.ok(resOk);
    assert.deepEqual(attempts, ["gemini-3.5-flash-lite"]);
    assert.equal(modelCooldowns.has("gemini-3.5-flash-lite"), false);
    assert.equal(getSessionCurationModel(), "gemini-3.5-flash-lite");
    resetSessionWorkingModels();
});

test("executeCascade localStorage working model persists across reloads, expires after 30 min, respects cooldowns, and survives throwing storage", async () => {
    resetSessionWorkingModels();
    let fakeNow = 3_000_000_000_000;
    const prevGlobalStorage = globalThis.localStorage;
    const memStorage = createMemoryStorage();
    globalThis.localStorage = memStorage;

    try {
        const attempts = [];
        let failHydrogen = true;
        const mockAi = {
            models: {
                generateContent: async ({ model }) => {
                    attempts.push(model);
                    if (model === "gemini-4-hydrogen" && failHydrogen) {
                        throw new Error("429 RESOURCE_EXHAUSTED");
                    }
                    return { text: JSON.stringify({ ok: model }), usageMetadata: {} };
                }
            }
        };

        // Call 1: hydrogen 429s -> 3.5-flash-lite succeeds and is persisted under cinemavault_working_model_curation_v1
        const r1 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "init" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.ok(r1);
        assert.deepEqual(attempts, ["gemini-4-hydrogen", "gemini-3.5-flash-lite"]);
        const storedRaw = memStorage.getItem(getWorkingModelStorageKey("curation"));
        assert.ok(storedRaw);
        assert.deepEqual(JSON.parse(storedRaw), { model: "gemini-3.5-flash-lite", savedAt: fakeNow });

        // Simulate page reload at +20 min (within 30-min TTL): session memory & cooldowns cleared, localStorage kept
        resetSessionWorkingModels();
        failHydrogen = false;
        fakeNow += 20 * 60 * 1000;
        attempts.length = 0;
        const r2 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "after reload valid" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.ok(r2);
        assert.deepEqual(attempts, ["gemini-3.5-flash-lite"], "valid persisted model must be tried first after reload");

        // Fast cascade has its own independent key
        attempts.length = 0;
        const rFast = await executeCascade(mockAi, FAST_INTERACTIVE_CASCADE, { contents: "fast init" }, {
            cascadeType: "fast",
            now: () => fakeNow
        });
        assert.ok(rFast);
        assert.ok(memStorage.getItem(getWorkingModelStorageKey("fast")));

        // If persisted curation model is currently in cooldown after reload, skip it and fall back to default order
        resetSessionWorkingModels();
        modelCooldowns.set("gemini-3.5-flash-lite", { untilMs: fakeNow + 60_000, reason: "quota" });
        attempts.length = 0;
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "cooldown overrides persisted" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.deepEqual(attempts, ["gemini-4-hydrogen"]);

        // Simulate page reload past 30 * 60 * 1000 ms TTL: persisted model is expired and ignored
        memStorage.setItem(
            getWorkingModelStorageKey("curation"),
            JSON.stringify({ model: "gemini-3.5-flash-lite", savedAt: fakeNow })
        );
        resetSessionWorkingModels();
        fakeNow += WORKING_MODEL_TTL_MS;
        attempts.length = 0;
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "after ttl expiry" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.deepEqual(attempts, ["gemini-4-hydrogen"]);
        assert.equal(memStorage.getItem(getWorkingModelStorageKey("curation")), JSON.stringify({
            model: "gemini-4-hydrogen",
            savedAt: fakeNow
        }));

        // Throwing localStorage must not crash executeCascade
        resetSessionWorkingModels();
        const throwingStorage = {
            getItem() { throw new Error("SecurityError: blocked"); },
            setItem() { throw new Error("QuotaExceededError"); },
            removeItem() { throw new Error("SecurityError: blocked"); }
        };
        const rSafe = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "throwing storage" }, {
            cascadeType: "curation",
            storage: throwingStorage,
            now: () => fakeNow
        });
        assert.ok(rSafe);
    } finally {
        if (prevGlobalStorage === undefined) {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = prevGlobalStorage;
        }
        resetSessionWorkingModels();
    }
});

test("executeCascade records transient cooldown on abort-timeout with injected fake clock", async () => {
    resetSessionWorkingModels();
    let fakeNow = 4_000_000_000_000;
    let capturedSignal = null;

    const mockAi = {
        models: {
            generateContent: async ({ model, config }) => {
                if (model === "gemini-4-hydrogen") {
                    capturedSignal = config.abortSignal;
                    await new Promise(() => {});
                }
                return { text: JSON.stringify({ model }), usageMetadata: {} };
            }
        }
    };

    const res = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "timeout check" }, {
        cascadeType: "curation",
        timeoutMs: 60,
        now: () => fakeNow
    });

    assert.ok(res);
    assert.equal(capturedSignal?.aborted, true);
    assert.deepEqual(modelCooldowns.get("gemini-4-hydrogen"), {
        untilMs: fakeNow + TRANSIENT_COOLDOWN_MS,
        reason: "transient"
    });
    assert.equal(getSessionCurationModel(), "gemini-3.5-flash-lite");
    resetSessionWorkingModels();
});
