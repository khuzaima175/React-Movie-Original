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
    FATAL_COOLDOWN_MS,
    HYDROGEN_TIMEOUT_MS,
    getDefaultAttemptTimeoutMs,
    formatModelDisplayName,
    getLastModelInfo,
    getPreferredCascadeModel,
    resolveResultModelInfo,
    buildCascadeModelInfo,
    resetModelInfoForTests,
    createGeminiClient,
    buildGeminiReRankPrompt,
    mergeGeminiExplanationsWithRanker
} from "../src/services/geminiService.js";

test("getModelThinkingConfig assigns HIGH/MEDIUM to hydrogen (never LOW), LOW to 3.8/3.6/3.5/3-curation, MINIMAL to 3-flash fast, and budget:0 to 2.5", () => {
    assert.deepEqual(CURATION_MODEL_CASCADE, [
        "gemini-4-hydrogen",
        "gemini-3.5-flash-lite",
        "gemini-3.6-flash",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-3.8-flash"
    ]);
    assert.deepEqual(FAST_INTERACTIVE_CASCADE, [
        "gemini-3.5-flash-lite",
        "gemini-4-hydrogen",
        "gemini-3.6-flash",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-3.8-flash"
    ]);
    assert.deepEqual(getModelThinkingConfig("gemini-4-hydrogen"), { thinkingLevel: "HIGH" });
    assert.deepEqual(getModelThinkingConfig("gemini-4-hydrogen", "curation"), { thinkingLevel: "HIGH" });
    assert.deepEqual(getModelThinkingConfig("gemini-4-hydrogen", "fast"), { thinkingLevel: "MEDIUM" });
    assert.notEqual(getModelThinkingConfig("gemini-4-hydrogen", "curation")?.thinkingLevel, "LOW");
    assert.notEqual(getModelThinkingConfig("gemini-4-hydrogen", "fast")?.thinkingLevel, "LOW");
    assert.deepEqual(getModelThinkingConfig("gemini-3.6-flash"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3-flash-preview", "curation"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3-flash-preview", "fast"), { thinkingLevel: "MINIMAL" });
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
                if (
                    model === "gemini-4-hydrogen" ||
                    model === "gemini-3.6-flash" ||
                    model === "gemini-3-flash-preview" ||
                    model === "gemini-2.5-flash"
                ) {
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
    assert.deepEqual(attempts, [
        "gemini-3.5-flash-lite",
        "gemini-3.6-flash",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-3.8-flash"
    ]);
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
            "gemini-3.6-flash": new Error("400 INVALID_ARGUMENT"),
            "gemini-3-flash-preview": new Error("429 RESOURCE_EXHAUSTED"),
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

        // Call 1: all 6 fail with distinct cooldown durations
        const r1 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "p1" }, { cascadeType: "curation" });
        assert.equal(r1, null);
        assert.deepEqual(attempts, CURATION_MODEL_CASCADE);

        assert.deepEqual(modelCooldowns.get("gemini-4-hydrogen"), { untilMs: fakeNow + 45_000, reason: "quota" });
        assert.deepEqual(modelCooldowns.get("gemini-3.5-flash-lite"), { untilMs: fakeNow + DAILY_QUOTA_COOLDOWN_MS, reason: "quota" });
        assert.deepEqual(modelCooldowns.get("gemini-3.6-flash"), { untilMs: fakeNow + FATAL_COOLDOWN_MS, reason: "invalid_config" });
        assert.deepEqual(modelCooldowns.get("gemini-3-flash-preview"), { untilMs: fakeNow + QUOTA_COOLDOWN_MS, reason: "quota" });
        assert.deepEqual(modelCooldowns.get("gemini-2.5-flash"), { untilMs: fakeNow + TRANSIENT_COOLDOWN_MS, reason: "transient" });
        assert.deepEqual(modelCooldowns.get("gemini-3.8-flash"), { untilMs: fakeNow + FATAL_COOLDOWN_MS, reason: "invalid_config" });

        // At +30s, transient 2.5-flash cooldown expires while the others remain active
        fakeNow += TRANSIENT_COOLDOWN_MS;
        attempts.length = 0;
        delete errorsByModel["gemini-2.5-flash"];
        const r2 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "p2" }, { cascadeType: "curation" });
        assert.ok(r2);
        assert.deepEqual(attempts, ["gemini-2.5-flash"]);

        // At +45s total, hydrogen parsed retryDelay (45s) has expired; primary model must recover ahead of session fallback 2.5-flash
        fakeNow += 15_000; // +45_000 total
        delete errorsByModel["gemini-4-hydrogen"];
        attempts.length = 0;
        const r3 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "p3" }, { cascadeType: "curation" });
        assert.ok(r3);
        assert.deepEqual(attempts, ["gemini-4-hydrogen"]);
        assert.equal(getSessionCurationModel(), "gemini-4-hydrogen");

        // Verify un-delayed 429 defaults to QUOTA_COOLDOWN_MS (120_000ms) and falls back to 2.5-flash while other fallbacks remain cooled down
        errorsByModel["gemini-4-hydrogen"] = new Error("429 RESOURCE_EXHAUSTED");
        attempts.length = 0;
        fakeNow += TRANSIENT_COOLDOWN_MS;
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "p4" }, { cascadeType: "curation" });
        assert.deepEqual(attempts, ["gemini-4-hydrogen", "gemini-2.5-flash"]);
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
    modelCooldowns.set("gemini-3.6-flash", { untilMs: baseNow + 90_000, reason: "quota" });
    modelCooldowns.set("gemini-3-flash-preview", { untilMs: baseNow + 95_000, reason: "quota" });
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
                        throw new Error("429 RESOURCE_EXHAUSTED limit: 0 per_day");
                    }
                    return { text: JSON.stringify({ ok: model }), usageMetadata: {} };
                }
            }
        };

        // Call 1: hydrogen daily-429s -> 3.5-flash-lite succeeds and is persisted under cinemavault_working_model_curation_v1
        const r1 = await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "init" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.ok(r1);
        assert.deepEqual(attempts, ["gemini-4-hydrogen", "gemini-3.5-flash-lite"]);
        const storedRaw = memStorage.getItem(getWorkingModelStorageKey("curation"));
        assert.ok(storedRaw);
        const stored = JSON.parse(storedRaw);
        assert.equal(stored.model, "gemini-3.5-flash-lite");
        assert.equal(stored.savedAt, fakeNow);
        assert.ok(stored.primaryBlockedUntilMs > fakeNow + 20 * 60 * 1000, "daily-exhausted primary block must survive 20m reload");

        // Simulate page reload at +20 min (within 30-min TTL): session memory & cooldowns cleared, localStorage kept
        resetSessionWorkingModels();
        failHydrogen = false;
        fakeNow += 20 * 60 * 1000;
        assert.equal(
            getPreferredCascadeModel(CURATION_MODEL_CASCADE, "curation", { now: () => fakeNow, storage: memStorage }),
            "gemini-3.5-flash-lite",
            "getPreferredCascadeModel must match executeCascade across reload while primary is blocked"
        );
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

test("getDefaultAttemptTimeoutMs uses 35000ms margin for gemini-4-hydrogen and 15000ms across Flash models for 30->10 JSON output", () => {
    assert.equal(HYDROGEN_TIMEOUT_MS, 35000);
    assert.equal(getDefaultAttemptTimeoutMs("gemini-4-hydrogen"), 35000);
    assert.equal(getDefaultAttemptTimeoutMs("gemini-3-flash-preview"), 15000);
    assert.equal(getDefaultAttemptTimeoutMs("gemini-3.6-flash"), 15000);
    assert.equal(getDefaultAttemptTimeoutMs("gemini-3.8-flash"), 15000);
    assert.equal(getDefaultAttemptTimeoutMs("gemini-3.5-flash-lite"), 15000);
    assert.equal(getDefaultAttemptTimeoutMs("gemini-2.5-flash"), 15000);
    const client = createGeminiClient("DUMMY_KEY");
    assert.equal(typeof client?.models?.generateContent, "function");
});

test("formatModelDisplayName maps known Gemini models and offline ranker fallback cleanly", () => {
    assert.equal(formatModelDisplayName("gemini-4-hydrogen"), "Gemini 4 Hydrogen");
    assert.equal(formatModelDisplayName("gemini-3.5-flash-lite"), "Gemini 3.5 Flash-Lite");
    assert.equal(formatModelDisplayName("gemini-3.6-flash"), "Gemini 3.6 Flash");
    assert.equal(formatModelDisplayName("gemini-3-flash-preview"), "Gemini 3 Flash Preview");
    assert.equal(formatModelDisplayName("gemini-2.5-flash"), "Gemini 2.5 Flash");
    assert.equal(formatModelDisplayName("gemini-3.8-flash"), "Gemini 3.8 Flash");
    assert.equal(formatModelDisplayName(null), "Local Ranker (Offline Fallback)");
    assert.equal(formatModelDisplayName("gemini-experimental-custom"), "gemini-experimental-custom");
});

test("executeCascade records getLastModelInfo across primary, fallback, and fast vs curation isolation", async () => {
    resetSessionWorkingModels();
    resetModelInfoForTests();
    let fakeNow = 5_000_000_000_000;

    try {
        const mockPrimaryAi = {
            models: {
                generateContent: async () => ({ text: JSON.stringify({ ok: true }), usageMetadata: { totalTokenCount: 120 } })
            }
        };
        const r1 = await executeCascade(mockPrimaryAi, CURATION_MODEL_CASCADE, { contents: "curation win" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.ok(r1);
        const info1 = getLastModelInfo("curation");
        assert.equal(info1.model, "gemini-4-hydrogen");
        assert.equal(info1.displayName, "Gemini 4 Hydrogen");
        assert.equal(info1.isFallback, false);
        assert.equal(info1.pipeline, "gemini-curation");
        assert.deepEqual(info1.cooldownModels, []);
        assert.equal(info1.seq, 1);

        // Now simulate fast chat falling back through 3.5-flash-lite & 4-hydrogen -> 3.6-flash
        resetSessionWorkingModels();
        const mockFallbackAi = {
            models: {
                generateContent: async ({ model }) => {
                    if (model === "gemini-4-hydrogen" || model === "gemini-3.5-flash-lite") {
                        throw new Error(`429 RESOURCE_EXHAUSTED on ${model}`);
                    }
                    return { text: JSON.stringify({ ok: true }), usageMetadata: { totalTokenCount: 55 } };
                }
            }
        };

        const rFast = await executeCascade(mockFallbackAi, FAST_INTERACTIVE_CASCADE, { contents: "chat turn" }, {
            cascadeType: "fast",
            now: () => fakeNow
        });
        assert.ok(rFast);
        const fastInfo = getLastModelInfo("fast");
        assert.equal(fastInfo.model, "gemini-3.6-flash");
        assert.equal(fastInfo.displayName, "Gemini 3.6 Flash");
        assert.equal(fastInfo.isFallback, true);
        assert.equal(fastInfo.pipeline, "gemini-fast");
        assert.equal(fastInfo.seq, 2);
        // Cooldown list contains both skipped models
        assert.ok(fastInfo.cooldownModels.some((c) => c.model === "gemini-3.5-flash-lite" && c.reason === "quota"));
        assert.ok(fastInfo.cooldownModels.some((c) => c.model === "gemini-4-hydrogen" && c.reason === "quota"));
        // Curation lastModelInfo remained isolated at seq 1
        assert.equal(getLastModelInfo("curation").model, "gemini-4-hydrogen");
        assert.equal(getLastModelInfo("curation").seq, 1);
    } finally {
        resetSessionWorkingModels();
        resetModelInfoForTests();
    }
});

test("getPreferredCascadeModel & resolveResultModelInfo skip cooled-down models and fall back cleanly", () => {
    resetSessionWorkingModels();
    resetModelInfoForTests();
    const fakeNow = 6_000_000_000_000;

    try {
        assert.equal(getPreferredCascadeModel(CURATION_MODEL_CASCADE, "curation", { now: () => fakeNow }), "gemini-4-hydrogen");

        modelCooldowns.set("gemini-4-hydrogen", { untilMs: fakeNow + QUOTA_COOLDOWN_MS, reason: "quota" });
        assert.equal(getPreferredCascadeModel(CURATION_MODEL_CASCADE, "curation", { now: () => fakeNow }), "gemini-3.5-flash-lite");

        const fallbackInfo = resolveResultModelInfo({ recommendations: [] }, "curation");
        assert.equal(fallbackInfo.model, null);
        assert.equal(fallbackInfo.pipeline, "ranker-fallback");
        assert.equal(fallbackInfo.isFallback, true);

        const explicitInfo = buildCascadeModelInfo(CURATION_MODEL_CASCADE, "gemini-2.5-flash", "curation", "gemini-curation", { recordedAt: fakeNow });
        assert.equal(resolveResultModelInfo({ modelInfo: explicitInfo }, "curation").model, "gemini-2.5-flash");
    } finally {
        resetSessionWorkingModels();
        resetModelInfoForTests();
    }
});

test("executeCascade recovers back to primary model (gemini-4-hydrogen) after transient 30s cooldown expires in-session and across reload", async () => {
    const prevGlobalStorage = globalThis.localStorage;
    const store = new Map();
    const memStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); }
    };
    globalThis.localStorage = memStorage;
    resetSessionWorkingModels({ clearStorage: true });
    resetModelInfoForTests();

    let fakeNow = 2_000_000_000_000;
    let failPrimary = true;
    const attempts = [];

    const mockAi = {
        models: {
            generateContent: async ({ model }) => {
                attempts.push(model);
                if (model === "gemini-4-hydrogen" && failPrimary) {
                    throw new Error("504 DEADLINE_EXCEEDED timeout");
                }
                return { text: JSON.stringify({ ok: model }), usageMetadata: {} };
            }
        }
    };

    try {
        // Call 1: hydrogen fails transiently -> 3.5-flash-lite wins and sets transient 30s cooldown + persisted block
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c1" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.deepEqual(attempts, ["gemini-4-hydrogen", "gemini-3.5-flash-lite"]);

        // Call 2 (+10s, inside 30s cooldown): uses session working fallback directly
        attempts.length = 0;
        fakeNow += 10_000;
        assert.equal(
            getPreferredCascadeModel(CURATION_MODEL_CASCADE, "curation", { now: () => fakeNow, storage: memStorage }),
            "gemini-3.5-flash-lite"
        );
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c2" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.deepEqual(attempts, ["gemini-3.5-flash-lite"]);

        // Call 3 (+31s total, cooldown expired): retries primary gemini-4-hydrogen and promotes it back
        attempts.length = 0;
        fakeNow += 21_000;
        failPrimary = false;
        assert.equal(
            getPreferredCascadeModel(CURATION_MODEL_CASCADE, "curation", { now: () => fakeNow, storage: memStorage }),
            "gemini-4-hydrogen"
        );
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c3" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.deepEqual(attempts, ["gemini-4-hydrogen"]);
        assert.equal(getSessionCurationModel(), "gemini-4-hydrogen");

        // Reload recovery check for transient 30s errors: stays bypassed at +10s after reload, probes primary at +31s
        failPrimary = true;
        attempts.length = 0;
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c4" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.deepEqual(attempts, ["gemini-4-hydrogen", "gemini-3.5-flash-lite"]);

        resetSessionWorkingModels();
        fakeNow += 10_000;
        attempts.length = 0;
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c5" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.deepEqual(attempts, ["gemini-3.5-flash-lite"]);

        resetSessionWorkingModels();
        fakeNow += TRANSIENT_COOLDOWN_MS;
        failPrimary = false;
        attempts.length = 0;
        await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c6" }, {
            cascadeType: "curation",
            now: () => fakeNow
        });
        assert.deepEqual(attempts, ["gemini-4-hydrogen"]);
    } finally {
        if (prevGlobalStorage === undefined) {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = prevGlobalStorage;
        }
        resetSessionWorkingModels();
        resetModelInfoForTests();
    }
});


test("buildGeminiReRankPrompt prioritizes mood-stratified >=8 anchors with deterministic backfill and emits disliked/dismissed guardrails", () => {
    const watched = [
        // 10 higher-weighted Action/Sci-Fi/Thriller staples
        ...Array.from({ length: 10 }, (_, idx) => ({
            imdbID: `tt10000${idx}`,
            tmdbId: 1000 + idx,
            title: `Action Staple ${idx + 1}`,
            year: `${2000 + idx}`,
            userRating: 10,
            genre: "Action, Sci-Fi",
            tmdbGenreIds: [28, 878],
            dateWatched: `2026-10-${String(idx + 1).padStart(2, "0")}`
        })),
        // 2 slightly lower-rated (8/10) Comedy/Romance comfort anchors that MUST appear under comfort-watch
        {
            imdbID: "tt200001",
            tmdbId: 2001,
            title: "Warm Comedy Favorite",
            year: "2018",
            userRating: 8,
            genre: "Comedy, Romance",
            tmdbGenreIds: [35, 10749],
            dateWatched: "2025-05-01"
        },
        {
            imdbID: "tt200002",
            tmdbId: 2002,
            title: "Family Animation Gem",
            year: "2019",
            userRating: 8,
            genre: "Animation, Family",
            tmdbGenreIds: [16, 10751],
            dateWatched: "2025-06-01"
        },
        // Disliked <=4 films and negative z-score film (<7)
        {
            imdbID: "tt300001",
            tmdbId: 3001,
            title: "Grim Slasher Miss",
            year: "2014",
            userRating: 2,
            genre: "Horror",
            tmdbGenreIds: [27],
            dateWatched: "2026-09-01"
        },
        {
            imdbID: "tt300002",
            tmdbId: 3002,
            title: "Relative Letdown",
            year: "2021",
            userRating: 6,
            genre: "Drama",
            tmdbGenreIds: [18],
            dateWatched: "2026-09-10"
        }
    ];

    const profile = {
        lovedGenreNames: ["Sci-Fi", "Action", "Comedy"],
        weightedRatings: [
            { tmdbId: 1009, title: "Action Staple 10", finalWeight: 3.0, zScore: 1.5 },
            { tmdbId: 2001, title: "Warm Comedy Favorite", finalWeight: 1.1, zScore: 0.4 },
            { tmdbId: 2002, title: "Family Animation Gem", finalWeight: 1.0, zScore: 0.3 },
            // Deliberately test guard: high rating 8★ anchor with harsh negative zScore must NOT enter DISLIKED
            { tmdbId: 1000, title: "Action Staple 1", finalWeight: 2.0, zScore: -0.9 },
            { tmdbId: 3002, title: "Relative Letdown", finalWeight: -0.8, zScore: -0.9 }
        ]
    };

    const feedbackLog = [
        {
            title: "Skipped Grim Reboot",
            year: "2022",
            tmdbId: 9001,
            action: "dismissed",
            reason: "Too bleak",
            ts: "2026-11-12T10:00:00.000Z"
        }
    ];

    const prompt = buildGeminiReRankPrompt(
        profile,
        "comfort-watch",
        [{ id: 500, tmdbId: 500, title: "Paddington 2", year: "2017", genre: "Family, Comedy", vote_average: 8.1, matchScore: 91 }],
        { watched, feedbackLog, targetCount: 10 }
    );

    const anchorSection = prompt.split("USER'S FAVORITE ANCHOR FILMS:")[1].split("USER'S DISLIKED / DISMISSED FILMS")[0];
    assert.ok(anchorSection.includes('"Warm Comedy Favorite"'), "Comfort Watch mood prioritizes Comedy/Romance >=8 anchor");
    assert.ok(anchorSection.includes('"Family Animation Gem"'), "Comfort Watch mood prioritizes Animation/Family >=8 anchor");
    const anchorLines = anchorSection.trim().split("\n").filter((l) => l.startsWith("- "));
    assert.equal(anchorLines.length, 10, "Backfills remaining anchor slots deterministically up to 10");

    assert.ok(prompt.includes("USER'S DISLIKED / DISMISSED FILMS (Avoid similar tone):"));
    const dislikedSection = prompt.split("USER'S DISLIKED / DISMISSED FILMS (Avoid similar tone):")[1].split("RECENT WATCH STREAK:")[0];
    assert.ok(dislikedSection.includes('"Skipped Grim Reboot" (2022) [dismissed: Too bleak]'));
    assert.ok(dislikedSection.includes('"Grim Slasher Miss" (2014) [2/10]'));
    assert.ok(dislikedSection.includes('"Relative Letdown" (2021) [6/10]'));
    assert.equal(dislikedSection.includes('"Action Staple 1"'), false, "Never leaks >=8★ anchors into disliked guardrails");
});

test("buildGeminiReRankPrompt emits NEAR MISSES after RECENT WATCH STREAK, uses embeddings & fallback, excludes disliked, and excludes already_seen", () => {
    const embIndex = {
        dim: 2,
        idToIndex: new Map([
            [1, 0], // 10★ favorite along +x
            [2, 1], // 7★ Near Miss closely aligned with +x (cos = 0.99)
            [3, 2], // 7★ orthogonal (cos = 0)
            [4, 3]  // 6★ closely aligned (cos = 0.90)
        ]),
        vectors: new Float32Array([
            1, 0,
            0.99, 0.14,
            0, 1,
            0.9, 0.43
        ])
    };

    const watched = [
        { id: 1, tmdbId: 1, title: "Favorite Peak", year: "2020", userRating: 10, genre: "Sci-Fi", dateWatched: "2026-10-01" },
        { id: 2, tmdbId: 2, title: "Close Near Miss", year: "2021", userRating: 7, genre: "Sci-Fi", dateWatched: "2026-10-05" },
        { id: 3, tmdbId: 3, title: "Far Orthogonal Miss", year: "2019", userRating: 7, genre: "Drama", dateWatched: "2026-10-04" },
        { id: 4, tmdbId: 4, title: "Second Near Miss", year: "2018", userRating: 6, genre: "Sci-Fi", dateWatched: "2026-10-03" },
        // Harsh negative z-score 6★ letdown that lands in dislikedFilms -> must NOT duplicate into NEAR MISSES
        { id: 5, tmdbId: 5, title: "Harsh ZScore Six", year: "2017", userRating: 6, genre: "Sci-Fi", dateWatched: "2026-10-02" }
    ];
    // Add high 10★ films so Harsh ZScore Six (or add zScore via weightedRatings) lands in dislikedFilms:
    // Actually with extra 10★ anchors: 10,10,10,10,10 vs 6 -> zScore < -0.4!
    const extraAnchors = Array.from({ length: 5 }, (_, i) => ({
        id: 100 + i,
        tmdbId: 100 + i,
        title: `Anchor Extra ${i}`,
        year: "2020",
        userRating: 10,
        genre: "Sci-Fi",
        dateWatched: "2026-10-10"
    }));
    const fullWatched = [
        ...extraAnchors,
        watched[0],
        watched[1],
        watched[2],
        watched[3],
        watched[4]
    ];

    const feedbackLog = [
        { action: "already_seen", title: "Already Seen Pick", year: "2015", reason: "Already seen" },
        { action: "dismissed", title: "Legacy Already Seen", year: "2016", reason: "Already seen" },
        { action: "dismissed", title: "True Dismissed Film", year: "2014", reason: "Too slow" }
    ];

    const profileWithWeights = {
        lovedGenreNames: ["Sci-Fi"],
        lovedGenreIds: [878],
        weightedRatings: [{ movie: watched[4], tmdbId: 5, zScore: -1.8 }]
    };
    const prompt = buildGeminiReRankPrompt(
        profileWithWeights,
        "any",
        [{ id: 90, tmdbId: 90, title: "Candidate X", year: "2023", genre: "Sci-Fi", matchScore: 88 }],
        { watched: fullWatched, feedbackLog, embeddingIndex: embIndex, targetCount: 10 }
    );

    const streakIdx = prompt.indexOf("RECENT WATCH STREAK:");
    const nearMissIdx = prompt.indexOf("NEAR MISSES");
    const candIdx = prompt.indexOf("PRE-RANKED CANDIDATE MOVIES");
    assert.ok(streakIdx > -1 && nearMissIdx > streakIdx && candIdx > nearMissIdx, "NEAR MISSES must appear after RECENT WATCH STREAK and before CANDIDATES");

    const dislikedBlock = prompt.split("USER'S DISLIKED / DISMISSED FILMS (Avoid similar tone):")[1].split("RECENT WATCH STREAK:")[0];
    assert.equal(dislikedBlock.includes("Already Seen Pick"), false, "already_seen action must never enter disliked section");
    assert.equal(dislikedBlock.includes("Legacy Already Seen"), false, "legacy dismissed Already seen must never enter disliked section");
    assert.ok(dislikedBlock.includes("True Dismissed Film"));
    assert.ok(dislikedBlock.includes("Harsh ZScore Six"), "6★ with harsh negative z-score lands in disliked guardrails");

    const nearMissBlock = prompt.slice(nearMissIdx, candIdx);
    assert.ok(nearMissBlock.includes('"Close Near Miss" (2021) [7/10'));
    assert.ok(nearMissBlock.includes('"Second Near Miss" (2018) [6/10'));
    assert.equal(nearMissBlock.includes('"Favorite Peak"'), false, ">=8★ anchors are not near misses");
    assert.equal(nearMissBlock.includes('"Harsh ZScore Six"'), false, "disliked films must never duplicate into NEAR MISSES");

    // Also works without embeddingIndex via structural genre overlap fallback
    const promptNoEmb = buildGeminiReRankPrompt(
        profileWithWeights,
        "any",
        [{ id: 90, tmdbId: 90, title: "Candidate X", year: "2023", genre: "Sci-Fi", matchScore: 88 }],
        { watched: fullWatched, feedbackLog, embeddingIndex: null, targetCount: 10 }
    );
    const fallbackNearIdx = promptNoEmb.indexOf("NEAR MISSES");
    assert.ok(fallbackNearIdx > -1);
    const fallbackNearBlock = promptNoEmb.slice(fallbackNearIdx, promptNoEmb.indexOf("PRE-RANKED CANDIDATE MOVIES"));
    assert.ok(fallbackNearBlock.includes('"Close Near Miss"'));
    assert.equal(fallbackNearBlock.includes('"Harsh ZScore Six"'), false);
});

test("mergeGeminiExplanationsWithRanker enforces two-pass soft max-2-per-director cap (ignoring Unknown) and relaxes to avoid underflow", () => {
    const nolanFilms = Array.from({ length: 4 }, (_, i) => ({
        id: 200 + i,
        tmdbId: 200 + i,
        title: `Nolan Film ${i}`,
        year: String(2010 + i),
        director: "Christopher Nolan",
        crewPersonId: 525,
        matchScore: 95 - i,
        rankerProbability: 0.9 - i * 0.02
    }));
    const otherFilms = [
        { id: 301, tmdbId: 301, title: "Villeneuve Film", year: "2016", director: "Denis Villeneuve", matchScore: 86 },
        { id: 302, tmdbId: 302, title: "Bong Film", year: "2019", director: "Bong Joon-ho", matchScore: 85 },
        { id: 303, tmdbId: 303, title: "Unknown Dir 1", year: "2020", director: "Unknown", matchScore: 80 },
        { id: 304, tmdbId: 304, title: "Unknown Dir 2", year: "2021", director: "Unknown", matchScore: 79 },
        { id: 305, tmdbId: 305, title: "Unknown Dir 3", year: "2022", director: "", matchScore: 78 }
    ];

    const pool = [...nolanFilms, ...otherFilms];
    const geminiResult = {
        tasteProfile: { favoriteGenres: ["Sci-Fi"] },
        recommendations: nolanFilms.map((f) => ({ tmdbId: f.tmdbId, title: f.title, year: f.year, reason: "Top pick." }))
    };

    // Pass 1: 4 Nolan picks from Gemini get capped to 2, pulling non-Nolan & Unknown-director candidates up to targetCount=5
    const capped = mergeGeminiExplanationsWithRanker(geminiResult, pool, {}, {}, 5);
    assert.equal(capped.recommendations.length, 5);
    const nolanCount = capped.recommendations.filter((r) => r.director === "Christopher Nolan").length;
    assert.equal(nolanCount, 2, "director with 4 Gemini picks must be capped at 2 when backfill alternatives exist");
    assert.ok(capped.recommendations.some((r) => r.title === "Villeneuve Film"));
    assert.ok(capped.recommendations.some((r) => r.title === "Bong Film"));

    // Unknown/empty directors must NOT trigger the cap against each other
    const onlyUnknownAndTwoNolan = mergeGeminiExplanationsWithRanker(
        { tasteProfile: { favoriteGenres: ["Sci-Fi"] }, recommendations: otherFilms.slice(2) },
        otherFilms,
        {},
        {},
        3
    );
    assert.deepEqual(
        onlyUnknownAndTwoNolan.recommendations.map((r) => r.tmdbId),
        [303, 304, 305],
        "Unknown/empty directors must not cap against each other or yield slots to ranked backfill"
    );

    // Pass 2 relaxation: when pool only has 4 Nolan films and targetCount=4, relax cap so we still return 4
    const relaxed = mergeGeminiExplanationsWithRanker(geminiResult, nolanFilms, {}, {}, 4);
    assert.equal(relaxed.recommendations.length, 4);
    assert.equal(relaxed.recommendations.filter((r) => r.director === "Christopher Nolan").length, 4);
});
