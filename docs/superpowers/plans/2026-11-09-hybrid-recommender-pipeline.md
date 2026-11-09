# Hybrid Movie Recommender & Evaluation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the heuristic 20-candidate TMDB/Gemini recommender with an offline-evaluated, 300-candidate hybrid pipeline using z-scored time-decayed user profiles, client-side float16 collaborative + content embeddings, a calibrated logistic ranker, and Gemini restricted to explanations, query parsing, and top-30 diversity selection.

**Architecture:** A three-stage client-side recommender backed by an offline evaluation harness. Stage 1 computes a user embedding $u = \sum w_i e_i / \sum |w_i|$ from z-scored, time-decayed ratings against a static 64-dim float16 MovieLens/TMDB embedding index and merges nearest neighbors with fixed TMDB discovery buckets to form a ~300-candidate pool. Stage 2 blends collaborative and content embeddings for cold/new releases, and Stage 3 ranks all candidates via a calibrated logistic regression model before passing the top 30 to Gemini strictly for diversity pruning (down to 6) and natural-language explanations.

**Tech Stack:** ES Modules (React 18 / Vite 5), Node.js built-in test runner (`node --test`), `TypedArray` (`Float32Array`, `Uint16Array`, `DataView`) for zero-dependency binary float16 vector math, `@google/genai`, Python 3 (`numpy`, `scipy`, `pandas`, `scikit-learn`) for the offline Colab training script.

**Spec:** `docs/superpowers/specs/2026-11-09-hybrid-recommender-design.md`

## Global Constraints

- Zero runtime ML framework dependencies in the browser bundle; all vector math, float16 decoding, and logistic inference must use native JS `TypedArray` and `DataView`.
- All service modules (`src/services/*.js`) must guard `import.meta.env` with `import.meta.env?.VITE_* || process.env.VITE_* || ""` so they execute unmodified under `node --test`.
- Embedding binary format (`CVEM` v1) must stay $\le 3\text{ MB}$ at 20,000 items $\times$ 64 dimensions in IEEE-754 float16.
- Gemini must never invent or overwrite `matchScore`; `matchScore` is deterministically computed by the calibrated ranker probability $p \in (0, 1)$ mapped to `[50, 99]`.
- Maintain non-commercial MovieLens dataset compliance: raw MovieLens ratings are never shipped in the repo, only derived TMDB-keyed embeddings and ranker weights.

## Review Focus

1. **Zero-variance rating history (user rated every film the exact same score, e.g. all `8/10`):** Z-score denominator $\sigma = 0$ must not produce `NaN` or `Infinity`; clamp $\sigma_{\text{eff}} = \max(\sigma, 0.5)$ and assign a small positive baseline weight $+0.5$ when all ratings are equal and $\ge 7$ (or $-0.5$ when $\le 4$).
2. **Undated or bulk-imported films (`dateWatched` missing, or `isBulkImported: true`):** Must not fall back to `Date.now()` ($\Delta_{\text{days}} = 0$); must use `bulkPriorDays = 180` so old backlog imports do not overpower genuinely recent watches.
3. **Future timestamps (`dateWatched` in the future due to timezone/clock skew):** $\Delta_{\text{days}}$ must clamp at `0` so $\exp(-\lambda \Delta_{\text{days}})$ never exceeds `1.0`.
4. **All rated films absent from the static embedding index (e.g. brand-new indie releases):** `computeUserEmbedding` must return `null` when $\sum |w_i| = 0$ rather than a `Float32Array` of `NaN`s, and retrieval must gracefully fall back to expanded TMDB discovery buckets.
5. **In-place array mutation in `generateProfileHash`:** Calling `generateProfileHash(profile, watchlistGenres, mood, providers)` must never mutate `profile.lovedGenreIds`, `profile.hatedKeywordIds`, `watchlistGenres`, or `providers` in place.

---

## File Map

- **Create:** `src/services/scoringUtils.js` — Z-scored rating normalization, bulk-import-aware exponential time decay, and Bayesian rating shrinkage.
- **Create:** `tests/scoringUtils.test.js` — Unit tests for z-score, zero-variance guard, bulk-import decay prior, and future-date clamping.
- **Create:** `src/services/evalHarness.js` — Offline evaluation harness (`temporalHoldoutSplit`, `computeRecallAtK`, `computeNDCGAtK`, `computeILD`, `computeNovelty`, `gridSearchHyperparams`).
- **Create:** `tests/evalHarness.test.js` — Unit tests for IR metrics, temporal holdout splitting, and hyperparameter grid search.
- **Modify:** `src/services/tmdbService.js` — Node-safe env getters, fix `hatedKeywordIds` sort-before-slice bug, fix `with_cast` pipe `|` OR operator, integrate `computeZScoredWeights`, and support 300-candidate multi-page retrieval.
- **Modify:** `src/services/geminiService.js` — Node-safe env getters, non-mutating `generateProfileHash` (`v4_`) including `anchorTmdbId`, `topCrewMemberId`, and `topCastIds`, deterministic ranker integration, Gemini prompt restricted to explanations + top-30 diversity selection, and `parseFreeTextMoodWithGemini`.
- **Create:** `tests/pipelineBugs.test.js` — Regression tests for `hatedKeywordIds` ordering, `generateProfileHash` immutability & cache invalidation on new 10/10, and `with_cast` pipe separator.
- **Create:** `src/services/embeddingService.js` — Float16 binary decoder (`CVEM` format), L2 normalization, user vector synthesis $u = \sum w_i e_i / \sum |w_i|$, content/collaborative vector blending, and cosine nearest-neighbor search.
- **Create:** `tests/embeddingService.test.js` — Unit tests for float16 encoding/decoding, negative-weight repulsion, cold-start/missing-ID null safety, and cosine top-K retrieval.
- **Create:** `src/services/rankerService.js` — Candidate feature extraction, calibrated logistic scoring (`scoreCandidate`), and 300-to-30 candidate pool ranking (`rankCandidatePool`).
- **Create:** `tests/rankerService.test.js` — Unit tests for feature extraction, probability calibration, and monotonic ranking.
- **Create:** `src/services/feedbackService.js` — Pure helper `normalizeFeedbackEvent` for 500-event feedback log with `tmdbId`, `action`, `userRating`, `matchScoreAtTime`, and `sourceBucket` conversion tracking.
- **Modify:** `src/context/AppContext.jsx` — Wire `normalizeFeedbackEvent` into `addAiFeedback` and auto-log `"rated"` conversion when a recommended movie is added to `watched`.
- **Create:** `tests/feedbackLogging.test.js` — Unit tests for feedback event normalization and watchlist-to-rated conversion linking.
- **Create:** `scripts/colab_train_embeddings.py` — Standalone Python training pipeline for MovieLens 25M/32M TruncatedSVD/ALS embeddings (`item_embeddings_f16.bin`) and logistic ranker weights (`ranker_weights.json`).
- **Modify:** `package.json` — Add `"test": "node --test tests/*.test.js"` script.

---

### Task 1: Z-Scored Rating Weights & Bulk-Import Decay (`scoringUtils.js`)

**Files:**
- Create: `src/services/scoringUtils.js`
- Modify: `package.json`
- Test: `tests/scoringUtils.test.js`

**Interfaces:**
- Consumes: Raw movie objects `{ id?, tmdbId?, imdbID?, userRating, dateWatched?, addedAt?, isBulkImported? }[]`
- Produces:
  - `computeUserRatingStats(watched) -> { mean: number, std: number, count: number }`
  - `computeZScoredWeights(watched, options?: { lambda?: number, now?: number, minStd?: number, bulkPriorDays?: number }) -> Array<{ movie: object, rating: number, zScore: number, daysSince: number, timeDecay: number, weight: number }>`
  - `computeBayesianScore(voteAverage: number, voteCount: number, m?: number, C?: number) -> number`

- [ ] **Step 1: Add `"test": "node --test tests/*.test.js"` to `package.json` and write the failing test in `tests/scoringUtils.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeUserRatingStats,
  computeZScoredWeights,
  computeBayesianScore
} from "../src/services/scoringUtils.js";

test("computeZScoredWeights normalizes harsh vs generous raters and assigns negative zScore to 4-5 ratings", () => {
  const now = Date.UTC(2026, 10, 9);
  const watched = [
    { id: "m1", userRating: 9, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "m2", userRating: 8, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "m3", userRating: 7, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "m4", userRating: 4, dateWatched: "2026-11-09T00:00:00Z" }
  ];
  const res = computeZScoredWeights(watched, { lambda: 0.002, now });
  const m1 = res.find(r => r.movie.id === "m1");
  const m4 = res.find(r => r.movie.id === "m4");
  assert.ok(m1.zScore > 0.9, `expected m1 zScore > 0.9, got ${m1.zScore}`);
  assert.ok(m4.zScore < -1.0, `expected m4 zScore < -1.0, got ${m4.zScore}`);
  assert.equal(m1.timeDecay, 1);
  assert.equal(m1.weight, m1.zScore);
});

test("computeZScoredWeights handles zero-variance ratings without NaN and clamps future dates", () => {
  const now = Date.UTC(2026, 10, 9);
  const watched = [
    { id: "a", userRating: 8, dateWatched: "2027-01-01T00:00:00Z" },
    { id: "b", userRating: 8, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "c", userRating: 8, dateWatched: "2026-11-09T00:00:00Z" }
  ];
  const res = computeZScoredWeights(watched, { lambda: 0.002, now });
  for (const item of res) {
    assert.ok(Number.isFinite(item.weight), "weight must be finite");
    assert.equal(item.daysSince, 0, "future dates must clamp daysSince to 0");
    assert.equal(item.zScore, 0.5, "equal high ratings (>=7) get +0.5 baseline zScore");
  }
});

test("computeZScoredWeights applies bulkPriorDays=180 when dateWatched is missing or isBulkImported=true", () => {
  const now = Date.UTC(2026, 10, 9);
  const watched = [
    { id: "recent", userRating: 9, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "backlog", userRating: 9, addedAt: "2026-11-09T00:00:00Z", isBulkImported: true },
    { id: "undated", userRating: 5 }
  ];
  const res = computeZScoredWeights(watched, { lambda: 0.002, now, bulkPriorDays: 180 });
  const recent = res.find(r => r.movie.id === "recent");
  const backlog = res.find(r => r.movie.id === "backlog");
  const undated = res.find(r => r.movie.id === "undated");
  assert.equal(recent.daysSince, 0);
  assert.equal(backlog.daysSince, 180);
  assert.equal(undated.daysSince, 180);
  assert.ok(recent.weight > backlog.weight);
});

test("computeBayesianScore shrinks low-vote movies toward global mean C=7.0", () => {
  const lowVoteTen = computeBayesianScore(10.0, 10, 500, 7.0);
  const highVoteEight = computeBayesianScore(8.2, 5000, 500, 7.0);
  assert.ok(highVoteEight > lowVoteTen);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scoringUtils.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/services/scoringUtils.js`

- [ ] **Step 3: Implement `src/services/scoringUtils.js`**

Implement `computeUserRatingStats`, `computeZScoredWeights`, and `computeBayesianScore`:
- Filter valid rated movies (`Number(m.userRating || m.UserRating || 0) > 0`).
- When `rated.length < 3`, compute `zScore = (rating - 5.5) / 2.0`.
- When `rated.length >= 3` and population standard deviation `rawStd === 0`, set `zScore = rating >= 7 ? 0.5 : rating <= 4 ? -0.5 : 0`. Otherwise `std = Math.max(rawStd, minStd)` (default `minStd = 0.5`) and `zScore = (rating - mean) / std`.
- For date decay: if `movie.isBulkImported || !movie.dateWatched`, set `daysSince = bulkPriorDays` (default `180`). Otherwise parse `Date.parse(movie.dateWatched)`; if `NaN`, use `bulkPriorDays`; else `daysSince = Math.max(0, (now - parsedMs) / 86400000)`.
- `timeDecay = Math.exp(-lambda * daysSince)` and `weight = zScore * timeDecay`.
- `computeBayesianScore(voteAverage, voteCount, m = 500, C = 7.0)` returns `(voteCount / (voteCount + m)) * voteAverage + (m / (voteCount + m)) * C`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scoringUtils.test.js`
Expected: PASS (4/4 tests passing)

- [ ] **Step 5: Commit**

```bash
git add package.json src/services/scoringUtils.js tests/scoringUtils.test.js
git commit -m "feat(scoring): add z-scored rating weights, bulk-import decay prior, and bayesian score"
```

---

### Task 2: Offline Evaluation Harness & Grid Search (`evalHarness.js`)

**Files:**
- Create: `src/services/evalHarness.js`
- Test: `tests/evalHarness.test.js`

**Interfaces:**
- Consumes: `computeZScoredWeights` from `src/services/scoringUtils.js`
- Produces:
  - `temporalHoldoutSplit(watched: Array, holdoutPositiveCount?: number, minPositiveRating?: number) -> { trainWatched: Array, holdoutPositives: Set<string>, holdoutRelevance: Map<string, number> }`
  - `computeRecallAtK(recommendedIds: string[], holdoutPositives: Set<string>, k?: number) -> number`
  - `computeNDCGAtK(recommendedIds: string[], holdoutRelevance: Map<string, number>, k?: number) -> number`
  - `computeILD(recommendedIds: number[], embeddingLookup: (tmdbId: number) => Float32Array | null) -> number`
  - `computeNovelty(recommendedItems: Array<{ id?: string|number, popularity?: number, vote_count?: number }>, maxPopularity?: number) -> number`
  - `gridSearchHyperparams(watched: Array, candidateCatalog: Array, paramGrid: { lambdas: number[], anchorCutoffs: number[], bulkPriorDaysList?: number[] }) -> { bestParams: object, bestMetrics: { recallAt20: number, ndcgAt10: number, novelty: number }, leaderboard: Array }`

- [ ] **Step 1: Write the failing test in `tests/evalHarness.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  temporalHoldoutSplit,
  computeRecallAtK,
  computeNDCGAtK,
  computeILD,
  computeNovelty,
  gridSearchHyperparams
} from "../src/services/evalHarness.js";

test("temporalHoldoutSplit holds out the last N liked films chronologically", () => {
  const watched = [
    { id: "1", userRating: 9, dateWatched: "2026-01-01" },
    { id: "2", userRating: 8, dateWatched: "2026-02-01" },
    { id: "3", userRating: 5, dateWatched: "2026-03-01" },
    { id: "4", userRating: 10, dateWatched: "2026-04-01" },
    { id: "5", userRating: 8, dateWatched: "2026-05-01" }
  ];
  const split = temporalHoldoutSplit(watched, 2, 8);
  assert.deepEqual(split.trainWatched.map(m => m.id), ["1", "2", "3"]);
  assert.deepEqual([...split.holdoutPositives], ["4", "5"]);
  assert.equal(split.holdoutRelevance.get("4"), 10);
});

test("computeRecallAtK and computeNDCGAtK match exact IR definitions", () => {
  const positives = new Set(["m2", "m5"]);
  const relevance = new Map([["m2", 10], ["m5", 8]]);
  const recs = ["m1", "m2", "m3", "m4", "m5"];

  assert.equal(computeRecallAtK(recs, positives, 2), 0.5);
  assert.equal(computeRecallAtK(recs, positives, 5), 1.0);

  const ndcg = computeNDCGAtK(recs, relevance, 5);
  assert.ok(ndcg > 0.5 && ndcg < 1.0, `expected 0.5 < ndcg < 1.0, got ${ndcg}`);
  assert.equal(computeNDCGAtK(["m2", "m5", "m1"], relevance, 3), 1.0);
});

test("computeILD and computeNovelty measure diversity and non-blockbuster novelty", () => {
  const vecs = new Map([
    [1, new Float32Array([1, 0])],
    [2, new Float32Array([0, 1])]
  ]);
  const ild = computeILD([1, 2], id => vecs.get(id) || null);
  assert.ok(Math.abs(ild - 1.0) < 1e-6, `orthogonal unit vectors have ILD=1.0, got ${ild}`);

  const blockbusterNovelty = computeNovelty([{ id: 1, vote_count: 9000 }], 10000);
  const indieNovelty = computeNovelty([{ id: 2, vote_count: 100 }], 10000);
  assert.ok(indieNovelty > blockbusterNovelty);
});

test("gridSearchHyperparams evaluates parameter grid on temporal holdout and returns bestParams", () => {
  const watched = [
    { id: "1", tmdbId: 1, userRating: 9, tmdbGenreIds: [878], dateWatched: "2026-01-01" },
    { id: "2", tmdbId: 2, userRating: 9, tmdbGenreIds: [878], dateWatched: "2026-02-01" },
    { id: "3", tmdbId: 3, userRating: 4, tmdbGenreIds: [27], dateWatched: "2026-03-01" },
    { id: "4", tmdbId: 4, userRating: 9, tmdbGenreIds: [878], dateWatched: "2026-04-01" },
    { id: "5", tmdbId: 5, userRating: 8, tmdbGenreIds: [878], dateWatched: "2026-05-01" }
  ];
  const catalog = [
    { id: "4", tmdbId: 4, tmdbGenreIds: [878], vote_average: 8.5, vote_count: 600 },
    { id: "5", tmdbId: 5, tmdbGenreIds: [878], vote_average: 8.1, vote_count: 400 },
    { id: "6", tmdbId: 6, tmdbGenreIds: [27], vote_average: 7.9, vote_count: 1000 }
  ];
  const result = gridSearchHyperparams(watched, catalog, {
    lambdas: [0.001, 0.002, 0.005],
    anchorCutoffs: [8, 9],
    holdoutSize: 2
  });
  assert.ok(result.bestParams);
  assert.equal(result.bestMetrics.recallAt20, 1.0);
  assert.equal(result.leaderboard.length, 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/evalHarness.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/services/evalHarness.js`

- [ ] **Step 3: Implement `src/services/evalHarness.js`**

Implement the evaluation harness functions:
- `temporalHoldoutSplit(watched, holdoutPositiveCount = 10, minPositiveRating = 8)`: sort movies ascending by `Date.parse(m.dateWatched || m.addedAt || 0)`. Walk backwards from the end collecting items with `rating >= minPositiveRating` until `holdoutPositiveCount` is reached; split at that cutoff index so `trainWatched` has strictly earlier items and `holdoutPositives` has the held-out liked IDs (`String(m.tmdbId || m.imdbID || m.id)`).
- `computeRecallAtK(recommendedIds, holdoutPositives, k = 20)`: `hits / holdoutPositives.size`.
- `computeNDCGAtK(recommendedIds, holdoutRelevance, k = 10)`: gain $g_i = 2^{\text{rel}_i - 7} - 1$ for $\text{rel}_i \ge 8$ (0 otherwise), discounted by $\log_2(i + 2)$, normalized by ideal DCG@K.
- `computeILD(recommendedIds, embeddingLookup)`: mean pairwise $1 - \text{dot}(u, v)$ across all pairs in `recommendedIds` that have non-null unit vectors.
- `computeNovelty(recommendedItems, maxPopularity = 25000)`: mean $-\log_2(\text{clamp}((\text{vote\_count} || \text{popularity} || 50) / \text{maxPopularity}, 10^{-4}, 0.999))$.
- `gridSearchHyperparams(watched, candidateCatalog, { lambdas, anchorCutoffs, bulkPriorDaysList = [180], holdoutSize = 10 })`: runs `temporalHoldoutSplit(watched, holdoutSize)`, scores `candidateCatalog` using `computeZScoredWeights` with each `(lambda, anchorCutoff, bulkPriorDays)` tuple, ranks candidates, and sorts leaderboard by `ndcgAt10` (tie-broken by `recallAt20` and `novelty`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/evalHarness.test.js`
Expected: PASS (4/4 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/services/evalHarness.js tests/evalHarness.test.js
git commit -m "feat(eval): add temporal holdout evaluation harness and hyperparameter grid search"
```

---

### Task 3: Fix Retrieval & Cache Bugs in `tmdbService.js` and `geminiService.js`

**Files:**
- Modify: `src/services/tmdbService.js:16-33`, `src/services/tmdbService.js:143-264`, `src/services/tmdbService.js:297-380`, `src/services/tmdbService.js:587-665`
- Modify: `src/services/geminiService.js:150-158`, `src/services/geminiService.js:304-311`
- Test: `tests/pipelineBugs.test.js`

**Interfaces:**
- Consumes: `computeZScoredWeights`, `computeBayesianScore` from `src/services/scoringUtils.js`
- Produces:
  - `extractTasteProfile(watched, watchlist, options?: { lambda?: number, anchorCutoff?: number, now?: number })` in `src/services/tmdbService.js` (returns `userStats`, `weightedRatings`, sorted `hatedKeywordIds`, `lovedGenreIds`, `topCastIds`, `topCrewMemberId`, `anchorTmdbId`)
  - `buildBucketAParams(profile, mood, options)` exported helper in `src/services/tmdbService.js` (uses pipe `|` for `with_cast`, `with_genres`, `without_keywords`)
  - `generateProfileHash(profile, watchlistGenres, mood, providers)` in `src/services/geminiService.js` (non-mutating, includes `anchorTmdbId`, `topCrewMemberId`, `topCastIds`, prefix `v4_`)

- [ ] **Step 1: Write the failing regression tests in `tests/pipelineBugs.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { extractTasteProfile, buildBucketAParams } from "../src/services/tmdbService.js";
import { generateProfileHash } from "../src/services/geminiService.js";

test("hatedKeywordIds sorts by negative weight descending before slicing top 5", async () => {
  const now = Date.UTC(2026, 10, 9);
  const watched = [
    { id: "bad1", userRating: 2, dateWatched: "2026-11-01", tmdbKeywords: [101, 102, 103, 104, 105, 999] },
    { id: "bad2", userRating: 1, dateWatched: "2026-11-08", tmdbKeywords: [999, 888] },
    { id: "bad3", userRating: 1, dateWatched: "2026-11-09", tmdbKeywords: [999, 888, 777] },
    { id: "good1", userRating: 9, dateWatched: "2026-11-09", tmdbGenreIds: [878] }
  ];
  const profile = await extractTasteProfile(watched, [], { now });
  assert.equal(profile.hatedKeywordIds[0], 999, "most frequent/recent disliked keyword 999 must be first");
  assert.ok(profile.hatedKeywordIds.includes(888), "second most disliked keyword 888 must be in top 5");
  assert.equal(profile.hatedKeywordIds.length, 5);
});

test("generateProfileHash does not mutate input arrays and invalidates when anchorTmdbId or crew changes", () => {
  const profile1 = {
    lovedGenreIds: [878, 18, 53],
    hatedKeywordIds: [200, 100],
    topCastIds: [50, 10],
    topCrewMemberId: 777,
    anchorTmdbId: 111
  };
  const watchlistGenres = [80, 12];
  const providers = [15, 8];

  const h1 = generateProfileHash(profile1, watchlistGenres, "any", providers);
  assert.deepEqual(profile1.lovedGenreIds, [878, 18, 53], "lovedGenreIds must not be mutated in place");
  assert.deepEqual(profile1.hatedKeywordIds, [200, 100], "hatedKeywordIds must not be mutated in place");
  assert.deepEqual(watchlistGenres, [80, 12], "watchlistGenres must not be mutated in place");
  assert.deepEqual(providers, [15, 8], "providers must not be mutated in place");

  const profile2 = { ...profile1, anchorTmdbId: 999 };
  const h2 = generateProfileHash(profile2, watchlistGenres, "any", providers);
  assert.notEqual(h1, h2, "new 10/10 anchor film must change the cache hash");
});

test("buildBucketAParams joins topCastIds with pipe (OR) instead of comma (AND)", () => {
  const params = buildBucketAParams(
    { lovedGenreIds: [878, 53], hatedKeywordIds: [11, 22], topCastIds: [500, 600], watchlistGenreIds: [] },
    "any",
    { userRegion: "US", userProviders: [] }
  );
  assert.equal(params.get("with_cast"), "500|600");
  assert.equal(params.get("with_genres"), "878|53");
  assert.equal(params.get("without_keywords"), "11|22");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL (`import.meta.env` undefined in Node or `buildBucketAParams` not exported / assertions failing)

- [ ] **Step 3: Implement fixes in `src/services/tmdbService.js` and `src/services/geminiService.js`**

1. In `src/services/tmdbService.js` and `src/services/geminiService.js`, update key getters to safely read `import.meta.env?.VITE_TMDB_KEY || globalThis.process?.env?.VITE_TMDB_KEY || ""` (and same for `VITE_OMDB_KEY`, `VITE_GEMINI_KEY`).
2. In `src/services/tmdbService.js`, update `extractTasteProfile(watched = [], watchlist = [], options = {})`:
   - Call `computeZScoredWeights(watched, options)` from `./scoringUtils.js`.
   - For positive affinities (`weight > 0`), accumulate `genreScores[id] += weight`, and for `rating >= 8` (or `zScore >= 0.5`), accumulate `castScores` and `crewScores` by `weight`.
   - For negative tropes (`rating <= 4` or `zScore < -0.4`), accumulate `hatedKeywordCounts[kId] += Math.abs(weight)`.
   - Sort `hatedKeywordIds` descending by accumulated score before `.slice(0, 5)`:
     ```javascript
     const hatedKeywordIds = Object.entries(hatedKeywordCounts)
       .filter(([_, score]) => score > 0)
       .sort((a, b) => b[1] - a[1])
       .slice(0, 5)
       .map(([id]) => Number(id));
     ```
   - Return `weightedRatings` and `userStats` on the profile object for downstream embedding synthesis.
3. In `src/services/tmdbService.js`, extract and export `buildBucketAParams(profile, mood = "any", options = {})`, changing `params.set("with_cast", profile.topCastIds.join("|"))`.
4. In `src/services/geminiService.js`, update `generateProfileHash(profile, watchlistGenres = [], mood = "any", providers = [])`:
   ```javascript
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
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pipelineBugs.test.js`
Expected: PASS (3/3 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/services/tmdbService.js src/services/geminiService.js tests/pipelineBugs.test.js
git commit -m "fix(recommender): fix hatedKeywordIds sort, profile hash mutation/anchor key, and with_cast OR pipe"
```

---

### Task 4: Stage 1 & 2 Client-Side Float16 Collaborative + Content Embeddings (`embeddingService.js`)

**Files:**
- Create: `src/services/embeddingService.js`
- Test: `tests/embeddingService.test.js`

**Interfaces:**
- Consumes: `weightedRatings` from `computeZScoredWeights` (`{ movie: { tmdbId }, weight }[]`)
- Produces:
  - `float16ToFloat32(uint16: number) -> number` and `float32ToFloat16(val: number) -> number`
  - `encodeEmbeddingBinary(items: Array<{ tmdbId: number, vector: number[] | Float32Array }>) -> ArrayBuffer`
  - `parseEmbeddingBinary(buffer: ArrayBuffer) -> { dim: number, count: number, ids: Uint32Array, vectors: Float32Array, idToIndex: Map<number, number> }`
  - `computeUserEmbedding(weightedRatings: Array, index: object) -> Float32Array | null`
  - `blendEmbeddings(collabVec: Float32Array | null, contentVec: Float32Array | null, ratingCount: number, pivot?: number) -> Float32Array | null`
  - `retrieveByEmbedding(userVec: Float32Array | null, index: object, excludeTmdbIds?: Set<number|string>, topK?: number) -> Array<{ tmdbId: number, collabSim: number }>`

- [ ] **Step 1: Write the failing test in `tests/embeddingService.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeEmbeddingBinary,
  parseEmbeddingBinary,
  computeUserEmbedding,
  blendEmbeddings,
  retrieveByEmbedding
} from "../src/services/embeddingService.js";

test("encodeEmbeddingBinary and parseEmbeddingBinary round-trip float16 embeddings accurately", () => {
  const rawItems = [
    { tmdbId: 603, vector: [0.8, 0.6, 0.0, 0.0] },   // The Matrix
    { tmdbId: 155, vector: [0.7, 0.7, 0.1, 0.0] },   // The Dark Knight
    { tmdbId: 11036, vector: [-0.8, -0.6, 0.0, 0.0] } // Opposite genre film
  ];
  const buf = encodeEmbeddingBinary(rawItems);
  const index = parseEmbeddingBinary(buf);

  assert.equal(index.count, 3);
  assert.equal(index.dim, 4);
  assert.equal(index.idToIndex.get(603), 0);
  const v0 = index.vectors.subarray(0, 4);
  assert.ok(Math.abs(v0[0] - 0.8) < 0.002);
  assert.ok(Math.abs(v0[1] - 0.6) < 0.002);
});

test("computeUserEmbedding pushes away from negatively weighted films and retrieves nearest neighbors", () => {
  const index = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] },
    { tmdbId: 2, vector: [0.9, 0.435, 0, 0] },
    { tmdbId: 3, vector: [0, 1, 0, 0] },
    { tmdbId: 4, vector: [-0.9, 0.435, 0, 0] }
  ]));

  // User loved film 1 (+1.0) and hated film 3 (-1.0)
  const userVec = computeUserEmbedding(
    [
      { movie: { tmdbId: 1 }, weight: 1.0 },
      { movie: { tmdbId: 3 }, weight: -1.0 }
    ],
    index
  );
  assert.ok(userVec instanceof Float32Array);

  const neighbors = retrieveByEmbedding(userVec, index, new Set([1, 3]), 2);
  assert.equal(neighbors.length, 2);
  assert.equal(neighbors[0].tmdbId, 2);
  assert.ok(neighbors[0].collabSim > neighbors[1].collabSim);
});

test("computeUserEmbedding returns null when no rated films exist in the index", () => {
  const index = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] }
  ]));
  const userVec = computeUserEmbedding([{ movie: { tmdbId: 999999 }, weight: 1.2 }], index);
  assert.equal(userVec, null);
  assert.deepEqual(retrieveByEmbedding(userVec, index, new Set(), 10), []);
});

test("blendEmbeddings weights toward content for low-rating items and toward collab for high-rating items", () => {
  const collab = new Float32Array([1, 0]);
  const content = new Float32Array([0, 1]);
  const coldBlend = blendEmbeddings(collab, content, 5, 50); // alpha = 5/55
  const warmBlend = blendEmbeddings(collab, content, 500, 50); // alpha = 500/550
  assert.ok(coldBlend[1] > coldBlend[0], "cold item leans toward content vector");
  assert.ok(warmBlend[0] > warmBlend[1], "warm item leans toward collab vector");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/embeddingService.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/services/embeddingService.js`

- [ ] **Step 3: Implement `src/services/embeddingService.js`**

Implement the binary format (`CVEM` 16-byte header: 4-byte ASCII `"CVEM"`, `uint32 version = 1`, `uint32 count`, `uint32 dim`, followed by `count * 4` bytes of little-endian `uint32` `tmdbIds`, followed by `count * dim * 2` bytes of IEEE-754 `uint16` half-floats):
```javascript
export function float16ToFloat32(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}
```
- L2-normalize every vector on decode in `parseEmbeddingBinary` and in `computeUserEmbedding` ($u = \frac{\sum w_i e_i}{\sum |w_i|}$, returning `null` if $\sum |w_i| === 0$ or $\|u\|_2 === 0$).
- `retrieveByEmbedding(userVec, index, excludeTmdbIds = new Set(), topK = 250)` computes dot product over contiguous `index.vectors` and returns top `topK` `{ tmdbId, collabSim }` sorted descending.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/embeddingService.test.js`
Expected: PASS (4/4 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/services/embeddingService.js tests/embeddingService.test.js
git commit -m "feat(embeddings): add float16 binary embedding codec, user taste vector, and cosine retriever"
```

---

### Task 5: Stage 3 Calibrated Learned Ranker (`rankerService.js`)

**Files:**
- Create: `src/services/rankerService.js`
- Test: `tests/rankerService.test.js`

**Interfaces:**
- Consumes: `computeBayesianScore` from `src/services/scoringUtils.js`
- Produces:
  - `DEFAULT_RANKER_WEIGHTS` (calibrated logistic regression intercept + feature weights)
  - `extractCandidateFeatures(candidate: object, context: { profile: object, collabSimMap?: Map<number, number>, contentSimMap?: Map<number, number>, userProviders?: number[] }) -> object`
  - `scoreCandidate(features: object, weights?: object) -> { logit: number, probability: number, matchScore: number }`
  - `rankCandidatePool(candidates: Array, context: object, weights?: object, topK?: number) -> Array`

- [ ] **Step 1: Write the failing test in `tests/rankerService.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCandidateFeatures,
  scoreCandidate,
  rankCandidatePool
} from "../src/services/rankerService.js";

test("scoreCandidate produces calibrated probabilities and monotonic matchScore in [50, 99]", () => {
  const strongFeatures = {
    collabSim: 0.75,
    contentSim: 0.65,
    genreOverlap: 0.8,
    keywordOverlap: 0.5,
    crewMatch: 1,
    castMatch: 1,
    bayesianRatingNorm: 0.85,
    noveltyBonus: 0.4,
    negativeKeywordPenalty: 0,
    providerMatch: 1
  };
  const weakFeatures = {
    collabSim: -0.2,
    contentSim: 0.0,
    genreOverlap: 0.0,
    keywordOverlap: 0.0,
    crewMatch: 0,
    castMatch: 0,
    bayesianRatingNorm: 0.3,
    noveltyBonus: 0.1,
    negativeKeywordPenalty: 1,
    providerMatch: 0
  };

  const strong = scoreCandidate(strongFeatures);
  const weak = scoreCandidate(weakFeatures);

  assert.ok(strong.probability > 0.8, `expected strong probability > 0.8, got ${strong.probability}`);
  assert.ok(weak.probability < 0.3, `expected weak probability < 0.3, got ${weak.probability}`);
  assert.ok(strong.matchScore >= 90 && strong.matchScore <= 99);
  assert.ok(weak.matchScore >= 50 && weak.matchScore < 70);
});

test("rankCandidatePool ranks 300 candidates down to topK=30 and attaches calibrated matchScore", () => {
  const candidates = Array.from({ length: 300 }, (_, i) => ({
    id: i + 1,
    tmdbId: i + 1,
    title: `Movie ${i + 1}`,
    genre_ids: i === 42 ? [878, 53] : [35],
    vote_average: i === 42 ? 8.4 : 6.5,
    vote_count: i === 42 ? 1200 : 200
  }));

  const context = {
    profile: { lovedGenreIds: [878, 53], hatedKeywordIds: [], topCastIds: [], topCrewMemberId: null },
    collabSimMap: new Map([[43, 0.88]]),
    contentSimMap: new Map([[43, 0.72]])
  };

  const top30 = rankCandidatePool(candidates, context, undefined, 30);
  assert.equal(top30.length, 30);
  assert.equal(top30[0].tmdbId, 43);
  assert.ok(top30[0].matchScore > top30[29].matchScore);
  assert.ok(top30[0].rankerProbability > top30[29].rankerProbability);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/rankerService.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/services/rankerService.js`

- [ ] **Step 3: Implement `src/services/rankerService.js`**

Implement feature extraction and calibrated logistic scoring:
- `DEFAULT_RANKER_WEIGHTS`:
  ```javascript
  export const DEFAULT_RANKER_WEIGHTS = {
    bias: -1.1,
    collabSim: 2.4,
    contentSim: 1.4,
    genreOverlap: 1.1,
    keywordOverlap: 0.8,
    crewMatch: 0.7,
    castMatch: 0.5,
    bayesianRatingNorm: 1.2,
    noveltyBonus: 0.35,
    negativeKeywordPenalty: -2.0,
    providerMatch: 0.25
  };
  ```
- `scoreCandidate(features, weights = DEFAULT_RANKER_WEIGHTS)`:
  - `logit = weights.bias + sum(weights[k] * (features[k] || 0))`
  - `probability = 1 / (1 + Math.exp(-logit))`
  - `matchScore = Math.min(99, Math.max(50, Math.round(50 + 49 * probability)))`
- `rankCandidatePool(candidates, context, weights = DEFAULT_RANKER_WEIGHTS, topK = 30)` attaches `features`, `rankerProbability`, and `matchScore` to each candidate, sorts descending by `rankerProbability`, and slices `0..topK`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/rankerService.test.js`
Expected: PASS (2/2 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/services/rankerService.js tests/rankerService.test.js
git commit -m "feat(ranker): add calibrated logistic candidate ranker and feature extractor"
```

---

### Task 6: Widen Candidate Pool to ~300 & Restrict Gemini to Top-30 Explanations/Diversity

**Files:**
- Modify: `src/services/tmdbService.js:587-665`
- Modify: `src/services/geminiService.js:325-442`, `src/services/geminiService.js:556-594`
- Test: `tests/pipelineBugs.test.js`

**Interfaces:**
- Consumes: `retrieveByEmbedding`, `computeUserEmbedding` from `src/services/embeddingService.js`, `rankCandidatePool` from `src/services/rankerService.js`
- Produces:
  - `fetchCandidatePool(profile, mood, watchedMovies, watchlistMovies, options?: { poolSize?: number, embeddingIndex?: object, userRegion?: string, userProviders?: number[] })` in `src/services/tmdbService.js` (widened default `poolSize = 250` when `options.widePool` or `embeddingIndex` is supplied, preserving `20` fallback when neither is used)
  - `buildGeminiReRankPrompt(profile, mood, topCandidates)` exported in `src/services/geminiService.js` (does not ask Gemini for `matchScore`; preserves ranker `matchScore`)
  - `parseFreeTextMoodWithGemini(ai, freeTextQuery)` exported in `src/services/geminiService.js`

- [ ] **Step 1: Append failing tests to `tests/pipelineBugs.test.js`**

```javascript
import { buildGeminiReRankPrompt, mergeGeminiExplanationsWithRanker } from "../src/services/geminiService.js";

test("mergeGeminiExplanationsWithRanker preserves calibrated ranker matchScore instead of LLM score", () => {
  const rankedCandidates = [
    { id: 101, tmdbId: 101, title: "Arrival", year: "2016", genre: "Sci-Fi", matchScore: 95, rankerProbability: 0.92, realData: true },
    { id: 102, tmdbId: 102, title: "Annihilation", year: "2018", genre: "Sci-Fi", matchScore: 84, rankerProbability: 0.69, realData: true }
  ];
  const geminiResponse = {
    tasteProfile: { favoriteGenres: ["Sci-Fi"], preferredEra: "2010s", ratingStyle: "Cerebral" },
    recommendations: [
      { tmdbId: 101, title: "Arrival", year: "2016", matchScore: 60, reason: "Fits your love of linguistic sci-fi." },
      { tmdbId: 102, title: "Annihilation", year: "2018", matchScore: 99, reason: "Matches your atmospheric sci-fi taste." }
    ]
  };
  const final = mergeGeminiExplanationsWithRanker(geminiResponse, rankedCandidates, { lovedGenreNames: ["Sci-Fi"] });
  assert.equal(final.recommendations[0].tmdbId, 101);
  assert.equal(final.recommendations[0].matchScore, 95, "must keep calibrated ranker matchScore=95");
  assert.equal(final.recommendations[1].matchScore, 84, "must keep calibrated ranker matchScore=84");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL (`mergeGeminiExplanationsWithRanker` is not exported)

- [ ] **Step 3: Update `src/services/tmdbService.js` and `src/services/geminiService.js`**

1. In `src/services/tmdbService.js`, update `fetchCandidatePool` so `const targetPoolSize = options.poolSize || 60;` (up from 20; and up to 300 when merged with embedding nearest-neighbors), with Bucket B fetching up to `Math.min(40, Math.floor(targetPoolSize * 0.35))`, Bucket C fetching up to `Math.min(20, Math.floor(targetPoolSize * 0.2))`, and Bucket A filling the remainder across up to 8 pages.
2. In `src/services/geminiService.js`, export `buildGeminiReRankPrompt` and `mergeGeminiExplanationsWithRanker`:
   - Before calling `reRankCandidatesWithGemini`, run `rankCandidatePool(candidates, { profile, collabSimMap, contentSimMap, userProviders }, undefined, 30)` to narrow the pool to the top 30 with calibrated `matchScore` attached.
   - In `mergeGeminiExplanationsWithRanker`, if `candidate.matchScore` is already computed by `rankCandidatePool`, always use `candidate.matchScore` instead of `normalizeMatchScore(rec.matchScore)`.
   - Export `parseFreeTextMoodWithGemini(ai, query)` to convert free-text user requests (e.g. `"like Drive but funnier"`) into `{ moodId, withGenres, withoutKeywords, yearMin, yearMax }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pipelineBugs.test.js`
Expected: PASS (4/4 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/services/tmdbService.js src/services/geminiService.js tests/pipelineBugs.test.js
git commit -m "feat(pipeline): rank candidate pool with calibrated ranker and lock matchScore from LLM override"
```

---

### Task 7: Rich Feedback Logging & Offline Colab Embedding Trainer

**Files:**
- Create: `src/services/feedbackService.js`
- Modify: `src/context/AppContext.jsx:185-215`
- Create: `scripts/colab_train_embeddings.py`
- Test: `tests/feedbackLogging.test.js`

**Interfaces:**
- Consumes: `aiFeedbackLog` events `{ title, year, tmdbId?, imdbID?, action: "click" | "dismissed" | "added_watchlist" | "rated", reason?, userRating?, matchScoreAtTime?, sourceBucket? }`
- Produces:
  - `normalizeFeedbackEvent(event, existingLog, maxEvents?: number) -> Array` exported from `src/services/feedbackService.js`
  - `scripts/colab_train_embeddings.py` CLI/Colab script outputting `public/models/item_embeddings_f16.bin` and `public/models/ranker_weights.json`

- [ ] **Step 1: Write the failing test in `tests/feedbackLogging.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFeedbackEvent } from "../src/services/feedbackService.js";

test("normalizeFeedbackEvent preserves tmdbId, matchScoreAtTime, and upgrades watchlist_add to rated when user rates the film", () => {
  let log = [];
  log = normalizeFeedbackEvent(
    { title: "Drive", year: "2011", tmdbId: 64690, action: "added_watchlist", matchScoreAtTime: 93, sourceBucket: "CollabNN" },
    log
  );
  assert.equal(log.length, 1);
  assert.equal(log[0].tmdbId, 64690);
  assert.equal(log[0].matchScoreAtTime, 93);

  log = normalizeFeedbackEvent(
    { title: "Drive", year: "2011", tmdbId: 64690, action: "rated", userRating: 9 },
    log
  );
  assert.equal(log.length, 1, "updates existing movie entry or links conversion");
  assert.equal(log[0].action, "rated");
  assert.equal(log[0].userRating, 9);
  assert.equal(log[0].previousAction, "added_watchlist");
  assert.equal(log[0].matchScoreAtTime, 93, "retains original matchScoreAtTime for calibration training");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/feedbackLogging.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/services/feedbackService.js`

- [ ] **Step 3: Implement `src/services/feedbackService.js`, wire into `src/context/AppContext.jsx`, and create `scripts/colab_train_embeddings.py`**

1. Create `src/services/feedbackService.js` exporting `normalizeFeedbackEvent(feedbackItem, prevLog = [], maxEvents = 500)`:
   - Matches existing entry by `tmdbId`, `imdbID`, or lowercase `title`.
   - If an existing entry exists, merges `matchScoreAtTime`, `sourceBucket`, `tmdbId`, and sets `previousAction: existing.action` when transitioning to `"rated"`.
   - Keeps up to `maxEvents = 500` items (up from `15`).
2. In `src/context/AppContext.jsx`, use `normalizeFeedbackEvent` inside `addAiFeedback`, and in `addWatched(movie)`, if `movie` matches any item in `aiRecommendations` or `aiFeedbackLog`, automatically call `addAiFeedback({ title: movie.title, year: movie.year, tmdbId: movie.tmdbId, imdbID: movie.imdbID, action: "rated", userRating: movie.userRating })`.
3. Create `scripts/colab_train_embeddings.py`:
   - Reads MovieLens `ratings.csv` and `links.csv` (filtering ratings $\ge 0.5$ and films with at least 50 ratings, top 20,000 films).
   - Builds sparse user-item centered matrix, runs `scipy.sparse.linalg.svds(..., k=64)` (or alternating least squares), L2-normalizes item vectors, and writes `public/models/item_embeddings_f16.bin` with the exact `CVEM` v1 header (`<4sIII`, `tmdbIds` as `<u4`, `vectors` as `<f2`).

- [ ] **Step 4: Run all tests to verify the entire suite passes**

Run: `npm test`
Expected: PASS (all test files passing with 0 failures)

- [ ] **Step 5: Commit**

```bash
git add src/services/feedbackService.js src/context/AppContext.jsx scripts/colab_train_embeddings.py tests/feedbackLogging.test.js
git commit -m "feat(feedback,ml): expand feedback log for calibration and add MovieLens float16 export script"
```
