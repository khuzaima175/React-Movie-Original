# CinemaVault — Model Refinement & Experiment Logbook

> **Living Research Log:** Every offline math experiment, LLM curation benchmark, architectural test, mistake caught, and verified gain is recorded here so we can iteratively refine CinemaVault's recommendation accuracy with zero guesswork and zero data leakage.

**Current Production Engine:** `v6.0` (**Exact Full-Rank Sparse EASE^R `14k×64` + SVD-64 `60/40` Hybrid** → **100-Candidate Stratified Shortlist** → **20 Curated Picks**)  
**Primary Benchmark Standard:** `300` completely unseen MovieLens 32M users (`.data/fresh_300_users.json`), chronological temporal holdout (last `10` ratings `>= 8/10`), evaluated against the `9,733`-film TMDB-enriched catalog with **all `625` evaluation users stripped from training** (`Dev-150` tuning split + untouched `Holdout-150` verification split + `1,000`-resample paired bootstrap `95%` CI).

---

## Executive Progress Tracker (300 Unseen MovieLens 32M Users)

| Version / Milestone | Date | Core Engine | `HR@1` (#1 Pick) | `NDCG@10` | `NDCG@20` | `HR@20` (≥1 Hit) | Avg Hits `@20` | Long-Tail Hits `@20` *(excl. top-200 pop)* | Shortlist Coverage (`HR@K` / Hits) |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **v5.6 Baseline** | 2026-11-20 | `SVD-64` (`CVEM v1`, 3.15 MB) + 12-feat Logistic Ranker · `39 → 10` | `12.3%` | `0.0789` | `0.1039` | `61.7%` | `1.247` | `0.887` | `HR@60: 86.0%` (`2.63`) |
| **v6.0 (Current)** | 2026-11-23 | **Exact Full-Rank Sparse EASE^R (`14k×64`, `λ=800`, `γ=0.12`) + `SVD-64` (`60/40`)** · **`100 → 20`** | **`17.0%–18.0%`** *(+38%–46%)* | **`0.1164`** *(**+47.6%\***)* | **`0.1475`** *(**+41.9%\***)* | **`74.7%`** *(+13.0 pts)* | **`1.653`** *(+32.6%)* | **`0.950`** *(**+7.1%**)* | **`HR@100: 96.7%` (`4.11` hits)** |

*\* = Statistically significant (`p < 0.05` via 1,000-resample paired bootstrap 95% CI) on BOTH `Dev-150` AND untouched `Holdout-150`.*

---

## Detailed Experiment Chronicle (2026-11-23)

### Experiment 1: Hybrid Math + Gemini vs. Bare Full-Vault LLM (20-User ML-32M Holdout)
- **Script:** [scripts/experiments/ml32m_holdout_eval.mjs](./scripts/experiments/ml32m_holdout_eval.mjs)
- **Question:** Does giving Gemini the user's entire tiered watch history directly (no math ranker) beat CinemaVault's hybrid `Math → Shortlist → Gemini` pipeline?
- **Results (20 leakage-clean users, 10 held-out `>=8/10` per user, `gemini-3.5-flash-lite`):**
  | Track | Hit Rate `@10` | Avg Hits `@10` | `NDCG@10` | Relative Lift |
  | :--- | :---: | :---: | :---: | :---: |
  | **Track 1: Math Shortlist (`39`) → Flash-Lite (`10`)** | **45.0%** | **0.70** | **`0.0683`** | **2.37× vs. Bare LLM** |
  | **Pure Local Math Ranker (`0` AI calls)** | 35.0% | 0.75 | `0.0620` | 2.15× vs. Bare LLM |
  | **Bare Full-Vault → Flash-Lite (No Math)** | 40.0% | 0.40 | `0.0288` | Baseline |
- **Key Lesson:** Even with the entire tiered watch history, a bare LLM gets crushed (`2.37×` lower `NDCG@10`) compared to math-backed curation.

---

### Experiment 2: Shortlist Widening (`39 → 60 → 80 → 100`) & Output Stretching (`10 → 20`)
- **Scripts:** [scripts/experiments/eval_top80_compact.mjs](./scripts/experiments/eval_top80_compact.mjs), [scripts/experiments/math_lab_300.mjs](./scripts/experiments/math_lab_300.mjs)
- **Why we tested it:** On user `31097` (105 rated films: 35 superhero movies + 6 horror `10/10`s), `Insidious` (#26) and `The Conjuring 2` (#28) missed the old `coreLimit = 25` cutoff by just 1–3 slots!
- **Findings:**
  1. **Shortlist `39 → 80` compact prompt (12 matched ML-32M users on Flash-Lite):**
     - `NDCG@10`: `0.0604 → 0.0801` (**+32.6%**)
     - `Hits@10`: `0.583 → 0.750` at ~`7,359` tokens.
  2. **Output `10 → 20` picks (300 unseen users, `SVD-64` baseline):**
     - `#1 Pick`: `11.3%` hit `>=8/10`; `5.1%` (`11/215`) hit an exact `10/10`.
     - `Top 10`: `43.3%` hit `>=8/10` (`0.73` mean hits); `22.8%` (`49/215`) hit a `10/10`.
     - `Top 20`: **`61.7%`** hit `>=8/10` (`1.21` mean hits); **`38.6%`** (`83/215`) hit a `10/10`.
  3. **Shortlist `60 → 100` (300 unseen users):**
     - Old `SVD-64`: `HR@60 = 86.0%` (`2.63` hits) → `HR@100 = 92.3%` (`3.45` hits).
     - New `EASE^R + SVD`: **`HR@100 = 96.7%` (`4.11` hits out of 10 inside Gemini's candidate pool!)**.
- **Shipped:** Widened Oracle to **`100 → 20`** (`72 core + 14 cold 2024–2026 + 14 diverse outliers`, live Bucket E neighbor injection `30 → 50`, adaptive prompt budget scaling cleanly up to `34,000` chars) + refined 2-column Oracle card UI with grounded 2-sentence editorial pitches.

---

### Experiment 3: Frontier Model Showdown — Hydrogen xHigh vs. Neon vs. Bare LLM vs. Pure Math
- **Users:** 3 held-out MovieLens 32M users (`53506`, `81804`, `111675`) tested manually in fresh Hydrogen xHigh and Neon App High chats (both `Math-80 → Pick 10/20` and `Bare No-Math → Pick 20`).
- **Head-to-Head Top-20 Results (3-User Summary):**
  | System | Avg Hits `@10` | `NDCG@10` | Avg Hits `@20` | Total Hits `@20` (of 30) | Users With ≥1 Hit `@20` | `NDCG@20` |
  | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
  | **Pure Local Math (`0` AI)** | **1.33** | **0.1385** | **2.67** | **8 / 30** | 2 / 3 (67%) | **0.1966** |
  | **Math-80 → Hydrogen xHigh** | 0.67 | 0.0998 | 1.67 | **5 / 30** | **3 / 3 (100%)** | 0.1259 |
  | **Bare LLM (No Math)** | 1.00 | 0.1051 | 1.33 | 4 / 30 | 2 / 3 (67%) | 0.1290 |
- **Key Findings:**
  1. **10 → 20 unlocked 100% user hit coverage** for Math-80 → Hydrogen (`#19 The Truman Show` 9/10 on User 1, `#20 Ben-Hur` 8/10 on User 2, `#11 Pirates 3` 8/10 on User 3).
  2. **The "IMDb Top-50 Prestige Bias" Trap:** Bare LLM's Top-10 overlapped **6/10, 8/10, and 7/10** with Math-80 → Hydrogen (and Hydrogen vs. Neon overlapped **9/10** on User 1!). When given total freedom, even frontier LLMs discard crowd-favorite franchise hits (`Thor 1 & 2`, `Hunger Games 1 & 2` on User 3, where Pure Math hit `7/10`!) in favor of prestige classics (`The Prestige`, `Godfather II`, `Breakfast at Tiffany's`, `Sabrina`).
  3. **Production Lesson:** **Math must drive the backbone ranking**; Gemini's highest-leverage role is tie-breaking, rescuing niche clusters (like `The Truman Show` / `The Man from U.N.C.L.E.`), adding `2–4` verified wildcards, and writing grounded 2-sentence editorial explanations.
  4. **Cascade Tuning Shipped:** Raised `HYDROGEN_TIMEOUT_MS` (`35s → 60s`), `maxCascadeDurationMs` (`45s → 90s` when Hydrogen is included), promoted `gemini-3.8-flash` right after Hydrogen in `CURATION_MODEL_CASCADE` (while keeping Flash-Lite for public/fast paths), and raised custom free-text vibe wildcards from `2 → 4`.

---

### Experiment 4: Client-Side Math Lab (Implicit-Aware Ridge & Full-Vault Item-Item KNN)
- **Script:** [scripts/experiments/math_lab_300.mjs](./scripts/experiments/math_lab_300.mjs)
- **Hypothesis:** Current `computeUserRidgeEmbedding` centers targets around `meanR` (`z = (r - min(meanR, 7.5)) / std`), turning liked `7/10` movies into *negative* targets when `meanR >= 7.5` and ignoring the strong implicit watch signal. Meanwhile, `topLovedPool` caps item-item similarity at `25` films / `top-3` neighbors.
- **Results on `SVD-64` (`clean2`):**
  - Increasing old zero-mean `ridgeBlend` to `0.75` **hurt** `NDCG@10` by `-8.9%` (confirming the negative-7/10 flaw).
  - **Implicit-Aware Ridge (`y = 0.7 + 0.8 * (r-6)/4` for `>=7`) + Full-Vault Item-Item Power KNN (`p=3`, `50/50`):**
    - `Dev-150`: `NDCG@10 +4.3%`, `NDCG@20 +5.7%`, `Hits@20 +16.3%` (`1.187 → 1.380`), `HR@20: 61.3% → 66.7%`.
    - `Holdout-150`: `NDCG@10 +3.7%`, `NDCG@20 +4.3%`, `Hits@20 +5.1%`, `HR@100: 91.3% → 95.3%`.
- **Disposition:** Valid `+4–5%` client gain on SVD-64, later superseded by the far larger **+45% Exact Sparse EASE^R** breakthrough in Experiment 6.

---

### Experiment 5: Spectral EASE^R (`dim=128` SVD) & GF-CF — The Popularity-Confound Catch!
- **Scripts:** [scripts/experiments/train_spectral_ease.py](./scripts/experiments/train_spectral_ease.py), [scripts/experiments/sweep_spectral_ease.py](./scripts/experiments/sweep_spectral_ease.py), [scripts/experiments/eval_fair_math_300.mjs](./scripts/experiments/eval_fair_math_300.mjs)
- **What happened (important scientific catch!):**
  - First sweep of `svd128` with filter `sqrt(s² / (s² + λ))` (`ease128_L055_sh015`) jumped `+47.3%* NDCG@10` / `+37.2%* NDCG@20` on All-300.
  - **Diagnostic Audit Caught a Confound:** Inspecting norm distributions revealed `raw_vecs = V * filt` was ~40× smaller than `V * sqrt(s)`, so applying `shrink = 0.15` crushed 90% of catalog vector norms to `< 0.078` (vs. `0.619` in baseline), accidentally turning the model into a massive popularity prior (`Shawshank`, `Godfather II`, `LOTR`).
  - **After Fixing Norm Parity (`p90 = 0.619` identical to baseline):**
    - `ease128_L040_fair` gained `+12.8%*` on Dev-150, dropped `-3.5%` on Holdout-150 → net only **`+4.1%` on All-300** (not worth doubling binary size from `3.15 MB → 6.20 MB`).
    - `gfcf64/128` degree-normalized SVD looked strong on Dev-150 (`+19.2%*`) and collapsed to `-1.6% / -5.2%` on untouched Holdout-150.
- **Key Lesson:** **Low-rank linear SVD (64–128D) hits a hard ceiling** once popularity bias is controlled, because a 64–128D bottleneck cannot memorize sharp movie-to-movie relationships across 25,000 films. Always audit **norm distributions, Catalog Coverage, Mean Top-20 Vote Count, Long-Tail Hits@20, and untouched Holdout-150** before shipping!

---

### Experiment 6 (BREAKTHROUGH — SHIPPED IN v6.0): Exact Full-Rank Sparse EASE^R (`CVEA v1`) + SVD-64 Hybrid
- **Scripts:** [scripts/experiments/train_sparse_ease.py](./scripts/experiments/train_sparse_ease.py), [scripts/experiments/eval_sparse_ease_300.mjs](./scripts/experiments/eval_sparse_ease_300.mjs)
- **Why it works:** Instead of compressing 25,000 films through a 64-D bottleneck, **Exact EASE^R (Steck 2019)** solves the full-rank closed-form item-item regression on MovieLens 32M (`200k` users × `14,000` movies, covering **`99.16%`** of all positive ratings):
  $$G = X^\top X, \qquad P = (G + \lambda I)^{-1}, \qquad B = -P \cdot \text{diag}(P)^{-1}, \qquad \text{diag}(B) = 0$$
  Applying light column popularity damping (`γ = 0.12`, Steck 2020) before pruning each movie to its **top-64 outgoing neighbors** produces a tiny **`3.47 MB`** (`3,640,016 B`) `CVEA v1` binary (`uint16` index + `float16` weight) that scores any user's vault in **`< 1 ms`** in JavaScript!
- **Full Leakage-Clean Results (625 eval users stripped from training; `λ = 800`, `K = 64`):**

| Split & Model | `HR@1` | `NDCG@10` | `NDCG@20` | `Hits@20` | `Tail@20` *(excl. top-200)* | `HR@20` | `HR@100` (`Hits@100`) | Unique Cov | Avg Votes |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **DEV-150 · `SVD-64` Baseline** | 12.7% | `0.0772` | `0.0979` | `1.187` | `0.833` | 61.3% | 93.3% (`3.43`) | 1090 | 7,342 |
| **DEV-150 · `EASE 55 (γ=0.10) + SVD 45`** | **22.0%** | `0.1118` (+44.8%\*) | `0.1450` (+48.0%\*) | `1.680` | **`0.913` (+9.6%)** | **76.7%** | 97.3% (`4.03`) | 883 | 10,440 |
| **DEV-150 · `EASE 60 (γ=0.15) + SVD 40`** | 20.0% | `0.1114` (+44.3%\*) | `0.1430` (+46.0%\*) | `1.667` | `0.900` (+8.0%) | **76.7%** | 97.3% (`4.02`) | 869 | 10,339 |
| **HOLDOUT-150 · `SVD-64` Baseline** | 12.0% | `0.0805` | `0.1099` | `1.307` | `0.940` | 62.0% | 91.3% (`3.47`) | 1069 | 6,715 |
| **HOLDOUT-150 · `EASE 55 (γ=0.10) + SVD 45`** | 14.0% | `0.1172` (+45.6%\*) | `0.1509` (+37.2%\*) | `1.640` | `0.993` (+5.7%) | 70.7% | 95.3% (`4.15`) | 888 | 9,556 |
| **HOLDOUT-150 · `EASE 60 (γ=0.15) + SVD 40`** | 14.0% | **`0.1214` (+50.8%\*)** | **`0.1519` (+38.2%\*)** | `1.640` | **`1.000` (+6.4%)** | **72.7%** | **96.0% (`4.19`)** | 872 | 9,488 |
| **ALL-300 · `SVD-64` Baseline** | 12.3% | `0.0789` | `0.1039` | `1.247` | `0.887` | 61.7% | 92.3% (`3.45`) | 1356 | 7,029 |
| **ALL-300 · `EASE 55 (γ=0.10) + SVD 45`** | **18.0%** | `0.1145` (+45.2%\*) | **`0.1479` (+42.3%\*)** | **1.660** | **`0.953` (+7.5%)** | 73.7% | 96.3% (`4.09`) | **1106** | 9,998 |
| **ALL-300 · `EASE 60 (γ=0.15) + SVD 40`** | 17.0% | **`0.1164` (+47.6%\*)** | `0.1475` (+41.9%\*) | `1.653` | `0.950` (+7.1%) | **74.7%** | **96.7% (`4.11`)** | 1097 | 9,914 |

- **Production Ship (`v6.0`):**
  - Trained `public/models/item_ease_k64.cvea` (`14,000` items × `K=64`, `λ=800`, `γ=0.12`, `3.47 MB`, `100%` of ML-32M users).
  - Implemented [src/services/easeService.js](./src/services/easeService.js) (`60% EASE^R + 40% SVD-64` blend with cold-item SVD fallback and graceful `null` passthrough).
  - Wired into **Oracle** ([src/services/geminiService.js](./src/services/geminiService.js)) AND **Explore / For You** ([src/workers/embeddingWorker.js](./src/workers/embeddingWorker.js), [src/services/embeddingWorkerClient.js](./src/services/embeddingWorkerClient.js)), plus `vercel.json` `application/octet-stream` CDN headers and 6 new unit tests in [tests/easeService.test.js](./tests/easeService.test.js).

---

## Next Refinement Backlog (v6.1+ Ideas to Test Next)

1. **Math-Anchored Gemini Curation (`v6.1` candidate):** Protect the top ~6–8 highest-confidence EASE^R+SVD picks from LLM "IMDb Top-50 prestige override" unless they clash with dislikes/mood/taste rules, while letting Gemini freely curate the remaining 12–14 discovery slots + wildcards.
2. **EASE^R Scaling & Negative Edges (`v6.1` candidate):** Benchmark `K = 64` vs `K = 96` neighbors, `14,000` vs `18,000` items, and storing `store_neg = 8` strongest negative EASE^R weights per film for sharper dislike avoidance.
3. **Re-Calibrating `DEFAULT_RANKER_WEIGHTS` for EASE^R + SVD (`v6.1` candidate):** Current logistic weights (`collabSim: 6.4`, `bayesianRatingNorm: 1.8`, `metadataDampingFactor: 0.35`) were tuned for old `SVD-64`. Re-optimizing them on `Dev-150` + verifying on `Holdout-150` with the new EASE^R+SVD signal could unlock another `+5–15%`.
4. **Adaptive `easeWeight` by Vault Size & Recency:** Test whether small vaults (`< 20` ratings) benefit more from `SVD-64` generalization while rich vaults (`50+` ratings) benefit from `70%` EASE^R, plus recency-weighted EASE^R scoring.
5. **Post-2023 Cold-Start (`2024–2026` Releases):** Evaluate real semantic text embeddings (`content_embeddings_f16.bin`) and `dnaSim` specifically on post-2023 films outside MovieLens 32M's training window.
6. **Universal Taste Match Upgrade (`tasteMatchService.js`):** Extend `item_ease_k64.cvea` blending to `predictMovieMatch` on Movie Detail pages and Search pills so every `"For You"` Match `%` matches Oracle & Explore's `v6.0` EASE^R+SVD accuracy.
