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
    generateProfileHash,
    mergeGeminiExplanationsWithRanker,
    verifyAndScoreWildcardPicks,
    getMovieRecommendations
} from "../src/services/geminiService.js";
import { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } from "../src/services/rankerService.js";

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

test("executeCascade aborts immediately on PROXY_RATE_LIMIT without model cooldown and honors session Retry-After", async () => {
  resetSessionWorkingModels();
  assert.equal(classifyGeminiError({ status: 429, errorCode: "PROXY_RATE_LIMIT" }), "proxy_rate_limit");
  assert.equal(classifyGeminiError({ status: 429 }), "quota");

  let fakeNow = 5_000_000_000_000;
  let calls = 0;
  const { createProxyGeminiClient } = await import("../src/services/apiTransport.js");

  try {
    let return429 = true;
    const proxyClient = createProxyGeminiClient({
      fetchFn: async () => {
        calls += 1;
        if (return429) {
          return new Response(
            JSON.stringify({
              error: "Too many requests. Please try again shortly.",
              errorCode: "PROXY_RATE_LIMIT"
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "15",
                "X-RateLimit-Source": "proxy"
              }
            }
          );
        }
        return new Response(JSON.stringify({ text: "{\"ok\":true}", usageMetadata: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    // First attempt hits PROXY_RATE_LIMIT -> immediate cascade abort, null returned, 0 cooldowns
    const res1 = await executeCascade(proxyClient, CURATION_MODEL_CASCADE, { contents: "test1" }, {
      cascadeType: "curation",
      now: () => fakeNow
    });
    assert.equal(res1, null);
    assert.equal(calls, 1, "must abort cascade on primary without trying fallback models");
    assert.equal(modelCooldowns.size, 0, "PROXY_RATE_LIMIT must not add any model to modelCooldowns");

    // Within Retry-After window (10s < 15s) -> skips cloud call cleanly
    fakeNow += 10_000;
    const res2 = await executeCascade(proxyClient, CURATION_MODEL_CASCADE, { contents: "test2" }, {
      cascadeType: "curation",
      now: () => fakeNow
    });
    assert.equal(res2, null);
    assert.equal(calls, 1, "must skip cloud call until session Retry-After expires");

    // After Retry-After expires (16s > 15s) -> resumes cloud calls normally
    return429 = false;
    fakeNow += 6_000;
    const res3 = await executeCascade(proxyClient, CURATION_MODEL_CASCADE, { contents: "test3" }, {
      cascadeType: "curation",
      now: () => fakeNow
    });
    assert.ok(res3);
    assert.equal(calls, 2);
  } finally {
    resetSessionWorkingModels();
  }
});

test("executeCascade enforces maxCascadeDurationMs budget clamp without cooldown and skips attempts under 3000ms", async (t) => {
  resetSessionWorkingModels();

  try {
    // 1. Sub-3000ms budget immediately skips all attempts
    let zeroBudgetCalls = 0;
    const noopAi = {
      models: {
        generateContent: async () => {
          zeroBudgetCalls += 1;
          return { text: "ok" };
        }
      }
    };
    const resSub3s = await executeCascade(noopAi, CURATION_MODEL_CASCADE, { contents: "sub3s" }, {
      cascadeType: "curation",
      maxCascadeDurationMs: 2500
    });
    assert.equal(resSub3s, null);
    assert.equal(zeroBudgetCalls, 0);

    // 2. Remaining budget dropping under 3000ms after attempt 1 skips fallback attempt 2
    let fakeNow = 6_000_000_000_000;
    let partialBudgetCalls = 0;
    const slowFailAi = {
      models: {
        generateContent: async () => {
          partialBudgetCalls += 1;
          fakeNow += 42_500; // leaves 2500ms on default 45000ms budget
          const err = new Error("Service Unavailable");
          err.status = 503;
          throw err;
        }
      }
    };
    const resPartial = await executeCascade(slowFailAi, CURATION_MODEL_CASCADE, { contents: "partial" }, {
      cascadeType: "curation",
      now: () => fakeNow
    });
    assert.equal(resPartial, null);
    assert.equal(partialBudgetCalls, 1, "must skip fallback model when under 3000ms remain");
    assert.equal(modelCooldowns.get(CURATION_MODEL_CASCADE[0])?.reason, "transient");

    // 3. Timeout clamped by maxCascadeDurationMs aborts at deadline without adding model cooldown
    resetSessionWorkingModels();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let clampNow = 7_000_000_000_000;
    let capturedSignal = null;
    let clampCalls = 0;
    const hangingAi = {
      models: {
        generateContent: async ({ config }) => {
          clampCalls += 1;
          capturedSignal = config.abortSignal;
          await new Promise(() => {});
        }
      }
    };

    const cascadePromise = executeCascade(hangingAi, CURATION_MODEL_CASCADE, { contents: "clamp" }, {
      cascadeType: "curation",
      timeoutMs: 15_000,
      maxCascadeDurationMs: 5_000,
      now: () => clampNow
    });

    await Promise.resolve();
    await Promise.resolve();
    assert.equal(clampCalls, 1);
    assert.equal(capturedSignal?.aborted, false);

    clampNow += 5_000;
    t.mock.timers.tick(5_000);

    const resClamped = await cascadePromise;
    assert.equal(resClamped, null);
    assert.equal(capturedSignal?.aborted, true);
    assert.equal(clampCalls, 1);
    assert.equal(modelCooldowns.size, 0, "abort caused by budget clamp must not add model to modelCooldowns");
  } finally {
    resetSessionWorkingModels();
  }
});

test("selectMoodStratifiedAnchors and selectDislikedOrDismissedFilms support runtime { movie, weight, zScore } entries", () => {
    const watched = [
        { tmdbId: 101, title: "Generous Pick A", year: "2020", userRating: 9, genre: "Sci-Fi" },
        { tmdbId: 102, title: "Generous Pick B", year: "2021", userRating: 9, genre: "Action" },
        { tmdbId: 103, title: "Time Decayed Recent", year: "2024", userRating: 8, genre: "Drama" },
        { tmdbId: 104, title: "Relative Letdown Five", year: "2022", userRating: 5, genre: "Drama", userNote: "Way too slow and depressing" },
    ];
    const weightedRatings = [
        { movie: watched[0], rating: 9, zScore: 0.4, weight: 8.2 },
        { movie: watched[1], rating: 9, zScore: 0.5, weight: 8.5 },
        { movie: watched[2], rating: 8, zScore: 0.1, weight: 9.8 },
        { movie: watched[3], rating: 5, zScore: -1.6, weight: 3.1 },
    ];
    const prompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi"], weightedRatings },
        "any",
        [{ tmdbId: 999, id: 999, title: "Candidate X", year: "2025", director: "Dir X", genre: "Sci-Fi", overview: "Test plot." }],
        { watched }
    );
    assert.ok(prompt.includes('"Relative Letdown Five" (2022) [5/10]'), "Must surface rating 5 with zScore < -0.4 from nested movie shape");
    assert.ok(prompt.indexOf('"Time Decayed Recent"') < prompt.indexOf('"Generous Pick A"'), "Must sort anchors using runtime weight (9.8 > 8.2)");
});

test("buildGeminiReRankPrompt handles real extractTasteProfile shapes, notes on dislikes/near-misses, [Series], and watchlist", () => {
    const watched = [
        {
            tmdbId: 1,
            title: "Dark",
            year: "2017–2020",
            Type: "series",
            userRating: 10,
            director: "Baran bo Odar",
            genre: "Sci-Fi, Mystery",
            userNote: "Tight puzzle-box time travel where every clue pays off cleanly without filler."
        },
        {
            tmdbId: 2,
            title: "Parasite",
            year: "2019",
            userRating: 5,
            genre: "Thriller, Drama",
            userNote: "Great filmmaking craft but hated the grim bleak tone"
        },
        {
            tmdbId: 3,
            title: "Tenet",
            year: "2020",
            userRating: 7,
            director: "Christopher Nolan",
            genre: "Sci-Fi, Action",
            userNote: "Cool premise but cold characters and muddy audio"
        },
    ];
    const profile = {
        lovedGenreNames: ["Sci-Fi", "Thriller"],
        topDirectors: ["Christopher Nolan", "Denis Villeneuve"],
        userStats: { mean: 8.1, std: 1.4, count: 120 },
        weightedRatings: [
            { movie: watched[0], rating: 10, zScore: 1.3, weight: 10.5 },
            { movie: watched[1], rating: 5, zScore: -2.2, weight: 2.0 },
            { movie: watched[2], rating: 7, zScore: -0.7, weight: 6.4 },
        ],
    };
    const watchlist = [{ tmdbId: 90, title: "Severance", year: "2022", mediaType: "tv" }];
    const candidates = [{ tmdbId: 500, id: 500, title: "Coherence", year: "2013", genre: "Sci-Fi", overview: "Dinner party anomaly." }];

    const prompt = buildGeminiReRankPrompt(profile, "mind-bending", candidates, { watched, watchlist });

    assert.ok(prompt.includes('"Dark" (2017–2020) [10/10] [Series]'), "Anchor keeps [10/10] immediately after year and adds [Series]");
    assert.ok(prompt.includes("Tight puzzle-box time travel where every clue pays off cleanly without filler."), "Anchor preserves 180-char userNote");
    assert.ok(prompt.includes('"Parasite" (2019) [5/10]'), "Dislike keeps [5/10] contract");
    assert.ok(prompt.includes("hated the grim bleak tone"), "Dislike includes userNote");
    assert.ok(prompt.includes('"Tenet" (2020) [7/10'), "Near Miss keeps [7/10 contract");
    assert.ok(prompt.includes("cold characters and muddy audio"), "Near Miss includes userNote");
    assert.ok(prompt.includes("8.1/10"), "Rating baseline from real userStats.mean");
    assert.ok(prompt.includes("Christopher Nolan, Denis Villeneuve"), "Handles string[] topDirectors from extractTasteProfile");
    assert.ok(prompt.includes("Severance"), "Watchlist signal included when non-empty");
});

test("buildGeminiReRankPrompt formats unbiased candidate metadata, enables equal-footing + optional wildcardPicks curation, and stays <= 20k chars", () => {
    const longOverview = "A".repeat(160) + " climax twist about memory loops." + "Z".repeat(200);
    const baseCandidate = {
        tmdbId: 888,
        id: 888,
        title: "Looper Two",
        year: "2025",
        director: "Rian Johnson",
        matchScore: 76,
        genre: "Sci-Fi, Thriller",
        vote_average: 7.9,
        vote_count: 1400,
        runtimeMinutes: 118,
        spokenLanguages: ["English"],
        originCountry: ["US"],
        cast: ["Joseph Gordon-Levitt", "Emily Blunt", "Bruce Willis", "Jeff Daniels"],
        keywordNames: ["time travel", "hitman", "noir", "loop", "dystopia", "extra-sixth-tag"],
        tagline: "Hunted by your future in a city where time itself has a price tag on every second.",
        matchReasons: ["Recent cold-start gem"],
        overview: longOverview,
    };

    const stringShapedCandidate = {
        tmdbId: 889,
        id: 889,
        title: "String Field Movie",
        year: "2024",
        director: "Denis Villeneuve",
        matchScore: 81,
        genre: "Sci-Fi",
        vote_average: 8.1,
        vote_count: 950,
        runtimeMinutes: 142,
        spokenLanguages: "N/A",
        originCountry: "US, CA, GB",
        cast: "Actor One, Actor Two, Actor Three, Actor Four",
        keywordNames: ["desert", "prophecy"],
        tagline: "Short tagline",
        overview: "String shaped metadata test.",
    };

    const prompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi"] },
        "any",
        [baseCandidate, stringShapedCandidate],
        { watched: [{ tmdbId: 1, title: "Matrix", year: "1999", userRating: 10 }] }
    );

    assert.ok(prompt.includes("118m"), "Includes candidate runtime");
    assert.ok(prompt.includes("English"), "Includes candidate language");
    assert.ok(!prompt.includes("English | US"), "Omits redundant originCountry when spokenLanguages is present");
    assert.ok(prompt.includes("US, CA"), "Falls back to comma-joined originCountry (capped at 2) when spokenLanguages is N/A");
    assert.ok(!prompt.includes("GB"), "Caps fallback originCountry at 2 entries");
    assert.ok(prompt.includes("Joseph Gordon-Levitt, Emily Blunt, Bruce Willis"), "Includes top 3 cast");
    assert.ok(!prompt.includes("Jeff Daniels"), "Caps cast at 3 names");
    assert.ok(prompt.includes("Actor One, Actor Two, Actor Three"), "Handles comma-joined string cast from formatTmdbMovieDetails");
    assert.ok(!prompt.includes("Actor Four"), "Caps comma-joined string cast at 3 names");
    assert.ok(prompt.includes("time travel, hitman, noir, loop, dystopia"), "Includes top 5 themes");
    assert.ok(!prompt.includes("extra-sixth-tag"), "Caps themes at 5 keywords");
    assert.ok(prompt.includes("climax twist about memory loops."), "Includes plot up to 250 chars");
    assert.ok(!prompt.includes("Z".repeat(100)), "Caps plot at 250 chars");
    assert.doesNotMatch(prompt, /\|\s*Match:\s*\d+%|\|\s*Match:\s*N\/A/, "Must omit calibrated % Match from candidate lines");
    assert.doesNotMatch(prompt, /#1[–-]#?15/i, "Must remove #1-#15 obedience directive");
    assert.doesNotMatch(prompt, /calibrated ranker score/i, "Must avoid anchoring Gemini on hidden math rank");
    assert.match(prompt, /Curate openly:/i, "Uses unbiased open curation instruction");
    assert.match(prompt, /wildcardPicks/i, "Documents optional outside wildcardPicks slot");
    assert.ok(prompt.includes("[Recent cold-start gem]"), "Preserves qualitative matchReasons hints");

    // Worst-case 40 candidates + 10 anchors + 5 dislikes + 3 recent + 4 near misses + 8 watchlist
    const fullWatched = [
        ...Array.from({ length: 10 }, (_, i) => ({ tmdbId: i + 1, title: `Anchor Film ${i + 1}`, year: "2020", userRating: 10, director: "Director Name", genre: "Sci-Fi, Thriller", userNote: "A".repeat(180) })),
        ...Array.from({ length: 5 }, (_, i) => ({ tmdbId: i + 20, title: `Dislike Film ${i + 1}`, year: "2021", userRating: 3, genre: "Horror", userNote: "B".repeat(180) })),
        ...Array.from({ length: 4 }, (_, i) => ({ tmdbId: i + 30, title: `Near Miss ${i + 1}`, year: "2022", userRating: 7, genre: "Drama", userNote: "C".repeat(180) })),
    ];
    const fortyRich = Array.from({ length: 40 }, (_, idx) => ({
        ...baseCandidate,
        tmdbId: 900 + idx,
        id: 900 + idx,
        title: `Rich Candidate Title ${idx + 1}`,
        overview: "D".repeat(500),
    }));
    const fullWatchlist = Array.from({ length: 8 }, (_, i) => ({ tmdbId: 50 + i, title: `Watchlist Movie ${i + 1}`, year: "2024" }));
    const fullPrompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi", "Thriller", "Action"], topDirectors: ["Denis Villeneuve", "Christopher Nolan", "Ridley Scott"], userStats: { mean: 7.8, std: 1.5, count: 122 } },
        "any",
        fortyRich,
        { watched: fullWatched, watchlist: fullWatchlist }
    );
    assert.ok(fullPrompt.length <= 20000, `Expected worst-case 40-candidate prompt <= 20000 chars, got ${fullPrompt.length}`);
});

test("buildGeminiReRankPrompt surfaces 25 favorites, all remaining userNotes without duplication, LOVED SERIES / ANIME, and omits empty blocks", () => {
    const watched = [
        // Top 10 anchors (including 1 loved series "Dark" + 1 anchor with note)
        { tmdbId: 101, title: "Dark", Type: "series", year: "2017–2020", userRating: 10, dateWatched: "2026-10-10", userNote: "Best puzzle box ever" },
        ...Array.from({ length: 9 }, (_, i) => ({
            tmdbId: 102 + i,
            title: `Top Anchor ${i + 1}`,
            year: "2019",
            userRating: 10,
            dateWatched: `2026-10-0${9 - i}`,
            userNote: i === 0 ? "Unique anchor note #1" : ""
        })),
        // Ranks 11..25 (including #15 no note, #22 with note) + #26 excluded from Additional Top Favorites
        ...Array.from({ length: 16 }, (_, idx) => {
            const rank = 11 + idx;
            return {
                tmdbId: 200 + rank,
                title: `Broader Fav ${rank}`,
                year: "2018",
                userRating: 9 - (rank >= 15 ? 1 : 0),
                dateWatched: `2025-01-${String(28 - idx).padStart(2, "0")}`,
                userNote: rank === 22 ? "Loved the quiet coastal ending" : ""
            };
        }),
        // Loved anime series outside top 10 anchors
        { tmdbId: 301, title: "Attack on Titan", year: "2013–2023", userRating: 9, dateWatched: "2024-06-01", userNote: "Unmatched escalation" },
        // Two 7★ / 6★ films with userNotes outside Near Miss top-4
        ...Array.from({ length: 6 }, (_, i) => ({
            tmdbId: 400 + i,
            title: `Mid Film ${i + 1}`,
            year: "2020",
            userRating: 7,
            genre: "Drama",
            dateWatched: `2024-02-0${6 - i}`,
            userNote: i >= 4 ? `Extra seven star note #${i + 1}` : `Near miss note ${i + 1}`
        })),
        // Disliked film with note
        { tmdbId: 500, title: "Boring Dud", year: "2021", userRating: 3, userNote: "Way too sluggish" }
    ];

    const prompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi", "Drama"] },
        "any",
        [{ tmdbId: 900, id: 900, title: "Candidate X", year: "2024", genre: "Sci-Fi", vote_average: 7.5 }],
        { watched }
    );

    const anchorSection = prompt.split("USER'S FAVORITE ANCHOR FILMS:")[1].split("USER'S DISLIKED / DISMISSED FILMS")[0];
    const anchorCount = anchorSection.trim().split("\n").filter(Boolean).length;
    assert.equal(anchorCount, 10, "Primary anchor block keeps max 10 items");

    assert.ok(prompt.includes("ADDITIONAL TOP FAVORITES:"), "Includes broader favorites header");
    assert.ok(prompt.includes('"Broader Fav 15" (2018) [8/10]'), "Includes rank #15 favorite");
    assert.ok(prompt.includes('"Broader Fav 22" (2018) [8/10]'), "Includes rank #22 favorite");
    assert.ok(prompt.includes('"Broader Fav 25" (2018) [8/10]'), "Includes rank #25 favorite");
    assert.ok(!prompt.includes('"Broader Fav 26"'), "Caps total favorites at 25");

    assert.ok(prompt.includes("LOVED SERIES / ANIME:"), "Includes Loved Series / Anime block");
    assert.ok(prompt.includes('"Attack on Titan" (2013–2023) [9/10] [Series]'), "Labels range-year anime with [Series]");
    assert.ok(prompt.includes('"Dark" (2017–2020) [10/10] [Series]'), "Preserves Dark [Series] label");

    assert.ok(prompt.includes("ADDITIONAL VIEWER NOTES:"), "Includes Additional Viewer Notes section");
    assert.ok(prompt.includes("Loved the quiet coastal ending"), "Includes note from #22 favorite");
    assert.ok(prompt.includes("Extra seven star note #5"), "Includes 7★ note outside Near Miss top-4");
    assert.ok(prompt.includes("Extra seven star note #6"), "Includes second extra 7★ note");

    const notesSection = prompt.split("ADDITIONAL VIEWER NOTES:")[1].split("PRE-RANKED CANDIDATE MOVIES")[0];
    assert.equal(notesSection.includes("Unique anchor note #1"), false, "Does not duplicate primary anchor notes");
    assert.equal(notesSection.includes("Way too sluggish"), false, "Does not duplicate disliked film notes");

    // Empty-section omission check on minimal fixture
    const minimalPrompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi"] },
        "any",
        [{ tmdbId: 901, id: 901, title: "Solo Cand", year: "2024", genre: "Sci-Fi", vote_average: 7.4 }],
        { watched: [{ tmdbId: 1, title: "Matrix", year: "1999", userRating: 10 }] }
    );
    assert.equal(minimalPrompt.includes("ADDITIONAL TOP FAVORITES:"), false, "Omits ADDITIONAL TOP FAVORITES when <= 10 favs");
    assert.equal(minimalPrompt.includes("ADDITIONAL VIEWER NOTES:"), false, "Omits ADDITIONAL VIEWER NOTES when no extra notes");
    assert.equal(minimalPrompt.includes("LOVED SERIES / ANIME:"), false, "Omits LOVED SERIES / ANIME when no series watched");
});

test("buildGeminiReRankPrompt compresses adversarial 40-candidate + 80-note + 10-series vault strictly <= 20000 chars", () => {
    const adversarialWatched = [
        ...Array.from({ length: 15 }, (_, i) => ({
            tmdbId: 1000 + i,
            title: `Favorite Film ${i + 1}`,
            year: "2019",
            userRating: 9,
            dateWatched: `2025-11-${String(28 - i).padStart(2, "0")}`,
            userNote: `Fav note ${i}: ` + "N".repeat(165)
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
            tmdbId: 2000 + i,
            title: `Series Gem ${i + 1}`,
            Type: "series",
            year: "2020–2024",
            userRating: 9,
            dateWatched: `2025-10-${String(20 - i).padStart(2, "0")}`,
            userNote: `Series note ${i}: ` + "S".repeat(160)
        })),
        ...Array.from({ length: 80 }, (_, i) => ({
            tmdbId: 3000 + i,
            title: `Noted Library Film ${i + 1}`,
            year: "2015",
            userRating: i < 5 ? 3 : 7,
            dateWatched: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
            userNote: `Viewer thought ${i}: ` + "M".repeat(160)
        }))
    ];

    const fortyCandidates = Array.from({ length: 40 }, (_, i) => ({
        tmdbId: 9000 + i,
        id: 9000 + i,
        title: `Rich Candidate ${i + 1}`,
        year: "2025",
        director: "Denis Villeneuve",
        genre: "Sci-Fi, Thriller",
        vote_average: 7.9,
        vote_count: 1500,
        runtimeMinutes: 132,
        spokenLanguages: ["English"],
        cast: ["Actor A", "Actor B", "Actor C"],
        keywordNames: ["dystopia", "memory", "mystery", "ai", "noir"],
        tagline: "An unforgettable journey across space and memory.",
        overview: "P".repeat(450)
    }));

    const prompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi", "Thriller"], topDirectors: ["Denis Villeneuve"] },
        { mood: "mind-bending", customVibe: "cerebral sci-fi" },
        fortyCandidates,
        {
            watched: adversarialWatched,
            watchlist: Array.from({ length: 8 }, (_, i) => ({ tmdbId: 8000 + i, title: `Watchlist ${i}`, year: "2025" }))
        }
    );

    assert.ok(prompt.length <= 20000, `Adversarial prompt must fit <= 20000 chars, got ${prompt.length}`);
    assert.ok(prompt.includes("USER'S FAVORITE ANCHOR FILMS:"), "Core anchor block must remain intact");
    assert.ok(prompt.includes("USER'S DISLIKED / DISMISSED FILMS"), "Disliked guardrails must remain intact");
    assert.ok(prompt.includes("PRE-RANKED CANDIDATE MOVIES (Top 40):"), "All 40 candidates must remain in prompt");
    assert.ok(prompt.includes('ID: 9039 | "Rich Candidate 40"'), "40th candidate line must not be truncated");
});

test("wildcardPicks schema uses valid Type enums, preserves reason/anchorIds, avoids 1-item collabSim stretching, and sorts by calibrated matchScore", async () => {
    const prevGKey = process.env.VITE_GEMINI_KEY;
    process.env.VITE_GEMINI_KEY = "TEST_KEY";
    resetSessionWorkingModels();
    resetModelInfoForTests();

    try {
        const watched = [
            { id: "tt1111111", imdbID: "tt1111111", tmdbId: 101, title: "Anchor Film A", year: "2019", userRating: 10, tmdbGenreIds: [878, 18], director: "Dir Seed" }
        ];
        const profile = { lovedGenreIds: [878, 18], lovedGenreNames: ["Sci-Fi", "Drama"], lovedKeywordIds: [701], hatedKeywordIds: [], topCastIds: [], topCrewIds: [], weightedRatings: [] };

        // 60+ entry collabSimMap (catalog max = 0.95) so catalog-max normalization is active
        const collabEntries = Array.from({ length: 60 }, (_, i) => [600 + i, i === 0 ? 0.95 : 0.35 - i * 0.002]);
        collabEntries.push([8881, 0.85]);
        collabEntries.push([8882, 0.20]);
        const collabSimMap = new Map(collabEntries);

        const shortlistPool = Array.from({ length: 12 }, (_, i) => ({
            id: 600 + i,
            tmdbId: 600 + i,
            title: `Shortlist Pick ${i + 1}`,
            year: "2020",
            release_date: "2020-05-01",
            director: `Shortlist Dir ${i + 1}`,
            genre: "Drama",
            tmdbGenreIds: [18],
            genre_ids: [18],
            vote_average: 7.4,
            vote_count: 800,
            overview: `Overview ${i + 1}`
        }));

        const wildcardDetails = {
            8881: {
                tmdbId: 8881,
                imdbID: "tt8881001",
                title: "Wildcard Strong",
                year: "2021",
                release_date: "2021-03-01",
                director: "Wild Dir One",
                cast: "Star One, Star Two",
                castIds: [501],
                crewPersonId: 901,
                tmdbGenreIds: [878, 18],
                tmdbKeywords: [701],
                keywordNames: ["time loop"],
                genre: "Sci-Fi, Drama",
                plot: "Strong wildcard sci-fi plot.",
                vote_average: 8.4,
                vote_count: 2500,
                streamProviders: [{ id: 8, name: "Netflix" }],
                freeProviders: []
            },
            8882: {
                tmdbId: 8882,
                imdbID: "tt8882002",
                title: "Wildcard Mild",
                year: "2023",
                release_date: "2023-07-01",
                director: "Wild Dir Two",
                cast: "Actor B",
                castIds: [502],
                crewPersonId: 902,
                tmdbGenreIds: [18],
                tmdbKeywords: [],
                keywordNames: ["family"],
                genre: "Drama",
                plot: "Moderate wildcard drama.",
                vote_average: 7.1,
                vote_count: 500,
                streamProviders: [{ id: 8, name: "Netflix" }],
                freeProviders: []
            }
        };

        // Direct check: 1-item verifyAndScoreWildcardPicks must match scoring inside full pool (no single-item collabSim stretch)
        const rankerCtx = { profile, collabSimMap, contentSimMap: new Map(), repulsionMap: new Map(), dnaSimMap: new Map(), userProviders: [8] };
        const [expectedMildScored] = rankCandidatePool(
            [wildcardDetails[8882], ...shortlistPool],
            rankerCtx,
            DEFAULT_RANKER_WEIGHTS,
            15,
            { collabNormalization: "catalog-max" },
            null
        ).filter((c) => c.tmdbId === 8882);

        const directWildcards = await verifyAndScoreWildcardPicks(
            [
                { title: "Wildcard Strong", year: "2021", anchorTitles: ["Anchor Film A"], reason: "High Taste-Twin Match Pairs closely with Anchor Film A." },
                { title: "Wildcard Mild", year: "2023", anchorTitles: ["Anchor Film A"], reason: "Reflective drama echoing your themes." }
            ],
            {
                watched,
                watchlist: [],
                existingCandidates: shortlistPool,
                profile,
                mood: "any",
                userProviders: [8],
                collabSimMap,
                rankerWeights: DEFAULT_RANKER_WEIGHTS
            },
            {
                wildcardFinder: async (title) => (title === "Wildcard Strong" ? { tmdbId: 8881, title: "Wildcard Strong", year: "2021" } : { tmdbId: 8882, title: "Wildcard Mild", year: "2023" }),
                detailFetcher: async (id) => wildcardDetails[id] || null
            }
        );

        assert.equal(directWildcards.length, 2);
        assert.equal(directWildcards[0].sourceBucket, "Gemini Wildcard");
        assert.equal(directWildcards[1].matchScore, expectedMildScored.matchScore, "Wildcard Mild must match full-pool calibrated score without 1-item stretching");
        assert.ok(Math.abs(directWildcards[1].rankerProbability - expectedMildScored.rankerProbability) < 1e-6);

        let capturedSchema = null;
        const mockAi = {
            models: {
                generateContent: async ({ config }) => {
                    capturedSchema = config?.responseSchema || null;
                    return {
                        text: JSON.stringify({
                            tasteProfile: { favoriteGenres: ["Sci-Fi", "Drama"], preferredEra: "2010s-2020s", ratingStyle: "Cerebral" },
                            recommendations: shortlistPool.slice(0, 10).map((c) => ({
                                tmdbId: c.tmdbId,
                                title: c.title,
                                year: c.year,
                                anchorTitles: ["Anchor Film A"],
                                reason: `Shortlist pick ${c.title} reason.`
                            })),
                            wildcardPicks: [
                                { title: "Wildcard Strong", year: "2021", anchorTitles: ["Anchor Film A"], reason: "High Taste-Twin Match Pairs closely with Anchor Film A." },
                                { title: "Wildcard Mild", year: "2023", anchorTitles: ["Anchor Film A"], reason: "Reflective drama echoing your themes." }
                            ]
                        }),
                        usageMetadata: { totalTokenCount: 25 }
                    };
                }
            }
        };

        const fullRes = await getMovieRecommendations(watched, [], null, {
            candidates: shortlistPool,
            embeddingIndex: null,
            collabSimMap,
            userProviders: [8],
            aiClient: mockAi,
            wildcardFinder: async (title) => (title === "Wildcard Strong" ? { tmdbId: 8881, title: "Wildcard Strong", year: "2021" } : { tmdbId: 8882, title: "Wildcard Mild", year: "2023" }),
            detailFetcher: async (id) => wildcardDetails[id] || null
        });

        assert.ok(capturedSchema?.properties?.wildcardPicks, "responseSchema declares optional wildcardPicks");
        assert.equal(capturedSchema.properties.wildcardPicks.type, "ARRAY");
        assert.equal(capturedSchema.properties.wildcardPicks.items?.type, "OBJECT");
        assert.equal(capturedSchema.properties.wildcardPicks.items?.properties?.reason?.type, "STRING");
        assert.equal(capturedSchema.required.includes("wildcardPicks"), false, "wildcardPicks must be omitted from required");

        assert.equal(fullRes.recommendations.length, 10, "Final result keeps exact 10 picks when 10 shortlist + 2 wildcards returned");
        const wcRecs = fullRes.recommendations.filter((r) => r.sourceBucket === "Gemini Wildcard");
        assert.equal(wcRecs.length, 2, "Both verified wildcards reserve slots ahead of shortlist tail slicing");
        const strongRec = wcRecs.find((r) => r.tmdbId === 8881);
        assert.ok(strongRec);
        assert.deepEqual(strongRec.anchorTitles, ["Anchor Film A"]);
        assert.deepEqual(strongRec.anchorIds, ["tt1111111"], "Resolves wildcard anchorTitles -> watched anchorIds");
        assert.doesNotMatch(strongRec.reason, /Taste-Twin Match/i, "Sanitizes wildcard prose just like shortlist items");
        assert.ok(strongRec.reason.includes("Pairs closely with Anchor Film A."));

        for (let i = 1; i < fullRes.recommendations.length; i++) {
            assert.ok(fullRes.recommendations[i - 1].matchScore >= fullRes.recommendations[i].matchScore, "Calibrated descending matchScore order stays intact (#2 skipped)");
        }
    } finally {
        if (prevGKey === undefined) delete process.env.VITE_GEMINI_KEY;
        else process.env.VITE_GEMINI_KEY = prevGKey;
    }
});

test("verifyAndScoreWildcardPicks rejects watched mixed-IDs, TV series, provider/mood violations, and 429 failures with 10/10 auto-backfill", async () => {
    const prevGKey = process.env.VITE_GEMINI_KEY;
    process.env.VITE_GEMINI_KEY = "TEST_KEY";
    resetSessionWorkingModels();
    resetModelInfoForTests();

    try {
        const watched = [
            { id: "tt7770001", imdbID: "tt7770001", title: "Already Watched IMDbOnly", year: "2019", userRating: 9, tmdbGenreIds: [35] }
        ];
        const watchlist = [
            { id: "tmdb_7770002", tmdbId: 7770002, title: "Watchlisted Cozy", year: "2022" }
        ];
        const shortlistPool = Array.from({ length: 12 }, (_, i) => ({
            id: 4000 + i,
            tmdbId: 4000 + i,
            title: `Comfort Shortlist ${i + 1}`,
            year: "2020",
            release_date: "2020-02-01",
            director: `Comfort Dir ${i + 1}`,
            genre: "Comedy, Family",
            tmdbGenreIds: [35, 10751],
            genre_ids: [35, 10751],
            vote_average: 7.5,
            vote_count: 900,
            streamProviders: [{ id: 8, name: "Netflix" }],
            overview: "Warm comedy."
        }));

        let seriesFinderCalled = 0;
        const rejectRes = await verifyAndScoreWildcardPicks(
            [
                { title: "Dark", year: "2017–2020", reason: "Series should be blocked early." },
                { title: "Already Watched IMDbOnly", year: "2019", reason: "Duplicate watched." },
                { title: "Watchlisted Cozy", year: "2022", reason: "Duplicate watchlist." },
                { title: "Hulu Only Comedy", year: "2023", reason: "Wrong streaming provider." },
                { title: "Comfort Violating Slasher", year: "2024", reason: "Fails comfort-watch mood gate." }
            ],
            {
                watched,
                watchlist,
                excludeIds: ["tmdb_7770003"],
                existingCandidates: shortlistPool,
                profile: { lovedGenreIds: [35] },
                mood: "comfort-watch",
                userProviders: [8]
            },
            {
                maxWildcards: 10,
                wildcardFinder: async (title) => {
                    if (title === "Dark") { seriesFinderCalled++; return { tmdbId: 70523, title: "Dark", year: "2017–2020", Type: "series" }; }
                    if (title === "Already Watched IMDbOnly") return { tmdbId: 7770001, title: "Already Watched IMDbOnly", year: "2019" };
                    if (title === "Watchlisted Cozy") return { tmdbId: 7770002, title: "Watchlisted Cozy", year: "2022" };
                    if (title === "Hulu Only Comedy") return { tmdbId: 7770004, title: "Hulu Only Comedy", year: "2023" };
                    if (title === "Comfort Violating Slasher") return { tmdbId: 7770005, title: "Comfort Violating Slasher", year: "2024" };
                    return null;
                },
                detailFetcher: async (id) => ({
                    7770001: { tmdbId: 7770001, imdbID: "tt7770001", title: "Already Watched IMDbOnly", year: "2019", tmdbGenreIds: [35], streamProviders: [{ id: 8 }] },
                    7770002: { tmdbId: 7770002, imdbID: "tt7770002", title: "Watchlisted Cozy", year: "2022", tmdbGenreIds: [35], streamProviders: [{ id: 8 }] },
                    7770004: { tmdbId: 7770004, imdbID: "tt7770004", title: "Hulu Only Comedy", year: "2023", tmdbGenreIds: [35], streamProviders: [{ id: 15 }] },
                    7770005: { tmdbId: 7770005, imdbID: "tt7770005", title: "Comfort Violating Slasher", year: "2024", tmdbGenreIds: [27, 53], streamProviders: [{ id: 8 }] }
                }[id] || null)
            }
        );

        assert.equal(seriesFinderCalled, 0, "Series tagged with range year must be rejected before TMDB lookup");
        assert.equal(rejectRes.length, 0, "All invalid wildcards rejected cleanly");

        // End-to-end 429 failure in wildcard lookup must NOT abort Gemini's 10 shortlist picks or trigger fallback
        const mockAi = {
            models: {
                generateContent: async () => ({
                    text: JSON.stringify({
                        tasteProfile: { favoriteGenres: ["Comedy"], preferredEra: "2020s", ratingStyle: "Warm" },
                        recommendations: shortlistPool.slice(0, 8).map((c) => ({
                            tmdbId: c.tmdbId,
                            title: c.title,
                            year: c.year,
                            anchorTitles: ["Already Watched IMDbOnly"],
                            reason: "Cozy shortlist selection."
                        })),
                        wildcardPicks: [
                            { title: "Rate Limited Film", year: "2025", anchorTitles: ["Already Watched IMDbOnly"], reason: "Wildcard that triggers 429." }
                        ]
                    }),
                    usageMetadata: { totalTokenCount: 20 }
                })
            }
        };

        const endToEnd = await getMovieRecommendations(watched, watchlist, null, {
            mood: "comfort-watch",
            userProviders: [8],
            candidates: shortlistPool,
            embeddingIndex: null,
            aiClient: mockAi,
            wildcardFinder: async () => { throw new Error("429 Too Many Requests"); }
        });

        assert.equal(endToEnd.recommendations.length, 10, "Backfills cleanly to 10 picks when Gemini outputs 8 shortlist + 1 failed wildcard");
        assert.equal(endToEnd.modelInfo?.pipeline, "gemini-curation", "429 in wildcard lookup must not abort Gemini curation into ranker fallback");
    } finally {
        if (prevGKey === undefined) delete process.env.VITE_GEMINI_KEY;
        else process.env.VITE_GEMINI_KEY = prevGKey;
    }
});

test("verifyAndScoreWildcardPicks and mergeGeminiExplanationsWithRanker preserve collectionId and collectionName", async () => {
    const shortlistCandidates = [
        {
            id: 603692,
            tmdbId: 603692,
            title: "John Wick: Chapter 4",
            year: "2023",
            director: "Chad Stahelski",
            genre: "Action",
            collectionId: 404609,
            collectionName: "John Wick Collection",
            matchScore: 91
        },
        {
            id: 1002,
            tmdbId: 1002,
            title: "Standalone Thriller",
            year: "2022",
            director: "Jane Doe",
            genre: "Thriller",
            matchScore: 86
        }
    ];

    const verifiedWildcards = await verifyAndScoreWildcardPicks(
        [{ title: "The Godfather Part II", year: "1974", anchorTitles: ["Goodfellas"], reason: "Classic crime saga." }],
        {
            watched: [{ tmdbId: 769, title: "Goodfellas", year: "1990", userRating: 10, tmdbGenreIds: [18, 80] }],
            existingCandidates: shortlistCandidates,
            profile: { lovedGenreIds: [18, 80], lovedKeywordIds: [] }
        },
        {
            wildcardFinder: async () => ({ tmdbId: 240, title: "The Godfather Part II", year: "1974" }),
            detailFetcher: async () => ({
                tmdbId: 240,
                imdbID: "tt0071562",
                title: "The Godfather Part II",
                year: "1974",
                release_date: "1974-12-20",
                director: "Francis Ford Coppola",
                genre: "Drama, Crime",
                tmdbGenreIds: [18, 80],
                tmdbKeywords: [],
                keywordNames: [],
                castIds: [],
                collectionId: 230,
                collectionName: "The Godfather Collection",
                vote_average: 9.0,
                vote_count: 12000,
                streamProviders: [],
                freeProviders: []
            })
        }
    );

    assert.equal(verifiedWildcards.length, 1);
    assert.equal(verifiedWildcards[0].collectionId, 230);
    assert.equal(verifiedWildcards[0].collectionName, "The Godfather Collection");

    const merged = mergeGeminiExplanationsWithRanker(
        {
            tasteProfile: { favoriteGenres: ["Action"], preferredEra: "2020s", ratingStyle: "Bold" },
            recommendations: [
                { tmdbId: 603692, title: "John Wick: Chapter 4", anchorTitles: [], reason: "Relentless gun-fu choreography." }
            ]
        },
        shortlistCandidates,
        { lovedGenreNames: ["Action"] },
        { verifiedWildcards },
        3
    );

    const wickEntry = merged.recommendations.find((r) => r.tmdbId === 603692);
    const godfatherEntry = merged.recommendations.find((r) => r.tmdbId === 240);
    assert.equal(wickEntry?.collectionId, 404609);
    assert.equal(wickEntry?.collectionName, "John Wick Collection");
    assert.equal(godfatherEntry?.collectionId, 230);
    assert.equal(godfatherEntry?.collectionName, "The Godfather Collection");
});

test("mergeGeminiExplanationsWithRanker and offline fallback enforce soft max-1-per-collectionId cap with underflow backfill", async () => {
    const rankedCandidates = [
        { id: 201, tmdbId: 201, title: "John Wick: Chapter 2", year: "2017", director: "Dir A", genre: "Action", collectionId: 404609, collectionName: "John Wick Collection", matchScore: 95 },
        { id: 202, tmdbId: 202, title: "John Wick: Chapter 3", year: "2019", director: "Dir B", genre: "Action", collectionId: 404609, collectionName: "John Wick Collection", matchScore: 93 },
        { id: 203, tmdbId: 203, title: "Standalone Pick 1", year: "2021", director: "Dir C", genre: "Action", matchScore: 90 },
        { id: 204, tmdbId: 204, title: "Standalone Pick 2", year: "2022", director: "Dir D", genre: "Action", matchScore: 88 }
    ];

    const capped = mergeGeminiExplanationsWithRanker(
        {
            tasteProfile: { favoriteGenres: ["Action"], preferredEra: "2020s", ratingStyle: "Bold" },
            recommendations: [
                { tmdbId: 201, title: "John Wick: Chapter 2", anchorTitles: [], reason: "Pick 1" },
                { tmdbId: 202, title: "John Wick: Chapter 3", anchorTitles: [], reason: "Pick 2" },
                { tmdbId: 203, title: "Standalone Pick 1", anchorTitles: [], reason: "Pick 3" }
            ]
        },
        rankedCandidates,
        { lovedGenreNames: ["Action"] },
        {},
        3
    );

    assert.equal(capped.recommendations.length, 3);
    assert.equal(
        capped.recommendations.filter((r) => r.collectionId === 404609).length,
        1,
        "Only 1 film from collectionId 404609 should remain when standalone alternatives exist"
    );
    assert.ok(capped.recommendations.some((r) => r.tmdbId === 204), "Backfills from standalone candidate #4");

    // Underflow protection: if entire pool shares the same collectionId, overflow backfills to targetCount
    const allSameCollection = rankedCandidates.slice(0, 3).map((c) => ({ ...c, collectionId: 404609, collectionName: "John Wick Collection" }));
    const underflowRes = mergeGeminiExplanationsWithRanker(
        {
            tasteProfile: { favoriteGenres: ["Action"], preferredEra: "2020s", ratingStyle: "Bold" },
            recommendations: allSameCollection.map((c) => ({ tmdbId: c.tmdbId, title: c.title, anchorTitles: [], reason: "Same col" }))
        },
        allSameCollection,
        { lovedGenreNames: ["Action"] },
        {},
        3
    );
    assert.equal(underflowRes.recommendations.length, 3, "Must backfill overflow so targetCount is met without underflow");

    // Offline local ranker fallback also enforces max-1-per-collectionId when alternatives exist
    const prevGKey = process.env.VITE_GEMINI_KEY;
    delete process.env.VITE_GEMINI_KEY;
    try {
        const fallbackCandidates = [
            ...Array.from({ length: 4 }, (_, i) => ({
                id: 300 + i,
                tmdbId: 300 + i,
                title: `Franchise Entry ${i + 1}`,
                year: "2020",
                release_date: "2020-05-01",
                director: `Franchise Dir ${i}`,
                genre: "Action",
                tmdbGenreIds: [28],
                genre_ids: [28],
                collectionId: 9090,
                collectionName: "Mega Franchise",
                vote_average: 8.5 - i * 0.05,
                vote_count: 4000,
                collabSim: 0.9 - i * 0.02
            })),
            ...Array.from({ length: 10 }, (_, i) => ({
                id: 400 + i,
                tmdbId: 400 + i,
                title: `Unique Movie ${i + 1}`,
                year: "2021",
                release_date: "2021-06-01",
                director: `Unique Dir ${i}`,
                genre: "Action",
                tmdbGenreIds: [28],
                genre_ids: [28],
                vote_average: 7.5 - i * 0.05,
                vote_count: 1500,
                collabSim: 0.5 - i * 0.02
            }))
        ];
        const offline = await getMovieRecommendations(
            [{ id: 1, tmdbId: 1, title: "Seed", userRating: 9, tmdbGenreIds: [28] }],
            [],
            null,
            { candidates: fallbackCandidates, embeddingIndex: null }
        );
        assert.equal(offline.recommendations.length, 10);
        assert.equal(
            offline.recommendations.filter((r) => r.collectionId === 9090).length,
            1,
            "Offline fallback enforces soft max-1-per-collectionId cap"
        );
    } finally {
        if (prevGKey === undefined) delete process.env.VITE_GEMINI_KEY;
        else process.env.VITE_GEMINI_KEY = prevGKey;
    }
});

test("buildGeminiReRankPrompt includes franchise sequel guardrail and Collection tag when collectionName is present", () => {
    const prompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Action"], topDirectors: ["Chad Stahelski"] },
        "any",
        [
            {
                id: 603692,
                tmdbId: 603692,
                title: "John Wick: Chapter 4",
                year: "2023",
                director: "Chad Stahelski",
                genre: "Action",
                collectionId: 404609,
                collectionName: "John Wick Collection",
                overview: "With the price on his head ever increasing, John Wick uncovers a path to defeating The High Table."
            }
        ],
        { watched: [] }
    );

    assert.ok(prompt.includes("Collection: John Wick Collection"), "Prompt must surface Collection metadata tag");
    assert.ok(prompt.includes("Franchise rule:"), "Prompt must include Franchise sequel guardrail rule");
});

test("generateProfileHash invalidates cleanly when active tasteRules change while keeping empty 8th arg backward-compatible", () => {
    const profile = { lovedGenreIds: [878, 18], hatedKeywordIds: [], topCastIds: [] };
    const watched = [{ tmdbId: 10, title: "Blade Runner", userRating: 10 }];

    const h7 = generateProfileHash(profile, [53], "any", [8], null, "US", watched);
    const h8Empty = generateProfileHash(profile, [53], "any", [8], null, "US", watched, []);
    const h8Inactive = generateProfileHash(
        profile,
        [53],
        "any",
        [8],
        null,
        "US",
        watched,
        [{ id: "r1", text: "No horror", polarity: "avoid", active: false }]
    );
    const h8Active = generateProfileHash(
        profile,
        [53],
        "any",
        [8],
        null,
        "US",
        watched,
        [{ id: "r1", text: "No horror", polarity: "avoid", active: true }]
    );

    assert.equal(h8Empty, h7);
    assert.equal(h8Inactive, h7);
    assert.notEqual(h8Active, h7);
});

test("verifyAndScoreWildcardPicks rejects wildcards matching active avoid tasteRules", async () => {
    const res = await verifyAndScoreWildcardPicks(
        [
            { title: "Forbidden Slow Period Film", year: "2022", reason: "Violates avoid rule" },
            { title: "Clean Sci-Fi Gem", year: "2022", reason: "Allowed gem" }
        ],
        {
            watched: [{ tmdbId: 10, title: "Arrival", year: "2016", userRating: 10, tmdbGenreIds: [878, 18] }],
            profile: { lovedGenreIds: [878, 18], lovedKeywordIds: [] },
            tasteRules: [{ id: "a1", text: "No slow-burn period dramas", polarity: "avoid", active: true }]
        },
        {
            wildcardFinder: async (title) => (
                title === "Forbidden Slow Period Film"
                    ? { tmdbId: 7771, title: "Forbidden Slow Period Film", year: "2022" }
                    : { tmdbId: 7772, title: "Clean Sci-Fi Gem", year: "2022" }
            ),
            detailFetcher: async (id) => (
                id === 7771
                    ? {
                        tmdbId: 7771,
                        title: "Forbidden Slow Period Film",
                        year: "2022",
                        genre: "Drama, History",
                        tmdbGenreIds: [18, 36],
                        plot: "A quiet slow-burn period drama set in Regency England.",
                        tmdbKeywords: [],
                        keywordNames: [],
                        castIds: [],
                        streamProviders: [],
                        freeProviders: []
                    }
                    : {
                        tmdbId: 7772,
                        title: "Clean Sci-Fi Gem",
                        year: "2022",
                        genre: "Sci-Fi",
                        tmdbGenreIds: [878],
                        plot: "A brisk mind-bending orbital rescue mission.",
                        tmdbKeywords: [],
                        keywordNames: [],
                        castIds: [],
                        streamProviders: [],
                        freeProviders: []
                    }
            )
        }
    );

    assert.equal(res.length, 1);
    assert.equal(res[0].tmdbId, 7772);
});

test("buildGeminiReRankPrompt preserves all active/pinned tasteRules ahead of overflow truncation within <= 20000 chars", () => {
    const maxRules = Array.from({ length: 8 }, (_, i) => ({
        id: `tr_${i}`,
        text: `${i % 2 === 0 ? "Prefer" : "Avoid"} rule ${i}: ` + "specific nuance ".repeat(6).trim(),
        polarity: i % 2 === 0 ? "prefer" : "avoid",
        pinned: i < 4,
        active: true
    }));

    const massiveWatched = [
        ...Array.from({ length: 25 }, (_, i) => ({
            tmdbId: 100 + i,
            title: `Favorite Movie ${i + 1}`,
            year: "2018",
            userRating: 9,
            genre: "Sci-Fi, Drama",
            userNote: `Anchor reflection ${i}: ` + "loved atmospheric cinematography ".repeat(5)
        })),
        ...Array.from({ length: 80 }, (_, i) => ({
            tmdbId: 500 + i,
            title: `Extra Noted Film ${i + 1}`,
            year: "2020",
            userRating: 8,
            userNote: `Note ${i}: ` + "rich character study ".repeat(7)
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
            tmdbId: 900 + i,
            title: `Series ${i + 1}`,
            year: "2019–2023",
            Type: "series",
            userRating: 10,
            userNote: "Great pacing."
        }))
    ];

    const candidates = Array.from({ length: 39 }, (_, i) => ({
        id: 9000 + i,
        tmdbId: 9000 + i,
        title: `Candidate Film ${i + 1}`,
        year: "2022",
        director: `Director ${i + 1}`,
        genre: "Sci-Fi, Thriller",
        overview: "O".repeat(250),
        keywordNames: ["dystopia", "memory", "mystery", "ai", "noir"]
    }));

    const prompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi", "Drama"], topDirectors: ["Denis Villeneuve"] },
        "mind-bending",
        candidates,
        { watched: massiveWatched, tasteRules: maxRules }
    );

    assert.ok(prompt.length <= 20000, `Prompt with 8 max-length rules + overflow must fit <= 20000 chars, got ${prompt.length}`);
    assert.ok(prompt.includes("USER'S STEERABLE TASTE RULES"), "Steerable Taste Rules section must appear");
    for (const rule of maxRules) {
        assert.ok(prompt.includes(rule.text), `Active Taste Rule '${rule.id}' must never be truncated away`);
    }
});

test("OMDb fallback pipeline injects active tasteRules into the Gemini prompt", async () => {
    const prevTmdb = process.env.VITE_TMDB_KEY;
    const prevOmdb = process.env.VITE_OMDB_KEY;
    delete process.env.VITE_TMDB_KEY;
    delete process.env.VITE_OMDB_KEY;
    resetSessionWorkingModels({ clearStorage: true });

    let capturedPrompt = "";
    const mockAi = {
        models: {
            generateContent: async ({ contents }) => {
                capturedPrompt = String(contents || "");
                return {
                    text: JSON.stringify({
                        tasteProfile: { favoriteGenres: ["Sci-Fi"], preferredEra: "2010s", ratingStyle: "Focused" },
                        recommendations: [
                            { title: "Ex Machina", year: "2014", type: "movie", genre: "Sci-Fi", matchScore: 91, reason: "Taut cerebral tension." }
                        ]
                    })
                };
            }
        }
    };

    try {
        const res = await getMovieRecommendations(
            [{ imdbID: "tt0816692", title: "Interstellar", year: "2014", userRating: 9, genre: "Sci-Fi" }],
            [],
            undefined,
            {
                aiClient: mockAi,
                tasteRules: [{ id: "tr_omdb", text: "No slasher horror", polarity: "avoid", active: true }]
            }
        );
        assert.ok(capturedPrompt.includes("No slasher horror"), "OMDb fallback prompt must include active tasteRules");
        assert.equal(res.recommendations.length, 1);
    } finally {
        if (prevTmdb === undefined) delete process.env.VITE_TMDB_KEY;
        else process.env.VITE_TMDB_KEY = prevTmdb;
        if (prevOmdb === undefined) delete process.env.VITE_OMDB_KEY;
        else process.env.VITE_OMDB_KEY = prevOmdb;
    }
});
