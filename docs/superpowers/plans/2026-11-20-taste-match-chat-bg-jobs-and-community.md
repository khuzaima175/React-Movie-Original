# CinemaVault v5.5 — Flagship Oracle Concierge, Chat Overhaul, Universal "Chance You'll Like" Predictor, Real Homepage Taste Row, Global Background Jobs & Opt-In Community Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stretched Film Companion chat layout, add an instant on-device "Chance You'll Like" (`Match %` + `Est. Score`) predictor on every movie detail page and catalog card, replace Discover's generic `"Picked For Your Taste"` row with real `CVEM v1` personalized matches, lift long-running curation jobs into global non-blocking background workers ("roam free + notify when ready"), overhaul Film Oracle into a flagship **"Tonight's Concierge"** (Path 1: Tonight Starter Cards + full-bleed `#1 Top Pick Tonight` Spotlight + airy editorial pick grid), and add an opt-in Letterboxd-style public profile & community ratings layer with 64-D Taste Twin %.

**Architecture:**
1. **Phase A — Core UX, On-Device Taste Match, Non-Blocking Curation & Flagship Oracle Concierge (Tasks 1–5):**
   - Centers Film Companion chat into an `84rem` readable editorial column with natural page scroll and separates watched-reference chips from unseen recommendation poster cards.
   - Extracts a pure `$0.00` on-device predictor (`tasteMatchService.js`) using cached `CVEM v1` 64-D embeddings + negative repulsion + genre/director/cast/keyword affinity to score any film (`matchPct`, `predictedRating`, `confidence`, `reasons`) in `< 2ms`.
   - Wires Discover's `"Picked For Your Taste"` directly to the user's real `"Movies You'll Like"` pool (IndexedDB/Supabase cache or fast Wave 1 `CVEM v1` scoring) instead of a naive TMDB genre discover call.
   - Lifts Explore `"Movies You'll Like"` and Oracle curation runs into an `AppContext` background job manager (`backgroundJobService.js` + `BackgroundJobBanner.jsx`) so users can roam freely and receive a clickable completion toast.
   - Overhauls Film Oracle (**Path 1**) to eliminate the empty canvas via 4 tactile **Tonight Starter Cards** (including an instant on-device **"Pick From My Watchlist"** scorer), promotes Pick `#1` into a full-bleed **`Top Pick Tonight` Spotlight** with backdrop art + `Est. Score` + `"Because you rated"` anchors, and arranges Picks `#2–#10` in a clean 2-column editorial grid (using Hydrogen `HIGH` reasoning when Personal/BYOK is active and resilient Dual Flash-Lite on shared public quota).
2. **Phase B — Opt-In Letterboxd-Style Community Layer (Tasks 6–8):**
   - Extends Supabase Postgres 17 with opt-in public profile fields (`username`, `bio`, `is_public`, `favorite_movie_keys`, `taste_vector`), `user_follows`, and a trigger-synced `public.community_ratings` table (strictly zero PII / never exposes emails, private by default).
   - Adds `/u/:username` public profile pages with Top 4 showcase, Watch Diary, rating histogram, Follow/Unfollow, and 64-D **Taste Twin %** compatibility + unseen 9–10★ gems.
   - Adds a **"CinemaVault Community"** score + spoiler-protected reviews feed to `/movie/:id`.

**Tech Stack:** React 18.3, Vite 5.4, React Router 6, Framer Motion 12, Tailwind CSS v4, `CVEM v1` 64-D float16 embeddings, IndexedDB, Supabase Postgres 17 + RLS (project `xdmhejwhalliljsksvum`), `node --test`.

**Spec:** User requirements from 2026-11-20 session (**Path 1: Keep 4 Tabs & Overhaul Film Oracle into Flagship Tonight's Concierge**) + [SPEC.md](../../../SPEC.md) + [ARCHITECTURE.md](../../../ARCHITECTURE.md).

## Global Constraints

- **Guest Mode Remains 100% Unlocked:** Universal "Chance You'll Like", fixed Chat UI, real Homepage Taste Row, and Background Jobs all work identically for guests using `localStorage` + IndexedDB; Community profiles/reviews are readable by guests and strictly opt-in (`is_public: false` default) for signed-in users.
- **Zero PII Leakage in Public Tables:** `public.community_ratings` and public profile reads must never expose `auth.users.email`, private vault rows, `isSample` demo items, or private profiles (`is_public = false`).
- **Supabase RLS & Postgres Hygiene:** Every new table has RLS enabled, explicit `TO anon` / `TO authenticated` policies (never deprecated `auth.role()`), `(select auth.uid())` ownership predicates, `WITH CHECK` on updates/inserts, and `SECURITY INVOKER` (except strictly scoped internal sync triggers with `search_path = ''`).
- **Zero API Cost for Match % Predictor:** `predictMovieMatch` runs strictly on-device using existing loaded embeddings + metadata; zero extra TMDB or Gemini calls per card render.
- **Editorial Design & Doc Hygiene:** Neutral charcoal palette, brass accent for ratings/focus only, zero emoji icons, `prefers-reduced-motion` honored, and zero hard-coded test counts in top-level `.md` docs (`tests/docsHygiene.test.js`).

## Review Focus

1. **Unindexed 2024–2026 films in "Chance You'll Like":** Films released after the MovieLens 32M late-2023 cutoff have `collabSim = 0`. `predictMovieMatch` must not falsely show a `50%` penalty or hide the tile — it must smoothly fall back to metadata/director/cast/keyword affinity and label confidence as `"metadata"` (`"Estimated from genre & crew DNA"`).
2. **Navigating away during background curation:** If the user starts `"Movies You'll Like"` or Oracle `"Find Picks"` and immediately navigates to `/movie/:id`, the global job must keep running without React unmount errors, update the subtle global pill, and fire a clickable toast (`"View →"`) only once per job ID (never double-firing on StrictMode).
3. **Discover `"Picked For Your Taste"` freshness after rating a movie:** If a user rates or watchlists a film from Discover, `"Picked For Your Taste"` must immediately filter out that newly watched/watchlisted movie via `isSameMovie` without waiting for a full 250-film rebuild.
4. **Private-by-default & toggle-off community revocation:** If a user toggles `is_public` from `true` back to `false` in `/account`, a Postgres trigger must immediately delete their rows from `public.community_ratings` and clear their public `taste_vector` so zero stale reviews remain visible publicly.
5. **Chat reference vs. recommendation split:** If Gemini mentions 4 films the user already rated (`watched`) and 4 new films, `partitionChatMovieCards` must classify the 4 watched films as compact inline reference chips and only render the 4 unseen films as full recommendation poster cards (avoiding vertical bubble bloat).

---

## File Structure

### New Files
- `src/services/tasteMatchService.js` — Pure on-device `"Chance You'll Like"` predictor (`predictMovieMatch`, `predictMoviesBatch`, `calibratePredictedRating`).
- `src/services/backgroundJobService.js` — Pure job state transitions and status helpers for non-blocking global Explore/Oracle curation jobs.
- `src/components/BackgroundJobBanner.jsx` — Subtle non-blocking corner progress pill + completion toast (`"View →"`) visible while roaming the site.
- `src/components/OracleTopPickSpotlight.jsx` — Full-bleed `#1 Top Pick Tonight` editorial hero spotlight card (backdrop art, `Match %`, calibrated `Est. Score`, `"Because you rated"` anchor links, streaming pills, Trailer/Watchlist/Rate/Dismiss actions).
- `supabase/migrations/20261120180000_community_profiles_and_reviews.sql` — Opt-in public profile fields (`username`, `bio`, `is_public`, `favorite_movie_keys`, `taste_vector`), `user_follows`, and trigger-synced `public.community_ratings` with strict RLS.
- `src/services/communityService.js` — Pure username validation, 64-D **Taste Twin %** cosine calculator (`computeTasteTwinCompatibility`), public profile & community reviews fetch/mutation helpers.
- `src/pages/PublicProfilePage.jsx` — Editorial `/u/:username` public profile page (Top 4 Showcase, Stats, Watch Diary, Follow button, Taste Twin %, and Unseen 9–10★ Gems).
- `src/components/MovieCommunitySection.jsx` — Community score tile + spoiler-protected public reviews feed on `/movie/:id`.
- `src/styles/community.css` — Route-scoped styles for `/u/:username` and community reviews.
- `tests/tasteMatchService.test.js`, `tests/backgroundJobService.test.js`, `tests/communityService.test.js`.

### Modified Files
- `src/services/chatCardHelpers.js`, `src/components/AIChat.jsx`, `src/styles/oracle.css` — Centered `82rem` chat layout + split watched reference chips vs. unseen recommendation card shelf.
- `src/components/MovieDetails.jsx`, `src/components/MovieCard.jsx`, `src/components/SearchModal.jsx` — Wire `"Chance You'll Like"` score tile (`Match %` + `Est. Score` + reasons) and optional match pill on catalog/search cards.
- `src/services/dashboardService.js`, `src/pages/DashboardPage.jsx` — Power Discover's `"Picked For Your Taste"` from real cached/Wave-1 `CVEM v1` `"Movies You'll Like"` pool with Match `%` badges and `"See all 250 →"` link.
- `src/context/AppContext.jsx`, `src/pages/ExplorePage.jsx`, `src/components/MovieRecommendations.jsx`, `src/services/oracleViewHelpers.js`, `src/App.jsx` — Wire global non-blocking background curation jobs + `BackgroundJobBanner` + Path 1 Flagship Oracle Concierge (`ORACLE_TONIGHT_PRESETS`, `rankWatchlistForTonight`, `OracleTopPickSpotlight`, 2-col editorial pick grid) + `/u/:username` lazy route.
- `src/pages/AccountPage.jsx` — Add opt-in Public Profile settings (`@username`, Public toggle, Bio, Top 4 picker).

---

## Phase A — Core UX, Universal Taste Match, Homepage Row & Background Jobs

### Task 1: Fix Film Companion Chat Layout & Split Watched Reference Chips vs. Unseen Recommendation Cards

**Files:**
- Modify: `src/services/chatCardHelpers.js`
- Modify: `src/components/AIChat.jsx`
- Modify: `src/styles/oracle.css`
- Test: `tests/chatCardHelpers.test.js`

**Interfaces:**
- Consumes: `parseMovieCardsFromText` in `src/services/chatCardHelpers.js`; `findMatchingMovie` from `src/services/movieIdentity.js`.
- Produces:
  - `partitionChatMovieCards(parsedCards, watched, watchlist) -> { referenceChips: Array, recommendedCards: Array }` in `src/services/chatCardHelpers.js`.

- [ ] **Step 1: Write failing test for `partitionChatMovieCards` in `tests/chatCardHelpers.test.js`**

```js
test("partitionChatMovieCards separates already-watched references into compact chips and keeps unseen films as recommendation cards", () => {
  const parsed = [
    { title: "Inception", year: "2010" },
    { title: "The Departed", year: "2006" },
    { title: "Catch Me If You Can", year: "2002" },
    { title: "Blood Diamond", year: "2006" }
  ];
  const watched = [
    { title: "Inception", year: "2010", imdbID: "tt1375666", userRating: 9 },
    { title: "The Departed", year: "2006", imdbID: "tt0407887", userRating: 8 }
  ];
  const { referenceChips, recommendedCards } = partitionChatMovieCards(parsed, watched, []);
  assert.deepEqual(referenceChips.map((c) => c.title), ["Inception", "The Departed"]);
  assert.equal(referenceChips[0].userRating, 9);
  assert.deepEqual(recommendedCards.map((c) => c.title), ["Catch Me If You Can", "Blood Diamond"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chatCardHelpers.test.js`
Expected: FAIL (`partitionChatMovieCards is not defined`).

- [ ] **Step 3: Implement `partitionChatMovieCards` in `src/services/chatCardHelpers.js` and overhaul chat column CSS in `src/styles/oracle.css` & `src/components/AIChat.jsx`**

- In `src/styles/oracle.css`:
  - Constrain `.chat-workspace-shell` / `.chat-thread-column` to `max-width: 84rem; margin: 0 auto; width: 100%;` so messages sit in a balanced editorial reading column with zero empty right-side chasm.
  - Remove the cramped fixed `max-height` inner scrollbar on desktop in favor of a generous min-height + natural flow with sticky bottom composer (`position: sticky; bottom: 1.2rem;`).
  - Let assistant bubbles span `max-width: 100%` (editorial article-like layout without boxed right void) while user messages stay compact right-aligned pills (`max-width: 72%`).
  - Render `referenceChips` as a subtle inline flex-wrap row (`"Referenced from your Vault: Inception · 9★ · The Departed · 8★"`) clickable to `/movie/:id`, and render `recommendedCards` as a clean horizontal scroll shelf / 2-col grid below the bubble (`max-width: 100%`).

- [ ] **Step 4: Run test and build to verify pass, then commit**

Run: `node --test tests/chatCardHelpers.test.js; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: PASS (`fail 0`) and clean Vite build.

```bash
git add src/services/chatCardHelpers.js src/components/AIChat.jsx src/styles/oracle.css tests/chatCardHelpers.test.js
git commit -m "fix(chat): center editorial chat column and split watched reference chips from recommended cards"
```

---

### Task 2: Universal On-Device "Chance You'll Like" Predictor (`tasteMatchService.js`) on Movie Details, Cards & Search

**Files:**
- Create: `src/services/tasteMatchService.js`
- Modify: `src/components/MovieDetails.jsx`
- Modify: `src/components/MovieCard.jsx`
- Modify: `src/components/SearchModal.jsx`
- Test: `tests/tasteMatchService.test.js`

**Interfaces:**
- Consumes: `extractTasteProfile` (`tmdbService.js` or pure profile builder), `buildCollabSimMapFromIndex`, `buildRepulsionMapFromIndex`, `getCollabCatalogMax`, `loadDefaultEmbeddingIndex` (`embeddingService.js`), `scoreCandidate`, `DEFAULT_RANKER_WEIGHTS` (`rankerService.js`).
- Produces (from `src/services/tasteMatchService.js`):
  - `calibratePredictedRating({ matchPct, watched }) -> number | null` (maps `[50, 99]` match probability onto the user's personal rating distribution, clamped `[4.5, 9.9]` to 1 decimal place)
  - `predictMovieMatch({ movie, watched, watchlist, tasteRules, embeddingIndex, cachedContext }) -> { available: boolean, matchPct: number | null, predictedRating: number | null, confidence: "high" | "medium" | "metadata" | "insufficient", summary: string, anchorTitles: string[], signals: string[] }`
  - `buildTasteMatchContext({ watched, watchlist, tasteRules, embeddingIndex }) -> object` (memoizable once per vault change so scoring 50+ cards on Search/Explore takes `< 2ms` total).

- [ ] **Step 1: Write failing unit tests in `tests/tasteMatchService.test.js`**

Pin:
1. Returns `{ available: false, confidence: "insufficient" }` when `watched` has `< 3` rated films.
2. For an indexed `CVEM v1` film near user's 10★ anchors, returns `available: true`, `confidence: "high"`, `matchPct >= 80`, calibrated `predictedRating` in `[7.5, 9.9]`, and non-empty `summary` / `signals`.
3. For an unindexed 2025–2026 release (`tmdbId` absent from `embeddingIndex`) sharing the user's favorite director + genres, returns `available: true`, `confidence: "metadata"`, a sensible genre/crew-derived `matchPct` (never collapsed to `50%` solely from missing embedding), and summary mentioning genre/filmmaker affinity.
4. For a film near user's `<= 4★` disliked films (strong repulsion), scores noticeably lower than a positively aligned film.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tasteMatchService.test.js`
Expected: FAIL (`Cannot find module '../src/services/tasteMatchService.js'`).

- [ ] **Step 3: Implement `src/services/tasteMatchService.js`**

Reuse `buildCollabSimMapFromIndex`, `buildRepulsionMapFromIndex`, `getCollabCatalogMax`, and `scoreCandidate` (zero duplicate math formulas). Compute `predictedRating` from user's personal mean & stdDev (clamped `[4.5, 9.9]`). Extract up to 2 concrete top-rated vault anchors sharing highest cosine similarity or shared director/genre for the 1-line `summary`.

- [ ] **Step 4: Wire "For You" Score Tile into `MovieDetails.jsx` and subtle Match % badge into `MovieCard.jsx` & `SearchModal.jsx`**

- In `MovieDetails.jsx`: next to IMDb / Rotten Tomatoes / Metacritic / TMDB in the score strip, render a clean **"FOR YOU"** metric card (when `!isWatched && match.available`) showing `{match.matchPct}% Match` (`--match` emerald text), `Est. {match.predictedRating}/10`, and hover/subtext `match.summary` (or `"Based on genre & crew DNA"` when `confidence === "metadata"`).
- In `SearchModal.jsx` and `MovieCard.jsx`: accept optional `matchScore` / compute cheaply via shared memoized `buildTasteMatchContext` once `embeddingIndex` is already cached in memory (never blocking initial render).

- [ ] **Step 5: Run tests + build to verify pass, then commit**

Run: `node --test tests/tasteMatchService.test.js; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: PASS (`fail 0`) and clean build.

```bash
git add src/services/tasteMatchService.js src/components/MovieDetails.jsx src/components/MovieCard.jsx src/components/SearchModal.jsx tests/tasteMatchService.test.js
git commit -m "feat(ml,ui): add universal on-device Chance You'll Like predictor on movie details and cards"
```

---

### Task 3: Power Discover's `"Picked For Your Taste"` Row with Real `CVEM v1` Matches

**Files:**
- Modify: `src/services/dashboardService.js`
- Modify: `src/pages/DashboardPage.jsx`
- Test: `tests/dashboardService.test.js`

**Interfaces:**
- Consumes: `loadExploreForYouCache`, `loadLatestLocalExploreForYouFallback` (`exploreForYouCache.js`); `buildExploreForYouProfileHash`, `generateExploreForYouPool`, `EXPLORE_FOR_YOU_MIN_RATED` (`exploreForYouService.js`); `isSameMovie` (`movieIdentity.js`).
- Produces:
  - `buildPersonalizedHomeRow({ forYouItems, watched, watchlist, limit = 20 }) -> { key: "picked-for-taste", title: "Picked For Your Taste", seeAllLink: "/explore?mode=for-you", movies: Array }` in `src/services/dashboardService.js`.

- [ ] **Step 1: Write failing test in `tests/dashboardService.test.js`**

```js
test("buildPersonalizedHomeRow filters newly watched/watchlisted films, preserves matchScore, and links to /explore?mode=for-you", () => {
  const row = buildPersonalizedHomeRow({
    forYouItems: [
      { tmdbId: 101, imdbID: "tmdb_101", title: "Blade Runner 2049", forYouScore: 95, poster: "https://image.tmdb.org/t/p/w500/a.jpg" },
      { tmdbId: 102, imdbID: "tmdb_102", title: "Already Watched", forYouScore: 93, poster: "https://image.tmdb.org/t/p/w500/b.jpg" },
      { tmdbId: 103, imdbID: "tmdb_103", title: "Prisoners", forYouScore: 91, poster: "https://image.tmdb.org/t/p/w500/c.jpg" }
    ],
    watched: [{ tmdbId: 102, title: "Already Watched", userRating: 9 }],
    watchlist: [],
    limit: 20
  });
  assert.equal(row.seeAllLink, "/explore?mode=for-you");
  assert.deepEqual(row.movies.map((m) => m.tmdbId), [101, 103]);
  assert.equal(row.movies[0].matchScore, 95);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dashboardService.test.js`
Expected: FAIL (`buildPersonalizedHomeRow is not defined`).

- [ ] **Step 3: Implement `buildPersonalizedHomeRow` and wire `DashboardPage.jsx`**

- In `DashboardPage.jsx`: when `watched.length >= EXPLORE_FOR_YOU_MIN_RATED`:
  1. Immediately check `loadExploreForYouCache` -> `loadLatestLocalExploreForYouFallback`. If a cached pool exists, substitute Discover's `"Picked For Your Taste"` row immediately (~50ms) with the top 20 unseen films from the real `CVEM v1` pool (carrying `matchScore` badges and `seeAllLink="/explore?mode=for-you"`).
  2. If no local pool exists yet, kick off the lightweight Wave 1 background build (or consume the global For You job from Task 4!) and swap the row seamlessly when Wave 1 arrives — while filtering out any newly watched/watchlisted movie live via `useMemo`.
- Keep the existing TMDB fallback row only for brand-new guests with `< 3` rated films.

- [ ] **Step 4: Run tests + build and commit**

Run: `node --test tests/dashboardService.test.js; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: PASS (`fail 0`) and clean build.

```bash
git add src/services/dashboardService.js src/pages/DashboardPage.jsx tests/dashboardService.test.js
git commit -m "fix(discover): power Picked For Your Taste row from real CVEM v1 Movies You'll Like pool"
```

---

### Task 4: Global Non-Blocking Background Curation Jobs ("Roam Free While We Curate" + Clickable Completion Toast)

**Files:**
- Create: `src/services/backgroundJobService.js`
- Create: `src/components/BackgroundJobBanner.jsx`
- Modify: `src/context/AppContext.jsx`
- Modify: `src/pages/ExplorePage.jsx`
- Modify: `src/components/MovieRecommendations.jsx`
- Modify: `src/App.jsx`
- Test: `tests/backgroundJobService.test.js`

**Interfaces:**
- Consumes: `generateExploreForYouPool` (`exploreForYouService.js`), `saveExploreForYouCache` (`exploreForYouCache.js`).
- Produces (from `src/services/backgroundJobService.js`):
  - `createInitialBackgroundJobs() -> { forYou: JobState, oracle: JobState }`
  - `transitionJobState(jobs, jobKey, patch) -> NextJobs`
  - `getActiveBackgroundJobNotice(jobs, currentPathname) -> { visible: boolean, jobKey: string, status: "running" | "done" | "error", message: string, targetRoute: string } | null`
- Produces (on `AppContext`):
  - `backgroundJobs`, `startForYouBackgroundJob(params)`, `reportOracleJobProgress(patch)`, `dismissBackgroundJobNotice(jobKey)`, `forYouLivePool`.

- [ ] **Step 1: Write failing tests in `tests/backgroundJobService.test.js`**

Pin:
1. Running a job while user is on `/explore` shows inline status; when user navigates to `/` or `/movie/tt1375666`, `getActiveBackgroundJobNotice` returns a visible floating pill (`status: "running"`, `"Curating Movies You'll Like in the background…"`).
2. Completing a job while the user is on another route emits `status: "done"` with `targetRoute: "/explore?mode=for-you"` (or `"/ai"`) and `dismissBackgroundJobNotice` clears it cleanly.
3. A stale job ID finishing after a newer job ID started is ignored cleanly by `transitionJobState`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/backgroundJobService.test.js`
Expected: FAIL (`Cannot find module '../src/services/backgroundJobService.js'`).

- [ ] **Step 3: Implement `backgroundJobService.js`, `BackgroundJobBanner.jsx`, and wire into `AppContext.jsx`, `ExplorePage.jsx`, `MovieRecommendations.jsx`, and `App.jsx`**

- Move the active Explore `"Movies You'll Like"` runner into `AppContext.startForYouBackgroundJob` so navigating away from `/explore` **does NOT abort** the in-flight Wave 1/2/3 pipeline — it finishes cleanly in the background, saves to IndexedDB + Supabase, updates `forYouLivePool`, and triggers the completion toast!
- Add a calm inline reassurance copy during initial loading in both `ExplorePage.jsx` and `MovieRecommendations.jsx`: *"Curating in the background — feel free to explore the rest of CinemaVault, we'll notify you as soon as your picks are ready."*
- Render `BackgroundJobBanner.jsx` inside `App.jsx` (floating above mobile tab bar / beside CompareDock cleanly without overlapping) with a clickable **"View Picks →"** CTA when a job finishes while the user is on another route.

- [ ] **Step 4: Run tests + build and commit**

Run: `node --test tests/backgroundJobService.test.js tests/exploreForYouStreaming.test.js; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: PASS (`fail 0`) and clean build.

```bash
git add src/services/backgroundJobService.js src/components/BackgroundJobBanner.jsx src/context/AppContext.jsx src/pages/ExplorePage.jsx src/components/MovieRecommendations.jsx src/App.jsx tests/backgroundJobService.test.js
git commit -m "feat(ux): run Explore and Oracle curation as non-blocking background jobs with roam-free notifications"
```

---

### Task 5: Path 1 — Flagship Film Oracle Concierge Overhaul (Tonight Starters, `#1 Top Pick` Spotlight & Editorial Grid)

**Files:**
- Create: `src/components/OracleTopPickSpotlight.jsx`
- Modify: `src/services/oracleViewHelpers.js`
- Modify: `src/components/MovieRecommendations.jsx`
- Modify: `src/styles/oracle.css`
- Test: `tests/oracleViewHelpers.test.js`

**Interfaces:**
- Consumes: `predictMovieMatch`, `calibratePredictedRating` (`tasteMatchService.js` from Task 2); `reportOracleJobProgress` (`AppContext` from Task 4); `resolveRecommendationAnchors`, `sanitizeOracleReason`, `formatRecBadgeSummary` (`oracleViewHelpers.js`); `CURATION_MODEL_CASCADE` / `PUBLIC_CURATION_CASCADE` (`geminiService.js`).
- Produces (from `src/services/oracleViewHelpers.js`):
  - `ORACLE_TONIGHT_PRESETS` (4 curated scenario presets: `masterpieces`, `watchlist-tonight`, `tight-thriller`, `hidden-gem`)
  - `rankWatchlistForTonight({ watchlist, watched, tasteRules, embeddingIndex, limit = 5 }) -> Array` (instant `$0.00` on-device ranking of user's Watchlist for tonight's watch)
  - `splitOracleSpotlightAndGrid(recommendations = []) -> { spotlight: object | null, gridPicks: Array }`

- [ ] **Step 1: Write failing tests in `tests/oracleViewHelpers.test.js`**

Pin:
1. `ORACLE_TONIGHT_PRESETS` exports 4 emoji-free presets with valid `id`, `title`, `subtitle`, `mood`, and `actionType` (`"curate"` or `"watchlist"`).
2. `splitOracleSpotlightAndGrid` separates Pick `#1` as `spotlight` and Picks `#2..#N` as `gridPicks`, returning `{ spotlight: null, gridPicks: [] }` when empty.
3. `rankWatchlistForTonight` orders unseen Watchlist items by descending `predictMovieMatch` score (`matchPct`), excludes any already-watched overlap, and attaches calibrated `predictedRating` and `summary`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/oracleViewHelpers.test.js`
Expected: FAIL (`ORACLE_TONIGHT_PRESETS is not defined`).

- [ ] **Step 3: Implement `ORACLE_TONIGHT_PRESETS`, `rankWatchlistForTonight`, `splitOracleSpotlightAndGrid` in `src/services/oracleViewHelpers.js` and create `src/components/OracleTopPickSpotlight.jsx`**

- **`OracleTopPickSpotlight.jsx`:**
  - Full-bleed dark editorial showcase card for Pick `#1` with TMDB backdrop image + soft charcoal gradient scrim, crisp `2:3` poster, `#1 TOP PICK TONIGHT` kicker, title + year + runtime + genres, `Match %` + calibrated `Est. X.X/10` readout (via `calibratePredictedRating`), streaming badges, clean editorial pitch (`sanitizeOracleReason`), clickable `"Because you rated …"` vault anchor pills, and primary actions (`Watch Trailer`, `+ Watchlist`, `Already Seen`, `Not For Me`).
- **`MovieRecommendations.jsx` & `src/styles/oracle.css`:**
  - **Zero empty black screen:** When no picks are currently shown, render the 4 tactile **Tonight Starter Cards** (`ORACLE_TONIGHT_PRESETS`) directly beneath the 2-tier command bar. Clicking `"Pick From My Watchlist"` renders an instant ranked Watchlist Tonight strip (no API wait, with a 1-click `"Ask Film Companion to pick 1"` CTA); clicking any curation preset runs `handleGetRecommendations` directly via the non-blocking background job from Task 4.
  - **Editorial Results Stage:** Render `<OracleTopPickSpotlight />` on top for Pick `#1`, followed by a balanced 2-column (desktop) / 1-column (mobile) editorial card grid for Picks `#2–#10` with Framer Motion `ScrollRevealSection` entrances (respecting `prefers-reduced-motion`).
  - **Hydrogen / Deep Reasoning Routing:** When running in Personal/Debug mode OR when the user has attached their own browser-local Gemini key (`hasUserGeminiKey()`), automatically prefer `CURATION_MODEL_CASCADE` (`gemini-4-hydrogen` `HIGH` thinking first) for maximum editorial taste depth while keeping Public shared quota protected on Dual Flash-Lite.

- [ ] **Step 4: Run tests + build and commit**

Run: `node --test tests/oracleViewHelpers.test.js tests/tasteMatchService.test.js; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: PASS (`fail 0`) and clean build.

```bash
git add src/components/OracleTopPickSpotlight.jsx src/services/oracleViewHelpers.js src/components/MovieRecommendations.jsx src/styles/oracle.css tests/oracleViewHelpers.test.js
git commit -m "feat(oracle): overhaul Film Oracle into flagship Tonight's Concierge with spotlight hero and starter presets"
```

---

## Phase B — Opt-In Letterboxd-Style Community Layer (Independent Milestone)

### Task 6: Supabase Community Schema (`username`, `is_public`, `community_ratings`, `user_follows`) & Safe Public RLS

**Files:**
- Create: `supabase/migrations/20261120180000_community_profiles_and_reviews.sql`
- Test: Live Supabase verification via `supabase_mcp` (`list_tables`, `get_advisors`) + `tests/communityService.test.js`

**Interfaces:**
- Consumes: Existing `public.profiles` and `public.user_vault_items` in Supabase project `xdmhejwhalliljsksvum`.
- Produces:
  - Columns on `public.profiles`: `username text unique check (username ~ '^[a-z0-9_]{3,24}$')`, `bio text check (char_length(bio) <= 240)`, `is_public boolean not null default false`, `favorite_movie_keys text[] not null default '{}' check (cardinality(favorite_movie_keys) <= 4)`, `taste_vector real[]`.
  - Public read-only table `public.public_profiles` (or explicit public-safe columns via trigger-synced `public.public_profiles` table containing ONLY `user_id`, `username`, `display_name`, `bio`, `favorite_movie_keys`, `taste_vector`, `watched_count`, `updated_at` — strictly zero emails!).
  - Public table `public.community_ratings` (`id`, `user_id`, `username`, `display_name`, `movie_key`, `tmdb_id`, `imdb_id`, `title`, `year`, `poster`, `user_rating`, `user_note`, `contains_spoilers`, `craft_breakdown`, `watched_at`, `updated_at`) automatically synced via `security definer` trigger (with `search_path = ''`, non-exposed / trigger-only) from `user_vault_items` **ONLY** when `profiles.is_public = true`, `status = 'watched'`, `user_rating > 0`, and `coalesce((metadata->>'isSample')::boolean, false) = false`. Toggling `is_public = false` immediately deletes the user's rows from `public.community_ratings` and `public.public_profiles`.
  - Table `public.user_follows (follower_id uuid, following_id uuid, created_at timestamptz, primary key (follower_id, following_id), check (follower_id <> following_id))` with `TO authenticated` RLS policies.

- [ ] **Step 1: Author and apply migration `20261120180000_community_profiles_and_reviews.sql` via `supabase_mcp` `apply_migration`**

Include composite index `community_ratings_tmdb_idx (tmdb_id, updated_at desc)` and `community_ratings_user_idx (username, updated_at desc)`. Grant `SELECT` on `public.public_profiles` and `public.community_ratings` to `anon, authenticated` (write access strictly revoked from clients — managed exclusively by triggers!).

- [ ] **Step 2: Verify via `supabase_mcp` `get_advisors` (`security` + `performance`) and commit**

Expected: Zero new security or performance warnings; private existing users remain 100% hidden (`public_profiles` count = `0`, `community_ratings` count = `0` until a user opts in).

```bash
git add supabase/migrations/20261120180000_community_profiles_and_reviews.sql
git commit -m "feat(supabase): add opt-in public profiles, community_ratings trigger sync, and user_follows RLS"
```

---

### Task 7: Community Service, Opt-In `/account` Public Profile Controls, `/u/:username` Page & 64-D Taste Twin %

**Files:**
- Create: `src/services/communityService.js`
- Create: `src/pages/PublicProfilePage.jsx`
- Create: `src/styles/community.css`
- Modify: `src/pages/AccountPage.jsx`
- Modify: `src/App.jsx`
- Test: `tests/communityService.test.js`

**Interfaces:**
- Consumes: `getSupabaseClientAsync` (`supabaseClient.js`), `computeUserEmbedding`, `loadDefaultEmbeddingIndex` (`embeddingService.js`), `buildRatingHistogramBins` (`vaultStats.js`).
- Produces (from `src/services/communityService.js`):
  - `validateUsername(raw) -> { ok: boolean, normalized: string, error: string }`
  - `computeTasteTwinCompatibility(vecA, vecB) -> number | null` (cosine similarity mapped to `[0, 99]` integer %)
  - `fetchPublicProfileByUsername(supabase, username)`
  - `fetchCommunityRatingsForMovie(supabase, { tmdbId, imdbId, limit = 20 })`
  - `savePublicProfileSettings(supabase, { userId, username, bio, isPublic, favoriteMovieKeys, tasteVector })`
  - `toggleFollowUser(supabase, { followerId, followingId, isFollowing })`

- [ ] **Step 1: Write failing unit tests in `tests/communityService.test.js`**

Pin:
1. `validateUsername` normalizes uppercase, rejects `< 3` or `> 24` chars, rejects reserved slugs (`admin`, `auth`, `account`, `explore`, `vault`, `oracle`, `api`), and accepts `khuzaima_175`.
2. `computeTasteTwinCompatibility` returns `99` for identical normalized 64-D vectors, `~50` for orthogonal vectors, and `null` when either vector is missing/zero.
3. `fetchCommunityRatingsForMovie` aggregates average community score, total ratings count, and returns public reviews cleanly.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/communityService.test.js`
Expected: FAIL (`Cannot find module '../src/services/communityService.js'`).

- [ ] **Step 3: Implement `communityService.js`, `/account` Public Profile section, `/u/:username` (`PublicProfilePage.jsx`), and route registration in `App.jsx`**

- In `AccountPage.jsx`: add an opt-in **"Public Profile (Letterboxd Mode)"** card: `@username` input (live format check), **Make Profile Public** toggle (default OFF), Bio textarea (`<= 240` chars), Top 4 Favorite Films selector (from user's rated vault), and direct link to `/u/<username>` when enabled. Automatically syncs the user's L2-normalized 64-D `taste_vector` when `isPublic` is ON.
- In `PublicProfilePage.jsx` (`/u/:username`): renders editorial profile header (`@username`, bio, Follow/Unfollow button, **Taste Twin %** badge when visitor has `>= 3` rated films), **Top 4 Showcase**, **Rating Distribution**, **"Films They Loved (9–10★) You Haven't Seen"** row, and **Recent Reviews / Diary**.

- [ ] **Step 4: Run tests + build and commit**

Run: `node --test tests/communityService.test.js; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: PASS (`fail 0`) and clean build.

```bash
git add src/services/communityService.js src/pages/PublicProfilePage.jsx src/styles/community.css src/pages/AccountPage.jsx src/App.jsx tests/communityService.test.js
git commit -m "feat(community): add opt-in public profiles (/u/:username), Taste Twin %, and follow support"
```

---

### Task 8: Movie Detail Community Score Strip & Spoiler-Protected Reviews Feed + Docs Sync

**Files:**
- Create: `src/components/MovieCommunitySection.jsx`
- Modify: `src/components/MovieDetails.jsx`
- Modify: `README.md`, `ARCHITECTURE.md`, `SPEC.md`, `LOCAL_MODEL_GUIDE.md`

**Interfaces:**
- Consumes: `fetchCommunityRatingsForMovie` (`communityService.js`).
- Produces: Community score tile + spoiler-blurred reviews list linking to `/u/:username` on `/movie/:id`.

- [ ] **Step 1: Build `MovieCommunitySection.jsx` and mount in `MovieDetails.jsx`**

- Fetch `fetchCommunityRatingsForMovie` lazily when `hasSupabaseConfig()` is true.
- Render a compact **"CINEMAVAULT"** community average score tile beside IMDb/RT/Metascore/For You when `count > 0` (`"8.7 / 10 · 14 ratings"`).
- Render a **"Community Reviews"** section below the Rating Studio listing public reviews with `@username` link (`/u/:username`), star score, optional craft summary, and click-to-reveal blur overlay whenever `contains_spoilers === true`.

- [ ] **Step 2: Run full test suite (`npm test`), production build (`npm run build`), live Playwright QA, and update top-level docs (`README.md`, `ARCHITECTURE.md`, `SPEC.md`, `LOCAL_MODEL_GUIDE.md`)**

Run: `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: All test suites PASS (`fail 0`, `skipped 0`), clean build.

```bash
git add src/components/MovieCommunitySection.jsx src/components/MovieDetails.jsx README.md ARCHITECTURE.md SPEC.md LOCAL_MODEL_GUIDE.md
git commit -m "feat(community): add CinemaVault community scores, spoiler-safe reviews, and v5.5 docs"
```
