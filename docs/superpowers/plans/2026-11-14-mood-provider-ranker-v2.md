# Phase 2: Mood Separation, Ranker Rebalancing, Strict Streaming Provider Filtering & `main` Integration Implementation Plan

> **Working Directory for Tasks 1–4:** `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks` (branch `feat/mood-and-ten-picks`, currently at commit `f3e201d`).
> **Main Checkout for Task 5 merge:** `g:\Important Projects\movie-ratings` (branch `main`, currently at commit `c755949`). Preserve uncommitted files in `.agents/skills/project-explainer/` and `scripts/experiments/`.

## Key Invariant (CRITICAL)
When `mood === "any"`, `moodFilters` has no custom constraints, and `userProviders` is empty (`[]`), `rankCandidatePool` MUST remain **100% bit-for-bit identical** to current behavior so `tests/evalRanker.test.js` (16/16) and `tests/recentReleaseSlots.test.js` pass without relaxing assertions.

---

## Task 1: Non-Overlapping Mood Genre Gates & Streaming Provider Family Expansion (`moodPolicy.js` & `tmdbService.js`)

**Files:**
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\services\moodPolicy.js`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\services\tmdbService.js`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\tests\moodPolicy.test.js`

### Step 1.1: Write failing unit tests in `tests/moodPolicy.test.js`
Append tests to `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\tests\moodPolicy.test.js`:
1. Import `matchesMoodCandidateGate` from `../src/services/moodPolicy.js` and `expandProviderIds`, `matchesWatchProviders` from `../src/services/tmdbService.js`.
2. Test `matchesMoodCandidateGate`:
   - Rejects *V for Vendetta* (`genre_ids: [28, 53, 878]`) and *The Wolf of Wall Street* (`genre_ids: [80, 18, 35]`) for `"comfort-watch"`, while accepting *Amélie* (`genre_ids: [35, 10749]`).
   - Separates `"mind-bending"` from `"dark-thriller"` and `"fun-popcorn"`:
     - *The Martian* (`[18, 12, 878]`) and *Edge of Tomorrow* (`[28, 878]`) pass `"fun-popcorn"`, fail `"dark-thriller"`.
     - *Ex Machina* (`[18, 878, 9648]`) passes `"mind-bending"`, fails `"dark-thriller"` (because `878` is in `dark-thriller`'s `withoutGenreIds`) and fails `"fun-popcorn"`.
     - *Prisoners* (`[80, 53, 18]`) passes `"dark-thriller"`, fails `"fun-popcorn"` and `"comfort-watch"`.
   - Enforces `voteCountLte: 2000` on `"hidden-gem"` (rejects *Moon* with `vote_count: 6155`, accepts *Coherence* with `vote_count: 1450` and `vote_average: 7.4`).
3. Test `expandProviderIds` & `matchesWatchProviders`:
   - `expandProviderIds([8, 1899])` includes `8`, `1796` (Netflix basic with ads), `1899` (Max), `384` (HBO Max), `1825` (Max Amazon Channel).
   - `matchesWatchProviders` rejects *Deadpool* (`streamProviders: [{ provider_id: 337, provider_name: "Disney Plus" }]`, `providersHydrated: true`) when `selectedProviders = [8, 1899]`.
   - `matchesWatchProviders` accepts a movie with `streamProviders: [{ provider_id: 1796, provider_name: "Netflix Standard with Ads" }]` when `selectedProviders = [8]`.
   - `matchesWatchProviders` accepts an unhydrated candidate (`providersHydrated: false`) ONLY if `candidate.providerMatchedByQuery === true`, and rejects `providersHydrated: false, providerMatchedByQuery: false`.

Run `node --test tests/moodPolicy.test.js` in `.worktrees/mood-and-ten-picks` and confirm FAIL.

### Step 1.2: Implement in `src/services/moodPolicy.js`
1. Update `MOOD_OPTIONS` with `requiredAnyGenreIds` and non-overlapping `withoutGenreIds` / `discouragedGenreIds` / `voteCountLte: 2000`.
2. In `normalizeMoodFilters`: remove redundant check and return `requiredAnyGenreIds`.
3. Add and export `extractGenreIdsFromCandidate(candidate = {})` and `matchesMoodCandidateGate(candidate = {}, mood = "any", moodFilters = null)`.

### Step 1.3: Implement provider family expansion & verification in `src/services/tmdbService.js`
Add and export `PROVIDER_FAMILY_MAP`, `expandProviderIds`, update `buildProviderFilter`, and add `matchesWatchProviders`.
Run `node --test tests/moodPolicy.test.js` and commit.

---

## Task 2: Mood-Aware & Provider-Strict Candidate Fetching + Ranker Rebalancing (`tmdbService.js` & `rankerService.js`)

**Files:**
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\services\tmdbService.js`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\services\rankerService.js`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\tests\moodRanker.test.js`

---

## Task 3: Pipeline Provider Preservation, Cache Hash Region & Embedding Neighbor Filtering (`geminiService.js`)

**Files:**
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\services\geminiService.js`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\tests\pipelineBugs.test.js`

---

## Task 4: Fix Stale 6-Movie Hydration, Drawer Auto-Sync & Region Badge Clarity (`AppContext.jsx`, `oracleViewHelpers.js`, `MovieRecommendations.jsx`, `MovieDetails.jsx`)

**Files:**
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\context\AppContext.jsx`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\services\oracleViewHelpers.js`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\components\MovieRecommendations.jsx`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\src\components\MovieDetails.jsx`
- Modify: `g:\Important Projects\movie-ratings\.worktrees\mood-and-ten-picks\tests\oracleViewHelpers.test.js`

---

## Task 5: End-to-End Live Verification & Merge to `main`

1. Run live TMDB + Embedding simulation script `diagnose_ranker_live.mjs` and verify all 6 scenarios.
2. Clean up untracked duplicate plan file in the worktree before merging.
3. Merge `feat/mood-and-ten-picks` into `main` in `g:\Important Projects\movie-ratings`.
4. Run `npm test` and `npm run build` in `g:\Important Projects\movie-ratings` (`main`).
5. Remove `.worktrees/mood-and-ten-picks` and `feat/mood-and-ten-picks`.
