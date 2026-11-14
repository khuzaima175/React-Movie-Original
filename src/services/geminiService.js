import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { spendTracker } from "./aiSpendTracker.js";
import {
    resolveGeminiKey,
    hasGeminiBackend,
    hasTmdbBackend,
    createProxyGeminiClient,
    fetchOmdbJson
} from "./apiTransport.js";
import {
    extractTasteProfile,
    fetchCandidatePool,
    fetchEmbeddingCandidates,
    enrichCandidatePoolMetadata,
    getRecentReleaseDateFloor,
    getFallbackPoster as getTmdbFallbackPoster
} from "./tmdbService.js";
import { DEFAULT_RANKER_WEIGHTS, rankCandidatePool } from "./rankerService.js";
import { derivePersonalizedRankerWeights, sanitizeFeatureSnapshot } from "./onlineLearningService.js";
import {
    loadDefaultEmbeddingIndex,
    buildCollabSimMapFromIndex,
    buildRepulsionMapFromIndex,
    retrieveAlignedEmbeddingNeighbors
} from "./embeddingService.js";
import {
    loadDefaultContentIndex,
    buildContentSimMap
} from "./contentSimService.js";
import {
    loadDefaultDnaIndex,
    buildDnaSimMap
} from "./dnaService.js";

export const CURATION_MODEL_CASCADE = [
    "gemini-4-hydrogen",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.8-flash"
];

export const FAST_INTERACTIVE_CASCADE = [
    "gemini-3.5-flash-lite",
    "gemini-4-hydrogen",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.8-flash"
];

export const MODEL_DISPLAY_NAMES = {
    "gemini-4-hydrogen": "Gemini 4 Hydrogen",
    "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
    "gemini-3.6-flash": "Gemini 3.6 Flash",
    "gemini-3-flash-preview": "Gemini 3 Flash Preview",
    "gemini-3.5-flash": "Gemini 3.5 Flash",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-3.8-flash": "Gemini 3.8 Flash"
};

export function formatModelDisplayName(modelName) {
    if (!modelName) return "Local Ranker (Offline Fallback)";
    const normalized = String(modelName).trim();
    return MODEL_DISPLAY_NAMES[normalized] || normalized;
}

let cascadeRunSeq = 0;
let lastCurationModelInfo = null;
let lastFastModelInfo = null;

export const MODELS = CURATION_MODEL_CASCADE;
const SMART_CACHE_KEY = 'cinemavault_smart_cache_v3';
const MAX_CACHE_BYTES = 500 * 1024; // 500KB Hard Cap

/**
 * Returns model-specific thinking configuration per Google API spec.
 * gemini-4-hydrogen uses HIGH in curation mode and MEDIUM in fast/interactive mode (never LOW).
 * gemini-3-flash-preview uses LOW in curation mode and MINIMAL in fast chat mode.
 * 3.8-flash, 3.6-flash, and 3.5 models use thinkingLevel: "LOW"; 2.5-flash supports thinkingBudget: 0.
 */
export function getModelThinkingConfig(modelName = "", cascadeType = "curation") {
    const m = String(modelName || "").toLowerCase();
    const isFast = String(cascadeType || "curation").toLowerCase() === "fast";
    if (m.includes("gemini-4-hydrogen")) {
        return { thinkingLevel: isFast ? "MEDIUM" : "HIGH" };
    }
    if (m.includes("gemini-3-flash")) {
        return { thinkingLevel: isFast ? "MINIMAL" : "LOW" };
    }
    if (
        m.includes("gemini-3.8-flash") ||
        m.includes("gemini-3.6-flash") ||
        m.includes("gemini-3.5-flash-lite") ||
        m.includes("gemini-3.5-flash")
    ) {
        return { thinkingLevel: "LOW" };
    }
    if (m.includes("gemini-2.5-flash")) {
        return { thinkingBudget: 0 };
    }
    return undefined;
}

export const WORKING_MODEL_TTL_MS = 30 * 60 * 1000;
export const QUOTA_COOLDOWN_MS = 120_000;
export const DAILY_QUOTA_COOLDOWN_MS = 600_000;
export const TRANSIENT_COOLDOWN_MS = 30_000;
export const FATAL_COOLDOWN_MS = 1_800_000;
export const HYDROGEN_TIMEOUT_MS = 35000;

export function getDefaultAttemptTimeoutMs(model = "") {
    const lowerModel = String(model || "").toLowerCase();
    if (lowerModel.includes("gemini-4-hydrogen")) return HYDROGEN_TIMEOUT_MS;
    if (lowerModel.includes("gemini-3-flash")) return 15000;
    if (lowerModel.includes("gemini-3.6-flash")) return 10000;
    if (lowerModel.includes("gemini-3.8-flash")) return 10000;
    return 8000;
}

export function createGeminiClient(apiKey, options = {}) {
    const resolvedKey = typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : resolveGeminiKey();
    if (resolvedKey) {
        return new GoogleGenAI({
            apiKey: resolvedKey,
            httpOptions: { timeout: options.timeoutMs ?? HYDROGEN_TIMEOUT_MS }
        });
    }
    if (hasGeminiBackend(options)) {
        return createProxyGeminiClient(options);
    }
    return null;
}

export function getWorkingModelStorageKey(cascadeType = "curation") {
    return `cinemavault_working_model_${cascadeType}_v1`;
}

let sessionCurationModel = null;
let sessionFastModel = null;
export const modelCooldowns = new Map();
let clockFn = () => Date.now();

export function setClockForTests(fn) {
    clockFn = typeof fn === "function" ? fn : () => Date.now();
}

function resolveLocalStorage(options = {}) {
    if (options && "storage" in options) {
        return options.storage || null;
    }
    try {
        if (typeof localStorage !== "undefined" && localStorage) {
            return localStorage;
        }
    } catch (_) {}
    return null;
}

function parseDurationStringMs(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === "object" && ("seconds" in val || "nanos" in val)) {
        const ms = Number(val.seconds || 0) * 1000 + Number(val.nanos || 0) / 1e6;
        return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms) : null;
    }
    const str = String(val).trim();
    if (!str) return null;
    const unitRe = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|seconds?|minutes?|hours?)/gi;
    let totalMs = 0;
    let matched = false;
    for (const m of str.matchAll(unitRe)) {
        matched = true;
        const num = Number(m[1]);
        const unit = m[2].toLowerCase();
        if (!Number.isFinite(num)) continue;
        if (unit === "ms") totalMs += num;
        else if (unit === "s" || unit.startsWith("sec")) totalMs += num * 1000;
        else if (unit === "m" || unit.startsWith("min")) totalMs += num * 60_000;
        else if (unit === "h" || unit.startsWith("hour")) totalMs += num * 3_600_000;
    }
    if (matched && totalMs > 0) return Math.ceil(totalMs);
    if (/^\d+(?:\.\d+)?$/.test(str)) {
        const secs = Number(str);
        return Number.isFinite(secs) && secs > 0 ? Math.ceil(secs * 1000) : null;
    }
    return null;
}

function parseRetryDelayMs(err) {
    if (!err) return null;
    if (Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 0) {
        return Math.ceil(err.retryAfterMs);
    }
    if (err?.retryDelay !== undefined) {
        const direct = parseDurationStringMs(err.retryDelay);
        if (direct) return direct;
    }
    const details = [
        ...(Array.isArray(err?.details) ? err.details : []),
        ...(Array.isArray(err?.error?.details) ? err.error.details : [])
    ];
    for (const d of details) {
        if (d?.retryDelay !== undefined) {
            const parsed = parseDurationStringMs(d.retryDelay);
            if (parsed) return parsed;
        }
    }
    const text = [err?.message, err?.error?.message, typeof err === "string" ? err : ""]
        .filter(Boolean)
        .join(" ");
    const jsonMatch = text.match(/"retryDelay"\s*:\s*"([^"]+)"/i);
    if (jsonMatch) {
        const parsed = parseDurationStringMs(jsonMatch[1]);
        if (parsed) return parsed;
    }
    const fieldMatch = text.match(/retryDelay\s*[:=]\s*["']?([0-9]+(?:\.[0-9]+)?\s*(?:ms|s|m|h))/i);
    if (fieldMatch) {
        const parsed = parseDurationStringMs(fieldMatch[1]);
        if (parsed) return parsed;
    }
    const proseMatch = text.match(/retry(?:\s+(?:after|in))?\s+([0-9]+(?:\.[0-9]+)?\s*(?:ms|s|m|h|seconds?|minutes?|hours?))/i);
    if (proseMatch) {
        const parsed = parseDurationStringMs(proseMatch[1]);
        if (parsed) return parsed;
    }
    return null;
}

/**
 * Classifies a Gemini API error into:
 * "quota" | "transient" | "invalid_config" | "auth_fatal"
 */
export function classifyGeminiError(err) {
    if (!err) return "transient";
    const status = Number(err?.status ?? err?.statusCode ?? err?.error?.code ?? err?.code);
    const name = String(err?.name || "").toLowerCase();
    const parts = [
        err?.message,
        err?.error?.message,
        err?.error?.status,
        err?.statusText,
        typeof err === "string" ? err : ""
    ].filter(Boolean).join(" ").toLowerCase();

    if (
        status === 429 ||
        /\b429\b(?!\s*ms)/.test(parts) ||
        parts.includes("resource_exhausted") ||
        parts.includes("quota")
    ) {
        return "quota";
    }

    if (
        status === 401 ||
        status === 403 ||
        status === 404 ||
        /\b(?:401|403|404)\b(?!\s*ms)/.test(parts) ||
        parts.includes("unauthenticated") ||
        parts.includes("permission_denied") ||
        parts.includes("not_found")
    ) {
        return "auth_fatal";
    }

    if (
        status === 400 ||
        /\b400\b(?!\s*ms)/.test(parts) ||
        parts.includes("invalid_argument") ||
        parts.includes("invalid argument")
    ) {
        return "invalid_config";
    }

    if (
        status === 503 ||
        status === 504 ||
        /\b(?:503|504)\b(?!\s*ms)/.test(parts) ||
        name.includes("abort") ||
        name.includes("timeout") ||
        /timeout|timed out|abort|network|fetch failed|econn|enotfound|etimedout|unavailable/i.test(parts)
    ) {
        return "transient";
    }

    return "transient";
}

function isDailyExhaustedError(err) {
    const msg = [err?.message, err?.error?.message, typeof err === "string" ? err : ""]
        .filter(Boolean)
        .join(" ");
    return /\blimit\s*:\s*0\b|perday|per_day|requests\s+per\s+day|daily\s+(?:rpd\s+)?(?:quota\s+)?exhausted|\brpd\b.*exhaust/i.test(msg);
}

function getCooldownMsForError(err, reason) {
    if (reason === "quota") {
        const retryMs = parseRetryDelayMs(err);
        if (retryMs) return retryMs;
        return isDailyExhaustedError(err) ? DAILY_QUOTA_COOLDOWN_MS : QUOTA_COOLDOWN_MS;
    }
    if (reason === "invalid_config" || reason === "auth_fatal") {
        return FATAL_COOLDOWN_MS;
    }
    return TRANSIENT_COOLDOWN_MS;
}

function getPrimaryBlockMeta(err, reason, nowMs, cooldownMs) {
    const isPersistentBlock =
        reason === "invalid_config" ||
        reason === "auth_fatal" ||
        (reason === "quota" && isDailyExhaustedError(err));
    const blockDuration = isPersistentBlock ? WORKING_MODEL_TTL_MS : cooldownMs;
    return {
        primaryBlockedUntilMs: nowMs + blockDuration,
        primaryReason: reason
    };
}

function isModelInCooldown(model, nowMs) {
    const entry = modelCooldowns.get(model);
    if (!entry) return false;
    if (nowMs >= entry.untilMs) {
        modelCooldowns.delete(model);
        return false;
    }
    return true;
}

function readPersistedWorkingModel(cascadeType, nowMs, storage) {
    if (!storage || typeof storage.getItem !== "function") return null;
    const key = getWorkingModelStorageKey(cascadeType);
    try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.model !== "string" || !Number.isFinite(parsed.savedAt)) {
            return null;
        }
        if (nowMs - parsed.savedAt >= WORKING_MODEL_TTL_MS) {
            try { storage.removeItem?.(key); } catch (_) {}
            return null;
        }
        return parsed;
    } catch (_) {
        return null;
    }
}

function writePersistedWorkingModel(cascadeType, model, nowMs, storage, primaryMeta = null) {
    if (!storage || typeof storage.setItem !== "function") return;
    const key = getWorkingModelStorageKey(cascadeType);
    const payload = { model, savedAt: nowMs };
    if (primaryMeta && Number.isFinite(primaryMeta.primaryBlockedUntilMs) && primaryMeta.primaryBlockedUntilMs > nowMs) {
        payload.primaryBlockedUntilMs = primaryMeta.primaryBlockedUntilMs;
        if (primaryMeta.primaryReason) {
            payload.primaryReason = primaryMeta.primaryReason;
        }
    }
    try {
        storage.setItem(key, JSON.stringify(payload));
    } catch (_) {}
}

function clearPersistedWorkingModel(cascadeType, storage) {
    if (!storage || typeof storage.removeItem !== "function") return;
    const key = getWorkingModelStorageKey(cascadeType);
    try {
        storage.removeItem(key);
    } catch (_) {}
}

export const resetSessionWorkingModels = (options = {}) => {
    sessionCurationModel = null;
    sessionFastModel = null;
    modelCooldowns.clear();
    if (options?.clearStorage) {
        const storage = resolveLocalStorage(options);
        clearPersistedWorkingModel("curation", storage);
        clearPersistedWorkingModel("fast", storage);
    }
};

export const getSessionCurationModel = () => sessionCurationModel;
export const getSessionFastModel = () => sessionFastModel;

function resolveCascadeOrder(
    cascade = CURATION_MODEL_CASCADE,
    cascadeType = "curation",
    nowMs = Date.now(),
    storage = null,
    options = {}
) {
    const tracker = options?.spendTracker || spendTracker;
    const allowArgon = typeof tracker?.canUseArgon === "function" ? tracker.canUseArgon() : true;
    const eligibleCascade = Array.isArray(cascade)
        ? (allowArgon ? cascade : cascade.filter(m => !String(m || "").toLowerCase().includes("argon")))
        : [];
    if (eligibleCascade.length === 0) {
        return { candidateModels: [], allInCooldown: false, persisted: null };
    }
    const primary = eligibleCascade[0];
    let candidateModels = eligibleCascade.filter(m => !isModelInCooldown(m, nowMs));

    if (candidateModels.length === 0) {
        // Every model is currently inside its cooldown window: try only the single soonest-expiring model
        let soonestModel = primary;
        let minUntil = Infinity;
        for (const m of eligibleCascade) {
            const until = modelCooldowns.get(m)?.untilMs ?? Infinity;
            if (until < minUntil) {
                minUntil = until;
                soonestModel = m;
            }
        }
        return { candidateModels: [soonestModel], allInCooldown: true, persisted: null };
    }

    const sessionActive =
        cascadeType === "curation"
            ? sessionCurationModel
            : (cascadeType === "fast" ? sessionFastModel : null);
    const persisted = readPersistedWorkingModel(cascadeType, nowMs, storage);
    const persistedPrimaryBlocked =
        Number.isFinite(persisted?.primaryBlockedUntilMs) && persisted.primaryBlockedUntilMs > nowMs;
    const primaryAvailable = candidateModels.includes(primary) && !persistedPrimaryBlocked;

    // Only promote a working fallback ahead of cascade[0] while cascade[0] is actually blocked/in-cooldown.
    if (!primaryAvailable) {
        const preferred =
            sessionActive && candidateModels.includes(sessionActive)
                ? sessionActive
                : (persisted?.model && candidateModels.includes(persisted.model) ? persisted.model : null);
        if (preferred) {
            candidateModels = [preferred, ...candidateModels.filter(m => m !== preferred)];
        }
    }

    return { candidateModels, allInCooldown: false, persisted };
}

/**
 * Executes a resilient cascade across models with cooldown backoff, abort-on-timeout,
 * all-on-cooldown soonest-expiry fallback, and persisted working-model preference.
 */
export async function executeCascade(ai, cascade, requestParams, options = {}) {
    if (!ai?.models?.generateContent) {
        throw new Error("Invalid GoogleGenAI client provided to executeCascade");
    }
    if (!Array.isArray(cascade) || cascade.length === 0) {
        return null;
    }

    const cascadeType = options.cascadeType || "curation";
    const getNow = typeof options.now === "function" ? options.now : clockFn;
    const startNowMs = getNow();
    const storage = resolveLocalStorage(options);
    const tracker = options.spendTracker || spendTracker;

    const { candidateModels, persisted } = resolveCascadeOrder(cascade, cascadeType, startNowMs, storage, options);
    if (candidateModels.length === 0) {
        return null;
    }
    const primaryModel = candidateModels[0] || cascade[0];
    let primaryFailureMeta =
        persisted && Number.isFinite(persisted.primaryBlockedUntilMs) && persisted.primaryBlockedUntilMs > startNowMs
            ? { primaryBlockedUntilMs: persisted.primaryBlockedUntilMs, primaryReason: persisted.primaryReason }
            : null;
    if (!primaryFailureMeta) {
        const existingPrimaryCd = modelCooldowns.get(primaryModel);
        if (existingPrimaryCd && existingPrimaryCd.untilMs > startNowMs) {
            primaryFailureMeta = {
                primaryBlockedUntilMs: existingPrimaryCd.untilMs,
                primaryReason: existingPrimaryCd.reason
            };
        }
    }

    let lastError = null;
    for (const model of candidateModels) {
        const lowerModel = String(model || "").toLowerCase();
        const isHydrogen = lowerModel.includes("gemini-4-hydrogen");

        const thinkingConfig = getModelThinkingConfig(model, cascadeType);
        const sanitizedConfig = { ...(requestParams.config || {}) };
        delete sanitizedConfig.frequencyPenalty;
        delete sanitizedConfig.presencePenalty;
        if (sanitizedConfig.candidateCount !== undefined && sanitizedConfig.candidateCount > 1) {
            delete sanitizedConfig.candidateCount;
        }
        if (isHydrogen) {
            delete sanitizedConfig.temperature;
        }

        const controller = new AbortController();
        const callerSignal = sanitizedConfig.abortSignal;
        let onCallerAbort;
        if (callerSignal) {
            if (callerSignal.aborted) {
                controller.abort(callerSignal.reason);
            } else {
                onCallerAbort = () => controller.abort(callerSignal.reason);
                callerSignal.addEventListener("abort", onCallerAbort, { once: true });
            }
        }

        const mergedConfig = {
            ...sanitizedConfig,
            ...(thinkingConfig ? { thinkingConfig } : {}),
            abortSignal: controller.signal
        };

        const defaultTimeout = getDefaultAttemptTimeoutMs(model);
        const perAttemptTimeout = options.timeoutMs || defaultTimeout;

        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`Model ${model} timed out after ${perAttemptTimeout}ms`);
                controller.abort(err);
                reject(err);
            }, perAttemptTimeout);
        });

        try {
            const callPromise = Promise.resolve().then(() =>
                ai.models.generateContent({
                    ...requestParams,
                    model,
                    config: mergedConfig
                })
            );
            callPromise.catch(() => {});
            const response = await Promise.race([callPromise, timeoutPromise]);

            if (response?.usageMetadata && typeof tracker?.record === "function") {
                tracker.record(model, response.usageMetadata);
            }

            const successNowMs = getNow();
            modelCooldowns.delete(model);
            if (cascadeType === "curation") {
                sessionCurationModel = model;
            } else if (cascadeType === "fast") {
                sessionFastModel = model;
            }
            writePersistedWorkingModel(
                cascadeType,
                model,
                successNowMs,
                storage,
                model === primaryModel ? null : primaryFailureMeta
            );

            cascadeRunSeq += 1;
            const winInfo = buildCascadeModelInfo(
                cascade,
                model,
                cascadeType,
                cascadeType === "fast" ? "gemini-fast" : "gemini-curation",
                {
                    usageMetadata: response?.usageMetadata ?? null,
                    recordedAt: successNowMs,
                    seq: cascadeRunSeq
                }
            );
            if (cascadeType === "curation") {
                lastCurationModelInfo = winInfo;
            } else if (cascadeType === "fast") {
                lastFastModelInfo = winInfo;
            }

            return response;
        } catch (err) {
            lastError = err;
            const failNowMs = getNow();
            const reason = classifyGeminiError(err);
            const cooldownMs = getCooldownMsForError(err, reason);
            modelCooldowns.set(model, {
                untilMs: failNowMs + cooldownMs,
                reason
            });
            if (lowerModel.includes("argon") && (reason === "quota" || reason === "auth_fatal")) {
                tracker?.markArgonUnavailable?.();
            }
            if (model === primaryModel) {
                primaryFailureMeta = getPrimaryBlockMeta(err, reason, failNowMs, cooldownMs);
            }
            if (cascadeType === "curation" && sessionCurationModel === model) {
                sessionCurationModel = null;
            } else if (cascadeType === "fast" && sessionFastModel === model) {
                sessionFastModel = null;
            }
            if (readPersistedWorkingModel(cascadeType, failNowMs, storage)?.model === model) {
                clearPersistedWorkingModel(cascadeType, storage);
            }
            console.warn(`Model ${model} failed in ${cascadeType} cascade [${reason}, cooldown=${cooldownMs}ms] (${err.message || err}). Trying fallback...`);
        } finally {
            clearTimeout(timer);
            if (callerSignal && onCallerAbort) {
                callerSignal.removeEventListener("abort", onCallerAbort);
            }
        }
    }

    if (lastError) {
        console.warn(`All models in ${cascadeType} cascade failed:`, lastError.message || lastError);
    }
    return null;
}

/**
 * Sanitizes strings for prompt safety
 */
export const cleanStr = (val) => {
    if (val === null || val === undefined) return "";
    return String(val).replace(/[|\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
};

/**
 * Normalizes matchScore to a valid percentage (50 - 99)
 * Corrects LLM decimal probabilities (e.g., 0.94 -> 94) and raw 1s
 */
export const normalizeMatchScore = (val) => {
    let n = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(n) || n <= 0) return 88;
    // If LLM returned a decimal ratio (0.01 - 1.0) or edge 1
    if (n <= 1.0) {
        const scaled = n <= 0.1 ? n * 1000 : n * 100;
        return Math.min(99, Math.max(50, Math.round(scaled)));
    }
    // If accidentally scored 1-5 (legacy 5-star scores), map to realistic 88%
    if (n <= 5) return 88;
    return Math.min(99, Math.max(50, Math.round(n)));
};

/**
 * Resilient JSON Sanitizer & Parser
 * Handles markdown code-blocks (```json ... ```) and raw string quirks from LLMs
 */
export function sanitizeAndParseJSON(rawText) {
    if (!rawText) throw new Error("Empty response from AI engine");
    let cleaned = String(rawText).trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        cleaned = jsonMatch[1].trim();
    }
    return JSON.parse(cleaned);
}

/**
 * Master ID Cross-Referencing Collision Guard for LRU Cache
 */
export function getSmartCache(hash, watched = [], watchlist = []) {
    try {
        const cache = JSON.parse(localStorage.getItem(SMART_CACHE_KEY) || '{}');
        const entry = cache[hash];
        if (!entry || !entry.data || (Date.now() - (entry.ts || 0) > 24 * 60 * 60 * 1000)) {
            return null;
        }

        // Build master set of all known identifiers across vault and watchlist
        const currentIds = new Set([
            ...watched.flatMap(m => [
                m.imdbID ? String(m.imdbID).toLowerCase() : null,
                m.tmdbId ? String(m.tmdbId).toLowerCase() : null,
                m.id ? String(m.id).toLowerCase() : null
            ]).filter(Boolean),
            ...watchlist.flatMap(m => [
                m.imdbID ? String(m.imdbID).toLowerCase() : null,
                m.tmdbId ? String(m.tmdbId).toLowerCase() : null,
                m.id ? String(m.id).toLowerCase() : null
            ]).filter(Boolean)
        ]);

        const validRecs = (entry.data.recommendations || []).map(rec => ({
            ...rec,
            matchScore: normalizeMatchScore(rec.matchScore)
        })).filter(rec => {
            const recIds = [
                rec.imdbID ? String(rec.imdbID).toLowerCase() : null,
                rec.tmdbId ? String(rec.tmdbId).toLowerCase() : null,
                rec.id ? String(rec.id).toLowerCase() : null
            ].filter(Boolean);

            return !recIds.some(id => currentIds.has(id));
        });

        if (validRecs.length >= 4) {
            return { ...entry.data, recommendations: validRecs };
        }
    } catch (e) {
        console.warn("SmartCache read failed:", e);
    }
    return null;
}

/**
 * 500KB LRU Cache Eviction Manager (Single-Pass O(N log N) Eviction)
 */
export function setSmartCache(hash, data) {
    try {
        let cache = JSON.parse(localStorage.getItem(SMART_CACHE_KEY) || '{}');
        cache[hash] = { data, ts: Date.now() };

        const keys = Object.keys(cache);
        if (keys.length > 1) {
            // Sort keys from oldest to newest
            const sortedKeys = keys.sort((a, b) => (cache[a]?.ts || 0) - (cache[b]?.ts || 0));

            // Single serialization check
            let serialized = JSON.stringify(cache);
            let idx = 0;
            while (serialized.length * 2 > MAX_CACHE_BYTES && idx < sortedKeys.length - 1) {
                delete cache[sortedKeys[idx]];
                idx++;
            }
            if (idx > 0) {
                serialized = JSON.stringify(cache);
            }
            localStorage.setItem(SMART_CACHE_KEY, serialized);
        } else {
            localStorage.setItem(SMART_CACHE_KEY, JSON.stringify(cache));
        }
    } catch (e) {
        console.warn("SmartCache write failed, resetting cache:", e);
        try { localStorage.removeItem(SMART_CACHE_KEY); } catch (_) { }
    }
}

export function clearSmartCache(hash) {
    try {
        let cache = JSON.parse(localStorage.getItem(SMART_CACHE_KEY) || '{}');
        if (hash) {
            delete cache[hash];
            localStorage.setItem(SMART_CACHE_KEY, JSON.stringify(cache));
        } else {
            localStorage.removeItem(SMART_CACHE_KEY);
        }
    } catch (_) { }
}

/**
 * Summarize which Gemini model ran (or why fallback occurred) for UI diagnostics & testing.
 */
export function buildCascadeModelInfo(
    cascade = CURATION_MODEL_CASCADE,
    winningModel = null,
    cascadeType = "curation",
    pipeline = "gemini-curation",
    extra = {}
) {
    const nowMs = Number.isFinite(extra.recordedAt) ? extra.recordedAt : Date.now();
    const cooldownModels = [];
    for (const candidate of cascade || []) {
        const entry = modelCooldowns.get(candidate);
        if (entry && entry.untilMs > nowMs) {
            cooldownModels.push({ model: candidate, reason: entry.reason });
        }
    }
    const primaryModel = cascade?.[0] || null;
    const normalizedModel = winningModel || null;
    return {
        model: normalizedModel,
        displayName: formatModelDisplayName(normalizedModel),
        cascadeType,
        pipeline,
        primaryModel,
        isFallback: Boolean(!normalizedModel || (primaryModel && normalizedModel !== primaryModel)),
        cooldownModels,
        usageMetadata: extra.usageMetadata ?? null,
        recordedAt: nowMs,
        seq: extra.seq ?? 0
    };
}

export function getLastModelInfo(cascadeType = "curation") {
    const info = cascadeType === "fast" ? lastFastModelInfo : lastCurationModelInfo;
    return info ? { ...info, cooldownModels: [...(info.cooldownModels || [])] } : null;
}

export function getPreferredCascadeModel(
    cascade = CURATION_MODEL_CASCADE,
    cascadeType = "curation",
    options = {}
) {
    const nowMs = typeof options.now === "function" ? options.now() : Date.now();
    const storage = resolveLocalStorage(options);
    const { candidateModels } = resolveCascadeOrder(cascade, cascadeType, nowMs, storage, options);
    return candidateModels[0] ?? null;
}

export function resolveResultModelInfo(result, cascadeType = "curation") {
    if (result?.modelInfo) {
        return result.modelInfo;
    }
    if (cascadeType === "curation" && lastCurationModelInfo) {
        return {
            ...lastCurationModelInfo,
            cooldownModels: [...(lastCurationModelInfo.cooldownModels || [])]
        };
    }
    return buildCascadeModelInfo(
        cascadeType === "fast" ? FAST_INTERACTIVE_CASCADE : CURATION_MODEL_CASCADE,
        null,
        cascadeType,
        "ranker-fallback"
    );
}

export function resetModelInfoForTests() {
    lastCurationModelInfo = null;
    lastFastModelInfo = null;
    cascadeRunSeq = 0;
}

// In-memory module cache to avoid redundant OMDb API calls during the session
const omdbMemoryCache = new Map();

/**
 * Fetch real movie data from OMDB API to replace hallucinated ratings
 */
export const fetchRealOMDBData = async (title, year, signal) => {
    try {
        const cleanTitle = title.replace(/^["']|["']$/g, "").trim();
        const cleanYear = year ? String(year).trim().match(/\d{4}/)?.[0] : null;
        const cacheKey = `${cleanTitle.toLowerCase()}::${cleanYear || "noyear"}`;

        if (omdbMemoryCache.has(cacheKey)) {
            return omdbMemoryCache.get(cacheKey);
        }

        let data = await fetchOmdbJson(
            { t: cleanTitle, ...(cleanYear ? { y: cleanYear } : {}) },
            { signal }
        );
        if (!data) return null;

        if (data.Response !== "True" && cleanYear) {
            const retryData = await fetchOmdbJson({ t: cleanTitle }, { signal });
            if (retryData) {
                data = retryData;
            }
        }

        if (data.Response === "True") {
            const formatted = {
                imdbRating: parseFloat(data.imdbRating) || null,
                imdbVotes: data.imdbVotes || "N/A",
                poster: data.Poster !== "N/A" ? data.Poster : null,
                plot: data.Plot || "",
                director: data.Director || "Unknown",
                genre: data.Genre || "Cinema",
                imdbID: data.imdbID || null,
                verifiedTitle: data.Title,
                verifiedYear: data.Year
            };
            omdbMemoryCache.set(cacheKey, formatted);
            return formatted;
        }

        return null;
    } catch (error) {
        if (error.name !== "AbortError") {
            console.warn(`OMDB fetch failed for ${title}:`, error);
        }
        return null;
    }
};

export const getFallbackPoster = getTmdbFallbackPoster;

/**
 * Generate pure JS pre-computed taste analytics based on user rating history
 */
export const buildTasteAnalytics = (watched = []) => {
    if (!watched || watched.length === 0) return null;

    const rated = watched.filter(m => typeof m.userRating === "number" && !isNaN(m.userRating) && m.userRating > 0);
    if (rated.length === 0) return null;

    const avg = (rated.reduce((s, m) => s + m.userRating, 0) / rated.length).toFixed(1);

    const liked = rated.filter(m => m.userRating >= 7);
    const genreCounts = {};

    liked.forEach(m => {
        const rawGenre = m.genre || m.Genre || "";
        if (rawGenre) {
            const genres = rawGenre.split(",").map(g => g.trim()).filter(Boolean);
            genres.forEach(g => {
                genreCounts[g] = (genreCounts[g] || 0) + 1;
            });
        }
    });

    const topGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([g, count]) => {
            const pct = Math.round((count / (liked.length || 1)) * 100);
            return `${g} (${pct}% of highly rated films)`;
        });

    const byDirector = {};
    rated.forEach(m => {
        const d = (m.director || m.Director || "").trim();
        if (d && d !== "Unknown" && d !== "N/A") {
            byDirector[d] = byDirector[d] || [];
            byDirector[d].push(m.userRating);
        }
    });

    const topDirectors = Object.entries(byDirector)
        .filter(([_, ratings]) => ratings.length >= 2)
        .map(([director, ratings]) => {
            const dirAvg = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1);
            return `${director} (avg ${dirAvg}/10 across ${ratings.length} films)`;
        })
        .sort((a, b) => {
            const avgA = parseFloat(a.split("avg ")[1]);
            const avgB = parseFloat(b.split("avg ")[1]);
            return avgB - avgA;
        })
        .slice(0, 3);

    return {
        avgRating: avg,
        totalRated: rated.length,
        topGenres,
        topDirectors
    };
};

/**
 * Generate deterministic fallback ID based on title and year using Base64URL
 */
export const generateFallbackId = (title, year) => {
    const cleanT = String(title || "unknown").toLowerCase().trim();
    const cleanY = String(year || "0000").match(/\d{4}/)?.[0] || "0000";
    const raw = `${cleanT}::${cleanY}`;
    try {
        return `local_${btoa(unescape(encodeURIComponent(raw)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '')}`;
    } catch {
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return `local_${Math.abs(hash)}`;
    }
};

/**
 * Profile-Based Sliding Window Cache Hash (Non-Mutating, Includes Anchor/Crew/Cast)
 */
export const generateProfileHash = (profile, watchlistGenres = [], mood = "any", providers = []) => {
    const lovedStr = [...(profile?.lovedGenreIds || [])].sort((a, b) => a - b).join("-");
    const hatedStr = [...(profile?.hatedKeywordIds || [])].sort((a, b) => a - b).join("-");
    const watchStr = [...(watchlistGenres || [])].slice(0, 3).sort((a, b) => a - b).join("-");
    const provStr = [...(providers || [])].sort((a, b) => String(a).localeCompare(String(b))).join("-");
    const anchorStr = String(profile?.anchorTmdbId || "none");
    const crewStr = String(profile?.topCrewMemberId || "none");
    const castStr = [...(profile?.topCastIds || [])].sort((a, b) => a - b).join("-");
    const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim() || "any";
    return `v4_${lovedStr}_${hatedStr}_${watchStr}_${provStr}_${anchorStr}_${crewStr}_${castStr}_${cleanMood}`;
};

/**
 * Backward compatibility input hasher
 */
export const generateInputHash = (watched = [], mood = "any") => {
    const watchedStr = (watched || [])
        .map(m => `${m.imdbID || m.id || m.title}:${m.userRating || 0}`)
        .sort()
        .join('|');
    const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim() || "any";
    return `${watchedStr}#${cleanMood}`;
};

/**
 * Builds Gemini prompt for diversity selection and natural-language explanations over pre-ranked candidates.
 */
export function buildGeminiReRankPrompt(profile, mood, topCandidates = [], context = {}) {
    const watched = Array.isArray(context.watched) ? context.watched : [];

    // 1. Top Anchor Films (rated >= 8★, up to 8 films)
    const anchorFilms = watched
        .filter(m => typeof m.userRating === "number" && m.userRating >= 8)
        .sort((a, b) => b.userRating - a.userRating)
        .slice(0, 8)
        .map(m => {
            const note = m.userNote || m.notes ? ` - "${cleanStr(m.userNote || m.notes).slice(0, 80)}"` : "";
            return `- "${cleanStr(m.title)}" (${m.year || m.Year || "N/A"}) [${m.userRating}/10]${note}`;
        });

    // 2. Recent Watch Streak (last 3 positively rated films with dates)
    const recentStreak = [...watched]
        .filter(m => typeof m.userRating === "number" && m.userRating >= 6 && m.dateWatched)
        .sort((a, b) => new Date(b.dateWatched) - new Date(a.dateWatched))
        .slice(0, 3)
        .map(m => `- "${cleanStr(m.title)}" (${m.year || "N/A"}) [${m.userRating}/10]`);

    // 3. Candidate Movies formatting with director, badges, matchScore, and plot snippet
    const candidatesStr = topCandidates.map(c => {
        const directorStr = c.director && c.director !== "Unknown" ? ` | Director: ${cleanStr(c.director)}` : "";
        const badgesStr = Array.isArray(c.matchReasons) && c.matchReasons.length > 0
            ? ` | Badges: [${c.matchReasons.join(", ")}]`
            : "";
        const plotSnippet = cleanStr(c.overview || c.plot || "").slice(0, 140);
        return `ID: ${c.id || c.tmdbId} | "${c.title}" (${c.year})${directorStr} | Calibrated Match: ${c.matchScore || 85}% | Genres: ${c.genre} | TMDB Rating: ${c.vote_average || 'N/A'}/10${badgesStr} | Overview: ${plotSnippet}`;
    }).join("\n");

    return `
You are an elite film critic and cinema intelligence engine.
Select a diverse top 6 from these pre-ranked TMDB candidate movies and write compelling, personalized explanations.
Do NOT invent scores—each candidate already has a calibrated ranker score.

USER TASTE PROFILE:
- Favorite Genres: ${(profile.lovedGenreNames || []).join(", ") || "Diverse / Open"}
- Selected Mood / Vibe: "${cleanStr(mood)}"
${anchorFilms.length > 0 ? `\nUSER'S FAVORITE ANCHOR FILMS:\n${anchorFilms.join("\n")}` : ""}
${recentStreak.length > 0 ? `\nRECENT WATCH STREAK:\n${recentStreak.join("\n")}` : ""}

PRE-RANKED CANDIDATE MOVIES (Top ${topCandidates.length}):
${candidatesStr}

TASK:
Perform a diversity pass over these top candidates and select 6 distinct films.
Pick the 6 strongest, most cohesive films from the candidates and write a bespoke 1-sentence upright editorial reason explaining why this film connects to their favorite anchor films, directors, themes, or pacing (never write a generic plot summary).
CRITICAL STYLE RULES FOR "reason" AND OUTPUT:
- Write clean, human cinema prose (1 sentence, plain statement).
- NEVER include internal system labels, scoring jargon, badges, percentages, or model names in the text (forbid phrases like "Taste-Twin Match", "Core Theme Match", "Genre Bullseye", "% Match", or "Gemini").
- Include "anchorTitles": 1 to 3 exact titles copied verbatim from USER'S FAVORITE ANCHOR FILMS that this pick pairs best with.
Output strict JSON with:
1. tasteProfile: Object containing favoriteGenres (array of strings), preferredEra (string), and ratingStyle (string description).
2. recommendations: Array of 6 items with:
   - tmdbId (number matching the candidate ID)
   - title (string)
   - year (string)
   - anchorTitles (array of 1-3 exact titles from user's favorite anchor films)
   - reason (string: crisp 1-sentence editorial connection free of internal jargon)
`;
}

/**
 * Merges Gemini's diversity pass and explanations with deterministic calibrated ranker matchScores.
 */
export function mergeGeminiExplanationsWithRanker(result, rankedCandidates = [], profile = {}, context = {}) {
    if (!result?.recommendations || !Array.isArray(result.recommendations)) {
        throw new Error("Invalid recommendation schema returned by Gemini");
    }

    const watchedList = Array.isArray(context.watched) ? context.watched : [];
    const sanitizeReasonText = (raw) => {
        if (!raw || typeof raw !== "string") return "";
        return raw
            .replace(/\b\d{2,3}%\s*(High\s*)?Taste-?Twin\s*Match\b/gi, "")
            .replace(/\b(High\s*)?(Taste-?Twin Match|Core Theme Match|Genre Bullseye|Cult Classic Overlap)\b/gi, "")
            .replace(/\s{2,}/g, " ")
            .replace(/^[\s,.:;-]+/, "")
            .trim();
    };

    const enriched = result.recommendations.map(rec => {
        const candidate = rankedCandidates.find(
            c => c.id === rec.tmdbId || c.tmdbId === rec.tmdbId || c.title?.toLowerCase() === rec.title?.toLowerCase()
        ) || {};
        const calibratedScore = typeof candidate.matchScore === "number"
            ? candidate.matchScore
            : normalizeMatchScore(rec.matchScore);
        const cleanedReason = sanitizeReasonText(rec.reason) || rec.reason || "Pairs closely with your top-rated films.";
        const anchorTitles = Array.isArray(rec.anchorTitles)
            ? rec.anchorTitles.filter((t) => typeof t === "string" && t.trim())
            : [];
        const anchorIds = anchorTitles
            .map((t) => watchedList.find((w) => (w.title || w.Title || "").toLowerCase() === t.toLowerCase()))
            .filter(Boolean)
            .map((w) => w.imdbID || w.id || (w.tmdbId ? `tmdb_${w.tmdbId}` : null))
            .filter(Boolean);

        return {
            id: candidate.id || rec.tmdbId,
            tmdbId: candidate.id || rec.tmdbId,
            title: candidate.title || rec.title,
            year: candidate.year || rec.year,
            genre: candidate.genre || (profile.lovedGenreNames?.[0] || "Cinema"),
            poster: candidate.poster || getFallbackPoster(rec.title),
            backdrop: candidate.backdrop || null,
            imdbRating: candidate.vote_average ? String(candidate.vote_average) : null,
            matchScore: calibratedScore,
            matchReasons: Array.isArray(candidate.matchReasons) ? candidate.matchReasons : [],
            anchorTitles,
            anchorIds,
            rankerProbability: candidate.rankerProbability ?? null,
            features: sanitizeFeatureSnapshot(candidate.features ?? rec.features),
            reason: cleanedReason,
            plot: candidate.overview || cleanedReason,
            sourceBucket: candidate.sourceBucket || "TMDB",
            realData: true
        };
    });

    enriched.sort((a, b) => b.matchScore - a.matchScore);

    return {
        tasteProfile: result.tasteProfile || {
            favoriteGenres: (profile.lovedGenreNames || []).slice(0, 3),
            preferredEra: "Contemporary",
            ratingStyle: "High cinematic affinity"
        },
        recommendations: enriched
    };
}

/**
 * Turns free-text mood queries ("like Drive but funnier") into structured retrieval filters.
 */
export async function parseFreeTextMoodWithGemini(ai, rawQuery = "") {
    const cleaned = cleanStr(rawQuery);
    if (!cleaned || !ai?.models?.generateContent) {
        return { moodId: "any", withGenres: [], withoutKeywords: [], minYear: null, maxYear: null };
    }
    const prompt = `Convert this movie request into structured TMDB filter JSON: "${cleaned}"`;
    const config = {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                moodId: { type: Type.STRING },
                withGenres: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                withoutKeywords: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                minYear: { type: Type.NUMBER },
                maxYear: { type: Type.NUMBER }
            },
            required: ["moodId", "withGenres", "withoutKeywords"]
        }
    };
    try {
        const res = await executeCascade(ai, FAST_INTERACTIVE_CASCADE, { contents: prompt, config }, { cascadeType: "fast" });
        if (res?.text) {
            return sanitizeAndParseJSON(res.text);
        }
    } catch (_) {}
    return { moodId: "any", withGenres: [], withoutKeywords: [], minYear: null, maxYear: null };
}

// Heuristic recent-release slot reservation passed to rankCandidatePool
export const RECENT_RELEASE_RESERVE_COUNT = 2;
export const RECENT_RELEASE_RESERVE_MONTHS = 18;
export const RECENT_RELEASE_MIN_PROB_PERCENTILE = 0.5;

function buildRankerFallbackResponse(
    topCandidates,
    profile,
    modelInfo,
    reason = "Selected by the CinemaVault calibrated taste ranker."
) {
    return {
        tasteProfile: {
            favoriteGenres: (profile?.lovedGenreNames || []).slice(0, 3),
            preferredEra: "Mixed",
            ratingStyle: "Varied"
        },
        recommendations: (topCandidates || []).slice(0, 6).map(cand => ({
            id: cand.id || cand.tmdbId,
            tmdbId: cand.id || cand.tmdbId,
            title: cand.title,
            year: cand.year,
            genre: cand.genre || (profile?.lovedGenreNames?.[0] || "Cinema"),
            poster: cand.poster || getFallbackPoster(cand.title),
            backdrop: cand.backdrop || null,
            imdbRating: cand.vote_average ? String(cand.vote_average) : null,
            matchScore: typeof cand.matchScore === "number" ? cand.matchScore : 85,
            matchReasons: Array.isArray(cand.matchReasons) ? cand.matchReasons : [],
            rankerProbability: cand.rankerProbability ?? null,
            features: sanitizeFeatureSnapshot(cand.features),
            reason,
            plot: cand.overview || "",
            sourceBucket: cand.sourceBucket || "TMDB",
            realData: true
        })),
        modelInfo
    };
}

/**
 * Executes Calibrated Ranker + Gemini Explanations & Diversity Pass
 */
async function reRankCandidatesWithGemini(ai, profile, mood, candidates, options = {}) {
    const reserveConfig =
        options.reserve !== undefined
            ? options.reserve
            : {
                count: RECENT_RELEASE_RESERVE_COUNT,
                minReleaseDate: getRecentReleaseDateFloor(RECENT_RELEASE_RESERVE_MONTHS, options.now),
                minProbabilityPercentile: RECENT_RELEASE_MIN_PROB_PERCENTILE
            };

    const topCandidates = rankCandidatePool(
        candidates,
        {
            profile,
            collabSimMap: options.collabSimMap,
            contentSimMap: options.contentSimMap,
            repulsionMap: options.repulsionMap,
            dnaSimMap: options.dnaSimMap,
            anchorKeywords: options.anchorKeywords ?? profile?.lovedKeywordIds,
            userProviders: options.userProviders
        },
        options.rankerWeights,
        options.topK || 15,
        options.rankerOptions,
        reserveConfig
    );

    if (!ai) {
        const rankerFallbackInfo = buildCascadeModelInfo(CURATION_MODEL_CASCADE, null, "curation", "ranker-fallback");
        lastCurationModelInfo = rankerFallbackInfo;
        options.onDiagnostics?.({
            mergedCandidates: candidates,
            topCandidates,
            reserve: reserveConfig,
            model: null,
            modelInfo: rankerFallbackInfo,
            usageMetadata: null
        });
        return buildRankerFallbackResponse(topCandidates, profile, rankerFallbackInfo);
    }

    const prompt = buildGeminiReRankPrompt(profile, mood, topCandidates, {
        watched: options.watched,
        watchlist: options.watchlist
    });

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
                    },
                    required: ["favoriteGenres", "preferredEra", "ratingStyle"]
                },
                recommendations: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            tmdbId: { type: Type.NUMBER },
                            title: { type: Type.STRING },
                            year: { type: Type.STRING },
                            matchScore: { type: Type.NUMBER },
                            anchorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
                            reason: { type: Type.STRING }
                        },
                        required: ["tmdbId", "title", "year", "reason"]
                    }
                }
            },
            required: ["tasteProfile", "recommendations"]
        }
    };

    const prevSeq = lastCurationModelInfo?.seq || 0;
    const response = await executeCascade(
        ai,
        CURATION_MODEL_CASCADE,
        { contents: prompt, config: generationConfig },
        { cascadeType: "curation" }
    );

    const activeRunModelInfo = response
        ? buildCascadeModelInfo(
            CURATION_MODEL_CASCADE,
            lastCurationModelInfo?.seq > prevSeq ? lastCurationModelInfo.model : sessionCurationModel,
            "curation",
            "gemini-curation",
            {
                usageMetadata: response?.usageMetadata ?? null,
                seq: lastCurationModelInfo?.seq || prevSeq
            }
        )
        : buildCascadeModelInfo(CURATION_MODEL_CASCADE, null, "curation", "ranker-fallback");
    lastCurationModelInfo = activeRunModelInfo;

    options.onDiagnostics?.({
        mergedCandidates: candidates,
        topCandidates,
        reserve: reserveConfig,
        model: response ? activeRunModelInfo.model : null,
        modelInfo: activeRunModelInfo,
        usageMetadata: response?.usageMetadata ?? null
    });

    if (!response) {
        console.warn("All Gemini models failed to re-rank candidates, falling back to direct ranker output.");
        return buildRankerFallbackResponse(topCandidates, profile, activeRunModelInfo);
    }

    try {
        const result = sanitizeAndParseJSON(response.text);
        if (!Array.isArray(result?.recommendations) || result.recommendations.length === 0) {
            throw new Error("Gemini re-rank returned empty or missing recommendations array");
        }
        const merged = mergeGeminiExplanationsWithRanker(result, topCandidates, profile, {
            watched: options.watched
        });
        if (!Array.isArray(merged?.recommendations) || merged.recommendations.length === 0) {
            throw new Error("Merged recommendations empty");
        }
        return {
            ...merged,
            modelInfo: activeRunModelInfo
        };
    } catch (parseErr) {
        console.warn("Gemini JSON parse/merge failed, falling back to local calibrated ranker:", parseErr);
        const fallbackInfo = buildCascadeModelInfo(
            CURATION_MODEL_CASCADE,
            null,
            "curation",
            "ranker-fallback",
            {
                usageMetadata: response?.usageMetadata ?? null,
                seq: activeRunModelInfo?.seq || prevSeq
            }
        );
        lastCurationModelInfo = fallbackInfo;
        return buildRankerFallbackResponse(topCandidates, profile, fallbackInfo);
    }
}

/**
 * Fallback Generative Pipeline (used when TMDB key is missing or unavailable)
 */
async function generateWithOmdbFallback(ai, watchedMovies, watchlist, onProgress, options = {}) {
    onProgress?.("Synthesizing recommendations from vault history...");

    const analytics = buildTasteAnalytics(watchedMovies);
    const header = "Title|Year|Director|Genre|Rating|UserNote";
    const rows = (watchedMovies || []).slice(0, 25).map(m =>
        `${cleanStr(m.title || m.Title)}|${cleanStr(m.year || m.Year || "N/A")}|${cleanStr(m.director || m.Director || "Unknown")}|${cleanStr(m.genre || m.Genre || "Unknown")}|${m.userRating || m.UserRating || 0}|${cleanStr(m.userNote || m.UserNote || "")}`
    ).join("\n");
    const historyData = `${header}\n${rows}`;

    const prompt = `
You are an elite film critic. Select 6 distinct movie recommendations based on this viewing history:
${historyData}

Mood requested: "${cleanStr(options.mood || 'any')}"
Return JSON with tasteProfile (favoriteGenres, preferredEra, ratingStyle) and recommendations (title, year, type, genre, matchScore, reason).
`;

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
                    },
                    required: ["favoriteGenres", "preferredEra", "ratingStyle"]
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
                            matchScore: { type: Type.NUMBER },
                            reason: { type: Type.STRING }
                        },
                        required: ["title", "year", "type", "genre", "matchScore", "reason"]
                    }
                }
            },
            required: ["tasteProfile", "recommendations"]
        }
    };

    const prevOmdbSeq = lastCurationModelInfo?.seq || 0;
    const response = await executeCascade(
        ai,
        CURATION_MODEL_CASCADE,
        { contents: prompt, config: generationConfig },
        { cascadeType: "curation" }
    );

    if (!response) {
        lastCurationModelInfo = buildCascadeModelInfo(CURATION_MODEL_CASCADE, null, "curation", "gemini-omdb-fallback");
        throw new Error("Fallback recommendation generation failed");
    }

    const omdbModelInfo = buildCascadeModelInfo(
        CURATION_MODEL_CASCADE,
        lastCurationModelInfo?.seq > prevOmdbSeq ? lastCurationModelInfo.model : sessionCurationModel,
        "curation",
        "gemini-omdb-fallback",
        {
            usageMetadata: response?.usageMetadata ?? null,
            seq: lastCurationModelInfo?.seq || prevOmdbSeq
        }
    );
    lastCurationModelInfo = omdbModelInfo;

    let result;
    try {
        result = sanitizeAndParseJSON(response.text);
    } catch (parseErr) {
        throw new Error("OMDb fallback generation returned invalid JSON or empty recommendations", { cause: parseErr });
    }
    if (!Array.isArray(result?.recommendations) || result.recommendations.length === 0) {
        throw new Error("OMDb fallback generation returned invalid JSON or empty recommendations");
    }

    if (result.recommendations && result.recommendations.length > 0) {
        onProgress?.("Verifying candidate titles with OMDb...");
        const enriched = await Promise.all(
            result.recommendations.map(async (rec) => {
                const omdbData = await fetchRealOMDBData(rec.title, rec.year);
                if (omdbData) {
                    return {
                        ...rec,
                        title: omdbData.verifiedTitle || rec.title,
                        year: omdbData.verifiedYear || rec.year,
                        imdbRating: omdbData.imdbRating || null,
                        poster: omdbData.poster || getFallbackPoster(rec.title),
                        genre: omdbData.genre || rec.genre || "Cinema",
                        imdbID: omdbData.imdbID,
                        matchScore: normalizeMatchScore(rec.matchScore),
                        realData: true
                    };
                }
                return {
                    ...rec,
                    imdbRating: null,
                    poster: getFallbackPoster(rec.title),
                    genre: rec.genre || "Cinema",
                    imdbID: generateFallbackId(rec.title, rec.year),
                    matchScore: normalizeMatchScore(rec.matchScore),
                    realData: false
                };
            })
        );
        result.recommendations = enriched;
    }

    result.modelInfo = omdbModelInfo;
    return result;
}

/**
 * Main Recommendation Engine Entry Point
 * Hybrid Waterfall TMDB Candidate Engine + Gemini Re-Ranking
 */
export const getMovieRecommendations = async (watchedMovies = [], watchlist = [], onProgress, options = {}) => {
    const apiKey = resolveGeminiKey();
    const ai = options.aiClient || createGeminiClient(apiKey, options);
    const hasInjectedCandidates = Array.isArray(options.candidates) && options.candidates.length >= 6;
    const hasTmdb = Boolean(hasTmdbBackend(options) || hasInjectedCandidates);

    if (!ai && !hasTmdb) {
        throw new Error("Neither Gemini API Key (VITE_GEMINI_KEY) nor TMDB credentials (VITE_TMDB_KEY) are configured.");
    }

    const mood = options.mood || "any";
    const userRegion = options.userRegion || "US";
    const userProviders = options.userProviders || [];

    // 1. Synthesize statistical taste profile with mathematical weighting
    onProgress?.("Analyzing your ratings and preferences...");
    const profile = await extractTasteProfile(watchedMovies, watchlist);

    // 2. Primary Engine: Dynamic Waterfall TMDB Retrieval + Gemini Re-Ranking
    if (hasTmdb) {
        try {
            onProgress?.("Harvesting 3-bucket verified candidate catalogue from TMDB...");
            const candidates = hasInjectedCandidates
                ? options.candidates
                : await fetchCandidatePool(profile, mood, watchedMovies, watchlist, {
                    ...options,
                    userRegion,
                    userProviders
                });

            if (candidates && candidates.length >= 6) {
                const [embeddingIndex, contentIndex, dnaIndex] = await Promise.all([
                    options.embeddingIndex !== undefined
                        ? Promise.resolve(options.embeddingIndex)
                        : loadDefaultEmbeddingIndex(),
                    options.contentIndex !== undefined
                        ? Promise.resolve(options.contentIndex)
                        : loadDefaultContentIndex(),
                    options.dnaIndex !== undefined
                        ? Promise.resolve(options.dnaIndex)
                        : loadDefaultDnaIndex()
                ]);
                const collabSimMap =
                    options.collabSimMap ||
                    buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);
                const repulsionMap =
                    options.repulsionMap ||
                    buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);

                let mergedCandidates = candidates;
                if (embeddingIndex && options.injectEmbeddingNeighbors !== false) {
                    const excludeIds = new Set([
                        ...(watchedMovies || []).map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
                        ...(watchlist || []).map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
                        ...candidates.map(c => Number(c?.tmdbId ?? c?.id ?? 0))
                    ]);
                    const neighbors = retrieveAlignedEmbeddingNeighbors(
                        profile.weightedRatings,
                        embeddingIndex,
                        excludeIds,
                        { collabSimMap, repulsionMap, topK: 40 }
                    );
                    const injected = await fetchEmbeddingCandidates(
                        neighbors,
                        watchedMovies,
                        watchlist,
                        candidates,
                        { userRegion, maxNeighbors: 30 }
                    );
                    if (injected.length > 0) {
                        mergedCandidates = [...candidates, ...injected];
                    }
                }

                const shouldEnrich =
                    options.enrichCandidates !== false &&
                    (typeof options.detailFetcher === "function" ||
                        (hasTmdbBackend(options) && !hasInjectedCandidates));
                if (shouldEnrich) {
                    mergedCandidates = await enrichCandidatePoolMetadata(mergedCandidates, {
                        userRegion,
                        detailFetcher: options.detailFetcher,
                        maxEnrich: options.maxEnrich,
                        concurrency: options.enrichConcurrency
                    });
                }

                const contentSimMap =
                    options.contentSimMap ||
                    buildContentSimMap(profile.weightedRatings, contentIndex, mergedCandidates);
                const dnaSimMap =
                    options.dnaSimMap ||
                    buildDnaSimMap(profile.weightedRatings, dnaIndex);
                const rankerWeights =
                    options.rankerWeights ||
                    derivePersonalizedRankerWeights(options.feedbackLog, watchedMovies, DEFAULT_RANKER_WEIGHTS);

                onProgress?.("AI Oracle re-ranking candidates against your taste profile...");
                const result = await reRankCandidatesWithGemini(ai, profile, mood, mergedCandidates, {
                    ...options,
                    rankerWeights,
                    embeddingIndex,
                    contentIndex,
                    dnaIndex,
                    collabSimMap,
                    contentSimMap,
                    dnaSimMap,
                    repulsionMap,
                    watched: watchedMovies,
                    watchlist
                });
                console.log(`✅ TMDB 3-Bucket + Gemini engine completed (${result.recommendations?.length} films)`);
                return result;
            }
        } catch (tmdbErr) {
            console.warn("TMDB candidate retrieval failed, falling back to generative pipeline:", tmdbErr);
        }
    }

    // 3. Fallback Engine: Generative Gemini + OMDb Verification
    if (!ai) {
        throw new Error("Unable to retrieve TMDB candidates and no Gemini key is configured for generative fallback.");
    }
    return await generateWithOmdbFallback(ai, watchedMovies, watchlist, onProgress, options);
};
