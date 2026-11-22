# CinemaVault Local Model & Engineering Troubleshooting Guide (EZ Edition)

**Last Updated:** November 20, 2026 (`v5.5`)  
**Status:** Production-ready · Verified by the offline service & API test suite (`npm test`) and production Vite build (`npm run build`).

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

2. **The 11-Feature Local Logistic Ranker (`DEFAULT_RANKER_WEIGHTS` in [src/services/rankerService.js](./src/services/rankerService.js#L6-L20))**
   - Computes **12 normalized features** (`11` active weighted features + optional `dnaSim` gated at `0`) for every movie in the merged TMDB + Embedding candidate pool (`collabSim`, `contentSim`, `genreOverlap`, `keywordOverlap`, `crewMatch`, `castMatch`, `bayesianRatingNorm`, `noveltyBonus`, `negativeKeywordPenalty`, `repulsion`, `providerMatch`, `dnaSim`).
   - Passes them through a temperature-scaled logistic sigmoid $\sigma((b + w^\top x + \text{moodAdjustment}) / \tau)$ (`\tau = 1.45`) and locks each film's order-preserving **50–99% Display Match Score** plus up to 3 deterministic **Match Reason Badges** (`🎭 <Mood> Fit`, `🧬 High Taste-Twin Match`, `🤝 Collaborative Taste Pick`, `🎬 Favorite Filmmaker`, `🎭 Top Cast Match`, `🎯 Core Theme Match`, `💎 Personal Cult Pick`, `🎪 Genre Bullseye`, `⭐ Critical Acclaim`).
   - **Zero LLM Score Hallucination:** Gemini **never** invents or overrides these match percentages — `mergeGeminiExplanationsWithRanker` locks the mathematical `matchScore` and `matchReasons`, asking Gemini only to select the best diverse **`10`** (`DEFAULT_RECOMMENDATION_COUNT = 10`) out of up to **`39`** stratified pre-ranked candidates (`25` top ranker + `8` cold `2024–2026` + `6` outliers via `buildDiversifiedGeminiShortlist`, plus `0–2` optional TMDB-verified `wildcardPicks`), pair each pick with `1–3` vault `anchorTitles`, and write personalized 1-sentence prose free of scoring jargon (backfilling cleanly from the top ranker picks if Gemini returns fewer than `10`).

3. **Offline Weight Snapshot ([public/models/ranker_weights.json](./public/models/ranker_weights.json)), Content/DNA Builders & Trainer ([scripts/colab_train_embeddings.py](./scripts/colab_train_embeddings.py))**
   - `public/models/ranker_weights.json` is an offline training/reference JSON (`_source: "v5.0-offline-328-cv"`) exported alongside the Colab trainer and kept synchronized in exact `deepEqual` parity with `DEFAULT_RANKER_WEIGHTS` (`collabSim: 6.4`, `negativeKeywordPenalty: -0.5`, `_metadataDampingFactor: 0.35`, `_displayTemperature: 1.45`). In-app, `onlineLearningService.js` optionally nudges personal weights via bounded `fitRankerWeights` once `>= 10` events (`>= 3` positive, `>= 3` negative) accumulate, while `scripts/build_content_embeddings.mjs` supports building optional `/models/content_embeddings_f16.bin` plot vectors cleanly without metadata leakage.
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
   ├─► 2. embeddingService.js (Relative Cutoff + Persona Mixture + Ridge Fold-In + Repulsion)
   │      • Keeps every item with |w| > 1e-6 * maxAbsWeight (relative to your vault!)
   │      • Clusters loved films into 1–4 mass-weighted Spherical K-Means personas (computePersonaDetails)
   │        and aggregates via log-sum-exp mixture (beta = 20) + top-3 loved similarity blend
   │      • Solves an on-device 64×64 L2-regularized Ridge Fold-In vector (computeUserRidgeEmbedding,
   │        lambda = 20, ridgeMinItems = 10, scale-invariant normW) across ALL rated films (blended 0.75 / 0.25)
   │      • Builds repulsionMap around films rated <= 5 with negative weights (penalty above cos > 0.35)
   │      • Extracts catalog-wide positive max via getCollabCatalogMax (minCatalogSize = 50)
   │
   ├─► 3. tmdbService.js + moodPolicy.js + Bucket E (5-Bucket Verified Candidate Pool)
   │      • Bucket B: Anchor Keywords (top-weighted 9★+ film micro-keywords via '|'; scaled 20%/12 in Mood)
   │      • Bucket C: Auteur Crew (top director/DP/composer/writer filmography; scaled 12%/8 in Mood)
   │      • Bucket A: Semantic Discover (loved genres + watchlist intent + cast [dropped in Mood] + moodPolicy + without_keywords + expanded PROVIDER_FAMILY_MAP streaming)
   │      • Bucket D: Recent-Release Lane (last 18 months, popularity.desc, avg >= 7.0, votes >= 150, max 12; skipped in hidden-gem/legacy era)
   │      • Bucket E: Unseen aligned neighbors from your 64-D CVEM personas (up to 30 in Any Vibe; 15 Mood-Gated in Mood)
   │      • Full-pool batch hydration (`enrichCandidatePoolMetadata` via `/api/tmdb-batch` + 30-day IndexedDB cache) fills missing keywords/cast/crew/providers across merged Buckets A–D
   │
   ├─► 4. rankerService.js (Calibrated Logistic Scorer + Mood Gates + Strict Providers)
   │      • Strict provider filter (`matchesWatchProviders`) prioritizes verified streaming candidates first
   │      • Pool-independent `catalog-max` scaling (`collabNormalization: "catalog-max"`): divides positive
   │        collabSim by max(catalogMax, 0.05) when catalog size >= 50 (with `poolMax` fallback for small synthetic maps)
   │      • Any Vibe: Smoothstep `[0, 0.02]` ramp -> `0.35x` Metadata Damping + 2 recent-release reserve slots (`computeReserveQualityScore`)
   │      • Explicit Mood / Match Vibe: `collabSim * 0.35`, `1.0x` metadata, `computeMoodScoreAdjustment`, & strict `matchesMoodCandidateGate` (emitting `moodShortfall` UI alert when sparse)
   │      • Builds 39-pick stratified shortlist (`buildDiversifiedGeminiShortlist`: 25 core + 8 cold 2024–2026 + 6 diverse outliers) while locking deterministic 50–99% matchScore + up to 3 matchReasons badges internally
   │
   └─► 5. geminiService.js + apiTransport.js (H1 Cascade -> 10 Picks + Verified Wildcards + Smart Cache v4)
          • Calls `/api/gemini` proxy in production (zero client keys) or direct key in local dev
          • Sends `userStats`, `topDirectors`, <=10 anchors, <=5 disliked/dismissed (nested `{ movie, weight, zScore }` lookup), <=3 recent (`120`-char notes), `6–7★` `NEAR MISSES`, <=8 `USER'S WATCHLIST`, `ADDITIONAL TOP FAVORITES` (11–25), `LOVED SERIES / ANIME`, deduplicated `ADDITIONAL VIEWER NOTES` (all remaining notes), & 39 unbiased candidates (`Specs`, top 3 `Cast`, top 5 `Themes`, `Tagline` <=70, `Plot` <=250; zero `Match: XX%` or `#1–#15` rank bias, `<= 20,000` chars) to gemini-4-hydrogen (HIGH) -> 3.5-flash-lite -> 3.6-flash -> 3-flash-preview -> 2.5-flash -> 3.8-flash
          • Uses per-model AbortController timeouts (35s Hydrogen, 15s Flash curation models) & equal-footing `"Curate openly"` selection + optional 0–2 `wildcardPicks` (TMDB/vault/provider/mood verified via `verifyAndScoreWildcardPicks` without 1-item collabSim stretch)
          • Selects 10 diverse winners (`DEFAULT_RECOMMENDATION_COUNT = 10`, prioritized wildcards + shortlist picks sorted by calibrated `matchScore`) with two-pass soft max-2-per-director cap, deterministic top-up backfill, note-aware profile cache hashing, & session Refresh rotation (`120` IDs, pages `1..5`)
          • If every cloud model fails or key/proxy is absent, falls back cleanly to Top 10 from ranker!
```

### Live Weights Running in `src/services/rankerService.js`

| Feature | Live Weight | Plain-English Role |
| :--- | :---: | :--- |
| `bias` | **`-1.1`** | Base threshold before positive or negative features shift probability |
| `collabSim` | **`+6.4`** | 64-D collaborative similarity (`0.75 * mixture(beta=20) + 0.25 * ridge(lambda=20)` normalized via pool-independent `catalog-max` `[0, 1]`; scaled `* 0.35` under explicit mood) |
| `contentSim` | **`+1.4`** | Cosine similarity from optional `/models/content_embeddings_f16.bin` plot vectors, or cold-gated structured + overview TF-IDF fallback when unindexed |
| `genreOverlap` | **`+0.6`** | Fraction of top loved genres matched *(smoothstep-damped `[0, 0.02]` → `0.35x` under Any Vibe; `1.0x` under explicit mood)* |
| `keywordOverlap` | **`+0.45`** | Continuous affinity-weighted overlap with top 15 IDF-damped, net-positive `keywordAffinities` (`0.6` proxy for Bucket B if keywords unpopulated) |
| `crewMatch` | **`+0.7`** | Continuous `[0, 1]` Bayesian-shrunk `crewAffinities[crewPersonId]` (or binary fallback + `0.5` Bucket C proxy) |
| `castMatch` | **`+0.5`** | Billing-decayed continuous `[0, 1]` Bayesian-shrunk `castAffinities` across candidate `castIds` (or `topCastIds` binary fallback) |
| `bayesianRatingNorm` | **`+1.8`** | TMDB Bayesian acclaim normalized `(B - 5.0)/4.5` *(smoothstep-damped `[0, 0.02]` → `0.35x` in Any Vibe; `1.0x` under explicit mood)* |
| `noveltyBonus` | **`+0.05`** | `0.5` when `100 <= vote_count <= 4000`, else `0.1` *(zeroed in `computeReserveQualityScore`)* |
| `negativeKeywordPenalty` | **`-0.5`** | Soft penalty per hit on disjoint net-negative `hatedKeywordIds` *(meta tags suppressed; `-2.0` originally)* |
| `repulsion` | **`-1.5`** | Quadratic penalty when cosine similarity to disliked movies exceeds `0.35` *(guarded so `>= 7★` ratings are never subtracted)* |
| `providerMatch` | **`+0.25`** | `1.0` if streaming on user's selected services (`PROVIDER_FAMILY_MAP`), `0.5` when no filter active, else `0` |
| `dnaSim` | **`0`** | Optional mean-centred 8-bit `CDNA` axis cosine (`/models/cinematic_dna_u8.bin`, gated at `0` until validated) |

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
  - Initially calibrated at `10,000 ms` (`3.6-flash`) / `15,000 ms` (`3-flash-preview`) from schema benchmarks (`3,057 ms` / `8,532 ms` `LOW`), and later standardized across all Flash curation attempts to **`15,000 ms`** (`getDefaultAttemptTimeoutMs`) so 10-pick + `anchorTitles` JSON responses do not time out prematurely.
  - Strips `frequencyPenalty`, `presencePenalty`, unsupported `candidateCount`, and `temperature` on `gemini-4-hydrogen`.
  - **4-Way Error Classification (`classifyGeminiError`) + Cooldowns:** `quota` (`retryDelay`, `120s` RPM, or `600s` RPD), `transient` (`30s`), `invalid_config` (`1800s`), `auth_fatal` (`1800s`), plus `30 min` `localStorage` working-model persistence, soonest-expiring probe when all models are cooling down, and removed a dangling `lastError` `ReferenceError` on total failure (`1336dcc`).
  - **Live UI Model Telemetry (`ModelUsageBadge` & `.chat-model-bar`):** `executeCascade`, `reRankCandidatesWithGemini`, and `generateWithOmdbFallback` attach structured `modelInfo` (`buildCascadeModelInfo` / `getLastModelInfo` / `resolveResultModelInfo`), persisted alongside cached recommendations (`cinemavault_recs_model_v1`), so **AI Picks** (expandable `"About these picks"` badge + loading step queue hint + cache flag) and **Film Companion Chat** (top model bar + per-reply model tag + fallback cooldown tooltips) always show which model answered (`gemini-4-hydrogen`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-3.8-flash`, or `Local Ranker (Offline Fallback)`).

### Phase J & Mood-Provider Ranker v2: Proxy Security, Discover/Taste Deck/Supabase, 10 Picks & Mood Separation (`main @ f089828`)
- **Batch Hydration, Online Learning & Non-Leaky Eval Gates:** Added `enrichCandidatePoolMetadata` across Buckets `A–D` (subsequently upgraded to full-pool batch hydration via `/api/tmdb-batch` + 30-day IndexedDB cache and `hydrationCoverage` telemetry), `onlineLearningService.js` (`derivePersonalizedRankerWeights` over `aiFeedbackLog`, skipping `already_seen`), standalone `/models/content_embeddings_f16.bin` loader (`contentSimService.js`), and `NegHit@20` + `Unique@30` evaluation metrics in `scripts/run_eval.mjs`.
- **Production Serverless Proxy Isolation (`api/*.js` & `apiTransport.js`):** Moved `GEMINI_API_KEY`, `TMDB_API_KEY`, and `OMDB_API_KEY` cleanly behind Vercel `/api/*` proxies (`api/tmdb-batch.js`, `ALLOWED_GEMINI_MODELS`, `ALLOWED_TMDB_PATH_RE`, `vercel.json` `maxDuration: 60`, upstream error secret redaction) while keeping local `.env` dev working transparently.
- **Canonical Mood Policy & 10-Pick Rotation (`22055ce..f089828`):**
  - Created single-source [src/services/moodPolicy.js](./src/services/moodPolicy.js) (`DEFAULT_RECOMMENDATION_COUNT = 10`, `MIN_VALID_CACHE_COUNT = 7`), deterministic offline `parseFreeTextMoodFallback`, hard `matchesMoodCandidateGate`, and mood-rebalanced ranking (`collabSim * 0.35`, `metadataDampingFactor: 1.0`, `computeMoodScoreAdjustment`) while leaving `"any"` vibe mathematically untouched.
  - Added strict streaming alias expansion (`PROVIDER_FAMILY_MAP`, `expandProviderIds`, `matchesWatchProviders`), Bucket E explicit-mood gating (`15` vs `30`), Bucket D skipping for `hidden-gem` / legacy `maxYear`, Top-30 shortlisting -> `10` picks with backfill & `120`-ID / 5-page refresh rotation (`oracleViewHelpers.js`), `cinemavault_smart_cache_v4` with region-scoped hashing (`_reg_<REGION>`), legacy `< 7`-pick cache discard in `AppContext.jsx`, anchor film links (`"Because you rated"`), and jargon-free `sanitizeOracleReason`.
- **Discover, Taste Deck, Portability & Opt-In Supabase Sync:** Added multi-page unwatched TMDB carousels + `HomePosterGrid`, first-visit `TasteDeckModal` (`buildTasteDeck`, `30` films), 10-tier `QuickRateModal`, cross-ID `movieIdentity.js`, `vaultPortability.js` v2 backups, exact `1★–10★` histogram bins (`vaultStats.js`), and optional multi-user Supabase Auth + Postgres RLS schema (`supabase/migrations/20261114000000_init_cinemavault_schema.sql`, `vaultSyncService.js`).

### Prompt 2 Offline Math Ablations: Catalog-Max Scaling, Smooth Damping & Persona Mixture + Ridge Fold-In
Tested step-by-step via `scripts/experiments/run_ablation.mjs` on `item_embeddings_clean2_f16.bin` (`328`-user tune cohort, `4` benchmark vaults, and strictly held-out `fresh_300_users.json`), evaluating both pool-wide ranking metrics (`NDCG@10`, `Recall@20`, `Precision@10`, `NegHit@20`) and rated-only `withinUserAuc` (`>= 9★ vs <= 7★` and `>= 8★ vs <= 7★`):
- **Step 2 (`catalog-max` + Smoothstep `[0, 0.02]` Damping):** Replaced pool-dependent `maxPoolCollab` with `getCollabCatalogMax` (`minCatalogSize = 50`, preserving `poolMax` fallback for small synthetic maps) and replaced the sharp step threshold at `0.001` with a smoothstep ramp across `|rawCollabSim| in [0, 0.02]`. Rejecting larger `rampMax = 0.10` (which hurt `ml-user-89`) and rank-percentile normalization (which compressed top-250 cosine spacing), `catalog-max + rampMax = 0.02` eliminated candidate-pool outlier sensitivity while lifting `328` `>= 8★` `AUC(>=8v<=7)` (`+0.0018*`) and `fresh_300 >= 9★` `AUC(>=9v<=7)` (`+0.0013*`) / `AUC(>=8v<=7)` (`+0.0011*`).
- **Step 3 (`0.75 * Mixture(beta=20) + 0.25 * Ridge(lambda=20)` Fold-In):** Upgraded persona clustering to `computePersonaDetails` (weighted fractional cluster masses aggregated via log-sum-exp mixture) and added `computeUserRidgeEmbedding` solving `(E^T C E + lambda I) u = E^T C z` (`ridgeMinItems = 10`, scale-invariant `normW` confidence, generous-rater baseline `min(meanR, 7.5)` clipped to `[-2.5, 2.5]`) across *all* liked, neutral, and disliked ratings. Final shipped comparison (`eval_final.json` vs `post_fixes`):
  - **`328` (`>= 8★`, `n=328`):** `NDCG@10 = 0.0909 (+0.0061*)`, `Recall@20 = 0.1256`, `Precision@10 = 0.0805`, `NegHit@20 = 0.0018`, `AUC(>=9v<=7) = 0.7335 (+0.0285*)`, `AUC(>=8v<=7) = 0.6994 (+0.0240*)`.
  - **`328` (`>= 9★`, `n=304`):** `NDCG@10 = 0.1145 (+0.0095*)`, `Recall@20 = 0.1448 (+0.0082*)`, `Precision@10 = 0.0947 (+0.0076*)`, `AUC(>=9v<=7) = 0.7458 (+0.0301*)`, `AUC(>=8v<=7) = 0.6971 (+0.0233*)`.
  - **Held-Out `fresh_300` (`>= 8★`, `n=300`):** `NDCG@10 = 0.0783`, `Recall@20 = 0.1247`, `Precision@10 = 0.0777`, `NegHit@20 = 0.0032 (-0.0018*)`, `AUC(>=9v<=7) = 0.7218 (+0.0338*)`, `AUC(>=8v<=7) = 0.6788 (+0.0256*)`.
  - **Held-Out `fresh_300` (`>= 9★`, `n=284`):** `NDCG@10 = 0.1227 (+0.0067*)`, `Recall@20 = 0.1581`, `Precision@10 = 0.0986 (+0.0077*)`, `AUC(>=9v<=7) = 0.7407 (+0.0302*)`, `AUC(>=8v<=7) = 0.6926 (+0.0230*)`.
  - **`4` Benchmark Vaults (`clean2`):** `>= 8★` rolling mean `NDCG@10 = 0.1776 (+0.0160)`, `Recall@20 = 0.2500`, `Precision@10 = 0.1667`, `AUC(>=9v<=7) = 0.7265`; `>= 9★` (`3` eligible vaults) `NDCG@10 = 0.2258 (+0.0345)`, `Recall@20 = 0.3333`, `Precision@10 = 0.2167`, `AUC(>=9v<=7) = 0.6817 (+0.0938)`.
- **Skipped Step 4 (`eraMatch`):** Diagnostic profiling showed near-zero class separation for release-decade matching (`pos8+ = 0.0003`, `pos9+ = 0.0005` vs `neg<=7 = -0.0018`, `poolNeg = -0.0011`), so `eraMatch` was intentionally omitted to preserve zero-bloat ranker weights (`public/models/ranker_weights.json` parity unchanged).

### Phase v5.2: Rating Studio 2.0, Contextual Film Chat, Deep Explore Workbench (`/explore`), Rabbit Hole Discovery & Side-by-Side Comparison (`/compare`)
- **Norm-Safe 64-D Vector Neighbors & Hybrid Similar Strip ([src/services/rabbitHoleService.js](./src/services/rabbitHoleService.js), [src/components/SimilarFilmsStrip.jsx](./src/components/SimilarFilmsStrip.jsx), [src/components/CollectionTimeline.jsx](./src/components/CollectionTimeline.jsx)):**
  - Extended on-device `CVEM v1` (`public/models/item_embeddings_f16.bin`) directly to `MovieDetails.jsx` via `findEmbeddingNeighborsForMovie`, dividing by `normA * normB` so Bayesian-shrunk vectors with sub-unit norms (`[0.30, 1.00]`) compute true cosine similarity without popularity-norm inflation.
  - `buildHybridSimilarFilms` merges local 64-D vector neighbors with TMDB `/recommendations` (or `/similar` fallback), tags cards with `matchOrigin: "hybrid" | "vault-vector" | "tmdb"`, preserves real `tt...` IMDb IDs, and demotes same-collection sequels already shown in `CollectionTimeline`.
- **Side-by-Side Film Comparison & 64-D Taste Match ([src/services/compareService.js](./src/services/compareService.js), [src/pages/ComparePage.jsx](./src/pages/ComparePage.jsx), [src/components/CompareDock.jsx](./src/components/CompareDock.jsx), [src/components/CompareModal.jsx](./src/components/CompareModal.jsx)):**
  - Compares up to 3 films side-by-side (`cinemavault_compare_v1` & `/compare?ids=...`) with column winner badges (`buildCompareMatrix`, preserving `0%` RT & `0` Metascore), shared cast/crew/genres/keywords, **Personal Taste Match %** (`vaultMatchPct` via `computeUserEmbedding` + `scoreItemsByEmbedding`), and pairwise 64-D `CVEM v1` cosine similarity (`pairVectorSims` in `computeCompareOverlap`).
- **Rating Studio 2.0, Spoiler-Safe Film Chat & Deep Explore Workbench ([src/services/ratingStudioService.js](./src/services/ratingStudioService.js), [src/services/filmChatService.js](./src/services/filmChatService.js), [src/services/exploreService.js](./src/services/exploreService.js), [src/pages/ExplorePage.jsx](./src/pages/ExplorePage.jsx)):**
  - Added live personal Vault percentile calibration & benchmark anchors (`computeVaultCalibration`), optional 4-aspect Craft Breakdown (`story`, `direction`, `acting`, `visuals`) & Watch Session Log (`format`, `rewatch`, `watchedDate`) with null-tombstone clearing (`buildWatchedRatingPayload({ markCleared: true })`), deep-linked spoiler-safe `"Discuss This Film"` chat (`serializeFilmDossierForPrompt`), and the URL-synced `/explore` filter workbench (`deriveExploreViewState` with 3-page `hideWatched` auto-advance).

### Phase v5.3: 250-Film Math-First Explore `"Movies You'll Like"`, Dual Flash-Lite Cascade & Public Launch Polish
- **Expanded 250-Film On-Device ML Explore Pool ([src/services/exploreForYouService.js](./src/services/exploreForYouService.js), [src/services/exploreForYouCache.js](./src/services/exploreForYouCache.js)):**
  - Powers `/explore?mode=for-you` with `EXPLORE_FOR_YOU_TARGET_COUNT = 250` (`EXPLORE_FOR_YOU_AI_BATCH_LIMIT = 100`, `EXPLORE_FOR_YOU_MIN_RATED = 3`) by loading all three local models (`item_embeddings_f16.bin` 25k `CVEM v1`, `content_embeddings_f16.bin`, and `dna` index) alongside personalized online-learned ranker weights (`derivePersonalizedRankerWeights`), multi-persona + ridge fold-in taste vectors, quadratic negative repulsion, `200`-item TMDB retrieval, and `160` aligned `CVEM v1` neighbors.
  - Progressive instant render (`onPreliminaryReady`) shows ~250 math-ranked films with deterministic `buildMathVibeTag()` editorial tags immediately, while a single Flash-Lite batch call refines the top `100` flagship picks in the background.
  - Cached locally for 7 days in IndexedDB (`cinemavault_explore_for_you_v1`, up to `300` items per `profileHash`, LRU-capped at `5` pools) and optionally synced per signed-in user to Postgres RLS table `public.user_explore_picks` (`<= 120` items; guests and `hasSampleData` sessions stay strictly local). Deep Filters and quality-weighted `Shuffle` run entirely client-side with `0` extra API requests and `48`-card pagination.
- **Dual Flash-Lite Resilience & Public Launch Guards ([api/gemini.js](./api/gemini.js), [api/_rateStore.js](./api/_rateStore.js), [src/services/geminiService.js](./src/services/geminiService.js), [src/services/debugFlags.js](./src/services/debugFlags.js)):**
  - Added live-verified `"gemini-3.1-flash-lite"` alongside `"gemini-3.5-flash-lite"` across `ALLOWED_GEMINI_MODELS`, `PUBLIC_CURATION_CASCADE`, `FAST_INTERACTIVE_CASCADE`, and `EXPLORE_FOR_YOU_CASCADE` (up to 1,000 free requests/day combined, `MINIMAL` thinking, `25s` batch timeout).
  - Separated clean Public Edition (default) from Personal/Debug Edition (`?debug=1` or `VITE_APP_EDITION=personal`), added optional browser-local personal Gemini keys (`cv_user_gemini_key`), optional Upstash Redis daily caps, and `"Try a sample vault"` onboarding (`sampleVaultService.js`, excluded from Supabase sync).

---

## 5. Every Error / Bug We Hit & How We Resolved It

| # | Error / Symptom We Observed | Root Cause | How We Fixed It | Where / Commit |
| :---: | :--- | :--- | :--- | :--- |
| **1** | Benchmark **Users `89` & `561` scored `0.000` NDCG@10** in early baselines | `89` had 50% of held-out films missing from the 9.6k index; `561`'s `rawCollabSim` (`0.05–0.35`) was drowned out by discrete genre/Bayesian ties pushing true matches to ranks `#11–#20` | Upgraded to 32M (`25k` films) + pool-relative `collabSim` scaling (`max > 0.05`) + `0.20x` metadata damping when collab exists; added 328 & 300 user suites | `74edffa`, [rankerService.js](./src/services/rankerService.js) |
| **2** | **`ml-user-263` & `ml-user-409` returned `0` personas & `0` `collabSim` scores** | Watch logs from 1999–2000 decayed to weights `1e-8 .. 3.15e-7`, falling below the hardcoded `<= 1e-6` weight cutoff | Switched to relative cutoff `1e-6 * maxAbsWeight` via `getRelativeWeightCutoff` | `7bf6a0b`, [embeddingService.js](./src/services/embeddingService.js#L181-L197) |
| **3** | **`263 / 328` users had loved keywords collide with `hatedKeywordIds`** | Broad tags (e.g. `independent film`, `based on novel`) appeared in both `>= 8★` and `<= 3★` watches; `-2.0` weight crushed good candidates & `hatedKeywordIds` wasn't sorted | Sorted `hatedKeywordIds` by descending score (`236e0f8`) and softened `negativeKeywordPenalty` from `-2.0` to **`-0.5`** (`332c21c`) | `236e0f8`, `332c21c`, [rankerService.js](./src/services/rankerService.js#L16) |
| **4** | **Letterboxd CSV imports dropped dates, saved URIs into `userNote`, accepted `2026-02-30`, & wiped ratings on blank rewatches** | Old importer ignored `Watched Date`/`Date`, fell back col 3 (`Letterboxd URI`) into `note`, JS `Date` silently rolled `2026-02-30` to March, bulk `Date` exports distorted recent decay, & blank rewatch rows overwrote stars | Extracted pure [src/services/csvImport.js](./src/services/csvImport.js): strict YMD calendar validator, `Watched Date` > `Date`, bulk-cluster suppression (`>= 10` rows / `>= 30%` top-3 / `< 14d`), & rewatch dedupe keeping newest date & latest non-empty rating | `2be4f3c`, `d095a48`, `0e2e2e3` |
| **5** | **Offline eval showed flat `bayesianRatingNorm` (`0.44` median) & skewed decay on dated vaults** | `ml-latest-small` had median `3` votes (`m = 500` pulled Bayesian scores to ~`7.0`); offline timestamps weren't anchored to `holdoutStartTs` | Anchored timestamps to each user's `holdoutStartTs` and enriched `9,620` real TMDB films for realistic vote counts | `.data/tmdb_eval_results.json` |
| **6** | **Pre-2024 cutoff + classics skew: `0` 2025–2026 releases entered Top 15** | MovieLens 32M stops around late 2023 (recent releases have `collabSim = 0`), while `collabSim ≈ 0.98` classics filled all 15 slots | Added **Bucket D** (18-month recent releases, `avg >= 7.0`, `votes >= 150`, max `12`) + **Reserve Lane** (`count = 2` in `"any"` shortlist) | `138f0d9`, `decbd56`, [tmdbService.js](./src/services/tmdbService.js#L664-L732) |
| **7** | **SPA HTML `index.html` fallback or wrong binary dims could break parser** | Vite SPA fallback can serve `HTTP 200 text/html` for missing `/models/...` routes | `loadDefaultEmbeddingIndex` & `loadDefaultContentIndex` reject `text/html` headers, check `"CVEM"` magic bytes, validate dims, and verify exact byte length | `f31ff54`, [embeddingService.js](./src/services/embeddingService.js) |
| **8** | **Gemini Free-Tier failures: `429` on `argon`, `8s` hang on `3.8-flash`, `400` on `thinkingBudget: 0`, ~25s abort on `hydrogen HIGH`, permanent session bans, & `ReferenceError`** | `argon` had `0` free quota; `3.8-flash` stalled; `3.5-flash-lite`/`hydrogen` reject `thinkingBudget: 0`; `25s` cut off ~24.9s `HIGH` calls; old code banned models forever on one 503; `lastError` wasn't defined in outer scope | Switched to `gemini-4-hydrogen` (`HIGH`/`MEDIUM`) + `3.5-flash-lite` ahead of `3.8-flash`; set `35s` Hydrogen & `10s` `3.8-flash` timeouts; added H1 error-specific cooldowns; fixed `lastError` scoping | `a47601b`, `74ed429`, `95ee2a6`, `1336dcc`, [geminiService.js](./src/services/geminiService.js) |
| **9** | **Reserve scorer (`count = 3`) bumped a `98%` classic for a `78%` non-genre match, and underrated `85%` Favorite Filmmaker films** | Old cold-start formula (`2.5x` Bayesian / `0.35x` genre) diverged from ranker weights & kept `noveltyBonus` asymmetry; `count = 3` reached too low in reserve candidates | `computeReserveQualityScore` calls `scoreCandidate` with identical weights and `noveltyBonus = 0`; reduced `RECENT_RELEASE_RESERVE_COUNT` from `3` to **`2`** | `decbd56`, [rankerService.js](./src/services/rankerService.js) |
| **10** | **`buildCollabSimMapFromIndex` wasted time re-sorting full `25k` vectors redundantly & false-negative `providerMatch` on discover buckets** | Discover queries with `with_watch_providers` lacked per-item `streamProviders` arrays until detail fetch, causing ranker to award `0` instead of `1` | Tagged `providerMatchedByQuery: true` during filtered Bucket A/B/C/D fetches and avoided redundant sorts in `buildCollabSimMapFromIndex` | `4b6e7c7`, `f34396f` |
| **11** | **Buckets B/C/D/E & `rankCandidatePool` ignored Mood selection (e.g., Horror appearing in `Comfort Watch` or blockbusters dominating `Hidden Gem`)** | Mood only tweaked Bucket A TMDB params while `collabSim = 4.8` & `0.20x` metadata damping kept global vault favorites at rank #1..#15; Reserve slots kept overriding legacy/obscure filters | Created canonical [moodPolicy.js](./src/services/moodPolicy.js), switched explicit moods to `collabSim * 0.35`, `1.0x` metadata, `computeMoodScoreAdjustment`, & `matchesMoodCandidateGate`, skipped Bucket D in `hidden-gem`/legacy era, disabled reserve under mood, & capped Bucket E to `15` mood-gated neighbors | `22055ce..f089828`, [moodPolicy.js](./src/services/moodPolicy.js), [rankerService.js](./src/services/rankerService.js) |
| **12** | **Streaming filters missed TMDB ad-tier / Amazon-channel IDs & region switches served stale cached picks** | TMDB assigns separate provider IDs for ad tiers & channels (e.g. `1796` Netflix Ads, `1825` Max Channel), and `generateProfileHash` excluded `userRegion` & `moodFilters` | Added `PROVIDER_FAMILY_MAP` (13 alias groups) + `expandProviderIds` + `matchesWatchProviders` strict sorting, and expanded `generateProfileHash` to 6 args with `buildMoodFilterHashSegment` + `_reg_<REGION>` | [tmdbService.js](./src/services/tmdbService.js), [geminiService.js](./src/services/geminiService.js) |
| **13** | **"Match Vibe" failed offline & Refresh repeated the exact same 6 cards** | Free-text parser returned `null` offline/keyless and closure state lagged in React; refresh re-ran the identical TMDB page `1` with no exclusions and capped output at `6` | Added `parseFreeTextMoodFallback`, override args in `handleGetRecommendations`, **`DEFAULT_RECOMMENDATION_COUNT = 10`**, `MIN_VALID_CACHE_COUNT = 7` in `cinemavault_smart_cache_v4`, & `nextRefreshExcludeState` (`120` IDs, pages `1..5`) + exhaustion padding guard | [oracleViewHelpers.js](./src/services/oracleViewHelpers.js), [MovieRecommendations.jsx](./src/components/MovieRecommendations.jsx) |
| **14** | **Client production bundle risked exposing API secrets & cross-ID duplicates skipped Vault collision checks** | Vite `VITE_*` vars embed in `build/assets/*.js`; `tmdb_123` vs `tt...` caused Hero/Home/Vault duplicates & silent `5★`/`7★` fake CSV ratings | Added `/api/{gemini,tmdb,omdb}` Vercel proxies + `apiTransport.js`, canonical `movieIdentity.js` (`isSameMovie`), `vaultPortability.js` (`0` rating preservation), & opt-in Supabase RLS sync | [api/](./api), [apiTransport.js](./src/services/apiTransport.js), [movieIdentity.js](./src/services/movieIdentity.js), [vaultPortability.js](./src/services/vaultPortability.js) |
| **15** | **Pre-2024 OMDb/CSV movies lacked `tmdbId` & keywords (hiding indexed favorites from embeddings), TV shows risked movie-ID collision, & `tmdb_...`/`tt...` imports duplicated entries** | Legacy imports saved only `imdbID` (or un-enriched Quick Rate entries); untyped series (`2017–2020`) lacked `/3/find` TV guards; `summarizeImportDiff` used single-key maps & batch fetches looped past `429` | Added series-guarded `backfillMissingTmdbIds` (`maxItems: 40`, `maxLookups: 15`, strict `±1`-year lookup, `tv_results` skip, `"N/A"` poster guard), `AppContext` deferred mount backfill + `addWatched` hydration, `MovieDetails` `isSeriesVaultItem` guard, `apiTransport` `429` stop, & `isSameMovie` dedupe in `summarizeImportDiff` | [tmdbService.js](./src/services/tmdbService.js), [AppContext.jsx](./src/context/AppContext.jsx), [MovieDetails.jsx](./src/components/MovieDetails.jsx), [vaultPortability.js](./src/services/vaultPortability.js), [apiTransport.js](./src/services/apiTransport.js) |
| **16** | **Gemini curation dropped `5★` relative dislikes (e.g., *Parasite*, *Spirited Away*), ignored `userNote` cache updates, omitted `userStats`/`topDirectors`/`Watchlist`/candidate themes & cast, and truncated plots at 140 chars** | `buildMovieIdentityLookup` checked flat `item.tmdbId` instead of nested `weightedRatings[].movie`, `buildWatchedHashSegment` excluded `userNote`, `mergeBackfilledMovieMetadata` dropped `cast`/`tagline`/`language`/`runtime`, & candidate formatter omitted hydrated TMDB fields | Fixed nested `{ movie, weight, zScore }` lookup, hashed `userNote` into `vlt_` cache keys, preserved `cast`/`writers`/`tagline`/`originCountry`/`spokenLanguages`/`mpaaRating`/`runtimeMinutes`/`keywordNames`/`overview`, wired `userStats`+`topDirectors`+`[Series]`+`USER'S WATCHLIST`+`180`-char notes, added `< 18,000`-char compact candidate blocks + `#1–#15`/`#16–#30` balance rules, & shared praise/critique `quickReviewTags.js` across `QuickRateModal` (`maxLength=200`) & `MovieDetails` | [geminiService.js](./src/services/geminiService.js), [tmdbService.js](./src/services/tmdbService.js), [quickReviewTags.js](./src/services/quickReviewTags.js), [QuickRateModal.jsx](./src/components/QuickRateModal.jsx), [MovieDetails.jsx](./src/components/MovieDetails.jsx) |
| **17** | **Gemini curation felt overly restricted (`Match: XX%` & `#1–#15` anchoring, narrow Top-30 pool, <=10 favorites, dropped series/extra notes, and no outside film escape hatch)** | Rank percentages and `#1–#15` wording anchored Gemini to math order; Top-30 cut off diverse/2024–2026 picks; only 10 favs + notes inside anchors were visible; outside picks risked hallucinations | Removed `Match: XX%` and `#1–#15` bias (`"Curate openly"`) while keeping calibrated `matchScore` locking; added 39-pick `buildDiversifiedGeminiShortlist` (`25+8+6`), `buildExtendedVaultContextSections` (`ADDITIONAL TOP FAVORITES` 11–25, `LOVED SERIES / ANIME`, all remaining `userNote`s `<= 20,000` chars), & TMDB/vault/provider/mood-verified 0–2 `wildcardPicks` (`verifyAndScoreWildcardPicks`) with 10/10 auto-backfill | [geminiService.js](./src/services/geminiService.js), [rankerService.js](./src/services/rankerService.js), [tmdbService.js](./src/services/tmdbService.js) |
| **18** | **v5.2 Research Hub edge cases: shrunk-vector popularity bias in `findEmbeddingNeighborsForMovie`, resurrected Craft Breakdowns in `upsertMovieEntry`/cloud sync, `%2520` keyword routes & `hideWatched` blank page 1 in `/explore`, and `0%` RT / `_notFound` slot bugs in `/compare`** | Bayesian-shrunk `CVEM v1` vectors have norms in `[0.30, 1.00]` so raw dot product favored high-norm blockbusters; shallow spread kept old `ratingBreakdown`/`watchMeta` when cleared; manual `encodeURIComponent` inside `URLSearchParams` double-encoded spaces; `Number("0") \|\| null` dropped `0%` RT/Metascore | Divided by `normA * normB` in `findEmbeddingNeighborsForMovie`; emitted `markCleared: true` `null` tombstones stripped by `upsertMovieEntry` & honored by `mergeLocalAndCloudVault`; removed double encoding & added `deriveExploreViewState` (`autoAdvanceCap = 3`); preserved `0%` RT / `0` Metascore & cross-scheme `removeUrlCompareSlot` in `compareService.js` | [rabbitHoleService.js](./src/services/rabbitHoleService.js), [ratingStudioService.js](./src/services/ratingStudioService.js), [exploreService.js](./src/services/exploreService.js), [compareService.js](./src/services/compareService.js) |
| **19** | **Clicking a movie card showed a stuck floating poster ghost over the loading screen / Metacritic cards, and left the Movie Detail poster invisible (`opacity: 0`)** | Legacy imperative `posterFlight.js` cloned poster nodes onto `document.body` and mutated `.netflix-modal-poster-wrap` inline `opacity` inside `useEffect`; React 18 StrictMode double-mounted the effect while `opacity` was `"0"`, overwriting `prevOpacity` with `"0"` so cleanup restored `"0"` permanently | Disabled the imperative DOM ghost in `posterFlight.js`, removed `capturePosterFlight`/`consumePosterFlight` calls from `MovieCard.jsx` & `MovieDetailEffects.jsx`, and replaced `<PosterArrival />` with a direct GPU Framer Motion entrance on `.netflix-modal-poster-wrap` in `MovieDetails.jsx` | [posterFlight.js](./src/services/posterFlight.js), [MovieDetails.jsx](./src/components/MovieDetails.jsx), [MovieCard.jsx](./src/components/MovieCard.jsx) |
| **20** | **Explore `"Movies You'll Like"` pool felt small (~100 films, only ~12 Sci-Fi), skipped full `CVEM v1` / DNA / personalized ranker wiring initially, and pushed header buttons right on mode switch** | Initial pool targeted 100 items, waited on Gemini before showing results, and rendered `Shuffle`/`Refresh` conditionally right beside the centered mode toggle causing horizontal layout shift | Scaled `EXPLORE_FOR_YOU_TARGET_COUNT = 250` with full `CVEM v1` + Content + DNA + personalized logistic ranker + `160` embedding neighbors + `onPreliminaryReady` instant render + 48-card pagination + dedicated zero-shift 2-band `.explore-mode-toolbar` (`0px` shift) | [exploreForYouService.js](./src/services/exploreForYouService.js), [ExplorePage.jsx](./src/pages/ExplorePage.jsx) |
| **21** | **Horizontal carousel wheel scrolling hijacked vertical page scrolling, and Discover rows leaked unreleased future titles or failed transiently on cold load** | Global wheel listener intercepted vertical scroll whenever cursor crossed a row; Discover TMDB queries lacked an upper release-date ceiling and ran unbounded parallel requests without retry | Switched to opt-in smooth wheel engagement (`"Scroll row"` pill / border click / `Shift + Wheel` with `pointerleave` + outside-click + `Esc` release) via `useHorizontalWheelScroll.js` & `scrollHelpers.js`; added `primary_release_date.lte: todayIso` (`releaseGuardVersion: 2`), `3`-lane concurrency cap, & single retry in `dashboardService.js` | [useHorizontalWheelScroll.js](./src/hooks/useHorizontalWheelScroll.js), [scrollHelpers.js](./src/services/scrollHelpers.js), [dashboardService.js](./src/services/dashboardService.js) |
| **22** | **Prefixed `cinemavault_home_feeds_v2::*` cache entries escaped `localStorage` quota eviction, and demo sample vault data risked leaking into Supabase** | Exact-key purge order missed dynamic `cinemavault_home_feeds_v2::` suffixes; sample rows needed explicit exclusion from cloud vault & `user_explore_picks` upserts | Extracted `storageEviction.js` (`STORAGE_PURGE_ORDER` with prefix sweep for `cinemavault_home_feeds_v2::`) and excluded `isSample` / `hasSampleData` sessions from Supabase sync & cloud For You cache | [storageEviction.js](./src/services/storageEviction.js), [exploreForYouCache.js](./src/services/exploreForYouCache.js), [vaultSyncService.js](./src/services/vaultSyncService.js) |
| **23** | **Rating Studio hover preview leaked into save state & Explore lacked direct title/franchise search** | Ephemeral hover state needed strict separation from committed bar selection (`selectedScore`) and calibration card layout height varied dynamically | Upgraded `StarRatingStage` to an ascending 10-bar cinema fader with explicit click-to-lock (`Select Rating (1–10)` → `Save X/10 to Vault`), fixed 2-col calibration strip, progressive review disclosure, and added `?q=` Explore title search + `SearchModal` bridge | [StarRatingStage.jsx](./src/components/StarRatingStage.jsx), [MovieDetails.jsx](./src/components/MovieDetails.jsx), [exploreService.js](./src/services/exploreService.js), [SearchModal.jsx](./src/components/SearchModal.jsx) |

---

## 6. How to Check Everything Yourself (EZ Verification Commands)

Run any of these from the project root (`g:\Important Projects\movie-ratings`):

### Check 1: Run the Offline Service & API Test Suite (`npm test`)
```bash
npm test
```
**What "healthy" looks like:**
- Exits `0` with all service and API test suites passing (`fail 0`, `skipped 0`), covering:
  - `tests/aiSpendTracker.test.js`
  - `tests/apiProxy.test.js`
  - `tests/appStorage.test.js`
  - `tests/authService.test.js`
  - `tests/backgroundJobService.test.js`
  - `tests/chatCardHelpers.test.js`
  - `tests/chatErrors.test.js`
  - `tests/communityService.test.js`
  - `tests/compareService.test.js`
  - `tests/contentSim.test.js`
  - `tests/csvImport.test.js`
  - `tests/dashboardService.test.js`
  - `tests/debugFlags.test.js`
  - `tests/dnaService.test.js`
  - `tests/docsHygiene.test.js`
  - `tests/embeddingService.test.js`
  - `tests/embeddingStep3.test.js`
  - `tests/embeddingWorkerClient.test.js`
  - `tests/evalHarness.test.js`
  - `tests/evalRanker.test.js`
  - `tests/exploreForYouCache.test.js`
  - `tests/exploreForYouService.test.js`
  - `tests/exploreForYouStreaming.test.js`
  - `tests/exploreService.test.js`
  - `tests/feedbackLogging.test.js`
  - `tests/filmChatService.test.js`
  - `tests/geminiDualEngine.test.js`
  - `tests/geminiKeyStorage.test.js`
  - `tests/layoutRegression.test.js`
  - `tests/moodPolicy.test.js`
  - `tests/moodRanker.test.js`
  - `tests/movieIdentity.test.js`
  - `tests/navHelpers.test.js`
  - `tests/oracleViewHelpers.test.js`
  - `tests/personService.test.js`
  - `tests/pipelineBugs.test.js`
  - `tests/quickReviewTags.test.js`
  - `tests/rabbitHoleService.test.js`
  - `tests/rankerService.test.js`
  - `tests/rankerStep2.test.js`
  - `tests/ratingStudioService.test.js`
  - `tests/ratingTiers.test.js`
  - `tests/recentReleaseSlots.test.js`
  - `tests/sampleVaultService.test.js`
  - `tests/scoringUtils.test.js`
  - `tests/scrollHelpers.test.js`
  - `tests/searchService.test.js`
  - `tests/secretsGuard.test.js`
  - `tests/selectPrimitive.test.js`
  - `tests/siteUrl.test.js`
  - `tests/tasteDeckService.test.js`
  - `tests/tasteMatchService.test.js`
  - `tests/tasteRulesService.test.js`
  - `tests/tmdbRabbitHoleHelpers.test.js`
  - `tests/vaultPortability.test.js`
  - `tests/vaultStats.test.js`
  - `tests/vaultSyncService.test.js`

### Check 2: Verify Production Vite Bundle & Zero Secret Leaks
```bash
npm run build
```
**What "healthy" looks like:**
- Exits `0`, transforms **`2359 modules`**, emits vendor-split JS chunks (`index-*.js` ~420 kB, plus lazy `vendor-supabase`, `vendor-genai`, and `embeddingWorker-*.js`) and route-scoped CSS into `build/assets/...`, and copies `public/models/item_embeddings_f16.bin` into `build/models/item_embeddings_f16.bin`.
- When built with server-only API secrets (`GEMINI_API_KEY`, `TMDB_API_KEY`, `OMDB_API_KEY` on Vercel without `VITE_*` client keys), `build/assets/*.js` contains zero API keys (routes go through `/api/gemini`, `/api/tmdb`, `/api/omdb`).

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
**Verified output on current `main` (`--benchmark` against `public/models/item_embeddings_f16.bin`):**
- `ml-user-263`: `Recall@20 = 0.533`, `NDCG@10 = 0.322`, `Novelty = 1.763` (vs popularity `0.067 / 0.010`)
- `ml-user-409`: `Recall@20 = 0.467`, `NDCG@10 = 0.391`, `Novelty = 2.692` (vs popularity `0.200 / 0.109`)
- `ml-user-561`: `Recall@20 = 0.000`, `NDCG@10 = 0.000`, `Novelty = 2.458`
- `ml-user-89`: `Recall@20 = 0.000`, `NDCG@10 = 0.000`, `Novelty = 1.911` (`vault emb cov 60/98`)
- **4-vault mean:** **`NDCG@10 = 0.178`, `Recall@20 = 0.250`, `Novelty = 2.206`** (with `clean2` `>= 8★` rolling mean `NDCG@10 = 0.1776`, `AUC9v7 = 0.7265`, and `>= 9★` `NDCG@10 = 0.2258`, `Recall@20 = 0.3333`) — clearing the earlier Nov 11 32M milestone (`0.143 / 0.242 / 2.24`) and well above the `9.6k` small baseline (`0.062 / 0.083 / 1.48`).

**Additional evaluation-only experiment scripts (no production defaults changed):**
- **Warm vs. cold partial-mask harness:** `scripts/experiments/run_ablation.mjs` accepts `--mask-frac <0..1>` and `--mask-seed <int>` (powered by `scripts/experiments/mask_eval_utils.mjs`) to mask candidate-side `collabSimMap` / `repulsionMap` entries after building full-index user taste vectors so masked films take the `coldOnly` structured fallback; run the full sweep via `node scripts/experiments/run_partial_mask_eval.mjs` -> `scripts/experiments/results/partial_mask_eval.{json,md}`.
- **Isolated Bucket E recall sweep:** `node scripts/experiments/bucket_e_recall.mjs` evaluates `retrieveAlignedEmbeddingNeighbors` across `topK ∈ {15, 30, 45, 60, 80, 100, 150}` against `328` and `fresh_300` (`>=8★` and `>=9★`) in isolation (without TMDB Buckets A–D) and writes `scripts/experiments/results/bucket_e_recall.{json,md}`.
- **Schema v2 vault cold-share audit:** `node scripts/experiments/vault_cold_share.mjs --vault <backup.json> [--exclude-series]` reports by watch year the share of `>=8★` entries absent from `public/models/item_embeddings_f16.bin` or released after the MovieLens 32M index cutoff (`2023-10-13`), with `--exclude-series` (`isSeriesVaultItem`) isolating true movie-only coverage.

### Check 5: Retrain or Regenerate the Local `.bin` Model (Only When Updating MovieLens Data)
```bash
python scripts/colab_train_embeddings.py --ml-dir .data/ml-32m --out public/models/item_embeddings_f16.bin --max-items 25000 --dim 64 --shrink 0.5 --holdout-users 89,263,409,561
```
Built-in safety gates in [scripts/colab_train_embeddings.py](./scripts/colab_train_embeddings.py):
- Automatically strips holdout windows for benchmark users (`--holdout-users`) before computing SVD.
- Refuses to overwrite the binary if offline SVD `Recall@20` fails to beat MovieLens popularity.
- Post-write validates exact byte size, `CVEM` v1 header, and verifies every written ID is a valid integer `tmdbId` from `links.csv`.

### Check 6: Live In-Browser DevTools Smoke Test (`npm start`)
1. Run `npm start` (or `vercel dev` if using server-side `.env` without `VITE_*` keys) and open **`http://localhost:3000`** (`vite.config.js` configures `port: 3000`).
2. Open DevTools → **Network** tab → open **Oracle** (`/ai`):
   - Confirm `/models/item_embeddings_f16.bin` loads with HTTP `200` (`3,300,016 B`, once per session).
   - Confirm **`10`** recommendation rows render (`DEFAULT_RECOMMENDATION_COUNT = 10`) with deterministic rankings, `"Because you rated"` anchor chips (`resolveRecommendationAnchors`), clean jargon-free reasons, and `"About these picks"` model attribution.
   - Switch **Mood** (e.g., `Comfort Watch` vs `Dark Thriller`) or use **Match Vibe** (`"like Drive but quieter"`) and verify picks adapt cleanly without off-tone classics overriding the mood; click **Refresh** to confirm new picks rotate without immediate repeats (`1..5` page rotation).
3. Open DevTools → **Application → LocalStorage** and inspect active state keys:
   - `cinemavault_smart_cache_v4` — 24h LRU recommendation cache (`500KB` cap, `>= 7` valid uncollided picks required, region- & mood-filter-scoped hashes).
   - `cinemavault_working_model_curation_v1` & `cinemavault_working_model_fast_v1` — persisted healthy Gemini model hints (`30 min` TTL).
4. **Offline / Quota Fallback Test:** Temporarily clear/invalidate Gemini credentials (or simulate quota) and click Refresh — verify CinemaVault seamlessly serves the **top `10`** mathematical ranker picks (`pipeline: "ranker-fallback"`) and falls back cleanly on free-text queries via `parseFreeTextMoodFallback`.

### Check 7: Optional Supabase Cloud Vault Sync Verification (When Configured)
1. Ensure `.env.local` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and verify [supabase/migrations/20261114000000_init_cinemavault_schema.sql](./supabase/migrations/20261114000000_init_cinemavault_schema.sql), [supabase/migrations/20261120000000_explore_for_you_cache.sql](./supabase/migrations/20261120000000_explore_for_you_cache.sql), and [supabase/migrations/20261120120000_profile_prefs_and_for_you_cap.sql](./supabase/migrations/20261120120000_profile_prefs_and_for_you_cap.sql) are applied on your Supabase project (`profiles` with `taste_rules`, `user_vault_items`, and `user_explore_picks` up to 260 items exist with RLS enabled and `anon` revoked).
2. In Supabase Dashboard → **Authentication → URL Configuration**, add your production domain and `http://localhost:3000` under **Redirect URLs** so magic-link OTP redirects work across environments.
3. Click the `NavBar` utility menu → **Cloud Sync**, sign in via Email Magic Link, and verify signed-in status transitions to **Synced** with rows populated under your `auth.uid()` inside `public.user_vault_items`.
