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
    findTmdbByTitleAndYear,
    fetchBatchFormattedDetailsMap,
    matchesWatchProviders,
    getRecentReleaseDateFloor,
    getFallbackPoster as getTmdbFallbackPoster,
    isSeriesVaultItem
} from "./tmdbService.js";
import {
    DEFAULT_RANKER_WEIGHTS,
    rankCandidatePool,
    buildDiversifiedGeminiShortlist
} from "./rankerService.js";
import { derivePersonalizedRankerWeights, sanitizeFeatureSnapshot } from "./onlineLearningService.js";
import {
    DEFAULT_RECOMMENDATION_COUNT,
    MIN_VALID_CACHE_COUNT,
    buildMoodFilterHashSegment,
    extractGenreIdsFromCandidate,
    getMoodPreset,
    isExplicitMoodActive,
    matchesMoodCandidateGate,
    normalizeMoodFilters
} from "./moodPolicy.js";
import { isSameMovie, normalizeTitleKey, normalizeYearKey } from "./movieIdentity.js";
export { DEFAULT_RECOMMENDATION_COUNT, MIN_VALID_CACHE_COUNT };
import {
    loadDefaultEmbeddingIndex,
    buildCollabSimMapFromIndex,
    buildRepulsionMapFromIndex,
    getCollabCatalogMax,
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
import { compileActiveTasteRules, candidateMatchesAvoidRule, buildTasteRulesHashSegment } from "./tasteRulesService.js";
import { isDebugUiEnabled } from "./debugFlags.js";

export const CURATION_MODEL_CASCADE = [
    "gemini-4-hydrogen",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.8-flash"
];

export const PUBLIC_CURATION_CASCADE = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.8-flash",
    "gemini-4-hydrogen"
];

export const EXPLORE_FOR_YOU_CASCADE = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash"
];

/**
 * Selects curation cascade priority: Flash-Lite first in public/commercial mode
 * to stretch daily free-tier quota (3.5 + 3.1 = 1,000/day), Hydrogen first in personal/debug mode.
 */
export function getCurationCascade({ personal = isDebugUiEnabled() } = {}) {
    return personal ? CURATION_MODEL_CASCADE : PUBLIC_CURATION_CASCADE;
}

export const FAST_INTERACTIVE_CASCADE = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-4-hydrogen",
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.8-flash"
];

export const MODEL_DISPLAY_NAMES = {
    "gemini-4-hydrogen": "Gemini 4 Hydrogen",
    "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
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
const SMART_CACHE_KEY = 'cinemavault_smart_cache_v4';
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
    if (m.includes("gemini-3-flash") || m.includes("gemini-3.1-flash-lite")) {
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
    if (
        lowerModel.includes("gemini-3-flash") ||
        lowerModel.includes("gemini-3.1-flash") ||
        lowerModel.includes("gemini-3.5-flash") ||
        lowerModel.includes("gemini-3.6-flash") ||
        lowerModel.includes("gemini-3.8-flash") ||
        lowerModel.includes("gemini-2.5-flash")
    ) {
        return 15000;
    }
    return 15000;
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
let proxyRateLimitedUntilMs = 0;
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
    if (err?.retryAfter !== undefined && err?.retryAfter !== null) {
        const directRetryAfter = parseDurationStringMs(err.retryAfter);
        if (directRetryAfter) return directRetryAfter;
        const parsedDateMs = Date.parse(String(err.retryAfter));
        if (Number.isFinite(parsedDateMs)) {
            const deltaMs = parsedDateMs - clockFn();
            if (deltaMs > 0) return Math.ceil(deltaMs);
        }
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
    const errorCode = String(err?.errorCode || err?.error?.errorCode || "").trim().toUpperCase();
    if (errorCode === "PROXY_RATE_LIMIT") {
        return "proxy_rate_limit";
    }
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
    proxyRateLimitedUntilMs = 0;
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
    if (ai?.isProxy && proxyRateLimitedUntilMs > startNowMs) {
        return null;
    }

    const rawMaxCascadeDurationMs = options.maxCascadeDurationMs;
    const maxCascadeDurationMs =
        rawMaxCascadeDurationMs === Infinity
            ? Infinity
            : rawMaxCascadeDurationMs !== undefined &&
                rawMaxCascadeDurationMs !== null &&
                Number.isFinite(Number(rawMaxCascadeDurationMs)) &&
                Number(rawMaxCascadeDurationMs) >= 0
              ? Number(rawMaxCascadeDurationMs)
              : 45_000;
    const cascadeDeadlineMs = startNowMs + maxCascadeDurationMs;

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
        const iterNowMs = getNow();
        const remainingBudgetMs = cascadeDeadlineMs - iterNowMs;
        if (remainingBudgetMs < 3000) {
            console.warn(
                `Cascade deadline reached (${remainingBudgetMs}ms remaining < 3000ms); skipping remaining models in ${cascadeType} cascade.`
            );
            return null;
        }
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
        const requestedTimeout = options.timeoutMs || defaultTimeout;
        const perAttemptTimeout = Math.min(requestedTimeout, remainingBudgetMs);
        const isBudgetClamped = perAttemptTimeout < requestedTimeout;
        let deadlineClampTriggered = false;

        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(
                    isBudgetClamped
                        ? `Model ${model} aborted by cascade deadline clamp after ${perAttemptTimeout}ms`
                        : `Model ${model} timed out after ${perAttemptTimeout}ms`
                );
                if (isBudgetClamped) {
                    deadlineClampTriggered = true;
                    err.isCascadeDeadlineClamp = true;
                }
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
            if (err?.isCascadeDeadlineClamp || deadlineClampTriggered) {
                console.warn(
                    `Cascade deadline clamp aborted ${model} in ${cascadeType} cascade; returning null without cooldown.`
                );
                return null;
            }
            const reason = classifyGeminiError(err);
            if (reason === "proxy_rate_limit") {
                const retryMs = parseRetryDelayMs(err);
                if (Number.isFinite(retryMs) && retryMs > 0) {
                    proxyRateLimitedUntilMs = Math.max(proxyRateLimitedUntilMs, failNowMs + retryMs);
                }
                console.warn(
                    `Proxy rate limit hit on ${model} in ${cascadeType} cascade; aborting cloud cascade without cooldown.`
                );
                return null;
            }
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
    if (val === null || val === undefined || val === "") return null;
    const n = typeof val === "number" ? val : parseFloat(val);
    if (!Number.isFinite(n) || n <= 0) return null;
    // If LLM returned a decimal ratio (0.01 - 1.0) or edge 1
    if (n <= 1.0) {
        const scaled = n <= 0.1 ? n * 1000 : n * 100;
        return Math.min(99, Math.max(50, Math.round(scaled)));
    }
    // Never fabricate a fallback score for legacy 1-5 numbers
    if (n <= 5) return null;
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

        if (validRecs.length >= MIN_VALID_CACHE_COUNT) {
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
        fallbackMode: pipeline,
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
        cascadeType === "fast" ? FAST_INTERACTIVE_CASCADE : getCurationCascade(),
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

function hashStringFnv1a(str = "") {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

/**
 * Profile-Based Sliding Window Cache Hash (Non-Mutating, Includes Anchor/Crew/Cast & Custom Vibe Filters)
 */
function buildWatchedHashSegment(watched = []) {
    if (!Array.isArray(watched) || watched.length === 0) return "";
    const tokens = watched
        .filter(Boolean)
        .map((m) => {
            const idPart = String(m.tmdbId ?? m.id ?? m.imdbID ?? m.title ?? m.Title ?? "").trim().toLowerCase();
            if (!idPart) return "";
            const ratingPart = Number(m.userRating) || 0;
            const notePart = String(m.userNote || m.notes || "").trim().replace(/\s+/g, " ").toLowerCase();
            const baseToken = `${idPart}:${ratingPart}`;
            return notePart ? `${baseToken}:${hashStringFnv1a(notePart)}` : baseToken;
        })
        .filter(Boolean)
        .sort();
    if (tokens.length === 0) return "";

    return `vlt_${tokens.length}_${hashStringFnv1a(`${tokens.join("|")}|`)}`;
}

export const generateProfileHash = (profile, watchlistGenres = [], mood = "any", providers = [], moodFilters = null, userRegion = "", watched = [], tasteRules = []) => {
    const lovedStr = [...(profile?.lovedGenreIds || [])].sort((a, b) => a - b).join("-");
    const hatedStr = [...(profile?.hatedKeywordIds || [])].sort((a, b) => a - b).join("-");
    const watchStr = [...(watchlistGenres || [])].slice(0, 3).sort((a, b) => a - b).join("-");
    const provStr = [...(providers || [])].sort((a, b) => String(a).localeCompare(String(b))).join("-");
    const anchorStr = String(profile?.anchorTmdbId || "none");
    const crewStr = String(profile?.topCrewMemberId || "none");
    const castStr = [...(profile?.topCastIds || [])].sort((a, b) => a - b).join("-");
    const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim() || "any";
    const base = `v4_${lovedStr}_${hatedStr}_${watchStr}_${provStr}_${anchorStr}_${crewStr}_${castStr}_${cleanMood}`;
    const filterSegment = buildMoodFilterHashSegment(moodFilters);
    const withFilter = filterSegment ? `${base}_${filterSegment}` : base;
    const cleanRegion = typeof userRegion === "string" ? userRegion.trim().toUpperCase() : "";
    const withRegion = cleanRegion ? `${withFilter}_reg_${cleanRegion}` : withFilter;
    const vaultSegment = buildWatchedHashSegment(watched);
    const withVault = vaultSegment ? `${withRegion}_${vaultSegment}` : withRegion;
    const rulesSegment = buildTasteRulesHashSegment(tasteRules);
    return rulesSegment ? `${withVault}_${rulesSegment}` : withVault;
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

function buildMoodPromptSummary(mood = "any", rawFilters = null) {
    const moodFilters = normalizeMoodFilters(rawFilters);
    const effectiveMood =
        moodFilters?.moodId && moodFilters.moodId !== "any" && (!mood || mood === "any")
            ? moodFilters.moodId
            : (mood || "any");
    const preset = getMoodPreset(effectiveMood);
    const explicitMood = isExplicitMoodActive(effectiveMood, moodFilters);

    const vibeConstraints = [];
    if (moodFilters?.query) vibeConstraints.push(`Vibe request: "${cleanStr(moodFilters.query)}"`);
    if (moodFilters?.withGenres?.length > 0) vibeConstraints.push(`Requested genres: ${moodFilters.withGenres.join(", ")}`);
    if (moodFilters?.withoutKeywords?.length > 0) vibeConstraints.push(`Avoid elements: ${moodFilters.withoutKeywords.join(", ")}`);
    if (moodFilters?.minYear || moodFilters?.maxYear) {
        vibeConstraints.push(`Release years: ${moodFilters.minYear || "any"}–${moodFilters.maxYear || "present"}`);
    }

    return { effectiveMood, preset, explicitMood, vibeConstraints };
}

function buildMovieIdentityLookup(movies = []) {
    const byTmdb = new Map();
    const byImdb = new Map();
    const byTitleYear = new Map();
    for (const item of Array.isArray(movies) ? movies : []) {
        if (!item || typeof item !== "object") continue;
        // Support both runtime { movie, weight, zScore } rows and flat test fixtures
        const sources = item.movie && typeof item.movie === "object" ? [item, item.movie] : [item];
        for (const src of sources) {
            const tmdbNum = Number(src.tmdbId || (typeof src.id === "number" ? src.id : 0));
            if (Number.isFinite(tmdbNum) && tmdbNum > 0 && !byTmdb.has(tmdbNum)) {
                byTmdb.set(tmdbNum, item);
            }
            const imdb = typeof src.imdbID === "string" ? src.imdbID.trim().toLowerCase() : "";
            if (/^tt\d+$/.test(imdb) && !byImdb.has(imdb)) {
                byImdb.set(imdb, item);
            }
            const tKey = normalizeTitleKey(src.title || src.Title || "");
            const yKey = normalizeYearKey(src.year || src.Year || "");
            if (tKey) {
                const fullKey = `${tKey}::${yKey}`;
                if (!byTitleYear.has(fullKey)) byTitleYear.set(fullKey, item);
                if (!byTitleYear.has(`${tKey}::`)) byTitleYear.set(`${tKey}::`, item);
            }
        }
    }
    return (movie) => {
        if (!movie || typeof movie !== "object") return null;
        const tmdbNum = Number(movie.tmdbId || (typeof movie.id === "number" ? movie.id : 0));
        if (Number.isFinite(tmdbNum) && tmdbNum > 0 && byTmdb.has(tmdbNum)) {
            return byTmdb.get(tmdbNum);
        }
        const imdb = typeof movie.imdbID === "string" ? movie.imdbID.trim().toLowerCase() : "";
        if (/^tt\d+$/.test(imdb) && byImdb.has(imdb)) {
            return byImdb.get(imdb);
        }
        const tKey = normalizeTitleKey(movie.title || movie.Title || "");
        const yKey = normalizeYearKey(movie.year || movie.Year || "");
        if (tKey) {
            return byTitleYear.get(`${tKey}::${yKey}`) || byTitleYear.get(`${tKey}::`) || null;
        }
        return null;
    };
}

function parseSortDateMs(item) {
    const ms = Date.parse(item?.dateWatched || item?.updatedAt || item?.ts || "");
    return Number.isFinite(ms) ? ms : 0;
}

function selectMoodStratifiedAnchors(watched = [], profile = {}, preset = {}, moodFilters = null, maxAnchors = 10) {
    const lookupWeighted = buildMovieIdentityLookup(profile?.weightedRatings || []);
    const preferredGenreIds = new Set(
        [...(preset?.preferredGenreIds || []), ...(moodFilters?.withGenreIds || [])]
            .map(Number)
            .filter((gid) => Number.isFinite(gid) && gid > 0)
    );

    const eligible = [];
    for (const movie of Array.isArray(watched) ? watched : []) {
        const rating = Number(movie?.userRating);
        if (!Number.isFinite(rating) || rating < 8) continue;
        if (eligible.some((e) => isSameMovie(e.movie, movie))) continue;

        const weighted = lookupWeighted(movie);
        const rawWeight = weighted?.weight ?? weighted?.finalWeight;
        const weight = Number.isFinite(Number(rawWeight))
            ? Number(rawWeight)
            : rating;
        const genreIds = extractGenreIdsFromCandidate(movie);
        let matchesMood = false;
        if (preferredGenreIds.size > 0 && genreIds) {
            for (const gid of genreIds) {
                if (preferredGenreIds.has(Number(gid))) {
                    matchesMood = true;
                    break;
                }
            }
        }

        eligible.push({
            movie,
            rating,
            weight,
            dateMs: parseSortDateMs(movie),
            title: cleanStr(movie.title || movie.Title || ""),
            matchesMood
        });
    }

    const compareAnchors = (a, b) =>
        b.weight - a.weight ||
        b.rating - a.rating ||
        b.dateMs - a.dateMs ||
        a.title.localeCompare(b.title);

    const moodMatched = eligible.filter((e) => e.matchesMood).sort(compareAnchors);
    const overallFallback = eligible.filter((e) => !e.matchesMood).sort(compareAnchors);

    return [...moodMatched, ...overallFallback].slice(0, maxAnchors).map((entry) => entry.movie);
}

function formatSeriesTag(item) {
    return isSeriesVaultItem(item) ? " [Series]" : "";
}

function formatNoteSuffix(item, maxLen = 180) {
    const note = cleanStr(item?.userNote || item?.notes || "").slice(0, maxLen).trim();
    return note ? ` - Note: "${note}"` : "";
}

function extractDirectorNames(rawDirectors = []) {
    if (!Array.isArray(rawDirectors)) return [];
    return rawDirectors
        .map((d) => (typeof d === "string" ? cleanStr(d) : cleanStr(d?.name || "")))
        .filter((name) => name && !/^unknown$/i.test(name) && !/^n\/a$/i.test(name))
        .slice(0, 4);
}

function selectDislikedOrDismissedEntries(
    watched = [],
    profile = {},
    feedbackLog = [],
    excludedAnchors = [],
    maxItems = 5
) {
    const lookupWeighted = buildMovieIdentityLookup(profile?.weightedRatings || []);
    const isExcluded = (item) => excludedAnchors.some((anchor) => isSameMovie(anchor, item));

    const dismissedList = (Array.isArray(feedbackLog) ? feedbackLog : [])
        .map((entry, idx) => ({ entry, idx, dateMs: parseSortDateMs(entry) }))
        .filter(({ entry }) => (
            entry &&
            entry.action === "dismissed" &&
            !/already\s*seen/i.test(String(entry.reason || "")) &&
            cleanStr(entry.title)
        ))
        .sort((a, b) => b.dateMs - a.dateMs || b.idx - a.idx)
        .map(({ entry }) => {
            const yr = entry.year || entry.Year || "N/A";
            const reasonNote = cleanStr(entry.reason || "").slice(0, 40);
            const tag = reasonNote ? `dismissed: ${reasonNote}` : "dismissed";
            return {
                ref: entry,
                line: `- "${cleanStr(entry.title)}" (${yr}) [${tag}]${formatSeriesTag(entry)}${formatNoteSuffix(entry, 180)}`
            };
        });

    const dislikedWatched = [];
    for (const movie of Array.isArray(watched) ? watched : []) {
        const rating = Number(movie?.userRating);
        if (!Number.isFinite(rating) || rating <= 0) continue;
        if (isExcluded(movie)) continue;
        const weighted = lookupWeighted(movie);
        const zScore = Number(weighted?.zScore);
        const isLowRated = rating <= 4;
        const isNegZScore = rating < 7 && Number.isFinite(zScore) && zScore < -0.4;
        if (!isLowRated && !isNegZScore) continue;
        dislikedWatched.push({
            ref: movie,
            rating,
            zScore: Number.isFinite(zScore) ? zScore : rating - 7,
            dateMs: parseSortDateMs(movie),
            title: cleanStr(movie.title || movie.Title || ""),
            line: `- "${cleanStr(movie.title || movie.Title || "")}" (${movie.year || movie.Year || "N/A"}) [${rating}/10]${formatSeriesTag(movie)}${formatNoteSuffix(movie, 180)}`
        });
    }

    dislikedWatched.sort(
        (a, b) =>
            a.zScore - b.zScore ||
            a.rating - b.rating ||
            b.dateMs - a.dateMs ||
            a.title.localeCompare(b.title)
    );

    const selected = [];
    const addUnique = (candidate) => {
        if (!candidate || selected.length >= maxItems) return;
        if (isExcluded(candidate.ref)) return;
        if (selected.some((s) => isSameMovie(s.ref, candidate.ref))) return;
        selected.push(candidate);
    };

    // Prioritize up to 2 recent explicit dismissals + negative watched films, then backfill remaining slots
    for (const d of dismissedList.slice(0, 2)) addUnique(d);
    for (const w of dislikedWatched) addUnique(w);
    for (const d of dismissedList.slice(2)) addUnique(d);

    return selected;
}

function selectDislikedOrDismissedFilms(
    watched = [],
    profile = {},
    feedbackLog = [],
    excludedAnchors = [],
    maxItems = 5
) {
    return selectDislikedOrDismissedEntries(watched, profile, feedbackLog, excludedAnchors, maxItems).map((s) => s.line);
}

/**
 * Selects 3-4 "Near Miss" films (rated 6-7★) closest to the viewer's 9-10★ favorites
 * using 64-D collaborative embeddings when available (with genre/keyword overlap fallback),
 * strictly excluding any film already listed in Disliked / Dismissed guardrails.
 */
function selectNearMissEntries(watched = [], profile = {}, embeddingIndex = null, dislikedLines = [], maxCount = 4) {
    if (!Array.isArray(watched) || watched.length === 0) return [];

    const dislikedTitleKeys = new Set();
    const dislikedTitleYearKeys = new Set();
    for (const line of Array.isArray(dislikedLines) ? dislikedLines : []) {
        const m = String(line || "").match(/^-\s*"(.+?)"\s*\(([^)]+)\)/);
        if (m) {
            const normTitle = cleanStr(m[1]).toLowerCase();
            const yr = String(m[2] || "").trim();
            if (normTitle) {
                dislikedTitleKeys.add(normTitle);
                if (yr && yr !== "N/A") {
                    dislikedTitleYearKeys.add(`${normTitle}::${yr}`);
                }
            }
        }
    }

    const favorites = watched.filter((m) => m && Number(m.userRating) >= 9);
    const anchorPool = favorites.length > 0 ? favorites : watched.filter((m) => m && Number(m.userRating) >= 8);

    const candidates = watched.filter((m) => {
        if (!m) return false;
        const r = Number(m.userRating);
        if (!Number.isFinite(r) || r < 6 || r > 7) return false;
        const title = cleanStr(m.title || m.Title || "");
        if (!title) return false;
        const normTitle = title.toLowerCase();
        const yr = String(m.year || m.Year || "").trim();
        if (yr && dislikedTitleYearKeys.has(`${normTitle}::${yr}`)) return false;
        if (dislikedTitleKeys.has(normTitle)) return false;
        return true;
    });
    if (candidates.length === 0) return [];

    // Build normalized 64-D favorite centroid when embeddingIndex is supplied
    let centroid = null;
    const dim = Number(embeddingIndex?.dim) || 0;
    const idToIndex = embeddingIndex?.idToIndex;
    const vectors = embeddingIndex?.vectors;
    if (dim > 0 && idToIndex && vectors) {
        const sum = new Float64Array(dim);
        let hits = 0;
        for (const fav of anchorPool) {
            const tid = Number(fav?.tmdbId ?? fav?.id ?? 0);
            const idx = tid ? idToIndex.get(tid) : undefined;
            if (idx === undefined) continue;
            const base = idx * dim;
            for (let d = 0; d < dim; d += 1) {
                sum[d] += vectors[base + d];
            }
            hits += 1;
        }
        if (hits > 0) {
            let norm = 0;
            for (let d = 0; d < dim; d += 1) norm += sum[d] * sum[d];
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for (let d = 0; d < dim; d += 1) sum[d] /= norm;
                centroid = sum;
            }
        }
    }

    const favGenreNames = new Set((profile?.lovedGenreNames || []).map((g) => String(g).toLowerCase().trim()).filter(Boolean));
    for (const fav of anchorPool) {
        String(fav?.genre || fav?.Genre || "")
            .split(",")
            .map((g) => g.trim().toLowerCase())
            .filter((g) => g && g !== "n/a")
            .forEach((g) => favGenreNames.add(g));
    }
    const favGenreIds = new Set((profile?.lovedGenreIds || []).map(Number).filter(Boolean));

    const scored = candidates.map((m) => {
        let simScore = 0;
        const tid = Number(m?.tmdbId ?? m?.id ?? 0);
        const embIdx = centroid && tid ? idToIndex.get(tid) : undefined;
        if (centroid && embIdx !== undefined) {
            const base = embIdx * dim;
            let dot = 0;
            let mag = 0;
            for (let d = 0; d < dim; d += 1) {
                const v = vectors[base + d];
                dot += centroid[d] * v;
                mag += v * v;
            }
            const cosine = mag > 0 ? dot / Math.sqrt(mag) : 0;
            simScore = 10 + cosine;
        } else {
            const mGenreNames = String(m?.genre || m?.Genre || "")
                .split(",")
                .map((g) => g.trim().toLowerCase())
                .filter((g) => g && g !== "n/a");
            const mGenreIds = extractGenreIdsFromCandidate(m);
            let overlap = 0;
            for (const g of mGenreNames) {
                if (favGenreNames.has(g)) overlap += 1;
            }
            for (const gid of mGenreIds) {
                if (favGenreIds.has(Number(gid))) overlap += 1;
            }
            const denom = Math.max(1, mGenreNames.length + mGenreIds.length);
            simScore = overlap / denom;
        }
        return {
            movie: m,
            rating: Number(m.userRating),
            simScore,
            dateMs: parseSortDateMs(m),
            title: cleanStr(m.title || m.Title || "")
        };
    });

    scored.sort(
        (a, b) =>
            b.simScore - a.simScore ||
            b.rating - a.rating ||
            b.dateMs - a.dateMs ||
            a.title.localeCompare(b.title)
    );

    return scored.slice(0, maxCount).map(({ movie, rating, title }) => {
        const yr = movie.year || movie.Year || "N/A";
        const rawGenre = cleanStr(movie.genre || movie.Genre || "");
        const genreNote = rawGenre && rawGenre !== "N/A" ? ` • ${rawGenre.split(",").slice(0, 2).map(s => s.trim()).join(", ")}` : "";
        return {
            ref: movie,
            line: `- "${title}" (${yr}) [${rating}/10${genreNote}]${formatSeriesTag(movie)}${formatNoteSuffix(movie, 180)}`
        };
    });
}

function selectNearMissFilms(watched = [], profile = {}, embeddingIndex = null, dislikedLines = [], maxCount = 4) {
    return selectNearMissEntries(watched, profile, embeddingIndex, dislikedLines, maxCount).map((e) => e.line);
}

/**
 * Builds #4 extended vault context blocks (ranks 11..25 favorites, loved series/anime, and remaining userNotes)
 * without duplicating notes already emitted in primary anchors, dislikes, streak, or near-misses.
 */
function buildExtendedVaultContextSections({
    watched = [],
    broaderFavoriteEntries = [],
    anchorEntries = [],
    dislikedRefs = [],
    recentItems = [],
    nearMissRefs = [],
    maxSeries = 12
} = {}) {
    const broaderFavoriteLines = broaderFavoriteEntries.map((m) => (
        `- "${cleanStr(m.title || m.Title || "")}" (${m.year || m.Year || "N/A"}) [${m.userRating}/10]${formatSeriesTag(m)}`
    ));

    const alreadyPrintedNoteRefs = [
        ...anchorEntries,
        ...dislikedRefs,
        ...recentItems,
        ...nearMissRefs
    ].filter(Boolean);

    const seriesSeen = [];
    for (const m of Array.isArray(watched) ? watched : []) {
        if (!m || !isSeriesVaultItem(m)) continue;
        const rating = Number(m.userRating);
        if (!Number.isFinite(rating) || rating < 8) continue;
        if (seriesSeen.some((prev) => isSameMovie(prev, m))) continue;
        seriesSeen.push(m);
    }
    seriesSeen.sort(
        (a, b) =>
            Number(b.userRating || 0) - Number(a.userRating || 0) ||
            parseSortDateMs(b) - parseSortDateMs(a) ||
            cleanStr(a.title || a.Title || "").localeCompare(cleanStr(b.title || b.Title || ""))
    );

    const lovedSeriesItems = seriesSeen.slice(0, maxSeries).map((m) => {
        const notePrintedElsewhere = alreadyPrintedNoteRefs.some((r) => isSameMovie(r, m));
        if (!notePrintedElsewhere && cleanStr(m.userNote || m.notes || "")) {
            alreadyPrintedNoteRefs.push(m);
        }
        return {
            movie: m,
            render: (noteLen = 140) => {
                const yr = m.year || m.Year || "N/A";
                const noteSuffix = !notePrintedElsewhere && noteLen > 0
                    ? formatNoteSuffix(m, Math.min(140, noteLen))
                    : "";
                return `- "${cleanStr(m.title || m.Title || "")}" (${yr}) [${m.userRating}/10] [Series]${noteSuffix}`;
            }
        };
    });

    const extraNotesPool = [];
    const seenNoted = [];
    for (const m of Array.isArray(watched) ? watched : []) {
        if (!m) continue;
        const note = cleanStr(m.userNote || m.notes || "");
        if (!note) continue;
        if (alreadyPrintedNoteRefs.some((r) => isSameMovie(r, m))) continue;
        if (seenNoted.some((prev) => isSameMovie(prev, m))) continue;
        seenNoted.push(m);
        extraNotesPool.push(m);
    }
    extraNotesPool.sort(
        (a, b) =>
            Number(b.userRating || 0) - Number(a.userRating || 0) ||
            parseSortDateMs(b) - parseSortDateMs(a) ||
            cleanStr(a.title || a.Title || "").localeCompare(cleanStr(b.title || b.Title || ""))
    );

    const extraNoteItems = extraNotesPool.map((m) => ({
        movie: m,
        render: (noteLen = 180) => {
            const yr = m.year || m.Year || "N/A";
            const r = Number(m.userRating);
            const ratingBadge = Number.isFinite(r) && r > 0 ? `[${r}/10]` : "[Noted]";
            const note = cleanStr(m.userNote || m.notes || "").slice(0, noteLen).trim();
            return `- "${cleanStr(m.title || m.Title || "")}" (${yr}) ${ratingBadge}${formatSeriesTag(m)}: "${note}"`;
        }
    }));

    return {
        broaderFavoriteLines,
        lovedSeriesItems,
        extraNoteItems
    };
}

/**
 * Builds Gemini prompt for diversity selection and natural-language explanations over pre-ranked candidates.
 */
export function buildGeminiReRankPrompt(profile, mood, topCandidates = [], context = {}) {
    const watched = Array.isArray(context.watched) ? context.watched : [];
    const watchlist = Array.isArray(context.watchlist) ? context.watchlist : [];
    const feedbackLog = Array.isArray(context.feedbackLog) ? context.feedbackLog : [];
    const { activeRules: compiledTasteRules } = compileActiveTasteRules(context.tasteRules);
    const tasteRuleLines = compiledTasteRules
        .slice()
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
        .map((r) => `- [${r.pinned ? "PINNED " : ""}${r.polarity === "avoid" ? "Avoid" : "Prefer"}] ${r.text}`);
    const targetCount = Math.max(1, Number(context.targetCount) || DEFAULT_RECOMMENDATION_COUNT);
    const { effectiveMood, preset, explicitMood, vibeConstraints } = buildMoodPromptSummary(mood, context.moodFilters);
    const parsedMoodFilters = normalizeMoodFilters(context.moodFilters);

    // 1. Top Anchor Films (up to 10 primary anchors, plus up to 15 additional non-series favorites for ranks 11..25)
    const allFavorites = selectMoodStratifiedAnchors(
        watched,
        profile,
        preset,
        parsedMoodFilters,
        Math.max(40, watched.length)
    );
    const anchorEntries = allFavorites.slice(0, 10);
    const broaderFavoriteEntries = allFavorites
        .slice(10)
        .filter((m) => !isSeriesVaultItem(m))
        .slice(0, 15);
    const anchorFilms = anchorEntries.map(m => {
        const dirName = cleanStr(m.director || m.Director || "");
        const dirPart = dirName && dirName !== "Unknown" && dirName !== "N/A" ? `Dir: ${dirName}` : "";
        const rawGenre = cleanStr(m.genre || m.Genre || "");
        const genrePart = rawGenre && rawGenre !== "N/A"
            ? rawGenre.split(",").slice(0, 2).map(s => s.trim()).filter(Boolean).join(", ")
            : "";
        const metaParts = [dirPart, genrePart].filter(Boolean);
        const metaTag = metaParts.length > 0 ? ` (${metaParts.join(" | ")})` : "";
        return `- "${cleanStr(m.title)}" (${m.year || m.Year || "N/A"}) [${m.userRating}/10]${formatSeriesTag(m)}${metaTag}${formatNoteSuffix(m, 180)}`;
    });

    // 1b. Disliked / Dismissed Tonal Guardrails (up to 5 films rated <= 4★, negative z-score, or dismissed)
    const dislikedEntries = selectDislikedOrDismissedEntries(watched, profile, feedbackLog, anchorEntries, 5);
    const dislikedFilms = dislikedEntries.map((s) => s.line);

    // 2. Recent Watch Streak (last 3 positively rated films with dates)
    const recentItems = [...watched]
        .filter(m => typeof m.userRating === "number" && m.userRating >= 6 && m.dateWatched)
        .sort((a, b) => new Date(b.dateWatched) - new Date(a.dateWatched))
        .slice(0, 3);
    const recentStreak = recentItems
        .map(m => `- "${cleanStr(m.title)}" (${m.year || m.Year || "N/A"}) [${m.userRating}/10]${formatSeriesTag(m)}${formatNoteSuffix(m, 120)}`);

    // 2b. Near Misses (6-7★ films closest to 9-10★ favorites, excluding disliked items)
    const nearMissEntries = selectNearMissEntries(watched, profile, context.embeddingIndex || null, dislikedFilms, 4);
    const nearMisses = nearMissEntries.map((e) => e.line);

    // 2c. Stated future interest from Watchlist (excluded from recommendations)
    const watchlistLines = [];
    const seenWatchlist = [];
    for (const m of watchlist) {
        if (!m || watchlistLines.length >= 8) continue;
        const title = cleanStr(m.title || m.Title || "");
        if (!title || seenWatchlist.some((prev) => isSameMovie(prev, m))) continue;
        seenWatchlist.push(m);
        watchlistLines.push(`- "${title}" (${m.year || m.Year || "N/A"})${formatSeriesTag(m)}`);
    }

    // 2d. Extended Vault Context (#4: favorites #11..#25, loved series/anime, and remaining userNotes)
    const {
        broaderFavoriteLines,
        lovedSeriesItems,
        extraNoteItems
    } = buildExtendedVaultContextSections({
        watched,
        broaderFavoriteEntries,
        anchorEntries,
        dislikedRefs: dislikedEntries.map((d) => d.ref),
        recentItems,
        nearMissRefs: nearMissEntries.map((n) => n.ref),
        maxSeries: 12
    });

    const lovedGenres = Array.isArray(profile?.lovedGenreNames) && profile.lovedGenreNames.length > 0
        ? profile.lovedGenreNames
        : (Array.isArray(profile?.genres) ? profile.genres.map(g => (typeof g === "string" ? g : g?.name || "")).filter(Boolean) : []);
    const ratingStats = profile?.userStats || profile?.ratingStats;
    const ratingCount = Number(ratingStats?.count ?? profile?.totalRated ?? watched.length) || 0;
    const directorNames = extractDirectorNames(profile?.topDirectors);
    const tasteLines = [
        `- Favorite Genres: ${lovedGenres.join(", ") || "Diverse / Open"}`,
        directorNames.length > 0 ? `- Favorite Directors: ${directorNames.join(", ")}` : "",
        ratingStats && Number.isFinite(Number(ratingStats.mean)) && Number(ratingStats.count) > 0
            ? `- Rating Baseline: Avg ${Number(ratingStats.mean).toFixed(1)}/10 across ${ratingCount} ratings (treat <=5/10 as strong dislikes)`
            : "",
        `- Selected Mood / Vibe: "${cleanStr(effectiveMood)}" (${preset.label})`,
        `- Mood Directive: ${preset.promptDirective}`,
        vibeConstraints.length > 0 ? `- Custom Vibe Constraints: ${vibeConstraints.join(" | ")}` : ""
    ].filter(Boolean);

    // 3. Compact Candidate Metadata formatting + adaptive <18,000 char budget guard
    const toLimitedList = (val, limit) => {
        const raw = Array.isArray(val)
            ? val
            : typeof val === "string"
                ? val.split(",")
                : [];
        return raw
            .map((s) => cleanStr(typeof s === "string" ? s : s?.name || ""))
            .filter((s) => s && s !== "N/A" && s !== "Unknown")
            .slice(0, limit);
    };

    const formatCandidatePromptBlock = (c, { plotLimit = 250, taglineLimit = 70 } = {}) => {
        const directorStr = c.director && c.director !== "Unknown" && c.director !== "N/A"
            ? ` | Dir: ${cleanStr(c.director)}`
            : "";
        const badgesStr = Array.isArray(c.matchReasons) && c.matchReasons.length > 0
            ? ` | [${c.matchReasons.join(", ")}]`
            : "";
        const votesStr = c.vote_count ? ` (${c.vote_count}v)` : "";
        const ratingStr = c.vote_average != null && c.vote_average !== "N/A" ? `${c.vote_average}/10` : "N/A";

        const runtimeNum = Number(c.runtimeMinutes);
        const langs = toLimitedList(c.spokenLanguages, 2);
        const origins = langs.length === 0 ? toLimitedList(c.originCountry, 2) : [];
        const specsParts = [
            Number.isFinite(runtimeNum) && runtimeNum > 0 ? `${Math.round(runtimeNum)}m` : "",
            langs.length > 0 ? langs.join(", ") : origins.join(", "),
        ].filter(Boolean);
        const specsStr = specsParts.length > 0 ? ` | [${specsParts.join(" | ")}]` : "";

        const baseLine = `ID: ${c.id || c.tmdbId} | "${cleanStr(c.title)}" (${c.year})${directorStr} | Genres: ${c.genre} | TMDB: ${ratingStr}${votesStr}${badgesStr}${specsStr}`;

        const castList = toLimitedList(c.cast, 3);
        const themeList = toLimitedList(c.keywordNames, 5);
        const rawTagline = cleanStr(c.tagline || "");
        const taglineText = taglineLimit > 0 && rawTagline && rawTagline !== "N/A"
            ? rawTagline.slice(0, taglineLimit)
            : "";
        const rawCollectionName = cleanStr(c.collectionName || "");
        const collectionText = plotLimit >= 80 && rawCollectionName && rawCollectionName !== "N/A"
            ? rawCollectionName.slice(0, 60)
            : "";
        const rawPlot = cleanStr(c.overview || c.plot || "");
        const plotText = plotLimit > 0 && rawPlot && rawPlot !== "N/A"
            ? rawPlot.slice(0, plotLimit)
            : "";

        const detailParts = [
            castList.length > 0 ? `Cast: ${castList.join(", ")}` : "",
            themeList.length > 0 ? `Themes: ${themeList.join(", ")}` : "",
            taglineText ? `Tagline: "${taglineText}"` : "",
            collectionText ? `Collection: ${collectionText}` : "",
            plotText ? `Plot: ${plotText}` : "",
        ].filter(Boolean);

        return detailParts.length > 0 ? `${baseLine}\n  ${detailParts.join(" | ")}` : baseLine;
    };

    const renderPrompt = (candLimits = {}) => {
        const {
            plotLimit = 250,
            taglineLimit = 70,
            extFavLimit = broaderFavoriteLines.length,
            seriesLimit = lovedSeriesItems.length,
            notesLimit = extraNoteItems.length,
            noteLen = 180
        } = candLimits;

        const broaderLines = broaderFavoriteLines.slice(0, Math.max(0, extFavLimit));
        const seriesLines = lovedSeriesItems.slice(0, Math.max(0, seriesLimit)).map((item) => item.render(noteLen));
        const extraNotes = extraNoteItems.slice(0, Math.max(0, notesLimit)).map((item) => item.render(noteLen));

        const candidatesStr = topCandidates
            .map((c) => formatCandidatePromptBlock(c, { plotLimit, taglineLimit }))
            .join("\n");

        return `
You are an elite film critic and cinema intelligence engine.
Select a diverse top ${targetCount} from these pre-ranked TMDB candidate movies and write compelling, personalized explanations.
Do NOT output numeric match percentages—evaluate fit independently from taste signals, themes, cast, directors, and plots.

USER TASTE PROFILE:
${tasteLines.join("\n")}
${tasteRuleLines.length > 0 ? `\nUSER'S STEERABLE TASTE RULES (Follow strictly):\n${tasteRuleLines.join("\n")}` : ""}
${anchorFilms.length > 0 ? `\nUSER'S FAVORITE ANCHOR FILMS:\n${anchorFilms.join("\n")}` : ""}
${dislikedFilms.length > 0 ? `\nUSER'S DISLIKED / DISMISSED FILMS (Avoid similar tone):\n${dislikedFilms.join("\n")}` : ""}
${recentStreak.length > 0 ? `\nRECENT WATCH STREAK:\n${recentStreak.join("\n")}` : ""}
${nearMisses.length > 0 ? `\nNEAR MISSES (Good but not 9/10 for this user):\n${nearMisses.join("\n")}` : ""}
${watchlistLines.length > 0 ? `\nUSER'S WATCHLIST (Stated interest — excluded from candidates):\n${watchlistLines.join("\n")}` : ""}
${broaderLines.length > 0 ? `\nADDITIONAL TOP FAVORITES:\n${broaderLines.join("\n")}` : ""}
${seriesLines.length > 0 ? `\nLOVED SERIES / ANIME:\n${seriesLines.join("\n")}` : ""}
${extraNotes.length > 0 ? `\nADDITIONAL VIEWER NOTES:\n${extraNotes.join("\n")}` : ""}

PRE-RANKED CANDIDATE MOVIES (Top ${topCandidates.length}):
${candidatesStr}

TASK:
Perform a diversity pass over these top candidates and select ${targetCount} distinct films.
- Curate openly: Every listed candidate already cleared availability and safety filters. Judge picks across the full list equally on tone, pacing, directorial voice, plots, user notes, and diversity.
- Keep directors varied (max 2 picks per director unless deeply core).${explicitMood ? `\n- CRITICAL MOOD RULE: Every pick MUST genuinely fit the "${preset.label}" mood and any custom vibe constraints above — prioritize true mood matches over off-tone vault staples.` : ""}
- Franchise rule: Prefer max 1 film per franchise/collection, and never recommend a numbered sequel/Part 2+ unless an earlier installment in that franchise appears in the user's Vault.
Write a bespoke 1-sentence upright editorial reason explaining how each pick fits their requested vibe and favorite anchors, user notes, directors, themes, or pacing (never generic plot summary).
CRITICAL STYLE RULES FOR "reason" AND OUTPUT:
- Write clean, human cinema prose (1 sentence, plain statement).
- NEVER include internal system labels, scoring jargon, badges, percentages, or model names in the text (forbid phrases like "Taste-Twin Match", "Core Theme Match", "Genre Bullseye", "% Match", or "Gemini").
- Include "anchorTitles": 1 to 3 exact titles copied verbatim from USER'S FAVORITE ANCHOR FILMS that this pick pairs best with.
Output strict JSON with:
1. tasteProfile: Object containing favoriteGenres (array of strings), preferredEra (string), and ratingStyle (string description).
2. recommendations: Array of ${targetCount} items with:
   - tmdbId (number matching the candidate ID)
   - title (string)
   - year (string)
   - anchorTitles (array of 1-3 exact titles from user's favorite anchor films)
   - reason (string: crisp 1-sentence editorial connection free of internal jargon)
3. wildcardPicks (optional): Array of 0 to 2 theatrical feature films NOT already in PRE-RANKED CANDIDATE MOVIES, watched, or watchlist that fit even better (verified automatically via TMDB, vault exclusions, streaming providers, and active mood gates before inclusion), each with:
   - title (string)
   - year (string)
   - anchorTitles (array of 1-3 exact titles from user's favorite anchor films)
   - reason (string: crisp 1-sentence editorial connection free of internal jargon)
`;
    };

    const PROMPT_CHAR_BUDGET = 19200;
    const PROMPT_CHAR_LIMIT = 20000;
    let limits = {
        plotLimit: 250,
        taglineLimit: 70,
        extFavLimit: broaderFavoriteLines.length,
        seriesLimit: lovedSeriesItems.length,
        notesLimit: extraNoteItems.length,
        noteLen: 180
    };
    let prompt = renderPrompt(limits);
    if (prompt.length > PROMPT_CHAR_BUDGET) {
        limits = { ...limits, taglineLimit: 0 };
        prompt = renderPrompt(limits);
    }
    if (prompt.length > PROMPT_CHAR_BUDGET) {
        const excess = prompt.length - (PROMPT_CHAR_BUDGET - 400);
        const perCandidate = Math.max(1, topCandidates.length);
        const tightenedPlot = Math.max(80, 250 - Math.ceil(excess / perCandidate) - 10);
        limits = { ...limits, plotLimit: tightenedPlot };
        prompt = renderPrompt(limits);
    }
    if (prompt.length > 19600) {
        limits = { ...limits, plotLimit: 60 };
        prompt = renderPrompt(limits);
    }
    if (prompt.length > 19600 && extraNoteItems.length > 0) {
        limits = { ...limits, noteLen: 100 };
        prompt = renderPrompt(limits);
    }
    if (prompt.length > 19600 && limits.notesLimit > 0) {
        let lo = 0;
        let hi = limits.notesLimit;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            const probe = renderPrompt({ ...limits, notesLimit: mid });
            if (probe.length <= 19600) lo = mid;
            else hi = mid - 1;
        }
        limits = { ...limits, notesLimit: lo };
        prompt = renderPrompt(limits);
    }
    if (prompt.length > PROMPT_CHAR_LIMIT && limits.extFavLimit > 0) {
        limits = { ...limits, extFavLimit: 0 };
        prompt = renderPrompt(limits);
    }
    if (prompt.length > PROMPT_CHAR_LIMIT && limits.seriesLimit > 0) {
        limits = { ...limits, seriesLimit: 0 };
        prompt = renderPrompt(limits);
    }
    if (prompt.length > PROMPT_CHAR_LIMIT) {
        limits = { ...limits, plotLimit: 0 };
        prompt = renderPrompt(limits);
    }
    return prompt;
}

function buildRecommendationEntry(candidate = {}, fallback = {}, profile = {}, extras = {}) {
    const tmdbId = candidate.id || candidate.tmdbId || fallback.tmdbId;
    const title = candidate.title || fallback.title;
    const rawReason = extras.reason || fallback.reason || "Selected for your taste profile and requested vibe.";
    const rawCollectionId = Number(candidate.collectionId ?? fallback.collectionId);
    const collectionId = Number.isSafeInteger(rawCollectionId) && rawCollectionId > 0 ? rawCollectionId : null;
    const collectionName = String(candidate.collectionName ?? fallback.collectionName ?? "").trim() || null;
    return {
        id: tmdbId,
        tmdbId,
        imdbID: candidate.imdbID || candidate.imdb_id || fallback.imdbID || null,
        title,
        year: candidate.year || fallback.year || "N/A",
        ...(candidate.director || fallback.director ? { director: candidate.director || fallback.director } : {}),
        ...(collectionId !== null ? { collectionId } : {}),
        ...(collectionName ? { collectionName } : {}),
        genre: candidate.genre || (profile?.lovedGenreNames?.[0] || "Cinema"),
        poster: candidate.poster || getFallbackPoster(title),
        backdrop: candidate.backdrop || null,
        imdbRating: candidate.vote_average ? String(candidate.vote_average) : null,
        streamProviders: Array.isArray(candidate.streamProviders) ? candidate.streamProviders : [],
        freeProviders: Array.isArray(candidate.freeProviders) ? candidate.freeProviders : [],
        matchScore: typeof candidate.matchScore === "number"
            ? candidate.matchScore
            : normalizeMatchScore(fallback.matchScore),
        matchReasons: Array.isArray(candidate.matchReasons) ? candidate.matchReasons : [],
        ...(extras.anchorTitles ? { anchorTitles: extras.anchorTitles } : {}),
        ...(extras.anchorIds ? { anchorIds: extras.anchorIds } : {}),
        rankerProbability: candidate.rankerProbability ?? null,
        features: sanitizeFeatureSnapshot(candidate.features ?? fallback.features),
        reason: rawReason,
        plot: candidate.overview || rawReason,
        sourceBucket: candidate.sourceBucket || "TMDB",
        realData: true
    };
}

function computeHydrationCoverage(candidates = []) {
    const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    const total = list.length;
    if (total === 0) return { hydrated: 0, total: 0, ratio: 0, percent: 0 };
    const hydrated = list.filter((c) => (
        c?.hydrated === true ||
        c?.features?.hydrated === true ||
        (Array.isArray(c?.tmdbKeywords) && Array.isArray(c?.castIds))
    )).length;
    const ratio = hydrated / total;
    return {
        hydrated,
        total,
        ratio,
        percent: Math.round(ratio * 100)
    };
}

function normalizeDirectorCapKey(entry, candidate = null) {
    const rawDir = String(entry?.director || candidate?.director || "").trim();
    const cleanDir = rawDir.toLowerCase();
    if (rawDir && cleanDir !== "unknown" && cleanDir !== "n/a") {
        return `dir:${cleanDir.replace(/\s+/g, " ")}`;
    }
    const crewId = Number(candidate?.crewPersonId ?? entry?.crewPersonId ?? 0);
    if (Number.isSafeInteger(crewId) && crewId > 0) {
        return `crew:${crewId}`;
    }
    return "";
}

function normalizeCollectionCapKey(entry, candidate = null) {
    const colId = Number(entry?.collectionId ?? candidate?.collectionId ?? 0);
    return Number.isSafeInteger(colId) && colId > 0 ? `col:${colId}` : "";
}

function buildPoolCapItem(entry, candidate = null) {
    return {
        entry,
        dirKey: normalizeDirectorCapKey(entry, candidate),
        collectionKey: normalizeCollectionCapKey(entry, candidate)
    };
}

function selectWithSoftVarietyCaps(
    items = [],
    desiredTotal = DEFAULT_RECOMMENDATION_COUNT,
    { maxPerDirector = 2, maxPerCollection = 1 } = {}
) {
    const selected = [];
    const overflow = [];
    const dirCounts = new Map();
    const collectionCounts = new Map();

    for (const item of items) {
        if (selected.length >= desiredTotal) break;
        const dirKey = item.dirKey || "";
        const collectionKey = item.collectionKey || "";
        const dirCount = dirKey ? (dirCounts.get(dirKey) || 0) : 0;
        const colCount = collectionKey ? (collectionCounts.get(collectionKey) || 0) : 0;
        if ((dirKey && dirCount >= maxPerDirector) || (collectionKey && colCount >= maxPerCollection)) {
            overflow.push(item);
            continue;
        }
        selected.push(item);
        if (dirKey) dirCounts.set(dirKey, dirCount + 1);
        if (collectionKey) collectionCounts.set(collectionKey, colCount + 1);
    }

    for (const item of overflow) {
        if (selected.length >= desiredTotal) break;
        selected.push(item);
    }

    return selected.map((x) => x.entry);
}

export const MAX_WILDCARD_PICKS = 2;

function sanitizeGeminiReasonText(raw) {
    if (!raw || typeof raw !== "string") return "";
    return raw
        .replace(/\b\d{2,3}%\s*(High\s*)?Taste-?Twin\s*Match\b/gi, "")
        .replace(/\b(High\s*)?(Taste-?Twin Match|Core Theme Match|Genre Bullseye|Cult Classic Overlap)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .replace(/^[\s,.:;-]+/, "")
        .trim();
}

function resolveGeminiExplanationFields(
    pick = {},
    watchedList = [],
    defaultReason = "Pairs closely with your top-rated films."
) {
    const fallbackText = typeof pick?.reason === "string" && pick.reason.trim() ? pick.reason.trim() : "";
    const reason = sanitizeGeminiReasonText(pick?.reason) || fallbackText || defaultReason;
    const anchorTitles = Array.isArray(pick?.anchorTitles)
        ? pick.anchorTitles.filter((t) => typeof t === "string" && t.trim())
        : [];
    const anchorIds = anchorTitles
        .map((t) => watchedList.find((w) => (w.title || w.Title || "").toLowerCase() === t.toLowerCase()))
        .filter(Boolean)
        .map((w) => w.imdbID || w.id || (w.tmdbId ? `tmdb_${w.tmdbId}` : null))
        .filter(Boolean);
    return { reason, anchorTitles, anchorIds };
}

/**
 * Resolves, filters, hydrates, and deterministically scores Gemini's optional 1-2 outside
 * wildcardPicks against strict TMDB movie matching, vault/watchlist/pool exclusions,
 * active streaming providers, and mood gates — dropping failures silently for backfill.
 */
export async function verifyAndScoreWildcardPicks(rawWildcards = [], context = {}, options = {}) {
    if (!Array.isArray(rawWildcards) || rawWildcards.length === 0) return [];

    const maxWildcards = Math.max(0, Number(options?.maxWildcards ?? MAX_WILDCARD_PICKS));
    if (maxWildcards === 0) return [];

    const watched = Array.isArray(context?.watched) ? context.watched : [];
    const watchlist = Array.isArray(context?.watchlist) ? context.watchlist : [];
    const excludeIds = Array.isArray(context?.excludeIds) ? context.excludeIds : [];
    const existingCandidates = Array.isArray(context?.existingCandidates) ? context.existingCandidates : [];
    const profile = context?.profile || {};
    const mood = context?.mood ?? "any";
    const moodFilters = normalizeMoodFilters(context?.moodFilters);
    const explicitMood = isExplicitMoodActive(mood, moodFilters);
    const userRegion = context?.userRegion || options?.userRegion || "US";
    const userProviders = context?.userProviders ?? options?.userProviders ?? [];
    const hasProviderFilter = Array.isArray(userProviders) && userProviders.length > 0;
    const collabSimMap = context?.collabSimMap ?? null;
    const repulsionMap = context?.repulsionMap ?? null;
    const embeddingIndex = context?.embeddingIndex ?? null;
    const contentIndex = context?.contentIndex ?? null;
    const dnaIndex = context?.dnaIndex ?? null;
    const rankerWeights = context?.rankerWeights ?? options?.rankerWeights ?? DEFAULT_RANKER_WEIGHTS;
    const rankerOptions = context?.rankerOptions ?? options?.rankerOptions ?? {};
    const tasteRules = context?.tasteRules ?? options?.tasteRules ?? [];
    const { avoidRules } = Array.isArray(tasteRules) && tasteRules.length > 0
        ? compileActiveTasteRules(tasteRules)
        : { avoidRules: [] };

    const isExcludedOrSeen = (item) =>
        excludeIds.some((ex) => isSameMovie(item, ex)) ||
        watched.some((w) => isSameMovie(item, w)) ||
        watchlist.some((w) => isSameMovie(item, w)) ||
        existingCandidates.some((c) => isSameMovie(item, c));

    const resolvedStubs = [];
    const seenStubIds = new Set();
    const lookupBudget = Math.min(rawWildcards.length, maxWildcards * 2);

    for (const pick of rawWildcards.slice(0, lookupBudget)) {
        if (!pick || typeof pick !== "object") continue;
        const title = cleanStr(pick.title || "");
        if (!title || isSeriesVaultItem(pick)) continue;

        let stub = null;
        try {
            stub = typeof options?.wildcardFinder === "function"
                ? await options.wildcardFinder(title, pick.year, { ...options, userRegion, strict: true })
                : await findTmdbByTitleAndYear(title, pick.year, {
                    strict: true,
                    fetchFn: options?.fetchFn,
                    apiKey: options?.apiKey,
                    forceProxy: options?.forceProxy,
                    signal: options?.signal
                });
        } catch (_) {
            stub = null;
        }
        if (!stub) continue;

        const tmdbId = Number(stub.tmdbId ?? stub.id ?? 0);
        if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0 || seenStubIds.has(tmdbId)) continue;
        if (isSeriesVaultItem(stub) || isExcludedOrSeen(stub)) continue;

        seenStubIds.add(tmdbId);
        resolvedStubs.push({ pick, stub, tmdbId });
    }

    if (resolvedStubs.length === 0) return [];

    let detailsMap = new Map();
    if (typeof options?.detailFetcher === "function") {
        await Promise.all(
            resolvedStubs.map(async ({ tmdbId }) => {
                try {
                    const details = await options.detailFetcher(tmdbId, userRegion);
                    if (details) detailsMap.set(tmdbId, details);
                } catch (_) {}
            })
        );
    } else {
        try {
            detailsMap = await fetchBatchFormattedDetailsMap(
                resolvedStubs.map((s) => s.tmdbId),
                userRegion,
                {
                    fetchFn: options?.fetchFn,
                    apiKey: options?.apiKey,
                    forceProxy: options?.forceProxy,
                    cacheStore: options?.cacheStore,
                    indexedDB: options?.indexedDB,
                    bypassCache: options?.bypassCache,
                    signal: options?.signal
                }
            );
        } catch (_) {
            detailsMap = new Map();
        }
    }

    const verifiedEntries = [];
    for (const { pick, stub, tmdbId } of resolvedStubs) {
        const details = detailsMap.get(tmdbId);
        if (!details && !stub.hydrated) continue;

        const fullCand = {
            ...stub,
            ...(details || {}),
            id: details?.tmdbId || tmdbId,
            tmdbId: details?.tmdbId || tmdbId,
            imdbID: details?.imdbID ?? stub.imdbID ?? null,
            title: details?.title || stub.title,
            year: details?.year || stub.year || "N/A",
            release_date: details?.release_date || stub.release_date || "",
            overview: details?.plot || details?.overview || stub.overview || "",
            genre: details?.genre || stub.genre || "Cinema",
            tmdbGenreIds: Array.isArray(details?.tmdbGenreIds)
                ? details.tmdbGenreIds
                : (stub.tmdbGenreIds || stub.genre_ids || []),
            tmdbKeywords: Array.isArray(details?.tmdbKeywords)
                ? details.tmdbKeywords
                : (stub.tmdbKeywords || []),
            keywordNames: Array.isArray(details?.keywordNames)
                ? details.keywordNames
                : (stub.keywordNames || []),
            castIds: Array.isArray(details?.castIds) ? details.castIds : (stub.castIds || []),
            crewPersonId: details?.crewPersonId ?? stub.crewPersonId ?? null,
            collectionId: details?.collectionId ?? stub.collectionId ?? null,
            collectionName: details?.collectionName ?? stub.collectionName ?? null,
            streamProviders: Array.isArray(details?.streamProviders)
                ? details.streamProviders
                : (stub.streamProviders || []),
            freeProviders: Array.isArray(details?.freeProviders)
                ? details.freeProviders
                : (stub.freeProviders || []),
            providersHydrated: true,
            hydrated: true,
            sourceBucket: "Gemini Wildcard"
        };

        if (isSeriesVaultItem(fullCand)) continue;
        if (isExcludedOrSeen(fullCand)) continue;
        if (verifiedEntries.some((v) => isSameMovie(v.cand, fullCand))) continue;
        if (hasProviderFilter && !matchesWatchProviders(fullCand, userProviders)) continue;
        if (explicitMood && !matchesMoodCandidateGate(fullCand, mood, moodFilters)) continue;
        if (avoidRules.length > 0 && candidateMatchesAvoidRule(fullCand, avoidRules).matched) continue;

        verifiedEntries.push({ pick, cand: fullCand });
        if (verifiedEntries.length >= maxWildcards) break;
    }

    if (verifiedEntries.length === 0) return [];

    const verifiedCandList = verifiedEntries.map((v) => v.cand);
    const mergedContentSimMap = new Map(context?.contentSimMap instanceof Map ? context.contentSimMap : []);
    const needsDenseScan = !(context?.contentSimMap instanceof Map && context.contentSimMap.size > 0);
    const idfBase = Array.isArray(context?.allCandidates) && context.allCandidates.length > 0
        ? context.allCandidates
        : existingCandidates;
    const idfCorpus = idfBase.length > 0 ? [...idfBase, ...verifiedCandList] : verifiedCandList;
    if (needsDenseScan ? (contentIndex || verifiedCandList.length > 0) : verifiedCandList.length > 0) {
        try {
            const coldContent = buildContentSimMap(
                profile?.weightedRatings || [],
                needsDenseScan ? contentIndex : null,
                idfCorpus,
                {
                    collabIndex: embeddingIndex,
                    collabSimMap,
                    enableStructuredFallback: true,
                    coldOnly: true
                }
            );
            for (const [k, val] of coldContent.entries()) {
                if (!mergedContentSimMap.has(k)) {
                    mergedContentSimMap.set(k, val);
                }
            }
        } catch (_) {}
    }

    let wcDnaSimMap = context?.dnaSimMap instanceof Map ? context.dnaSimMap : new Map();
    if (dnaIndex && (!context?.dnaSimMap || context.dnaSimMap.size === 0)) {
        try {
            wcDnaSimMap = buildDnaSimMap(profile?.weightedRatings || [], dnaIndex);
        } catch (_) {}
    }

    // Preserve catalog-max scaling on small test catalogs (< 50 entries) without 1-item stretching
    let fallbackCatalogMax = null;
    if (collabSimMap && getCollabCatalogMax(collabSimMap) === null) {
        let maxFound = 0;
        for (const val of collabSimMap.values()) {
            const n = Number(val);
            if (Number.isFinite(n) && n > maxFound) maxFound = n;
        }
        for (const c of existingCandidates) {
            const n = Number(c?.collabSim ?? 0);
            if (Number.isFinite(n) && n > maxFound) maxFound = n;
        }
        if (maxFound > 0.05) fallbackCatalogMax = maxFound;
    }

    const scoredWildcards = [];
    for (const { pick, cand } of verifiedEntries) {
        const rankerCtx = {
            profile,
            mood,
            moodFilters,
            collabSimMap,
            contentSimMap: mergedContentSimMap,
            repulsionMap,
            dnaSimMap: wcDnaSimMap,
            anchorKeywords: context?.anchorKeywords ?? profile?.lovedKeywordIds,
            userProviders,
            tasteRules
        };
        const [scored] = rankCandidatePool(
            [cand],
            rankerCtx,
            rankerWeights,
            1,
            {
                ...(rankerOptions || {}),
                collabNormalization: "catalog-max",
                ...(fallbackCatalogMax ? { collabCatalogMax: fallbackCatalogMax } : {}),
                onDiagnostics: undefined
            },
            null
        );
        if (!scored) continue;
        scoredWildcards.push({
            ...scored,
            sourceBucket: "Gemini Wildcard",
            reason: pick?.reason,
            anchorTitles: pick?.anchorTitles
        });
    }

    return scoredWildcards;
}

/**
 * Merges Gemini's diversity pass and explanations with deterministic calibrated ranker matchScores,
 * enforcing a soft max-2-per-director cap (relaxing only to prevent shortlist underflow) and backfilling
 * any remaining slots up to targetCount from top-ranked candidates.
 */
export function mergeGeminiExplanationsWithRanker(
    result,
    rankedCandidates = [],
    profile = {},
    context = {},
    targetCount = DEFAULT_RECOMMENDATION_COUNT
) {
    if (!result?.recommendations || !Array.isArray(result.recommendations)) {
        throw new Error("Invalid recommendation schema returned by Gemini");
    }

    const effectiveTarget = Math.max(1, Number(context?.targetCount ?? targetCount) || DEFAULT_RECOMMENDATION_COUNT);
    const watchedList = Array.isArray(context.watched) ? context.watched : [];

    const usedIds = new Set();
    const chosenRefs = [];
    const wildcardPoolItems = [];
    const geminiPoolItems = [];
    const backfillPoolItems = [];

    const verifiedWildcards = Array.isArray(context?.verifiedWildcards)
        ? context.verifiedWildcards.slice(0, MAX_WILDCARD_PICKS)
        : [];
    for (const wc of verifiedWildcards) {
        if (!wc) continue;
        const key = wc.tmdbId || wc.id || wc.title?.toLowerCase();
        if ((key && usedIds.has(key)) || chosenRefs.some((r) => isSameMovie(r, wc))) continue;
        if (key) usedIds.add(key);
        chosenRefs.push(wc);

        const { reason, anchorTitles, anchorIds } = resolveGeminiExplanationFields(
            wc,
            watchedList,
            "Curated wildcard discovery aligned with your core taste profile."
        );
        const entry = buildRecommendationEntry(
            { ...wc, sourceBucket: wc.sourceBucket || "Gemini Wildcard" },
            wc,
            profile,
            { reason, anchorTitles, anchorIds }
        );
        wildcardPoolItems.push(buildPoolCapItem(entry, wc));
    }

    for (const rec of result.recommendations) {
        const candidate = rankedCandidates.find(
            c => c.id === rec.tmdbId || c.tmdbId === rec.tmdbId || c.title?.toLowerCase() === rec.title?.toLowerCase()
        ) || {};
        const refObj = candidate.tmdbId || candidate.id ? candidate : rec;
        const key = candidate.tmdbId || candidate.id || rec.tmdbId || rec.title?.toLowerCase();
        if ((key && usedIds.has(key)) || chosenRefs.some((r) => isSameMovie(r, refObj))) continue;
        if (key) usedIds.add(key);
        chosenRefs.push(refObj);

        const { reason, anchorTitles, anchorIds } = resolveGeminiExplanationFields(
            rec,
            watchedList,
            "Pairs closely with your top-rated films."
        );

        const entry = buildRecommendationEntry(candidate, rec, profile, {
            reason,
            anchorTitles,
            anchorIds
        });
        geminiPoolItems.push(buildPoolCapItem(entry, candidate));
    }

    for (const cand of rankedCandidates) {
        const key = cand.tmdbId || cand.id || cand.title?.toLowerCase();
        if ((key && usedIds.has(key)) || chosenRefs.some((r) => isSameMovie(r, cand))) continue;
        if (key) usedIds.add(key);
        chosenRefs.push(cand);
        const entry = buildRecommendationEntry(cand, {}, profile, {
            reason: "Selected by your calibrated taste profile and current mood filter."
        });
        backfillPoolItems.push(buildPoolCapItem(entry, cand));
    }

    const poolItems = [...wildcardPoolItems, ...geminiPoolItems, ...backfillPoolItems];
    const desiredTotal = Math.min(effectiveTarget, poolItems.length > 0 ? poolItems.length : effectiveTarget);
    const enriched = selectWithSoftVarietyCaps(poolItems, desiredTotal, {
        maxPerDirector: 2,
        maxPerCollection: 1
    });
    enriched.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));

    return {
        tasteProfile: result.tasteProfile || {
            favoriteGenres: (profile.lovedGenreNames || []).slice(0, 3),
            preferredEra: "Contemporary",
            ratingStyle: "High cinematic affinity"
        },
        recommendations: enriched.slice(0, effectiveTarget)
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
    const prompt = `Convert this movie request into structured filter JSON: "${cleaned}"
Choose moodId from: "any", "mind-bending", "dark-thriller", "fun-popcorn", "comfort-watch", "hidden-gem".
Set withGenres to standard genre names (e.g. "Comedy", "Sci-Fi", "Thriller", "Drama", "Crime", "Mystery", "Action", "Animation", "Romance", "Horror").
Set withoutKeywords to short lowercase themes/tropes to avoid (e.g. "gore", "jumpscares").
Set minYear / maxYear as 4-digit numbers if a decade or era is requested (otherwise null).`;
    const config = {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                moodId: { type: Type.STRING },
                withGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
                withoutKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
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
    reason = "Selected by the CinemaVault calibrated taste ranker.",
    targetCount = DEFAULT_RECOMMENDATION_COUNT,
    moodShortfall = null
) {
    const limit = Math.max(1, Number(targetCount) || DEFAULT_RECOMMENDATION_COUNT);
    const capped = selectWithSoftVarietyCaps(
        (topCandidates || []).map((cand) => {
            const entry = buildRecommendationEntry(cand, {}, profile, { reason });
            return buildPoolCapItem(entry, cand);
        }),
        Math.min(limit, (topCandidates || []).length),
        { maxPerDirector: 2, maxPerCollection: 1 }
    );
    capped.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
    return {
        tasteProfile: {
            favoriteGenres: (profile?.lovedGenreNames || []).slice(0, 3),
            preferredEra: "Mixed",
            ratingStyle: "Varied"
        },
        recommendations: capped,
        modelInfo,
        ...(moodShortfall ? { moodShortfall } : {})
    };
}

/**
 * Executes Calibrated Ranker + Gemini Explanations & Diversity Pass
 */
async function reRankCandidatesWithGemini(ai, profile, mood, candidates, options = {}) {
    const targetCount = Math.max(1, Number(options.targetCount) || DEFAULT_RECOMMENDATION_COUNT);
    const shortlistLimit = Math.max(targetCount, options.topK || (ai ? 39 : 30));
    const moodFilters = normalizeMoodFilters(options.moodFilters);
    const explicitMood = isExplicitMoodActive(mood, moodFilters);
    const reserveConfig =
        options.reserve !== undefined
            ? options.reserve
            : explicitMood
                ? null
                : {
                    count: RECENT_RELEASE_RESERVE_COUNT,
                    minReleaseDate: getRecentReleaseDateFloor(RECENT_RELEASE_RESERVE_MONTHS, options.now),
                    minProbabilityPercentile: RECENT_RELEASE_MIN_PROB_PERCENTILE
                };

    const rankerContext = {
        profile,
        mood,
        moodFilters,
        excludeIds: options.excludeIds,
        collabSimMap: options.collabSimMap,
        contentSimMap: options.contentSimMap,
        repulsionMap: options.repulsionMap,
        dnaSimMap: options.dnaSimMap,
        anchorKeywords: options.anchorKeywords ?? profile?.lovedKeywordIds,
        userProviders: options.userProviders,
        tasteRules: options.tasteRules
    };

    let topCandidates = ai
        ? buildDiversifiedGeminiShortlist(
            candidates,
            rankerContext,
            options.rankerWeights,
            { ...(options.rankerOptions || {}), shortlistLimit },
            reserveConfig
        )
        : rankCandidatePool(
            candidates,
            rankerContext,
            options.rankerWeights,
            shortlistLimit,
            options.rankerOptions,
            reserveConfig
        );

    // Exhaustion guard: if session refresh exclusions shrunk the pool below targetCount,
    // keep unseen items at the front and pad from the broader ranked pool.
    if (
        Array.isArray(options.excludeIds) &&
        options.excludeIds.length > 0 &&
        topCandidates.length < Math.min(targetCount, candidates.length)
    ) {
        const padded = rankCandidatePool(
            candidates,
            { ...rankerContext, excludeIds: [] },
            options.rankerWeights,
            shortlistLimit,
            options.rankerOptions,
            reserveConfig
        );
        const usedIds = new Set(
            topCandidates.map(c => String(c?.tmdbId ?? c?.id ?? c?.imdbID ?? "").trim()).filter(Boolean)
        );
        for (const cand of padded) {
            const cid = String(cand?.tmdbId ?? cand?.id ?? cand?.imdbID ?? "").trim();
            if (cid && usedIds.has(cid)) continue;
            if (cid) usedIds.add(cid);
            topCandidates.push(cand);
            if (topCandidates.length >= shortlistLimit) break;
        }
    }

    const hydrationCoverage = options.hydrationCoverage || computeHydrationCoverage(candidates);
    const moodShortfall = explicitMood && topCandidates.length < targetCount
        ? { requested: targetCount, available: topCandidates.length }
        : null;

    if (!ai) {
        const cascade = getCurationCascade();
        const rankerFallbackInfo = {
            ...buildCascadeModelInfo(cascade, null, "curation", "ranker-fallback"),
            hydrationCoverage
        };
        lastCurationModelInfo = rankerFallbackInfo;
        options.onDiagnostics?.({
            mergedCandidates: candidates,
            topCandidates,
            reserve: reserveConfig,
            model: null,
            modelInfo: rankerFallbackInfo,
            usageMetadata: null,
            hydrationCoverage,
            moodShortfall
        });
        return buildRankerFallbackResponse(topCandidates, profile, rankerFallbackInfo, undefined, targetCount, moodShortfall);
    }

    // Progressive Stage-3 rendering: emit the instant local ranker top-10 immediately so the UI
    // never blocks on a 15-35s cold Gemini cascade before showing recommendations.
    if (
        typeof options.onStage3Ready === "function" ||
        typeof options.onPreliminaryRecommendations === "function"
    ) {
        try {
            const preliminaryModelInfo = {
                ...buildCascadeModelInfo(getCurationCascade(), null, "curation", "ranker-preliminary"),
                hydrationCoverage,
                fallbackMode: "ranker-preliminary",
                pipeline: "ranker-preliminary",
                isPreliminary: true
            };
            const preliminaryResult = buildRankerFallbackResponse(
                topCandidates,
                profile,
                preliminaryModelInfo,
                "Selected by your local taste ranker while Gemini refines curation & explanations...",
                targetCount,
                moodShortfall
            );
            options.onStage3Ready?.(preliminaryResult);
            options.onPreliminaryRecommendations?.(preliminaryResult);
        } catch (_) {}
    }

    const prompt = buildGeminiReRankPrompt(profile, mood, topCandidates, {
        watched: options.watched,
        watchlist: options.watchlist,
        feedbackLog: options.feedbackLog,
        embeddingIndex: options.embeddingIndex,
        tasteRules: options.tasteRules,
        moodFilters,
        targetCount
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
                },
                wildcardPicks: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            year: { type: Type.STRING },
                            anchorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
                            reason: { type: Type.STRING }
                        },
                        required: ["title", "year", "reason"]
                    }
                }
            },
            required: ["tasteProfile", "recommendations"]
        }
    };

    const activeCascade = getCurationCascade();
    const prevSeq = lastCurationModelInfo?.seq || 0;
    const response = await executeCascade(
        ai,
        activeCascade,
        { contents: prompt, config: generationConfig },
        { cascadeType: "curation" }
    );

    const activeRunModelInfo = {
        ...(response
            ? buildCascadeModelInfo(
                activeCascade,
                lastCurationModelInfo?.seq > prevSeq ? lastCurationModelInfo.model : sessionCurationModel,
                "curation",
                "gemini-curation",
                {
                    usageMetadata: response?.usageMetadata ?? null,
                    seq: lastCurationModelInfo?.seq || prevSeq
                }
            )
            : buildCascadeModelInfo(activeCascade, null, "curation", "ranker-fallback")),
        hydrationCoverage
    };
    lastCurationModelInfo = activeRunModelInfo;

    options.onDiagnostics?.({
        mergedCandidates: candidates,
        topCandidates,
        reserve: reserveConfig,
        model: response ? activeRunModelInfo.model : null,
        modelInfo: activeRunModelInfo,
        usageMetadata: response?.usageMetadata ?? null,
        hydrationCoverage,
        moodShortfall
    });

    if (!response) {
        console.warn("All Gemini models failed to re-rank candidates, falling back to direct ranker output.");
        return buildRankerFallbackResponse(topCandidates, profile, activeRunModelInfo, undefined, targetCount, moodShortfall);
    }

    try {
        const result = sanitizeAndParseJSON(response.text);
        if (!Array.isArray(result?.recommendations) || result.recommendations.length === 0) {
            throw new Error("Gemini re-rank returned empty or missing recommendations array");
        }
        const verifiedWildcards = Array.isArray(result?.wildcardPicks) && result.wildcardPicks.length > 0
            ? await verifyAndScoreWildcardPicks(
                result.wildcardPicks,
                {
                    watched: options.watched,
                    watchlist: options.watchlist,
                    excludeIds: options.excludeIds,
                    existingCandidates: topCandidates,
                    allCandidates: candidates,
                    profile,
                    mood,
                    moodFilters,
                    userRegion: options.userRegion || "US",
                    userProviders: options.userProviders || [],
                    embeddingIndex: options.embeddingIndex,
                    contentIndex: options.contentIndex,
                    dnaIndex: options.dnaIndex,
                    tasteRules: options.tasteRules,
                    collabSimMap: options.collabSimMap,
                    contentSimMap: options.contentSimMap,
                    repulsionMap: options.repulsionMap,
                    dnaSimMap: options.dnaSimMap,
                    rankerWeights: options.rankerWeights,
                    rankerOptions: options.rankerOptions
                },
                {
                    wildcardFinder: options.wildcardFinder,
                    detailFetcher: options.detailFetcher,
                    fetchFn: options.fetchFn,
                    apiKey: options.apiKey,
                    forceProxy: options.forceProxy,
                    cacheStore: options.cacheStore,
                    indexedDB: options.indexedDB,
                    bypassCache: options.bypassCache,
                    signal: options.signal
                }
            ).catch(() => [])
            : [];
        const merged = mergeGeminiExplanationsWithRanker(result, topCandidates, profile, {
            watched: options.watched,
            targetCount,
            verifiedWildcards
        });
        if (!Array.isArray(merged?.recommendations) || merged.recommendations.length === 0) {
            throw new Error("Merged recommendations empty");
        }
        return {
            ...merged,
            modelInfo: activeRunModelInfo,
            ...(moodShortfall ? { moodShortfall } : {})
        };
    } catch (parseErr) {
        console.warn("Gemini JSON parse/merge failed, falling back to local calibrated ranker:", parseErr);
        const fallbackInfo = {
            ...buildCascadeModelInfo(
                getCurationCascade(),
                null,
                "curation",
                "ranker-fallback",
                {
                    usageMetadata: response?.usageMetadata ?? null,
                    seq: activeRunModelInfo?.seq || prevSeq
                }
            ),
            hydrationCoverage
        };
        lastCurationModelInfo = fallbackInfo;
        return buildRankerFallbackResponse(topCandidates, profile, fallbackInfo, undefined, targetCount, moodShortfall);
    }
}

/**
 * Fallback Generative Pipeline (used when TMDB key is missing or unavailable)
 */
async function generateWithOmdbFallback(ai, watchedMovies, watchlist, onProgress, options = {}) {
    onProgress?.("Synthesizing recommendations from vault history...");
    const targetCount = Math.max(1, Number(options.targetCount) || DEFAULT_RECOMMENDATION_COUNT);
    const { effectiveMood, preset, vibeConstraints } = buildMoodPromptSummary(options.mood || "any", options.moodFilters);
    const { activeRules: fallbackActiveRules } = compileActiveTasteRules(options?.tasteRules);
    const fallbackRuleLines = fallbackActiveRules.map(
        (r) => `- [${r.polarity === "avoid" ? "Avoid" : "Prefer"}] ${r.text}`
    );

    const analytics = buildTasteAnalytics(watchedMovies);
    const header = "Title|Year|Director|Genre|Rating|UserNote";
    const rows = (watchedMovies || []).slice(0, 25).map(m =>
        `${cleanStr(m.title || m.Title)}|${cleanStr(m.year || m.Year || "N/A")}|${cleanStr(m.director || m.Director || "Unknown")}|${cleanStr(m.genre || m.Genre || "Unknown")}|${m.userRating || m.UserRating || 0}|${cleanStr(m.userNote || m.UserNote || "")}`
    ).join("\n");
    const historyData = `${header}\n${rows}`;

    const prompt = `
You are an elite film critic. Select ${targetCount} distinct movie recommendations based on this viewing history:
${historyData}

Mood requested: "${cleanStr(effectiveMood)}" (${preset.label}) — ${preset.promptDirective}
${vibeConstraints.length > 0 ? `Custom Vibe Constraints: ${vibeConstraints.join(" | ")}` : ""}
${fallbackRuleLines.length > 0 ? `\nUSER'S STEERABLE TASTE RULES (Follow strictly):\n${fallbackRuleLines.join("\n")}\n` : ""}Return JSON with tasteProfile (favoriteGenres, preferredEra, ratingStyle) and recommendations (title, year, type, genre, matchScore, reason).
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

    const omdbCascade = getCurationCascade();
    const prevOmdbSeq = lastCurationModelInfo?.seq || 0;
    const response = await executeCascade(
        ai,
        omdbCascade,
        { contents: prompt, config: generationConfig },
        { cascadeType: "curation" }
    );

    if (!response) {
        lastCurationModelInfo = buildCascadeModelInfo(omdbCascade, null, "curation", "gemini-omdb-fallback");
        throw new Error("Fallback recommendation generation failed");
    }

    const omdbModelInfo = buildCascadeModelInfo(
        omdbCascade,
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
            onProgress?.("Finding candidates across your taste profile...");
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
                        ...(Array.isArray(options.excludeIds) ? options.excludeIds.map(id => Number(id || 0)) : []),
                        ...candidates.map(c => Number(c?.tmdbId ?? c?.id ?? 0))
                    ]);
                    const catalogMax = getCollabCatalogMax(collabSimMap);
                    const repulsionWeight =
                        Math.abs(DEFAULT_RANKER_WEIGHTS.repulsion) / DEFAULT_RANKER_WEIGHTS.collabSim;
                    const neighbors = retrieveAlignedEmbeddingNeighbors(
                        profile.weightedRatings,
                        embeddingIndex,
                        excludeIds,
                        { collabSimMap, repulsionMap, catalogMax, repulsionWeight, topK: 80 }
                    );
                    const injected = await fetchEmbeddingCandidates(
                        neighbors,
                        watchedMovies,
                        watchlist,
                        candidates,
                        {
                            userRegion,
                            userProviders,
                            mood,
                            moodFilters: options.moodFilters,
                            maxNeighbors: isExplicitMoodActive(mood, options.moodFilters) ? 15 : 30
                        }
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
                        maxEnrich: options.maxEnrich ?? mergedCandidates.length,
                        concurrency: options.enrichConcurrency
                    });
                }
                const hydrationCoverage = computeHydrationCoverage(mergedCandidates);

                const contentSimMap =
                    options.contentSimMap ||
                    buildContentSimMap(profile.weightedRatings, contentIndex, mergedCandidates, {
                        collabIndex: embeddingIndex,
                        collabSimMap,
                        enableStructuredFallback: true,
                        coldOnly: true
                    });
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
                    hydrationCoverage,
                    watched: watchedMovies,
                    watchlist
                });
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
