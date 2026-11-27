# GameVault — Local ML Architecture, Math & Engineering Guide

**Last Updated:** November 28, 2026 (`GameVault v1.2`)  
**Status:** Production-ready · Verified by `npm test`, `npm run build`, and live IGDB + browser verification.

This document is the complete standalone technical reference for **GameVault** — how its local client-side machine learning models were built and trained separately from CinemaVault's movie models, every mathematical formula running in the browser, how it handles console exclusives and `2024–2026` cold-start releases, how PC rig/hardware awareness works, and every ML and product bug we caught and fixed along the way.

For CinemaVault's movie recommendation math, see **[LOCAL_MODEL_GUIDE.md](./LOCAL_MODEL_GUIDE.md)** and **[MODEL_REFINEMENT_LOG.md](./MODEL_REFINEMENT_LOG.md)**.

---

## 1. CinemaVault (Movies) vs. GameVault (Games) — What We Built Differently

Games are **not** movies. Treating Steam playtime logs or multi-platform releases like 2-hour MovieLens ratings fails immediately because:
1. A player can spend **150 hours** in a game and still leave a frustrated negative review ("salty high-hour review").
2. Major franchises (*Bloodborne*, *The Legend of Zelda: Tears of the Kingdom*, *Shadow of the Colossus*, *God of War Ragnarök* on launch) are **PlayStation/Nintendo console exclusives** with **zero** Steam collaborative rows.
3. Popular games frequently exist as **3–5 duplicate editions** (*Original*, *GOTY*, *Definitive Edition*, *Anniversary Edition*, *Remastered*).
4. Players have **hardware constraints** (a GTX 750 Ti PC cannot run heavy 2025 AAA releases, whereas a PS5 or RTX 4080 can).

Because of this, GameVault was architected as a **completely isolated ML stack, storage layer, and API pipeline** sharing only the top-level navigation shell and binary parser primitives (`CVEA v1` / `CVEM v1`):

| Dimension | CinemaVault (Movies) | GameVault (Games) |
| :--- | :--- | :--- |
| **Canonical ID Space** | TMDB integer ID (`tmdbId`) + IMDb `tt...` | **IGDB v4** integer ID (`igdbId`, `version_parent`-resolved to base games) |
| **Metadata API** | TMDB v3 + OMDb (`/api/tmdb`, `/api/tmdb-batch`, `/api/omdb`) | **IGDB v4** via Twitch OAuth (`/api/igdb` + Vite local dev middleware) |
| **Interaction Dataset** | MovieLens 32M (`1–5★` explicit ratings, 200k users) | **Steam Recommendations** (`antonkozyriev/game-recommendations-on-steam`, signed thumb + `log1p(hours)`) + **FronkonGames / atalaydenknalbant 2026** community tags |
| **Exact Sparse EASE^R (`CVEA v1`)** | `item_ease_k64.cvea` (`14,000 × 64`, `3.47 MB`, `λ = 800`, column `γ = 0.12`) | **`game_ease_k80.cvea`** (`14,656 × 80`, `4.53 MB`, `λ = 5000`, **source-side** `pop_alpha = 0.30`, `neg_w = -0.35`) |
| **Dense Collab Matrix (`CVEM v1`)** | `item_embeddings_f16.bin` (`25,000 × 64-D` Truncated SVD, `3.15 MB`) | **`game_embeddings_f16.bin`** (`14,656 × 64-D` **Spectral-EASE** via `eigh` on symmetrized normalized EASE, `1.84 MB`) |
| **Neural Semantic Cold-Start** | `content_embeddings_f16.bin` (`11,119 × 128-D` `all-MiniLM-L6-v2` PCA, `coldOnly: true`, `2.76 MB`) | **`game_content_f16.bin`** (`24,439 × 128-D` **Tag-Dropout Ridge-Aligned `BAAI/bge-large-en-v1.5`**, `w = 0.75`, `6.06 MB`) — covers **all** Steam titles + PlayStation/Nintendo exclusives + `2024–2026` releases |
| **Live Taste Tuner Axes** | Mood pills + Free-text Match Vibe | **`game_tuner_axes.json`** (`128-D` popularity-decorrelated linear probes: `Intensity` AUC `0.968`, `Tone` AUC `0.996`, `Era`, `Familiarity`, `Break My Bubble` — `< 1 ms` re-ranking) |
| **Rating Signal Model** | Z-scored stars + rating-tiered recency decay | Z-scored `1–10` ratings + **log-damped playtime boost** + completion status (`completed`/`platinum`/`playing`/`dropped`) + **salty high-hour negative review guard** |
| **Hardware & Platform Awareness** | Streaming providers & country region | **First-visit Rig & Spec Onboarding Wizard** (`gameRigService.js`: PC/PS/Nintendo/Xbox + auto WebGL GPU tier `entry`/`mid`/`high` + `My Rig` filter) |
| **Local Persistence** | `localStorage` + IndexedDB TMDB cache | Isolated IndexedDB **`gamevault_vault_v1`** + **`gamevault_igdb_cache_v1`** (14-day TTL) + `localStorage` rig profile (`gamevault_rig_profile_v1`) |
| **Cloud Sync Table** | `public.user_vault_items` (RLS) | Isolated **`public.user_games`** (RLS, migration `20261127000001_user_games_schema.sql`) |
| **Bundle Impact on Movies** | Entry bundle unaffected | **0 KB** on Movies routes (`GameVaultApp.jsx`, `games.css`, and `public/models/games/*` are 100% lazy-loaded on `/games*` and `/game/:id`) |

---

## 2. Offline GPU Training Pipeline (`scripts/games/train_games_colab.ipynb`)

All six files in `public/models/games/` were trained end-to-end on Google Colab (Tesla T4 High-RAM) in a strictly leakage-clean chronological evaluation setup.

### 2.1 Canonical Catalog & Steam-to-IGDB Crosswalk (`18,144` Games)
- **Catalog Base:** Canonical IGDB v4 games filtered to real playable releases (`version_parent = null` and `game_type in (0, 4, 8, 9, 10)` — main games, standalone expansions, remakes, remasters, expanded games; excluding DLCs, bundles, mods, and episodes).
- **Recursive Parent Resolution:** Any Steam AppID that pointed to an IGDB regional/GOTY edition (`version_parent != null`) was recursively collapsed to its canonical base `igdb_id`, producing `public/models/games/game_steam_to_igdb.json` (`18,144` exact mappings, `284,040 B`). This directly powers one-paste Steam AppID library imports in `/games/vault`.

### 2.2 Signed Playtime-Weighted Interaction Matrix
Unlike binary click matrices or MovieLens star ratings, Steam reviews encode both sentiment (`is_recommended`) and depth of engagement (`hours`):
- Positive reviews receive log-damped playtime weighting so a 60-hour completion carries more signal than a 1-hour refund without letting 2,000-hour multiplayer outliers dominate a user's profile.
- Negative reviews receive signed weight **`neg_w = -0.35`** (swept cleanly on Dev-500), with a guard so high-hour negative reviews don't corrupt collaborative neighborhoods.

### 2.3 Exact Full-Rank Sparse EASE^R (`game_ease_k80.cvea`)
For the `14,656` warm games with sufficient Steam interaction support, we solved full-rank closed-form EASE^R on GPU:

$$G = X^\top X, \qquad P = (G + \lambda I)^{-1}, \qquad B = -P \cdot \operatorname{diag}(P)^{-1}, \qquad \operatorname{diag}(B) = 0$$

with **`λ = 5000.0`** (higher regularization than MovieLens's `λ = 800` because Steam playtime interactions are sparser and heavier-tailed than MovieLens ratings).

- **Asymmetric Source-Side Popularity Damping (`pop_alpha = 0.30`):**
  Before pruning each source item to its top `K = 80` outgoing neighbors, we apply **source-side** degree normalization `B.mul_(inv_pow.unsqueeze(1))` (not column-side!) so mega-popular evergreen titles (*CS2*, *GTA V*, *Terraria*) don't drown out mid-tier genre anchors when a player has both in their vault.
- **Compact Storage:** Stored in `CVEA v1` (`14,656 × 80`, `uint16` neighbor index + `float16` weight = `4,748,560 B` / `4.53 MB`).

### 2.4 Spectral-EASE (`game_embeddings_f16.bin`)
Instead of a separate Truncated SVD pass, we extract the top **`64` dense eigenvectors** (`eigh`) of the symmetrized normalized EASE matrix (`14,656 × 64-D`, `float16` `CVEM v1`, `1,934,608 B` / `1.84 MB`). This provides:
- Smooth dense generalization across all `14,656` warm games (even when a candidate sits outside an item's top-80 EASE edges).
- Disliked-game repulsion vectors (`buildRepulsionMapFromIndex`) so games rated `<= 4/10` push away similar titles in dense 64-D space.

### 2.5 Tag-Dropout Ridge-Aligned `BAAI/bge-large-en-v1.5` (`game_content_f16.bin`)
**The Core Cold-Start Problem:**  
Steam games have rich community tags (`Soulslike`, `Metroidvania`, `Deckbuilder`, `Choices Matter`), whereas PlayStation/Nintendo exclusives (*Bloodborne*, *Zelda: Tears of the Kingdom*, *Uncharted 4*) and brand-new `2024–2026` releases only have **IGDB metadata** (title, genres, themes, game modes, player perspectives, keywords, developer, summary). If you naively align `BGE-large(IGDB + Steam Tags)` to Spectral-EASE via Ridge regression, the linear map overfits to Steam tags and degrades on tagless console exclusives!

**Our Solution — Tag-Dropout Ridge Alignment (`gamma = 3.0`, `w = 0.75`):**
1. Encode **all `24,439` games** using [`BAAI/bge-large-en-v1.5`](https://huggingface.co/BAAI/bge-large-en-v1.5) (`1024-D`) across **two views** for Steam games: full text (`IGDB + Steam tags`) and IGDB-only text (`tags dropped`), plus IGDB-only text for all non-Steam console exclusives and `2024–2026` releases.
2. Fit an L2-regularized Ridge alignment projector (`gamma = 3.0`) trained with **Tag-Dropout** (forcing IGDB-only text embeddings to map accurately into the collaborative Spectral-EASE space).
3. Blend **`75%` collaborative-aligned projection + `25%` pure semantic BGE PCA** into a single L2-normalized **`128-D`** vector per game (`24,439 × 128-D`, `float16` `CVEM v1`, `6,354,156 B` / `6.06 MB`).

**Result on `2,199` True Held-Out Cold-Start Games:**
- Pure BGE-PCA `NDCG@20`: `0.0516` → **Tag-Dropout Aligned Hybrid `NDCG@20`: `0.0535` (`+3.68%`)**
- **Cold-Start `Recall@20`: `0.1145` (`+9.05%` relative lift)** — enabling accurate scoring for *Bloodborne*, *God of War Ragnarök*, *Shadow of the Colossus*, *Hades II*, *Kingdom Come: Deliverance II*, and *Clair Obscur: Expedition 33* with zero Steam rows.

### 2.6 Popularity-Decorrelated Neural Taste Tuner Probes (`game_tuner_axes.json`)
To let players steer recommendations in **`< 1 ms`** using live sliders (`Intensity: Cozy/Chill ↔ High-Octane Action`, `Tone: Dark/Horror ↔ Warm/Playful`), we trained `128-D` linear probes over `game_content_f16.bin` and **projected out the popularity direction** so sliding a dial never accidentally boosts blockbusters or indie obscurity:
- **`intensityVec` (`pacingVec`):** Held-out **ROC-AUC = `0.968`**, popularity correlation **`0.0000`**.
- **`toneVec`:** Held-out **ROC-AUC = `0.996`**, popularity correlation **`0.0000`**.
- Stored as a tiny **`3,303 B`** JSON file (`public/models/games/game_tuner_axes.json`).

---

## 3. Verified Offline Evaluation Metrics (`public/models/games/game_ranker_weights.json`)

Evaluated on strictly chronological user holdouts (`500` Dev users + `500` completely untouched Test users, zero leakage):

| Split / Cohort | Popularity `NDCG@20` | `EASE-80` `NDCG@20` | Hybrid Fusion `NDCG@20` | Fusion `Recall@20` | Coverage `@20` | Paired Bootstrap (`Fusion − Pop` `95%` CI) |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`DEV-500` (Warm Chronological)** | `0.0306` | `0.0915` | **`0.0917`** (`+199.6%`) | **`0.1382`** (`+175.8%`) | `11.48%` *(vs `0.24%` pop)* | — |
| **`TEST-500` (Untouched Holdout)** | `0.0307` | `0.0822` | **`0.0826`** (`+169.0%`) | **`0.1191`** (`+146.4%`) | `11.42%` *(vs `0.25%` pop)* | **`+0.0519`** (`[0.0407, 0.0632]`, **sig+**) |
| **True Cold-Start (`2,199` Unseen Games)** | `Pure BGE-PCA`: `0.0516` | — | **`Tag-Dropout Aligned`: `0.0535`** (`+3.68%`) | **`0.1145`** (**`+9.05%` Recall**) | Full `24,439` catalog | Zero-interaction console & 2024–2026 coverage |

Synced Colab v1.1 blend weights stored in `public/models/games/game_ranker_weights.json`:
`ease = 0.6452`, `collab = 0.1075`, `content = 0.2151`, `popularityPrior = 0.0323`.

---

## 4. Client-Side Browser Math Engine (`src/games/services/gameRankerService.js`)

All personalized scoring runs **100% locally in the browser** (`$0.00` API cost) and is memoized across route transitions by vault signature (`buildVaultSimSignature`):

### 4.1 Weighted Player Preference Encoding (`buildWeightedGameRatings`)
Each logged game `(rating r, hoursPlayed h, status s)` maps to a signed weight `w`:
1. **Log-damped playtime multiplier:**
   $$\text{playBoost}(h) = \operatorname{clamp}\big(0.88 + 0.12 \cdot \log_{10}(1 + h),\; 0.85,\; 1.25\big)$$
   (defaults to `1.0` when playtime is unlogged so zero-hour imports aren't penalized).
2. **Per-user z-score & tier curve:**
   - `r >= 7`: `z = max(0, (r - min(meanR, 7.5)) / max(stdR, 0.8))`, `w = (0.75 + 0.25*(r - 6) + 0.35*z) * playBoost`
   - `r == 6`: `w = 0.28 * playBoost`
   - `r <= 4`: **Salty high-hour guard** — if `h >= 60`, `w = -0.15` (avoids nuking a beloved genre over a burnout review); otherwise `w = -0.75 * (1 + (4 - r)*0.2)`.
   - Unrated `completed` / `playing`: `w = 0.9 * playBoost`; unrated `dropped`: `0.0` if `h >= 50` else `-0.45`.
   - Completion bonus: `completed` / `platinum` positive weights receive `× 1.08`.

### 4.2 Full-Catalog Similarity Maps & Memoization (`computeGameSimilarityMaps`)
- **Warm Collaborative Score:** Blends `buildEaseSimMapFromIndex` (`negWeight = -0.35`, plus `0.25×` forward intent from Backlog items) with `buildCollabSimMapFromIndex` (64-D Spectral-EASE) using the Colab-tuned `easeWeight` (~`0.85` capped `[0.55, 0.85]`).
- **Repulsion Map:** `buildRepulsionMapFromIndex` suppresses candidates close to `<= 4/10` disliked games in 64-D Spectral-EASE space.
- **Semantic Map:** `buildContentSimMap` scores all `24,439` games in `128-D` Tag-Dropout BGE-large space using `minPositiveRating = 7`.
- **Route-Change Memoization:** Caches the full-catalog map against `mKey|playedKey|backlogKey` so switching between `/games`, `/games/explore`, `/games/oracle`, and `/game/:id` reuses maps in **`< 0.1 ms`** instead of re-scanning `24,439` vectors.

### 4.3 Interleaved Warm + Cold Candidate Retrieval (`buildGameRecommendationIds`)
- Scores all unseen warm games by `normSim + 0.18 * max(0, contentSim) - 0.25 * repulsion` and retrieves top `warmLimit` (default `48`).
- Retrieves top `coldLimit` (default `18`) unindexed cold-start neighbors via `retrieveColdContentNeighbors` (console exclusives + `2024–2026` releases).
- **3:1 Interleaving:** Interleaves `3 warm : 1 cold` IDs before batch-hydrating via `/api/igdb` so recent blockbusters (*Crimson Desert*, *Hades II*, *Assassin's Creed Shadows*) and console exclusives (*God of War Ragnarök*, *Shadow of the Colossus*) surface naturally alongside Steam classics (*Dark Souls III*, *God of War (2018)*, *Horizon Zero Dawn*, *Death Stranding*).

### 4.4 Calibrated Logit Ranker, Quality Guards & Display Calibration (`rankGameCandidates`)
Once IGDB returns hydrated metadata, `filterDuplicateGameEditions` collapses sibling editions (`normalizeGameBaseTitle` strips `- Definitive Edition`, `- Anniversary Edition`, `Remastered`, `GOTY`, etc.) so players never get recommended an edition of a game they already played.

Every candidate is then scored with a calibrated logit that pairs **warm collaborative precision** with **acclaimed cold-start parity** plus four deterministic quality guards:
1. **Bayesian Acclaim:** `bayes = (votes * r10 + 40 * 7.2) / (votes + 40)`, `acclaimNorm = clamp((bayes - 5.5) / 4.0, 0, 1)`.
2. **Progressive Mediocre & Flop Penalties:**
   - `mediocrePenalty = r10 > 0 && r10 < 7.5 ? (7.5 - r10) * 1.15 * voteConf : 0` (demotes `6.9–7.4` mediocre titles below `8.8–9.4` masterpieces).
   - `flopPenalty = r10 > 0 && r10 < 6.5 ? (6.5 - r10) * 2.15 * voteConf : 0` (crushes critical flops like *The Lord of the Rings: Gollum* `4.3/10` so a genre overlap can never give a flop a `97%` match).
3. **Redundant Edition Penalty:** `-0.65` on `Anniversary / Definitive / Enhanced / Remastered / GOTY` re-releases unless genuinely landmark (`r10 >= 8.7 && votes >= 400`).
4. **Unreleased Future Vaporware Guard:** `-2.2` when `year > currentYear && votes < 15` so unrated future announcements (e.g., `2027` titles with `0` votes) never hijack `For You` picks.
5. **Warm vs. Cold Logit Parity:**
   - **Warm (`hasCollab && collabNorm > 0.02`):**
     `logit = -1.0 + 3.35 * collabNorm + 0.92 * max(0, contentNorm) + 0.48 * genreOverlap + 0.35 * themeOverlap + 0.55 * devMatch + 1.35 * acclaimNorm - 1.45 * repulsion - penalties`
   - **Cold (`console exclusives & 2024–2026`):**
     `coldCap = r10 >= 8.2 ? 1.0 : 0.78`, `coldContentCal = clamp(max(0, contentNorm) / 0.72, 0, coldCap)`
     `logit = -1.05 + 3.65 * coldContentCal + 0.55 * genreOverlap + 0.38 * themeOverlap + 0.62 * devMatch + 1.35 * acclaimNorm - 1.2 * repulsion - penalties`
     Acclaimed cold-start hits (`>= 8.2`, e.g. *God of War Ragnarök*, *Hades II*, *Shadow of the Colossus*) achieve full parity with warm classics, while `< 8.2` cold games cap at `0.78` so warm `9.0+` classics win cleanly.
6. **Realistic Display Match Spread & Personal `Est. X.X/10`:**
   - `computeGameDisplayMatchScore(logit)` uses temperature **`τ = 1.85`** (`50 + 48 * σ((logit - 0.35) / 1.85)`) so top recommendations span a meaningful `62%–97%` gradient instead of saturating every top card at `98%`.
   - `predictGameRating(matchScore, played)` calibrates an estimated `4.5–9.9` personal score against the player's own vault mean and standard deviation.

### 4.5 Live `< 1 ms` Neural Taste Tuner (`applyGameTuner`)
Adjusting any of the 5 controls on `/games/explore` re-ranks the pool client-side with zero network calls:
- **Intensity (`pacing`):** Dot product of each game's `128-D` vector with `intensityVec` (`× 1.2`).
- **Tone (`tone`):** Dot product with `toneVec` (`× 1.2`).
- **Era (`era`):** Normalized release year `clamp((year - 2012) / 14, -1, 1)` (`× 1.25`).
- **Familiarity (`familiarity`):** Log-scaled review count `clamp((2.7 - log10(max(10, votes))) / 1.1, -1, 1)` (`× 1.15`).
- **Break My Bubble (`antiBubble`):** Penalizes the player's top 2 dominant vault genres (`-1.15` per hit) and boosts out-of-bubble genres (`+0.85`).

### 4.6 Hybrid Similar Games (`findSimilarGameIds`)
Powers the **"Similar Games"** strip on `/game/:id` for both Steam hits and console exclusives:
- Blends **`65%` exact outgoing EASE^R neighbors** + **`35%` `128-D` Tag-Dropout BGE-large cosine neighbors** (or `100%` BGE-large for 100%-cold exclusives like *Bloodborne*), falling back to IGDB `similar_games` if an obscure title sits outside the `24,439`-game index.

### 4.7 Hardware & PC Rig Spec Engine (`src/games/services/gameRigService.js`)
First-time visitors complete a 3-step onboarding wizard (`GameOnboardingModal.jsx`):
1. **Platforms owned:** PC, PlayStation, Nintendo, Xbox.
2. **PC GPU Spec Tier (`entry`, `mid`, `high`):** Auto-detects the browser's WebGL `UNMASKED_RENDERER_WEBGL` string (`classifyGpuRenderer` maps GTX 750 Ti / 960 / 1050 / Intel UHD / Vega iGPU → `entry`, GTX 1060–RTX 3060 / RX 6600 / Steam Deck → `mid`, RTX 3070–5090 / RX 6800–7900 → `high`), with one-click manual override.
3. **32 Iconic Mainstream Starters:** Players tap games they've already played (*GTA V*, *RDR2*, *Witcher 3*, *Cyberpunk 2077*, *Black Ops*, *Battlefield 1*, *BG3*, *Elden Ring*, *Minecraft*, *The Sims 4*, *Hollow Knight*, *FIFA/EA FC*, etc.) to seed their local ML vault immediately.
- **`estimateGameSpecTier(game)` & `isGameCompatibleWithRig(game, rig)`:** When `respectRigLimits` is active on an `entry`-tier PC (like a GTX 750 Ti), modern heavy `2023+` AAA 3D releases are flagged/filtered via the **`My Rig`** Explore chip while lightweight indies (*Balatro*, *Hollow Knight*, *Hades*, *Stardew Valley*) and classics (*GTA V*, *Witcher 3*, *Battlefield 1*) remain cleanly playable.

---

## 5. Binary Artifact Reference & Copy-Paste Verification

| File in `public/models/games/` | Exact Size | Magic / Format | Dimensions | Purpose |
| :--- | :---: | :---: | :---: | :--- |
| `game_ease_k80.cvea` | `4,748,560 B` (`4.53 MB`) | `CVEA v1` | `14,656 × K=80` | Exact sparse EASE^R item-item graph |
| `game_embeddings_f16.bin` | `1,934,608 B` (`1.84 MB`) | `CVEM v1` | `14,656 × 64-D` | Dense Spectral-EASE + dislike repulsion |
| `game_content_f16.bin` | `6,354,156 B` (`6.06 MB`) | `CVEM v1` | `24,439 × 128-D` | Tag-Dropout Ridge BGE-large (warm + cold exclusives) |
| `game_tuner_axes.json` | `3,303 B` | JSON | `128-D × 2` | Decorrelated `Intensity` & `Tone` Taste Tuner axes |
| `game_steam_to_igdb.json` | `284,040 B` | JSON | `18,144` keys | Steam `app_id → canonical igdb_id` import crosswalk |
| `game_ranker_weights.json` | `2,578 B` | JSON | Metadata | Verified Colab v1.1 blend weights & benchmark summary |

### Quick Verification Commands
```bash
# 1. Inspect exact headers & byte counts of all GameVault binaries
node -e "import('node:fs').then(fs=>{for(const f of ['public/models/games/game_ease_k80.cvea','public/models/games/game_embeddings_f16.bin','public/models/games/game_content_f16.bin']){const b=fs.readFileSync(f),d=new DataView(b.buffer,b.byteOffset,b.byteLength);console.log(f,{bytes:b.length,magic:b.slice(0,4).toString(),ver:d.getUint32(4,true),count:d.getUint32(8,true),dimOrK:d.getUint32(12,true)});}})"

# 2. Run GameVault unit & live-binary ML tests
node --test tests/gameServices.test.js tests/igdbApi.test.js

# 3. Run full CinemaVault + GameVault test suite & production build
npm test && npm run build
```

---

## 6. Every ML, Catalog & Engineering Bug Caught and Fixed

### Colab Training Fixes (`scripts/games/train_games_colab.ipynb`)
1. **EASE^R Popularity Scaling Side Bug:** Initial scaling divided columns instead of source rows; fixed to `B.mul_(inv_pow.unsqueeze(1))` before top-80 pruning.
2. **IGDB Edition Fragmentation:** Steam AppIDs frequently resolved to GOTY/Definitive sub-entries; added recursive `version_parent` resolution into canonical base IDs.
3. **Steam-Tag Domain Shift on Console Exclusives:** Pure Ridge on `IGDB + Steam Tags` degraded on PlayStation/Nintendo titles lacking Steam tags; solved with **Tag-Dropout Ridge** (`+9.05%` cold-start `Recall@20`).
4. **Taste Tuner Popularity Confound:** Raw linear probes correlated with game popularity; explicitly projected out the log-popularity vector (`corr = 0.0000`, `Intensity` AUC `0.968`, `Tone` AUC `0.996`).

### Live App, Catalog, Performance & UI Fixes
5. **Obscure 10-Vote Shovelware in Popular/Top-Rated IGDB Feeds (`api/igdb.js`):** IGDB's `total_rating` and `hypes` fields without minimum review floors surfaced 5-vote shovelware (*NextWorld2*, *Dig Island*, *My Grandfather's Farm*). Fixed with strict `total_rating_count` floors (`>= 250` Popular, `>= 180` Top Rated, `>= 120` Critics' Choice, `>= 35` Recent Hits, `>= 15` Upcoming) plus a dedicated **Popular Blockbusters** Discover carousel.
6. **Flops & Mediocre Cold Titles Scoring `97%` (`gameRankerService.js`):** Genre + semantic overlap previously let *The Lord of the Rings: Gollum* (`4.3/10`) and unreleased `2027` 0-vote titles sneak into top `For You` picks. Added progressive mediocre (`< 7.5`), steep flop (`< 6.5`), redundant edition (`-0.65`), and unreleased future (`-2.2`) penalties plus acclaimed cold-start capping (`coldCap = 0.78` below `8.2`) and wider `τ = 1.85` score spread.
7. **Duplicate Editions in Vault & Recommendations (`gameRankerService.js`, `GamesVaultPage.jsx`):** Added `normalizeGameBaseTitle` + `filterDuplicateGameEditions` and a one-click Vault duplicate-edition cleanup helper.
8. **Scroll Lag, Hero Clipping & Oversized Posters (`GameHeroBillboard.jsx`, `GameCard.jsx`, `games.css`):** Removed per-scroll-frame Framer `useScroll`/`useTransform` parallax (which both caused frame drops and clipped the hero title behind the navbar), removed 100+ card `backdrop-filter: blur(...)` layers and infinite Ken Burns scaling, wrapped `GameCard` in `React.memo` with `decoding="async"`, memoized `computeGameSimilarityMaps` across routes, added `content-visibility: auto` on carousels, compacted hero actions onto a single row, and restored sleeker **7–8 poster desktop rows**.
9. **Rating Studio & Dossier UX Polish (`GameRatingModal.jsx`, `GameDetailsPage.jsx`, `StarRatingStage.jsx`):** Replaced the native browser number spinner (which rendered a glaring white box in dark mode) with a dark `-`/`+` playtime stepper, swapped the Platform free-text input for a portaled dark-glass `<Select>` dropdown, added `mediaNoun="game"` to `StarRatingStage`, and made walls-of-text IGDB storylines (like *Battlefield 1*) smoothly collapsible (`"Read full storyline →"`).

---

## 7. Security & Isolation Guarantees
- **Server-Only Twitch/IGDB Secrets:** `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` live strictly in Vercel serverless `api/igdb.js` (and local Vite dev middleware) — **never** prefixed with `VITE_` and never bundled into `build/assets/*.js`.
- **Single Hobby Serverless Function Budget:** All IGDB actions (`search`, `details`, `batch`, `discover`) run inside 1 allowlisted function (`api/igdb.js`), keeping the project cleanly under Vercel Hobby's 12-function limit (`11 / 12`).
- **Zero Impact on CinemaVault Movies:** `DEFAULT_RANKER_WEIGHTS`, MovieLens binaries, `localStorage` movie vault, and Supabase `public.user_vault_items` remain completely untouched.
