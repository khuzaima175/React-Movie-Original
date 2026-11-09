# Hybrid Recommender Last-Mile Integration & Architecture v4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last-mile integration gaps between the hybrid recommender services and the live React app by adding a lazy runtime float16 embedding loader (`loadDefaultEmbeddingIndex`), wiring Stage 1 collaborative similarity into `getMovieRecommendations`, fixing `providerMatch` for watch-provider-filtered TMDB discover buckets, enriching UI feedback call-sites, exporting `ranker_weights.json` from the Colab trainer, and updating `ARCHITECTURE.md` to v4.0.

**Architecture:** `embeddingService.js` exposes a memoized browser/custom-fetcher loader (`loadDefaultEmbeddingIndex`) that resolves `/models/item_embeddings_f16.bin` (or gracefully returns `null` when absent). `geminiService.js` and `tmdbService.js` automatically load this index when `options.embeddingIndex` is not explicitly provided, compute the user's z-scored taste vector $u = \sum w_i e_i / \sum |w_i|$, populate `collabSimMap` across the candidate pool, and tag watch-provider-filtered Bucket A/B/C items with `providerMatchedByQuery: true` so `rankerService.js` awards `providerMatch = 1`.

**Tech Stack:** ES Modules (React 18 / Vite 5), Node.js built-in test runner (`node --test`), `TypedArray` / `DataView`, Python 3 (`scikit-learn`, `scipy`, `numpy`, `pandas`).

**Spec:** `docs/superpowers/specs/2026-11-09-hybrid-recommender-design.md`

## Global Constraints

- `loadDefaultEmbeddingIndex` must never throw or reject when `/models/item_embeddings_f16.bin` returns 404 or network error, or when running in Node.js without a custom `fetcher`; it must resolve to `null` so the pipeline falls back seamlessly to TMDB discovery buckets.
- All existing 22 unit tests in `tests/*.test.js` must remain 100% green alongside the new integration tests.
- When `userProviders.length > 0`, candidates harvested from TMDB `/discover/movie` with `with_watch_providers` active must receive `providerMatchedByQuery: true` and `providerMatch === 1` in `extractCandidateFeatures`.

## Review Focus

1. **Missing or 404 `/models/item_embeddings_f16.bin` in production before Colab binary is generated:** `loadDefaultEmbeddingIndex` must resolve to `null` (and cache or allow retry reset via `resetDefaultEmbeddingIndexCache()`) without breaking `getMovieRecommendations`.
2. **Corrupted or HTML fallback response (e.g. SPA router returning `index.html` with status 200 for `/models/item_embeddings_f16.bin`):** `parseEmbeddingBinary` magic header check (`"CVEM"`) inside `loadDefaultEmbeddingIndex` must catch the invalid header and resolve to `null` instead of crashing the recommendation request.
3. **TMDB Bucket A/B/C items when `userProviders` is non-empty:** Raw `/discover/movie` items do not carry `streamProviders`, so `normalizeTmdbItem` must attach `providerMatchedByQuery: true` when `buildProviderFilter(userProviders)` is truthy, and `extractCandidateFeatures` must score `providerMatch = 1`.
4. **Watchlist-add and dismiss feedback events in `MovieRecommendations.jsx`:** Clicking "+ Watchlist" or dismissing a recommendation must pass `tmdbId`, `imdbID`, `matchScoreAtTime: rec.matchScore`, and `sourceBucket: rec.sourceBucket` to `addAiFeedback`.
5. **Colab script logistic regression export (`ranker_weights.json`):** `scripts/colab_train_embeddings.py` must export a valid JSON file whose keys match `DEFAULT_RANKER_WEIGHTS` in `src/services/rankerService.js`.

---

## File Map

- **Modify:** `src/services/embeddingService.js` — Add `loadDefaultEmbeddingIndex(url?, fetcher?)` and `resetDefaultEmbeddingIndexCache()`.
- **Modify:** `src/services/geminiService.js` — Auto-load `embeddingIndex` via `loadDefaultEmbeddingIndex()` when `options.embeddingIndex` is omitted, compute `userVec` + `collabSimMap` via `computeUserEmbedding` and `retrieveByEmbedding`, and pass `collabSimMap` into `reRankCandidatesWithGemini`.
- **Modify:** `src/services/tmdbService.js` — Tag items returned by `fetchBucketA`, `fetchBucketB`, and `fetchBucketC` with `providerMatchedByQuery: Boolean(providerFilter)`.
- **Modify:** `src/services/rankerService.js` — Update `extractCandidateFeatures` so `providerMatch` is `1` when `candidate.providerMatchedByQuery === true`.
- **Modify:** `src/components/MovieRecommendations.jsx` — Pass `tmdbId`, `imdbID`, `matchScoreAtTime: rec.matchScore`, and `sourceBucket: rec.sourceBucket` into `addAiFeedback` on watchlist add and dismissal.
- **Modify:** `scripts/colab_train_embeddings.py` — Add `--weights-out` (`public/models/ranker_weights.json`) export alongside `item_embeddings_f16.bin`.
- **Modify:** `ARCHITECTURE.md` — Upgrade specification from v3.1 to v4.0 (Z-Scored Taste Vector, 180-Day Bulk-Import Decay Prior, Stage 1 Float16 Collaborative Embeddings, Stage 3 Calibrated Logistic Ranker, Offline Evaluation Harness).

---

### Task 1: Lazy Runtime Float16 Embedding Loader & Stage 1 Collaborative Wiring

**Files:**
- Modify: `src/services/embeddingService.js`
- Modify: `src/services/geminiService.js`
- Test: `tests/embeddingService.test.js`

**Interfaces:**
- Consumes: `parseEmbeddingBinary`, `computeUserEmbedding`, `retrieveByEmbedding` in `src/services/embeddingService.js`
- Produces:
  - `loadDefaultEmbeddingIndex(url?: string, customFetch?: Function) -> Promise<object | null>`
  - `resetDefaultEmbeddingIndexCache() -> void`
  - `buildCollabSimMapFromIndex(weightedRatings: Array, embeddingIndex: object | null) -> Map<number, number>`

- [ ] **Step 1: Write the failing tests in `tests/embeddingService.test.js`**

```javascript
import {
  encodeEmbeddingBinary,
  parseEmbeddingBinary,
  computeUserEmbedding,
  blendEmbeddings,
  retrieveByEmbedding,
  loadDefaultEmbeddingIndex,
  resetDefaultEmbeddingIndexCache,
  buildCollabSimMapFromIndex
} from "../src/services/embeddingService.js";

test("loadDefaultEmbeddingIndex loads and caches valid CVEM binary and returns null on 404 or SPA HTML fallback", async () => {
  resetDefaultEmbeddingIndexCache();
  const validBuf = encodeEmbeddingBinary([
    { tmdbId: 603, vector: [0.8, 0.6, 0, 0] },
    { tmdbId: 155, vector: [0.6, 0.8, 0, 0] }
  ]);

  let fetchCalls = 0;
  const mockFetchOk = async () => {
    fetchCalls++;
    return { ok: true, arrayBuffer: async () => validBuf };
  };

  const idx1 = await loadDefaultEmbeddingIndex("/models/item_embeddings_f16.bin", mockFetchOk);
  const idx2 = await loadDefaultEmbeddingIndex("/models/item_embeddings_f16.bin", mockFetchOk);
  assert.ok(idx1);
  assert.equal(idx1.count, 2);
  assert.equal(idx1, idx2);
  assert.equal(fetchCalls, 1, "memoizes promise across calls");

  // SPA HTML fallback (status 200 returning <!DOCTYPE html> instead of CVEM binary)
  resetDefaultEmbeddingIndexCache();
  const htmlBytes = new TextEncoder().encode("<!DOCTYPE html><html><body>Not found</body></html>").buffer;
  const idxHtml = await loadDefaultEmbeddingIndex("/models/item_embeddings_f16.bin", async () => ({
    ok: true,
    arrayBuffer: async () => htmlBytes
  }));
  assert.equal(idxHtml, null, "gracefully returns null when SPA returns HTML instead of CVEM binary");
});

test("buildCollabSimMapFromIndex computes cosine similarity map for all items in index", () => {
  const index = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 10, vector: [1, 0, 0, 0] },
    { tmdbId: 20, vector: [0.8, 0.6, 0, 0] }
  ]));
  const simMap = buildCollabSimMapFromIndex([{ movie: { tmdbId: 10 }, weight: 1.5 }], index);
  assert.ok(simMap instanceof Map);
  assert.ok(Math.abs(simMap.get(20) - 0.8) < 0.01);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/embeddingService.test.js`
Expected: FAIL (`loadDefaultEmbeddingIndex` not exported from `../src/services/embeddingService.js`)

- [ ] **Step 3: Implement `loadDefaultEmbeddingIndex`, `resetDefaultEmbeddingIndexCache`, and `buildCollabSimMapFromIndex` in `src/services/embeddingService.js`, and wire into `src/services/geminiService.js`**

1. In `src/services/embeddingService.js`:
   ```javascript
   let cachedEmbeddingIndexPromise = null;

   export function resetDefaultEmbeddingIndexCache() {
     cachedEmbeddingIndexPromise = null;
   }

   export function loadDefaultEmbeddingIndex(url = "/models/item_embeddings_f16.bin", customFetch = null) {
     const fetchFn = customFetch || (typeof window !== "undefined" && typeof window.fetch === "function" ? window.fetch.bind(window) : null);
     if (!fetchFn) return Promise.resolve(null);
     if (!cachedEmbeddingIndexPromise) {
       cachedEmbeddingIndexPromise = Promise.resolve()
         .then(() => fetchFn(url))
         .then(res => (res && res.ok ? res.arrayBuffer() : null))
         .then(buf => (buf ? parseEmbeddingBinary(buf) : null))
         .catch(() => null);
     }
     return cachedEmbeddingIndexPromise;
   }

   export function buildCollabSimMapFromIndex(weightedRatings = [], index = null) {
     const map = new Map();
     if (!index) return map;
     const userVec = computeUserEmbedding(weightedRatings, index);
     if (!userVec) return map;
     const allNeighbors = retrieveByEmbedding(userVec, index, new Set(), index.count);
     for (const item of allNeighbors) {
       map.set(item.tmdbId, item.collabSim);
     }
     return map;
   }
   ```
2. In `src/services/geminiService.js`:
   - Import `loadDefaultEmbeddingIndex` and `buildCollabSimMapFromIndex` from `./embeddingService.js`.
   - Inside `getMovieRecommendations`, resolve `const embeddingIndex = options.embeddingIndex !== undefined ? options.embeddingIndex : await loadDefaultEmbeddingIndex();` and `const collabSimMap = options.collabSimMap || buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);`, passing `{ ...options, embeddingIndex, collabSimMap }` into `reRankCandidatesWithGemini`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/embeddingService.test.js`
Expected: PASS (6/6 tests passing)

- [ ] **Step 5: Commit**

```bash
git add src/services/embeddingService.js src/services/geminiService.js tests/embeddingService.test.js
git commit -m "feat(embeddings): wire lazy runtime float16 index loader and collabSimMap into recommender"
```

---

### Task 2: Fix `providerMatch` for Watch-Provider-Filtered Buckets & Enrich UI Feedback Calls

**Files:**
- Modify: `src/services/tmdbService.js`
- Modify: `src/services/rankerService.js`
- Modify: `src/components/MovieRecommendations.jsx`
- Modify: `scripts/colab_train_embeddings.py`
- Modify: `ARCHITECTURE.md`
- Test: `tests/rankerService.test.js`

**Interfaces:**
- Consumes: `extractCandidateFeatures` in `src/services/rankerService.js`, `normalizeTmdbItem` in `src/services/tmdbService.js`
- Produces:
  - `providerMatchedByQuery: boolean` on normalized TMDB bucket items when `userProviders.length > 0`
  - `providerMatch: 1` in `extractCandidateFeatures` when `candidate.providerMatchedByQuery === true`
  - `public/models/ranker_weights.json` export in `scripts/colab_train_embeddings.py`
  - `ARCHITECTURE.md` v4.0 documentation

- [ ] **Step 1: Write the failing test in `tests/rankerService.test.js`**

```javascript
test("extractCandidateFeatures sets providerMatch=1 when candidate.providerMatchedByQuery is true", () => {
  const feats = extractCandidateFeatures(
    { id: 55, tmdbId: 55, genre_ids: [878], vote_average: 7.5, vote_count: 400, providerMatchedByQuery: true },
    { profile: { lovedGenreIds: [878] }, userProviders: [8, 9] }
  );
  assert.equal(feats.providerMatch, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/rankerService.test.js`
Expected: FAIL (`feats.providerMatch` is `0` instead of `1`)

- [ ] **Step 3: Implement `providerMatchedByQuery` in `tmdbService.js` and `rankerService.js`, enrich `addAiFeedback` calls in `MovieRecommendations.jsx`, add `ranker_weights.json` export to `scripts/colab_train_embeddings.py`, and update `ARCHITECTURE.md` to v4.0**

1. In `src/services/tmdbService.js`:
   - Update `normalizeTmdbItem(m, sourceBucket = "TMDB", providerMatchedByQuery = false)` to include `providerMatchedByQuery: Boolean(providerMatchedByQuery)`.
   - Pass `Boolean(buildProviderFilter(options.userProviders))` to `normalizeTmdbItem` in `fetchBucketA`, `fetchBucketB`, and `fetchBucketC`.
2. In `src/services/rankerService.js`:
   - Update `providerMatch`:
     ```javascript
     const providerMatch = providerSet.size === 0
       ? 0.5
       : (candidate.providerMatchedByQuery || candProviders.some(id => providerSet.has(Number(id))) ? 1 : 0);
     ```
3. In `src/components/MovieRecommendations.jsx`:
   - In `handleAdd` and `handleDismiss`, include `tmdbId: rec.tmdbId ?? rec.id ?? null`, `imdbID: rec.imdbID ?? null`, `matchScoreAtTime: rec.matchScore ?? null`, and `sourceBucket: rec.sourceBucket ?? null` in the object passed to `addAiFeedback`.
4. In `scripts/colab_train_embeddings.py`:
   - Add `--weights-out` (default `"public/models/ranker_weights.json"`) and write calibrated logistic ranker weights JSON matching `DEFAULT_RANKER_WEIGHTS`.
5. In `ARCHITECTURE.md`:
   - Update header and sections to v4.0 covering: (a) Z-Scored Rating Weights & 180-Day Bulk-Import Decay Prior (`scoringUtils.js`), (b) Stage 1 Client-Side Float16 Collaborative Embeddings (`embeddingService.js` & `CVEM` v1 binary layout), (c) Stage 3 Calibrated Logistic Ranker (`rankerService.js`), (d) Offline Temporal Holdout Evaluation Harness & Grid Search (`evalHarness.js`), and (e) Non-Mutating `v4_` Cache Hash & Pipe `|` OR `with_cast` grammar.

- [ ] **Step 4: Run test suite and production build to verify everything passes**

Run: `npm test && npm run build`
Expected: PASS (25/25 unit tests passing, Vite build exits 0)

- [ ] **Step 5: Commit**

```bash
git add src/services/tmdbService.js src/services/rankerService.js src/components/MovieRecommendations.jsx scripts/colab_train_embeddings.py ARCHITECTURE.md tests/rankerService.test.js
git commit -m "feat(recommender,docs): fix providerMatch on discover buckets, enrich UI feedback, and update ARCHITECTURE.md to v4.0"
```
