# CinemaVault v6.1+ Accuracy Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push CinemaVault's on-device recommendation math and Gemini curation as close as possible to the empirical MovieLens 32M ceiling through strictly evidence-gated, leakage-clean experiments—shipping ONLY upgrades that prove statistically significant real-world gains on untouched holdout users without popularity inflation or dead logic.

**Architecture:** Every proposed improvement is isolated as an independent experiment evaluated on a fixed chronological holdout benchmark (`Dev-150` for tuning, strictly untouched `Holdout-150` for pass/fail gating, `All-300` for final reporting, plus a 20-user live LLM holdout for Gemini curation and a masked cold-start harness for `2024–2026` semantic embeddings). Changes enter production code (`src/services/`, `public/models/`) ONLY after passing a 4-part Hard Ship Gate; any hypothesis that fails is discarded cleanly and recorded as a negative result in `MODEL_REFINEMENT_LOG.md`.

**Tech Stack:** JavaScript (ES Modules, Node `node:test`), Python 3 (`numpy`, `scipy`, `pandas`), `CVEA v1` (Sparse EASE^R float16 binary), `CVEM v1` (SVD-64 & semantic content float16 binary), Google GenAI SDK (`gemini-embedding-001`, `gemini-3.5-flash-lite`), Vite 5.

**Spec:** [MODEL_REFINEMENT_LOG.md](../../../MODEL_REFINEMENT_LOG.md) (v6.0 baseline & v6.1+ refinement backlog) and [ARCHITECTURE.md](../../../ARCHITECTURE.md) (Section 27).

## Global Constraints

- **Zero Leakage Rule:** Every offline training run MUST exclude all `625` mapped + fresh evaluation users (`.data/user_id_map.json` + `.data/fresh_300_exclude_ids.json`) before fitting any EASE^R, SVD, or weight model. Production binaries (`public/models/*`) are retrained on 100% of MovieLens 32M ONLY after the clean twin passes the Holdout-150 gate.
- **No Useless Logic (4-Part Hard Ship Gate on Untouched `Holdout-150`):**
  1. **Significant Primary Gain:** Paired bootstrap 95% CI (`1,000` resamples, `seed = 42`) lower bound `ciLower > 0` on `NDCG@20` or `NDCG@10` (with zero significant regression on the other).
  2. **No Popularity Cheating:** Long-Tail `Tail@20` (hits outside top-200 TMDB `vote_count` films) must stay `>= -1.0%` relative to the previous shipped checkpoint, and mean Top-20 `vote_count` (`AvgV`) must not rise `> +12%` without a matching `Tail@20` lift.
  3. **No Diversity Collapse:** Unique Catalog Coverage (`Cov`) across `Holdout-150` Top-20s must stay `>= 92%` of the previous shipped checkpoint.
  4. **Latency & Asset Budget:** Client scoring must stay `< 25 ms/user` across the full index; any extra binary size in `public/models/` must deliver `>= +2.0%` `Holdout-150` `NDCG@20` lift per `+2 MB`.
- **Mood Separation Invariant:** Any ranker or Gemini anchoring change MUST keep explicit Mood / Custom Vibe hard-gates (`matchesMoodCandidateGate`) and Taste Rules (`avoidRules`) strictly enforced and unbroken.
- **Graceful Degradation:** All binary models (`item_ease_k64.cvea`, `item_embeddings_f16.bin`, `content_embeddings_f16.bin`) MUST remain optional—returning `null` safely in offline Node tests, 404s, or SPA HTML fallback responses.
- **Parity & Verification:** `public/models/ranker_weights.json` MUST remain in exact parity with `DEFAULT_RANKER_WEIGHTS`; `npm test` and `npm run build` MUST exit `0` after every shipped task.

## Review Focus

- **Signed `float16` negative weights in `CVEA v1`:** Storing negative EASE^R weights (`store_neg > 0`) could cause `maxE` normalization or negative score accumulation to flip valid candidates negative or produce `NaN` when a user has only disliked films; pin with a dedicated negative-only & signed-edge test in `tests/easeService.test.js`.
- **Tiny vaults (`3–9` ratings) & undated bulk imports under adaptive `easeWeight`:** When a user has `< 10` ratings or only `2` movies indexed in the EASE^R graph, adaptive weighting must smoothly fall back toward SVD without division-by-zero or discontinuous rank jumps; pin with boundary tests at `0`, `1`, `5`, `20`, and `80` indexed ratings in `tests/easeService.test.js`.
- **Math-anchored Gemini curation leaking internal tags or overriding explicit Moods:** Prompt tags like `[Core Match]` must NEVER appear verbatim in user-facing `reason` strings (enforced by `sanitizeOracleReason`) and must NEVER be emitted when `explicitMood` is true; pin with explicit assertions in `tests/geminiDualEngine.test.js`.
- **Cold-start `content_embeddings_f16.bin` masking or inflating warm films:** Semantic plot vectors MUST remain cold-gated (`coldOnly: true`) so `contentSim` boosts post-2023 unindexed releases without diluting `EASE^R + SVD` on indexed movies; pin in `tests/contentSimService.test.js`.
- **`tasteMatchService.js` missing `easeIndex` on first load:** `buildTasteMatchContext` callers (`MovieDetails.jsx`, `SearchModal.jsx`) may render before `item_ease_k64.cvea` finishes fetching; passing `easeIndex: null` or omitting it MUST match existing SVD-only predictions deterministically; pin in `tests/tasteMatchService.test.js`.

---

## File Structure & Responsibility Map

| File | Action | Responsibility |
| :--- | :---: | :--- |
| `scripts/experiments/v6_gate_eval.mjs` | Create | Canonical leakage-clean `Dev-150` / `Holdout-150` / `All-300` Hard-Gate evaluator with paired bootstrap 95% CI, `Tail@20`, `Cov`, `AvgV`, latency, and JSON checkpointing. |
| `scripts/experiments/train_sparse_ease.py` | Modify | Support multi-scale `B = α B_low + (1-α) B_high` blending before top-`K` pruning, `store_neg` signed negative edges, and `--max-items` / `--k` sweeps. |
| `scripts/experiments/tune_ranker_v6.mjs` | Create | `Dev-150` optimizer for `DEFAULT_RANKER_WEIGHTS` + `metadataDampingFactor` on top of the active `EASE^R + SVD` signal, verified on untouched `Holdout-150`. |
| `scripts/experiments/eval_math_anchor_llm.mjs` | Create | 20-user leakage-clean LLM holdout benchmark comparing current unbiased prompt vs. math-anchored curation (`NDCG@20`, `Hits@20`, `HR@20`, prestige overlap, mood compliance). |
| `src/services/easeService.js` | Modify *(if gated)* | Support signed negative EASE^R edges and vault-size-adaptive `easeWeight` (`resolveAdaptiveEaseWeight`). |
| `src/services/rankerService.js` & `public/models/ranker_weights.json` | Modify *(if gated)* | Apply Holdout-150-verified calibrated logistic weights and damping factor. |
| `src/services/geminiService.js` | Modify *(if gated)* | Add `"any"`-vibe-only math-anchor guidance in `buildGeminiReRankPrompt` and jargon stripping in `sanitizeOracleReason`. |
| `public/models/item_ease_k64.cvea` | Replace *(if gated)* | Production full-32M EASE^R binary trained with the winning multi-scale / `K` / `store_neg` configuration. |
| `public/models/content_embeddings_f16.bin` | Create *(if gated)* | Production `64`-D float16 `CVEM v1` semantic plot embeddings (`gemini-embedding-001`) for post-2023 cold-start films. |
| `src/services/tasteMatchService.js`, `src/components/MovieDetails.jsx`, `src/components/SearchModal.jsx` | Modify *(if gated)* | Wire `loadDefaultEaseIndex` + `blendEaseAndCollabSimMaps` into `buildTasteMatchContext` so on-device `"For You"` Match `%` uses `v6` EASE^R + SVD. |
| `tests/easeService.test.js`, `tests/rankerService.test.js`, `tests/geminiDualEngine.test.js`, `tests/contentSimService.test.js`, `tests/tasteMatchService.test.js` | Modify | Pin every shipped interface, edge case, and Review Focus invariant. |
| `MODEL_REFINEMENT_LOG.md`, `ARCHITECTURE.md`, `LOCAL_MODEL_GUIDE.md`, `README.md` | Modify | Record every tested experiment (kept AND rejected) with exact Dev-150 & Holdout-150 tables. |

---

### Task 1: Canonical v6.0 Clean Baseline & Hard-Gate Evaluator

**Files:**
- Create: `scripts/experiments/v6_gate_eval.mjs`
- Output (gitignored under `.data/`): `.data/v6_lab/ease_v6_baseline_clean.cvea`, `.data/v6_lab/v6_baseline.json`

**Interfaces:**
- Consumes: `parseEmbeddingBinary`, `buildCollabSimMapFromIndex`, `buildRepulsionMapFromIndex` (`src/services/embeddingService.js`); `parseEaseBinary`, `buildEaseSimMapFromIndex`, `blendEaseAndCollabSimMaps` (`src/services/easeService.js`); `rankCandidatePool`, `DEFAULT_RANKER_WEIGHTS` (`src/services/rankerService.js`); `temporalHoldoutSplit`, `computeNDCGAtK` (`src/services/evalHarness.js`).
- Produces: CLI `node scripts/experiments/v6_gate_eval.mjs --ease <path> [--svd <path>] [--ease-weight <num|adaptive>] [--weights-json <path>] [--save-baseline <path>] [--compare-baseline <path>]` that prints `DEV-150`, `HOLDOUT-150`, `ALL-300` metrics + explicit `GATE: PASS | FAIL` verdict with per-rule breakdown.

- [ ] **Step 1: Train the exact clean v6.0 replica binary (625 eval users excluded)**

Run:
```bash
python scripts/experiments/train_sparse_ease.py --max-items 14000 --k 64 --lam 800 --pop-gamma 0.12 --out .data/v6_lab/ease_v6_baseline_clean.cvea
```
Expected: Exits `0`, logs `CLEAN MODE: Excluding 625 evaluation users`, exports `.data/v6_lab/ease_v6_baseline_clean.cvea` (`3.47 MB`).

- [ ] **Step 2: Implement `scripts/experiments/v6_gate_eval.mjs`**

Implement reusable evaluator with exported helpers `loadCleanCohort(limit = 300)`, `evaluatePipeline(cohort, { svdIdx, easeIdx, weights, rankerOptions, easeOptions, blendOptions })`, and `checkShipGate(candidateResult, baselineResult, extraMb = 0)`. Compute `HR@1`, `NDCG@10`, `NDCG@20`, `Hits@20`, `Tail@20` (excluding top-200 TMDB `vote_count`), `HR@20`, `HR@100`, `Hits@100`, `Cov`, `AvgV`, `withinUserAuc` (`>=8 vs <=7`), and `ms/user`, plus `1,000`-resample paired bootstrap 95% CIs (`seed = 42`) against `--compare-baseline` JSON.

- [ ] **Step 3: Lock the canonical v6.0 baseline snapshot**

Run:
```bash
node scripts/experiments/v6_gate_eval.mjs --ease .data/v6_lab/ease_v6_baseline_clean.cvea --save-baseline .data/v6_lab/v6_baseline.json
```
Expected: Exits `0`, prints `DEV-150`, `HOLDOUT-150`, and `ALL-300` metrics (confirming `ALL-300 NDCG@10 ~ 0.116`, `NDCG@20 ~ 0.147`, `HR@20 ~ 74%`, `HR@100 ~ 96.5%`), and writes `.data/v6_lab/v6_baseline.json`.

- [ ] **Step 4: Commit the reusable gate harness**

```bash
git add scripts/experiments/v6_gate_eval.mjs
git commit -m "chore(eval): add v6 leakage-clean 300-user Hard-Gate benchmark harness"
```

---

### Task 2: Multi-Scale Sparse EASE^R + Negative Edges + Graph Capacity Sweep

**Files:**
- Modify: `scripts/experiments/train_sparse_ease.py`
- Modify *(only if Gate passes)*: `src/services/easeService.js`, `public/models/item_ease_k64.cvea` (or updated asset path if `K` changes)
- Test: `tests/easeService.test.js`

**Interfaces:**
- Consumes: `scripts/experiments/v6_gate_eval.mjs` and `.data/v6_lab/v6_baseline.json` from Task 1.
- Produces: Either a Gate-verified upgraded EASE^R binary (`CVEA v1`, optionally with signed negative edges `nbrW[j] < 0`) + updated `.data/v6_lab/v6_current_best.json` baseline, OR a clean rejection entry for `MODEL_REFINEMENT_LOG.md`.

- [ ] **Step 1: Extend `scripts/experiments/train_sparse_ease.py` for multi-scale EASE^R and signed negative edges**

Add CLI flags `--lam-low <float>` (optional), `--lam-high <float>` (optional), `--multi-alpha <float>` (default `0.5`, computes `B = alpha * B_low + (1 - alpha) * B_high` in-place before damping and top-`K` pruning — zero extra binary size!), and `--store-neg <int>` (default `0`, reserves `store_neg` of the `K` slots for the most negative `B[i, j]` weights). Keep single-`--lam` behavior 100% backward compatible.

- [ ] **Step 2: Generate clean sweep binaries into `.data/v6_lab/ease_sweep/`**

Run targeted clean sweeps (all excluding 625 eval users):
1. **Zero-cost Multi-Scale (`K=64`, `14k`, `3.47 MB`):** `lam_low=250, lam_high=1500, alpha ∈ {0.35, 0.50, 0.65}` with `pop-gamma=0.12`.
2. **Signed Negative Edges (`K=64`, `14k`, `3.47 MB`):** best single/multi-scale with `store_neg ∈ {6, 12}`.
3. **Capacity Expansion (`+1.7 MB` to `+3.0 MB` — must beat the `+2% NDCG@20 per +2 MB` rule!):** `K=96` (`14k`, `5.18 MB`) and `max_items=18000, K=64` (`4.46 MB`).

- [ ] **Step 3: Evaluate every sweep binary on `Dev-150`, then run Hard-Gate check on `Holdout-150` ONLY for the top 2 Dev-150 winners**

Run:
```bash
node scripts/experiments/v6_gate_eval.mjs --ease .data/v6_lab/ease_sweep/<winner>.cvea --compare-baseline .data/v6_lab/v6_baseline.json
```
Decision Gate:
- **If `GATE: FAIL`:** Do NOT touch `public/models/` or `src/services/easeService.js`. Record exact `Dev-150` and `Holdout-150` numbers for Task 7's logbook update and move immediately to Task 3.
- **If `GATE: PASS`:** Proceed to Steps 4–7 below.

- [ ] **Step 4: Write failing tests in `tests/easeService.test.js` for signed negative EASE^R edges & negative-only vaults (Review Focus #1)**

```js
test("buildEaseSimMapFromIndex handles signed negative EASE^R edges cleanly without NaN and suppresses avoided items", () => {
  const items = [
    { tmdbId: 100, neighbors: [{ index: 1, weight: 0.45 }, { index: 2, weight: -0.30 }] },
    { tmdbId: 200, neighbors: [{ index: 0, weight: 0.40 }, { index: 2, weight: -0.25 }] },
    { tmdbId: 300, neighbors: [{ index: 0, weight: -0.20 }, { index: 1, weight: -0.15 }] }
  ];
  const idx = parseEaseBinary(encodeEaseBinary(items, 2));
  const posOnly = buildEaseSimMapFromIndex([{ tmdbId: 100, rating: 10 }], idx);
  assert.ok(posOnly.get(200) > 0.5);
  assert.ok(posOnly.get(300) < -0.3);

  const negOnly = buildEaseSimMapFromIndex([{ tmdbId: 100, rating: 2 }], idx);
  const blended = blendEaseAndCollabSimMaps(negOnly, new Map([[200, 0.5], [300, 0.5]]), idx);
  for (const v of blended.values()) assert.ok(Number.isFinite(v), "Must never produce NaN");
});
```

- [ ] **Step 5: Verify `src/services/easeService.js` passes signed-edge & production binary checks, retrain full-32M production binary**

Run full-32M production training with winning flags into `public/models/item_ease_k64.cvea` (updating `tests/easeService.test.js` count/K assertion if `max_items` or `K` changed). Update `.data/v6_lab/v6_current_best.json` from the clean twin.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: `0` failures.

- [ ] **Step 7: Commit**

```bash
git add scripts/experiments/train_sparse_ease.py src/services/easeService.js public/models/item_ease_k64.cvea tests/easeService.test.js
git commit -m "feat(ml): ship Holdout-150 verified multi-scale EASE^R upgrade"
```

---

### Task 3: Vault-Size-Adaptive `easeWeight` & Rating/Recency Curve in `easeService.js`

**Files:**
- Modify *(only if Gate passes)*: `src/services/easeService.js`
- Test: `tests/easeService.test.js`

**Interfaces:**
- Consumes: Winning clean EASE^R binary + `.data/v6_lab/v6_current_best.json` from Task 2.
- Produces *(if gated)*: `resolveAdaptiveEaseWeight(indexedWatchCount, options)` exported from `src/services/easeService.js` and accepted via `blendEaseAndCollabSimMaps(easeSimMap, collabSimMap, easeIndex, { indexedWatchCount })`.

- [ ] **Step 1: Stratify `Dev-150` by vault size (`<25`, `25–59`, `60+` indexed ratings) and sweep adaptive `easeWeight` + recency/rating-power curves**

Test inside `scripts/experiments/v6_gate_eval.mjs` (passing `--sweep-client`):
1. Smooth vault-size sigmoid/ramp: `easeWeight(n) = minW + (maxW - minW) * (n / (n + pivot))` across `(minW, maxW, pivot) ∈ {(0.35, 0.70, 25), (0.40, 0.72, 30), (0.45, 0.75, 40)}`.
2. Rating power curve inside `buildEaseSimMapFromIndex`: linear (`7→0.85..10→1.30`) vs. sharp high-tier (`8→1.05, 9→1.35, 10→1.70`) vs. mild recency weighting (`0.8 + 0.4 * decay`).
3. Verify the winning `Dev-150` formula on untouched `Holdout-150` via the 4-part Hard Ship Gate (and confirm it does not regress ANY of the 3 vault-size strata!).

Decision Gate:
- **If `GATE: FAIL`:** Discard the adaptive formula (keep simple constant `DEFAULT_EASE_BLEND_WEIGHT = 0.60`), record exact numbers for `MODEL_REFINEMENT_LOG.md`, and skip to Task 4.
- **If `GATE: PASS`:** Proceed to Steps 2–6.

- [ ] **Step 2: Write failing boundary tests in `tests/easeService.test.js` (Review Focus #2)**

```js
test("resolveAdaptiveEaseWeight scales monotonically across 0, 1, 5, 20, and 80 indexed watches with no discontinuities", () => {
  const vals = [0, 1, 5, 20, 80].map((n) => resolveAdaptiveEaseWeight(n));
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] >= vals[i - 1], `Expected monotonic increase at idx ${i}`);
  }
  assert.ok(vals[0] >= 0.30 && vals[4] <= 0.80);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/easeService.test.js`
Expected: FAIL with `resolveAdaptiveEaseWeight is not exported`.

- [ ] **Step 4: Implement `resolveAdaptiveEaseWeight` and wire into `blendEaseAndCollabSimMaps` in `src/services/easeService.js`**

Wire `indexedWatchCount` (count of positively matched vault items in `easeIndex`) from `buildEaseSimMapFromIndex` or caller context while keeping explicit numeric `options.easeWeight` overrides 100% deterministic for existing tests.

- [ ] **Step 5: Run full test suite & update `.data/v6_lab/v6_current_best.json`**

Run: `npm test`
Expected: `0` failures.

- [ ] **Step 6: Commit**

```bash
git add src/services/easeService.js tests/easeService.test.js
git commit -m "feat(ml): add Holdout-150 verified adaptive EASE^R blend weighting"
```

---

### Task 4: Re-Calibrating `DEFAULT_RANKER_WEIGHTS` & `metadataDampingFactor` for EASE^R + SVD

**Files:**
- Create: `scripts/experiments/tune_ranker_v6.mjs`
- Modify *(only if Gate passes)*: `src/services/rankerService.js`, `public/models/ranker_weights.json`
- Test: `tests/rankerService.test.js`, `tests/moodRanker.test.js`

**Interfaces:**
- Consumes: Winning EASE^R + client blend + `.data/v6_lab/v6_current_best.json` from Tasks 2–3.
- Produces *(if gated)*: Recalibrated `DEFAULT_RANKER_WEIGHTS` & `DEFAULT_METADATA_DAMPING_FACTOR` in `src/services/rankerService.js`, synchronized identically with `public/models/ranker_weights.json`.

- [ ] **Step 1: Build `scripts/experiments/tune_ranker_v6.mjs` to optimize ranker weights strictly on `Dev-150`**

Precompute `collabSimMap` (EASE^R+SVD) and `repulsionMap` once for all 300 users, then run bounded coordinate descent + L2 regularization around current `DEFAULT_RANKER_WEIGHTS` optimizing `Dev-150 NDCG@20 + 0.5 * Tail@20` (preventing popularity over-weighting!) over:
- `collabSim ∈ [4.0, 9.0]`
- `bayesianRatingNorm ∈ [0.6, 2.4]`
- `genreOverlap ∈ [0.2, 1.2]`
- `keywordOverlap ∈ [0.2, 1.0]`
- `crewMatch ∈ [0.3, 1.4]`
- `castMatch ∈ [0.2, 1.0]`
- `repulsion ∈ [-2.5, -0.8]`
- `negativeKeywordPenalty ∈ [-1.0, -0.2]`
- `metadataDampingFactor ∈ [0.15, 0.50]`
Keep `noveltyBonus`, `providerMatch`, and `dnaSim` fixed so offline tuning never corrupts live streaming/cold-start signals.

- [ ] **Step 2: Run Hard-Gate verification on untouched `Holdout-150` AND verify explicit Mood tests**

Run:
```bash
node scripts/experiments/tune_ranker_v6.mjs --save-weights .data/v6_lab/candidate_weights.json
node scripts/experiments/v6_gate_eval.mjs --ease <best_clean_ease> --weights-json .data/v6_lab/candidate_weights.json --compare-baseline .data/v6_lab/v6_current_best.json
```
Decision Gate:
- **If `GATE: FAIL`:** Do NOT alter `DEFAULT_RANKER_WEIGHTS` or `ranker_weights.json`. Log the negative result and move to Task 5.
- **If `GATE: PASS`:** Proceed to Steps 3–5.

- [ ] **Step 3: Update `DEFAULT_RANKER_WEIGHTS` / `DEFAULT_METADATA_DAMPING_FACTOR` in `src/services/rankerService.js` and mirror verbatim in `public/models/ranker_weights.json`**

Update `_source` in `public/models/ranker_weights.json` to `"v6.1-ease-dev150-verified"` and verify `tests/rankerService.test.js` parity test passes untouched.

- [ ] **Step 4: Run full test suite & verify mood isolation**

Run: `npm test`
Expected: `0` failures (including all `tests/moodRanker.test.js` and `tests/rankerService.test.js` suites). Update `.data/v6_lab/v6_current_best.json`.

- [ ] **Step 5: Commit**

```bash
git add scripts/experiments/tune_ranker_v6.mjs src/services/rankerService.js public/models/ranker_weights.json tests/rankerService.test.js
git commit -m "tune(ranker): recalibrate logistic ranker weights for EASE^R + SVD"
```

---

### Task 5: Math-Anchored Gemini Curation (Fixing IMDb Top-50 Prestige Bias)

**Files:**
- Create: `scripts/experiments/eval_math_anchor_llm.mjs`
- Modify *(only if Gate passes)*: `src/services/geminiService.js`
- Test: `tests/geminiDualEngine.test.js`

**Interfaces:**
- Consumes: Winning EASE^R + SVD + Ranker stack from Tasks 2–4; `buildDiversifiedGeminiShortlist`, `buildGeminiReRankPrompt`, `mergeGeminiExplanationsWithRanker`, `sanitizeOracleReason`.
- Produces *(if gated)*: `"any"`-vibe-only core-anchor cue (`CORE_ANCHOR_SLOTS = 8`) in `buildGeminiReRankPrompt` + jargon sanitizer rule preventing `[Core Match]` / `High-Confidence Core` leakage in `sanitizeOracleReason`.

- [ ] **Step 1: Build `scripts/experiments/eval_math_anchor_llm.mjs` (20-user leakage-clean LLM holdout)**

Run a paired A/B on 20 unseen MovieLens 32M users (`gemini-3.5-flash-lite`, `100 → 20` shortlist from the new `EASE^R + SVD` ranker, checkpointed per user with 503 retry):
- **Control A (Current Production Prompt):** `"Curate openly"` with flat 100 candidates.
- **Treatment B (Math-Anchored Prompt, `"any"` vibe only):** Mark top `8` core candidates with `[Strong Vault Signal]` and instruct Gemini: *"Keep high-signal core matches among your 20 picks unless they clash with dislikes, near-misses, or taste rules; do not replace strong franchise/cluster matches with generic IMDb classics; spend your creative curation on the remaining 12 discovery slots and wildcards."*
- **Treatment C (Soft Hybrid Merge):** Same Treatment B prompt + guarantee top `4` ranker picks remain protected from total eviction unless avoided/mood-rejected or director/franchise-capped.
Measure `NDCG@10`, `NDCG@20`, `Hits@20`, `HR@20`, `Tail@20`, and paired bootstrap 95% CI vs. Control A (plus sanity-check Pure Math Top-20 ceiling!).

- [ ] **Step 2: Run the 20-user LLM A/B and check Gate**

Run:
```bash
node scripts/experiments/eval_math_anchor_llm.mjs --users 20
```
Decision Gate:
- Ship Treatment B (or C) ONLY if it beats Control A on `NDCG@20` AND `Hits@20` with `Tail@20 >= Control A - 2%` and zero hallucination/jargon regressions.
- **If Gate fails:** Discard, log exact A/B/C numbers for `MODEL_REFINEMENT_LOG.md`, and move to Task 6.

- [ ] **Step 3: Write failing tests in `tests/geminiDualEngine.test.js` (Review Focus #3)**

Assert that:
1. Under `mood: "any"` with no custom vibe, `buildGeminiReRankPrompt` includes the core-anchor cue ONLY for the top core slots.
2. Under `mood: "comfort-watch"` OR a custom free-text `moodFilters.query`, `buildGeminiReRankPrompt` OMITS the core-anchor cue completely so Mood/Vibe rules stay sovereign.
3. `sanitizeOracleReason` strips `[Strong Vault Signal]` / `High-Confidence Core` if Gemini ever echoes it into prose.

- [ ] **Step 4: Run test to verify it fails, then implement in `src/services/geminiService.js`**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: FAIL before edit, PASS after edit.

- [ ] **Step 5: Run full test suite and commit**

Run: `npm test`
Expected: `0` failures.
```bash
git add scripts/experiments/eval_math_anchor_llm.mjs src/services/geminiService.js tests/geminiDualEngine.test.js
git commit -m "feat(oracle): add Holdout-verified math-anchored curation for Any Vibe"
```

---

### Task 6: Real Semantic Text Embeddings (`content_embeddings_f16.bin`) for Post-2023 Cold-Start (`2024–2026` Releases)

**Files:**
- Modify *(if needed)*: `scripts/build_content_embeddings.mjs`
- Create *(only if Gate passes)*: `public/models/content_embeddings_f16.bin`
- Test: `tests/contentSimService.test.js`

**Interfaces:**
- Consumes: `scripts/build_content_embeddings.mjs` (`gemini-embedding-001`, `dims = 64`, `CVEM v1`), `scripts/experiments/run_partial_mask_eval.mjs` (warm/cold mask evaluator), `loadDefaultContentIndex` & `buildContentSimMap` (`src/services/contentSimService.js`).
- Produces *(if gated)*: Verified `public/models/content_embeddings_f16.bin` (`~1.2–2.5 MB`, covering TMDB catalog + `2024–2026` popular releases) with zero warm-item regression (`coldOnly: true`).

- [ ] **Step 1: Build clean evaluation content embeddings over `.data/tmdb_enriched.json` into `.data/v6_lab/content_64_f16.bin`**

Run:
```bash
node scripts/build_content_embeddings.mjs --input .data/tmdb_enriched.json --out .data/v6_lab/content_64_f16.bin --cache .data/content_embed_cache.json --model gemini-embedding-001 --dims 64 --batch-size 50
```
Expected: Embeds title + tagline + overview (zero MovieLens/rating leakage!) into `.data/v6_lab/content_64_f16.bin` (`~1.2 MB`, `CVEM v1`, `dim = 64`).

- [ ] **Step 2: Benchmark strictly on Cold-Start masked evaluation (`100%` cold & `30%` partial-mask)**

Run `scripts/experiments/run_partial_mask_eval.mjs` (extended with `--content-bin .data/v6_lab/content_64_f16.bin`) comparing:
- **Control:** Current cold-start structured + overview bigram TF-IDF fallback (`contentIndex = null`).
- **Treatment:** `content_64_f16.bin` (`coldOnly: true`, `contentSim: 1.4`, also sweeping `contentSim ∈ {1.4, 2.2, 3.0}` on `Dev-150` masked slice → gating on `Holdout-150` masked slice!).
Decision Gate:
- Ship ONLY if `content_64_f16.bin` delivers a statistically significant (`ciLower > 0`, paired bootstrap 95% CI) lift on cold-start `NDCG@20` & `Recall@20` on `Holdout-150` AND `0.000` regression on warm (`0%` masked) items!
- **If Gate fails:** Discard `content_embeddings_f16.bin`, record exact cold-start numbers in `MODEL_REFINEMENT_LOG.md`, and move to Task 7.

- [ ] **Step 3: Write cold-only isolation & binary header test in `tests/contentSimService.test.js` (Review Focus #4)**

Assert that `buildContentSimMap(..., { collabIndex, collabSimMap, coldOnly: true })` scores unindexed (`collabSim === 0`) films via `contentIndex` while leaving warm indexed films (`collabSim > 0`) at `0` so `EASE^R + SVD` is never diluted.

- [ ] **Step 4: Build production `public/models/content_embeddings_f16.bin` (catalog + `2024–2026` TMDB releases) and verify tests + build**

Verify `public/models/content_embeddings_f16.bin` parses cleanly via `parseEmbeddingBinary`, fits within `<= 2.5 MB`, copies to `build/models/content_embeddings_f16.bin`, and passes `npm test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add public/models/content_embeddings_f16.bin scripts/build_content_embeddings.mjs tests/contentSimService.test.js
git commit -m "feat(ml): ship verified 64-D semantic content embeddings for cold-start releases"
```

---

### Task 7: Wire Verified EASE^R Engine into Universal Taste Match (`tasteMatchService.js`) + Final Audit & Logbook Sync

**Files:**
- Modify: `src/services/tasteMatchService.js`, `src/components/MovieDetails.jsx`, `src/components/SearchModal.jsx`
- Test: `tests/tasteMatchService.test.js`
- Modify: `MODEL_REFINEMENT_LOG.md`, `ARCHITECTURE.md`, `LOCAL_MODEL_GUIDE.md`, `README.md`

**Interfaces:**
- Consumes: `loadDefaultEaseIndex`, `buildEaseSimMapFromIndex`, `blendEaseAndCollabSimMaps` (`src/services/easeService.js`); `buildTasteMatchContext` (`src/services/tasteMatchService.js`).
- Produces: `buildTasteMatchContext({ watched, watchlist, tasteRules, embeddingIndex, easeIndex = null, now })` delivering identical `EASE^R + SVD` Match `%` and `Est. X.X/10` on Movie Detail pages and Search results, plus fully updated `MODEL_REFINEMENT_LOG.md` documenting every kept AND rejected experiment from Tasks 1–6.

- [ ] **Step 1: Verify `withinUserAuc` lift of `EASE^R + SVD` on `Holdout-150` rated pairs (`>=8 vs <=7` and `>=9 vs <=7`)**

Confirm using Task 1's `v6_gate_eval.mjs` output that `EASE^R + SVD` improves or preserves `withinUserAuc` over `SVD-64` on `Holdout-150` before wiring into `tasteMatchService.js`.

- [ ] **Step 2: Write failing tests in `tests/tasteMatchService.test.js` (Review Focus #5)**

Assert that:
1. Omitting `easeIndex` (or passing `easeIndex: null`) produces bit-identical output to existing SVD-only `buildTasteMatchContext`.
2. Passing a valid `easeIndex` blends `EASE^R + SVD` into `collabSimMap` and elevates a strong EASE^R neighbor's `matchPct` and `predictedRating` cleanly within `[50, 99]` / `[4.5, 9.9]`.

- [ ] **Step 3: Run test to verify it fails, then update `src/services/tasteMatchService.js`, `MovieDetails.jsx`, and `SearchModal.jsx`**

Add optional `easeIndex = null` parameter to `buildTasteMatchContext` and load `loadDefaultEaseIndex().catch(() => null)` in parallel with `loadDefaultEmbeddingIndex()` in `MovieDetails.jsx` and `SearchModal.jsx`.

- [ ] **Step 4: Run full verification suite**

Run:
```bash
npm test
npm run build
```
Expected: `0` test failures; `vite build` succeeds cleanly with zero >500 kB chunk warnings and all shipped binaries present in `build/models/`.

- [ ] **Step 5: Update `MODEL_REFINEMENT_LOG.md`, `ARCHITECTURE.md`, `LOCAL_MODEL_GUIDE.md`, and `README.md`**

Log EVERY experiment from Tasks 2–6 (both **Shipped** and **Rejected**!) in `MODEL_REFINEMENT_LOG.md` with exact `Dev-150`, `Holdout-150`, and `All-300` numbers, bootstrap significance flags, `Tail@20`, `Cov`, and `AvgV`, and update the Executive Progress Tracker row to `v6.1`.

- [ ] **Step 6: Commit & push**

```bash
git add src/services/tasteMatchService.js src/components/MovieDetails.jsx src/components/SearchModal.jsx tests/tasteMatchService.test.js MODEL_REFINEMENT_LOG.md ARCHITECTURE.md LOCAL_MODEL_GUIDE.md README.md
git commit -m "feat(ml,docs): wire EASE^R into Taste Match and record v6.1 refinement results"
```
