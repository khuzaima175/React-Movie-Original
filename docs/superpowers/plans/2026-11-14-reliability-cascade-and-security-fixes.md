# Runtime Reliability, Cascade Recovery, Score Calibration & API Proxy Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all runtime failover traps, sticky cascade fallback, match-score clamping, watchlist/timeout inconsistencies, keyless failure, and client-bundle API key exposure across Gemini, TMDB, and OMDb pipelines.

**Architecture:** Harden `geminiService.js` locally so invalid LLM JSON falls back directly to the already-computed calibrated ranker top-6 (preserving `modelInfo` and verified TMDB/embedding candidates), restore primary model recovery after transient cooldowns with unified `getPreferredCascadeModel` persistence reads, unlock keyless local ranking and true `[50, 99]` match scores end-to-end, align watchlist genre slicing and `3.8-flash` timeouts while sharing a single client factory, and introduce serverless `/api/{gemini,tmdb,omdb}` proxies with an automatic browser-vs-local transport layer (`apiTransport.js`). Paired with the companion accuracy plan (`docs/superpowers/plans/2026-11-14-recommendation-accuracy-upgrades.md`).

**Tech Stack:** React 18, Vite 5 (ES modules), Node.js (`node --test`), `@google/genai`, TMDB REST v3, OMDb REST, Vercel Serverless Functions (`api/*.js`).

**Spec:** Verified codebase audit findings + [docs/superpowers/specs/2026-11-09-pipeline-wiring-and-argon-spec.md](../specs/2026-11-09-pipeline-wiring-and-argon-spec.md) (§3 D1 public-bundle key exposure caveat).

## Global Constraints

- Preserve ES module syntax (`"type": "module"`) and keep `npm test` (`node --test`) and `npm run build` green after each task.
- Preserve existing calibrated ranker weight bounds (`repulsion: -1.5`, `negativeKeywordPenalty: -0.5`) and `[50, 99]` `scoreCandidate` range without distortion.
- Zero API keys or fallback secrets may appear in client build artifacts (`build/`) when `VITE_*` client keys are omitted for production hosting; local `.env` dev and Node test runs must continue to work seamlessly.
- Never alter `classifyGeminiError` return enum values (`"quota" | "auth_fatal" | "invalid_config" | "transient"`) or break existing fast-vs-curation telemetry isolation.
- Do not strip `cand.overview || ""` (line 1162 of `src/services/geminiService.js` already uses `cand`, not `candidate`).

## Review Focus

1. Gemini returns truncated or schema-invalid JSON after TMDB + embeddings already succeeded -> `reRankCandidatesWithGemini` must fall back locally to calibrated ranker top-6 with `pipeline: "ranker-fallback"` and valid `modelInfo`, never routing through `generateWithOmdbFallback`.
2. `gemini-4-hydrogen` hits a `30_000 ms` transient timeout, succeeds on `gemini-3.5-flash-lite`, and another call arrives after `31_000 ms` (or after reload past 30s) -> `gemini-4-hydrogen` is retried first; whereas `429 limit: 0 per_day` keeps the working fallback prioritized across reloads within TTL, and `getPreferredCascadeModel` matches `executeCascade` identically.
3. User runs `getMovieRecommendations` without `VITE_GEMINI_KEY` and without `/api/gemini` proxy active while `TMDB_KEY` is present -> returns 6 ranked TMDB recommendations via `pipeline: "ranker-fallback"`, preserving genuine `[50, 69]` scores through `normalizeMatchScore` and `TasteMatchBadge`.
4. Watchlist introduces a 3rd distinct genre ID -> `buildBucketAParams` includes all 3 in `with_genres` matching `extractTasteProfile` and `generateProfileHash`, and `gemini-3.8-flash` gets a `10_000 ms` default attempt timeout.
5. Client or attacker requests `/api/tmdb?path=../../account` or includes `&api_key=spoof` -> `/api/tmdb` rejects disallowed paths with HTTP `400` and strips client `api_key` parameters before server injection.

---

### Task 1: Guard Gemini Parse/Merge Failures Locally & Normalize Fallback `modelInfo` (`Bug 2`)

**Files:**
- Modify: `src/services/geminiService.js:1141-1293, 1299-1377`
- Modify: `src/services/tmdbService.js:18-36` (export dynamic `getTmdbKey()` / `getOmdbKey()` getters alongside constants)
- Test: `tests/pipelineBugs.test.js`

**Interfaces:**
- Consumes: `buildCascadeModelInfo`, `rankCandidatePool`, `sanitizeAndParseJSON`, `mergeGeminiExplanationsWithRanker`, `getFallbackPoster`, `fetchRealOMDBData`, `normalizeMatchScore`, `generateFallbackId`, `getTmdbKey`
- Produces:
  - Exported `getTmdbKey()` and `getOmdbKey()` in `src/services/tmdbService.js` so runtime test env overrides work after module import
  - Internal shared helper `buildRankerFallbackResponse(topCandidates: Array, profile: Object, modelInfo: Object, reason?: string): { tasteProfile: Object, recommendations: Array, modelInfo: Object }` inside `src/services/geminiService.js`
  - Safe parse/merge error boundary inside `reRankCandidatesWithGemini` and `generateWithOmdbFallback`

- [ ] **Step 1: Write failing tests in `tests/pipelineBugs.test.js` covering invalid Gemini JSON and `!response` `modelInfo` parity**

```javascript
test("getMovieRecommendations falls back to local calibrated ranker (never OMDb) when Gemini returns invalid JSON or bad schema", async () => {
  const originalFetch = globalThis.fetch;
  const omdbCalls = [];
  process.env.VITE_GEMINI_KEY = "TEST_KEY";
  process.env.VITE_TMDB_KEY = "TEST_TMDB_KEY";

  const mockCandidates = Array.from({ length: 8 }, (_, i) => ({
    id: 500 + i,
    tmdbId: 500 + i,
    title: `Verified Film ${i}`,
    year: "2022",
    release_date: "2022-05-01",
    overview: `Plot ${i}`,
    genre: "Sci-Fi",
    genre_ids: [878],
    vote_average: 8.0 - i * 0.1,
    vote_count: 1000,
    sourceBucket: "A"
  }));

  const mockAi = {
    models: {
      generateContent: async () => ({
        text: "{truncated invalid json...",
        usageMetadata: { totalTokenCount: 42 }
      })
    }
  };

  globalThis.fetch = async (url) => {
    if (String(url).includes("omdbapi.com")) {
      omdbCalls.push(url);
      return { ok: false, status: 500 };
    }
    return { ok: true, json: async () => ({ results: [] }) };
  };

  try {
    const res = await getMovieRecommendations(
      [{ id: 1, tmdbId: 1, title: "Seed", userRating: 9, tmdbGenreIds: [878] }],
      [],
      null,
      {
        aiClient: mockAi,
        candidates: mockCandidates,
        embeddingIndex: null
      }
    );
    assert.equal(omdbCalls.length, 0, "must NOT route to OMDb fallback on malformed Gemini JSON");
    assert.equal(res.recommendations.length, 6);
    assert.equal(res.recommendations[0].tmdbId, res.recommendations[0].id);
    assert.equal(res.modelInfo?.pipeline, "ranker-fallback");
    assert.equal(res.modelInfo?.isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
    resetSessionWorkingModels();
    resetModelInfoForTests();
  }
});

test("reRankCandidatesWithGemini attaches modelInfo even when executeCascade returns null (!response)", async () => {
  const nullAi = { models: { generateContent: async () => { throw new Error("503 unavailable"); } } };
  const mockCandidates = Array.from({ length: 6 }, (_, i) => ({
    id: 600 + i,
    tmdbId: 600 + i,
    title: `Fallback Film ${i}`,
    year: "2021",
    overview: `Overview ${i}`,
    genre: "Drama",
    genre_ids: [18],
    vote_average: 7.8,
    vote_count: 500
  }));

  const res = await getMovieRecommendations(
    [{ id: 2, tmdbId: 2, title: "Seed 2", userRating: 8, tmdbGenreIds: [18] }],
    [],
    null,
    { aiClient: nullAi, candidates: mockCandidates, embeddingIndex: null }
  );
  assert.equal(res.recommendations.length, 6);
  assert.equal(res.modelInfo?.pipeline, "ranker-fallback");
  assert.equal(res.modelInfo?.model, null);
});
```

(Also adjust `getMovieRecommendations` to accept optional `options.aiClient` and `options.candidates` cleanly for isolated testing—or run through `reRankCandidatesWithGemini`—so tests avoid real network/SDK calls.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL (`SyntaxError` causes TMDB path catch -> `generateWithOmdbFallback`, or missing `modelInfo` / `options.aiClient`).

- [ ] **Step 3: Implement `buildRankerFallbackResponse`, parse/merge local `try/catch`, and `generateWithOmdbFallback` parse validation in `src/services/geminiService.js`**

1. Add helper `buildRankerFallbackResponse(topCandidates, profile, modelInfo, reason = "Selected by the CinemaVault calibrated taste ranker.")` mapping `topCandidates.slice(0, 6)` identically to lines `1143-1166` (keeping `plot: cand.overview || ""`) and attaching `modelInfo`.
2. In `reRankCandidatesWithGemini`:
   - Return `buildRankerFallbackResponse(topCandidates, profile, activeRunModelInfo)` when `!response`.
   - Wrap `sanitizeAndParseJSON(response.text)` and `mergeGeminiExplanationsWithRanker(result, topCandidates, profile)` in a local `try/catch`; on catch, log warning, build `fallbackInfo = buildCascadeModelInfo(CURATION_MODEL_CASCADE, null, "curation", "ranker-fallback", { usageMetadata: response?.usageMetadata ?? null, seq: activeRunModelInfo?.seq || prevSeq })`, update `lastCurationModelInfo = fallbackInfo`, and return `buildRankerFallbackResponse(topCandidates, profile, fallbackInfo)`.
3. In `generateWithOmdbFallback` (line `1257`), wrap `sanitizeAndParseJSON(response.text)` and validate `Array.isArray(result?.recommendations)` throwing a clear `Error("OMDb fallback generation returned invalid JSON or empty recommendations")` if parsing or schema fails.
4. Export `getTmdbKey` and `getOmdbKey` from `src/services/tmdbService.js` and read keys dynamically inside `getMovieRecommendations` (instead of relying solely on frozen import-time `TMDB_KEY`). Support optional dependency injection (`options.aiClient`, `options.candidates`) so `Array.isArray(options.candidates) && options.candidates.length >= 6` enters the embedding/ranker pipeline directly without requiring live TMDB HTTP calls in tests.

- [ ] **Step 4: Run test suite to verify Task 1 passes**

Run: `node --test tests/pipelineBugs.test.js && npm test`
Expected: PASS (all `tests/pipelineBugs.test.js` cases + full suite green).

- [ ] **Step 5: Commit**

```bash
git add src/services/geminiService.js tests/pipelineBugs.test.js
git commit -m "fix(gemini): locally fall back to calibrated ranker on invalid JSON and attach modelInfo"
```

---

### Task 2: Recover Primary Cascade Model After Cooldown Expiry & Unify `getPreferredCascadeModel` (`Bug 1`)

**Files:**
- Modify: `src/services/geminiService.js:261-382, 445-490, 675-695`
- Modify: `tests/geminiDualEngine.test.js:355-435, 563-585`

**Interfaces:**
- Consumes: `isModelInCooldown`, `modelCooldowns`, `getCooldownMsForError`, `readPersistedWorkingModel`, `writePersistedWorkingModel`, `resolveLocalStorage`, `WORKING_MODEL_TTL_MS`
- Produces:
  - Internal shared helper `resolveCascadeOrder(cascade: string[], cascadeType: string, nowMs: number, storage: Storage | null): { candidateModels: string[], allInCooldown: boolean }`
  - `getPreferredCascadeModel(cascade, cascadeType, options)` synchronized with `executeCascade` (reading `storage` via `resolveLocalStorage(options)` + honoring primary recovery)

- [ ] **Step 1: Write failing tests in `tests/geminiDualEngine.test.js` for transient primary recovery and reload/preferred-model parity**

```javascript
test("executeCascade recovers back to primary model (gemini-4-hydrogen) after transient 30s cooldown expires", async () => {
  resetSessionWorkingModels({ clearStorage: true });
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

  // Call 1: hydrogen fails transiently -> 3.5-flash-lite wins and sets transient 30s cooldown
  await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c1" }, { cascadeType: "curation", now: () => fakeNow });
  assert.deepEqual(attempts, ["gemini-4-hydrogen", "gemini-3.5-flash-lite"]);

  // Call 2 (+10s, inside 30s cooldown): uses session working fallback directly
  attempts.length = 0;
  fakeNow += 10_000;
  await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c2" }, { cascadeType: "curation", now: () => fakeNow });
  assert.deepEqual(attempts, ["gemini-3.5-flash-lite"]);

  // Call 3 (+31s total, cooldown expired): retries primary gemini-4-hydrogen and promotes it back
  attempts.length = 0;
  fakeNow += 21_000;
  failPrimary = false;
  await executeCascade(mockAi, CURATION_MODEL_CASCADE, { contents: "c3" }, { cascadeType: "curation", now: () => fakeNow });
  assert.deepEqual(attempts, ["gemini-4-hydrogen"]);
  assert.equal(getSessionCurationModel(), "gemini-4-hydrogen");
});
```

Also update the reload persistence test in `tests/geminiDualEngine.test.js:355-435`:
- In the existing reload test (`L360`), throw `"429 RESOURCE_EXHAUSTED limit: 0 per_day"` when testing that a daily-exhausted primary stays bypassed for 20 minutes across reload, and add an assertion checking `getPreferredCascadeModel(CURATION_MODEL_CASCADE, "curation", { now: () => fakeNow, storage: memStorage }) === "gemini-3.5-flash-lite"` after `resetSessionWorkingModels()` (verifying UI badge agrees with `executeCascade`).
- Assert separately that a transient error persists only until `failNowMs + TRANSIENT_COOLDOWN_MS`, so reloading after 31s probes `gemini-4-hydrogen` first.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: FAIL (`c3` still calls `"gemini-3.5-flash-lite"` instead of `"gemini-4-hydrogen"`, and `getPreferredCascadeModel` returns `"gemini-4-hydrogen"` after reload instead of `"gemini-3.5-flash-lite"`).

- [ ] **Step 3: Implement cooldown-aware primary recovery and shared `resolveCascadeOrder` in `src/services/geminiService.js`**

1. Extend persisted payload in `writePersistedWorkingModel(cascadeType, model, nowMs, storage, primaryMeta = null)` to store `{ model, savedAt: nowMs, primaryBlockedUntilMs: Number, primaryReason: string }` (preserving compatibility when reading legacy objects without `primaryBlockedUntilMs`). Keep a helper `getPrimaryBlockMeta(err, reason, nowMs)` that sets `primaryBlockedUntilMs = nowMs + Math.min(cooldownMs, WORKING_MODEL_TTL_MS)` for persistent blocks (`isDailyQuota` regex `/\blimit\s*:\s*0\b|perday|per_day|requests\s+per\s+day|daily|rpd/i`, `auth_fatal`, `invalid_config`), or `primaryCooldownUntil = nowMs + cooldownMs` for transient/per-minute `quota`.
2. Create `resolveCascadeOrder(cascade, cascadeType, nowMs, storage)`:
   - Filters `available = cascade.filter(m => !isModelInCooldown(m, nowMs))`.
   - If `available.length === 0`, returns the single soonest-expiring model from `modelCooldowns` (`{ candidateModels: [soonestModel], allInCooldown: true }`).
   - Checks `primary = cascade[0]`. If `primary` is in `available` AND neither `isModelInCooldown(primary, nowMs)` nor (`persisted?.primaryBlockedUntilMs > nowMs`), keep `primary` FIRST (do NOT let `sessionActive` or `persistedActive` jump ahead of a recovered `primary`!). When `primary` IS blocked/in-cooldown, promote `sessionActive` (or valid `persistedActive`) to index `0`.
3. Update `executeCascade` (`L354-382`) to consume `resolveCascadeOrder`, and clear any active `primaryBlockedUntilMs` when `cascade[0]` succeeds (`L452`). When `cascade[0]` fails (`L475-490`), track `lastPrimaryFailure` (in-memory + in persisted record when writing fallback success on `L452`).
4. Update `getPreferredCascadeModel(cascade, cascadeType, options)` (`L675-695`) to use `resolveCascadeOrder(cascade, cascadeType, nowMs, resolveLocalStorage(options)).candidateModels[0] ?? null`.

- [ ] **Step 4: Run cascade test suite to verify Task 2 passes**

Run: `node --test tests/geminiDualEngine.test.js && npm test`
Expected: PASS (all existing & new cascade recovery tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/services/geminiService.js tests/geminiDualEngine.test.js
git commit -m "fix(cascade): recover primary model after cooldown expiry and sync persisted model preference"
```

---

### Task 3: Enable Keyless Local Ranker Path (`Bug 5`) & Calibrate Match Score Floor to `50` (`Bug 3`)

**Files:**
- Modify: `src/services/geminiService.js:517-528, 1046-1168, 1299-1377`
- Modify: `src/components/MovieRecommendations.jsx:60-87`
- Test: `tests/pipelineBugs.test.js`, `tests/geminiDualEngine.test.js`

**Interfaces:**
- Consumes: `buildRankerFallbackResponse`, `fetchCandidatePool`, `rankCandidatePool`, `TMDB_KEY`, `createGeminiClient`
- Produces:
  - `normalizeMatchScore(val: number | string): number` strictly in `[50, 99]`
  - `getMovieRecommendations(watchedMovies, watchlist, onProgress, options)` supporting keyless local ranking (`ai = null`) whenever `TMDB_KEY` or `options.candidates` is available

- [ ] **Step 1: Write failing tests in `tests/pipelineBugs.test.js` for keyless local ranking (`Bug 5`) and `[50, 69]` score preservation (`Bug 3`)**

```javascript
test("normalizeMatchScore preserves calibrated scores between 50 and 69 without clamping up to 70", () => {
  assert.equal(normalizeMatchScore(55), 55);
  assert.equal(normalizeMatchScore(50), 50);
  assert.equal(normalizeMatchScore(69), 69);
  assert.equal(normalizeMatchScore(42), 50);
  assert.equal(normalizeMatchScore(104), 99);
  assert.equal(normalizeMatchScore(0.62), 62);
  assert.equal(normalizeMatchScore(0.94), 94);
  assert.equal(normalizeMatchScore(NaN), 88);
});

test("getMovieRecommendations completes via local ranker when VITE_GEMINI_KEY is unset and candidates or TMDB exist", async () => {
  const prevGeminiKey = process.env.VITE_GEMINI_KEY;
  delete process.env.VITE_GEMINI_KEY;

  try {
    const candidates = Array.from({ length: 6 }, (_, i) => ({
      id: 700 + i,
      tmdbId: 700 + i,
      title: `Keyless Film ${i}`,
      year: "2019",
      release_date: "2019-06-01",
      overview: `Plot ${i}`,
      genre: "Drama",
      genre_ids: [18],
      vote_average: 7.5 - i * 0.2,
      vote_count: 600
    }));

    const res = await getMovieRecommendations(
      [{ id: 10, tmdbId: 10, title: "Watched", userRating: 9, tmdbGenreIds: [18] }],
      [],
      null,
      { candidates, embeddingIndex: null }
    );
    assert.equal(res.recommendations.length, 6);
    assert.equal(res.modelInfo?.pipeline, "ranker-fallback");
  } finally {
    if (prevGeminiKey !== undefined) process.env.VITE_GEMINI_KEY = prevGeminiKey;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL (`normalizeMatchScore(55)` returns `70`; `getMovieRecommendations` throws `"Gemini API Key is missing..."`).

- [ ] **Step 3: Implement `[50, 99]` calibration and keyless ranker path across `geminiService.js` and `MovieRecommendations.jsx`**

1. Update `normalizeMatchScore` (`src/services/geminiService.js:517-528`):
   - Keep `isNaN(n) || n <= 0` returning `88` and `n <= 5` (legacy 5-star scores) returning `88`.
   - For `0 < n <= 1.0`, scale `n <= 0.1 ? n * 1000 : n * 100` clamped to `[50, 99]`.
   - For `n > 5`, return `Math.min(99, Math.max(50, Math.round(n)))` (floor `50`, matching `scoreCandidate` in `src/services/rankerService.js:131`).
2. Update `TasteMatchBadge` in `src/components/MovieRecommendations.jsx:60-71`: import `normalizeMatchScore` from `../services/geminiService.js` and compute `const normalizedScore = normalizeMatchScore(score);`, removing the duplicated `Math.max(70, ...)` block. Keep `tier-indigo` styling for scores `< 78` (`[50, 77]`).
3. Update `getMovieRecommendations` (`src/services/geminiService.js:1299-1377`):
   - Resolve `apiKey` dynamically (`import.meta.env?.VITE_GEMINI_KEY || globalThis.process?.env?.VITE_GEMINI_KEY`) and `hasTmdb = Boolean(getTmdbKey() || (Array.isArray(options.candidates) && options.candidates.length >= 6))`. Only throw immediately when NO `options.aiClient` AND NO Gemini key/proxy AND `!hasTmdb`.
   - Set `const ai = options.aiClient || (apiKey ? createGeminiClient(apiKey, options) : null);` (before Task 4 extracts `createGeminiClient`, construct `new GoogleGenAI(...)`).
   - In `reRankCandidatesWithGemini`: after `rankCandidatePool(...)`, if `!ai`, skip `executeCascade` and immediately return `buildRankerFallbackResponse(topCandidates, profile, buildCascadeModelInfo(CURATION_MODEL_CASCADE, null, "curation", "ranker-fallback"))`.
   - In TMDB failure fallback at `L1370-1376`: if `!ai`, throw explicit `Error("Unable to retrieve TMDB candidates and no Gemini key is configured for generative fallback.")` rather than calling `generateWithOmdbFallback(null, ...)`.
   - Update comment at `L514` (`(50 - 99)`).

- [ ] **Step 4: Run test suite and build check**

Run: `node --test tests/pipelineBugs.test.js tests/rankerService.test.js && npm test`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/services/geminiService.js src/components/MovieRecommendations.jsx tests/pipelineBugs.test.js
git commit -m "fix(ranker): enable keyless local ranker path and align matchScore floor to 50"
```

---

### Task 4: Align Watchlist Genre Slice (`3`), Cascade Timeout (`3.8-flash`), & Shared Client Factory

**Files:**
- Modify: `src/services/tmdbService.js:386-390`
- Modify: `src/services/geminiService.js:98-105` (plus exported `createGeminiClient`)
- Modify: `src/services/geminiChatService.js:1-15`
- Modify: `src/services/geminiExplanationService.js:1-18`
- Modify: `tests/pipelineBugs.test.js`, `tests/geminiDualEngine.test.js:483-490`

**Interfaces:**
- Produces:
  - Exported `createGeminiClient(apiKey: string, options?: Object): GoogleGenAI` in `src/services/geminiService.js`
  - `buildBucketAParams` including top `3` `profile.watchlistGenreIds`
  - `getDefaultAttemptTimeoutMs("gemini-3.8-flash") === 10000`

- [ ] **Step 1: Write failing tests in `tests/pipelineBugs.test.js` and `tests/geminiDualEngine.test.js`**

```javascript
// tests/pipelineBugs.test.js
test("buildBucketAParams includes all 3 watchlistGenreIds matching extractTasteProfile and generateProfileHash", () => {
  const params = buildBucketAParams(
    {
      lovedGenreIds: [878],
      hatedKeywordIds: [],
      topCastIds: [],
      watchlistGenreIds: [18, 80, 9648]
    },
    "any",
    { userRegion: "US", userProviders: [] }
  );
  assert.equal(params.get("with_genres"), "878|18|80|9648");
});
```

In `tests/geminiDualEngine.test.js:488`, update expected `getDefaultAttemptTimeoutMs("gemini-3.8-flash")` from `5000` to `10000` (empirical `phaseG2_results.json` runs timed out at `8000ms`), and add assertion verifying `createGeminiClient("DUMMY_KEY")?.models?.generateContent` exists cleanly.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/pipelineBugs.test.js tests/geminiDualEngine.test.js`
Expected: FAIL (`with_genres` returns `"878|18|80"`, `getDefaultAttemptTimeoutMs("gemini-3.8-flash")` returns `5000`, `createGeminiClient` is not exported).

- [ ] **Step 3: Apply fixes in `tmdbService.js`, `geminiService.js`, `geminiChatService.js`, and `geminiExplanationService.js`**

1. In `src/services/tmdbService.js:388`, change `...(profile.watchlistGenreIds || []).slice(0, 2)` to `...(profile.watchlistGenreIds || []).slice(0, 3)`.
2. In `src/services/geminiService.js:103`, update `if (lowerModel.includes("gemini-3.8-flash")) return 10000;`.
3. Export `createGeminiClient(apiKey, options = {})` from `src/services/geminiService.js` wrapping `new GoogleGenAI({ apiKey, httpOptions: { timeout: options.timeoutMs ?? HYDROGEN_TIMEOUT_MS } })`. Replace direct `new GoogleGenAI(...)` instantiation in `geminiService.js`, `geminiChatService.js:11`, and `geminiExplanationService.js:14` with `createGeminiClient(...)`.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/pipelineBugs.test.js tests/geminiDualEngine.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/tmdbService.js src/services/geminiService.js src/services/geminiChatService.js src/services/geminiExplanationService.js tests/pipelineBugs.test.js tests/geminiDualEngine.test.js
git commit -m "fix(retrieval,cascade): use top 3 watchlist genres, bump 3.8-flash timeout to 10s, share Gemini client factory"
```

---

### Task 5: Add Serverless API Proxies (`/api/{gemini,tmdb,omdb}`) & Zero-Bundle-Secret Client Transport

**Files:**
- Create: `src/services/apiTransport.js`
- Create: `api/gemini.js`
- Create: `api/tmdb.js`
- Create: `api/omdb.js`
- Create: `vercel.json`
- Modify: `src/services/geminiService.js`
- Modify: `src/services/tmdbService.js`
- Modify: `src/services/geminiChatService.js`
- Modify: `src/services/geminiExplanationService.js`
- Modify: `src/components/SearchModal.jsx`
- Modify: `src/components/MovieDetails.jsx`
- Modify: `src/components/BackupManagerModal.jsx`
- Modify: `src/components/AIChat.jsx`
- Modify: `.env.example`
- Test: `tests/apiProxy.test.js`

**Interfaces:**
- Consumes: `createGeminiClient` (extended to return proxy-backed `{ models: { generateContent } }` when running in browser without `VITE_GEMINI_KEY` and proxy isn't explicitly disabled)
- Produces:
  - `src/services/apiTransport.js`:
    - `isBrowserRuntime(): boolean`
    - `fetchTmdbJson(path: string, queryParams?: Record<string, string | number>, options?: Object): Promise<Object | null>`
    - `fetchOmdbJson(queryParams?: Record<string, string | number>, options?: Object): Promise<Object | null>`
    - `createProxyGeminiClient(options?: Object): { models: { generateContent: Function } }`
  - Serverless Node handlers `export default async function handler(req, res)` in `api/gemini.js`, `api/tmdb.js`, `api/omdb.js`

- [ ] **Step 1: Write failing unit tests in `tests/apiProxy.test.js` covering proxy routing and handler validation**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { fetchTmdbJson, fetchOmdbJson, createProxyGeminiClient } from "../src/services/apiTransport.js";
import tmdbHandler from "../api/tmdb.js";
import omdbHandler from "../api/omdb.js";
import geminiHandler from "../api/gemini.js";

function createMockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

test("api/tmdb handler rejects traversal / disallowed paths and injects server TMDB_API_KEY", async () => {
  process.env.TMDB_API_KEY = "SERVER_TMDB_SECRET";
  const badRes = createMockRes();
  await tmdbHandler({ method: "GET", query: { path: "/3/../../account", api_key: "spoof" } }, badRes);
  assert.equal(badRes.statusCode, 400);

  let forwardedUrl = "";
  const okRes = createMockRes();
  await tmdbHandler(
    {
      method: "GET",
      query: { path: "/3/discover/movie", sort_by: "popularity.desc", api_key: "spoof" },
      fetchFn: async (url) => {
        forwardedUrl = String(url);
        return { ok: true, status: 200, json: async () => ({ results: [{ id: 10 }] }) };
      }
    },
    okRes
  );
  assert.equal(okRes.statusCode, 200);
  assert.match(forwardedUrl, /api_key=SERVER_TMDB_SECRET/);
  assert.doesNotMatch(forwardedUrl, /spoof/);
});

test("fetchTmdbJson and createProxyGeminiClient route via /api/* when client VITE keys are absent", async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET" });
    if (String(url).startsWith("/api/gemini")) {
      return { ok: true, status: 200, json: async () => ({ text: "{\"ok\":true}", usageMetadata: {} }) };
    }
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };

  await fetchTmdbJson("/3/search/movie", { query: "Solaris" }, { apiKey: "", forceProxy: true, fetchFn: mockFetch });
  await fetchOmdbJson({ t: "Solaris" }, { apiKey: "", forceProxy: true, fetchFn: mockFetch });
  const proxyAi = createProxyGeminiClient({ fetchFn: mockFetch });
  const gRes = await proxyAi.models.generateContent({ model: "gemini-3.5-flash-lite", contents: "hi" });

  assert.equal(calls[0].url.startsWith("/api/tmdb?"), true);
  assert.equal(calls[1].url.startsWith("/api/omdb?"), true);
  assert.equal(calls[2].url, "/api/gemini");
  assert.equal(calls[2].method, "POST");
  assert.equal(gRes.text, "{\"ok\":true}");
});

test("api/gemini handler rejects GET requests and non-model strings", async () => {
  const resGet = createMockRes();
  await geminiHandler({ method: "GET", body: {} }, resGet);
  assert.equal(resGet.statusCode, 405);

  const resBadModel = createMockRes();
  await geminiHandler({ method: "POST", body: { model: "bad model/path", contents: "x" } }, resBadModel);
  assert.equal(resBadModel.statusCode, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/apiProxy.test.js`
Expected: FAIL (missing `src/services/apiTransport.js` and `api/*.js`).

- [ ] **Step 3: Implement `src/services/apiTransport.js`, `api/{gemini,tmdb,omdb}.js`, `vercel.json`, and migrate direct key URLs**

1. Create `src/services/apiTransport.js`:
   - `fetchTmdbJson(path, queryParams, options)`: uses direct `https://api.themoviedb.org${path}` when a non-empty `apiKey` is provided (`options.apiKey ?? resolveTmdbKey()`), otherwise falls back to `/api/tmdb?path=...` when `options.forceProxy || isBrowserRuntime()`.
   - `fetchOmdbJson(queryParams, options)`: direct `https://www.omdbapi.com/` when `apiKey` exists, otherwise `/api/omdb?...`.
   - `createProxyGeminiClient(options)`: returns `{ models: { generateContent: ({ model, contents, config }) => ... } }` that POSTs JSON `{ model, contents, config }` (stripping `abortSignal` before JSON serialization, forwarding `signal: config?.abortSignal` to `fetchFn`) to `/api/gemini`.
2. Create `api/tmdb.js`, `api/omdb.js`, `api/gemini.js`:
   - Enforce HTTP methods (`GET` for TMDB/OMDb, `POST` for Gemini) and path/model allowlists (`^\/3\/(discover\/movie|search\/movie|movie\/\d+(?:\/(?:keywords|credits|watch\/providers|videos|release_dates|external_ids))?|find\/[a-zA-Z0-9_-]+)$` for TMDB; `^[a-z0-9._-]+$` for Gemini model names).
   - Read server-only env vars (`process.env.TMDB_API_KEY || process.env.VITE_TMDB_KEY`, etc.), strip any client-sent `api_key`/`apikey`, forward upstream errors cleanly without echoing key strings. Support optional `req.fetchFn` / `req.aiFactory` injection for pure unit tests.
3. Update `createGeminiClient` and `hasGeminiBackend(options)` in `src/services/geminiService.js`: use direct `GoogleGenAI` when `apiKey` exists, else `createProxyGeminiClient()` when running in a browser (keeping Node/keyless CLI path calling local ranker unless `options.useProxy === true`! Double check Task 3 keyless test: in Node without `VITE_GEMINI_KEY` and without `options.useProxy`, `hasGeminiBackend` is `false` so Node/keyless callers test the deterministic local ranker path!).
4. Replace direct external `api.themoviedb.org` / `omdbapi.com` `fetch` strings in `src/services/tmdbService.js`, `src/services/geminiService.js`, `src/components/SearchModal.jsx`, `src/components/MovieDetails.jsx`, `src/components/BackupManagerModal.jsx`, and `src/components/AIChat.jsx` with `fetchTmdbJson` / `fetchOmdbJson`.
5. Add `vercel.json` excluding `/api/(.*)` and `/models/(.*)` from SPA `index.html` rewrites and setting `Content-Type: application/octet-stream` for `/models/*.bin`. Update `.env.example` clearly marking server-side keys vs local-dev `VITE_*` keys (removing any hardcoded demo OMDb key from `.env.example`!).

- [ ] **Step 4: Run full test suite and production build check**

Run: `npm test && npm run build`
Expected: PASS (all tests pass, `npm run build` exits 0 with zero `VITE_GEMINI_KEY` / `TMDB` secret leakage when built without `.env`).

- [ ] **Step 5: Commit**

```bash
git add src/services/apiTransport.js api/gemini.js api/tmdb.js api/omdb.js vercel.json src/services/geminiService.js src/services/tmdbService.js src/services/geminiChatService.js src/services/geminiExplanationService.js src/components/SearchModal.jsx src/components/MovieDetails.jsx src/components/BackupManagerModal.jsx src/components/AIChat.jsx .env.example tests/apiProxy.test.js
git commit -m "feat(security): add serverless /api/{gemini,tmdb,omdb} proxy transport and zero-secret browser routing"
```
