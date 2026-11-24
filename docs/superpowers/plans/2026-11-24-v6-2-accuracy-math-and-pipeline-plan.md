# CinemaVault v6.2 Accuracy Math & Pipeline Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the remaining mathematical leaks and retrieval blindspots in CinemaVault `v6.1` (reverse-edge EASE^R pruning loss, cold-start retrieval & anisotropy, rater-scale bias in EASE^R, Explore score distortion, LLM prestige-bias eviction, and unused Studio/Watchlist signals) through strictly leakage-clean, Hard-Gate-verified upgrades.

**Architecture:** Every math and LLM change is isolated into an independently testable task gated against the canonical 300-user MovieLens 32M chronological holdout (`Dev-150` tuning, untouched `Holdout-150` 4-part Hard Ship Gate, `All-300` reporting), a 100%-cold masked holdout for `2024–2026` cold-start tasks, and an `n = 50` paired LLM holdout for Gemini curation. Deterministic pipeline bugs (`Explore For You` score lock, Bucket D provider alias expansion, multi-persona Bucket B / multi-auteur Bucket C) ship via strict TDD with zero benchmark regression; all offline math hypotheses enter `src/services/` or `public/models/` ONLY on `GATE: PASS` and are logged as clean negative results in `MODEL_REFINEMENT_LOG.md` on `GATE: FAIL`.

**Tech Stack:** JavaScript (ES Modules, Node `node --test`), Python 3 (`numpy`, `scipy`, `pandas`, `scikit-learn`, `sentence-transformers`), `CVEA v1` (Sparse EASE^R float16 binary), `CVEM v1` (SVD-64 & semantic content float16 binaries), Google GenAI SDK (`gemini-3.5-flash-lite`, `gemini-4-hydrogen`), Vite 5.

**Spec:** [MODEL_REFINEMENT_LOG.md](../../../MODEL_REFINEMENT_LOG.md) (`v6.1` locked baseline & Experiment 1–12 lessons), [ARCHITECTURE.md](../../../ARCHITECTURE.md) (`v6.1` mathematical specification), and [LOCAL_MODEL_GUIDE.md](../../../LOCAL_MODEL_GUIDE.md).

## Global Constraints

- **Zero Leakage Rule:** Every offline training run MUST exclude all `625` mapped + fresh evaluation users (`.data/user_id_map.json` + `.data/fresh_300_exclude_ids.json`) before fitting any EASE^R, SVD, cold projector, or ranker calibration model. Production binaries (`public/models/*`) are retrained on 100% of MovieLens 32M ONLY after the clean twin passes the Holdout-150 gate.
- **4-Part Hard Ship Gate on Untouched `Holdout-150` (`scripts/experiments/v6_gate_eval.mjs`):**
  1. **Significant Primary Gain:** Paired bootstrap 95% CI (`1,000` resamples, `seed = 42`) lower bound `ciLower > 0` on `NDCG@20` or `NDCG@10` (with zero significant regression on the other).
  2. **No Popularity Cheating:** Long-Tail `Tail@20` (hits outside top-200 TMDB `vote_count`) must stay `>= -1.0%` vs. prior checkpoint, and `AvgV` must not rise `> +12%` without positive `Tail@20` lift.
  3. **No Diversity Collapse:** Unique Catalog Coverage (`Cov`) across `Holdout-150` Top-20s must stay `>= 92%` of prior checkpoint.
  4. **Latency & Asset Budget:** Client scoring must stay `< 25 ms/user`; any extra binary size in `public/models/` must deliver `>= +1.0%` `Holdout-150` `NDCG@20` lift per `+1 MB`.
- **Cold-Start Isolation Invariant:** Cold-start models (`content_embeddings_f16.bin`, cold projector, `Bucket E-Cold`) MUST maintain `0.000` warm-item dilution on indexed collaborative movies (`coldOnly: true`).
- **Mood & Taste-Rule Sovereignty:** No math, retrieval, or LLM fusion upgrade may bypass explicit Mood hard gates (`matchesMoodCandidateGate`), streaming verification (`matchesWatchProviders`), or `avoidRules` (`candidateMatchesAvoidRule`).
- **Graceful Degradation & Parity:** Every binary asset (`item_ease_k64.cvea`, `item_embeddings_f16.bin`, `content_embeddings_f16.bin`, optional cold projector) MUST degrade to `null` cleanly in offline Node tests, 404s, and SPA HTML fallbacks; `public/models/ranker_weights.json` MUST stay in exact `deepEqual` parity with `DEFAULT_RANKER_WEIGHTS`; `npm test` and `npm run build` MUST exit `0` after every shipped task.

## Review Focus

- **Generous-rater / zero-variance / single-watch vaults under reverse-edge + z-scored EASE^R:** When a user rates every film `9/10` (`rawStd = 0`) or has only `1` indexed film, `buildEaseSimMapFromIndex` must produce finite positive neighbor scores without `NaN`, division-by-zero, or negative-flipping liked `7★` films; pinned in Task 1 (`tests/easeService.test.js`).
- **Null/absent `easeIndex` & unindexed `2026` releases in `tasteMatchService.js`:** `predictMovieMatch` with `easeIndex: null` must remain bit-identical to SVD-only baseline, and an unindexed `2026` film or a warm film with zero EASE^R overlap must NEVER suffer sparse zero-compression below its dense `SVD-64` score; pinned in Task 3 (`tests/tasteMatchService.test.js`).
- **`Bucket E-Cold` warm leakage & explicit Mood / Avoid-Rule bypass:** `retrieveColdContentNeighbors` must strictly exclude warm `collabIndex` films, watched/watchlist IDs, and pass live `matchesMoodCandidateGate` + `candidateMatchesAvoidRule` filtering so cold `2024–2026` horror films cannot sneak into `comfort-watch`; pinned in Task 4 (`tests/contentSimService.test.js` & `tests/moodRanker.test.js`).
- **Explicit Mood invariance & tiny-vault shrinkage discontinuity in `rankerService.js`:** Non-linear popularity calibration, vault-size `collabSim` shrinkage, and cold-crew amplification must preserve explicit Mood gating, keep `ranker_weights.json` parity exact, and degrade smoothly at `0`, `1`, `3`, `10`, and `100` watched films; pinned in Task 5 (`tests/rankerService.test.js` & `tests/moodRanker.test.js`).
- **Zero boilerplate prose on post-hoc protected picks & variety-cap preservation in `geminiService.js`:** Under `100 → 25 Over-Pitch → 20 Logit Fusion`, every final pick (including protected top-2 math anchors) must carry a Gemini-authored pitch whenever available, never emit internal rank/tag jargon via `sanitizeOracleReason`, and strictly honor `maxPerDirector: 2` / `maxPerCollection: 1` and `avoidRules`; pinned in Task 7 (`tests/geminiDualEngine.test.js`).

---

## File Structure & Responsibility Map

| File | Action | Responsibility |
| :--- | :---: | :--- |
| `scripts/experiments/sweep_v6_2_ease_client.mjs` | Create | `Dev-150` / `Holdout-150` Hard-Gate sweep for bidirectional reverse-edge EASE^R recovery & z-scored implicit input weighting. |
| `scripts/experiments/train_sparse_ease.py` | Modify | Add `--session-tau-days` temporal-proximity Gram weighting and `--forward-eta` causal forward transition blending (`t_j > t_i`) before top-`K` pruning. |
| `scripts/experiments/eval_taste_match_v6_2.mjs` | Create | 300-user `withinAUC` / `vsCatalogAUC` / `vsPoolAUC` Hard-Gate evaluator for support-gated bidirectional EASE^R residual in `tasteMatchService.js`. |
| `scripts/experiments/train_cold_projector.py` | Create | Leakage-clean offline Ridge/MLP projector (`MiniLM + genres + crew + keywords -> 64-D SVD space`) trained on `9,620` warm overlap films and benchmarked on 100%-cold `Holdout-150`. |
| `scripts/experiments/eval_cold_v6_2.mjs` | Create | 100%-cold masked holdout evaluator (`Dev-150` / `Holdout-150`) comparing `v6.1` single-mean MiniLM vs. multi-persona mean-centered MiniLM vs. cross-space 64-D cold projector. |
| `scripts/experiments/eval_nonlinear_ranker_v6_2.mjs` | Create | `Dev-150` / `Holdout-150` Hard-Gate evaluator (overall + `3–10` small-vault + 100%-cold strata) for user-calibrated popularity affinity, vault-size collab shrinkage, and cold-gated crew/cast boost. |
| `scripts/experiments/eval_math_anchor_llm.mjs` | Modify | Extend to `n = 50` unseen `Holdout-150` users comparing Control A (`100 → 20`) vs. `100 → 25 Over-Pitch → 20 Logit Fusion` + Kernel MMR shortlist (zero prompt tags). |
| `src/services/easeService.js` | Modify *(if gated)* | Add optional reverse-edge lookup (`reverseAlpha`), calibrated implicit+z-score `x_i`, and light watchlist intent (`watchlistWeight`) inside `buildEaseSimMapFromIndex` + `computeBidirectionalEaseScoreForItem`. |
| `src/services/tasteMatchService.js` | Modify *(if gated)* | Wire support-gated positive-residual bidirectional EASE^R boost alongside dense `SVD-64` without zero-compression. |
| `src/services/contentSimService.js` | Modify | Fix `rating >= 7` guard, remove dead `64 === 128` `blendAligned` branch, add catalog-mean centering + multi-persona K-Means mixture *(if cold-gated)*, and export `retrieveColdContentNeighbors` (`Bucket E-Cold`). |
| `src/services/rankerService.js` & `public/models/ranker_weights.json` | Modify *(if gated)* | Add Holdout-150-verified non-linear calibration terms + Kernel MMR outlier selection in `buildDiversifiedGeminiShortlist`. |
| `src/services/tmdbService.js` | Modify | Multi-persona medoid Bucket B, multi-auteur top-3 Bucket C, Bucket D `expandAliases: true` fix, and craft-breakdown / rewatch magnitude hooks in `extractTasteProfile`. |
| `src/services/exploreForYouService.js` | Modify | Lock Wave-3 `forYouScore` / `matchScore` to calibrated local ranker scores (ask Flash-Lite strictly for `tag` + `r`, eliminating prestige-bias score overrides) and wire `Bucket E-Cold`. |
| `src/services/geminiService.js` | Modify | Wire `Bucket E-Cold` injection, multi-persona Bucket B anchors, and *(if `n=50` gated)* `100 → 25 Over-Pitch → 20 Logit Fusion` in `reRankCandidatesWithGemini` / `mergeGeminiExplanationsWithRanker`. |
| `src/services/onlineLearningService.js` | Modify | Reason-typed dismissal handling (`"Too slow"` / `"Predictable"` vs `"Not my genre"`) so pacing rejections do not corrupt `collabSim` weight. |
| `tests/*.test.js` | Modify | Pin all new interfaces, edge cases, and Review Focus invariants. |
| `MODEL_REFINEMENT_LOG.md`, `ARCHITECTURE.md`, `LOCAL_MODEL_GUIDE.md` | Modify | Record every kept & rejected `v6.2` experiment with exact `Dev-150` / `Holdout-150` numbers and sync drifted `v5.6` body constants (`39 → 10` → `100 → 20`). |

---

### Task 1: Bidirectional Reverse-Edge EASE^R Recovery & Z-Scored Implicit Weighting (`easeService.js`)

**Files:**
- Create: `scripts/experiments/sweep_v6_2_ease_client.mjs`
- Modify *(only if Gate passes)*: `src/services/easeService.js:138-193`
- Test: `tests/easeService.test.js`

**Interfaces:**
- Consumes: `loadCleanCohort`, `loadEaseIndexFromPath`, `evaluatePipeline`, `checkShipGate` (`scripts/experiments/v6_gate_eval.mjs`); `.data/v6_lab/v6_baseline.json`.
- Produces *(if gated)*:
  - `buildEaseSimMapFromIndex(weightedRatings, easeIndex, options)` supporting `{ negWeight, reverseAlpha, useCalibratedZ, watchlistItems, watchlistWeight }`.
  - `computeBidirectionalEaseScoreForItem(tmdbId, watchedWeightByIdx, easeIndex, options)` -> `{ forward: number, reverse: number, supportCount: number, combined: number }` (reused by Task 3 `tasteMatchService.js`).

- [ ] **Step 1: Implement `scripts/experiments/sweep_v6_2_ease_client.mjs` and run `Dev-150` sweep**

Test strictly on `Dev-150` against locked `.data/v6_lab/v6_baseline.json` (zero extra binary bytes on `.data/v6_lab/ease_v6_baseline_clean.cvea`):
1. **Reverse-edge recovery:** For every candidate index `c` in `0..count-1`, scan `c`'s `K=64` stored neighbors `nbrIdx[c*K + k]` against `watchedWeightByIdx[target]` to recover pruned blockbuster→cult edges (`scores[c] += reverseAlpha * watchedWeightByIdx[target] * nbrW[c*K + k]`) across `reverseAlpha ∈ {0.0, 0.10, 0.20, 0.30, 0.45}` (testing both unscaled and degree-damped `1 / sqrt(inDegree[c] + 10)` variants).
2. **Implicit + calibrated z-score input curve:** Compare current hardcoded `7→0.85..10→1.30` against `x_i = b + a * sigmoid(z_i) * (0.7 + 0.3 * timeDecay)` across `(b, a) ∈ {(0.50, 0.70), (0.60, 0.65), (0.65, 0.55)}` (retaining `x_i = negWeight` when `rating <= 4` or `rating <= 5 && zScore < -0.9`).
3. **Combined best Dev-150 pair**, then run **4-Part Hard Ship Gate** on untouched `Holdout-150`.

Run:
```bash
node scripts/experiments/sweep_v6_2_ease_client.mjs --baseline .data/v6_lab/v6_baseline.json
```
Expected: Prints `DEV-150` grid and `HOLDOUT-150` `GATE: PASS | FAIL` with `NDCG@10`, `NDCG@20`, `Tail@20`, `Cov`, `AvgV`, `ms/user`.
- **If `GATE: FAIL`:** Do NOT alter `buildEaseSimMapFromIndex` defaults; still keep `computeBidirectionalEaseScoreForItem` internal to Task 3 if Task 3 passes, log exact numbers for Task 9, and proceed to Task 2.
- **If `GATE: PASS`:** Proceed to Steps 2–6.

- [ ] **Step 2: Write failing tests in `tests/easeService.test.js` (including Review Focus #1)**

```js
test("buildEaseSimMapFromIndex recovers pruned blockbuster->cult edges via reverse lookup and stays finite on zero-variance / single-watch vaults", () => {
  // Popular film 100 (watched) pruned niche film 300 from its top-2 outgoing list,
  // but niche film 300 keeps film 100 in its own outgoing list.
  const items = [
    { tmdbId: 100, neighbors: [{ index: 1, weight: 0.50 }, { index: 1, weight: 0.0 }] },
    { tmdbId: 200, neighbors: [{ index: 0, weight: 0.45 }, { index: 2, weight: 0.10 }] },
    { tmdbId: 300, neighbors: [{ index: 0, weight: 0.42 }, { index: 1, weight: 0.08 }] }
  ];
  const idx = parseEaseBinary(encodeEaseBinary(items, 2));
  const scores = buildEaseSimMapFromIndex([{ tmdbId: 100, rating: 9, zScore: 0, timeDecay: 1 }], idx);
  assert.ok((scores.get(300) || 0) > 0, "Expected reverse-edge recovery for niche film 300");
  for (const v of scores.values()) assert.ok(Number.isFinite(v), "All scores must be finite");
});

test("buildEaseSimMapFromIndex calibrates generous-rater 7/10 below harsh-rater 7/10 without flipping 7/10 negative", () => {
  const items = [
    { tmdbId: 10, neighbors: [{ index: 1, weight: 0.5 }] },
    { tmdbId: 20, neighbors: [{ index: 0, weight: 0.5 }] }
  ];
  const idx = parseEaseBinary(encodeEaseBinary(items, 1));
  const harsh = buildEaseSimMapFromIndex([{ tmdbId: 10, rating: 7, zScore: 1.2, timeDecay: 1 }], idx);
  const generous = buildEaseSimMapFromIndex([{ tmdbId: 10, rating: 7, zScore: -0.9, timeDecay: 1 }], idx);
  assert.ok(generous.get(20) > 0, "7/10 watch must remain non-negative implicit positive");
  assert.ok(harsh.get(20) > generous.get(20), "Harsh-rater 7/10 must outrank generous-rater 7/10");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/easeService.test.js`
Expected: FAIL (`reverse-edge recovery` or `harsh > generous` assertion fails).

- [ ] **Step 4: Implement Holdout-150-verified reverse-edge lookup and calibrated input curve in `src/services/easeService.js`**

Update `buildEaseSimMapFromIndex` with the winning parameters from Step 1 (keeping `O(count * K)` reverse scan strictly `< 3 ms` via a flat `Float32Array(count)` `watchedWeightByIdx` table) and export `computeBidirectionalEaseScoreForItem`. Verify `v6_gate_eval.mjs` reproduces the exact `GATE: PASS` result and save updated `.data/v6_lab/v6_2_best.json`.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: `0` failures.

- [ ] **Step 6: Commit**

```bash
git add scripts/experiments/sweep_v6_2_ease_client.mjs src/services/easeService.js tests/easeService.test.js
git commit -m "feat(ml): ship Holdout-150 verified reverse-edge and z-calibrated EASE^R"
```

---

### Task 2: Temporally-Directed & Session-Kernel EASE^R Offline Trainer (`train_sparse_ease.py`)

**Files:**
- Modify: `scripts/experiments/train_sparse_ease.py:50-200`
- Replace *(only if Gate passes)*: `public/models/item_ease_k64.cvea`
- Test: `tests/easeService.test.js`

**Interfaces:**
- Consumes: `.data/ml-32m/ratings.csv` (`userId`, `movieId`, `rating`, `timestamp`), `.data/v6_lab/v6_2_best.json` (or `v6_baseline.json`).
- Produces: CLI flags `--session-tau-days <float>` (default `0`, disabled) and `--forward-eta <float>` (default `0`, disabled) in `scripts/experiments/train_sparse_ease.py`, exporting identical `3.47 MB` `CVEA v1` binaries (`14,000 × 64`, `0` extra bytes!).

- [ ] **Step 1: Extend `scripts/experiments/train_sparse_ease.py` for session-window Gram weighting and causal forward transition blending**

Add `timestamp` to `usecols` only when `--session-tau-days > 0` or `--forward-eta > 0`:
1. **Session-Kernel Gram (`--session-tau-days`, e.g. `90` / `180` / `365`):** Group each user's positive ratings into chronological sessions (or exponential temporal bins of width `tau/2` with adjacent-bin overlap `exp(-Δ/tau)` so the Gram computation stays `O(nnz)` via sparse matrix multiplication `G_sess = X_bin^T X_bin` without quadratic user loops!), blending `G = (1 - s_w) * G_global + s_w * (norm_match * G_sess)` before Cholesky solve.
2. **Forward Causal Transition (`--forward-eta`, e.g. `0.05` / `0.10` / `0.15`):** Accumulate sparse forward co-occurrence `F[i, j]` over temporally ordered adjacent session windows (`t_bin(j) = t_bin(i) + 1`, predicting *next* taste phase from *current* taste phase), row-normalize by `diag(G + lam)`, and blend `B = (1 - eta) * B_ease + eta * B_fwd` before `pop_gamma=0.12` damping and top-64 pruning.

- [ ] **Step 2: Run leakage-clean sweep (625 eval users excluded) into `.data/v6_lab/ease_temporal/`**

Run targeted clean configs (`--max-items 14000 --k 64 --lam 800 --pop-gamma 0.12`):
- `tau ∈ {90, 180}` (`forward_eta = 0`)
- `forward_eta ∈ {0.05, 0.10, 0.15}` (`tau = 0` and best `tau`)

Evaluate each on `Dev-150`, then run the Hard Ship Gate on untouched `Holdout-150` ONLY for the top 2 `Dev-150` winners:
```bash
node scripts/experiments/v6_gate_eval.mjs --ease .data/v6_lab/ease_temporal/<winner>.cvea --compare-baseline .data/v6_lab/v6_2_best.json
```
Decision Gate:
- **If `GATE: FAIL`:** Do NOT overwrite `public/models/item_ease_k64.cvea`. Keep the clean trainer flags for reproducibility, log exact `Dev-150` & `Holdout-150` numbers for Task 9, and move to Task 3.
- **If `GATE: PASS`:** Proceed to Steps 3–5.

- [ ] **Step 3: Retrain production full-32M `public/models/item_ease_k64.cvea` with winning flags**

Run:
```bash
python scripts/experiments/train_sparse_ease.py --production --max-items 14000 --k 64 --lam 800 --pop-gamma 0.12 --session-tau-days <best_tau> --forward-eta <best_eta> --out public/models/item_ease_k64.cvea
```
Expected: Exits `0`, file size remains `3,640,016 B` (`3.47 MB`), and `tests/easeService.test.js` Nolan smoke test passes. Update `.data/v6_lab/v6_2_best.json` from the clean twin.

- [ ] **Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: `0` failures.

- [ ] **Step 5: Commit**

```bash
git add scripts/experiments/train_sparse_ease.py public/models/item_ease_k64.cvea
git commit -m "feat(ml): ship Holdout-150 verified temporally-directed EASE^R graph"
```

---

### Task 3: Support-Gated Bidirectional EASE^R Residual in Universal Taste Match (`tasteMatchService.js`)

**Files:**
- Create: `scripts/experiments/eval_taste_match_v6_2.mjs`
- Modify *(only if Gate passes)*: `src/services/tasteMatchService.js:93-385`, `src/components/MovieDetails.jsx`, `src/components/SearchModal.jsx`
- Test: `tests/tasteMatchService.test.js`

**Interfaces:**
- Consumes: `loadDefaultEaseIndex`, `computeBidirectionalEaseScoreForItem`, `buildEaseSimMapFromIndex` (`src/services/easeService.js`); `buildTasteMatchContext`, `predictMovieMatch` (`src/services/tasteMatchService.js`).
- Produces *(if gated)*: `buildTasteMatchContext({ watched, watchlist, tasteRules, embeddingIndex, easeIndex = null, now })` storing `easeIndex` + `easeSimMap` + `easeCatalogMax` + `watchedWeightByIdx`, adding strictly non-negative precision residual `easeResidual = alpha * max(0, bidirEaseNorm - normCollab)` when `supportCount > 0`.

- [ ] **Step 1: Build and run `scripts/experiments/eval_taste_match_v6_2.mjs` across `Dev-150` → `Holdout-150`**

Measure `predictMovieMatch` directly on `withinAUC` (`>=8 vs <=7`), `vsCatalogAUC`, and `vsPoolAUC` comparing:
- **Control:** Current dense `SVD-64` (`easeIndex = null`).
- **Treatment:** Dense `SVD-64` baseline + support-gated non-negative bidirectional EASE^R residual (`alpha ∈ {0.4, 0.7, 1.0, 1.4}` tuned on `Dev-150`, gated on untouched `Holdout-150`).

Decision Gate:
- Ship ONLY if `Holdout-150` achieves statistically significant positive lift (`ciLower > 0`) on `withinAUC` or `vsPoolAUC` **with zero significant regression on `vsCatalogAUC`** (directly solving Experiment 12's `-0.0252*` regression).
- **If `GATE: FAIL`:** Leave `tasteMatchService.js` untouched on pure `SVD-64`, log exact numbers for Task 9, and move to Task 4.
- **If `GATE: PASS`:** Proceed to Steps 2–6.

- [ ] **Step 2: Write failing tests in `tests/tasteMatchService.test.js` (including Review Focus #2)**

```js
test("predictMovieMatch with easeIndex: null is bit-identical to omitting easeIndex, and positive EASE residual never zero-compresses unsupported warm films", () => {
  const svdIdx = makeTinyEmbeddingIndex();
  const easeIdx = parseEaseBinary(encodeEaseBinary([
    { tmdbId: 10, neighbors: [{ index: 1, weight: 0.55 }] },
    { tmdbId: 20, neighbors: [{ index: 0, weight: 0.55 }] }
  ], 1));
  const watched = [
    { tmdbId: 10, title: "Inception", userRating: 10, tmdbGenreIds: [878, 53] },
    { tmdbId: 11, title: "Interstellar", userRating: 9, tmdbGenreIds: [878, 18] },
    { tmdbId: 30, title: "Slasher X", userRating: 3, tmdbGenreIds: [27] }
  ];
  const baseNull = predictMovieMatch({ movie: { tmdbId: 20, title: "Tenet", tmdbGenreIds: [878] }, watched, embeddingIndex: svdIdx, easeIndex: null });
  const baseOmit = predictMovieMatch({ movie: { tmdbId: 20, title: "Tenet", tmdbGenreIds: [878] }, watched, embeddingIndex: svdIdx });
  assert.deepEqual(baseNull, baseOmit);

  const boosted = predictMovieMatch({ movie: { tmdbId: 20, title: "Tenet", tmdbGenreIds: [878] }, watched, embeddingIndex: svdIdx, easeIndex: easeIdx });
  assert.ok(boosted.matchPct >= baseNull.matchPct, "Positive EASE support must never reduce matchPct");

  // Warm film 11-neighbor 31 with 0 EASE support must NOT drop below SVD-only score
  const noEaseEdgeBase = predictMovieMatch({ movie: { tmdbId: 31, title: "Other", tmdbGenreIds: [27] }, watched, embeddingIndex: svdIdx });
  const noEaseEdgeWithEase = predictMovieMatch({ movie: { tmdbId: 31, title: "Other", tmdbGenreIds: [27] }, watched, embeddingIndex: svdIdx, easeIndex: easeIdx });
  assert.equal(noEaseEdgeWithEase.matchPct, noEaseEdgeBase.matchPct);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/tasteMatchService.test.js`
Expected: FAIL (until `easeIndex` residual wiring is implemented).

- [ ] **Step 4: Wire support-gated bidirectional EASE^R residual in `src/services/tasteMatchService.js`, `src/components/MovieDetails.jsx`, and `src/components/SearchModal.jsx`**

Load `loadDefaultEaseIndex().catch(() => null)` alongside `loadDefaultEmbeddingIndex()` in `MovieDetails.jsx` and `SearchModal.jsx` and pass `easeIndex` into `buildTasteMatchContext`.

- [ ] **Step 5: Run full test suite and build**

Run: `npm test && npm run build`
Expected: `0` failures.

- [ ] **Step 6: Commit**

```bash
git add scripts/experiments/eval_taste_match_v6_2.mjs src/services/tasteMatchService.js src/components/MovieDetails.jsx src/components/SearchModal.jsx tests/tasteMatchService.test.js
git commit -m "feat(ml): add support-gated bidirectional EASE^R residual to Taste Match"
```

---

### Task 4: Multi-Persona Mean-Centered `contentSimService.js`, Cross-Space Cold Projector & `"Bucket E-Cold"` Retrieval

**Files:**
- Create: `scripts/experiments/eval_cold_v6_2.mjs`
- Create: `scripts/experiments/train_cold_projector.py`
- Modify: `src/services/contentSimService.js:126-288`
- Modify: `src/services/geminiService.js:2977-3034`
- Modify: `src/services/exploreForYouService.js:653-776`
- Test: `tests/contentSimService.test.js`, `tests/moodRanker.test.js`

**Interfaces:**
- Consumes: `computePersonaDetails`, `buildRepulsionMapFromIndex`, `getCollabCatalogMax` (`src/services/embeddingService.js`); `matchesMoodCandidateGate` (`src/services/moodPolicy.js`); `fetchEmbeddingCandidates` (`src/services/tmdbService.js`).
- Produces:
  - Fixed `buildContentSimMap` in `src/services/contentSimService.js`: adds `rating >= 7` positive guard, removes dead `64 === 128` `blendAligned` branch, and *(if cold-gated)* applies catalog-mean centering (removing MiniLM cone anisotropy) + Spherical K-Means multi-persona mixture + `top3Loved` + `catalog-max` normalization.
  - `retrieveColdContentNeighbors(weightedRatings, contentIndex, excludeIds, options)` -> `Array<{ tmdbId: number, contentSim: number, alignedScore: number }>` (strictly skips any ID present in `options.collabIndex.idToIndex` or `excludeIds`), wired as **"Bucket E-Cold"** (`maxColdNeighbors = 12` in `"any"`, `6` mood-gated in explicit mood) in `geminiService.js` and `exploreForYouService.js`.
  - Optional `public/models/cold_collab_64_f16.bin` (ONLY if `train_cold_projector.py` beats `MiniLM-128D` on untouched `Holdout-150` 100%-cold holdout by `>= +2% NDCG@20` per `+1 MB`!).

- [ ] **Step 1: Benchmark multi-persona mean-centered `contentSim` & Cross-Space `64-D` Cold Projector on 100%-cold `Dev-150` → `Holdout-150`**

Implement `scripts/experiments/eval_cold_v6_2.mjs` (masking `collabSim = 0` on all candidates, matching Experiment 7's exact 100%-cold protocol where `v6.1` scored `Holdout-150 NDCG@10 = 0.0589`, `NDCG@20 = 0.0716`, `HR@20 = 46.7%`) and `scripts/experiments/train_cold_projector.py` (fitting Ridge `W: [MiniLM-384 + TF-IDF(genres, keywords, director, cast)] -> 64-D clean2 SVD` using 5-fold CV on the `9,620` warm catalog films—zero user rating leakage!).
Compare:
1. `v6.1` single-mean MiniLM-128D (baseline).
2. Mean-centered + Multi-Persona Spherical K-Means + `catalog-max` MiniLM-128D (`0` extra MB!).
3. Cross-space projected `64-D` pseudo-collab vectors (`cold_collab_64_f16.bin`, ~`0.2–1.5 MB` for cold `2024–2026` films).

Run:
```bash
python scripts/experiments/train_cold_projector.py --svd .data/item_embeddings_clean2_f16.bin --out .data/v6_lab/cold_proj_64_clean.bin
node scripts/experiments/eval_cold_v6_2.mjs --content public/models/content_embeddings_f16.bin --proj .data/v6_lab/cold_proj_64_clean.bin
```
Expected: Prints `DEV-150` and `HOLDOUT-150` cold-start `NDCG@10`, `NDCG@20`, `HR@20`, `HR@100` with paired bootstrap 95% CIs. Ship ONLY the cold-scoring upgrade(s) that pass `ciLower > 0` on `Holdout-150`!

- [ ] **Step 2: Write failing tests in `tests/contentSimService.test.js` (including Review Focus #3)**

```js
test("buildContentSimMap excludes harsh-rater <=5★ items from positive centroid and preserves coldOnly:true isolation", () => {
  const contentIndex = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 100, vector: [1, 0, 0, 0] },
    { tmdbId: 101, vector: [0, 1, 0, 0] },
    { tmdbId: 300, vector: [0, 1, 0, 0] }
  ]));
  const map = buildContentSimMap(
    [
      { tmdbId: 100, rating: 9, weight: 1.5, movie: { tmdbId: 100 } },
      { tmdbId: 101, rating: 5, weight: 0.4, movie: { tmdbId: 101 } } // positive z-score for harsh rater, but <=5★
    ],
    contentIndex,
    [{ tmdbId: 300 }],
    { collabIndex: null, collabSimMap: new Map(), coldOnly: true }
  );
  assert.ok((map.get(300) || 0) < 0.25, "5★ movie must not drive positive content similarity");
});

test("retrieveColdContentNeighbors returns only unindexed cold films, excluding warm collabIndex items and watched/watchlist IDs", () => {
  const contentIndex = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 100, vector: [1, 0, 0, 0] },
    { tmdbId: 200, vector: [0.99, 0.14, 0, 0] }, // warm (in collabIndex)
    { tmdbId: 300, vector: [0.95, 0.31, 0, 0] }, // cold 2025 hit
    { tmdbId: 301, vector: [0.90, 0.43, 0, 0] }  // cold 2025 watched
  ]));
  const collabIndex = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 100, vector: [1, 0, 0, 0] },
    { tmdbId: 200, vector: [1, 0, 0, 0] }
  ]));
  const picks = retrieveColdContentNeighbors(
    [{ tmdbId: 100, rating: 10, weight: 1.5, movie: { tmdbId: 100 } }],
    contentIndex,
    new Set([100, 301]),
    { collabIndex, topK: 10 }
  );
  assert.deepEqual(picks.map((p) => p.tmdbId), [300]);
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `node --test tests/contentSimService.test.js`
Expected: FAIL (`retrieveColdContentNeighbors is not exported` / 5★ guard fails).

- [ ] **Step 4: Implement `contentSimService.js` fixes, gated cold scorer upgrade, and `"Bucket E-Cold"` wiring in `geminiService.js` & `exploreForYouService.js`**

- In `src/services/contentSimService.js`: enforce `minPositiveRating = 7` on `buildUserContentVector` / persona builder, remove dead `blendAligned` block, apply the Holdout-150-verified mean-centered multi-persona (or cold projector) scoring, and export `retrieveColdContentNeighbors`.
- In `src/services/geminiService.js`: invoke `retrieveColdContentNeighbors` when `contentIndex` is loaded and pass top `15` cold neighbors through `fetchEmbeddingCandidates` (reusing `/api/tmdb-batch` + 30-day IndexedDB cache + `matchesMoodCandidateGate` + `userProviders` filtering, capped at `12` in `"any"` / `6` in explicit mood, tagged `sourceBucket: "Bucket E-Cold (Semantic)"`). Wire analogously into `exploreForYouService.js` Wave 2.

- [ ] **Step 5: Run full test suite & build**

Run: `npm test && npm run build`
Expected: `0` failures.

- [ ] **Step 6: Commit**

```bash
git add scripts/experiments/eval_cold_v6_2.mjs scripts/experiments/train_cold_projector.py src/services/contentSimService.js src/services/geminiService.js src/services/exploreForYouService.js tests/contentSimService.test.js
git commit -m "feat(ml): add Bucket E-Cold semantic retrieval and cold-start math fixes"
```

---

### Task 5: Non-Linear Ranker Calibration (`rankerService.js`)

**Files:**
- Create: `scripts/experiments/eval_nonlinear_ranker_v6_2.mjs`
- Modify *(only if Gate passes)*: `src/services/rankerService.js:42-247, 550-715`, `public/models/ranker_weights.json`
- Test: `tests/rankerService.test.js`, `tests/moodRanker.test.js`

**Interfaces:**
- Consumes: `v6_gate_eval.mjs`, `.data/v6_lab/v6_2_best.json`, `extractCandidateFeatures`, `scoreCandidate`, `rankCandidatePool`.
- Produces *(if gated)*:
  - `computeUserPopularityStats(weightedRatings)` -> `{ meanLogVotes: number, stdLogVotes: number, count: number }` attached to `profile` (or computed lazily in `rankCandidatePool`).
  - Optional non-linear calibration knobs in `scoreCandidate` / `rankCandidatePool` (strictly disabled or `0`-delta when `explicitMood` is active so mood presets remain unchanged!):
    1. User-calibrated popularity match `popMatch = exp(-0.5 * ((log10(votes) - meanLogVotes) / max(stdLogVotes, 0.45))^2)`.
    2. Empirical vault-size shrinkage on `collabSim`: `collabShrink = nIndexed / (nIndexed + k0)` (`k0 ∈ {0, 3, 5, 8}`).
    3. Cold-conditioned auteur/cast boost: `crewBoost = 1 + gammaCrew * (1 - smoothT)` (`gammaCrew ∈ {0, 0.75, 1.25, 1.75}`).

- [ ] **Step 1: Build and run `scripts/experiments/eval_nonlinear_ranker_v6_2.mjs` across `Dev-150` → `Holdout-150`**

Ablate each of the 3 non-linear terms individually AND combined across:
- Full `Dev-150` → untouched `Holdout-150` (`v6_gate_eval.mjs` 4-part Hard Gate).
- Small-vault synthetic slice (`3..10` ratings subsampled from `Dev-150` / `Holdout-150`) to verify vault-size shrinkage.
- 100%-cold holdout slice to verify cold-conditioned `crewMatch` / `castMatch`.

Run:
```bash
node scripts/experiments/eval_nonlinear_ranker_v6_2.mjs --baseline .data/v6_lab/v6_2_best.json
```
Decision Gate:
- Ship ONLY the specific term(s) that pass `GATE: PASS` on untouched `Holdout-150` (or statistically lift the small-vault/cold target stratum with `0.000` warm regression on `Holdout-150`).
- **If all 3 fail:** Keep `rankerService.js` and `ranker_weights.json` untouched, log results for Task 9, and move to Task 6.
- **If any pass:** Proceed to Steps 2–6.

- [ ] **Step 2: Write failing tests in `tests/rankerService.test.js` & `tests/moodRanker.test.js` (including Review Focus #4)**

Pin:
1. Smooth monotonic `collabSim` shrinkage across `nIndexed ∈ {0, 1, 3, 10, 100}` with no `NaN` or discontinuities.
2. Cold `2026` film (`rawCollabSim = 0`) by a favorite director receives strictly higher `crewMatch` contribution than an identical warm film already captured by `collabSim`.
3. `explicitMood` gating (`comfort-watch`, `hidden-gem`) remains invariant and `public/models/ranker_weights.json` matches `DEFAULT_RANKER_WEIGHTS` in exact `deepEqual` parity.

- [ ] **Step 3: Run tests to verify failure**

Run: `node --test tests/rankerService.test.js tests/moodRanker.test.js`
Expected: FAIL on newly added calibration assertions.

- [ ] **Step 4: Implement Holdout-150-verified non-linear calibration in `src/services/rankerService.js` (and sync `public/models/ranker_weights.json` if weights changed)**

- [ ] **Step 5: Run full test suite and update `.data/v6_lab/v6_2_best.json`**

Run: `npm test && npm run build`
Expected: `0` failures.

- [ ] **Step 6: Commit**

```bash
git add scripts/experiments/eval_nonlinear_ranker_v6_2.mjs src/services/rankerService.js public/models/ranker_weights.json tests/rankerService.test.js tests/moodRanker.test.js
git commit -m "feat(ranker): add Holdout-150 verified non-linear ranker calibration"
```

---

### Task 6: Multi-Persona Bucket B, Multi-Auteur Bucket C & Bucket D Provider-Alias Fix (`tmdbService.js`)

**Files:**
- Modify: `src/services/tmdbService.js:750-950`
- Modify: `src/services/geminiService.js:2942-2950`
- Test: `tests/pipelineBugs.test.js`, `tests/recentReleaseSlots.test.js`

**Interfaces:**
- Consumes: `computePersonaDetails` (`src/services/embeddingService.js`), `buildProviderFilter` (`src/services/tmdbService.js`).
- Produces:
  - `selectPersonaAnchorIds(weightedRatings, embeddingIndex, maxAnchors = 3)` -> `Array<{ tmdbId: number, mass: number }>` selecting the highest-weight `>= 8★` medoid film from each distinct Spherical K-Means persona (falling back to top-3 distinct-genre `>= 9★` anchors when `embeddingIndex` is null).
  - Updated `fetchBucketB(anchorIdsOrSingle, options, collisionSets, targetCount)` supporting an array of up to `3` anchors (distributing the same `<= 4` total TMDB page budget across anchors instead of burning all 4 pages on 1 movie, while remaining 100% backward compatible with a single numeric `anchorTmdbId`).
  - Updated `fetchBucketC(profile, options, collisionSets, targetCount)` querying up to `topCrewIds.slice(0, 3)` (`1` page per auteur in parallel, max `3` total TMDB calls—same API ceiling as the old 3-page single-auteur loop!).
  - Fixed `applyProviderAndRegionParams` (`tmdbService.js:881`) passing `{ expandAliases: true }` to `buildProviderFilter(userProviders, { expandAliases: true })`.

- [ ] **Step 1: Write failing tests in `tests/pipelineBugs.test.js` and `tests/recentReleaseSlots.test.js`**

```js
test("buildBucketDParams expands PROVIDER_FAMILY_MAP aliases (e.g. Netflix 8 -> 8|1796|175)", () => {
  const params = buildBucketDParams({ lovedGenreIds: [18] }, { userRegion: "US", userProviders: [8] }, "k");
  const wp = params.get("with_watch_providers") || "";
  assert.ok(wp.split("|").includes("1796"), `Expected Netflix Ads alias 1796 in Bucket D params, got ${wp}`);
});

test("fetchBucketC fans out across top 3 topCrewIds instead of starving on a single director", async () => {
  const queriedCrew = [];
  const mockFetch = async (url) => {
    const u = new URL(url);
    const crew = u.searchParams.get("with_crew");
    queriedCrew.push(crew);
    return {
      ok: true,
      json: async () => ({ results: [{ id: Number(crew) * 10, title: `Film ${crew}`, vote_average: 7.8, vote_count: 500 }] })
    };
  };
  const out = await fetchBucketC(
    { topCrewMemberId: 101, topCrewIds: [101, 202, 303] },
    { apiKey: "test", fetchFn: mockFetch },
    {},
    9
  );
  assert.deepEqual(new Set(queriedCrew), new Set(["101", "202", "303"]));
  assert.equal(out.length, 3);
});

test("fetchBucketB distributes keyword retrieval across multiple persona anchor IDs while staying backward-compatible with a single ID", async () => {
  const kwLookups = [];
  const mockFetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes("/keywords")) {
      const mid = u.pathname.match(/\/movie\/(\d+)\//)?.[1];
      kwLookups.push(mid);
      return { ok: true, json: async () => ({ keywords: [{ id: Number(mid) + 1000 }] }) };
    }
    const kw = u.searchParams.get("with_keywords");
    return { ok: true, json: async () => ({ results: [{ id: Number(kw) + 1, title: `Match ${kw}`, vote_average: 7.7, vote_count: 800 }] }) };
  };
  const out = await fetchBucketB([10, 20], { apiKey: "test", fetchFn: mockFetch }, {}, 10);
  assert.deepEqual(new Set(kwLookups), new Set(["10", "20"]));
  assert.equal(out.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pipelineBugs.test.js tests/recentReleaseSlots.test.js`
Expected: FAIL on all 3 new assertions.

- [ ] **Step 3: Implement multi-persona Bucket B, multi-auteur Bucket C, and Bucket D alias expansion in `src/services/tmdbService.js` (and pass persona anchors from `geminiService.js`)**

- [ ] **Step 4: Run full test suite & build**

Run: `npm test && npm run build`
Expected: `0` failures.

- [ ] **Step 5: Commit**

```bash
git add src/services/tmdbService.js src/services/geminiService.js tests/pipelineBugs.test.js tests/recentReleaseSlots.test.js
git commit -m "feat(retrieval): multi-persona Bucket B, multi-auteur Bucket C, and Bucket D provider aliases"
```

---

### Task 7: Lock `Explore For You` Wave-3 Scores + Kernel MMR Shortlist + `n = 50` Validation of `100 → 25 Over-Pitch → 20 Logit Fusion`

**Files:**
- Modify: `src/services/exploreForYouService.js:254-360, 855-922`
- Modify: `scripts/experiments/eval_math_anchor_llm.mjs`
- Modify *(only if `n = 50` gated)*: `src/services/rankerService.js:764-860`, `src/services/geminiService.js:2305-2401, 2605-2765`
- Test: `tests/exploreForYouService.test.js`, `tests/geminiDualEngine.test.js`, `tests/rankerService.test.js`

**Interfaces:**
- Consumes: `buildExploreForYouBatchPrompt`, `mergeExploreForYouResponse` (`src/services/exploreForYouService.js`); `buildDiversifiedGeminiShortlist` (`src/services/rankerService.js`); `mergeGeminiExplanationsWithRanker` (`src/services/geminiService.js`).
- Produces:
  - Locked `mergeExploreForYouResponse`: preserves calibrated local `base.forYouScore` / `base.matchScore` (removing unconstrained LLM `"s": 55..99` overrides and re-sort distortion while keeping AI `vibeTag` and `forYouReason`).
  - *(If `n = 50` gated)* Kernel MMR outlier selection in `buildDiversifiedGeminiShortlist` + **`100 → 25 Over-Pitch → 20 Logit Fusion`** (unbiased prompt asking Gemini for `25` curated picks + 2-sentence pitches with zero score/rank tags, then post-hoc selecting final `20` via `rankerLogit + alpha * geminiOrderBonus` + `ProtectTop-2` under `"any"` vibe only, guaranteeing bespoke AI pitches on rescued picks!).

- [ ] **Step 1: Write failing test in `tests/exploreForYouService.test.js` locking Wave-3 `forYouScore` to the calibrated ranker**

```js
test("mergeExploreForYouResponse preserves calibrated local ranker forYouScore instead of letting Flash-Lite overwrite scores or invert math ordering", () => {
  const candidates = [
    { tmdbId: 10, title: "Personal EASE Hit", matchScore: 94, forYouScore: 94 },
    { tmdbId: 20, title: "Generic Prestige Classic", matchScore: 76, forYouScore: 76 }
  ];
  const geminiPicks = [
    { id: 20, s: 99, tag: "Timeless Drama", r: "Acclaimed classic." },
    { id: 10, s: 72, tag: "Tight Sci-Fi", r: "Matches your anchors." }
  ];
  const merged = mergeExploreForYouResponse(candidates, geminiPicks, { targetCount: 2 });
  assert.equal(merged[0].tmdbId, 10, "Personal EASE Hit must stay #1");
  assert.equal(merged[0].forYouScore, 94, "Calibrated local ranker score must stay locked");
  assert.equal(merged[0].vibeTag, "Tight Sci-Fi");
  assert.equal(merged[1].forYouScore, 76);
});
```

- [ ] **Step 2: Run test to verify failure, then lock scores in `src/services/exploreForYouService.js` and re-run**

Update `buildExploreForYouBatchPrompt` (drop `"s"` from schema/prompt to save output tokens) and `mergeExploreForYouResponse` (keep `base.forYouScore` / `base.matchScore`, applying only sanitized `vibeTag` and `forYouReason`).
Run: `node --test tests/exploreForYouService.test.js`
Expected: PASS.

- [ ] **Step 3: Extend `scripts/experiments/eval_math_anchor_llm.mjs` for `n = 50` unseen `Holdout-150` users comparing `Control A (100 → 20)` vs. `Over-Pitch (100 → 25 → 20 Logit Fusion + ProtectTop-2)` + Kernel MMR**

Run checkpointed `n = 50` paired evaluation (`--users 50 --model gemini-3.5-flash-lite`) measuring `NDCG@10`, `NDCG@20`, `Hits@20`, `Tail@20`, `HR@20`, boilerplate-pitch rate (must be `<= 2%`), and paired bootstrap 95% CI vs. Control A:
```bash
node scripts/experiments/eval_math_anchor_llm.mjs --users 50 --model gemini-3.5-flash-lite
```
Decision Gate:
- Ship Over-Pitch Logit Fusion + Kernel MMR ONLY if `ciLower > 0` on `NDCG@20` or `NDCG@10` with `Tail@20 >= Control A - 1%` and zero regression on explicit Mood tests.
- **If `GATE: FAIL`:** Keep only the Task 7 Step 2 `Explore For You` score lock (commit it cleanly), log the `n = 50` numbers for Task 9, and move to Task 8.
- **If `GATE: PASS`:** Proceed to Steps 4–6.

- [ ] **Step 4: Write failing tests in `tests/geminiDualEngine.test.js` (including Review Focus #5)**

Assert that:
1. Under `"any"` vibe, `mergeGeminiExplanationsWithRanker` fuses `25` Gemini-pitched picks with `ProtectTop-2` into `20` picks where protected picks retain Gemini-authored pitches (zero boilerplate when present in the 25) and respect `maxPerDirector: 2`, `maxPerCollection: 1`.
2. Under explicit Mood (`comfort-watch`) or custom vibe query, `ProtectTop-2` is disabled so Mood/Vibe curation remains sovereign.
3. Zero internal rank/tag tokens appear in `buildGeminiReRankPrompt` or survive `sanitizeOracleReason`.

- [ ] **Step 5: Implement Kernel MMR shortlist (`src/services/rankerService.js`) and `100 → 25 → 20` fusion (`src/services/geminiService.js`) and verify tests**

Run: `npm test && npm run build`
Expected: `0` failures.

- [ ] **Step 6: Commit**

```bash
git add src/services/exploreForYouService.js src/services/rankerService.js src/services/geminiService.js scripts/experiments/eval_math_anchor_llm.mjs tests/exploreForYouService.test.js tests/geminiDualEngine.test.js
git commit -m "feat(curation): lock Explore For You math scores and add verified LLM logit fusion"
```

---

### Task 8: Behavioral Signal Activation — Watchlist EASE^R Intent, Craft Breakdown, Rewatch/Format Boost & Reason-Typed Dismissals

**Files:**
- Modify: `src/services/easeService.js:138-185`
- Modify: `src/services/tmdbService.js:296-370`
- Modify: `src/services/onlineLearningService.js:127-163`
- Modify: `src/services/geminiService.js:2966-2972`
- Test: `tests/easeService.test.js`, `tests/ratingStudioService.test.js`, `tests/rankerService.test.js`

**Interfaces:**
- Consumes: `movie.ratingBreakdown` (`{ story, direction, acting, visuals }`), `movie.watchMeta` (`{ format, rewatchCount }`), `watchlist` array, `feedbackLog` entries (`{ action, reason, features }`).
- Produces:
  - Optional `options.watchlistItems` (`watchlistWeight = 0.25`, capped to `15` most-recent unwatched items) inside `buildEaseSimMapFromIndex` (passed from `geminiService.js` & `exploreForYouService.js`; default `[]` so existing MovieLens benchmarks stay unchanged).
  - Craft-aware person accumulation in `extractTasteProfile`: when `movie.ratingBreakdown` exists, decouple `crewNetScores` using `(direction + visuals) / 2` (so a `5/10` overall with `direction: 5, visuals: 5, story: 1` does NOT penalize the director!) and `castNetScores` using `acting`; apply a `1.15x` positive magnitude multiplier when `watchMeta.rewatchCount >= 2` or `watchMeta.format` is `"imax"` / `"physical"` (for `rating >= 8`).
  - Reason-typed dismissal filtering in `derivePersonalizedRankerWeights` (`onlineLearningService.js`): exclude `"Too slow"` / pacing-only dismissals from pushing down `collabSim` / `genreOverlap` (skip or downweight to `0.25` when `reason` matches `/too\s*slow|pacing/i`).

- [ ] **Step 1: Write failing unit tests across `tests/easeService.test.js`, `tests/ratingStudioService.test.js`, and `tests/rankerService.test.js`**

```js
// tests/easeService.test.js
test("buildEaseSimMapFromIndex incorporates light watchlist forward-intent without overpowering rated 10★ favorites", () => {
  const items = [
    { tmdbId: 100, neighbors: [{ index: 2, weight: 0.50 }] },
    { tmdbId: 200, neighbors: [{ index: 3, weight: 0.50 }] },
    { tmdbId: 300, neighbors: [{ index: 0, weight: 0.50 }] },
    { tmdbId: 400, neighbors: [{ index: 1, weight: 0.50 }] }
  ];
  const idx = parseEaseBinary(encodeEaseBinary(items, 1));
  const map = buildEaseSimMapFromIndex(
    [{ tmdbId: 100, rating: 10, weight: 1.5 }],
    idx,
    { watchlistItems: [{ tmdbId: 200 }], watchlistWeight: 0.25 }
  );
  assert.ok((map.get(400) || 0) > 0, "Watchlist neighbor 400 should receive light positive EASE signal");
  assert.ok(map.get(300) > map.get(400) * 3, "Rated 10★ anchor must strongly outweigh watchlist intent");
});

// tests/ratingStudioService.test.js (or tests/pipelineBugs.test.js)
test("extractTasteProfile honors ratingBreakdown so high direction/visuals on a 5★ film does not penalize the director", async () => {
  const watched = [
    { tmdbId: 1, title: "A", userRating: 9, crewPersonId: 50, castIds: [11], tmdbGenreIds: [18] },
    { tmdbId: 2, title: "B", userRating: 9, crewPersonId: 60, castIds: [12], tmdbGenreIds: [18] },
    {
      tmdbId: 3, title: "Gorgeous Bad Script", userRating: 5, crewPersonId: 70, castIds: [13], tmdbGenreIds: [18],
      ratingBreakdown: { story: 1, direction: 5, acting: 3, visuals: 5 }
    }
  ];
  const profile = await extractTasteProfile(watched, []);
  assert.ok((profile.crewAffinities[70] || 0) >= 0, "5/5 direction & visuals must not receive negative crew affinity");
});
```

Also add a test in `tests/rankerService.test.js` verifying `"Too slow"` dismissals in `feedbackLog` do not reduce `derivedWeights.collabSim` relative to `DEFAULT_RANKER_WEIGHTS.collabSim`.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/easeService.test.js tests/ratingStudioService.test.js tests/rankerService.test.js`
Expected: FAIL on the 3 new assertions.

- [ ] **Step 3: Implement watchlist intent, craft breakdown/rewatch hooks, and reason-typed dismissal handling**

Keep every feature strictly backward compatible (`0.000` diff on existing vaults lacking `ratingBreakdown`, `watchMeta`, or `watchlistItems`). Verify zero regression on `v6_gate_eval.mjs`.

- [ ] **Step 4: Run full test suite & build**

Run: `npm test && npm run build`
Expected: `0` failures.

- [ ] **Step 5: Commit**

```bash
git add src/services/easeService.js src/services/tmdbService.js src/services/onlineLearningService.js src/services/geminiService.js tests/easeService.test.js tests/ratingStudioService.test.js tests/rankerService.test.js
git commit -m "feat(taste): wire watchlist EASE intent, Studio craft breakdown, and typed dismissals"
```

---

### Task 9: Final Regression Verification, `v6.2` Logbook Sync & `.md` Spec Drift Cleanup

**Files:**
- Modify: `MODEL_REFINEMENT_LOG.md`
- Modify: `ARCHITECTURE.md` (sync drifted `v5.6` body sections `39 → 10`, `25+8+6`, `<= 20,000` chars, `MIN_VALID_CACHE_COUNT = 7` to live `100 → 20`, `72+14+14`, `<= 34,000` chars, `MIN_VALID_CACHE_COUNT = 14`, plus `v6.2` additions)
- Modify: `LOCAL_MODEL_GUIDE.md` (sync drifted `39 → 10` pipeline diagram & update `v6.2` summary)
- Modify: `README.md` (only if `v6.2` headline metrics or models changed)

**Interfaces:**
- Consumes: Final `.data/v6_lab/v6_2_best.json`, all experiment outputs from Tasks 1–8, `npm test`, `npm run build`.
- Produces: Complete `v6.2` Executive Progress Tracker row + detailed kept/rejected experiment chronicle in `MODEL_REFINEMENT_LOG.md` and internally consistent `.md` specifications.

- [ ] **Step 1: Run final verification suite & clean benchmark snapshot**

Run:
```bash
npm test
npm run build
node scripts/experiments/v6_gate_eval.mjs --ease .data/v6_lab/ease_v6_baseline_clean.cvea --compare-baseline .data/v6_lab/v6_baseline.json --label v6.2-final
```
Expected: `npm test` passes `100%`, `npm run build` exits `0` with all shipped binaries in `build/models/`, and `v6_gate_eval.mjs` prints final verified `DEV-150`, `HOLDOUT-150`, and `ALL-300` tables.

- [ ] **Step 2: Update `MODEL_REFINEMENT_LOG.md`, `ARCHITECTURE.md`, and `LOCAL_MODEL_GUIDE.md`**

Log EVERY experiment from Tasks 1–8 (both **Shipped** and **Rejected**!) with exact `Dev-150`, `Holdout-150`, and `All-300` tables, bootstrap 95% CIs, `Tail@20`, `Cov`, `AvgV`, and latency; resolve the `39 → 10` vs. `100 → 20` body drift in `ARCHITECTURE.md` and `LOCAL_MODEL_GUIDE.md`.

- [ ] **Step 3: Commit final documentation sync**

```bash
git add MODEL_REFINEMENT_LOG.md ARCHITECTURE.md LOCAL_MODEL_GUIDE.md README.md
git commit -m "docs(ml): record v6.2 experiment results and sync v6.1/v6.2 architecture specs"
```
