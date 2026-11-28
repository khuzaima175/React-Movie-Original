# CinemaVault — Model Refinement & Experiment Logbook

> **Living Research Log:** Every offline math experiment, LLM curation benchmark, architectural test, mistake caught, and verified gain is recorded here so we can iteratively refine CinemaVault's recommendation accuracy with zero guesswork and zero data leakage.

**Current Production Engine:** `v6.2` (**Exact Full-Rank Sparse EASE^R `14k×64` + Watchlist EASE^R Intent + SVD-64 `60/40` Hybrid** + **128-D Neural Semantic Cold-Start Embeddings `11.1k` with `Bucket E-Cold (Semantic)` & Web Worker `collabIdSet` Isolation** + **Multi-Persona Bucket B / Multi-Auteur Bucket C / Bucket D Alias Expansion** + **Explore Wave-3 Score Lock & Behavioral Signals** → **100-Candidate Stratified Shortlist** → **20 Curated Picks**)  
**Primary Benchmark Standard:** `300` completely unseen MovieLens 32M users (`.data/fresh_300_users.json`), chronological temporal holdout (last `10` ratings `>= 8/10`), evaluated against the `9,733`-film TMDB-enriched catalog with **all `625` evaluation users stripped from training** (`Dev-150` tuning split + untouched `Holdout-150` verification split + `1,000`-resample paired bootstrap `95%` CI).

---

## Executive Progress Tracker (300 Unseen MovieLens 32M Users)

| Version / Milestone | Date | Core Engine | `HR@1` (#1 Pick) | `NDCG@10` | `NDCG@20` | `HR@20` (≥1 Hit) | Avg Hits `@20` | Long-Tail Hits `@20` *(excl. top-200 pop)* | Shortlist Coverage (`HR@K` / Hits) |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **v5.6 Baseline** | 2026-11-20 | `SVD-64` (`CVEM v1`, 3.15 MB) + 12-feat Logistic Ranker · `39 → 10` | `12.3%` | `0.0789` | `0.1039` | `61.7%` | `1.247` | `0.887` | `HR@60: 86.0%` (`2.63`) |
| **v6.0 (Baked `γ=0.12`)** | 2026-11-23 | **Exact Full-Rank Sparse EASE^R (`14k×64`, `λ=800`, `γ=0.12` baked pre-pruning) + `SVD-64` (`60/40`)** · **`100 → 20`** | **`17.7%`** *(+44%)* | **`0.1181`** *(**+49.7%\***)* | **`0.1520`** *(**+46.3%\***)* | **`74.0%`** *(+12.3 pts)* | **`1.713`** *(+37.4%)* | **`0.973`** *(**+9.7%**)* | **`HR@100: 96.7%` (`4.16` hits)** |
| **v6.1 (Cold-Start Upgrade)** | 2026-11-24 | `v6.0` Warm Engine + **`11,119 × 128-D` Neural Semantic Embeddings (`all-MiniLM-L6-v2` PCA, `2.76 MB`, `coldOnly: true`)** for `2024–2026` & unindexed films | **Warm: `17.7%`** | **Warm: `0.1181`** · **Cold Holdout: `0.0589` (+26.7%\*)** | **Warm: `0.1520`** · **Cold Holdout: `0.0716` (+22.1%\*)** | **Warm: `74.0%`** · **Cold Holdout: `46.7%` (+6.7 pts)** | **Warm: `1.713`** · **Cold Holdout: `0.693`** | **Warm: `0.973`** *(zero warm dilution)* | **Warm `HR@100: 96.7%` (`4.16`)** · **Cold `HR@100: 81.3%` (+6.0 pts)** |
| **v6.2 (Current — Pipeline, Retrieval & Behavioral Activation)** | 2026-11-24 | `v6.1` Core Math (all 5 offline ML math re-tunings gated & rejected) + **`Bucket E-Cold (Semantic)` + Worker `collabIdSet` isolation** + **Multi-Persona Bucket B / Multi-Auteur Bucket C / Bucket D Aliases** + **Explore Wave-3 Score Lock** + **Watchlist EASE^R (`0.25×`, top-15) / Craft Breakdown / `1.15×` Rewatch-IMAX / Pacing Dismissal Filter** · `479/479` tests | **Warm: `17.7%`** *(exact `+0.0%` parity)* | **Warm: `0.1181`** · **Cold 11.1k `guard7`: `0.0569`** | **Warm: `0.1520`** · **Cold 11.1k `guard7`: `0.0692`** | **Warm: `74.0%`** · **Cold 11.1k `guard7`: `44.7%`** | **Warm: `1.713`** · **Cold 11.1k `guard7`: `0.700`** | **Warm: `0.973`** *(exact `0.000` ML-32M diff)* | **Warm `HR@100: 96.7%` (`4.16`)** · **Cold 11.1k `HR@100`: `80.0%`** |

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

## Detailed Experiment Chronicle — v6.1 Hard-Gated Refinement Sprint (2026-11-24)

Every hypothesis below was tuned strictly on `Dev-150` (`users[0..149]`) and gated against the **4-Part Hard Ship Gate** on untouched `Holdout-150` (`users[150..299]`): (1) paired bootstrap 95% CI `ciLower > 0` on `NDCG@10` or `NDCG@20` with zero significant regression on the other, (2) `Tail@20 >= -1.0%` & no popularity cheat, (3) `Cov >= 92%` of baseline, (4) `< 25 ms/user` and `>= +2.0%` Holdout `NDCG@20` per `+2 MB` binary cost. **Zero unverified or overfitted code was shipped.**

### Locked Clean `v6.0` Reference Baseline ([scripts/experiments/v6_gate_eval.mjs](./scripts/experiments/v6_gate_eval.mjs))
Retraining the exact leakage-clean `v6.0` production replica (`14,000 × 64`, `λ=800`, `γ=0.12` baked pre-pruning, 625 eval users stripped) locked an even stronger baseline than the earlier post-hoc `γ` estimate:
- **`DEV-150`:** `HR@1=20.0%` | `NDCG@10=0.1142` | `NDCG@20=0.1500` | `Hits@20=1.747` | `Tail@20=0.927` | `HR@20=76.7%` | `HR@100=97.3% (4.13)` | `Cov=899` | `AvgV=10,831` | `1.89 ms`
- **`HOLDOUT-150`:** `HR@1=15.3%` | `NDCG@10=0.1220` | `NDCG@20=0.1540` | `Hits@20=1.680` | `Tail@20=1.020` | `HR@20=71.3%` | `HR@100=96.0% (4.19)` | `Cov=910` | `AvgV=9,934` | `1.92 ms`
- **`ALL-300`:** `HR@1=17.7%` | `NDCG@10=0.1181` | `NDCG@20=0.1520` | `Hits@20=1.713` | `Tail@20=0.973` | `HR@20=74.0%` | `HR@100=96.7% (4.16)` | `Cov=1,134` | `AvgV=10,383` | `2.05 ms`

---

### Experiment 7 (SHIPPED IN v6.1 — MASSIVE COLD-START BREAKTHROUGH): 128-D Neural Semantic Content Embeddings + `coldOnly` Guard Fix
- **Scripts & Files:** [scripts/experiments/build_local_content_embeddings.py](./scripts/experiments/build_local_content_embeddings.py), [public/models/content_embeddings_f16.bin](./public/models/content_embeddings_f16.bin), [src/services/contentSimService.js](./src/services/contentSimService.js), [tests/contentSimService.test.js](./tests/contentSimService.test.js)
- **Hypothesis:** MovieLens 32M ends in late 2023, leaving `2024–2026` releases with `collabSim = 0` relying on lexical TF-IDF / structured keyword overlap. Encoding `title + tagline + overview` with local `sentence-transformers/all-MiniLM-L6-v2` (zero interaction leakage) and projecting via PCA into `128-D` L2-normalized `CVEM v1` (`float16`) should dramatically improve cold-start ranking.
- **100% Cold-Start Simulation Results (`collabSim = 0` on all candidates):**

| Split & Cold-Start Scorer | Binary Size | `NDCG@10` | `NDCG@20` | `Hits@20` | `HR@20` | `HR@100` | Gate Verdict |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`DEV-150` · Lexical TF-IDF Fallback** | `0 MB` | `0.0592` | `0.0722` | — | `42.7%` | `75.3%` | Baseline |
| **`DEV-150` · MiniLM-128D (`CVEM v1`)** | `2.39 MB` | **`0.0678` (+14.5%\*)** | **`0.0819` (+13.4%\*)** | — | **`50.0%`** | **`78.0%`** | **Dev Winner** |
| **`HOLDOUT-150` · Lexical TF-IDF Fallback** | `0 MB` | `0.0465` | `0.0586` | `0.613` | `40.0%` | `75.3%` | Baseline |
| **`HOLDOUT-150` · MiniLM-64D (`CVEM v1`)** | `1.21 MB` | `0.0567` (+22.0%\*) | `0.0682` (+16.2%) | — | — | — | Pass |
| **`HOLDOUT-150` · MiniLM-128D (`CVEM v1`)** | `2.39 MB` | **`0.0589` (+26.7%\*)** | **`0.0716` (+22.1%\*)** | **`0.693`** | **`46.7%`** | **`81.3%`** | **PASS (`+22.1%*` >> `+2.4%` req)** |

- **Critical Production Bug Caught via TDD:** Writing [tests/contentSimService.test.js](./tests/contentSimService.test.js) caught that `buildContentSimMap` previously enforced `options.coldOnly === true` ONLY on the structured TF-IDF fallback, NOT on the `contentIndex` branch — which would have injected semantic noise onto warm EASE^R+SVD films! Fixed in `src/services/contentSimService.js` so `coldOnly: true` strictly skips warm films (`hasCollaborativeCoverage`), guaranteeing `0.000` warm-item dilution.
- **Production Binary Built:** Fetched `1,499` `2024–2026` TMDB theatrical films (`vote_count >= 40`) merged with `9,620` historical films → `public/models/content_embeddings_f16.bin` (`11,119 × 128-D`, `79.6%` PCA variance retained, `2.76 MB`).

---

### Experiment 8 (CLEAN REJECT — `GATE: FAIL`): Multi-Scale EASE^R (`λ=250/1500`), Negative Edges (`store_neg`), & `K=96`
- **Sweep:** 9 leakage-clean `.cvea` binaries tested on `Dev-150` and gated on untouched `Holdout-150` (multi-scale `α ∈ {0.35, 0.50, 0.65}`, signed negative edges `store_neg ∈ {6, 8, 12}`, and `K=96` `5.18 MB`).
- **Holdout-150 Results (all FAIL):**
  - `ms_a50_k64_n6` (`store_neg=6`): `NDCG@10 = 0.1159` (**`-5.0%*`**), `NDCG@20 = 0.1505` (`-2.3%`) — **FAIL**
  - `ms_a50_k64_n12` (`store_neg=12`): `NDCG@10 = 0.1144` (**`-6.2%*`**), `NDCG@20 = 0.1476` (**`-4.2%*`**) — **FAIL**
  - `ms_a50_k64_n0` (multi-scale, no neg): `NDCG@10 = 0.1214` (`-0.5%`), `NDCG@20 = 0.1520` (`-1.3%`) — **FAIL**
  - `K=96` (`ms_a50_k96_n0`, `s800_k96_n0`): `-0.8%` to `-1.2%` even on `Dev-150` — **FAIL**
- **Key Lesson:** Negative EASE^R off-diagonal weights act as inverse popularity suppressors that aggressively penalize valid future favorites; single-scale `λ=800`, `K=64`, `store_neg=0` is already at the sweet spot with zero extra binary bloat.

---

### Experiment 9 (CLEAN REJECT — `GATE: FAIL`): Adaptive Vault-Size `easeWeight`, Rating Power Curve & Recency Weighting
- **Sweep:** Constant `easeWeight ∈ {0.55, 0.65, 0.70}`, 3 adaptive vault-size curves (`adapt_35_70_p25`, `adapt_40_72_p30`, `adapt_45_75_p40`), `sharp_rating`, `recency`, and `mild_neg5`.
- **Results:** All 3 adaptive curves lost `-0.9%` to `-1.3%` `NDCG@20` on `Dev-150`. Top 2 Dev candidates failed untouched `Holdout-150`: `mild_neg5` (`+0.32%` non-sig), `sharp_rating` (`-1.49%` non-sig). Constant `easeWeight = 0.60` stayed untouched in `src/services/easeService.js`.

---

### Experiment 10 (CLEAN REJECT — `GATE: FAIL`): Logistic Ranker Weight Re-Calibration on EASE^R+SVD ([scripts/experiments/tune_ranker_v6.mjs](./scripts/experiments/tune_ranker_v6.mjs))
- **Hypothesis:** `DEFAULT_RANKER_WEIGHTS` (`collabSim: 6.4`, `bayesianRatingNorm: 1.8`, `metadataDampingFactor: 0.35`) were tuned on old `SVD-64`; coordinate ascent on `Dev-150` over 9 weights might squeeze extra gain out of EASE^R+SVD.
- **Classic Overfit Caught by Hard Gate:**
  - `DEV-150`: climbed `NDCG@10` `0.1142 → 0.1197` (`+4.8%*`), `NDCG@20` `0.1500 → 0.1538` (`+2.5%`), `Tail@20` `0.927 → 0.973` (`+5.0%`) at `collabSim=8.8, bayesianRatingNorm=1.2, genreOverlap=0.2, _metadataDampingFactor=0.4`.
  - **Untouched `HOLDOUT-150`:** `NDCG@10` `0.1220 → 0.1242` (`+1.8%`, `sig=false`), **`NDCG@20` `0.1540 → 0.1540` (`+0.0%` flat!)**, `Hits@20` `1.680 → 1.673` (`-0.4%`) → **`GATE: FAIL`**.
- **Disposition:** Kept `DEFAULT_RANKER_WEIGHTS` and `public/models/ranker_weights.json` untouched.

---

### Experiment 11 (CLEAN REJECT — `GATE: FAIL`): Math-Anchored Gemini Curation Prompt Tags vs. Post-Hoc Top-K Protection ([scripts/experiments/eval_math_anchor_llm.mjs](./scripts/experiments/eval_math_anchor_llm.mjs))
- **Cohort:** `17` unseen `Holdout-150` users (`9` on `gemini-2.5-flash` + `8` on `gemini-3-flash-preview`, saved in `.data/v6_lab/math_anchor_llm_ckpt.json`).
- **Results (17-User Paired Holdout):**

| Strategy | `NDCG@10` | `NDCG@20` | `Hits@20` | `Tail@20` | `HR@20` | Verdict |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Pure Math Top-20 (`0` AI)** | `0.0595` | `0.0777` | `1.059` | `0.706` | `52.9%` | Math Reference |
| **Control A (Current Unbiased Open-100)** | `0.0449` | `0.0683` | `0.824` | `0.706` | `47.1%` | Production Baseline |
| **Treatment B (Prompt `[Strong Vault Signal]` tags)** | `0.0395` | `0.0561` | `0.765` | — | — | **HURT (`-17.9%`)** |
| **Treatment C (Prompt tags + Protect Top-4)** | `0.0493` | `0.0704` | — | `0.647` | — | **FAIL (`-8.4%` Tail, non-sig)** |
| **Post-Hoc Control A + ProtectTop-2 (no prompt tags)** | `0.0545` (+21.4%) | `0.0778` (+13.9%) | `0.882` | `0.706` (0 loss) | `52.9%` | **Promising, non-sig at `n=17` `[-0.0155, +0.0450]`** |

- **Key Lesson:** Adding confidence tags inside the LLM prompt **actively hurts** curation (`0.0683 → 0.0561`). Post-hoc `ProtectTop-2` (keeping the unbiased prompt intact and softly protecting only top-2 math picks) matched Pure Math's `NDCG@20` (`0.0778`) with zero `Tail@20` loss, but needs a larger `n >= 50` run to establish statistical significance before shipping.

---

### Experiment 12 (CLEAN REJECT — `GATE: FAIL`): Wiring Sparse EASE^R into Universal Taste Match (`predictMovieMatch`)
- **Hypothesis:** Blending `item_ease_k64.cvea` into `tasteMatchService.js` (`MovieDetails` & `SearchModal`) might improve single-film Match `%` predictions.
- **Direct 300-User `predictMovieMatch` Benchmark (`Holdout-150`):**
  - **Dense `SVD-64` Baseline:** `withinAUC = 0.6818` | `vsCatalogAUC = 0.8621` | `vsPoolAUC = 0.6953`
  - **Naive `60/40` `EASE^R + SVD`:** `withinAUC = 0.6738` (`-0.0079`) | `vsPoolAUC = 0.6701` (**`-0.0252*` REGRESSION**)
  - **Additive `EASE^R` (`α ∈ {0.25, 0.50, 1.00}`):** `withinAUC` flat/negative (`+0.0010` non-sig to `-0.0043`) | `vsCatalogAUC` **significantly regressed across every `α`** (`-0.0028*` to `-0.0154*`).
- **Architectural Insight:** Top-K retrieval (`Oracle` & `Explore For You`) thrives on sparse top-64 EASE^R precision at the very top of the catalog (`+49.7%*` `NDCG@10`), whereas arbitrary point-lookup scoring (`MovieDetails` & `SearchModal`) thrives on dense `64-D SVD` (`0.8621` `vsCatalogAUC`) because dense vectors score all `25,000` catalog films smoothly without sparse zero-compression. Kept `tasteMatchService.js` purely on dense `SVD-64`.

---

## Detailed Experiment Chronicle — v6.2 Accuracy Math, Retrieval & Behavioral Refinement Sprint (2026-11-24)

Every offline ML hypothesis in `v6.2` followed the strict **4-Part Hard Ship Gate** (`scripts/experiments/v6_gate_eval.mjs`): tune strictly on `Dev-150` (`users[0..149]`), verify once on untouched `Holdout-150` (`users[150..299]`, `1,000`-resample paired bootstrap `95%` CI, `seed = 42`), require `ciLower > 0` on `NDCG@10` or `NDCG@20` with zero significant regression on the other, `Tail@20 >= -1.0%`, `Cov >= 92%` of baseline, and `< 25 ms/user` (`>= +1.0%` `Holdout-150` `NDCG@20` per `+1 MB` binary bloat). **Any hypothesis failing the gate (`GATE: FAIL`) kept production ML files completely untouched.** Meanwhile, verified retrieval, runtime isolation, score-lock, and Vault behavioral signal upgrades were implemented via strict **RED → GREEN TDD**.

### Locked Clean `v6.2` Reference Baseline (`.data/v6_lab/v6_baseline.json` & `.data/v6_lab/v6_2_best.json`)
- **`DEV-150`:** `HR@1=20%` | `NDCG@10=0.1142` | `NDCG@20=0.1500` | `Hits@20=1.747` | `Tail@20=0.927` | `HR@20=76.7%` | `HR@100=97.3% (4.13)` | `Cov=899` | `AvgV=10,831` | `AUC8=0.6524` | `1.89 ms`
- **`HOLDOUT-150`:** `HR@1=15.3%` | `NDCG@10=0.1220` | `NDCG@20=0.1540` | `Hits@20=1.680` | `Tail@20=1.020` | `HR@20=71.3%` | `HR@100=96% (4.19)` | `Cov=910` | `AvgV=9,934` | `AUC8=0.6888` | `1.92 ms`
- **`ALL-300`:** `HR@1=17.7%` | `NDCG@10=0.1181` | `NDCG@20=0.1520` | `Hits@20=1.713` | `Tail@20=0.973` | `HR@20=74%` | `HR@100=96.7% (4.16)` | `Cov=1,134` | `AvgV=10,383` | `AUC8=0.6707` | `2.05 ms`

---

### Experiment 13 (Task 1 — CLEAN REJECT, `GATE: FAIL`, `c397850`): Client Bidirectional Reverse-Edge EASE^R & Z-Scored Implicit Weighting
- **Script:** [scripts/experiments/sweep_v6_2_ease_client.mjs](./scripts/experiments/sweep_v6_2_ease_client.mjs) (Production `src/services/easeService.js` left untouched)
- **Hypothesis:** Recovering reverse-edge transpose contributions (`B^T` scaled by `rev` with optional `1 / sqrt(inDegree[c] + 10)` damping) and replacing discrete rating weights (`0.7 + 0.6*(r-6)/4`) with calibrated sigmoid z-score × time-decay weights (`x_i = b + a * sigmoid(z_i) * (0.7 + 0.3 * timeDecay)`) in `buildEaseSimMapFromIndex` might boost recall for obscure items lacking outgoing top-64 edges.
- **`DEV-150` Sweep & Untouched `HOLDOUT-150` Hard Ship Gate:**

| Split & Candidate | `HR@1` | `NDCG@10` | `NDCG@20` | `Hits@20` | `Tail@20` | `HR@20` | `HR@100` (`Hits`) | `Cov` | `AvgV` | `AUC8` | `ms/user` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`DEV-150` · `baseline_repro`** | 20% | `0.1142 (+0.0%)` | `0.1500 (+0.0%)` | `1.747` | `0.927 (+0.0%)` | 76.7% | — | 899 | 10,831 | `0.6524` | `2.04ms` |
| **`DEV-150` · `rev=0.30_unscaled`** | 21.3% | `0.1125 (-1.5%)` | `0.1510 (+0.7%)` | `1.793` | `0.993 (+7.1%*)` | 78% | — | 942 | 10,429 | `0.6521` | `5.33ms` |
| **`DEV-150` · `rev=0.45_unscaled`** *(Phase 1 winner)* | **22%** | `0.1117 (-2.2%)` | **`0.1526 (+1.7%)`** | **`1.820`** | **`1.027 (+10.8%*)`** | **78.7%** | — | **955** | 10,324 | `0.6517` | `5.61ms` |
| **`DEV-150` · `rev=0.45_degDamp`** | 20% | `0.1145 (+0.3%)` | `0.1497 (-0.2%)` | `1.753` | `0.933 (+0.6%)` | 77.3% | — | 910 | 10,762 | `0.6533` | `5.83ms` |
| **`DEV-150` · `z_0.65_0.55`** *(Phase 2 winner)* | 21.3% | **`0.1160 (+1.6%)`** | `0.1498 (-0.1%)` | `1.753` | `0.940 (+1.4%)` | 75.3% | — | 902 | 10,759 | `0.6517` | `2.02ms` |
| **`DEV-150` · `rev=0.45_unscaled+z_0.65_0.55`** *(Combined)* | **22%** | `0.1148 (+0.5%)` | `0.1515 (+1.0%)` | `1.800` | `1.000 (+7.9%*)` | 77.3% | `96.7% (4.05)` | 953 | 10,352 | `0.6499` | `5.42ms` |
| **`HOLDOUT-150` · `rev=0.45_unscaled+z_0.65_0.55`** *(Gate)* | 13.3% | **`0.1161 (-4.8%*)`** | **`0.1487 (-3.4%*)`** | `1.680` | `1.000 (-2.0%)` | 71.3% | `95.3% (4.24)` | 947 | 9,567 | `0.6831` | `5.42ms` |
| **`ALL-300` · `rev=0.45_unscaled+z_0.65_0.55`** | 17.7% | `0.1154 (-2.3%)` | `0.1501 (-1.2%)` | `1.740` | `1.000 (+2.8%)` | 74.3% | `96% (4.14)` | 1,205 | 9,959 | `0.6666` | `5.46ms` |

- **Gate Rules (`HOLDOUT-150`):** `rule1_primarySig: FAIL` (`d10Pct = -4.84%`, `d20Pct = -3.44%`, both significantly negative `*`), `rule2_noPopCheat: FAIL` (`dTailPct = -1.96% < -1.0%`, `dAvgVPct = -3.69%`), `rule3_coverage: PASS` (`covRatio = 1.041`), `rule4_perfAndSize: FAIL` (`msPerUser = 5.42ms`, `d20Pct = -3.44% < 0%`).
- **Diagnosis:** Unscaled reverse-edge summation inflates `maxE` across niche items whose outgoing top-64 lists point to mainstream blockbusters, compressing normalized forward EASE^R scores (`ev / maxE`). Kept `src/services/easeService.js` untouched on `Dev-150`–`Holdout-150` baseline math.

---

### Experiment 14 (Task 2 — CLEAN REJECT, `GATE: FAIL`, `5dbd3cb`): Temporally-Directed & Session-Kernel EASE^R Offline Trainer
- **Script:** [scripts/experiments/train_sparse_ease.py](./scripts/experiments/train_sparse_ease.py) (added worktree `ROOT` path fix + `--session-tau-days`, `--session-weight`, `--forward-eta` CLI flags; `public/models/item_ease_k64.cvea` untouched at `3.47 MB`)
- **Hypothesis:** Blending a chronological session-kernel Gram matrix `G_sess` (`tau ∈ {90, 180}` days, `s_w = 0.5`) and/or a causal forward-transition matrix `B_fwd` (`eta ∈ {0.05, 0.10, 0.15}`) over `246,314` adjacent MovieLens pairs before Cholesky inversion (`--max-items 14000 --k 64 --lam 800 --pop-gamma 0.12`, 625 eval users excluded) might capture sequential watch-order intent.
- **`DEV-150` Sweep (All 8 Clean Models) & Untouched `HOLDOUT-150` Hard Ship Gate (Top 2 Only):**

| Split & Candidate | `HR@1` | `NDCG@10` | `NDCG@20` | `Hits@20` | `Tail@20` | `HR@20` | `HR@100` (`Hits`) | `Cov` | `AvgV` | `AUC8` | `ms/user` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`DEV-150` · `tau90_eta0`** | 20% | `0.1158 (+1.4%)` | `0.1492 (-0.5%)` | `1.747` | `0.933 (+0.6%)` | 76% | — | 899 | 10,836 | `0.6498` | `1.94ms` |
| **`DEV-150` · `tau180_eta0`** | 19.3% | `0.1149 (+0.6%)` | `0.1491 (-0.6%)` | `1.760` | `0.940 (+1.4%)` | 76% | — | 902 | 10,844 | `0.6486` | `1.94ms` |
| **`DEV-150` · `tau0_eta005`** | 20% | `0.1143 (+0.1%)` | `0.1501 (+0.1%)` | `1.747` | `0.927 (+0.0%)` | 76.7% | — | 896 | 10,841 | `0.6519` | `1.83ms` |
| **`DEV-150` · `tau0_eta015`** | 20% | `0.1148 (+0.5%)` | `0.1499 (-0.1%)` | `1.760` | `0.947 (+2.2%)` | 75.3% | — | 891 | 10,849 | `0.6515` | `1.88ms` |
| **`DEV-150` · `tau90_eta005`** | 20% | `0.1158 (+1.4%)` | `0.1491 (-0.6%)` | `1.740` | `0.933 (+0.6%)` | 76% | — | 898 | 10,848 | `0.6493` | `1.94ms` |
| **`DEV-150` · `tau90_eta010`** | 20.7% | `0.1164 (+1.9%)` | `0.1496 (-0.3%)` | `1.740` | `0.933 (+0.6%)` | 76% | — | 896 | 10,887 | `0.6491` | `1.97ms` |
| **`DEV-150` · `tau90_eta015`** *(Top #1)* | 20.7% | **`0.1164 (+1.9%)`** | `0.1502 (+0.1%)` | `1.747` | `0.940 (+1.4%)` | 76% | `97.3% (4.14)` | 892 | 10,899 | `0.6493` | `1.94ms` |
| **`HOLDOUT-150` · `tau90_eta015`** *(Gate)* | 14.7% | `0.1218 (-0.2%)` | `0.1517 (-1.5%)` | `1.660` | `0.993 (-2.6%)` | 70% | `96% (4.21)` | 897 | 10,036 | `0.6863` | `1.9ms` |
| **`ALL-300` · `tau90_eta015`** | 17.7% | `0.1191 (+0.8%)` | `0.1510 (-0.7%)` | `1.703` | `0.967 (-0.6%)` | 73% | `96.7% (4.17)` | 1,123 | 10,468 | `0.6679` | `1.85ms` |
| **`DEV-150` · `tau0_eta010`** *(Top #2)* | 20% | `0.1143 (+0.1%)` | **`0.1507 (+0.5%)`** | `1.753` | `0.940 (+1.4%)` | 75.3% | `97.3% (4.12)` | 895 | 10,832 | `0.6513` | `1.88ms` |
| **`HOLDOUT-150` · `tau0_eta010`** *(Gate)* | 14% | `0.1211 (-0.7%)` | `0.1524 (-1.0%)` | `1.680` | `1.020 (+0.0%)` | 71.3% | `96% (4.22)` | 906 | 9,942 | `0.6885` | `1.8ms` |
| **`ALL-300` · `tau0_eta010`** | 17% | `0.1177 (-0.3%)` | `0.1515 (-0.3%)` | `1.717` | `0.980 (+0.7%)` | 73.3% | `96.7% (4.17)` | 1,128 | 10,387 | `0.67` | `1.85ms` |

- **Gate Rules (`HOLDOUT-150`):** Both failed `rule1_primarySig` (`tau90_eta015`: `d10Pct = -0.16`, `d20Pct = -1.49`, `rule2` `dTailPct = -2.65` FAIL; `tau0_eta010`: `d10Pct = -0.74`, `d20Pct = -1.04`, `rule2` PASS `dTailPct = 0`, `rule3` PASS `covRatio = 0.996`).
- **Diagnosis:** In MovieLens 32M, ~60% of users submit ratings within `< 1 day` (`median span = 0.049 days`), reflecting retrospective logging order rather than true watch order. Down-weighting cross-session co-occurrences discarded genuine long-horizon taste signal.

---

### Experiment 15 (Task 3 — CLEAN REJECT, `GATE: FAIL`, `8431b56`): Support-Gated Bidirectional EASE^R Residual in Universal Taste Match
- **Script:** [scripts/experiments/eval_taste_match_v6_2.mjs](./scripts/experiments/eval_taste_match_v6_2.mjs) (`tasteMatchService.js`, `MovieDetails.jsx`, and `SearchModal.jsx` kept untouched on pure dense `SVD-64`)
- **Hypothesis:** Adding a support-gated, non-negative bidirectional EASE^R residual `alpha * max(0, bidirEaseNorm - normCollab)` (only when `supportCount > 0`, `reverseAlpha = 0.30`) to `predictMovieMatch` logits might solve Experiment 12's catalog compression while improving single-film Match `%` accuracy.
- **Results (`1,000`-resample paired bootstrap `seed = 42`, `.data/v6_lab/ease_v6_baseline_clean.cvea` + `item_embeddings_clean2_f16.bin`):**

| Split & Variant | `withinAUC` | `Δ withinAUC` (`95%` CI) | `vsCatalogAUC` | `Δ vsCatalogAUC` (`95%` CI) | `vsPoolAUC` | `Δ vsPoolAUC` (`95%` CI) | Runtime |
| :--- | :---: | :--- | :---: | :--- | :---: | :--- | :---: |
| **`DEV-150` · `control_svd64`** | `0.6551` | — | `0.8626` | — | `0.7022` | — | `9,494ms` |
| **`DEV-150` · `alpha=0.4_rev=0.30`** | `0.6568` | `+0.0017 [-0.0001, 0.0033]` | `0.8639` | `+0.0012 [0.0008, 0.0018]*+` | `0.7032` | `+0.0010 [-0.0000, 0.0021]` | `7,760ms` |
| **`DEV-150` · `alpha=0.7_rev=0.30`** | `0.6584` | `+0.0033 [0.0011, 0.0052]*+` | `0.8646` | `+0.0020 [0.0014, 0.0028]*+` | `0.7039` | `+0.0017 [0.0000, 0.0035]*+` | `7,629ms` |
| **`DEV-150` · `alpha=1.0_rev=0.30`** | `0.6603` | `+0.0053 [0.0022, 0.0083]*+` | `0.8655` | `+0.0029 [0.0020, 0.0039]*+` | `0.7045` | `+0.0023 [0.0002, 0.0046]*+` | `7,829ms` |
| **`DEV-150` · `alpha=1.4_rev=0.30`** *(Winner)* | **`0.6609`** | **`+0.0059 [0.0020, 0.0095]*+`** | **`0.8661`** | **`+0.0035 [0.0024, 0.0049]*+`** | **`0.7044`** | `+0.0023 [-0.0004, 0.0052]` | `8,034ms` |
| **`HOLDOUT-150` · `control_svd64`** | `0.6816` | — | `0.8615` | — | `0.7464` | — | `9,673ms` |
| **`HOLDOUT-150` · `alpha=1.4_rev=0.30`** *(Gate)* | `0.6823` | **`+0.0007 [-0.0035, 0.0044]`** (`FAIL`) | `0.8664` | **`+0.0049 [0.0035, 0.0063]*+`** (`PASS`) | `0.7471` | **`+0.0006 [-0.0013, 0.0027]`** (`FAIL`) | `8,302ms` |

- **Diagnosis:** Support-gating completely fixed Experiment 12's catalog compression (`vsCatalogAUC +0.0049*+` on untouched `Holdout-150`), but the `Dev-150` rating-discrimination lift (`+0.0059*+` `withinAUC`) vanished on `Holdout-150` (`+0.0007 [-0.0035, +0.0044]`). Kept `tasteMatchService.js` purely on dense `SVD-64`, avoiding `item_ease_k64.cvea` load overhead in `MovieDetails` and `SearchModal`.

---

### Experiment 16 (Task 4 — SPLIT VERDICT): Cold-Start Math Ablations (`GATE: FAIL`, `482b2cf`) + `"Bucket E-Cold (Semantic)"` & Web Worker `collabIdSet` Isolation (**SHIPPED**, `fa5d4aa`, `01f0153`)

#### Part 4A — Gated Cold-Start Math Ablations & 5-Fold OOF 64-D Ridge Projector (`GATE: FAIL`)
- **Scripts:** [scripts/experiments/train_cold_projector.py](./scripts/experiments/train_cold_projector.py), [scripts/experiments/eval_cold_v6_2.mjs](./scripts/experiments/eval_cold_v6_2.mjs) (`public/models/cold_collab_64_f16.bin` **not** shipped; `contentSimService.js` retains `v6.1` single-mean cosine math)
- **Anisotropy & OOF Diagnostics:**
  - MiniLM-128D (`public/models/content_embeddings_f16.bin`, `11,119 × 128`, `2.76 MB`) catalog mean norms: `norm m_all = 0.0111`, `norm m_hist = 0.0764` (`9,620` historical items), `norm m_cold = 0.4268` (`1,499` `2024–2026` releases), `cos(m_hist, m_cold) = -0.9934` (pairwise dot mean `-0.0444`).
  - Kernel-centered Dual Ridge (`MiniLM-384` + `TfidfVectorizer`, strict 5-fold out-of-fold CV across `9,122` warm + `498` cold items): selected `alpha = 3.0` on all 5 folds, 5-fold OOF SVD cosine alignment `0.6852 ± 0.0048`.
- **100%-Cold Benchmark (`collabSim = 0`, 1,000-resample paired bootstrap `95%` CI vs `prod11k:v6.1_single_mean`):**

| Split & Configuration | Extra MB | `NDCG@10` | `Δ NDCG@10` [`95%` CI] | `NDCG@20` | `Δ NDCG@20` [`95%` CI] | `Hits@20` | `HR@20` | `HR@100` | `Cov` | `ms/user` / Verdict |
| :--- | :---: | :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **`DEV-150` · `lexical_tfidf_0MB`** | `0.00` | `0.0592` | — | `0.0722` | — | `0.740` | 42.7% | 75.3% | 1,140 | `103.01ms` |
| **`DEV-150` · `prod11k:v6.1_single_mean`** *(base)* | `0.00` | `0.0688` | — | `0.0855` | — | `0.880` | 50.7% | 76.0% | 1,048 | `3.12ms` |
| **`DEV-150` · `prod11k:guard7_only`** | `0.00` | `0.0688` | `+0.0% [+0.0000,+0.0000]` | `0.0855` | `+0.0% [-0.0000,+0.0000]` | `0.880` | 50.7% | 76.0% | 1,048 | `2.74ms` (bugfix shipped) |
| **`DEV-150` · `prod11k:guard7+center`** | `0.00` | `0.0684` | `-0.6% [-0.0025,+0.0017]` | `0.0847` | `-0.9% [-0.0020,+0.0000]` | `0.873` | 50.0% | 76.0% | 1,059 | `2.81ms` |
| **`DEV-150` · `prod11k:guard7+catmax`** | `0.00` | `0.0656` | `-4.7% [-0.0107,+0.0038]` | `0.0824` | `-3.6% [-0.0101,+0.0040]` | `0.887` | 52.0% | 73.3% | 1,017 | `4.95ms` |
| **`DEV-150` · `prod11k:guard7+multiP(s0.20)`** | `0.00` | `0.0625` | `-9.2% [-0.0126,-0.0005]*-` | `0.0816` | `-4.6% [-0.0097,+0.0018]` | `0.900` | 50.0% | 76.0% | 1,090 | `56.78ms` |
| **`DEV-150` · `prod11k:guard7+center+multiP(s0.20,pB1.0)`** | `0.00` | `0.0595` | `-13.5% [-0.0167,-0.0032]*-` | `0.0774` | `-9.5% [-0.0139,-0.0026]*-` | `0.873` | 49.3% | 76.7% | 1,093 | `9.84ms` |
| **`DEV-150` · `ref9.6k:v6.1_single_mean`** | `0.00` | `0.0678` | `-1.5% [-0.0036,+0.0013]` | `0.0819` | `-4.2% [-0.0072,-0.0005]*-` | `0.853` | 50.0% | 78.0% | 1,053 | `2.44ms` |
| **`DEV-150` · `proj64_oof:single_mean`** | `1.21` | `0.0583` | `-15.3% [-0.0193,-0.0019]*-` | `0.0711` | `-16.8% [-0.0236,-0.0059]*-` | `0.733` | 44.7% | 79.3% | 1,196 | `1.58ms` |
| **`DEV-150` · `proj64_oof:cross_svd_to_oof_catmax`** | `1.21` | `0.0646` | `-6.1% [-0.0130,+0.0039]` | `0.0765` | `-10.5% [-0.0174,-0.0009]*-` | `0.820` | 46.7% | 78.0% | 1,304 | `6.98ms` |
| **`DEV-150` · `hybrid:prod11k_50+cross_oof_50`** | `1.21` | `0.0697` | `+1.3% [-0.0047,+0.0062]` | `0.0849` | `-0.7% [-0.0063,+0.0050]` | `0.880` | 50.7% | 76.7% | 1,146 | `12.86ms` |
| **`HOLDOUT-150` · `lexical_tfidf_0MB`** | `0.00` | `0.0465` | `-18.3% [-0.0187,-0.0025]*-` | `0.0586` | `-15.3% [-0.0193,-0.0020]*-` | `0.613` | 40.0% | 75.3% | 1,053 | Baseline ref |
| **`HOLDOUT-150` · `prod11k:v6.1_single_mean`** *(base)* | `0.00` | `0.0569` | — | `0.0692` | — | `0.700` | 44.7% | 80.0% | 1,035 | Baseline |
| **`HOLDOUT-150` · `ref9.6k:v6.1_single_mean`** *(ref)* | `0.00` | `0.0589` | — | `0.0716` | — | `0.693` | 46.7% | 81.3% | 1,061 | Ref (`AvgV=7,948`) |
| **`HOLDOUT-150` · `prod11k:guard7_only`** | `0.00` | `0.0569` | `+0.0% [+0.0000,+0.0000]` | `0.0692` | `+0.0% [-0.0000,+0.0000]` | `0.700` | 44.7% | 80.0% | 1,035 | Bugfix always shipped |
| **`HOLDOUT-150` · `prod11k:guard7+center`** | `0.00` | `0.0567` | `-0.4% [-0.0008,+0.0001]` | `0.0700` | `+1.2% [-0.0000,+0.0021]` | `0.713` | 45.3% | 79.3% | 1,045 | **FAIL** (`sig=false`) |
| **`HOLDOUT-150` · `hybrid:prod11k_50+cross_oof_50`** | `1.21` | `0.0591` | `+3.9% [-0.0032,+0.0089]` | `0.0728` | `+5.2% [-0.0024,+0.0103]` | `0.753` | 47.3% | 84.0% | 1,138 | **FAIL** (`ciLo=-0.0032/-0.0024`) |
| **`HOLDOUT-150` · `proj64_oof:cross_svd_to_oof_catmax`** | `1.21` | `0.0551` | `-3.2% [-0.0115,+0.0082]` | `0.0721` | `+4.2% [-0.0071,+0.0131]` | `0.813` | 50.7% | 78.7% | 1,243 | **FAIL** (`ciLo=-0.0115/-0.0071`) |

#### Part 4B — Always-Shipped Fixes, `"Bucket E-Cold (Semantic)"` Retrieval & Web Worker `collabIdSet` Isolation (**SHIPPED**)
- **Positive Rating Guard & Dead-Code Cleanup ([src/services/contentSimService.js](./src/services/contentSimService.js)):** Enforced `minPositiveRating = options.minPositiveRating ?? 7` across `buildUserContentVector`, overview TF-IDF, and `buildUserStructuredVector` (preventing harsh-rater `<= 5★` films with positive z-scores from entering the semantic centroid), short-circuited `computeCorpusTermDf` via `needsFallback`, and removed dead `64 === 128` `blendAligned` code.
- **`retrieveColdContentNeighbors` & Web Worker `collabIdSet` Isolation ([contentSimService.js](./src/services/contentSimService.js), [embeddingWorker.js](./src/workers/embeddingWorker.js), [embeddingWorkerClient.js](./src/services/embeddingWorkerClient.js)):** Retrieves top-K unindexed cold semantic picks (`contentSim - repulsionWeight * repulsion`), strictly excluding `collabIndex?.idToIndex`, `collabIdSet` (compact `Uint32Array` `collabIds` structured-cloned from `embeddingWorker.js` so Web Worker mode never leaks warm indexed films with empty/near-zero `collabSimMap` entries), `collabSimMap`, and `excludeIds`.
- **Oracle & Explore For You Wiring ([tmdbService.js](./src/services/tmdbService.js), [geminiService.js](./src/services/geminiService.js), [exploreForYouService.js](./src/services/exploreForYouService.js)):** Extended `fetchEmbeddingCandidates` with `options.sourceBucket` and `avoidRules` filtering (`candidateMatchesAvoidRule`), and wired `"Bucket E-Cold (Semantic)"` (`topK: 15`, `maxNeighbors: explicitMoodActive ? 6 : 12`, `maxScan: 15`) into both Oracle and Explore For You Wave 2 (`464 / 464` tests after Fix Round 1).

---

### Experiment 17 (Task 5 — CLEAN REJECT, `GATE: FAIL`, `fdcf8ae`): Non-Linear Ranker Calibration (`popMatch`, `collabShrink`, `crewBoost`)
- **Script:** [scripts/experiments/eval_nonlinear_ranker_v6_2.mjs](./scripts/experiments/eval_nonlinear_ranker_v6_2.mjs) (`src/services/rankerService.js` and `public/models/ranker_weights.json` kept untouched)
- **Hypothesis:** Non-linear ranker terms (`popMatch` Gaussian `log10(votes)` match, `collabShrink` `nIndexed / (nIndexed + k0)` damping, and `crewBoost` `(1 + gamma)` when `smoothT = 0`) might improve `Small-Vault (3..10)` and `100%-Cold` slices with `0.000` warm regression.
- **Selected Summary Across Full, Small-Vault (`3..10`), and 100%-Cold (`150` users/split, vs `.data/v6_lab/v6_2_best.json` exact `+0.0%` baseline):**

| Slice & Candidate | `HR@1` | `NDCG@10` | `Δ NDCG@10` (`95%` CI) | `NDCG@20` | `Δ NDCG@20` (`95%` CI) | `Tail@20` | `HR@20` | `Cov` | `AvgV` | Verdict |
| :--- | :---: | :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **`DEV-150` · `baseline`** | 20% | `0.1142` | — | `0.1500` | — | `0.927` | 76.7% | 899 | 10,831 | Baseline |
| **`DEV-150` · `popMatch(w=0.3..1.4)`** | 17.3–20% | `0.1050–0.1118` | `-2.10%` to `-8.06%*-` | `0.1369–0.1487` | `-0.87%` to `-8.73%*-` | `0.907–0.967` | 74–76% | 895–904 | 9,726–10,562 | Regressed |
| **`DEV-150` · `collabShrink(k0=3..8)`** | 20% | `0.1136–0.1141` | `-0.09%` to `-0.53%*-` | `0.1491–0.1497` | `-0.20%` to `-0.60%` | `0.927` | 75.3–76% | 903–906 | 10,807–10,835 | Regressed |
| **`HOLDOUT-150` · `baseline`** | 15.3% | `0.1220` | — | `0.1540` | — | `1.020` | 71.3% | 910 | 9,934 | Baseline |
| **`HOLDOUT-150` · `popMatch(w=0.6)`** | 14% | `0.1202` | `-1.48%` | `0.1523` | `-1.10%` | `1.053` | 71.3% | 903 | 9,501 | **FAIL** |
| **`HOLDOUT-150` · `collabShrink(k0=8)`** | 15.3% | `0.1232` | `+0.98%` (non-sig) | `0.1529` | `-0.71%` | `0.993` | 71.3% | 904 | 9,933 | **FAIL** |
| **`HOLDOUT-150` · `crewBoost(g=1.25,crew)`** | 15.3% | `0.1220` | `+0.00%` | `0.1536` | `-0.26%` | `1.013` | 71.3% | 913 | 9,914 | **FAIL** |
| **`SMALL-DEV` · `baseline` (`3..10`)** | 8% | `0.0405` | — | `0.0514` | — | `0.373` | 42.7% | 1,406 | 7,477 | Baseline |
| **`SMALL-DEV` · `collabShrink(k0=8)`** | 7.3% | `0.0339` | `-16.30%*-` | `0.0433` | `-15.76%*-` | `0.280` | 36% | 1,587 | 6,331 | Collapsed |
| **`SMALL-VAL` · `baseline` (`3..10`)** | 9.3% | `0.0536` | — | `0.0670` | — | `0.513` | 48% | 1,401 | 7,049 | Baseline |
| **`SMALL-VAL` · `popMatch(w=1.4)`** | 9.3% | `0.0549` | `+2.43% [-0.0016, 0.0043]` | `0.0715` | `+6.72%*+ [0.0002, 0.0089]` | `0.540` | 50% | 1,367 | 7,208 | **FAIL** (warm regressed) |
| **`SMALL-VAL` · `collabShrink(k0=8)`** | 8% | `0.0457` | `-14.74% [-0.0182, 0.0005]` | `0.0541` | `-19.25%*- [-0.0236, -0.0049]` | `0.380` | 39.3% | 1,625 | 5,861 | **FAIL** |
| **`COLD-DEV` · `baseline`** | 10.7% | `0.0688` | — | `0.0855` | — | `0.293` | 50.7% | 1,048 | 9,579 | Baseline |
| **`COLD-DEV` · `crewBoost(g=1.25,crew)`** | 10% | `0.0529` | `-23.11%*-` | `0.0662` | `-22.57%*-` | `0.287` | 42% | 1,199 | 6,649 | Collapsed |
| **`COLD-VAL` · `baseline`** | 8.7% | `0.0569` | — | `0.0692` | — | `0.300` | 44.7% | 1,035 | 7,966 | Baseline |
| **`COLD-VAL` · `popMatch(w=0.6)`** | 9.3% | `0.0567` | `-0.35% [-0.0072, 0.0075]` | `0.0715` | `+3.32% [-0.0060, 0.0108]` | `0.380` | 46.7% | 932 | 7,878 | **FAIL** |
| **`COLD-VAL` · `crewBoost(g=0.75..1.75)`** | 6.7–8% | `0.0377–0.0479` | `-15.82%*-` to `-33.74%*-` | `0.0489–0.0606` | `-12.43%*-` to `-29.34%*-` | `0.233–0.287` | 36.7–44.7% | 1,122–1,237 | 5,516–6,657 | **FAIL** |

- **Diagnosis:** (1) `popMatch` suppressed valid cross-popularity favorites across full `Dev-150` and `Holdout-150` (`HR@1` `15.3% → 12.7–14%`). (2) `collabShrink` collapsed `Small-Vault (3..10)` because even 3–10 indexed ratings in `EASE^R + SVD` vastly outperform coarse metadata. (3) `crewBoost` let single-director ties overpower semantic `contentSim` and `bayesianRatingNorm` on 100%-cold pools (`-15.82%*-` to `-33.74%*-`).

---

### Experiment 18 (Task 6 — **SHIPPED**, `0b96df6`): Multi-Persona Bucket B, Multi-Auteur Bucket C & Bucket D Provider-Alias Expansion
- **Files Changed:** [src/services/tmdbService.js](./src/services/tmdbService.js), [src/services/geminiService.js](./src/services/geminiService.js), [tests/pipelineBugs.test.js](./tests/pipelineBugs.test.js), [tests/recentReleaseSlots.test.js](./tests/recentReleaseSlots.test.js)
- **What Shipped (verified TDD RED `5` failing -> GREEN `470 / 470` passing):**
  1. **`selectPersonaAnchorIds(weightedRatings, embeddingIndex, maxAnchors = 3)`:** Selects the highest-weight `>= 8★` medoid per Spherical K-Means persona ordered by `mass` descending (using `{ k: Math.max(1, limit) }` when `< 12` indexed positive films), falling back to up to `3` distinct-genre `>= 9★` anchors when `embeddingIndex` is absent.
  2. **Multi-Persona `fetchBucketB` & Multi-Auteur `fetchBucketC`:** `fetchBucketB` distributes `<= 4` TMDB discover pages across up to `3` anchors (round-robin interleaved via `interleaveTmdbStreams`, 100% backward compatible with a single ID); `fetchBucketC` fans out across `profile.topCrewIds.slice(0, 3)` in parallel (max `3` TMDB calls, preserving 3-page pagination when only `1` crew ID exists).
  3. **Bucket D Alias Parity & Concurrent Index Preload:** Unified `applyProviderAndRegionParams` with `buildProviderFilter(userProviders, { expandAliases: true })` so Bucket D expands `PROVIDER_FAMILY_MAP` (e.g., Netflix `8` -> `8|1796|175`), and started `loadDefaultEmbeddingIndex()` concurrently with `extractTasteProfile` inside `getMovieRecommendations`.

---

### Experiment 19 (Task 7 — SPLIT VERDICT, `bda771e`): Explore Wave-3 Score Lock (**SHIPPED**) + `n = 50` Kernel MMR Over-Pitch Logit Fusion (`GATE: FAIL`, `n = 9 / 50` Quota-Blocked)
- **Files Changed:** [src/services/exploreForYouService.js](./src/services/exploreForYouService.js), [tests/exploreForYouService.test.js](./tests/exploreForYouService.test.js), [scripts/experiments/eval_math_anchor_llm.mjs](./scripts/experiments/eval_math_anchor_llm.mjs) (`rankerService.js` and `geminiService.js` left **untouched**)
- **Part A — `Explore For You` Wave-3 Score Lock (**SHIPPED**):** Removed `"s"` from `buildExploreForYouBatchPrompt` and `generateExploreForYouPool`'s `responseSchema`, locked `forYouScore` and `matchScore` to the calibrated local ranker inside `mergeExploreForYouResponse`, and preserved continuous math ordering via `rankIdxById` tie-breaker (`472 / 472` passing).
- **Part B — `n = 50` Kernel MMR Shortlist + `100 → 25` Over-Pitch → `20` Logit Fusion + `ProtectTop-2` (`GATE: FAIL`, `n = 9 / 50`):**
  - Dry-run (`--users 50 --dry-run`) verified across all 50 spaced `Holdout-150` users (`100/100` shortlist, `outlierDiff = 14/14` via Kernel MMR over normalized `SVD-64` + `MiniLM-128D`, zero `[Strong Vault Signal]` tags, `20.3k–23.0k` prompt chars, `324.63 ms/user` offline MMR).
  - Live execution encountered `503 UNAVAILABLE` across all Gemini 3.x models (`gemini-3.5-flash-lite`, `3.1-flash-lite`, `3-flash-preview`, `3.5-flash`, `3.6-flash`, `3.7-flash`, `3.8-flash`, `gemini-4-hydrogen`); `gemini-2.5-flash` completed **`9 / 50`** paired users (`18` calls, `alpha = 0.8`, `mmrLambda = 0.65`) before hitting its Free Tier `20 RPD` cap (`429 RESOURCE_EXHAUSTED` on user `10/50`, `123418`). Checkpoint preserved in `.data/v6_lab/v6_2_overpitch_ckpt.json` for seamless resume.

| Strategy (`n = 9 / 50`, `gemini-2.5-flash`) | `NDCG@10` | `NDCG@20` | `Hits@10` | `Hits@20` | `Tail@20` | `HR@20` | `Cov` | `AvgV` | Boilerplate Rate | Paired `95%` CI vs Control A (`1,000` resamples, `seed=42`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Pure Math Top-20** *(ceiling ref)* | `0.1925` | `0.2092` | `1.444` | `1.889` | `0.333` | `66.7%` | 149 | 13,990 | `100.00%` (180/180) | — |
| **Control A (`100 → 20`, production)** | `0.1200` | `0.1346` | `1.333` | `1.778` | `0.556` | `55.6%` | 154 | 13,343 | `5.56%` (10/180) | Baseline |
| **Control A + `ProtectTop-2`** *(post-hoc ref)* | `0.1806` (+50.5%) | `0.1951` (+44.9%) | `1.444` | `1.889` | `0.556` (+0.0%) | `66.7%` | 152 | 13,434 | `7.22%` (13/180) | `ci10=[-0.0005, +0.1822]` (ns), `ci20=[-0.0005, +0.1822]` (ns) |
| **Treatment (`Kernel MMR + 100 → 25 → 20 + ProtectTop-2`)** | **`0.1838` (+53.17%\*)** | **`0.1981` (+47.18%\*)** | **`1.444`** | **`1.889`** | **`0.556` (+0.00%)** | **`66.7%`** | 149 | 13,725 | **`1.67%` (3/180 <= 2%)** | **`ci10=[+0.0005, +0.1856]` (`sig10=true`)**, **`ci20=[+0.0002, +0.1854]` (`sig20=true`)**, `ciTail=[0, 0]` |

- **Gate Verdict (`GATE: FAIL`):** Rejected solely because `fullSampleOk: false` (`n = 9 / 50` incomplete due to API quota/capacity). Once quota resets, completing the remaining `41 / 50` users from `.data/v6_lab/v6_2_overpitch_ckpt.json` is top priority.

---

### Experiment 20 (Task 8 — **SHIPPED**, `d0a3001`): Behavioral Signal Activation — Watchlist EASE^R Intent, Studio Craft Breakdown, Rewatch/IMAX Boost & Reason-Typed Dismissals
- **Files Changed:** [easeService.js](./src/services/easeService.js), [tmdbService.js](./src/services/tmdbService.js), [onlineLearningService.js](./src/services/onlineLearningService.js), [geminiService.js](./src/services/geminiService.js), [exploreForYouService.js](./src/services/exploreForYouService.js), [embeddingWorkerClient.js](./src/services/embeddingWorkerClient.js), [embeddingWorker.js](./src/workers/embeddingWorker.js)
- **What Shipped (verified TDD RED `5` failing -> GREEN `479 / 479` passing):**
  1. **Watchlist EASE^R Forward Intent:** `buildEaseSimMapFromIndex` accepts `watchlistItems` and `watchlistWeight = 0.25`, deduplicates against watched `tmdbId`s, ranks unwatched indexed watchlist entries by recency (`updatedAt ?? dateAdded ?? addedAt ?? createdAt ?? ts`, tie-breaking newest append order), and caps at `15` items; wired across both Oracle (`geminiService.js`) and Explore For You (`exploreForYouService.js` -> `embeddingWorkerClient.js` -> `embeddingWorker.js`).
  2. **Studio Craft Breakdown & `1.15x` Rewatch/Format Boost (`extractTasteProfile`):** Maps finite `1..5` `ratingBreakdown.direction`/`visuals` onto signed crew signals and `ratingBreakdown.acting` onto billing-decayed cast signals centered around `3.0` (so high craft on a `5★` script still builds positive creator affinity), falling back cleanly to overall `weight` when unset; applies `1.15x` positive magnitude boost for `>= 8★` films with `rewatchCount >= 2` or `watchMeta.format` in `{"imax", "physical"}` without altering `computeZScoredWeights`.
  3. **Reason-Typed Pacing Dismissal Filtering (`derivePersonalizedRankerWeights`):** Skips `action === "dismissed"` entries matching `/too\s*slow|pacing/i` so pacing rejections do not push down `collabSim` or `genreOverlap` weights.

---

### Task 9: Final `v6.2` Regression Verification Snapshot (`v6.2-final`)
- **`npm test`:** **`479 / 479` passing**, `0` failed, `0` skipped (`1,257.74 ms`).
- **`npm run build`:** **`vite build` exited `0`** (`2,360` modules transformed in `5.51 s`; shipped assets in `build/models/`: `item_ease_k64.cvea` `3,640,016 B`, `item_embeddings_f16.bin` `3,300,016 B`, `content_embeddings_f16.bin` `2,890,956 B`, `ranker_weights.json` `416 B`).
- **Weight Parity Check:** `public/models/ranker_weights.json` matches `DEFAULT_RANKER_WEIGHTS` in `src/services/rankerService.js` (`EXACT_MATCH: true`).
- **`node scripts/experiments/v6_gate_eval.mjs --ease .data/v6_lab/ease_v6_baseline_clean.cvea --compare-baseline .data/v6_lab/v6_baseline.json --label v6.2-final`:**
  - **`DEV-150`:** `HR1=20% | NDCG10=0.1142 (+0.0%) | NDCG20=0.1500 (+0.0%) | Hits20=1.747 | Tail20=0.927 (+0.0%) | HR20=76.7% | HR100=97.3%(4.13) | Cov=899 | AvgV=10831 | AUC8=0.6524 | 1.92ms`
  - **`HOLDOUT-150`:** `HR1=15.3% | NDCG10=0.1220 (+0.0%) | NDCG20=0.1540 (+0.0%) | Hits20=1.680 | Tail20=1.020 (+0.0%) | HR20=71.3% | HR100=96%(4.19) | Cov=910 | AvgV=9934 | AUC8=0.6888 | 1.91ms`
  - **`ALL-300`:** `HR1=17.7% | NDCG10=0.1181 (+0.0%) | NDCG20=0.1520 (+0.0%) | Hits20=1.713 | Tail20=0.973 (+0.0%) | HR20=74% | HR100=96.7%(4.16) | Cov=1134 | AvgV=10383 | AUC8=0.6707 | 1.83ms`
  - Confirms exact `0.000` regression against the locked clean `v6.0`/`v6.1` MovieLens 32M baseline while shipping all `v6.2` retrieval, cold-isolation, Explore score-lock, and behavioral Vault signal upgrades (`npm test` expanded further with GameVault Phase 2).

---

## GameVault `v1.1–v1.5` Training, Forensic Audit & Client Engineering Log (Nov 27–28, 2026)

> For the complete standalone breakdown of GameVault's local ML math, Colab training fixes, Movies-vs-Games differences, and PC rig tier engine, see **[GAMEVAULT_ML_GUIDE.md](./GAMEVAULT_ML_GUIDE.md)**.

- **Notebook & Canonical Dataset:** [scripts/games/train_games_colab.ipynb](./scripts/games/train_games_colab.ipynb) executed on Google Colab Tesla T4 High-RAM, merging Steam collaborative histories (`antonkozyriev/game-recommendations-on-steam`) + `FronkonGames`/`atalaydenknalbant` 2026 community tags + canonical **IGDB v4** catalog (`version_parent = null`, `18,144` Steam-to-IGDB mappings in `public/models/games/game_steam_to_igdb.json`, `1,034` IGDB edition aliases in `public/models/games/game_edition_aliases.json`, and `24,439` binary metadata records in `public/models/games/game_catalog_meta.bin`).
- **Artifacts Shipped in `public/models/games/`:**
  - `game_ease_k80.cvea` (`4,748,560 B`): Exact Sparse EASE^R (`14,656` games × `K=80`, symmetric pre-inversion `D^-0.30` scaling + mean-normalized `eff_lambda`, verified zero Neumann collapse & zero review-bomb pollution).
  - `game_embeddings_f16.bin` (`1,934,608 B`): `14,656 × 64-D` Spectral-EASE (`eigh`) collaborative index (`CVEM v1`), powering dense collaborative blending, `/game/:id` point-lookup fallback, and dislike repulsion.
  - `game_content_f16.bin` (`6,354,156 B`): `24,439 × 128-D` Ridge-aligned [`BAAI/bge-large-en-v1.5`](https://huggingface.co/BAAI/bge-large-en-v1.5) (`Tag-Dropout Ridge`, `gamma=3.0`, `0.750 / 0.661` balanced subspace norms across warm & cold).
  - `game_catalog_meta.bin` (`342,162 B`, `CVGM v2`): Compact 14-byte/game binary pre-retrieval sidecar (`24,439 / 24,439` IGDB matched + live `/v4/game_time_to_beats` `typicalHours`) built via [scripts/games/build_catalog_meta.mjs](./scripts/games/build_catalog_meta.mjs) for dynamic release-date, flop, platform, rig-tier, genre, relative-playtime, and Break-My-Bubble pre-filtering.
  - `game_tuner_axes.json` (`3,303 B`): Popularity-decorrelated linear probes (`Intensity` AUC `0.968`, `Tone` AUC `0.996`, `corr = 0.0000`) with runtime **Löwdin symmetric orthogonalization** (`|cos(intensity, tone)| < 1e-4`).
  - `game_edition_aliases.json` (`1,034` cold→warm edition aliases built via [scripts/games/build_edition_aliases.mjs](./scripts/games/build_edition_aliases.mjs)).
  - `game_ranker_weights.json` (`2,578 B`): Production blend (`ease: 0.6452`, `collab: 0.1075`, `content: 0.2151`, `popularityPrior: 0.0323`) & metrics snapshot.
- **`v1.2–v1.4` Client Ranker, Infrastructure & Cloud Sync Upgrades:**
  - **v1.2:** Memoized vault-signature similarity maps (`< 0.1 ms` route switches), `τ = 1.85` Match `%` calibration, sibling-edition dedupe (`normalizeGameBaseTitle`), quality/flop/unreleased guards, strict IGDB `total_rating_count` floors, and PC GPU spec tier detection (`entry`/`mid`/`high`).
  - **v1.3:** Wired `game_edition_aliases.json` across `gameRankerService.js` + `findSimilarGameIds`, isolated UI `"Not for me"` `dismissedIds` into dual warm + cold repulsion maps without distorting `catalogMax`, soft franchise diversity cap (`applyFranchiseDiversityCap`), per-game vault anchors (`findTopVaultAnchorsForGame`), widened `predictGameRating` spread (`7.4–9.5`), neural Oracle mood `tunerBias` + 3-model Gemini cascade (`3.5-flash-lite` → `3.1-flash-lite` → `2.5-flash`), and offline JS ranker harness ([scripts/games/eval_game_ranker.mjs](./scripts/games/eval_game_ranker.mjs)).
  - **v1.4:** Shipped `game_catalog_meta.bin` pre-retrieval filtering (with dynamic `releaseDay` check + automatic `coldLimit >= 56` expansion for pure-console players), Multi-Persona LogSumExp (`β = 14`) cold scoring with robust top-15 `contentCatalogMax` (retaining pure `game_content_f16.bin` queries after live checks showed `game_embeddings_f16.bin` stores shrinkage norms `||e|| ≈ 0.09–0.14` and Ridge-to-Ridge queries score higher: `0.805` vs `0.648` on *Hades→Hades II*), Löwdin symmetric orthogonalization of `Intensity`/`Tone` axes, short-completed-game `playBoost >= 1.0` fix, same-year/TBA unreleased guard, `/game/:id` + Search + Explore Catalog `pointLookup: true` sparse-EASE fallback, softened rating penalty curve (`< 7.0` gentle `0.65` vs `< 5.8` flop `1.95`), age-normalized Familiarity slider, `GET /api/igdb` Edge CDN caching (`x-vercel-cache: HIT` verified live) + `discover_home` multiquery + optional Upstash Redis token cache + Vite dev `?` query middleware fix, `vercel.json` JSON `Content-Type` fix, and keyset-paginated cloud sync with strict page-error abort, 30-day delete tombstones, and full GameVault wipe on `signOutCloud({ clearLocal: true })`.
  - **v1.5:** Upgraded `game_catalog_meta.bin` to `CVGM v2` (`14 B/game`) with IGDB `/v4/game_time_to_beats` typical playthrough hours (`typicalHours`) + genre fallback; upgraded `buildWeightedGameRatings` to relative playtime (`yourHours / typicalHours`), relative salty-veteran dislike guards, and gentle `±12%` `datePlayed` recency tilt; wired 5-aspect Craft Breakdown sliders (`ratingBreakdown`) and Quick Tags (`quickTags`) via `extractGameCraftAndTagProfile` into bounded neural Intensity/Tone tie-breakers, match reasons, and Game Oracle + Companion Chat prompts.

| Split / Evaluation (`500` Dev, `500` Untouched Test) | Popularity `NDCG@20` | `EASE-80` `NDCG@20` | Hybrid Fusion `NDCG@20` | Fusion `Recall@20` | Bootstrap `Fusion − Pop` `95%` CI |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`DEV-500` (Warm Chronological)** | `0.0306` | `0.0915` | **`0.0917`** (`+199.6%`) | **`0.1382`** (`+175.8%`) | — |
| **`TEST-500` (Untouched Holdout)** | `0.0307` | `0.0822` | **`0.0826`** (`+169.0%`) | **`0.1191`** (`+146.4%`) | **`+0.0519`** (`[0.0407, 0.0632]`, sig+) |
| **True Cold-Start (`2,199` Unseen Games)** | `Pure BGE-PCA`: `0.0516` | — | **`Tag-Dropout Aligned`: `0.0535`** (`+3.68%`) | **`0.1145`** (**`+9.05%` Recall@20**) | Warm/cold browser logit parity `contentNorm / 0.72` |

---

## Next Refinement Backlog (v6.3+ Highest-Leverage Unexplored Ideas)

1. **Resume `n = 50` Validation of `Kernel MMR + 100 → 25 Over-Pitch → 20 Logit Fusion + ProtectTop-2`:** Resume the remaining `41 / 50` `Holdout-150` users in `.data/v6_lab/v6_2_overpitch_ckpt.json` via `scripts/experiments/eval_math_anchor_llm.mjs` once Gemini API quota / 3.5-Flash-Lite capacity recovers (`n = 9/50` showed `+53.17%*` `NDCG@10`, `+47.18%*` `NDCG@20`, and `1.67%` boilerplate vs `5.56%` Control A).
2. **Higher-Capacity Neural Content Encoder (`BGE-large` / `gemini-embedding-001`) + Cast/Director/Keyword Text Enrichment:** Expanding `content_embeddings_f16.bin` text inputs beyond `title + tagline + overview` (to include TMDB genres, director, top cast, and keywords) and refreshing quarterly for `2026+` releases.
3. **Recency-Aware Implicit Sequence / Session Model (SASRec / Recency-Biased EASE):** True sequential modeling over chronologically ordered user-watch streams rather than static bag-of-items or noisy MovieLens logging timestamps.
