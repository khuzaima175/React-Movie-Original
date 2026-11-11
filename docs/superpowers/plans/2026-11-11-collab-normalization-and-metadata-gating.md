# Pool-Relative collabSim Normalization & Metadata Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the logit-spread imbalance between shrunken collaborative embeddings and $[0, 1]$ metadata features by dynamically scaling positive `collabSim` to $[0, 1]$ per candidate pool and damping coarse metadata features when collaborative signal exists.

**Architecture:** In `src/services/rankerService.js`, `rankCandidatePool` computes `maxPoolCollab` across the candidate pool and normalizes positive candidate `collabSim` by `collabScale`. In `scoreCandidate`, if `hasCollabSignal` is true (`|collabSim| > 0.001`), the contributions of `genreOverlap` and `bayesianRatingNorm` are damped (default `0.25x`), allowing precise taste-twin items to reach top-10 ranks while preserving full metadata power for cold-start and non-embedding items.

**Tech Stack:** JavaScript (ESM), Node.js test runner (`node --test`), Vite.

**Spec:** User prompt instructions (Steps 1–4).

## Global Constraints

- Never break existing cold-start or unit test behavior when `collabSim === 0`.
- Preserve `features.rawCollabSim` alongside the normalized `features.collabSim`.
- `collabScale` floor: if `maxPoolCollab <= 0.05`, `collabScale` must be `1.0` (no division by tiny values or zero).
- Keep `.data/small_ref.bin` as rollback backup.
- All 59 existing unit tests in `npm test` must continue passing.

## Review Focus

1. **Zero / negative collaborative pool**: When all candidates have `collabSim <= 0` or missing maps, `maxPoolCollab <= 0.05` ensures `collabScale = 1.0` with no division by zero or NaN.
2. **Cold-start candidates (`collabSim === 0`)**: `hasCollabSignal` must evaluate to `false`, keeping `genreOverlap` and `bayesianRatingNorm` at 1.0x strength so synthetic benchmarks and unindexed films are not degraded.
3. **Preservation of unnormalized value**: `features.rawCollabSim` must retain the exact raw dot product for debugging, badge generation, or logging.
4. **Custom damping factor pass-through**: `scoreCandidate` and `rankCandidatePool` must accept an optional `options.metadataDampingFactor` (default `0.25`) to allow offline tuning.
5. **No mutation of input candidate objects**: Features must be extracted and transformed on the returned candidate wrapper or feature object without corrupting raw candidate properties.

---

### Task 1: Implement Pool-Relative collabSim Normalization & Metadata Gating

**Files:**
- Modify: `src/services/rankerService.js:110-195`
- Test: `tests/rankerService.test.js`

**Interfaces:**
- Consumes: `extractCandidateFeatures(candidate, context)`
- Produces:
  - `scoreCandidate(features, weights, options)` where `options.metadataDampingFactor` defaults to `0.25`.
  - `rankCandidatePool(candidates, context, weights, topK, options)` where `features.rawCollabSim` is populated and `features.collabSim` is scaled.

- [ ] **Step 1: Write the failing unit tests in `tests/rankerService.test.js`**

Add tests to `tests/rankerService.test.js`:
```javascript
test("scoreCandidate damps genreOverlap and bayesianRatingNorm when hasCollabSignal is true", () => {
  const withCollab = {
    collabSim: 0.8,
    genreOverlap: 1.0,
    bayesianRatingNorm: 0.8
  };
  const withoutCollab = {
    collabSim: 0.0,
    genreOverlap: 1.0,
    bayesianRatingNorm: 0.8
  };
  const weights = { bias: 0, collabSim: 0, genreOverlap: 2.0, bayesianRatingNorm: 2.0 };
  const scoreWith = scoreCandidate(withCollab, weights, { metadataDampingFactor: 0.25 });
  const scoreWithout = scoreCandidate(withoutCollab, weights, { metadataDampingFactor: 0.25 });

  // With collab, genre and rating should contribute (1.0*2 + 0.8*2)*0.25 = 0.9 logit
  assert.ok(Math.abs(scoreWith.logit - 0.9) < 1e-4);
  // Without collab, full strength: 1.0*2 + 0.8*2 = 3.6 logit
  assert.ok(Math.abs(scoreWithout.logit - 3.6) < 1e-4);
});

test("rankCandidatePool normalizes collabSim pool-relatively and preserves rawCollabSim", () => {
  const candidates = [
    { id: 1, tmdbId: 1, collabSim: 0.15 },
    { id: 2, tmdbId: 2, collabSim: 0.30 },
    { id: 3, tmdbId: 3, collabSim: 0.0 }
  ];
  const ranked = rankCandidatePool(candidates, {}, undefined, 3);
  const top = ranked.find(c => c.tmdbId === 2);
  const mid = ranked.find(c => c.tmdbId === 1);
  const zero = ranked.find(c => c.tmdbId === 3);

  assert.equal(top.features.rawCollabSim, 0.30);
  assert.equal(top.features.collabSim, 1.0); // 0.30 / 0.30
  assert.equal(mid.features.rawCollabSim, 0.15);
  assert.equal(mid.features.collabSim, 0.5);  // 0.15 / 0.30
  assert.equal(zero.features.collabSim, 0.0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/rankerService.test.js`
Expected: FAIL due to missing damping and missing `rawCollabSim` / normalization logic.

- [ ] **Step 3: Implement pool normalization and metadata gating in `src/services/rankerService.js`**

1. In `scoreCandidate(features = {}, weights = DEFAULT_RANKER_WEIGHTS, options = {})`:
   - Compute `const hasCollabSignal = Math.abs(Number(features.collabSim || 0)) > 0.001;`
   - Compute `const damping = options.metadataDampingFactor ?? 0.25;`
   - In the weight loop, when `hasCollabSignal && (key === "genreOverlap" || key === "bayesianRatingNorm")`, scale `x *= damping`.
2. In `rankCandidatePool(candidates = [], context = {}, weights = DEFAULT_RANKER_WEIGHTS, topK = 30, options = {})`:
   - Scan candidates and `context.collabSimMap` to compute `maxPoolCollab`.
   - Set `const collabScale = maxPoolCollab > 0.05 ? maxPoolCollab : 1.0;`.
   - For each candidate, record `features.rawCollabSim = features.collabSim;`.
   - If `features.collabSim > 0 && maxPoolCollab > 0.05`, set `features.collabSim = Math.min(1.0, features.collabSim / collabScale);`.
   - Pass `options` to `scoreCandidate(features, weights, options)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/rankerService.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All 61 tests PASS with 0 failures.

---

### Task 2: Run Benchmark Eval & Tune Damping Factor

**Files:**
- Create scratch / runner: `.data/eval_damping_sweep.mjs`
- Modify: `src/services/rankerService.js` (apply optimal default damping)
- Test: `scripts/run_eval.mjs`

**Interfaces:**
- Consumes: `evaluateRankerRolling` from `src/services/evalHarness.js`, `.data/benchmark_vaults.json`, `public/models/item_embeddings_f16.bin`
- Produces: Evaluation reports for damping factors 0.15, 0.25, and 0.35.

- [ ] **Step 1: Write tuning script `.data/eval_damping_sweep.mjs`**

Evaluate damping factors `[0.15, 0.25, 0.35, 0.50, 1.0]` across all 4 MovieLens benchmark vaults (3 folds) and synthetic benchmark vaults:
- Record MovieLens NDCG@10, Recall@20, Novelty.
- Record Synthetic NDCG@10, Recall@20.

- [ ] **Step 2: Run the sweep**

Run: `node .data/eval_damping_sweep.mjs`
Expected: Output showing NDCG@10 progression and identifying the optimal factor maximizing MovieLens metrics without harming synthetic vaults.

- [ ] **Step 3: Update `DEFAULT_RANKER_WEIGHTS` or default damping parameter in `src/services/rankerService.js`**

Set the tuned default damping factor in `scoreCandidate` and update `public/models/ranker_weights.json` if weights require synchronization.

- [ ] **Step 4: Run official benchmark evaluation**

Run:
- `node scripts/run_eval.mjs --benchmark .data/benchmark_vaults.json --embeddings public/models/item_embeddings_f16.bin --out .data/eval_gated_32m.json`
- `node scripts/run_eval.mjs --synthetic --out .data/eval_gated_synth.json`
Verify: MovieLens NDCG@10 >= 0.150 and Recall@20 >= 0.230.

---

### Task 3: Clean Up Untracked Temporary Diagnostic Scripts

**Files:**
- Remove:
  - `.data/cmp.mjs`
  - `.data/diag.mjs`
  - `.data/diag2.mjs`
  - `.data/check_leak.py`
  - `.data/tune_weights.mjs`
  - `.data/tune_collab.mjs`
  - `.data/inspect_ranks.mjs`
  - `.data/test_synergy.mjs`
  - `.data/eval_damping_sweep.mjs`
  - `.data/ml32_clean.bin`
- Preserve:
  - `.data/small_ref.bin` (rollback backup)
  - `public/models/item_embeddings_f16.bin`

- [ ] **Step 1: Delete temporary files**

Command:
```powershell
Remove-Item -Path .data/cmp.mjs, .data/diag.mjs, .data/diag2.mjs, .data/check_leak.py, .data/tune_weights.mjs, .data/tune_collab.mjs, .data/inspect_ranks.mjs, .data/test_synergy.mjs, .data/eval_damping_sweep.mjs, .data/ml32_clean.bin -ErrorAction SilentlyContinue
```

- [ ] **Step 2: Verify backup preservation**

Command:
```powershell
Test-Path .data/small_ref.bin; Test-Path public/models/item_embeddings_f16.bin
```
Expected: Both return `True`.

---

### Task 4: Final Full-Suite Verification & Milestone Reporting

**Files:**
- Read: `.data/eval_small.json`, `.data/eval_final_32m.json`, `.data/eval_gated_32m.json`

- [ ] **Step 1: Run complete test suite**

Command: `npm test`
Expected: All tests pass (>= 60 tests, 0 failures).

- [ ] **Step 2: Run production build**

Command: `npm run build`
Expected: Build succeeds with zero errors.

- [ ] **Step 3: Check git status**

Command: `git status --short`
Expected: Clean working tree with only expected modified and newly added plan/service files.

- [ ] **Step 4: Report Before-and-After Metrics Table**

Compare:
1. Baseline Small (`eval_small.json`)
2. Initial 32M Clean (`eval_final_32m.json`)
3. Gated & Normalized 32M Clean (`eval_gated_32m.json`)
Display NDCG@10, Recall@20, and Novelty.
