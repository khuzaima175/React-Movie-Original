# CinemaVault v4.1 â€” Measure-First Wiring, Ranker Fixes & Budgeted Argon Spec

Status: DRAFT for review. No code is written by this document.
Supersedes the speculative parts of the Nov 9 chat proposals. Builds on `2026-11-09-hybrid-recommender-design.md`.

## 1. Audited Reality (Nov 9, 2026)

| Area | Spec said | Code actually does |
|---|---|---|
| Stage 1 embeddings | 64-d float16 binary at `/models/item_embeddings_f16.bin` | **File does not exist** (`public/` absent). `loadDefaultEmbeddingIndex` returns `null`, so `collabSim = 0`. The loader and `buildCollabSimMapFromIndex` are already wired in `geminiService.js`. |
| Stage 2 content sim | blended content embeddings | `contentSimMap` is **never built**; `contentSim = 0`. |
| Retrieval | embedding neighbours + TMDB | TMDB discover only, default pool **60**. `retrieveByEmbedding` is never called. |
| Ranker weights | "trained" | Hand-set constants. `colab_train_embeddings.py` writes the same constants to JSON. |
| Eval harness | measures the ranker | `gridSearchHyperparams` scores a toy genre + keyword + Bayesian sum. It never calls `rankCandidatePool`. |
| Gemini role | ranks | Picks 6 of the top 30 and writes reasons. Scores are locked by `mergeGeminiExplanationsWithRanker`. |
| Model chains | consistent | `geminiExplanationService.js` still uses `3.7 â†’ 2.5 â†’ 2.0`. |
| Keyword overlap | anchor-film keyword match | `rankCandidatePool` is called **without** `anchorKeywords`, so `keywordOverlap` is only the constant 0.6 for Bucket B items and 0 otherwise. `crewMatch` is likewise a Bucket C shortcut. Found while preparing Phase 1. |
| Positive ranker weight mass | â€” | 8.7 total. 3.8 (â‰ˆ44%) sits on the two dead features. |

## 2. Principles

1. **Measure before changing.** No ranking change merges without an NDCG@10 / Recall@20 reading from the harness against a recorded baseline.
2. **Do not double-count.** `contentSim` must come from a text/visual embedding. It must not be rebuilt from genre, keyword or crew overlap, which the ranker already has as separate features.
3. **LLM never invents scores** until a measured A/B test shows a gain.
4. **Every paid call is metered and capped.**
5. **Missing assets degrade gracefully** (existing rule: loaders resolve `null`, never throw).
6. All existing tests (`node --test`) stay green. New behaviour ships with tests.

## 3. Decisions Needed Before Phase 4

| # | Decision | Resolution (Nov 9, 2026) |
|---|---|---|
| D1 | Deployment | **A: local/private.** Argon runs only when `VITE_ENABLE_ARGON=true` is set locally. |
| D2 | Argon budget | **\$6.00 hard cap** enforced in `aiSpendTracker.js`. |
| D3 | Argon fusion | **Math score stays locked** until the Phase 6 replay shows a gain for 0.85 math + 0.15 Argon. |

Caveat on D1: the `VITE_ENABLE_ARGON` flag controls *spending*, not *key exposure*. Vite inlines every `VITE_*` value present at build time, so any build made with `.env` present embeds the key whether or not the flag is on. The current `build/` has no key in it. Do not deploy a build made with a paid key. Option B (server proxy) is required before any public deployment.

## 4. Phases

Dependency order: P0 â†’ P1 â†’ P2 â†’ P3 â†’ (P4 âˆ¥ P5) â†’ P6. P4 and P5 are independent once P1 exists.

### Phase 0 â€” Prerequisites ($0)

| File | Change |
|---|---|
| `package.json` | Check whether `@google/genai` 1.34.0 supports `thinkingConfig.thinkingLevel` for Argon, and `responseSchema` together with it. Bump only if it does not, and rerun tests. |
| `ARCHITECTURE.md` | Add a "Known gaps" section copied from Â§1, so docs stop claiming features that are not live. |

Gate: written result of the SDK check.

### Phase 1 â€” Real Eval Harness ($0)

Goal: a trustworthy baseline for every later phase.

**`src/services/evalHarness.js`**
- Add `evaluateRanker(watched, catalog, options)`:
  - split with the existing `temporalHoldoutSplit`.
  - build the training profile from `trainWatched` (reuse `computeZScoredWeights` and the profile builder in `tmdbService.js`).
  - compute features through `extractCandidateFeatures` and rank with `rankCandidatePool` (optionally `weights` and `collabSimMap`).
  - return Recall@20, NDCG@10, ILD, novelty.
- Support **rolling-origin folds** (several holdout cut points). A single user has few ratings, so a single split is noisy. Report mean Â± spread, not one number.
- Keep `gridSearchHyperparams` only as the "toy baseline" row so improvements are visible against it.

**Catalog snapshot (`scripts/snapshot_candidates.*`, output `tests/fixtures/` or `.data/`, not committed if large)**
- Save a fixed set of TMDB items (ids, genres, keywords, cast, crew, vote stats, release year) so evals are repeatable and offline.
- Negatives: unrated catalog items sampled from the same bucket mix the live app produces. Positives: the user's holdout 8+ ratings.
- Evals report "insufficient data" instead of a number when a vault is too small (defaults: â‰¥ 10 training ratings and â‰¥ 3 held-out positives per fold).

**Benchmark vaults (so the harness never blocks on a small personal vault)**
1. **Synthetic persona vaults, committed** (`tests/fixtures/`): 3 deterministic personas (e.g. a slow-burn auteur fan, a mainstream-thriller fan, a genre-hopper) with a synthetic catalog. These make the harness and its tests runnable anywhere, with no network.
2. **Real MovieLens vaults, built locally, not committed**: `scripts/build_benchmark_vaults.mjs` samples 3â€“5 users (60â€“100 ratings each, ratings Ã—2 to the 1â€“10 scale, MovieLens timestamps as `dateWatched`), maps `movieId â†’ tmdbId` through `links.csv` and fetches TMDB metadata. Output goes to a gitignored `.data/` folder, because GroupLens does not permit redistributing MovieLens data.
3. **The user's exported vault JSON**, evaluated via the same entry point.

Caveat: embeddings trained on MovieLens have seen these users' ratings, so `collabSim` results on MovieLens vaults are leaky. MovieLens vaults are valid for Phase 1 and for non-collaborative features. `collabSim` gates use the personal vault, or a retrain that excludes the sampled users.

Fidelity caveat: the harness mirrors the live call, which passes no `anchorKeywords`, and takes `sourceBucket` from the catalog snapshot. A snapshot without bucket tags under-represents the live Bucket B/C shortcuts.

**Baselines recorded (JSON in `docs/` or `tests/fixtures/`)**
1. Popularity only (Bayesian rating).
2. Toy formula (current `gridSearchHyperparams`).
3. Current ranker with `collabSim = contentSim = 0` (what users get today).

**Tests (`tests/evalHarness.test.js`)**: synthetic vault where the correct ranking is known; metrics on perfect, random and reversed rankings; insufficient-data path.

Gate: baselines recorded and reproducible (same inputs â†’ same numbers).

### Phase 2 â€” Ship the Collaborative Binary ($0)

**`scripts/colab_train_embeddings.py`**
- Keep SVD on z-scored ratings as the baseline (it exists). Offer ALS as an option only if offline checks show a gain.
- Add an **offline sanity check on MovieLens itself**: hold out a rating slice per user and report Recall@20 for the new embeddings against a popularity baseline. Do not ship a binary that does not beat popularity.
- Stop writing hardcoded numbers as "trained" weights. Either write the defaults with a clear `"source": "hand-set"` field, or fit them in Phase 3 from vault data. Keys must match `DEFAULT_RANKER_WEIGHTS`.
- Print **coverage**: how many of the user's vault films have a vector in the index.
- **ID mapping (required, verified):** the browser vault and `rankerService.js` key films by `tmdbId`, not MovieLens `movieId`. The script already joins `links.csv` (`movieId â†’ tmdbId`), drops rows with no `tmdbId`, de-duplicates on `tmdbId`, and writes TMDB ids into the binary. Add a post-write self-check that fails the run if any written id is not a `tmdbId` from `links.csv`, so a future edit cannot silently re-key the file.

**Artifacts**: `public/models/item_embeddings_f16.bin` (~20k Ã— 64 Ã— 2 B â‰ˆ 2.6 MB + ids).

**`vite.config.js` / hosting**: confirm `/models/*` is served as a static binary, not the SPA fallback (the loader already rejects `text/html`).

Known limits (document, do not hide): MovieLens-32M has no ratings after Oct 2023; films from 2024â€“2026 have no vector until the content path exists.

Gate: binary loads in the app; vault coverage reported; Phase 1 harness shows NDCG@10 and Recall@20 against baseline 3. If it does not improve, stop and investigate before continuing.

### Phase 3 â€” Ranker Fixes (each step measured in the harness)

**3a. Embedding-neighbour injection** â€” `geminiService.js`, `tmdbService.js`, `embeddingService.js`
- After `fetchCandidatePool`, call `retrieveByEmbedding(userVec, index, excludeIds, 30)`.
- Those films are keyed by `tmdbId` (see Phase 2) but the index holds only vectors, with no genres, keywords, cast or poster. Fetch details with the existing TMDB detail function (confirm its name), at most 30 extra calls, concurrency ~6, memory-cached, failures skipped.
- Tag `sourceBucket: "Bucket E (Embedding)"`. Exclude watched and watchlist. Final pool is 60 + â‰¤30.
- Gate: harness Recall@20 up, and no p95 latency regression beyond ~1.5 s.

**3b. Centroid collapse and repulsion** â€” `embeddingService.js`, `rankerService.js`, `colab` weights, `ranker_weights.json`
- New `computeUserPersonas(weightedRatings, index, opts)`: cluster **positive** ratings only. Use deterministic k-means (seeded, fixed iteration cap) so results and cache hashes are stable. K = 1 below 8 positives, up to 4 at â‰¥ 20.
- New `computeRepulsion(weightedRatings, index, candidateId)`: negatives only, separate from personas. Threshold (0.35) and exponent are **parameters in the eval grid**, not assumptions.
- Candidate collab score = best persona cosine blended with nearest-loved-films term. Blend weights (0.55/0.45) are also grid parameters.
- Add a `repulsion` feature with a negative weight to `DEFAULT_RANKER_WEIGHTS` and the weights JSON.
- Keep `computeUserEmbedding` for backward compatibility and existing tests.
- Tests: two-cluster vault (Oldboy + Toy Story type) must keep both clusters retrievable; a disliked film's neighbours get penalised; determinism across runs.
- Gate: harness improves over 3a on the same folds.

**3c. Decay and fitted weights** â€” `scoringUtils.js`, `evalHarness.js`
- Extend the grid with the dual-clock decay (Î»â‚� 0.0008, Î»â‚‚ 0.07, mix 0.70/0.30) against the current single Î» = 0.002. Adopt only if it wins.
- Fit ranker weights on the user's vault temporal folds with strong L2 toward the current defaults. Do not fit on MovieLens: it lacks crew/provider/keyword features and `collabSim` would leak.

**3c-bis. Wire the anchor keywords and real crew match** â€” `geminiService.js`, `rankerService.js`
- Pass the anchor film's keywords as `anchorKeywords` into `rankCandidatePool`, and compute `crewMatch` from `crewPersonId` for all buckets, not only from the Bucket C shortcut. Measure with the harness before and after. This is a cheap fix for an already-existing feature.

**3d. Content similarity (deferred until the content index exists)**
- Needs a real content vector per film (text, or text+poster) from an embedding model, plus its own binary. It becomes the Phase 7 item below. Until then `contentSim` stays 0 and its weight stays unused. Do not substitute overlap features.

### Phase 4 â€” Budgeted Gemini Integration

Task routing:

| Call site | Model chain | Notes |
|---|---|---|
| `reRankCandidatesWithGemini` (30 â†’ 6 + taste profile) | `gemini-4-argon` (`thinkingLevel: LOW`) â†’ `3.8-flash` â†’ `3.7-flash` â†’ `3.5-flash` â†’ existing tail | Behind `VITE_ENABLE_ARGON` and D1/D2 |
| `geminiExplanationService.js` | `3.8-flash â†’ 3.7-flash â†’ 3.5-flash â†’ 2.5-flash` | Fix stale list. Free tier. |
| Free-text mood parse, OMDb fallback | `3.8-flash` chain | Free tier |
| `geminiChatService.js` | `3.8-flash` chain | Optional "Deep Critic" Argon toggle later |

**`src/services/geminiService.js`**
- Split the single `MODELS` list into per-task chains (curation vs economy).
- Argon calls pass `thinkingConfig` with level LOW.
- If Argon returns 403/429, remember "Argon unavailable" **for the session** so free-tier keys do not pay a failed round-trip on every request.
- Prompt: keep the TMDB overview, add director and top keywords per candidate, and instruct the model to choose only from the supplied ids. This is the grounding that offsets Argon and Carbon's weaker closed-book recall on obscure films.

**New `src/services/aiSpendTracker.js`**
- Read `usageMetadata` (prompt, candidate and thinking tokens) from every response.
- Estimate cost from a price table with an effective-date switch (Argon \$2/\$10 until Nov 30, \$4/\$20 from Dec 1; Flash prices per model).
- Persist a running total in localStorage. When the Argon total reaches the D2 cap, skip Argon and use Flash. Log per-call cost to the console.
- The first measured week replaces my "~500 thinking tokens at LOW" assumption with real numbers.

**Cost reference (assumptions to verify with the tracker):** ~2,500 input tokens â‰ˆ \$0.005; ~1,100 output tokens at LOW â‰ˆ \$0.011; â‰ˆ \$0.016 per curation call, â‰ˆ 600 calls per \$10 until Nov 30 and â‰ˆ 300 after.

**Tests**: chain ordering, Argon-disabled path, session "unavailable" memo, spend cap switch-over, price-date switch, malformed-response handling.

Gate: with Argon on, 20 real runs logged; average cost per call known; latency measured.

### Phase 5 â€” Offline "Film-School Rubric" Binary

**New `scripts/build_cinematic_dna.py`**
- Input: ~8,000 TMDB ids (top by MovieLens popularity that are in the embedding index).
- Fetch plot, keywords, genres, director from TMDB for each, then prompt with that text (closed-book recall is not used).
- Output per film: 16 integers 0â€“100 under a strict JSON schema.
- Proposed axes: pacing_velocity, ending_bleakness, narrative_puzzle, dialogue_density, moral_ambiguity, humor_darkness, emotional_warmth, intellectual_demand, violence_viscerality, surrealism, cynicism_vs_sincerity, visual_stylization, romance_intensity, tension_suspense, realism_grounding, scale_spectacle.
- Validate: clip to range, flag and neutral-fill missing values, retry malformed rows.
- Write `public/models/cinematic_dna_u8.bin` with a small header (magic, version, count, axes), ids, then count Ã— 16 bytes. Size â‰ˆ 128 KB + ids.
- **Prompt packing:** put 8â€“10 films in one prompt rather than one per request, to stop repeating the instructions and schema. Safeguards: echo each film's `tmdbId` in its output row, reject and re-queue any batch whose ids do not match the input exactly, and shuffle film order between runs so position bias does not become systematic.
- **Compact output:** return each film as `[tmdbId, v1 â€¦ v16]` (positional integers, no per-axis key names). Output tokens dominate the cost, so this saves far more than packing does.
- **Cost estimate (corrected):** output is ~5Ã— the price of input, so the per-film text and the output size matter more than the shared instructions. Unpacked with keyed JSON output, â‰ˆ \$2.70 (400 in / 100 out tokens per film, batch `3.8-flash`). Packed with positional output, â‰ˆ \$1.0â€“1.6. The earlier "~\$0.50" figure was not supported by this arithmetic. Set thinking to minimal, since thinking tokens are billed as output. Non-batch costs about double.
- Model: `gemini-3.8-flash` via batch if the tier allows it. Using Argon here would be â‰ˆ \$7+ before thinking tokens and is not recommended.
- **Audit**: manually (or with Argon LOW) check 50 random films before trusting the file.

**Runtime**: `embeddingService.js` (or new `dnaService.js`) loader that resolves `null` when absent; `rankerService.js` gets a `dnaSim` feature.
- Compute similarity on **mean-centred** vectors (subtract the catalogue mean), because raw 0â€“100 vectors are all positive and every cosine looks high.
- User DNA = weighted mean of positively-rated films' vectors (reuse personas from 3b where present).

Gate: harness shows `dnaSim` improves NDCG@10 over Phase 3 results. If it does not, the file stays unshipped.

### Phase 6 â€” Argon Quality Experiments (optional, small spend)

- Replay ~20 holdout cases through Argon LOW curation and compare Recall@20 / NDCG@10 against locked-math top-6.
- Test 0.85 math + 0.15 Argon tie-breaking only if the replay shows promise. Budget â‰ˆ \$0.32 for 20 cases at the cost estimate above.
- Reassess Carbon only when it has a public model id and a public price date.

### Phase 7 â€” Later (not scheduled)

- CVEM v2: content vectors via EmbeddingGemma 2 (text, optionally posters) plus a projection into the collaborative space, to cover 2024â€“2026 films and finally give `contentSim` a real source.
- Per-user fitted `w_u`: only at â‰¥ 30â€“40 ratings, with L2 toward global weights.
- Carbon, after general availability.

## 5. Budget (of \$10)

| Item | Estimate |
|---|---|
| Phase 4/6 runtime Argon (cap, D2) | â‰¤ \$6 |
| Phase 5 rubric (3.8-flash batch, packed) | â‰ˆ \$1.0â€“1.6 (â‰¤ \$2.70 unpacked) |
| Phase 6 replay | â‰ˆ \$0.32 |
| Reserve | â‰ˆ \$1 |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Too little vault data for stable evals | Rolling-origin folds, report spread, "insufficient data" state |
| Embedding binary does not beat popularity | Offline MovieLens check before shipping |
| Embedding neighbours inflate latency / TMDB rate limits | Cap 30, concurrency 6, cache, skip failures |
| Argon thinking-token cost higher than assumed | Spend tracker with hard cap |
| Paid key exposed in a public bundle | Decision D1; Argon off until resolved |
| Rubric hallucination on obscure films | TMDB text in prompt, validation, 50-film audit |
| SDK too old for `thinkingLevel` | Phase 0 check |

## 7. Acceptance Summary

| Phase | Pass condition |
|---|---|
| P1 | Reproducible baselines recorded |
| P2 | Binary beats popularity offline; coverage reported; harness gain vs baseline 3 |
| P3 | Each step improves the harness on the same folds, or is reverted |
| P4 | Spend tracker live; per-call cost known; cap enforced |
| P5 | `dnaSim` improves harness NDCG@10, or the file is not shipped |
| All | Existing tests plus new tests green |

## 8. Status log

### Phase 0 and Phase 1 — done (Nov 9, 2026)

Delivered:
- `ARCHITECTURE.md` "Known Gaps" section, including the SDK check (`thinkingLevel` and the `ThinkingLevel` enum exist in 1.34.0; Argon acceptance with `responseSchema` is untested).
- `src/services/evalHarness.js`: `evaluateRanker`, `evaluateRankerRolling`, `formatEvalReport`; `temporalHoldoutSplit` now also returns `holdoutStartTs`; strategies `ranker`, `popularity`, `toy`, `random`.
- `tests/evalRanker.test.js` and `tests/fixtures/syntheticVaults.js` (3 synthetic persona vaults). Full suite: 41 passing (27 existing + 14 new).
- `scripts/run_eval.mjs` (evaluation runner), `scripts/build_benchmark_vaults.mjs` (local MovieLens vault builder, output in gitignored `.data/`).
- Baseline: `docs/superpowers/baselines/synthetic-2026-11-09.json`. The MovieLens baseline stays local in `.data/`.

A harness bug found and fixed while building it: the `toy` baseline measured time decay against today's date. On vaults with old dates every weight decayed to roughly zero and the "toy" ranking collapsed into the popularity ranking. Decay is now measured against the start of the holdout, and a test checks that shifting every date by a constant changes nothing.

Baseline readings (mean NDCG@10 over rolling folds; treat as noisy, see below):

| Vault set | ranker (today's live config) | toy formula | popularity | random |
|---|---|---|---|---|
| Synthetic personas (3 vaults) | 0.097 | 0.178 | 0.079 | 0.040 |
| MovieLens users (4 vaults) | 0.043 | 0.115 | 0.030 | 0.029 |

Reading these numbers:
- The simple toy formula (genre affinity plus keyword plus rating) currently beats the hand-weighted logistic ranker on both sets. The logistic weights have never been validated, which is the case for Phase 3c.
- The ranker is only slightly above popularity and random on the real MovieLens vaults.
- Each fold holds out about 10 positives, and the spread is as large as the mean in many cells. These numbers cannot rank small differences. Use them for large effects only, and pool several vaults and folds before trusting a gate.
- The synthetic personas are generated from a genre rule, which favours genre-driven strategies. The MovieLens vaults' catalog is the vault films plus the 250 most popular films, which favours popularity.
- These runs have `collabSim = contentSim = 0` and no `anchorKeywords`, so they are the "today" baseline, not a measure of the finished design.
