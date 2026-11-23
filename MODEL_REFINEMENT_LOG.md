# CinemaVault — Model Refinement & Experiment Logbook

> **Living Research Log:** Every offline math experiment, LLM curation benchmark, architectural test, mistake caught, and verified gain is recorded here so we can iteratively refine CinemaVault's recommendation accuracy with zero guesswork and zero data leakage.

**Current Production Engine:** `v6.1` (**Exact Full-Rank Sparse EASE^R `14k×64` + SVD-64 `60/40` Hybrid** + **128-D Neural Semantic Cold-Start Embeddings `11.1k` incl. `1,499` `2024–2026` releases** → **100-Candidate Stratified Shortlist** → **20 Curated Picks**)  
**Primary Benchmark Standard:** `300` completely unseen MovieLens 32M users (`.data/fresh_300_users.json`), chronological temporal holdout (last `10` ratings `>= 8/10`), evaluated against the `9,733`-film TMDB-enriched catalog with **all `625` evaluation users stripped from training** (`Dev-150` tuning split + untouched `Holdout-150` verification split + `1,000`-resample paired bootstrap `95%` CI).

---

## Executive Progress Tracker (300 Unseen MovieLens 32M Users)

| Version / Milestone | Date | Core Engine | `HR@1` (#1 Pick) | `NDCG@10` | `NDCG@20` | `HR@20` (≥1 Hit) | Avg Hits `@20` | Long-Tail Hits `@20` *(excl. top-200 pop)* | Shortlist Coverage (`HR@K` / Hits) |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **v5.6 Baseline** | 2026-11-20 | `SVD-64` (`CVEM v1`, 3.15 MB) + 12-feat Logistic Ranker · `39 → 10` | `12.3%` | `0.0789` | `0.1039` | `61.7%` | `1.247` | `0.887` | `HR@60: 86.0%` (`2.63`) |
| **v6.0 (Baked `γ=0.12`)** | 2026-11-23 | **Exact Full-Rank Sparse EASE^R (`14k×64`, `λ=800`, `γ=0.12` baked pre-pruning) + `SVD-64` (`60/40`)** · **`100 → 20`** | **`17.7%`** *(+44%)* | **`0.1181`** *(**+49.7%\***)* | **`0.1520`** *(**+46.3%\***)* | **`74.0%`** *(+12.3 pts)* | **`1.713`** *(+37.4%)* | **`0.973`** *(**+9.7%**)* | **`HR@100: 96.7%` (`4.16` hits)** |
| **v6.1 (Current — Cold-Start Upgrade)** | 2026-11-24 | `v6.0` Warm Engine + **`11,119 × 128-D` Neural Semantic Embeddings (`all-MiniLM-L6-v2` PCA, `2.76 MB`, `coldOnly: true`)** for `2024–2026` & unindexed films | **Warm: `17.7%`** | **Warm: `0.1181`** · **Cold Holdout: `0.0589` (+26.7%\*)** | **Warm: `0.1520`** · **Cold Holdout: `0.0716` (+22.1%\*)** | **Warm: `74.0%`** · **Cold Holdout: `46.7%` (+6.7 pts)** | **Warm: `1.713`** · **Cold Holdout: `0.693`** | **Warm: `0.973`** *(zero warm dilution)* | **Warm `HR@100: 96.7%` (`4.16`)** · **Cold `HR@100: 81.3%` (+6.0 pts)** |

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

## Next Refinement Backlog (v6.2+ Highest-Leverage Unexplored Ideas)

1. **Larger `n = 50+` Validation of Post-Hoc `ProtectTop-2` (Zero Prompt Tags):** Re-test `Control A + ProtectTop-2` once Gemini API quota resets; it showed `+21.4%` `NDCG@10` / `+13.9%` `NDCG@20` with zero `Tail@20` loss on `n = 17` and requires only ~8 lines in `mergeGeminiExplanationsWithRanker` if statistically confirmed.
2. **Higher-Capacity Neural Content Encoder (`BGE-large` / `gemini-embedding-001`) + Cast/Director/Keyword Text Enrichment:** Expanding `content_embeddings_f16.bin` text inputs beyond `title + tagline + overview` (to include TMDB genres, director, top cast, and keywords) and refreshing quarterly for `2026+` releases.
3. **Recency-Aware Implicit Sequence / Session Model (SASRec / Recency-Biased EASE):** True sequential modeling over chronologically ordered MovieLens 32M sequences rather than static bag-of-items co-occurrence.
