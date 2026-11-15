# Phase 2: Explore Deep Filter Workbench & Movie Page Rabbit Hole Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/explore` TMDB multi-facet discovery workbench and turn every `/movie/:id` detail page into a connected research rabbit hole with clickable genres/motifs, chronological franchise timelines, and hybrid embedding + TMDB similarity carousels.

**Architecture:** Unlock the needed TMDB proxy paths first (`api/tmdb.js`), enrich normalized movie details (`tmdbService.js`) with `keywordItems` and `collectionId`, build pure URL/query/similarity services (`exploreService.js`, `rabbitHoleService.js`) covered by `node --test`, then wire `/explore` (`ExplorePage.jsx`, `NavBar.jsx`, `App.jsx`) and the `MovieDetails.jsx` shelves (`CollectionTimeline.jsx`, `SimilarFilmsStrip.jsx`).

**Tech Stack:** React 18, React Router v6, TMDB v3 REST API via `/api/tmdb`, on-device 64-D `CVEM v1` binary embeddings (`embeddingService.js`), Node ESM native test runner (`node --test`), Vite.

---

### Spec & Global Constraints
- **Design Spec:** [docs/superpowers/specs/2026-11-15-research-hub-and-studio-design.md](../specs/2026-11-15-research-hub-and-studio-design.md)
- **Constraint 1 (Proxy Security First):** Never call `/3/collection/:id`, `/3/search/keyword`, `/3/movie/:id/recommendations`, or `/3/movie/:id/similar` from the browser before updating `ALLOWED_TMDB_PATH_RE` in `api/tmdb.js` and adding negative tests in `tests/apiProxy.test.js`.
- **Constraint 2 (Zero Hallucinated IDs):** Genre links from `MovieDetails.jsx` must resolve IDs strictly via `movie.tmdbGenreIds` or `TMDB_GENRE_MAP` (`tmdbService.js`); motif links must carry TMDB `{ id, name }` pairs from `movie.keywordItems` (fallback graceful title/keyword search if legacy cached movie lacks `id`).
- **Constraint 3 (Node ESM Test Boundary):** Keep `exploreService.js` and `rabbitHoleService.js` 100% pure ESM with zero React/DOM imports so `node --test` tests them without a DOM bundler.
- **Constraint 4 (CVEM Binary Norm Safety):** `parseEmbeddingBinary` (`embeddingService.js`) leaves sub-unit Bayesian-shrunk vectors un-normalized when `sumSq < 0.98`; `findEmbeddingNeighborsForMovie()` must divide dot product by `normA * normB` cleanly instead of assuming strict unit length.

---

### Review Focus (5 Failure Modes Pinned by Tests)
1. **TMDB Proxy Over-Permissiveness or Blockage:** `api/tmdb.js` must accept `/3/collection/1570`, `/3/search/keyword`, `/3/movie/27205/recommendations` and strictly reject `/3/collection/1570/images`, `/3/movie/27205/account_states`, or path traversal (`..`).
2. **Bidirectional Explore URL Sync & Refresh Stability:** Navigating to `/explore?genres=878&withoutGenres=27&yearFrom=2010&yearTo=2019&minImdb=7.5&hideWatched=1` (via back button, deep link, or motif click) must hydrate identical filter controls and produce deterministic `/3/discover/movie` params without infinite render/URL-replace loops.
3. **Zero-Star / Low-Vote Spam on "Top Rated" Sorts:** When `sortBy === "vote_average.desc"` on `/explore`, `buildTmdbDiscoverParams()` must enforce a sensible default `vote_count.gte` floor (e.g. `150` unless user explicitly lowers it to `0`) so 1-vote obscure shorts never pollute results.
4. **Rabbit Hole Self-Exclusion & 2024–2026 Cold-Start Blending:** `buildHybridSimilarFilms()` must exclude the current film itself, resolve `CVEM v1` ID-only slots via hydrated card/TMDB fallback (never emitting blank titleless cards when `/models/item_embeddings_f16.bin` has IDs without metadata), and seamlessly fill 2024–2026 picks from TMDB live recommendations when the static embedding index returns nothing.
5. **Safe Handling of Singletons & Undated Franchise Entries:** Movies without `belongs_to_collection` must not render `CollectionTimeline`, and unreleased `"TBA"` installments in a collection must sort cleanly after released chronological entries.

---

### Task 1: Expand `/api/tmdb` Proxy Allowlist + Upgrade `tmdbService.js` Extraction

**Files:**
- Modify: `api/tmdb.js`
- Modify: `tests/apiProxy.test.js`
- Modify: `src/services/tmdbService.js`
- Test: `tests/tmdbRabbitHoleHelpers.test.js` (pure helper checks for collection/keyword extraction)

**Interfaces:**
```js
// src/services/tmdbService.js
// Extend formatTmdbMovieDetails() return payload with:
//   keywordItems: [{ id: number, name: string }]

export async function fetchCollectionTimeline(collectionId, options = {})
// GET /3/collection/${id} -> returns { id, name, overview, parts: [{ tmdbId, title, release_date, year, poster, vote_average, overview }] } | null

export async function fetchTmdbMovieRecommendations(tmdbId, page = 1, options = {})
// GET /3/movie/${tmdbId}/recommendations (falls back to /similar if results.length < 4) -> normalized movie list

export async function searchTmdbKeywords(query, options = {})
// GET /3/search/keyword -> [{ id, name }]
```

- [ ] **Step 1: Write failing proxy & TMDB service tests**
  Add test cases to `tests/apiProxy.test.js`:
  - Verify `tmdbHandler` allows `/3/collection/87359`, `/3/search/keyword`, `/3/movie/157336/recommendations`, `/3/movie/157336/similar` with `200` and `api_key` injected.
  - Verify `tmdbHandler` returns `400` for `/3/collection/87359/images`, `/3/movie/157336/account_states`, and `/3/search/keyword/../person`.
  Create `tests/tmdbRabbitHoleHelpers.test.js` testing `formatTmdbMovieDetails` preserves `keywordItems: [{ id, name }]`, `collectionId`, and `collectionName` cleanly.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/apiProxy.test.js tests/tmdbRabbitHoleHelpers.test.js`
  Expected: FAIL on newly allowed paths returning `400` and missing `keywordItems`.

- [ ] **Step 3: Update `api/tmdb.js` and `src/services/tmdbService.js`**
  - Update `ALLOWED_TMDB_PATH_RE` in `api/tmdb.js`:
    ```js
    const ALLOWED_TMDB_PATH_RE =
      /^\/3\/(discover\/movie|search\/(?:movie|person|keyword)|trending\/movie\/(?:day|week)|collection\/\d+|movie\/\d+(?:\/(?:keywords|credits|watch\/providers|videos|release_dates|external_ids|recommendations|similar))?|person\/\d+(?:\/movie_credits)?|find\/[a-zA-Z0-9_-]+)$/;
    ```
  - In `src/services/tmdbService.js`:
    - Add `keywordItems: (data.keywords?.keywords || []).slice(0, 10).map((k) => ({ id: k.id, name: k.name }))` inside `formatTmdbMovieDetails()`.
    - Implement `fetchCollectionTimeline()`, `fetchTmdbMovieRecommendations()`, and `searchTmdbKeywords()` using `hasTmdbBackend()` and `fetchTmdbJson()` cleanly, normalizing TMDB movie stubs into unified card objects (`tmdbId`, `imdbID: "tmdb_" + item.id`, `title`, `year`, `release_date`, `poster`, `tmdbGenreIds`, `imdbRating` / `vote_average`, `vote_count`).

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/apiProxy.test.js tests/tmdbRabbitHoleHelpers.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add api/tmdb.js src/services/tmdbService.js tests/apiProxy.test.js tests/tmdbRabbitHoleHelpers.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(tmdb): allow collection, keyword, and recommendations proxy paths + helper normalizers" }`

---

### Task 2: Pure `exploreService.js` — Filter State, URL Sync, Discover Params & Vault Filtering

**Files:**
- Create: `src/services/exploreService.js`
- Test: `tests/exploreService.test.js`

**Interfaces:**
```js
export const DEFAULT_EXPLORE_FILTERS = Object.freeze({
  genres: [],          // number[] (AND/OR controlled by genreMode)
  genreMode: "and",    // "and" | "or"
  withoutGenres: [],   // number[]
  yearFrom: "",        // "1990"
  yearTo: "",          // "2026"
  runtimeMin: "",      // number | ""
  runtimeMax: "",      // number | ""
  minImdb: 6.5,        // number (0..9)
  minVotes: 150,       // number
  language: "",        // ISO-639-1 e.g. "ko"
  country: "",         // ISO-3166-1 e.g. "JP"
  keywords: [],        // [{ id: number, name: string }]
  person: null,        // { id: number, name: string } | null
  providers: [],       // number[]
  region: "US",
  sortBy: "popularity.desc",
  hideWatched: false,
  page: 1
});

export const DECADE_PRESETS = [ /* 2020s, 2010s, 2000s, 1990s, 1980s, Classic (<1980) */ ];
export const RUNTIME_PRESETS = [ /* Quick (<95m), Feature (95-135m), Epic (150m+) */ ];
export const EXPLORE_SORT_OPTIONS = [ /* popularity.desc, vote_average.desc, primary_release_date.desc, revenue.desc, vote_count.desc */ ];
export const LANGUAGE_OPTIONS = [ /* Any, English en, Japanese ja, Korean ko, French fr, Spanish es, German de, Italian it, Hindi hi */ ];

export function parseExploreSearchParams(searchOrString, defaultRegion = "US")
export function buildExploreSearchParams(filters) // URLSearchParams
export function buildExploreRoute(partialFilters = {}) // returns "/explore?..."
export function buildTmdbDiscoverParams(filters) // returns plain object for fetchTmdbJson("/3/discover/movie", params)
export function filterExploreResults(movies = [], watched = [], watchlist = [], { hideWatched = false } = {})
export function getActiveFilterChips(filters) // [{ key, label, clearPatch }]
```

- [ ] **Step 1: Write the failing test**
  Create `tests/exploreService.test.js`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import {
    buildExploreRoute,
    parseExploreSearchParams,
    buildTmdbDiscoverParams,
    filterExploreResults,
    getActiveFilterChips
  } from "../src/services/exploreService.js";

  test("buildExploreRoute and parseExploreSearchParams round-trip complex multi-facet filters", () => {
    const route = buildExploreRoute({
      genres: [878, 53],
      withoutGenres: [27],
      yearFrom: "2010",
      yearTo: "2024",
      runtimeMin: 90,
      runtimeMax: 150,
      minImdb: 7.5,
      minVotes: 500,
      language: "ko",
      keywords: [{ id: 4344, name: "time loop" }],
      person: { id: 525, name: "Christopher Nolan" },
      providers: [8, 9],
      region: "GB",
      sortBy: "vote_average.desc",
      hideWatched: true
    });
    const parsed = parseExploreSearchParams(route.split("?")[1], "US");
    assert.deepEqual(parsed.genres, [878, 53]);
    assert.deepEqual(parsed.withoutGenres, [27]);
    assert.equal(parsed.yearFrom, "2010");
    assert.equal(parsed.language, "ko");
    assert.deepEqual(parsed.keywords, [{ id: 4344, name: "time loop" }]);
    assert.deepEqual(parsed.person, { id: 525, name: "Christopher Nolan" });
    assert.deepEqual(parsed.providers, [8, 9]);
    assert.equal(parsed.region, "GB");
    assert.equal(parsed.hideWatched, true);
  });

  test("buildTmdbDiscoverParams enforces vote floor on vote_average.desc and expands provider families", () => {
    const params = buildTmdbDiscoverParams({
      genres: [878],
      genreMode: "or",
      withoutGenres: [27],
      yearFrom: "2015",
      yearTo: "2020",
      minImdb: 7,
      minVotes: 0,
      sortBy: "vote_average.desc",
      providers: [8],
      region: "US",
      page: 2
    });
    assert.equal(params.with_genres, "878");
    assert.equal(params.without_genres, "27");
    assert.equal(params["primary_release_date.gte"], "2015-01-01");
    assert.equal(params["primary_release_date.lte"], "2020-12-31");
    assert.equal(params["vote_average.gte"], "7");
    assert.ok(Number(params["vote_count.gte"]) >= 150);
    assert.match(params.with_watch_providers, /^8(\||$)/);
    assert.equal(params.watch_region, "US");
    assert.equal(params.page, 2);
  });

  test("filterExploreResults annotates Vault state and strips watched entries when hideWatched is active", () => {
    const movies = [
      { tmdbId: 100, imdbID: "tmdb_100", title: "Seen Film", year: "2020" },
      { tmdbId: 200, imdbID: "tmdb_200", title: "Fresh Film", year: "2021" }
    ];
    const watched = [{ tmdbId: 100, title: "Seen Film", userRating: 9 }];
    const watchlist = [{ tmdbId: 200, title: "Fresh Film" }];

    const all = filterExploreResults(movies, watched, watchlist, { hideWatched: false });
    assert.equal(all.length, 2);
    assert.equal(all[0].userRating, 9);
    assert.equal(all[1]._inWatchlist, true);

    const hidden = filterExploreResults(movies, watched, watchlist, { hideWatched: true });
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0].tmdbId, 200);
  });

  test("getActiveFilterChips generates removable chip summaries for non-default filters", () => {
    const chips = getActiveFilterChips({
      ...parseExploreSearchParams("", "US"),
      genres: [878],
      yearFrom: "1990",
      yearTo: "1999"
    });
    assert.ok(chips.some((c) => /Sci-Fi/i.test(c.label)));
    assert.ok(chips.some((c) => /1990/.test(c.label)));
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/exploreService.test.js`
  Expected: FAIL (`Cannot find module '../src/services/exploreService.js'`).

- [ ] **Step 3: Implement `src/services/exploreService.js`**
  - Reuse `TMDB_GENRE_MAP`, `TMDB_ID_TO_GENRE`, `expandProviderIds` from `./tmdbService.js` and `buildSeenCollisionSet`, `isSameMovie`, `findMatchingMovie` from existing services cleanly.
  - Ensure `GLOBAL` region gracefully falls back to `"US"` for TMDB `watch_region` when provider filtering is active (TMDB requires an ISO-3166-1 country alongside `with_watch_providers`).
  - Guard `keywords` encoding in query params safely using URI-safe `id:name` pairs (`encodeURIComponent` / `URLSearchParams`) so keyword names containing spaces, hyphens, or `&` never break parsing.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/exploreService.test.js`
  Expected: PASS (all 4 tests green).

- [ ] **Step 5: Commit**
  `git add src/services/exploreService.js tests/exploreService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(explore): add pure exploreService filter serialization and TMDB discover compiler" }`

---

### Task 3: Pure `rabbitHoleService.js` — Collection Timeline & Hybrid Similarity Blending

**Files:**
- Create: `src/services/rabbitHoleService.js`
- Test: `tests/rabbitHoleService.test.js`

**Interfaces:**
```js
export function normalizeCollectionTimeline(collectionData, currentMovie, watched = [], watchlist = [])
// returns null if empty parts; else { id, name, parts: [{ tmdbId, imdbID, title, year, release_date, poster, isCurrent, isWatched, isWatchlist, userRating }], watchedCount, totalCount }

export function findEmbeddingNeighborsForMovie(tmdbId, index, { excludeIds = new Set(), limit = 16 } = {})
// returns [{ tmdbId: number, sim: number }] sorted descending by cosine similarity (divides by norms for sub-unit vectors)

export function buildHybridSimilarFilms({
  currentMovie,
  embeddingNeighbors = [],       // [{ tmdbId, sim }]
  hydratedEmbeddingCards = [],   // resolved TMDB cards for top embedding neighbor IDs
  tmdbRecommendations = [],      // live TMDB recommendations/similar normalized cards
  collectionPartIds = new Set(), // optional deprioritize or badge if shown in CollectionTimeline above
  watched = [],
  watchlist = [],
  limit = 14
})
// returns normalized deduplicated cards annotated with isWatched, isWatchlist, userRating, matchOrigin ("hybrid" | "vault-vector" | "tmdb")
```

- [ ] **Step 1: Write the failing test**
  Create `tests/rabbitHoleService.test.js`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import { encodeEmbeddingBinary, parseEmbeddingBinary } from "../src/services/embeddingService.js";
  import {
    normalizeCollectionTimeline,
    findEmbeddingNeighborsForMovie,
    buildHybridSimilarFilms
  } from "../src/services/rabbitHoleService.js";

  test("normalizeCollectionTimeline sorts parts chronologically, places TBA last, and tracks Vault completion", () => {
    const timeline = normalizeCollectionTimeline(
      {
        id: 528,
        name: "Terminator Collection",
        parts: [
          { tmdbId: 280, title: "T2", release_date: "1991-07-03", poster: "p2" },
          { tmdbId: 999, title: "Future Untitled", release_date: "", poster: null },
          { tmdbId: 218, title: "The Terminator", release_date: "1984-10-26", poster: "p1" }
        ]
      },
      { tmdbId: 280 },
      [{ tmdbId: 218, userRating: 9 }],
      [{ tmdbId: 280 }]
    );
    assert.equal(timeline.parts[0].tmdbId, 218);
    assert.equal(timeline.parts[0].isWatched, true);
    assert.equal(timeline.parts[1].isCurrent, true);
    assert.equal(timeline.parts[2].tmdbId, 999);
    assert.equal(timeline.watchedCount, 1);
    assert.equal(timeline.totalCount, 3);
  });

  test("findEmbeddingNeighborsForMovie finds closest cosine kin including sub-unit shrunk vectors", () => {
    const buf = encodeEmbeddingBinary([
      { tmdbId: 10, vec: [0.6, 0.8, 0, 0] },
      { tmdbId: 20, vec: [0.3, 0.4, 0, 0] }, // sub-unit parallel -> cosine 1.0!
      { tmdbId: 30, vec: [0, 0, 1, 0] }
    ]);
    const index = parseEmbeddingBinary(buf);
    const neighbors = findEmbeddingNeighborsForMovie(10, index, { limit: 5 });
    assert.equal(neighbors[0].tmdbId, 20);
    assert.ok(neighbors[0].sim > 0.98);
    assert.ok(!neighbors.some((n) => n.tmdbId === 10));
  });

  test("buildHybridSimilarFilms deduplicates dual sources, boosts overlapping picks, and excludes self", () => {
    const res = buildHybridSimilarFilms({
      currentMovie: { tmdbId: 100, imdbID: "tt0100" },
      embeddingNeighbors: [{ tmdbId: 200, sim: 0.91 }, { tmdbId: 300, sim: 0.85 }],
      hydratedEmbeddingCards: [
        { tmdbId: 200, imdbID: "tmdb_200", title: "Overlap Film" },
        { tmdbId: 300, imdbID: "tmdb_300", title: "Vector Film" }
      ],
      tmdbRecommendations: [
        { tmdbId: 100, imdbID: "tmdb_100", title: "Self" },
        { tmdbId: 200, imdbID: "tmdb_200", title: "Overlap Film" },
        { tmdbId: 400, imdbID: "tmdb_400", title: "New 2025 Release" }
      ],
      watched: [{ tmdbId: 300, userRating: 8 }],
      watchlist: [],
      limit: 10
    });
    assert.ok(!res.some((m) => m.tmdbId === 100));
    assert.equal(res[0].tmdbId, 200);
    assert.equal(res[0].matchOrigin, "hybrid");
    assert.equal(res.length, 3);
    assert.equal(res.find((m) => m.tmdbId === 300)?.userRating, 8);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/rabbitHoleService.test.js`
  Expected: FAIL (`Cannot find module '../src/services/rabbitHoleService.js'`).

- [ ] **Step 3: Implement `src/services/rabbitHoleService.js`**
  - Implement true vector norm computation (`sqrt(sum(v*v))`) inside `findEmbeddingNeighborsForMovie()` so sub-unit shrunk vectors compare cleanly against unit vectors without bias.
  - Score `buildHybridSimilarFilms()`: give overlapping items (`CVEM` + `TMDB Recs`) primary priority, followed by alternating/rank-blended unshown `TMDB Recs` (ensuring recent 2024–2026 films get visibility!) and `CVEM` cards, deduplicating strictly with `isSameMovie` and `tmdbId`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/rabbitHoleService.test.js`
  Expected: PASS (all 3 tests green).

- [ ] **Step 5: Commit**
  `git add src/services/rabbitHoleService.js tests/rabbitHoleService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(rabbit-hole): add rabbitHoleService for franchise timelines and hybrid CVEM+TMDB similarity" }`

---

### Task 4: `/explore` Route, Page UI & Navigation Integration

**Files:**
- Create: `src/pages/ExplorePage.jsx`
- Create: `src/styles/explore.css`
- Modify: `src/App.jsx`
- Modify: `src/components/NavBar.jsx`
- Modify: `src/styles/nav-discover.css`
- Modify: `src/pages/DashboardPage.jsx`

- [ ] **Step 1: Implement `src/pages/ExplorePage.jsx` + `src/styles/explore.css`**
  - Read filter state from `useSearchParams()` via `parseExploreSearchParams(searchParams, userRegion)`.
  - Filter panel controls (left collapsible sticky sidebar on desktop, bottom/slide-in filter sheet on mobile `<=900px`):
    - Quick Presets: Decades (`2020s`, `2010s`, `2000s`, `90s`, `80s`, `Classics`), Runtimes (`Quick <95m`, `Feature`, `Epic 150m+`).
    - Include Genres (multi-select toggle chips) & Exclude Genres (collapsible negative pills).
    - Release Year Min / Max inputs + Minimum Rating slider (`0–9.0` step `0.5`) + Vote Count Floor selector (`Popular 150+`, `Broad 500+`, `Hidden Gems 25+`, `All 0+`).
    - Original Language select + Director/Actor live search autocomplete (`/3/search/person`) + `#Motif / Keyword` autocomplete (`searchTmdbKeywords`) + Streaming Providers (`POPULAR_WATCH_PROVIDERS` + `"My Providers"` 1-click sync from `userWatchProviders`).
    - Hide Already Watched toggle + Sort dropdown.
  - Main Grid Header: active removable filter chips (`getActiveFilterChips`), total TMDB matches (`totalResults.toLocaleString()`), and sorted grid of `<MovieCard />` items wired to `onQuickRate` and `/movie/:id`.
  - Load More pagination button fetching next TMDB page cleanly; auto-fetches/notifies when `hideWatched` filters out most items on the current page.
  - Race-condition guard (`AbortController` / request sequence counter) so rapid filter toggles never stomp newer results with stale responses.

- [ ] **Step 2: Wire `/explore` in `App.jsx`, `NavBar.jsx`, `DashboardPage.jsx` & CSS**
  - In `src/App.jsx`: add `<Route path="/explore" element={<ExplorePage onQuickRate={(m) => setQuickRateTarget(m)} />} />`.
  - In `src/components/NavBar.jsx`: add `<NavLink to="/explore">Explore</NavLink>` right after `Discover` in `.nav-links-desktop`, and add `Explore` (`SlidersHorizontal` / `Compass`) in `.mobile-stream-bar` (updating `.mobile-stream-bar` CSS in `nav-discover.css` to `grid-template-columns: repeat(5, 1fr)`).
  - In `src/pages/DashboardPage.jsx` / `HomePosterGrid` or section header: add a crisp `"Open Deep Filter ->"` button linking to `/explore`.

- [ ] **Step 3: Run tests & build**
  Run: `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
  Expected: Clean green tests and Vite build.

- [ ] **Step 4: Commit**
  `git add src/pages/ExplorePage.jsx src/styles/explore.css src/App.jsx src/components/NavBar.jsx src/styles/nav-discover.css src/pages/DashboardPage.jsx; if ($LASTEXITCODE -eq 0) { git commit -m "feat(explore): add /explore deep filter workbench route and navigation integration" }`

---

### Task 5: Movie Page "Rabbit Hole" Components & Wiring (`MovieDetails.jsx`)

**Files:**
- Create: `src/components/CollectionTimeline.jsx`
- Create: `src/components/SimilarFilmsStrip.jsx`
- Modify: `src/components/MovieDetails.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Create `CollectionTimeline.jsx` & `SimilarFilmsStrip.jsx`**
  - `CollectionTimeline.jsx`: displays chronological sequence badges (`Part 1`, `Part 2`...), current-film highlight indicator, Vault watched rating / Watchlist ribbon, `"X of Y Watched"` completion badge, and direct `<Link>` navigation to `/movie/tmdb_<id>`.
  - `SimilarFilmsStrip.jsx`: displays horizontal scrollable shelf of `MovieCard` (or streamlined poster cards) from `buildHybridSimilarFilms()`, showing quick-add (`onQuickAdd`) and `"Because it matches [Film Title]"` subtle origin subtitle, linking cleanly to `/movie/tmdb_<id>`.

- [ ] **Step 2: Wire Rabbit Hole into `MovieDetails.jsx` + Clickable Genres/Motifs**
  - In `loadEnrichedMovieDetails()` (`MovieDetails.jsx`), forward `collectionId: tmdbData?.collectionId ?? null`, `collectionName: tmdbData?.collectionName ?? null`, `keywordItems: tmdbData?.keywordItems || []` onto `combinedData`.
  - Replace static `<span className="netflix-genre-tag">` and `<span className="theme-keyword-chip">` spans with `<Link to={buildExploreRoute(...)}>` interactive pills using `tmdbGenreIds`/`TMDB_GENRE_MAP` and `keywordItems`.
  - Concurrently/lazily load on `movie.tmdbId` set:
    1. `fetchCollectionTimeline(movie.collectionId)` when `movie.collectionId > 0`.
    2. `loadDefaultEmbeddingIndex()` + `fetchTmdbMovieRecommendations(movie.tmdbId)` -> hydrate top unhydrated `CVEM` IDs via `getMovieDetailsBatch(topNeighborIds)` (`apiTransport.js` batch/cache!), passing results into `buildHybridSimilarFilms()`.
  - Cancel stale fetches cleanly via cleanup flag when `selectedId` changes.

- [ ] **Step 3: Style Rabbit Hole shelves cleanly in `src/index.css`**
  - Add responsive horizontal strip styles (`.collection-timeline-strip`, `.collection-part-card.is-current`, `.rabbit-hole-section`, `.clickable-research-chip`) respecting `tokens.css` hairlines and mobile snapping.

- [ ] **Step 4: Run Phase 2 Verification (`npm test` + `npm run build` + live route check)**
  Run: `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
  Verify live on `/explore` and `/movie/tt0816692` / `/movie/tmdb_155` (Dark Knight trilogy timeline + clickable `#motifs` -> filtered `/explore` page + "Movies Like This").

- [ ] **Step 5: Commit**
  `git add src/components/CollectionTimeline.jsx src/components/SimilarFilmsStrip.jsx src/components/MovieDetails.jsx src/index.css; if ($LASTEXITCODE -eq 0) { git commit -m "feat(rabbit-hole): add clickable genres/motifs, franchise timeline, and hybrid Similar Films strip" }`
