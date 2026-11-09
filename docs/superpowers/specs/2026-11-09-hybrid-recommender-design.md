# Hybrid Movie Recommender & Evaluation Pipeline Specification

## Verdict & Context

Splitting catalog retrieval from LLM re-ranking is the standard two-stage design that production recommenders use, and grounding Gemini in real TMDB candidates fixes hallucination properly. The weaknesses in the v3.0 pipeline are in the middle: hand-built retrieval heuristics, no offline evaluation, and a 20-candidate ceiling.

## Problems Addressed

1. **No evaluation:** $\lambda = 0.002$, the $9\star$ anchor cutoff, and bucket sizes are untested guesses.
2. **20-candidate ceiling:** Pool must expand to 200–500 candidates, ranked down to top 30 for Gemini diversity/explanations and top 6 for display.
3. **Coarse retrieval:** Taste compressed into 4 genre IDs, 3 keywords from one anchor film, and 1 crew member.
4. **Echo-chamber bias:** `vote_average.desc` with `vote_count >= 500` favors canonical top-rated films for everyone.
5. **Uncalibrated `matchScore`:** Gemini invents numbers and `normalizeMatchScore` clamps junk to 88. Scores must come from a calibrated model probability.
6. **Rating bias:** `(rating - 5)/5` ignores user rating mean/variance and treats 4–5 as neutral (0) rather than mildly negative. Must use per-user z-scored ratings.
7. **Bulk-import decay:** `dateWatched || addedAt || Date.now()` assigns $\Delta_{\text{days}} = 0$ to undated backlog imports. Undated/bulk-imported items must use a neutral prior decay (`180` days).

## Bugs Fixed

- **`hatedKeywordIds`:** Must sort descending by negative score before `.slice(0, 5)`.
- **`generateProfileHash`:** Must not mutate profile arrays in place (use `[...arr].sort()`), and must include `anchorTmdbId`, `topCrewMemberId`, and `topCastIds` so a new 10/10 invalidates the 24h cache immediately.
- **`with_cast`:** TMDB treats comma `,` as AND and pipe `|` as OR. `fetchBucketA` must join `topCastIds` with `|`.

## Hybrid Architecture

- **Stage 1 (Collaborative Item Embeddings):** Train ~64-dim item embeddings on MovieLens (mapped via `links.csv` to TMDB IDs) and export ~20k films as a static float16 binary (`~2.5 MB`). At runtime, compute user taste vector:
  $$u = \frac{\sum w_i e_i}{\sum |w_i|}, \quad w_i = z_i \cdot e^{-\lambda \Delta_i}$$
  Retrieve nearest neighbors by cosine similarity.
- **Stage 2 (Content Embeddings):** Blend content embeddings (from overview, keywords, genres) with collaborative embeddings using $\alpha = \frac{n}{n + \text{pivot}}$ to cover new releases with few MovieLens ratings.
- **Stage 3 (Learned Ranker & Gemini's Role):** Score the 200–500 candidate pool with a calibrated logistic ranker over collaborative similarity, content similarity, genre/keyword overlap, crew/cast match, popularity, release year, and provider match. Gemini produces explanations, free-text query filter parsing, and a light diversity pass over the top ~30 candidates—never the raw score.
- **Feedback Logging:** Persist clicks, dismissals, watchlist adds, and subsequent ratings with `tmdbId` (up to 500 events) for personal fine-tuning.
