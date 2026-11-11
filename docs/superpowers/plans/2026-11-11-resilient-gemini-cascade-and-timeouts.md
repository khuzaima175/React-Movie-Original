# Dual-Engine Gemini 4 Argon & 3.8 Flash Resilient Architecture Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a dual-engine architecture combining `gemini-4-argon` (for deep cinematic taste curation & explanations) and `gemini-3.8-flash` / `gemini-3.5-flash-lite` / `gemini-2.5-flash` (for fast interactive chat, mood parsing, and immediate failover), with model-specific `thinkingConfig` (`thinkingLevel: "LOW"` vs `thinkingBudget: 0`), session working-model memory, guaranteed per-request timeouts (8s–12s), and rich personal vault grounding in prompts.

**Architecture:**
1. **Dynamic `getModelThinkingConfig(modelName)` helper:**
   - For `gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`: return `{ thinkingLevel: "LOW" }` (bypasses default 10–15s thinking pause, avoiding 400 errors from `thinkingBudget: 0`).
   - For `gemini-2.5-flash`: return `{ thinkingBudget: 0 }` (empirically measured sub-second: 0.75s response!).
2. **Purpose-Specific Cascades:**
   - **`CURATION_MODEL_CASCADE`**: `["gemini-4-argon", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]`
     - Used for main re-ranking (`reRankCandidatesWithGemini`) and deep modal breakdowns (`geminiExplanationService.js`).
     - Timeout: 12,000ms for Argon, 8,000ms for Flash models.
   - **`FAST_INTERACTIVE_CASCADE`**: `["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]`
     - Used for live concierge chat (`geminiChatService.js`) and mood filter conversion (`parseFreeTextMoodWithGemini`).
     - Timeout: 8,000ms.
3. **Session Working-Model Memoization:**
   - Separate `sessionCurationModel` and `sessionFastModel`. Once a model succeeds, all subsequent calls in that session immediately hit the working model without testing dead/degraded models.
   - Any 429 quota exhaustion (e.g. Argon on Free Tier), 503 high demand, 504 deadline, or client timeout marks that model degraded for the session and immediately tries the next candidate in the cascade.
   - If all models fail in `reRankCandidatesWithGemini`, deterministically return the top 6 candidates from `rankCandidatePool` with their calibrated scores and `matchReasons` badges.
4. **Enriched Prompt Grounding (`buildGeminiReRankPrompt`):**
   - Provide up to 8 Top Anchor films (rated >= 8★) with truncated user review notes.
   - Provide Recent Watch Streak (last 3 positively rated films sorted by watch date).
   - Provide Top 15 Ranked Candidates with TMDB ratings, matchScore, and `matchReasons` badges (e.g. `["🧬 High Taste-Twin Match", "🎬 Favorite Filmmaker"]`).
   - Instruct Argon/Flash to write personal 1-2 sentence reasons directly connecting the pick to the user's anchors or badges.

**Tech Stack:** JavaScript (ES modules), `@google/genai`, Node.js test runner (`node:test`).

## Global Constraints
- Google GenAI client timeout minimum is 10,000ms (`httpOptions: { timeout: 12000 }`).
- Client-side `Promise.race` enforces strict per-attempt aborts (12s for Argon, 8s for Flash).
- Preserve `spendTracker` tracking.
- All existing 62 unit tests must pass (`npm test`).
- Production build must succeed (`npm run build`).

## Review Focus
1. Free Tier vs Paid Tier compatibility: On Free Tier, Argon returns 429 (quota 0) instantly (<0.3s) and cascade falls back seamlessly to `gemini-3.5-flash-lite` (0.91s) or `gemini-2.5-flash` (0.75s). On Paid Tier, Argon succeeds with deep reasoning.
2. `thinkingConfig` 400 prevention: `thinkingBudget: 0` causes HTTP 400 on `gemini-3.5-flash-lite` and `gemini-4-argon`; helper must use `{ thinkingLevel: "LOW" }`.
3. Client-side timeout: Stalled models must reject within timeout (8s Flash / 12s Argon) rather than waiting 4 minutes in the browser.
4. Cold start vs warm clicks: First click resolves working model; second click reuses `sessionActiveModel` for instant sub-second response.
5. All models offline fallback: Deterministic ranker fallback ensures UI never hangs.

---

### Task 1: Implement `getModelThinkingConfig`, Cascades, and Resilient Wrapper in `src/services/geminiService.js`

**Files:**
- Modify: `src/services/geminiService.js`
- Test: `tests/geminiDualEngine.test.js`

**Interfaces:**
- Produces:
  - `getModelThinkingConfig(modelName: string): object | undefined`
  - `CURATION_MODEL_CASCADE: string[]`
  - `FAST_INTERACTIVE_CASCADE: string[]`
  - `executeCascade(ai, cascade, requestParams, options): Promise<any>`
  - `resetSessionWorkingModels(): void`
  - `getSessionCurationModel(): string | null`
  - `getSessionFastModel(): string | null`

- [ ] **Step 1: Write unit tests in `tests/geminiDualEngine.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
    getModelThinkingConfig,
    CURATION_MODEL_CASCADE,
    FAST_INTERACTIVE_CASCADE,
    executeCascade,
    resetSessionWorkingModels,
    getSessionCurationModel
} from "../src/services/geminiService.js";

test("getModelThinkingConfig assigns LOW to argon, 3.8, and 3.5, and budget:0 to 2.5", () => {
    assert.deepEqual(getModelThinkingConfig("gemini-4-argon"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3.8-flash"), { thinkingLevel: "LOW" });
    assert.deepEqual(getModelThinkingConfig("gemini-3.5-flash-lite"), { thinkingLevel: "LOW" });
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
                return { text: JSON.stringify({ ok: true }), usageMetadata: {} };
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
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: FAIL (missing exports)

- [ ] **Step 3: Implement `getModelThinkingConfig`, dual cascades, and `executeCascade` in `src/services/geminiService.js`**

1. Export `CURATION_MODEL_CASCADE` and `FAST_INTERACTIVE_CASCADE`.
2. Export `getModelThinkingConfig(modelName)`.
3. Implement `executeCascade(ai, cascade, requestParams, options)` with per-model timeout and session memoization (`sessionCurationModel`, `sessionFastModel`).
4. Update `GoogleGenAI` initialization in `getMovieRecommendations` to pass `httpOptions: { timeout: 12000 }`.
5. Update `reRankCandidatesWithGemini`, `parseFreeTextMoodWithGemini`, and `generateWithOmdbFallback` to use `executeCascade`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: PASS

---

### Task 2: Enrich `buildGeminiReRankPrompt` with Personal Vault Grounding & Match Badges

**Files:**
- Modify: `src/services/geminiService.js`
- Test: `tests/pipelineBugs.test.js`

**Interfaces:**
- Signature: `buildGeminiReRankPrompt(profile, mood, topCandidates = [], context = {})`
- Context parameters: `{ watched: Array, watchlist: Array }`

- [ ] **Step 1: Write test in `tests/pipelineBugs.test.js` verifying prompt enrichment**

```javascript
test("buildGeminiReRankPrompt includes anchor films, recent streak, and candidate matchReasons", () => {
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
    assert.match(prompt, /Interstellar \(2014\) \[10\/10\]/);
    assert.match(prompt, /Masterpiece/);
    assert.match(prompt, /High Taste-Twin Match/);
    assert.match(prompt, /Favorite Filmmaker/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL (missing anchor films and matchReasons in prompt)

- [ ] **Step 3: Update `buildGeminiReRankPrompt` in `src/services/geminiService.js`**

1. Extract top 8 anchor films (userRating >= 8) with userNote truncated to 80 chars.
2. Extract recent 3 watched films sorted by `dateWatched`.
3. Include candidate `matchReasons` badges and truncated plot.
4. Pass `{ watched: watchedMovies, watchlist }` from `getMovieRecommendations` into `reRankCandidatesWithGemini`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pipelineBugs.test.js`
Expected: PASS

---

### Task 3: Wire Dual Cascades into `geminiChatService.js` and `geminiExplanationService.js`

**Files:**
- Modify: `src/services/geminiChatService.js`
- Modify: `src/services/geminiExplanationService.js`

- [ ] **Step 1: Update `geminiExplanationService.js`**
- Import `CURATION_MODEL_CASCADE`, `executeCascade`, and `getModelThinkingConfig` from `geminiService.js`.
- Use `CURATION_MODEL_CASCADE` (`gemini-4-argon` first) for deep modal explanations.
- Set `httpOptions: { timeout: 12000 }` on `GoogleGenAI`.

- [ ] **Step 2: Update `geminiChatService.js`**
- Import `FAST_INTERACTIVE_CASCADE`, `executeCascade`, and `getModelThinkingConfig` from `geminiService.js`.
- Use `FAST_INTERACTIVE_CASCADE` (`gemini-3.8-flash` first, then `gemini-3.5-flash-lite`, `gemini-2.5-flash`) for low-latency chat.
- Set `httpOptions: { timeout: 10000 }` on `GoogleGenAI`.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS (all tests pass)

---

### Task 4: Live Verification & Production Build

- [ ] **Step 1: Run live end-to-end verification via Node with `.env`**

```bash
node --env-file=.env -e "import('./src/services/geminiService.js').then(async ({ getMovieRecommendations }) => { const start = Date.now(); const res = await getMovieRecommendations([{ id: 27205, tmdbId: 27205, title: 'Inception', userRating: 10, genre: 'Action, Sci-Fi' }]); console.log('Finished in', ((Date.now() - start)/1000).toFixed(2) + 's, count:', res.recommendations?.length); process.exit(0); });"
```
Expected: Sub-3-second completion with 6 recommendations.

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: 0 errors.
