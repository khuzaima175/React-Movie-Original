# Recommendation Accuracy Pipeline, Live Feature Enrichment & Dead-Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate live feature starvation across TMDB Buckets A–D, align Bucket E embedding retrieval with ranker collab + repulsion math, wire `fitRankerWeights` on real user feedback, build a true non-double-counted `contentSim` path covering `2024+` films, safely wire or retire unused modules (`dnaService`, `parseFreeTextMoodWithGemini`, `getRecommendationExplanation`, `signedGenreScores`), and enforce non-leaky evaluation gates (`NegHit@20`, `Unique@30`, `NDCG@10`).

**Architecture:** Enrich unhydrated TMDB discovery candidates in bounded concurrency batches sharing the embedding detail cache so keyword, cast, crew, negative-trope, and provider features work across Buckets A–D as well as Bucket E. Align neighbor retrieval with the ranker's `0.70` persona + `0.30` top-loved blend minus repulsion, add an L2-regularized bounded `onlineLearningService.js` over `aiFeedbackLog`, introduce `contentSimService.js` + `scripts/build_content_embeddings.mjs` backed purely by plot/tagline text (`blendEmbeddings` fusion for warm/cold items without double-counting metadata), wire optional `CDNA` + mood/explanation hooks cleanly while removing dead accumulators, and lock changes behind Clean1/Clean2 harness metrics (`NegHit@20`, `Unique@30`, `NDCG@10`). Companion to `docs/superpowers/plans/2026-11-14-reliability-cascade-and-security-fixes.md`.

**Tech Stack:** ES modules (`"type": "module"`), Node.js (`node --test`), React 18, TMDB API v3, `@google/genai`, Python (`numpy`, `scipy`, `pandas` in `scripts/colab_train_embeddings.py`).

**Spec:** [docs/superpowers/specs/2026-11-09-pipeline-wiring-and-argon-spec.md](../specs/2026-11-09-pipeline-wiring-and-argon-spec.md) + verified Clean1/Clean2 empirical benchmarks (`ARCHITECTURE.md` §3.8).

## Global Constraints

- **Never remove or weaken `repulsion: -1.5` or `negativeKeywordPenalty: -0.5` in `DEFAULT_RANKER_WEIGHTS`** without a clean-index harness gate proving `NDCG@10` improves AND `NegHit@20` does not increase (`0.08024` baseline).
- **Never switch `item_embeddings_f16.bin` to naive unit-normalization** (`shrink = 0` drops Clean2 `NDCG@10` by `-28%`); any `--norm-power` / `shrink` adjustment must clear the clean evaluation gate.
- **Zero double-counting:** `contentSim` MUST originate from text/overview embeddings (or plot-only TF-IDF experiments), never from `tmdbGenreIds`, `tmdbKeywords`, `castIds`, or `crewPersonId` overlaps.
- **Graceful asset degradation:** Missing or HTML-fallback `/models/*.bin` assets must resolve to `null` and degrade numeric features cleanly to `0`.
- Keep all existing and newly added `node --test` suites and `npm run build` green at every task commit.

## Review Focus

1. 10 of 45 Bucket A–D TMDB detail lookups fail with `429` or network errors -> `enrichCandidatePoolMetadata` still returns all 45 candidates, enriching the 35 succeeded entries cleanly without mutating `sourceBucket` or `providerMatchedByQuery`.
2. A cluster of films high on `bestPersonaSim` is strongly hated (`repulsion > 0.35`) -> `retrieveAlignedEmbeddingNeighbors` prunes repulsed films before slicing Bucket E slots and respects watched/watchlist exclusions.
3. `feedbackLog` contains only 1 dismissal (or synthetic outlier dismissals trying to push `repulsion` positive) -> `derivePersonalizedRankerWeights` stays on `priorWeights` below threshold (`2 positives + 2 negatives`) and enforces hard weight rails (`repulsion <= -1.0`, `negativeKeywordPenalty <= -0.35`, `collabSim >= 3.5`).
4. `/models/content_embeddings_f16.bin` or `/models/cinematic_dna_u8.bin` returns `404` or SPA HTML `index.html` -> `loadDefaultContentIndex` and `loadDefaultDnaIndex` resolve `null`, ranker features evaluate to `0`, and `getMovieRecommendations` finishes normally.
5. Offline evaluation tests a modified `repulsion` weight or `shrink` value on clean holdout folds -> harness computes `NegHit@20` and `Unique@30` alongside `NDCG@10` so long-tail tweaks cannot silently spike disliked recommendations.

---

### Task 1: Batch-Enrich Live TMDB Bucket A–D Candidates (`enrichCandidatePoolMetadata`)

**Files:**
- Modify: `src/services/tmdbService.js:827-853, 1164-1254`
- Modify: `src/services/geminiService.js:1318-1366`
- Test: `tests/pipelineBugs.test.js`

**Interfaces:**
- Consumes: `fetchTmdbMovieDetails`, existing `embeddingDetailCache` (`src/services/tmdbService.js:1164`)
- Produces:
  - Internal shared cache helper `getCachedTmdbDetails(tmdbId: number, userRegion: string, detailFetcher?: Function): Promise<Object | null>` shared with `fetchEmbeddingCandidates`
  - Exported `enrichCandidatePoolMetadata(candidates: Array, options?: { concurrency?: number, maxEnrich?: number, userRegion?: string, detailFetcher?: Function }): Promise<Array>`

- [ ] **Step 1: Write failing tests in `tests/pipelineBugs.test.js` for Bucket A–D metadata enrichment and partial-failure safety**

```javascript
test("enrichCandidatePoolMetadata hydrates keywords, castIds, crewPersonId, and streamProviders on Buckets A-D while surviving partial fetch failures", async () => {
  const { enrichCandidatePoolMetadata } = await import("../src/services/tmdbService.js");
  const pool = [
    { id: 101, tmdbId: 101, title: "Bucket A Film", genre_ids: [878], sourceBucket: "Bucket A: Semantic", providerMatchedByQuery: true },
    { id: 102, tmdbId: 102, title: "Failing Detail Film", genre_ids: [18], sourceBucket: "D", providerMatchedByQuery: false },
    { id: 103, tmdbId: 103, title: "Already Rich Film", tmdbKeywords: [77], castIds: [8], crewPersonId: 9, sourceBucket: "Bucket E (Embedding)" }
  ];

  let fetchCount = 0;
  const enriched = await enrichCandidatePoolMetadata(pool, {
    maxEnrich: 10,
    concurrency: 2,
    detailFetcher: async (id) => {
      fetchCount++;
      if (id === 102) throw new Error("429 Too Many Requests");
      return {
        tmdbId: id,
        director: "Denis Villeneuve",
        crewPersonId: 137427,
        castIds: [5292, 90633],
        tmdbKeywords: [4565, 9882],
        keywordNames: ["dystopia", "space"],
        tmdbGenreIds: [878, 18],
        streamProviders: [{ id: 8, name: "Netflix" }],
        runtimeMinutes: 163
      };
    }
  });

  assert.equal(enriched.length, 3, "failed detail lookups must never drop candidates");
  assert.equal(fetchCount, 2, "must skip candidates already carrying tmdbKeywords and castIds");
  assert.deepEqual(enriched[0].tmdbKeywords, [4565, 9882]);
  assert.equal(enriched[0].crewPersonId, 137427);
  assert.equal(enriched[0].sourceBucket, "Bucket A: Semantic", "must preserve sourceBucket");
  assert.equal(enriched[0].providerMatchedByQuery, true, "must preserve providerMatchedByQuery");
  assert.equal(enriched[1].id, 102, "unhydrated candidate remains intact");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL (`enrichCandidatePoolMetadata` is not exported).

- [ ] **Step 3: Implement `getCachedTmdbDetails` + `enrichCandidatePoolMetadata` in `src/services/tmdbService.js` and wire into `getMovieRecommendations`**

1. Extract `getCachedTmdbDetails(id, userRegion, detailFetcher)` in `src/services/tmdbService.js` using `embeddingDetailCache` (removing duplicate cache check inside `fetchEmbeddingCandidates`). Cache key should incorporate `${userRegion}:${id}` so region switch does not serve stale `streamProviders`.
2. Export `enrichCandidatePoolMetadata(candidates = [], options = {})`:
   - Collect indices of items needing enrichment (missing `Array.isArray(c.tmdbKeywords)` or `Array.isArray(c.castIds)`), capped at `options.maxEnrich ?? 45`.
   - Run concurrency-bounded worker pool (`concurrency = Math.max(1, options.concurrency ?? 6)`) via `getCachedTmdbDetails`.
   - On success, shallow-merge `{ director, crewPersonId, castIds, tmdbKeywords, keywordNames, tmdbGenreIds, streamProviders, runtimeMinutes, imdbID }` while explicitly keeping `sourceBucket`, `providerMatchedByQuery`, and `collabSim` untouched.
   - Skip failed/null detail responses without removing the candidate.
3. In `src/services/geminiService.js` inside `getMovieRecommendations`: run `enrichCandidatePoolMetadata` alongside/after `fetchEmbeddingCandidates` (`options.enrichCandidates !== false`), before calling `reRankCandidatesWithGemini`. Allow skipping network enrichment in pure unit tests when `!TMDB_KEY && typeof options.detailFetcher !== "function"`.

- [ ] **Step 4: Run test suite**

Run: `node --test tests/pipelineBugs.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/tmdbService.js src/services/geminiService.js tests/pipelineBugs.test.js
git commit -m "feat(retrieval): batch-enrich Bucket A-D candidates with TMDB keywords, cast, crew, and providers"
```

---

### Task 2: Align Bucket E Embedding Retrieval With Ranker Collab + Repulsion Math

**Files:**
- Modify: `src/services/embeddingService.js:469-501`
- Modify: `src/services/geminiService.js:1338-1356`
- Test: `tests/embeddingService.test.js`

**Interfaces:**
- Consumes: `buildCollabSimMapFromIndex`, `buildRepulsionMapFromIndex`, existing `retrieveByEmbedding`
- Produces:
  - Exported `retrieveAlignedEmbeddingNeighbors(weightedRatings: Array, index: Object, excludeTmdbIds?: Set<number>, options?: { collabSimMap?: Map, repulsionMap?: Map, topK?: number, repulsionWeight?: number }): Array<{ tmdbId: number, collabSim: number, repulsion: number, alignedScore: number }>`

- [ ] **Step 1: Write failing test in `tests/embeddingService.test.js` verifying aligned top-loved + repulsion-pruned Bucket E selection**

```javascript
test("retrieveAlignedEmbeddingNeighbors aligns with collabSim - repulsionWeight * repulsion and prunes hated clusters before topK", async () => {
  const {
    encodeEmbeddingBinary,
    parseEmbeddingBinary,
    buildCollabSimMapFromIndex,
    buildRepulsionMapFromIndex,
    retrieveAlignedEmbeddingNeighbors
  } = await import("../src/services/embeddingService.js");

  const index = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] },      // Loved anchor
    { tmdbId: 2, vector: [0.9, 0.435, 0, 0] }, // Clean close neighbor
    { tmdbId: 3, vector: [0, 1, 0, 0] },      // Hated seed
    { tmdbId: 4, vector: [0.25, 0.968, 0, 0] } // High similarity to hated seed 3!
  ]));

  const weightedRatings = [
    { movie: { tmdbId: 1 }, weight: 1.5, rating: 10 },
    { movie: { tmdbId: 3 }, weight: -1.8, rating: 1 }
  ];

  const collabSimMap = buildCollabSimMapFromIndex(weightedRatings, index);
  const repulsionMap = buildRepulsionMapFromIndex(weightedRatings, index);

  const neighbors = retrieveAlignedEmbeddingNeighbors(weightedRatings, index, new Set([1, 3]), {
    collabSimMap,
    repulsionMap,
    topK: 2,
    repulsionWeight: 1.5 / 4.8
  });

  assert.equal(neighbors.length, 2);
  assert.equal(neighbors[0].tmdbId, 2, "clean neighbor #2 must outrank repulsed neighbor #4");
  assert.ok(neighbors[0].alignedScore > neighbors[1].alignedScore);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/embeddingService.test.js`
Expected: FAIL (`retrieveAlignedEmbeddingNeighbors` is not exported).

- [ ] **Step 3: Implement `retrieveAlignedEmbeddingNeighbors` in `embeddingService.js` and wire into `geminiService.js`**

1. Export `retrieveAlignedEmbeddingNeighbors(weightedRatings = [], index = null, excludeTmdbIds = new Set(), options = {})` in `src/services/embeddingService.js`:
   - Accept optional precomputed `options.collabSimMap` / `options.repulsionMap` (computing them via `buildCollabSimMapFromIndex` / `buildRepulsionMapFromIndex` when omitted). Return `[]` cleanly if `!index?.count` or empty `collabSimMap`.
   - Set `repulsionWeight = options.repulsionWeight ?? (1.5 / 4.8)` and `topK = options.topK ?? 40`.
   - Iterate `index.ids`, skip `excluded.has(tmdbId)`, compute `collabSim = collabSimMap.get(tmdbId) ?? 0`, `repulsion = repulsionMap.get(tmdbId) ?? 0`, and `alignedScore = collabSim - repulsionWeight * repulsion`.
   - Sort descending by `alignedScore` and slice `topK`.
   - Keep existing `retrieveByEmbedding` untouched for all callers and unit tests.
2. In `src/services/geminiService.js:1338-1356`:
   - Replace `computeUserPersonas` + `retrieveByEmbedding(personas, ..., 30)` with `retrieveAlignedEmbeddingNeighbors(profile.weightedRatings, embeddingIndex, excludeIds, { collabSimMap, repulsionMap, topK: 40 })` (over-fetching 40 raw IDs so `fetchEmbeddingCandidates(..., { maxNeighbors: 30 })` fills up to 30 valid unseen TMDB items even if some neighbor IDs lack TMDB details).

- [ ] **Step 4: Run embedding & full test suites**

Run: `node --test tests/embeddingService.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/embeddingService.js src/services/geminiService.js tests/embeddingService.test.js
git commit -m "feat(embeddings): align Bucket E neighbor retrieval with collab blend and repulsion pruning"
```

---

### Task 3: Wire Online Pairwise Weight Personalization (`fitRankerWeights`) From Feedback Log

**Files:**
- Create: `src/services/onlineLearningService.js`
- Modify: `src/services/feedbackService.js:1-73`
- Modify: `src/services/geminiService.js:1056-1071, 1358-1367`
- Modify: `src/components/MovieRecommendations.jsx:339-391`
- Test: `tests/rankerService.test.js`, `tests/feedbackLogging.test.js`

**Interfaces:**
- Consumes: `fitRankerWeights`, `DEFAULT_RANKER_WEIGHTS`, `extractCandidateFeatures` (`src/services/rankerService.js`), `normalizeFeedbackEvent` (`src/services/feedbackService.js`)
- Produces:
  - `src/services/onlineLearningService.js`:
    - `sanitizeFeatureSnapshot(rawFeatures?: Object): Object | null`
    - `derivePersonalizedRankerWeights(feedbackLog: Array, watchedMovies?: Array, priorWeights?: Object, options?: { minPositives?: number, minNegatives?: number, maxDrift?: number, featureLookup?: Map }): Object`

- [ ] **Step 1: Write failing tests in `tests/rankerService.test.js` and `tests/feedbackLogging.test.js`**

```javascript
// tests/feedbackLogging.test.js
test("normalizeFeedbackEvent preserves sanitized feature snapshot for online weight learning", () => {
  const updated = normalizeFeedbackEvent(
    {
      title: "Dune",
      year: "2021",
      tmdbId: 438631,
      action: "dismissed",
      matchScoreAtTime: 91,
      features: { collabSim: 0.7, crewMatch: 1, keywordOverlap: 0.4, unknownField: 999 }
    },
    []
  );
  assert.equal(updated[0].features.collabSim, 0.7);
  assert.equal(updated[0].features.crewMatch, 1);
  assert.equal(updated[0].features.unknownField, undefined);
});

// tests/rankerService.test.js
test("derivePersonalizedRankerWeights returns priorWeights below minimum threshold and enforces safety rails when active", async () => {
  const { derivePersonalizedRankerWeights } = await import("../src/services/onlineLearningService.js");
  const { DEFAULT_RANKER_WEIGHTS } = await import("../src/services/rankerService.js");

  // Below threshold (only 1 negative dismissal) -> must not drift from priorWeights
  const sparse = derivePersonalizedRankerWeights(
    [
      { action: "rated", userRating: 9, features: { collabSim: 0.8, crewMatch: 1, keywordOverlap: 0.9, repulsion: 0, negativeKeywordPenalty: 0 } },
      { action: "rated", userRating: 9, features: { collabSim: 0.7, crewMatch: 1, keywordOverlap: 0.8, repulsion: 0, negativeKeywordPenalty: 0 } },
      { action: "dismissed", features: { collabSim: 0.2, crewMatch: 0, keywordOverlap: 0.1, repulsion: 0.9, negativeKeywordPenalty: 1 } }
    ],
    [],
    DEFAULT_RANKER_WEIGHTS
  );
  assert.deepEqual(sparse, DEFAULT_RANKER_WEIGHTS);

  // Active threshold (3 positives, 3 negatives) -> adjusts bounded weights and keeps safety floors intact
  const posFeats = { collabSim: 0.8, crewMatch: 1, keywordOverlap: 0.9, bayesianRatingNorm: 0.6, noveltyBonus: 0.4, repulsion: 0, negativeKeywordPenalty: 0 };
  const negFeats = { collabSim: 0.1, crewMatch: 0, keywordOverlap: 0.0, bayesianRatingNorm: 0.8, noveltyBonus: 0.1, repulsion: 0.6, negativeKeywordPenalty: 1 };
  const active = derivePersonalizedRankerWeights(
    [
      { action: "rated", userRating: 10, features: posFeats },
      { action: "rated", userRating: 9, features: posFeats },
      { action: "added_watchlist", features: posFeats },
      { action: "dismissed", features: negFeats },
      { action: "dismissed", features: negFeats },
      { action: "rated", userRating: 2, features: negFeats }
    ],
    [],
    DEFAULT_RANKER_WEIGHTS
  );
  assert.ok(active.crewMatch > DEFAULT_RANKER_WEIGHTS.crewMatch);
  assert.ok(active.repulsion <= -1.0, "repulsion safety floor preserved");
  assert.ok(active.negativeKeywordPenalty <= -0.35, "negativeKeywordPenalty safety floor preserved");
  assert.ok(active.collabSim >= 3.5, "collabSim minimum preserved");
  assert.ok(Math.abs(active.crewMatch - DEFAULT_RANKER_WEIGHTS.crewMatch) <= 0.6 + 1e-9);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/feedbackLogging.test.js tests/rankerService.test.js`
Expected: FAIL (`onlineLearningService.js` does not exist and `features` snapshot is stripped).

- [ ] **Step 3: Implement feature snapshot logging, `onlineLearningService.js`, and wire into `geminiService.js` + `MovieRecommendations.jsx`**

1. In `src/services/feedbackService.js`: preserve sanitized numeric `features` object (restricted to keys in `DEFAULT_RANKER_WEIGHTS` excluding `bias`) inside `normalizeFeedbackEvent`, retaining existing `features` when upgrading `added_watchlist` -> `rated`.
2. In `src/components/MovieRecommendations.jsx:342,376` (`handleAdd`, `handleDismiss`) and `buildRankerFallbackResponse` / `mergeGeminiExplanationsWithRanker` in `src/services/geminiService.js`: propagate optional `features: rec.features ?? null` onto recommendation items and feedback log entries cleanly.
3. Create `src/services/onlineLearningService.js`:
   - Implement `derivePersonalizedRankerWeights(feedbackLog = [], watchedMovies = [], priorWeights = DEFAULT_RANKER_WEIGHTS, options = {})`:
     - Collect positives (`action === "added_watchlist"` or `userRating >= 8`, capped to most recent 50) and negatives (`action === "dismissed"` or `(action === "rated" && userRating <= 4)`, capped to most recent 50) carrying valid `features` (or resolved via optional `options.featureLookup`).
     - Require `positives.length >= minPositives (2)`, `negatives.length >= minNegatives (2)`, and combined `>= 5`; otherwise return `{ ...priorWeights }`.
     - Fit via `fitRankerWeights(positives, negatives, priorWeights, { iterations: 40, learningRate: 0.15, l2: 0.35 })`, clamp every weight within `[prior - maxDrift, prior + maxDrift]` (`maxDrift = 0.6`), and enforce safety floors `repulsion <= -1.0`, `negativeKeywordPenalty <= -0.35`, `collabSim >= 3.5`.
4. Wire `derivePersonalizedRankerWeights(options.feedbackLog, watchedMovies, DEFAULT_RANKER_WEIGHTS)` into `getMovieRecommendations` (`src/services/geminiService.js`) as default `rankerWeights` when `options.rankerWeights` is omitted.

- [ ] **Step 4: Run test suite**

Run: `node --test tests/feedbackLogging.test.js tests/rankerService.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/onlineLearningService.js src/services/feedbackService.js src/services/geminiService.js src/components/MovieRecommendations.jsx tests/rankerService.test.js tests/feedbackLogging.test.js
git commit -m "feat(ranker): wire online pairwise weight learning on feedback logs with safety bounds"
```

---

### Task 4: Implement Real Text `contentSim` Service & `2024+` Content Embedding Script (`blendEmbeddings`)

**Files:**
- Create: `src/services/contentSimService.js`
- Create: `scripts/build_content_embeddings.mjs`
- Modify: `src/services/geminiService.js:1326-1367`
- Test: `tests/contentSim.test.js`

**Interfaces:**
- Consumes: `parseEmbeddingBinary` (`src/services/embeddingService.js`), `blendEmbeddings` (`src/services/embeddingService.js`), `getRelativeWeightCutoff` (or exported helper from `embeddingService.js`)
- Produces:
  - `src/services/contentSimService.js`:
    - `loadDefaultContentIndex(url?: string, customFetch?: Function): Promise<Object | null>`
    - `resetDefaultContentIndexCache(): void`
    - `computeOverviewBigramSim(userOverviewEntries: Array<{ text: string, weight: number }>, candidateOverview: string): number` (opt-in pure-overview fallback only — zero genre/keyword/cast/crew overlap!)
    - `buildContentSimMap(weightedRatings: Array, contentIndex: Object | null, candidates?: Array, options?: { enableOverviewTfIdf?: boolean, collabIndex?: Object | null, blendPivot?: number }): Map<number, number>`

- [ ] **Step 1: Write failing tests in `tests/contentSim.test.js` covering missing/HTML binaries, vector similarity, and `blendEmbeddings` integration**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { encodeEmbeddingBinary } from "../src/services/embeddingService.js";
import {
  loadDefaultContentIndex,
  resetDefaultContentIndexCache,
  buildContentSimMap
} from "../src/services/contentSimService.js";

test("loadDefaultContentIndex degrades gracefully to null on 404 or SPA HTML fallback", async () => {
  resetDefaultContentIndexCache();
  const res404 = await loadDefaultContentIndex("/models/content_embeddings_f16.bin", async () => ({ ok: false, status: 404 }));
  assert.equal(res404, null);

  resetDefaultContentIndexCache();
  const html = new TextEncoder().encode("<!doctype html><html></html>").buffer;
  const resHtml = await loadDefaultContentIndex("/models/content_embeddings_f16.bin", async () => ({
    ok: true,
    headers: new Headers({ "content-type": "text/html" }),
    arrayBuffer: async () => html
  }));
  assert.equal(resHtml, null);
});

test("buildContentSimMap scores 2024+ content-only films and uses blendEmbeddings when both collab and content vectors exist", async () => {
  const collabBuf = encodeEmbeddingBinary([{ tmdbId: 1, vector: [1, 0, 0, 0] }]);
  const contentBuf = encodeEmbeddingBinary([
    { tmdbId: 1, vector: [0.9, 0.435, 0, 0] },      // Watched positive film
    { tmdbId: 202601, vector: [0.92, 0.391, 0, 0] }, // 2026 film absent from collabIndex!
    { tmdbId: 202602, vector: [-0.8, -0.6, 0, 0] }   // Unrelated 2026 film
  ]);

  resetDefaultContentIndexCache();
  const contentIndex = await loadDefaultContentIndex("/models/content_embeddings_f16.bin", async () => ({
    ok: true,
    arrayBuffer: async () => contentBuf
  }));
  const { parseEmbeddingBinary } = await import("../src/services/embeddingService.js");
  const collabIndex = parseEmbeddingBinary(collabBuf);

  const weightedRatings = [{ movie: { tmdbId: 1 }, weight: 1.5, rating: 9 }];
  const simMap = buildContentSimMap(weightedRatings, contentIndex, [{ tmdbId: 202601 }, { tmdbId: 202602 }], {
    collabIndex
  });

  assert.ok(simMap.get(202601) > 0.85, "2024+ film missing from collabIndex gets strong contentSim from overview vector");
  assert.ok(simMap.get(202602) < 0, "unrelated film receives low/negative contentSim");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/contentSim.test.js`
Expected: FAIL (`contentSimService.js` does not exist).

- [ ] **Step 3: Implement `contentSimService.js`, `scripts/build_content_embeddings.mjs`, and wire into `geminiService.js`**

1. Create `src/services/contentSimService.js`:
   - `loadDefaultContentIndex(url = "/models/content_embeddings_f16.bin", customFetch = null)` using shared binary fetch/SPA-HTML guard and `parseEmbeddingBinary`.
   - `buildContentSimMap(weightedRatings = [], contentIndex = null, candidates = [], options = {})`:
     - Build weighted user content vector from `weight > 0` ratings present in `contentIndex` (using `blendEmbeddings(collabVec, contentVec, ratingCount, blendPivot)` when `options.collabIndex` has an aligned space or pure L2-normalized content user vector when separate).
     - Return `Map<tmdbId, cosineSim>` across `contentIndex` (with `options.enableOverviewTfIdf` disabled by default unless Task 6 harness benchmark explicitly validates plot-text bigram cosine as a net win).
   - Export `computeOverviewBigramSim` using **strictly** tokenized `overview` / `plot` text (`keywords`, `genres`, `cast`, `crew` intentionally excluded per Spec §2 Principle 2).
2. Create `scripts/build_content_embeddings.mjs`:
   - Reads a JSON catalog (e.g., TMDB top 25k + recent `2024–2026` releases with `{ tmdbId, title, year, overview, tagline }`), calls Gemini text embedding model (`gemini-embedding-001` via `@google/genai`, `outputDimensionality: 64`) in batches with a resumable JSON cache in `.data/content_embed_cache.json`, L2-normalizes each 64-d vector, and writes `public/models/content_embeddings_f16.bin` using `encodeEmbeddingBinary`.
3. Wire into `getMovieRecommendations` (`src/services/geminiService.js:1326-1367`):
   - Resolve `contentIndex = options.contentIndex !== undefined ? options.contentIndex : await loadDefaultContentIndex()` in parallel with `loadDefaultEmbeddingIndex()`.
   - Build `contentSimMap = options.contentSimMap || buildContentSimMap(profile.weightedRatings, contentIndex, mergedCandidates)` and pass into `reRankCandidatesWithGemini`.

- [ ] **Step 4: Run test suite**

Run: `node --test tests/contentSim.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/contentSimService.js scripts/build_content_embeddings.mjs src/services/geminiService.js tests/contentSim.test.js
git commit -m "feat(content-sim): add runtime content embedding loader/scorer and offline 2024+ content index builder"
```

---

### Task 5: Wire Optional `CDNA`, Activate Mood/Explanation Entry Points, & Clean Up Dead Code

**Files:**
- Modify: `src/services/dnaService.js:1-83`
- Modify: `src/services/tmdbService.js:145-183` (remove dead `signedGenreScores`)
- Modify: `src/services/rankerService.js:6-38, 100-115` (support optional `dnaSim` feature defaulted to weight `0` until Task 6 validates `> 0`)
- Modify: `src/services/geminiService.js:350-450, 1009-1036` (wire spend-cap check cleanly into cascade resolution + export `parseFreeTextMoodWithGemini`)
- Modify: `src/services/geminiExplanationService.js:1-53`
- Modify: `src/components/MovieRecommendations.jsx:420-520, 990-1080`
- Modify: `ARCHITECTURE.md` (sync Implementation Status & remove stale claims)
- Test: `tests/dnaService.test.js`, `tests/pipelineBugs.test.js`

**Interfaces:**
- Consumes: `parseDnaBinary`, `buildUserDnaProfile`, `dnaSim` (`src/services/dnaService.js`), `parseFreeTextMoodWithGemini`, `getRecommendationExplanation`, `spendTracker`
- Produces:
  - `loadDefaultDnaIndex(url?: string, customFetch?: Function): Promise<Object | null>` & `resetDefaultDnaIndexCache()` in `src/services/dnaService.js`
  - `buildDnaSimMap(weightedRatings: Array, dnaIndex: Object | null, minRating?: number): Map<number, number>` in `src/services/dnaService.js`
  - Optional custom AI mood-query parser control & per-card `"Deep Critic Why"` trigger in `src/components/MovieRecommendations.jsx`

- [ ] **Step 1: Write failing tests in `tests/dnaService.test.js` and `tests/pipelineBugs.test.js`**

```javascript
// tests/dnaService.test.js
test("loadDefaultDnaIndex rejects 404/HTML safely and buildDnaSimMap scores matching CDNA films", async () => {
  const { encodeDnaBinary, loadDefaultDnaIndex, resetDefaultDnaIndexCache, buildDnaSimMap } = await import("../src/services/dnaService.js");
  resetDefaultDnaIndexCache();
  assert.equal(await loadDefaultDnaIndex("/models/cinematic_dna_u8.bin", async () => ({ ok: false, status: 404 })), null);

  resetDefaultDnaIndexCache();
  const buf = encodeDnaBinary([
    { tmdbId: 10, axes: [90, 80, 70, 60] },
    { tmdbId: 11, axes: [88, 78, 68, 62] },
    { tmdbId: 12, axes: [10, 20, 30, 40] }
  ]);
  const idx = await loadDefaultDnaIndex("/models/cinematic_dna_u8.bin", async () => ({
    ok: true,
    arrayBuffer: async () => buf
  }));
  const map = buildDnaSimMap([{ movie: { tmdbId: 10 }, rating: 9, weight: 1.2 }], idx);
  assert.ok(map.get(11) > map.get(12));
});
```

Also add a test checking `extractCandidateFeatures` reads `context.dnaSimMap` cleanly (default `0` when absent) and checking `spendTracker.canUseArgon()` skips `argon` models cleanly when spend cap is reached.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/dnaService.test.js tests/pipelineBugs.test.js`
Expected: FAIL (`loadDefaultDnaIndex` / `buildDnaSimMap` missing).

- [ ] **Step 3: Wire `CDNA`, clean dead code, activate free-text mood & deep explanation UI hooks, and sync `ARCHITECTURE.md`**

1. In `src/services/tmdbService.js:152,174`: delete unused `signedGenreScores` accumulator loop.
2. In `src/services/dnaService.js`: add `resetDefaultDnaIndexCache`, `loadDefaultDnaIndex(url = "/models/cinematic_dna_u8.bin", customFetch = null)`, and `buildDnaSimMap(weightedRatings = [], dnaIndex = null, minPositiveRating = 7)`.
3. In `src/services/rankerService.js`: read optional `dnaSim` (`dnaSimMap?.get?.(tmdbId) ?? candidate.dnaSim ?? 0`) in `extractCandidateFeatures` and include `dnaSim: 0` (activated only when Task 6 offline evaluation verifies improvement!) in `DEFAULT_RANKER_WEIGHTS` or optional weights.
4. In `src/services/geminiService.js`: skip any model matching `"argon"` when `!spendTracker.canUseArgon()` and call `spendTracker.markArgonUnavailable()` if an Argon call returns quota/auth error; load optional `dnaIndex` & `dnaSimMap` in `getMovieRecommendations` (no-op when absent).
5. In `src/components/MovieRecommendations.jsx`: wire an optional AI mood bar inside the Filter Deck (`showFilterDeck`) calling `parseFreeTextMoodWithGemini(createGeminiClientOrNull(), query)` on submit (make `parseFreeTextMoodWithGemini` safely return default filters immediately when `ai` is `null` in keyless mode, falling back to preset mood seamlessly) and an on-demand `"Deep Critic Why"` button inside the expanded card panel calling `getRecommendationExplanation` once per card (cached in local component state, never blocking initial load). Ensure `geminiExplanationService.js` shares `createGeminiClient` from Plan 1 (`geminiService.js`).
6. Update `ARCHITECTURE.md` Implementation Status table to reflect live Basket A–D enrichment, Bucket E alignment, `onlineLearningService`, `contentSimService`, optional `CDNA`, and resolved bugs cleanly.

- [ ] **Step 4: Run test suite & production build**

Run: `npm test && npm run build`
Expected: PASS (`0` build errors, all unit tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/services/dnaService.js src/services/tmdbService.js src/services/rankerService.js src/services/geminiService.js src/services/geminiExplanationService.js src/components/MovieRecommendations.jsx ARCHITECTURE.md tests/dnaService.test.js tests/pipelineBugs.test.js
git commit -m "feat(dna,ux): wire optional CDNA/mood/explanation features, enforce spend gate, clean dead signedGenreScores"
```

---

### Task 6: Clean-Index Evaluation Gate (`NegHit@20`, `Unique@30`) & Embedding Shrinkage / Dual-Clock Benchmark

**Files:**
- Modify: `src/services/evalHarness.js:330-475`
- Modify: `scripts/colab_train_embeddings.py:24-105`
- Modify: `scripts/experiments/run_tmdb_eval_suite.mjs`
- Test: `tests/evalRanker.test.js`

**Interfaces:**
- Consumes: `evaluateRanker`, `evaluateRankerRolling` (`src/services/evalHarness.js`), `buildContentSimMap` (`src/services/contentSimService.js`), `buildDnaSimMap` (`src/services/dnaService.js`)
- Produces:
  - Extended metrics in `evaluateRanker`: `{ recallAt20, ndcgAt10, ild, novelty, negHitAt20, uniqueRecommendedCount, medianCandidateVotes }` (with optional `contentIndex`, `dnaIndex`, `profileOptions: { dualClock }`)
  - Parameterized `--norm-power` (default `1.0` = existing Bayesian shrunk dot product) in `scripts/colab_train_embeddings.py`

- [ ] **Step 1: Write failing test in `tests/evalRanker.test.js` verifying `negHitAt20` and `dnaIndex`/`contentIndex` evaluation support**

```javascript
test("evaluateRanker reports negHitAt20 alongside ndcgAt10/recallAt20 and supports negativeThreshold", async () => {
  const { catalog, vaults } = buildSyntheticBenchmark();
  const watched = vaults[0].watched;

  const res = await evaluateRanker({
    watched,
    catalog,
    strategy: "ranker",
    holdoutSize: 10,
    minTrain: 5,
    minHoldoutPositives: 2,
    negativeThreshold: 4
  });

  assert.equal(res.status, "ok");
  assert.equal(typeof res.metrics.negHitAt20, "number");
  assert.ok(res.metrics.negHitAt20 >= 0 && res.metrics.negHitAt20 <= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/evalRanker.test.js`
Expected: FAIL (`res.metrics.negHitAt20` is undefined).

- [ ] **Step 3: Extend `evalHarness.js`, `colab_train_embeddings.py`, and `run_tmdb_eval_suite.mjs` with Clean1/Clean2 validation gates**

1. In `src/services/evalHarness.js`:
   - Track held-out disliked movies (`rating <= negativeThreshold`, default `4`) in `evaluateRanker` to compute `negHitAt20` (fraction of top-20 ranked items matching held-out dislikes, plus `evaluateRankerRolling` tracking `uniqueTop30` & `medianVoteCount` across folds).
   - Accept optional `contentIndex` / `contentSimMap` and `dnaIndex` / `dnaSimMap` options in `evaluateRanker` so new binaries/features (`content_embeddings_f16.bin`, `cinematic_dna_u8.bin`, `dualClock`, overview TF-IDF) can be measured strictly before shipping or bumping weights.
2. In `scripts/colab_train_embeddings.py`:
   - Add CLI flag `--norm-power` (float, default `1.0`, formula `raw_vecs / (norms ** norm_power + shrink)`) for offline `half_norm` (`0.5`) vs shrunk dot (`1.0`) sweeps, keeping default `1.0` locked unless clean evaluation passes.
3. In `scripts/experiments/run_tmdb_eval_suite.mjs`:
   - Add benchmark row comparing baseline (`repulsion=-1.5, negativeKeywordPenalty=-0.5, shrink=1.0, dualClock=false`) vs `dualClock=true`, optional `contentSim` variants, and `--norm-power` variants, requiring paired bootstrap pass (`ΔNDCG@10 > 0` AND `ΔNegHit@20 <= 0`) before updating `public/models/ranker_weights.json` or `DEFAULT_RANKER_WEIGHTS`.

- [ ] **Step 4: Run test suite and clean-eval dry run**

Run: `node --test tests/evalRanker.test.js && npm test`
Expected: PASS (all unit tests green).
Optional post-train verification when MovieLens/TMDB `.data/` snapshots exist locally: `node scripts/experiments/run_tmdb_eval_suite.mjs`.

- [ ] **Step 5: Commit**

```bash
git add src/services/evalHarness.js scripts/colab_train_embeddings.py scripts/experiments/run_tmdb_eval_suite.mjs tests/evalRanker.test.js
git commit -m "feat(eval): add NegHit@20 & Unique@30 gates plus norm-power/dual-clock/content benchmarking"
```
