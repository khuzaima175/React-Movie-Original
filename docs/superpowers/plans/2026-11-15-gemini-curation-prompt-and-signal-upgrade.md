# Gemini Curation Prompt & Signal Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline in this session per user request) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Stage 3 Gemini movie curation (`30 -> 10` selection and personalized explanations) by fixing runtime taste/dislike identity lookup and note cache invalidation bugs, preserving rich TMDB candidate and vault metadata, enriching user/candidate context in `buildGeminiReRankPrompt` within a tight `< 18,000` char prompt budget, balancing `#1–#15` core trust against targeted `#16–#30` cold-start promotions and tonal vetoes, and making 1–2 line taste notes easy to capture in rating modals—without weakening `DEFAULT_RANKER_WEIGHTS`, deterministic `matchScore` (`50–99%`), or offline Clean1+Clean2 benchmarks.

**Architecture:** Empirical evaluation across the repo's benchmark docs shows the local `CVEM v1` collaborative matrix and 12-feature linear ranker hit structural limits on post-2023 cold-start titles (`~10.6%` of the user's 2026 watches in `cinemavault-backup-2026-11-14.json`), while blind mathematical cold quotas degrade warm accuracy. Keeping Stage 2 `matchScore` (`50–99%`) deterministic and upgrading Stage 3 Gemini (`gemini-4-hydrogen` HIGH 35s / `Flash` 15s curation cascade) lets the LLM act as a genuine semantic and tonal judge across Top 30 candidates—respecting `#1–#15` mathematical winners while reading user notes, promoting aligned `#16–#30` cold-start fits, and vetoing tonal clashes against Dislikes and Near Misses.

**Verified Runtime Field Shapes (Pre-Execution Audit):**
- `extractTasteProfile` (`src/services/tmdbService.js:494-512`) returns:
  - `lovedGenreNames`: `string[]` (already read at `geminiService.js:1478`)
  - `topDirectors`: **`string[]`** (e.g. `["Christopher Nolan", ...]`, NOT `{ name }` objects — Task 3 supports both `string` and `{ name }`)
  - `userStats`: `{ mean, std, rawStd, count }` from `computeUserRatingStats` (`tmdbService.js:284`) + `totalRated: number` (Task 3 reads `profile?.userStats || profile?.ratingStats`)
  - `weightedRatings`: `Array<{ movie, rating, zScore, daysSince, timeDecay, weight }>` from `computeZScoredWeights`
- `buildGeminiReRankPrompt(profile, mood, topCandidates = [], context = {})` (`src/services/geminiService.js:1431`) takes 4 positional args (`profile, mood, topCandidates, context`) with `watched`, `watchlist`, `feedbackLog`, `embeddingIndex`, `moodFilters`, `targetCount` inside `context`. `reRankCandidatesWithGemini` (`L1847-1854`) and `getMovieRecommendations` (`L2215-2228`) already pass `watched` and `watchlist` through cleanly.

**Tech Stack:** React 18 (Vite), pure ESM service modules (`src/services/*.js`), Node native test runner (`npm test` -> currently `234/234` tests passing across `28` suites), TMDB detail hydration (`formatTmdbMovieDetails` / Bucket E embeddings), Smart Cache v4 (`localStorage` hashed by `generateProfileHash`), Gemini Flash/Hydrogen `/api/gemini` cascade.

**Spec & Research Basis:**
- Architecture & deterministic `50–99%` lock: `SPEC.md` (Sections 6–7), `LOCAL_MODEL_GUIDE.md`, `summary.md`
- Empirical cold-start & pool findings: `scripts/experiments/results/within_cold_eval.md`, `partial_mask_eval.md`, `cold_quota_eval.md`, `bucket_e_pool_eval.md`, `bucket_e_recall.md`
- Historical prompt/ranker plans & invariants: `docs/superpowers/plans/2026-11-14-recommendation-accuracy-upgrades.md`, `mood-and-ten-picks.md`, `mood-provider-ranker-v2.md`, `2026-11-11-resilient-gemini-cascade-and-timeouts.md`

**Global Constraints:**
- **Pre-flight Git Safeguard:** Before starting Task 1, check `git status -s`; discard any stray unrelated hunk in `ARCHITECTURE.md` if present (`git checkout -- ARCHITECTURE.md`), while preserving all recent `fix(vault)` backfill/import changes. (Verified clean prior to execution.)
- Never alter `DEFAULT_RANKER_WEIGHTS` or allow Gemini to invent or overwrite deterministic `matchScore` (`50–99%`). `evalRanker.test.js` and `mergeGeminiExplanationsWithRanker`'s descending `matchScore` sort (`tests/pipelineBugs.test.js:65-81`) must remain intact.
- Preserve existing exact prompt section headings and substring/regex contracts verified in `tests/geminiDualEngine.test.js` and `tests/pipelineBugs.test.js` (`USER'S FAVORITE ANCHOR FILMS:`, `USER'S DISLIKED / DISMISSED FILMS (Avoid similar tone):`, `RECENT WATCH STREAK:`, `NEAR MISSES`, `PRE-RANKED CANDIDATE MOVIES (Top N)`, `"Title" (Year) [N/10]`, `select 10 distinct`, `Array of 10 items`).
- All new prompt sections (`userStats`, `topDirectors`, `USER'S WATCHLIST`, candidate `Cast`/`Themes`/`Specs`/`Tagline`) must gracefully omit when absent/empty so synthetic minimal-fixture unit tests stay deterministic and green.
- Append note hash to `buildWatchedHashSegment` **only** when `userNote || notes` is non-empty after normalization, keeping existing 4/5/6/7-argument `generateProfileHash` equality assertions in `tests/pipelineBugs.test.js` byte-identical when notes are blank.
- **Strict Prompt Budget (`< 18,000` chars):** Prevent `gemini-4-hydrogen` (35s) and Flash (15s) JSON timeouts by keeping per-candidate metadata tight (`Plot` 250 chars, top `5` `Themes`, top `3` `Cast`, `Tagline` 70 chars, omit `originCountry` if `spokenLanguages` exists) and `userNote` capped at `180` chars in prompts (`QuickRateModal` `maxLength = 200`).
- **Balanced Promotion Rule:** Explicitly instruct Gemini to favor `#1–#15` ranker picks by default, promoting `#16–#30` candidates (especially recent post-2023 releases) only on strong note/theme fit or when replacing vetoed `#1–#15` tonal clashes.
- Stay local to prompt assembly, identity/hash helpers, TMDB metadata preservation, and rating-note capture UI—do not touch `AppContext.jsx` or Supabase sync schemas.

**Review Focus:**
- Verify `buildMovieIdentityLookup` handles both runtime `profile.weightedRatings` (`{ movie, weight, zScore }`) and test fixtures (`{ tmdbId, title, finalWeight, zScore }`).
- Verify `buildWatchedHashSegment` invalidates cache immediately on adding/editing/clearing a `userNote`, while unchanged/empty notes produce the exact historical hash.
- Verify no TMDB detail fields (`cast`, `writers`, `tagline`, `originCountry`, `spokenLanguages`, `mpaaRating`, `keywordNames`, `runtimeMinutes`) are stripped by `applyDetailsToCandidate` or `fetchEmbeddingCandidates`.
- Verify Task 3 reads real `extractTasteProfile` shapes (`userStats` + string `topDirectors` + `lovedGenreNames`) and `context.watched`/`context.watchlist` cleanly.
- Verify a worst-case 30-candidate + full-vault prompt stays strictly `< 18,000` characters (`assert.ok(fullPrompt.length < 18000)`).

---

### Task 1: Fix `buildMovieIdentityLookup` Runtime Shape & Note-Aware Cache Hashing (`geminiService.js`)

**Why this matters:** In production, `extractTasteProfile` / `computeZScoredWeights` produces `profile.weightedRatings` items shaped `{ movie: { tmdbId, id, imdbID, title, year }, rating, zScore, daysSince, timeDecay, weight }` (`src/services/scoringUtils.js:77-84`). Because `buildMovieIdentityLookup` (`src/services/geminiService.js:1122-1161`) only reads top-level `item.tmdbId`/`title`/`year` and `selectMoodStratifiedAnchors` only reads `weighted?.finalWeight`, `lookupWeighted(movie)` returns `null` for every real user movie—silently disabling relative dislikes (`rating < 7 && zScore < -0.4`) and time-decayed anchor weights. Meanwhile, `buildWatchedHashSegment` (`L1046-1070`) hashes only `id:rating`, so writing or editing `userNote` fails to invalidate the 24h Smart Cache.

**Files:**
- Modify: `src/services/geminiService.js:1046-1070` (`buildWatchedHashSegment`), `1122-1161` (`buildMovieIdentityLookup`), `1182-1185` (`selectMoodStratifiedAnchors`), `1239-1265` (`selectDislikedOrDismissedFilms`)
- Test: `tests/geminiDualEngine.test.js` (runtime `{ movie, weight, zScore }` shape tests), `tests/pipelineBugs.test.js` (`generateProfileHash` note-sensitivity + empty-note backward-compatibility tests)

**Interfaces:**
- Consumes: `weightedRatings` items in either runtime shape `{ movie, rating, zScore, weight }` or legacy/test shape `{ tmdbId, id, imdbID, title, year, finalWeight, zScore }`; watched items with optional `userNote` / `notes`.
- Produces: accurate weighted lookup in `selectMoodStratifiedAnchors` & `selectDislikedOrDismissedFilms`; deterministic `generateProfileHash` invariant when notes are empty and distinct when any `userNote`/`notes` text changes.

- [ ] **Step 0: Pre-flight `git status` check**

Run (PowerShell):
```powershell
git status -s
```
If `ARCHITECTURE.md` shows an unrelated stray modification, discard only `ARCHITECTURE.md` (`git checkout -- ARCHITECTURE.md`) while keeping all committed `fix(vault)` work intact.

- [ ] **Step 1: Write failing tests for runtime nested `weightedRatings` lookup and `userNote` cache hashing**

Add test cases in `tests/geminiDualEngine.test.js` (using the real 4-arg `buildGeminiReRankPrompt(profile, mood, candidates, context)` signature!) and `tests/pipelineBugs.test.js` (near `L823-830`):

```js
// In tests/geminiDualEngine.test.js
test("selectMoodStratifiedAnchors and selectDislikedOrDismissedFilms support runtime { movie, weight, zScore } entries", () => {
    const watched = [
        { tmdbId: 101, title: "Generous Pick A", year: "2020", userRating: 9, genre: "Sci-Fi" },
        { tmdbId: 102, title: "Generous Pick B", year: "2021", userRating: 9, genre: "Action" },
        { tmdbId: 103, title: "Time Decayed Recent", year: "2024", userRating: 8, genre: "Drama" },
        { tmdbId: 104, title: "Relative Letdown Five", year: "2022", userRating: 5, genre: "Drama", userNote: "Way too slow and depressing" },
    ];
    const weightedRatings = [
        { movie: watched[0], rating: 9, zScore: 0.4, weight: 8.2 },
        { movie: watched[1], rating: 9, zScore: 0.5, weight: 8.5 },
        { movie: watched[2], rating: 8, zScore: 0.1, weight: 9.8 },
        { movie: watched[3], rating: 5, zScore: -1.6, weight: 3.1 },
    ];
    const prompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi"], weightedRatings },
        "any",
        [{ tmdbId: 999, id: 999, title: "Candidate X", year: "2025", director: "Dir X", genre: "Sci-Fi", overview: "Test plot." }],
        { watched }
    );
    assert.ok(prompt.includes('"Relative Letdown Five" (2022) [5/10]'), "Must surface rating 5 with zScore < -0.4 from nested movie shape");
    assert.ok(prompt.indexOf('"Time Decayed Recent"') < prompt.indexOf('"Generous Pick A"'), "Must sort anchors using runtime weight (9.8 > 8.2)");
});
```

```js
// In tests/pipelineBugs.test.js
test("generateProfileHash invalidates when userNote changes while keeping empty-note hashes unchanged", () => {
    const baseWatched = [{ tmdbId: 550, title: "Fight Club", userRating: 9 }];
    const withEmptyNote = [{ tmdbId: 550, title: "Fight Club", userRating: 9, userNote: "   " }];
    const withNoteA = [{ tmdbId: 550, title: "Fight Club", userRating: 9, userNote: "Loved the twist" }];
    const withNoteB = [{ tmdbId: 550, title: "Fight Club", userRating: 9, userNote: "Too dark on rewatch" }];

    assert.equal(generateProfileHash({}, [], "any", [], null, "US", baseWatched), generateProfileHash({}, [], "any", [], null, "US", withEmptyNote));
    assert.notEqual(generateProfileHash({}, [], "any", [], null, "US", baseWatched), generateProfileHash({}, [], "any", [], null, "US", withNoteA));
    assert.notEqual(generateProfileHash({}, [], "any", [], null, "US", withNoteA), generateProfileHash({}, [], "any", [], null, "US", withNoteB));
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:
```bash
node --test tests/geminiDualEngine.test.js tests/pipelineBugs.test.js
```
Expected: FAIL — `Relative Letdown Five` missing from Disliked section (`zScore` unresolved from nested `weightedRatings`), `Time Decayed Recent` ranked behind `Generous Pick A`, and `generateProfileHash` returns identical hash for `baseWatched` vs `withNoteA`.

- [ ] **Step 3: Implement nested-shape lookup, weight fallback, and conditional note hashing in `src/services/geminiService.js`**

1. Extract a tiny `hashStringFnv1a(str)` helper right above `buildWatchedHashSegment` (`src/services/geminiService.js:1046-1070`) reusing the existing FNV-1a math, and update `buildWatchedHashSegment` so each token computes:
   ```js
   const notePart = String(m.userNote || m.notes || "").trim().replace(/\s+/g, " ").toLowerCase();
   const baseToken = `${idPart}:${ratingPart}`;
   return notePart ? `${baseToken}:${hashStringFnv1a(notePart)}` : baseToken;
   ```
   When notes are empty/whitespace, `buildWatchedHashSegment` produces exact historical `vlt_...` hashes.
2. Update `buildMovieIdentityLookup` (`src/services/geminiService.js:1122-1161`) to inspect both `item` and `item.movie` (when present):
   ```js
   const sources = item?.movie && typeof item.movie === "object" ? [item, item.movie] : [item];
   ```
   Register every valid `tmdbNum`, `imdb`, and `title::year` / `title::` key across `sources` pointing to `item` (preserves priority order cleanly for both runtime `{ movie, weight, zScore }` and test `{ tmdbId, title, finalWeight, zScore }` shapes).
3. Update `selectMoodStratifiedAnchors` (`src/services/geminiService.js:1182-1185`):
   ```js
   const weighted = lookupWeighted(movie);
   const rawWeight = weighted?.weight ?? weighted?.finalWeight;
   const weight = Number.isFinite(Number(rawWeight))
       ? Number(rawWeight)
       : rating;
   ```
4. Verify `selectDislikedOrDismissedFilms` (`src/services/geminiService.js:1248-1266`) resolves `zScore = Number(weighted?.zScore)` cleanly from the updated `lookupWeighted(movie)`.

- [ ] **Step 4: Run targeted tests and full suite**

Run (PowerShell):
```powershell
node --test tests/geminiDualEngine.test.js tests/pipelineBugs.test.js; if ($LASTEXITCODE -eq 0) { npm test }
```
Expected: All existing `234` tests plus the 2 new tests PASS (`fail 0 | skipped 0`).

- [ ] **Step 5: Commit Task 1**

```bash
git add src/services/geminiService.js tests/geminiDualEngine.test.js tests/pipelineBugs.test.js
git commit -m "fix(gemini): resolve nested weightedRatings lookup and hash user notes for cache"
```

---

### Task 2: Preserve Rich TMDB Candidate & Backfilled Vault Metadata (`tmdbService.js`)

**Why this matters:** `formatTmdbMovieDetails` (`src/services/tmdbService.js:1184-1223`) already fetches `cast`, `writers`, `tagline`, `originCountry`, `spokenLanguages`, `mpaaRating`, `runtimeMinutes`, `keywordNames`, and `plot`. However, `applyDetailsToCandidate` (`L1514-1547`) drops `cast`, `writers`, `tagline`, `originCountry`, `spokenLanguages`, `mpaaRating`, and does not fall back to `details.plot`; `fetchEmbeddingCandidates` (`L1686-1715`) similarly strips them from Bucket E cold/semantic candidates; and `mergeBackfilledMovieMetadata` (`L1778-1818`) omits `cast`, `keywordNames`, `runtimeMinutes`, and `spokenLanguages` when enriching vault items. Fixing this feeds rich real-world signal to Gemini without extra API calls!

**Files:**
- Modify: `src/services/tmdbService.js:1514-1547` (`applyDetailsToCandidate`), `1686-1715` (`fetchEmbeddingCandidates`), `1778-1818` (`mergeBackfilledMovieMetadata`)
- Test: `tests/pipelineBugs.test.js` (verify metadata preservation through hydration and backfill merge)

**Interfaces:**
- Consumes: formatted detail object from `formatTmdbMovieDetails` (`{ cast, writers, tagline, originCountry, spokenLanguages, mpaaRating, runtimeMinutes, keywordNames, plot }`) and embedding rows.
- Produces: candidate and vault objects carrying non-empty `cast`, `writers`, `tagline`, `originCountry`, `spokenLanguages`, `mpaaRating`, `runtimeMinutes`, `keywordNames`, and non-empty `overview`.

- [ ] **Step 1: Export `applyDetailsToCandidate` and `mergeBackfilledMovieMetadata` (if not already exported) and write failing tests**

Export `applyDetailsToCandidate` and `mergeBackfilledMovieMetadata` from `src/services/tmdbService.js` (checking existing exports first), then add unit tests in `tests/pipelineBugs.test.js`:

```js
test("applyDetailsToCandidate and mergeBackfilledMovieMetadata preserve cast, themes, tagline, runtime, language, origin, and overview fallback", () => {
    const candidate = { id: 9001, tmdbId: 9001, title: "Cold Gem", overview: "" };
    const details = {
        director: "Denis Villeneuve",
        cast: ["Amy Adams", "Jeremy Renner", "Forest Whitaker", "Michael Stuhlbarg"],
        writers: ["Eric Heisserer"],
        tagline: "Why are they here?",
        originCountry: ["US"],
        spokenLanguages: ["English", "Mandarin"],
        mpaaRating: "PG-13",
        runtimeMinutes: 116,
        keywordNames: ["first contact", "linguistics", "non-linear timeline"],
        plot: "A linguist works with the military to communicate with alien lifeforms.",
    };
    const merged = applyDetailsToCandidate(candidate, details);
    assert.deepEqual(merged.cast, details.cast);
    assert.deepEqual(merged.writers, details.writers);
    assert.equal(merged.tagline, details.tagline);
    assert.deepEqual(merged.spokenLanguages, details.spokenLanguages);
    assert.deepEqual(merged.originCountry, details.originCountry);
    assert.equal(merged.mpaaRating, "PG-13");
    assert.equal(merged.runtimeMinutes, 116);
    assert.deepEqual(merged.keywordNames, details.keywordNames);
    assert.equal(merged.overview, details.plot);

    const vaultItem = { title: "Cold Gem", userRating: 9, userNote: "Keep my note" };
    const backfilled = mergeBackfilledMovieMetadata(vaultItem, 9001, details, null);
    assert.equal(backfilled.userNote, "Keep my note");
    assert.deepEqual(backfilled.cast, details.cast);
    assert.deepEqual(backfilled.keywordNames, details.keywordNames);
    assert.equal(backfilled.runtimeMinutes, 116);
    assert.deepEqual(backfilled.spokenLanguages, details.spokenLanguages);
});
```

- [ ] **Step 2: Run the test to confirm failure**

Run:
```bash
node --test tests/pipelineBugs.test.js
```
Expected: FAIL — `merged.cast`, `merged.tagline`, `merged.spokenLanguages`, and `merged.overview` are `undefined` or `""`.

- [ ] **Step 3: Implement a shared `pickEnrichedDetails(existing, details)` helper and wire into `applyDetailsToCandidate`, `fetchEmbeddingCandidates`, and `mergeBackfilledMovieMetadata` in `src/services/tmdbService.js`**

1. Create one tiny internal helper `pickEnrichedDetails(existing = {}, details = {})` in `src/services/tmdbService.js` that returns non-empty normalized fields:
   - `cast`: `Array.isArray(details.cast) && details.cast.length > 0 ? details.cast.slice(0, 5) : (existing.cast || [])`
   - `writers`: `Array.isArray(details.writers) && details.writers.length > 0 ? details.writers.slice(0, 3) : (existing.writers || [])`
   - `tagline`: `details.tagline || existing.tagline || ""`
   - `mpaaRating`: `details.mpaaRating || existing.mpaaRating || ""`
   - `originCountry`: `Array.isArray(details.originCountry) && details.originCountry.length > 0 ? details.originCountry : (existing.originCountry || [])`
   - `spokenLanguages`: `Array.isArray(details.spokenLanguages) && details.spokenLanguages.length > 0 ? details.spokenLanguages : (existing.spokenLanguages || [])`
   - `keywordNames`: `Array.isArray(details.keywordNames) && details.keywordNames.length > 0 ? details.keywordNames : (existing.keywordNames || [])`
   - `runtimeMinutes`: `details.runtimeMinutes ?? existing.runtimeMinutes ?? null`
2. Apply `...pickEnrichedDetails(existing, details)` inside:
   - `applyDetailsToCandidate` (`L1525-1546`), plus `overview: existing.overview || details.plot || ""`
   - `fetchEmbeddingCandidates` (`L1686-1715`) so Bucket E candidates get identical rich fields
   - `mergeBackfilledMovieMetadata` (`L1804-1815`) so vault items keep `cast`, `keywordNames`, `runtimeMinutes`, `spokenLanguages`, `tagline` without touching user ratings, dates, or `userNote` (leave `hasCompleteTmdbMetadata` untouched so existing vaults aren't needlessly re-fetched).
3. Check `normalizeTmdbItem` (`src/services/tmdbService.js`) and preserve `spokenLanguages: item.original_language ? [item.original_language] : []` on unhydrated discover candidates when `spokenLanguages` is absent.

- [ ] **Step 4: Run targeted tests and full suite**

Run (PowerShell):
```powershell
node --test tests/pipelineBugs.test.js; if ($LASTEXITCODE -eq 0) { npm test }
```
Expected: PASS across all suites (`fail 0 | skipped 0`).

- [ ] **Step 5: Commit Task 2**

```bash
git add src/services/tmdbService.js tests/pipelineBugs.test.js
git commit -m "feat(tmdb): preserve rich cast, tagline, language, runtime, and keyword metadata"
```

---

### Task 3: Enrich Vault Context in `buildGeminiReRankPrompt` — Verified `extractTasteProfile` Shapes, Dislikes, Near Misses, Watchlist & `180`-Char Notes (`geminiService.js`)

**Why this matters:** Right now `buildGeminiReRankPrompt` (`src/services/geminiService.js:1431-1507`) clips `userNote` to `80` chars on Favorite anchors, drops `userNote` completely on Dislikes, Near Misses, and Recent Watch Streak, never tells Gemini the user's rating scale (`profile.userStats.mean`, e.g., `7.8/10` across `122` ratings so a `5/10` is a strong dislike), hides `profile.topDirectors` (`string[]`), hides `[Series]` tags via `isSeriesVaultItem`, and hides `context.watchlist` ( films the user already wants to watch!). Supporting the exact runtime field shapes from `extractTasteProfile` ensures this fires in live production, not just synthetic tests.

**Files:**
- Modify: `src/services/geminiService.js:1239-1295` (`selectDislikedOrDismissedFilms`), `1375-1429` (`selectNearMissFilms`), `1431-1460` (`buildGeminiReRankPrompt` user taste section)
- Test: `tests/geminiDualEngine.test.js`

**Interfaces:**
- Consumes: real `profile` (`lovedGenreNames` / `genres`, `topDirectors` as `string[]` OR `{ name }[]`, `userStats` / `ratingStats`, `weightedRatings`), `context.watched` (with optional `userNote`/`notes`, `mediaType`/`Type`, `director`, `genre`), `context.watchlist`.
- Produces: enriched `USER TASTE PROFILE`, `USER'S FAVORITE ANCHOR FILMS`, `USER'S DISLIKED / DISMISSED FILMS`, `NEAR MISSES`, `RECENT WATCH STREAK`, and optional `USER'S WATCHLIST` prompt sections while preserving every existing section header and `[N/10]` / `[dismissed: ...]` substring contract.

- [ ] **Step 1: Write failing tests for real `extractTasteProfile` shapes, `userNote` across all buckets (180-char cap), `[Series]`, rating baseline, top directors, and watchlist**

Add assertions in `tests/geminiDualEngine.test.js` using exact 4-arg `buildGeminiReRankPrompt(profile, mood, candidates, context)`:

```js
test("buildGeminiReRankPrompt handles real extractTasteProfile shapes, notes on dislikes/near-misses, [Series], and watchlist", () => {
    const watched = [
        {
            tmdbId: 1,
            title: "Dark",
            year: "2017–2020",
            Type: "series",
            userRating: 10,
            director: "Baran bo Odar",
            genre: "Sci-Fi, Mystery",
            userNote: "Tight puzzle-box time travel where every clue pays off cleanly without filler."
        },
        {
            tmdbId: 2,
            title: "Parasite",
            year: "2019",
            userRating: 5,
            genre: "Thriller, Drama",
            userNote: "Great filmmaking craft but hated the grim bleak tone"
        },
        {
            tmdbId: 3,
            title: "Tenet",
            year: "2020",
            userRating: 7,
            director: "Christopher Nolan",
            genre: "Sci-Fi, Action",
            userNote: "Cool premise but cold characters and muddy audio"
        },
    ];
    // Real runtime extractTasteProfile shape: topDirectors is string[], rating stats live under userStats
    const profile = {
        lovedGenreNames: ["Sci-Fi", "Thriller"],
        topDirectors: ["Christopher Nolan", "Denis Villeneuve"],
        userStats: { mean: 8.1, std: 1.4, count: 120 },
        weightedRatings: [
            { movie: watched[0], rating: 10, zScore: 1.3, weight: 10.5 },
            { movie: watched[1], rating: 5, zScore: -2.2, weight: 2.0 },
            { movie: watched[2], rating: 7, zScore: -0.7, weight: 6.4 },
        ],
    };
    const watchlist = [{ tmdbId: 90, title: "Severance", year: "2022", mediaType: "tv" }];
    const candidates = [{ tmdbId: 500, id: 500, title: "Coherence", year: "2013", genre: "Sci-Fi", overview: "Dinner party anomaly." }];

    const prompt = buildGeminiReRankPrompt(profile, "mind-bending", candidates, { watched, watchlist });

    assert.ok(prompt.includes('"Dark" (2017–2020) [10/10] [Series]'), "Anchor keeps [10/10] immediately after year and adds [Series]");
    assert.ok(prompt.includes("Tight puzzle-box time travel where every clue pays off cleanly without filler."), "Anchor preserves 180-char userNote");
    assert.ok(prompt.includes('"Parasite" (2019) [5/10]'), "Dislike keeps [5/10] contract");
    assert.ok(prompt.includes("hated the grim bleak tone"), "Dislike includes userNote");
    assert.ok(prompt.includes('"Tenet" (2020) [7/10'), "Near Miss keeps [7/10 contract");
    assert.ok(prompt.includes("cold characters and muddy audio"), "Near Miss includes userNote");
    assert.ok(prompt.includes("8.1/10"), "Rating baseline from real userStats.mean");
    assert.ok(prompt.includes("Christopher Nolan, Denis Villeneuve"), "Handles string[] topDirectors from extractTasteProfile");
    assert.ok(prompt.includes("Severance"), "Watchlist signal included when non-empty");
});
```

- [ ] **Step 2: Run targeted test to confirm failure**

Run:
```bash
node --test tests/geminiDualEngine.test.js
```
Expected: FAIL — missing dislike note, near-miss note, `[Series]`, `8.1/10`, `Christopher Nolan, Denis Villeneuve`, and `Severance`.

- [ ] **Step 3: Implement shared note/series formatters and real-shape user profile lines in `src/services/geminiService.js`**

1. Extract two small helpers right above `selectDislikedOrDismissedFilms` (importing `isSeriesVaultItem` from `./tmdbService.js`):
   - `formatSeriesTag(m)` -> `isSeriesVaultItem(m) ? " [Series]" : ""`
   - `formatNoteSuffix(m, maxLen = 180)` -> extracts `m?.userNote || m?.notes`, cleans via `cleanStr(..., maxLen)` -> returns ` - Note: "${note}"` or `""`.
   - `extractDirectorNames(rawDirectors = [])` -> maps `(d) => (typeof d === "string" ? cleanStr(d) : cleanStr(d?.name || ""))`, filters non-empty, `.slice(0, 4)`.
2. Update `selectDislikedOrDismissedFilms` (`L1239-1265`): keep exact `"- \"${cleanStr(m.title)}\" (${m.year || m.Year || \"N/A\"}) [${m.userRating}/10]"` and `"[${tag}]"` prefixes (so `tests/geminiDualEngine.test.js:798-800` substring assertions always pass!), appending `${formatSeriesTag(movie)}${formatNoteSuffix(movie, 180)}` right after `]`.
3. Update `selectNearMissFilms` (`L1420-1425`): keep exact `"- \"${cleanStr(title)}\" (${yr}) [${rating}/10${genreNote}]"`, appending `${formatSeriesTag(movie)}${formatNoteSuffix(movie, 180)}` right after `]`.
4. Update `buildGeminiReRankPrompt` (`L1431-1486`):
   - **Anchors:** keep `"- \"${cleanStr(m.title)}\" (${m.year || m.Year || \"N/A\"}) [${m.userRating}/10]"` first (matching `/"Interstellar" \(2014\) \[10\/10\]/` in `tests/geminiDualEngine.test.js:199`!), then append `${formatSeriesTag(m)}${compactMeta}${formatNoteSuffix(m, 180)}` where `compactMeta` adds concise ` [Dir: X | Genre]` only if present.
   - **Recent Watch Streak:** append `${formatSeriesTag(m)}${formatNoteSuffix(m, 120)}`.
   - **User Taste Profile additions (omitted gracefully when absent):**
     - `ratingStats`: read `const stats = profile?.userStats || profile?.ratingStats;` -> emit `- Rating Baseline: Avg ${Number(stats.mean).toFixed(1)}/10 across ${stats.count || profile?.totalRated || watched.length} ratings (treat <=5/10 as strong dislikes)` when `stats?.count > 0 && Number.isFinite(Number(stats.mean))`.
     - `topDirectors`: read `extractDirectorNames(profile?.topDirectors)` -> emit `- Favorite Directors: ${dirNames.join(", ")}` when non-empty.
     - `USER'S WATCHLIST`: emit `\nUSER'S WATCHLIST (Stated interest — excluded from candidates):\n${watchlistLines.join("\n")}` for up to 8 unique titles from `context?.watchlist` (`"${cleanStr(m.title)}" (${m.year || "N/A"})${formatSeriesTag(m)}`) when non-empty.

- [ ] **Step 4: Run targeted tests and full suite**

Run (PowerShell):
```powershell
node --test tests/geminiDualEngine.test.js tests/pipelineBugs.test.js; if ($LASTEXITCODE -eq 0) { npm test }
```
Expected: All tests PASS (`fail 0 | skipped 0`).

- [ ] **Step 5: Commit Task 3**

```bash
git add src/services/geminiService.js tests/geminiDualEngine.test.js
git commit -m "feat(gemini): surface real taste profile stats, directors, watchlist, series tags, and 180-char notes"
```

---

### Task 4: Compact Candidate Metadata (`< 18,000` Chars Budget) & Balanced `#1–#15` / `#16–#30` Curation Rules (`geminiService.js`)

**Why this matters:** Right now each of the 30 candidates sent to Gemini gets only `overview.slice(0, 140)` (chopping plots mid-sentence) plus ID/title/year/director/Calibrated Match%/genre/vote/matchReasons—dropping `cast`, `keywordNames`, `runtimeMinutes`, `spokenLanguages`/`originCountry`, and `tagline` preserved in Task 2. At the same time, bloated candidate lines (>20k–36k chars) increase latency and timeout risk on `gemini-4-hydrogen` (35s HIGH) and Flash (15s). Keeping candidates tightly bounded (`Plot <= 250`, top `5` `Themes`, top `3` `Cast`, `Tagline <= 70`, omit `originCountry` when `spokenLanguages` exists) keeps a full 30-candidate + full-vault prompt strictly **`< 18,000` chars** (~4,000–4,500 tokens), while instructing Gemini to respect `#1–#15` ranker strength and selectively promote `#16–#30` cold-start fits or veto tonal clashes.

**Files:**
- Modify: `src/services/geminiService.js:1458-1507` (`buildGeminiReRankPrompt` candidate formatter & instructions)
- Test: `tests/geminiDualEngine.test.js`

**Interfaces:**
- Consumes: hydrated Top 30 candidate array (`id`, `tmdbId`, `title`, `year`, `director`, `matchScore`, `genre`, `vote_average`, `vote_count`, `matchReasons`, `runtimeMinutes`, `spokenLanguages`, `originCountry`, `cast`, `keywordNames`, `tagline`, `overview`).
- Produces: compact prompt `< 18,000` chars containing high-signal candidate metadata, balanced `#1–#15` core + `#16–#30` promotion/veto curation rules, and preserved regex contracts (`PRE-RANKED CANDIDATE MOVIES (Top N)`, `select 10 distinct`, `Array of 10 items`, `Do NOT invent or include scores`).

- [ ] **Step 1: Write failing tests for compact candidate lines, balanced curation rule, `originCountry` deduplication, and `< 18,000`-char worst-case budget**

Add tests in `tests/geminiDualEngine.test.js`:

```js
test("buildGeminiReRankPrompt formats compact candidate metadata, balances #1-15 vs #16-30 promotion/veto rules, and stays under 18k chars", () => {
    const longOverview = "A".repeat(160) + " climax twist about memory loops." + "Z".repeat(200);
    const baseCandidate = {
        tmdbId: 888,
        id: 888,
        title: "Looper Two",
        year: "2025",
        director: "Rian Johnson",
        matchScore: 76,
        genre: "Sci-Fi, Thriller",
        vote_average: 7.9,
        vote_count: 1400,
        runtimeMinutes: 118,
        spokenLanguages: ["English"],
        originCountry: ["US"],
        cast: ["Joseph Gordon-Levitt", "Emily Blunt", "Bruce Willis", "Jeff Daniels"],
        keywordNames: ["time travel", "hitman", "noir", "loop", "dystopia", "extra-sixth-tag"],
        tagline: "Hunted by your future in a city where time itself has a price tag on every second.",
        matchReasons: ["Recent cold-start gem"],
        overview: longOverview,
    };

    const prompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi"] },
        "any",
        [baseCandidate],
        { watched: [{ tmdbId: 1, title: "Matrix", year: "1999", userRating: 10 }] }
    );

    assert.ok(prompt.includes("118m"), "Includes candidate runtime");
    assert.ok(prompt.includes("English"), "Includes candidate language");
    assert.ok(!prompt.includes("English | US"), "Omits redundant originCountry when spokenLanguages is present");
    assert.ok(prompt.includes("Joseph Gordon-Levitt, Emily Blunt, Bruce Willis"), "Includes top 3 cast");
    assert.ok(!prompt.includes("Jeff Daniels"), "Caps cast at 3 names");
    assert.ok(prompt.includes("time travel, hitman, noir, loop, dystopia"), "Includes top 5 themes");
    assert.ok(!prompt.includes("extra-sixth-tag"), "Caps themes at 5 keywords");
    assert.ok(prompt.includes("climax twist about memory loops."), "Includes plot up to 250 chars");
    assert.ok(!prompt.includes("Z".repeat(100)), "Caps plot at 250 chars");
    assert.match(prompt, /#1[–-]#?15/i, "Explicitly instructs Gemini to favor #1–#15 ranker picks by default");
    assert.match(prompt, /#16[–-]#?30/i, "Explicitly scopes promotion to #16–#30 fits and vetoing clashes");

    // Worst-case 30 candidates + 10 anchors + 5 dislikes + 3 recent + 4 near misses + 8 watchlist
    const fullWatched = [
        ...Array.from({ length: 10 }, (_, i) => ({ tmdbId: i + 1, title: `Anchor Film ${i + 1}`, year: "2020", userRating: 10, director: "Director Name", genre: "Sci-Fi, Thriller", userNote: "A".repeat(180) })),
        ...Array.from({ length: 5 }, (_, i) => ({ tmdbId: i + 20, title: `Dislike Film ${i + 1}`, year: "2021", userRating: 3, genre: "Horror", userNote: "B".repeat(180) })),
        ...Array.from({ length: 4 }, (_, i) => ({ tmdbId: i + 30, title: `Near Miss ${i + 1}`, year: "2022", userRating: 7, genre: "Drama", userNote: "C".repeat(180) })),
    ];
    const thirtyRich = Array.from({ length: 30 }, (_, idx) => ({
        ...baseCandidate,
        tmdbId: 900 + idx,
        id: 900 + idx,
        title: `Rich Candidate Title ${idx + 1}`,
        overview: "D".repeat(500),
    }));
    const fullWatchlist = Array.from({ length: 8 }, (_, i) => ({ tmdbId: 50 + i, title: `Watchlist Movie ${i + 1}`, year: "2024" }));
    const fullPrompt = buildGeminiReRankPrompt(
        { lovedGenreNames: ["Sci-Fi", "Thriller", "Action"], topDirectors: ["Denis Villeneuve", "Christopher Nolan", "Ridley Scott"], userStats: { mean: 7.8, std: 1.5, count: 122 } },
        "any",
        thirtyRich,
        { watched: fullWatched, watchlist: fullWatchlist }
    );
    assert.ok(fullPrompt.length < 18000, `Expected worst-case 30-candidate prompt < 18000 chars, got ${fullPrompt.length}`);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
node --test tests/geminiDualEngine.test.js
```
Expected: FAIL — missing runtime, language, cast, keywords, tagline, 250-char plot, and `#1–#15` / `#16–#30` balanced curation rule.

- [ ] **Step 3: Implement `formatCandidatePromptBlock(c)` and balanced curation instructions in `src/services/geminiService.js:1458-1507`**

1. Add a concise helper `formatCandidatePromptBlock(c)` that formats:
   - Base fields: `ID: ${c.id || c.tmdbId} | "${cleanStr(c.title)}" (${c.year})${directorStr} | Calibrated Match: ${matchDisplay} | Genres: ${c.genre} | TMDB: ${c.vote_average || "N/A"}/10${votesStr}${badgesStr}`
   - `Specs`: `[${specsParts.join(" | ")}]` using `runtimeMinutes` (`${c.runtimeMinutes}m`) and `spokenLanguages.slice(0, 2)` — include `originCountry.slice(0, 2)` **only** if `spokenLanguages` is empty
   - `Cast`: top 3 actors (`c.cast.slice(0, 3).join(", ")`) when non-empty
   - `Themes`: top 5 TMDB keywords (`c.keywordNames.slice(0, 5).join(", ")`) when non-empty
   - `Tagline`: `"${cleanStr(c.tagline).slice(0, 70)}"` when non-empty
   - `Plot`: `cleanStr(c.overview || c.plot || "").slice(0, 250)` (omit if empty)
2. Update prompt instructions (`L1490-1507`) while preserving all tested regex strings (`PRE-RANKED CANDIDATE MOVIES`, `select 10 distinct`, `Array of 10 items`, `Do NOT invent scores`, 1-sentence reason, `anchorTitles`, anti-jargon rule):
   - Add explicit curation guidance:
     - Favor the **#1–#15** mathematically ranked picks by default; promote a **#16–#30** candidate (especially recent post-2023 releases without historical co-rating depth) **only when** its Plot, Themes, Cast, and Tone clearly match the user's anchor notes or favorite themes better, OR when replacing a **#1–#15** candidate you **veto** because its Themes/Plot/Tone clash with Disliked or Near-Miss user notes.
     - Keep director diversity clean (max 2 picks per director unless deeply core).

- [ ] **Step 4: Run full test suite & verify `< 18,000` char budget and zero regressions**

Run (PowerShell):
```powershell
node --test tests/geminiDualEngine.test.js tests/pipelineBugs.test.js; if ($LASTEXITCODE -eq 0) { npm test }
```
Expected: PASS across all tests (`fail 0 | skipped 0`).

- [ ] **Step 5: Commit Task 4**

```bash
git add src/services/geminiService.js tests/geminiDualEngine.test.js
git commit -m "feat(gemini): add compact candidate signals (<18k chars) and balanced #1-15 vs #16-30 curation rules"
```

---

### Task 5: Effortless "Why I Liked / Disliked It" Note Capture UX (`quickReviewTags.js`, `QuickRateModal.jsx`, `MovieDetails.jsx`)

**Why this matters:** Prompts can only connect the user's real reasons if writing a 1–2 line note takes 3 seconds instead of feeling like homework. Currently `QuickRateModal.jsx:150-158` caps notes at `180` chars with no clickable tags, while `MovieDetails.jsx:40-51, 371-378, 610-635` defines only positive `QUICK_TAGS` inline (so 4/10–7/10 ratings lack quick warning tags like `SlowPacing`, `WeakEnding`, `TooBleak`) and never tells users that Gemini reads this note.

**Files:**
- Create: `src/services/quickReviewTags.js` (shared `QUICK_REVIEW_TAGS` matching exact `MovieDetails` no-`#` id format + `#hashtag` storage helper `toggleQuickTagInNote(currentNote, tag, maxLen = 200)`)
- Modify: `src/components/QuickRateModal.jsx:1-195` (raise `maxLength` to `200`, clearer AI-note placeholder, compact 1-click quick tags row using shared helper)
- Modify: `src/components/MovieDetails.jsx:40-51, 371-378, 606-635` (import `QUICK_REVIEW_TAGS` + `toggleQuickTagInNote` instead of duplicating inline array/regex logic, update placeholder to explain AI taste signal)
- Test: `tests/quickReviewTags.test.js`

**Interfaces:**
- Consumes: `currentNote` string + tag key (with or without leading `#`).
- Produces: clean toggled note string within `maxLen` (`200` for `QuickRateModal`, unbounded/`500` for `MovieDetails`).

- [ ] **Step 1: Write failing tests for shared quick review tags & toggle helper (`tests/quickReviewTags.test.js`)**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { QUICK_REVIEW_TAGS, toggleQuickTagInNote } from "../src/services/quickReviewTags.js";

test("QUICK_REVIEW_TAGS preserves existing positive keys and adds constructive critique tags", () => {
    const ids = QUICK_REVIEW_TAGS.map((t) => t.id);
    assert.ok(ids.includes("Masterpiece"));
    assert.ok(ids.includes("MindBlowing"));
    assert.ok(ids.includes("SlowPacing"));
    assert.ok(ids.includes("WeakEnding"));
    assert.ok(ids.includes("TooBleak"));
});

test("toggleQuickTagInNote formats hashtags cleanly, toggles off without orphan spaces, and enforces maxLength", () => {
    const added = toggleQuickTagInNote("Great twist", "SmartPlot", 200);
    assert.equal(added, "Great twist #SmartPlot");
    const removed = toggleQuickTagInNote(added, "#SmartPlot", 200);
    assert.equal(removed, "Great twist");

    const nearLimit = "x".repeat(195);
    assert.equal(toggleQuickTagInNote(nearLimit, "Masterpiece", 200), nearLimit, "Does not overflow maxLength");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
node --test tests/quickReviewTags.test.js
```
Expected: FAIL — `Cannot find module '../src/services/quickReviewTags.js'`.

- [ ] **Step 3: Create `src/services/quickReviewTags.js` and wire into `QuickRateModal.jsx` and `MovieDetails.jsx`**

1. Create `src/services/quickReviewTags.js`:
   - Export `QUICK_REVIEW_TAGS` preserving every existing key from `MovieDetails.jsx` (`Masterpiece`, `MindBlowing`, `GreatActing`, `Cinematography`, `EpicScore`, `PlotTwist`, `MustRewatch`, `Emotional`, `CultClassic`, `Iconic`) plus constructive/tonal tags (`SmartPlot`, `TightPacing`, `SlowPacing`, `WeakEnding`, `TooBleak`, `StyleOverSubstance`) with `{ id, sentiment: "positive" | "critique" }`.
   - Export pure `toggleQuickTagInNote(currentNote, rawTag, maxLen = 500)`: normalizes `formattedTag = rawTag.startsWith("#") ? rawTag : \`#${rawTag}\``; removes cleanly if already present; appends `" " + formattedTag` if `next.length <= maxLen`, else returns `currentNote` unchanged.
2. In `src/components/MovieDetails.jsx`:
   - Replace inline `QUICK_TAGS` (`L40-51`) and inline `handleToggleTag` string logic (`L371-378`) with imports `QUICK_REVIEW_TAGS` and `toggleQuickTagInNote` from `../services/quickReviewTags`.
   - Update textarea placeholder (`L629`) to: `"1–2 lines on why you liked or disliked it (Gemini reads this to sharpen picks)..."`.
3. In `src/components/QuickRateModal.jsx` (`L150-158`):
   - Raise `maxLength` from `180` to `200`.
   - Update placeholder to: `"Why you liked or disliked it (1–2 lines for AI)..."`.
   - Add a compact row of contextual `QUICK_REVIEW_TAGS` (shows top praise + critique chips—or prioritizes `critique` chips when `activeRating > 0 && activeRating < 7`) wired to `toggleQuickTagInNote(note, item.id, 200)`.

- [ ] **Step 4: Run targeted test, full test suite, and production build**

Run (PowerShell):
```powershell
node --test tests/quickReviewTags.test.js; if ($LASTEXITCODE -eq 0) { npm test }; if ($LASTEXITCODE -eq 0) { npm run build }
```
Expected: All tests PASS (`234+` passing, `0` failed, `0` skipped) and Vite production build exits with code `0`.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/services/quickReviewTags.js src/components/QuickRateModal.jsx src/components/MovieDetails.jsx tests/quickReviewTags.test.js
git commit -m "feat(ui): share praise/critique quick review tags and raise QuickRate note cap to 200"
```

---

### Post-Implementation Verification Checklist

1. Run full test suite: `npm test` — confirm `0` failures, `0` skipped assertions, and untouched `evalRanker.test.js` Clean1+Clean2 benchmark pass.
2. Run production build: `npm run build` — confirm clean Vite bundle with zero errors.
3. Run prompt inspection check against the repaired vault JSON (`cinemavault-backup-2026-11-14.json`): execute a one-shot Node check running `extractTasteProfile` + `buildGeminiReRankPrompt` on 30 realistic hydrated candidates, verifying:
   - Total prompt length `< 18,000` chars
   - Real `5/10` relative dislikes (`Spirited Away`, `Parasite`, `The Conjuring: Last Rites`, `Cars 2`) appear under `USER'S DISLIKED / DISMISSED FILMS`
   - Real `topDirectors`, `userStats.mean`, `[Series]`, `watchlist`, and candidate `Cast`/`Themes`/`Specs`/`Tagline`/`Plot` render cleanly.
4. Optional future follow-up (out of scope for this plan): background `content_embeddings` coverage expansion or showing Gemini's curation pick priority alongside deterministic `matchScore`.
