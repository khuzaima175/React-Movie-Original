# CinemaVault Local Model & Engineering Troubleshooting Guide (EZ Edition)

**Last Updated:** November 13, 2026 (`main` @ `1336dcc`)  
**Status:** Production-ready on `main` · `99 / 99` unit tests passing · Production build green (`2232` modules)

If you want to understand **what our local ML model actually is**, **what work and offline experiments we ran step by step**, **every bug/error we ran into**, **how we fixed each one**, and **how to check that everything is healthy with simple copy-paste commands**, everything is explained here in plain, easy-to-follow English.

---

## 1. The Short Version: What Is "Our Local Model"?

Your recommendation engine does **85–90% of the intelligence locally on the user's device (`$0.00` API cost, a few milliseconds)** before Google Gemini ever sees a candidate movie. It consists of three working parts on disk + in JavaScript:

1. **The Pre-Trained Movie Map ([public/models/item_embeddings_f16.bin](./public/models/item_embeddings_f16.bin))**
   - **What it is:** Your **3.15 MB** (`3,300,016` bytes) Google Colab-trained latent taste matrix saved in our compact **CVEM v1** (`float16` half-precision) binary format.
   - **What's inside:** **25,000 movies** from the **MovieLens 32M** dataset, each represented by a **64-dimensional L2-normalized vector** (`dim = 64`) capturing which global audiences co-like and co-dislike the film, mapped directly to integer TMDB IDs.
   - **Byte-by-Byte Layout (`CVEM v1`):**
     - Bytes `0..3`: ASCII magic header `"CVEM"`
     - Bytes `4..7`: `uint32` version (`1`, little-endian)
     - Bytes `8..11`: `uint32` item count (`25000`, little-endian)
     - Bytes `12..15`: `uint32` embedding dimension (`64`, little-endian)
     - Remaining bytes (`25,000 × (4 + 64 × 2) = 3,300,000` B): repeated `[uint32 tmdbId][64 × float16 components]` records (`16 + 3,300,000 = 3,300,016` B total).
   - **How the browser loads it safely:** `loadDefaultEmbeddingIndex` in [src/services/embeddingService.js](./src/services/embeddingService.js#L516-L539) fetches `/models/item_embeddings_f16.bin` lazily once per browser session, rejects SPA `text/html` fallback pages, validates header bounds and exact `byteLength`, decodes IEEE-754 `float16` -> `Float32Array`, and caches the index in memory. If the binary is missing or running inside offline unit tests, it returns `null` safely without crashing.

2. **The Calibrated Local Ranker (`DEFAULT_RANKER_WEIGHTS` in [src/services/rankerService.js](./src/services/rankerService.js#L6-L19))**
   - Computes **11 normalized features** for every movie in the merged TMDB + Embedding candidate pool (`collabSim`, `contentSim`, `genreOverlap`, `keywordOverlap`, `crewMatch`, `castMatch`, `bayesianRatingNorm`, `noveltyBonus`, `negativeKeywordPenalty`, `repulsion`, `providerMatch`).
   - Passes them through a calibrated logistic sigmoid $\sigma(b + w^\top x)$ and locks each film's deterministic **50–99% Match Score** plus up to 3 deterministic **Match Reason Badges** (`🧬 High Taste-Twin Match`, `🤝 Collaborative Taste Pick`, `🎬 Favorite Filmmaker`, `🎭 Top Cast Match`, `🎯 Core Theme Match`, `💎 Personal Cult Pick`, `🎪 Genre Bullseye`, `⭐ Critical Acclaim`).
   - **Zero LLM Hallucination:** Gemini **never** invents or overrides these match percentages — `mergeGeminiExplanationsWithRanker` locks the mathematical `matchScore` and `matchReasons`, asking Gemini only to select the best diverse **6** out of **15** pre-ranked titles and write personalized 1-sentence explanations.

3. **Offline Weight Snapshot ([public/models/ranker_weights.json](./public/models/ranker_weights.json)) & Trainer ([scripts/colab_train_embeddings.py](./scripts/colab_train_embeddings.py))**
   - `public/models/ranker_weights.json` is an offline training/reference JSON exported alongside the Colab trainer and kept synchronized with the live `-0.5` negative keyword penalty (`collabSim: 4.8`, `negativeKeywordPenalty: -0.5`). The browser app itself always uses `DEFAULT_RANKER_WEIGHTS` directly from `src/services/rankerService.js`.
   - `scripts/colab_train_embeddings.py` is the Python Truncated SVD trainer (`svds`, `k=64`, Bayesian norm shrinkage `0.5`) with built-in holdout stripping and popularity sanity gates.

---

## 2. Which Binary File Is Active? (Provenance & Zero-Leakage Audit)

An early question we checked carefully: *"Did the quick `ml-latest-small` test file accidentally overwrite the big Google Colab 32M model?"*

**Answer: No.** Your Google Colab 32M binary stayed completely intact in `public/models/`.

| File Path | Exact Size | Origin | Items / Dim | Status in App |
| :--- | :---: | :--- | :---: | :--- |
| [public/models/item_embeddings_f16.bin](./public/models/item_embeddings_f16.bin) | `3,300,016 B` (`3.15 MB`) | **Your Google Colab training run** on MovieLens 32M | `25,000` × `64` | **ACTIVE IN APP** |
| `.data/small_ref.bin` | `1,275,268 B` (`1.22 MB`) | Local quick test on `ml-latest-small` (`100k` ratings) | `9,734` × `64` | Archived in `.data/` (never loaded by app) |
| `.data/item_embeddings_clean_f16.bin` | `3,300,016 B` (`3.15 MB`) | Clean 32M retrain stripping all benchmark test holdout rows | `25,000` × `64` | Benchmark-only leakage verification in `.data/` |

### Zero-Leakage Proof (`.data/task3_clean_eval_results.json`)
To make sure our evaluation numbers weren't artificially inflated by the Colab matrix having seen test users' future watches during training, we retrained a strictly scrubbed 32M SVD index (`.data/item_embeddings_clean_f16.bin`) with test holdout windows stripped and ran paired bootstrap comparisons across **328 active MovieLens users**:

| System Tested | `NDCG@10` | `Recall@20` | Bootstrap Leakage Test (`leaky` minus `clean`) |
| :--- | :---: | :---: | :--- |
| **Popularity Baseline (`pop`)** | `0.0392` | `0.0671` | Baseline reference |
| **Colab Collab-Only (`leaky_collab`)** | `0.0732` | `0.1229` | `ΔNDCG = -0.00097`, 95% CI `[-0.00450, +0.00170]` (`isSignificant: false`) |
| **Clean Collab-Only (`clean_collab`)** | `0.0742` | `0.1213` | `ΔRecall = +0.00152`, 95% CI `[-0.00091, +0.00457]` (`isSignificant: false`) |
| **Colab Full Ranker (`leaky_ranker`)** | `0.0828` | `0.1207` | `ΔNDCG = +0.00023`, 95% CI `[-0.00197, +0.00236]` (`isSignificant: false`) |
| **Clean Full Ranker (`clean_ranker`)** | `0.0826` | `0.1207` | `ΔRecall = 0.00000`, 95% CI `[-0.00213, +0.00213]` (`isSignificant: false`) |

**Takeaway:** Your Google Colab binary shows **zero statistically significant holdout leakage inflation**!

---

## 3. How the Local Pipeline Works (Step by Step)

```text
Your Vault & Watchlist (including hardened CSV / Letterboxd imports)
   │
   ├─► 1. scoringUtils.js (Per-User Z-Scores + Bulk-Safe Recency Decay)
   │      • Normalizes harsh vs generous raters: z_i = (rating - mean) / max(std, 0.5)
   │      • Exponential decay: w_i = z_i * e^(-0.002 * daysSince) (~346.5-day half-life)
   │      • Undated logs or clustered CSV backlog imports get bulkPriorDays = 180 (not day 0!)
   │      • Future dates clamped at >= 0 days so decay never exceeds 1.0
   │
   ├─► 2. embeddingService.js (Relative Weight Cutoff + Personas + Negative Repulsion)
   │      • Keeps every item with |w| > 1e-6 * maxAbsWeight (relative to your vault!)
   │      • Clusters loved films into 1–4 Spherical K-Means taste personas (computeUserPersonas)
   │        so contrasting favorites (e.g., Oldboy + Toy Story) stay distinct
   │      • Builds repulsionMap around films rated <= 5 with negative weights (penalty above cos > 0.35)
   │      • Blended similarity: 0.70 * max_persona_sim + 0.30 * top3_loved_item_mean
   │
   ├─► 3. tmdbService.js + Bucket E (5-Bucket Verified Candidate Pool)
   │      • Bucket B: Anchor Keywords (top-weighted 9★+ film micro-keywords via '|')
   │      • Bucket C: Auteur Crew (top director/DP/composer/writer filmography)
   │      • Bucket A: Semantic Discover (loved genres + watchlist intent + cast + mood + without_keywords + streaming)
   │      • Bucket D: Recent-Release Lane (last 18 months, popularity.desc, avg >= 7.0, votes >= 150, max 12)
   │      • Bucket E: Up to 30 unseen nearest-neighbor films from your 64-D CVEM personas
   │
   ├─► 4. rankerService.js (Calibrated Logistic Scorer + Reserve Slots)
   │      • Pool-relative scaling: positive collabSim divided by max(maxPoolCollab, 0.05) -> [0, 1]
   │      • 0.20x Metadata Damping: gently damps genreOverlap & bayesianRatingNorm ONLY when collabSim exists
   │      • Selects Top 15 while reserving RECENT_RELEASE_RESERVE_COUNT = 2 recent slots
   │        (requiring >= 50th non-collab percentile AND prob >= 0.54; ranked by computeReserveQualityScore)
   │      • Locks deterministic 50–99% matchScore + up to 3 matchReasons badges
   │
   └─► 5. geminiService.js (H1 Resilient Gemini 4 Hydrogen Cascade)
          • Sends Top 15 to gemini-4-hydrogen (HIGH) -> 3.5-flash-lite -> 3.6-flash -> 3-flash-preview -> 2.5-flash -> 3.8-flash
          • Uses per-model AbortController timeouts (35s Hydrogen, 15s 3-flash, 10s 3.6-flash, 5s 3.8-flash, 8s flash-lite/2.5)
          • Classifies errors (quota/transient/invalid_config/auth_fatal) with smart cooldown backoff
          • If every cloud model fails or hits daily quota, falls back cleanly to Top 6 from ranker!
```

### Live Weights Running in `src/services/rankerService.js`

| Feature | Live Weight | Plain-English Role |
| :--- | :---: | :--- |
| `bias` | **`-1.1`** | Base threshold before positive or negative features shift probability |
| `collabSim` | **`+4.8`** | 64-D collaborative similarity (pool-normalized `[0, 1]` when pool max > `0.05`) |
| `contentSim` | **`+1.4`** | Reserved for content vectors — held at `0` at runtime to prevent double-counting |
| `genreOverlap` | **`+1.1`** | Fraction of top loved genres matched *(damped `0.20x` when collab signal exists)* |
| `keywordOverlap` | **`+0.8`** | Anchor/loved keyword match fraction (`0.6` proxy for Bucket B if keywords unpopulated) |
| `crewMatch` | **`+0.7`** | `1` if matches top creative crew ID or harvested from Bucket C |
| `castMatch` | **`+0.5`** | `1` if matches any of the user's top 2 recurring billed actors |
| `bayesianRatingNorm` | **`+1.2`** | TMDB Bayesian acclaim normalized `(B - 5.0)/4.5` *(damped `0.20x` when collab exists)* |
| `noveltyBonus` | **`+0.35`** | `0.5` when `100 <= vote_count <= 4000`, else `0.1` *(zeroed in `computeReserveQualityScore`)* |
| `negativeKeywordPenalty` | **`-0.5`** | Soft penalty per hated-keyword hit *(tuned down from `-2.0` after 328/300 validation)* |
| `repulsion` | **`-1.5`** | Quadratic penalty when cosine similarity to disliked movies exceeds `0.35` |
| `providerMatch` | **`+0.25`** | `1.0` if streaming on user's selected services, `0.5` when no filter active, else `0` |

---

## 4. Everything We Built, Tested & Verified (Full Evolution Chronicle)

### Phase 0: Scaling from `9.6k` Small to `25k` 32M + Normalization & Damping (`74edffa`)
- Upgraded from the tiny `9.6k`-film MovieLens Small index (`NDCG@10 = 0.062`, `Recall@20 = 0.083`, `Novelty = 1.48`) to **MovieLens 32M (`25,000` films, `64`-D)**, added pool-relative `collabSim` scaling (`collabScale = max(maxPoolCollab, 0.05)`), `0.20x` metadata damping, and deterministic **Match Reason Badges**.
- On the 4-vault TMDB benchmark suite, Nov 11 reached **`NDCG@10 = 0.143 (+131%)`**, **`Recall@20 = 0.242 (+192%)`**, and **`Novelty = 2.24 (+51%)`** — and current `main` pushes the 4-vault mean even higher to **`NDCG@10 = 0.158`, `Recall@20 = 0.246`, `Novelty = 2.312`**.

### Phase A: Full-Scale TMDB Enrichment & Negative Keyword Tuning (`332c21c`, `cc1fce9`)
- Enriched all **`9,734`** MovieLens Small rows (`9,733` unique TMDB IDs) against live TMDB APIs (**`9,620`** fetched cleanly in `7.3` minutes; `113` were TMDB HTTP `404`).
- Tested candidate improvements on **328 original users** + **Fresh 300 users** (zero user overlap with original 328).
- Discovered `-2.0` `negativeKeywordPenalty` was overly harsh because generic tags (e.g., `independent film`, `based on novel`) frequently co-occur in both loved and disliked films. Softened default weight to **`-0.5`** (`332c21c`) and aligned `public/models/ranker_weights.json` (`cc1fce9`).
- **Verified real `rankCandidatePool` improvement (`.data/phaseA_real_ranker_verify.json`, `(e) -0.5` vs `(a) -2.0`):**
  - **Orig 328 (`n=328`):** `NDCG@10` `0.0699 -> 0.0802` (**`+0.0103`**, 95% CI `[+0.0042, +0.0169]`, statistically significant); `Recall@20` `0.1070 -> 0.1180` (**`+0.0110`**, 95% CI `[+0.0052, +0.0177]`, statistically significant).
  - **Fresh 300 (`n=300`):** `Recall@20` `0.1020 -> 0.1163` (**`+0.0143`**, 95% CI `[+0.0077, +0.0207]`, statistically significant); `NDCG@10` `0.0662 -> 0.0720` (`+0.0058`, 95% CI `[-0.000011, +0.0124]`).

### Phases C1, D1 & E0: Hardening Letterboxd & CSV Imports ([src/services/csvImport.js](./src/services/csvImport.js))
- Commits `2be4f3c`, `d095a48`, `0e2e2e3` (`fix/import-dates` → merged into `main` in `e592336`):
  - Extracted pure testable helpers out of JSX (`parseCSVImport`, `parseImportDate`, `buildQuickAddWatchedMovie`, `buildBulkMoveWatchedItem`, `buildWatchedRecordFromImport`) wired into `BackupManagerModal.jsx`, `MovieCard.jsx`, and `VaultPage.jsx`.
  - Enforces **`Watched Date`** (`dateSource: "watched"`) priority over **`Date`** (`dateSource: "logged"`).
  - Rejects invalid calendar rollovers (like `2026-02-30`) and future timestamps beyond `now + 24h` timezone tolerance.
  - Fixed header-aware column detection so Letterboxd URI strings in column 3 are no longer mistyped into `userNote`.
  - Added **Clustered Logged-Date Suppression**: when a CSV has `>= 10` (`MIN_CLUSTER_CHECK_ROWS`) parseable `Date` rows and either `>= 30%` (`CLUSTER_TOP3_SHARE`) land on just 3 calendar dates OR total span is `< 14` days (`MIN_ORGANIC_SPAN_DAYS`), clears fake logged timestamps and sets `isBulkImported: true` so the **180-day undated prior** applies instead of treating an old backlog as "watched today".
  - Added **Diary Rewatch Dedupe**: collapses duplicate normalized `title + year` entries to one record using the newest valid `dateWatched` while retaining the **most recent non-empty rating** even when the newest rewatch row had a blank rating.

### Phase E1: Relative Weight Cutoff for Multi-Decade Vaults ([src/services/embeddingService.js](./src/services/embeddingService.js#L181-L197))
- Commit `7bf6a0b` (`fix/relative-weight-cutoff` → merged into `main` in `a6dc54c`):
  - Replaced hardcoded `|w| <= 1e-6` thresholds inside `computeUserEmbedding` and `computeUserPersonas` with **`getRelativeWeightCutoff`**: skips items only when `|w| <= 1e-6 * maxAbsWeight` (and treats `maxAbsWeight == 0` as empty).
  - **Parity & Rescue Result (`.data/phaseE_e1_report.json`):**
    - `0 / 328` top-20 mismatches on normal MovieLens users.
    - Rescued benchmark user **`ml-user-263`** (`maxAbsWeight ≈ 3.15e-7`): went from `0` personas & `0` collab scores to **`4` personas & `25,000` scored films**!
    - Rescued benchmark user **`ml-user-409`** (`maxAbsWeight ≈ 1.28e-8`): went from `0` personas & `0` collab scores to **`2` personas & `25,000` scored films**!

### Phases F2, I1, I5 & Step 2: Bucket D Recent-Release Lane & Reserve Slots (`138f0d9`, `decbd56`)
- MovieLens 32M ends around late 2023, giving every 2024–2026 release `collabSim = 0`. Meanwhile, classic hits with `collabSim ≈ 0.98` saturated all Top 15 candidate slots.
- **Bucket D (`tmdbService.js`):** added a dedicated recent-release discover query (rolling 18 months via `getRecentReleaseDateFloor`, `sort_by=popularity.desc`, raised quality floors `vote_average.gte=7.0`, `vote_count.gte=150`, top 3 loved genres OR, no `with_cast` lock-in, up to 2 pages / max 12 items), appended *after* Buckets A/B/C so classic retrieval stays intact.
- **Reserve Lane (`rankerService.js` + `geminiService.js`):**
  - `RECENT_RELEASE_RESERVE_COUNT = 2`, `RECENT_RELEASE_RESERVE_MONTHS = 18`, `RECENT_RELEASE_MIN_PROB_PERCENTILE = 0.5` (with absolute `minProbability = 0.54` floor).
  - `selectWithReserve` reserves **`2`** Top-15 slots for qualifying recent films (prioritizing loved-genre matches when available) scored by **`computeReserveQualityScore`**, which calls `scoreCandidate` with identical ranker weights while zeroing only `noveltyBonus = 0` so acclaimed `> 4,000`-vote releases or `🎬 Favorite Filmmaker` films aren't penalized against niche titles.

### Phases G2, Step 1, H1 & I1–I3: Live Gemini Audit & Switch to `gemini-4-hydrogen` H1 Cascade
- **G2 Audit Finding (`.data/phaseG2_results.json`):** Audited 6 consecutive live runs of the old cascade:
  - `gemini-4-argon` had **0 free-tier input token limit (`HTTP 429`)** — banned/useless on free keys!
  - `gemini-3.8-flash` hung until hitting an **8,005 ms timeout** on every attempt!
  - `gemini-3.5-flash-lite` succeeded cleanly on every run (`2,000 ms – 3,075 ms` attempt latency, `500 RPD` free-tier limit).
- **Live Hydrogen Smoke Test (`.data/step1_hydrogen_smoke.json`):** Tested `gemini-4-hydrogen` directly on a realistic 15-movie JSON prompt:
  - **`MEDIUM` thinking:** `HTTP 200`, `8,409 ms`, tokens `2604` prompt / `686` output / `1087` thinking, parsed 6 valid picks.
  - **`HIGH` thinking:** `HTTP 200`, `10,030 ms`, tokens `2604` prompt / `502` output / `1507` thinking, parsed 6 valid picks.
  - In extended `I3` evaluation (`.data/phaseI3_model_eval.json`), `gemini-4-hydrogen` `HIGH` succeeded across all 9 attempted runs (latency `8,276 ms – 24,947 ms`, prompting us to bump `HYDROGEN_TIMEOUT_MS` & SDK `httpOptions.timeout` from `25,000 ms` to **`35,000 ms`** in `95ee2a6`).
- **H1 Resilient Cascade (`a47601b`, `74ed429`, `95ee2a6`, `1336dcc`):**
  - `CURATION_MODEL_CASCADE`: `["gemini-4-hydrogen", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-3.8-flash"]` (`HIGH` thinking on Hydrogen; `LOW` on `3.6-flash` / `3-flash-preview`).
  - `FAST_INTERACTIVE_CASCADE`: `["gemini-3.5-flash-lite", "gemini-4-hydrogen", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-3.8-flash"]` (`MEDIUM` thinking on Hydrogen — never `LOW`; `MINIMAL` on `3-flash-preview` fast chat).
  - Live JSON schema verification (`gemini-3.6-flash` `3,057 ms` `LOW`, `gemini-3-flash-preview` `8,532 ms` `LOW` / `2,116 ms` `MINIMAL`) informed `10,000 ms` (`3.6-flash`) and `15,000 ms` (`3-flash-preview`) `AbortController` timeouts.
  - Strips `frequencyPenalty`, `presencePenalty`, unsupported `candidateCount`, and `temperature` on `gemini-4-hydrogen`.
  - **4-Way Error Classification (`classifyGeminiError`) + Cooldowns:** `quota` (`retryDelay`, `120s` RPM, or `600s` RPD), `transient` (`30s`), `invalid_config` (`1800s`), `auth_fatal` (`1800s`), plus `30 min` `localStorage` working-model persistence, soonest-expiring probe when all models are cooling down, and removed a dangling `lastError` `ReferenceError` on total failure (`1336dcc`).
  - **Live UI Model Telemetry (`ModelUsageBadge` & `.chat-model-bar`):** `executeCascade`, `reRankCandidatesWithGemini`, and `generateWithOmdbFallback` attach structured `modelInfo` (`buildCascadeModelInfo` / `getLastModelInfo` / `resolveResultModelInfo`), persisted alongside cached recommendations (`cinemavault_recs_model_v1`), so **AI Picks** (toolbar badge + loading step queue hint + cache flag) and **Film Companion Chat** (top model bar + per-reply model tag + fallback cooldown tooltips) always show which model answered (`gemini-4-hydrogen`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-3.8-flash`, or `Local Ranker (Offline Fallback)`).

---

## 5. Every Error / Bug We Hit & How We Resolved It

| # | Error / Symptom We Observed | Root Cause | How We Fixed It | Where / Commit |
| :---: | :--- | :--- | :--- | :--- |
| **1** | Benchmark **Users `89` & `561` scored `0.000` NDCG@10** in early baselines | `89` had 50% of held-out films missing from the 9.6k index; `561`'s `rawCollabSim` (`0.05–0.35`) was drowned out by discrete genre/Bayesian ties pushing true matches to ranks `#11–#20` | Upgraded to 32M (`25k` films) + pool-relative `collabSim` scaling (`max > 0.05`) + `0.20x` metadata damping when collab exists; added 328 & 300 user suites | `74edffa`, [rankerService.js](./src/services/rankerService.js) |
| **2** | **`ml-user-263` & `ml-user-409` returned `0` personas & `0` `collabSim` scores** | Watch logs from 1999–2000 decayed to weights `1e-8 .. 3.15e-7`, falling below the hardcoded `<= 1e-6` weight cutoff | Switched to relative cutoff `1e-6 * maxAbsWeight` via `getRelativeWeightCutoff` | `7bf6a0b`, [embeddingService.js](./src/services/embeddingService.js#L181-L197) |
| **3** | **`263 / 328` users had loved keywords collide with `hatedKeywordIds`** | Broad tags (e.g. `independent film`, `based on novel`) appeared in both `>= 8★` and `<= 3★` watches; `-2.0` weight crushed good candidates & `hatedKeywordIds` wasn't sorted | Sorted `hatedKeywordIds` by descending score (`236e0f8`) and softened `negativeKeywordPenalty` from `-2.0` to **`-0.5`** (`332c21c`) | `236e0f8`, `332c21c`, [rankerService.js](./src/services/rankerService.js#L16) |
| **4** | **Letterboxd CSV imports dropped dates, saved URIs into `userNote`, accepted `2026-02-30`, & wiped ratings on blank rewatches** | Old importer ignored `Watched Date`/`Date`, fell back col 3 (`Letterboxd URI`) into `note`, JS `Date` silently rolled `2026-02-30` to March, bulk `Date` exports distorted recent decay, & blank rewatch rows overwrote stars | Extracted pure [src/services/csvImport.js](./src/services/csvImport.js): strict YMD calendar validator, `Watched Date` > `Date`, bulk-cluster suppression (`>= 10` rows / `>= 30%` top-3 / `< 14d`), & rewatch dedupe keeping newest date & latest non-empty rating | `2be4f3c`, `d095a48`, `0e2e2e3` |
| **5** | **Offline eval showed flat `bayesianRatingNorm` (`0.44` median) & skewed decay on dated vaults** | `ml-latest-small` had median `3` votes (`m = 500` pulled Bayesian scores to ~`7.0`); offline timestamps weren't anchored to `holdoutStartTs` | Anchored timestamps to each user's `holdoutStartTs` and enriched `9,620` real TMDB films for realistic vote counts | `.data/tmdb_eval_results.json` |
| **6** | **Pre-2024 cutoff + classics skew: `0` 2025–2026 releases entered Top 15** | MovieLens 32M stops around late 2023 (recent releases have `collabSim = 0`), while `collabSim ≈ 0.98` classics filled all 15 slots | Added **Bucket D** (18-month recent releases, `avg >= 7.0`, `votes >= 150`, max `12`) + **Reserve Lane** (`count = 2` in Top 15) | `138f0d9`, `decbd56`, [tmdbService.js](./src/services/tmdbService.js#L664-L732) |
| **7** | **SPA HTML `index.html` fallback or wrong binary dims could break parser** | Vite SPA fallback can serve `HTTP 200 text/html` for missing `/models/...` routes | `loadDefaultEmbeddingIndex` rejects `text/html` headers, checks `"CVEM"` magic bytes, validates dims, and verifies exact byte length | `f31ff54`, [embeddingService.js](./src/services/embeddingService.js#L112-L145) |
| **8** | **Gemini Free-Tier failures: `429` on `argon`, `8s` hang on `3.8-flash`, `400` on `thinkingBudget: 0`, ~25s abort on `hydrogen HIGH`, permanent session bans, & `ReferenceError`** | `argon` had `0` free quota; `3.8-flash` stalled; `3.5-flash-lite`/`hydrogen` reject `thinkingBudget: 0`; `25s` cut off ~24.9s `HIGH` calls; old code banned models forever on one 503; `lastError` wasn't defined in outer scope | Switched to `gemini-4-hydrogen` (`HIGH`/`MEDIUM`) + `3.5-flash-lite` ahead of `3.8-flash`; set `35s` Hydrogen timeout (`95ee2a6`); added H1 error-specific cooldowns (`74ed429`); fixed `lastError` scoping (`1336dcc`) | `a47601b`, `74ed429`, `95ee2a6`, `1336dcc`, [geminiService.js](./src/services/geminiService.js) |
| **9** | **Reserve scorer (`count = 3`) bumped a `98%` classic for a `78%` non-genre match, and underrated `85%` Favorite Filmmaker films** | Old cold-start formula (`2.5x` Bayesian / `0.35x` genre) diverged from ranker weights & kept `noveltyBonus` asymmetry; `count = 3` reached too low in reserve candidates | `computeReserveQualityScore` now calls `scoreCandidate` with identical weights and `noveltyBonus = 0`; reduced `RECENT_RELEASE_RESERVE_COUNT` from `3` to **`2`** | `decbd56`, [rankerService.js](./src/services/rankerService.js#L227-L230) |
| **10** | **`buildCollabSimMapFromIndex` wasted time re-sorting full `25k` vectors redundantly & false-negative `providerMatch` on discover buckets** | Discover queries with `with_watch_providers` lacked per-item `streamProviders` arrays until detail fetch, causing ranker to award `0` instead of `1` | Tagged `providerMatchedByQuery: true` during filtered Bucket A/B/C/D fetches and avoided redundant sorts in `buildCollabSimMapFromIndex` | `4b6e7c7`, `f34396f` |

---

## 6. How to Check Everything Yourself (EZ Verification Commands)

Run any of these from the project root (`g:\Important Projects\movie-ratings`):

### Check 1: Run All 99 Unit Tests (~0.5s, Offline)
```bash
npm test
```
**What "healthy" looks like:**
- Exits `0` with `tests 99 | pass 99 | fail 0 | skipped 0` across all **12** suites:
  - `tests/aiSpendTracker.test.js`
  - `tests/csvImport.test.js`
  - `tests/dnaService.test.js`
  - `tests/embeddingService.test.js`
  - `tests/evalHarness.test.js`
  - `tests/evalRanker.test.js`
  - `tests/feedbackLogging.test.js`
  - `tests/geminiDualEngine.test.js`
  - `tests/pipelineBugs.test.js`
  - `tests/rankerService.test.js`
  - `tests/recentReleaseSlots.test.js`
  - `tests/scoringUtils.test.js`

### Check 2: Verify Production Vite Bundle
```bash
npm run build
```
**What "healthy" looks like:**
- Exits `0`, transforms `2232 modules`, writes minified assets into `build/assets/...`, and copies `public/models/item_embeddings_f16.bin` into `build/models/item_embeddings_f16.bin`.

### Check 3: Inspect the Active `.bin` Model Header & Exact Byte Count
```bash
node -e "import('node:fs').then(fs=>{const b=fs.readFileSync('public/models/item_embeddings_f16.bin'),d=new DataView(b.buffer,b.byteOffset,b.byteLength);console.log({bytes:b.length,magic:b.slice(0,4).toString(),ver:d.getUint32(4,true),count:d.getUint32(8,true),dim:d.getUint32(12,true)});})"
```
**Expected exact output:**
```text
{ bytes: 3300016, magic: 'CVEM', ver: 1, count: 25000, dim: 64 }
```

### Check 4: Run the Local Evaluation Harness (`scripts/run_eval.mjs`)
```bash
# 1. Built-in synthetic benchmark (works out-of-the-box, no .data/ files needed)
node scripts/run_eval.mjs --synthetic

# 2. Real 4-vault MovieLens benchmark against your 25k embedding binary (if .data/benchmark_vaults.json is present)
node scripts/run_eval.mjs --benchmark .data/benchmark_vaults.json --embeddings public/models/item_embeddings_f16.bin
```
**Verified output on current `main` (`--benchmark`):**
- `ml-user-263`: `Recall@20 = 0.567`, `NDCG@10 = 0.351`, `Novelty = 2.004` (vs popularity `0.067 / 0.010`)
- `ml-user-409`: `Recall@20 = 0.367`, `NDCG@10 = 0.280`, `Novelty = 2.779` (vs popularity `0.200 / 0.109`)
- `ml-user-561`: `Recall@20 = 0.050`, `NDCG@10 = 0.000`, `Novelty = 2.423`
- `ml-user-89`: `Recall@20 = 0.000`, `NDCG@10 = 0.000`, `Novelty = 2.042` (`vault emb cov 60/98`)
- **4-vault mean:** **`NDCG@10 = 0.158`, `Recall@20 = 0.246`, `Novelty = 2.312`** — clearing the earlier Nov 11 32M milestone (`0.143 / 0.242 / 2.24`) and well above the `9.6k` small baseline (`0.062 / 0.083 / 1.48`).

### Check 5: Retrain or Regenerate the Local `.bin` Model (Only When Updating MovieLens Data)
```bash
python scripts/colab_train_embeddings.py --ml-dir .data/ml-32m --out public/models/item_embeddings_f16.bin --max-items 25000 --dim 64 --shrink 0.5 --holdout-users 89,263,409,561
```
Built-in safety gates in [scripts/colab_train_embeddings.py](./scripts/colab_train_embeddings.py):
- Automatically strips holdout windows for benchmark users (`--holdout-users`) before computing SVD.
- Refuses to overwrite the binary if offline SVD `Recall@20` fails to beat MovieLens popularity.
- Post-write validates exact byte size, `CVEM` v1 header, and verifies every written ID is a valid integer `tmdbId` from `links.csv`.

### Check 6: Live In-Browser DevTools Smoke Test (`npm start`)
1. Run `npm start` and open `http://localhost:5173`.
2. Open DevTools → **Network** tab → open **Recommendations**:
   - Confirm `/models/item_embeddings_f16.bin` loads with HTTP `200` (`3,300,016 B`, once per session).
   - Confirm recommendation rows display locked percentage badges (`50–99%`) and **Match Reason Badges** (`🧬 High Taste-Twin Match`, `🎬 Favorite Filmmaker`, `🎯 Core Theme Match`, etc.).
3. Open DevTools → **Application → LocalStorage** and inspect active state keys:
   - `cinemavault_smart_cache_v3` — 24h LRU recommendation cache (`500KB` cap).
   - `cinemavault_working_model_curation_v1` & `cinemavault_working_model_fast_v1` — persisted healthy Gemini model hints (`30 min` TTL).
4. **Offline / Quota Fallback Test:** Temporarily clear/invalidate `VITE_GEMINI_KEY` (or simulate quota) and click Refresh — verify CinemaVault seamlessly serves the top 6 mathematical ranker picks with locked match scores and badges instead of crashing.
