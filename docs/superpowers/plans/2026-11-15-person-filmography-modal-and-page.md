# Interactive Actor, Director & Crew Filmography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cast cards and creative credits (`Director`, `Screenplay & Writers`, `Cinematography`, `Original Score`) clickable in `MovieDetails`, opening a CinemaVault-styled Filmography Modal with personal Vault stats, department filters, Quick Rate / Watchlist actions, and a `"View Full Profile →"` handoff to `/person/:id`.

**Architecture:** Extract pure person lookup, credit deduplication, `"Self"` filtering, Vault status annotation, affinity stats, and keyboard-escape predicates into `src/services/personService.js`, extend `/api/tmdb` and `formatTmdbMovieDetails` to expose safe person endpoints and crew IDs, build one shared UI explorer (`PersonFilmographyExplorer.jsx`) consumed by both `PersonFilmographyModal.jsx` and `PersonPage.jsx`, and wire click triggers + Quick Rate pass-through across `MovieDetails.jsx`, `MoviePage.jsx`, and `App.jsx`.

**Tech Stack:** React 18, React Router v6 (`useParams`, `useSearchParams`, `useNavigate`), TMDB API v3 via `fetchTmdbJson` & Vercel `/api/tmdb`, editorial CSS tokens (`tokens.css` + `src/styles/person.css`), Node built-in test runner (`node --test`), Vite 5.

**Spec:** [docs/superpowers/specs/2026-11-15-person-filmography-design.md](../specs/2026-11-15-person-filmography-design.md)

## Global Constraints

- **Credential & Proxy Isolation:** Client code NEVER reads or embeds `TMDB_API_KEY`; all live TMDB person requests go through `fetchTmdbJson` (`apiTransport.js`), and [api/tmdb.js](../../../api/tmdb.js) `ALLOWED_TMDB_PATH_RE` adds only `search/person` and `person/\d+(?:/movie_credits)?` while rejecting `..` traversal, non-GET methods, and `/3/trending/person/*`.
- **Editorial Visual Discipline:** Use semantic tokens from `src/styles/tokens.css` (`#0d0e11` `--bg`, `#14161b` `--surface-1`, `#1c1e25` `--surface-2`, `--hairline`, `--text-1..3`, `--r-sm: 6px`, `--r-lg: 12px`) with gold `--accent` (`#e5b84b`) reserved strictly for Vault star ratings and `:focus-visible` focus rings; never introduce neon glows.
- **No Production Weight / Score Mutation:** Never alter ranker weights (`rankerService.js`), `scoringUtils.js`, `ratingTiers.js` contracts (`prepareQuickRatePayload` / `prepareWatchlistPayload`), or invent ratings when adding Watchlist items.
- **Zero Duplicated Business or Filter Logic:** `src/services/personService.js` owns all TMDB credit parsing, Vault matching (`findMatchingMovie`), filtering, sorting, and cache handling; `PersonFilmographyExplorer.jsx` owns all filmography filter/grid UI for both the modal overlay and `/person/:id`.
- **Node-Compatible Pure `.js` Services & Offline Testing:** All `tests/*.test.js` files run directly under `node --test` (ESM without JSX loaders), so all testable logic (including crew parsing, Escape guards, route helpers, and credit filtering) stays in `.js` service modules with injectable `fetchFn` / `signal`.
- **Verification Discipline:** Check `npm test` and `npm run build` after changes, committing each task cleanly as sequential TDD units.

## Review Focus

1. **OMDb-Only Movies & Synthetic Cast Indices (`id: 0, 1, 2`):** [MovieDetails.jsx](../../../src/components/MovieDetails.jsx#L181) currently assigns `id: i` on OMDb cast splits (making Actor #2 have `id: 1`, which in TMDB is George Lucas!). Task 1/4 replaces `id: i` with `id: null` and Task 2 tests that `fetchPersonProfileAndCredits({ id: null, name })` resolves via `/3/search/person` instead of calling `/3/person/1`.
2. **TMDB `movie_credits` Noise (Duplicate Roles, `"Self"` Talk Shows, Missing Titles/IDs):** People frequently hold multiple roles on one film (`Director` + `Writer` + cameo) and actors accumulate talk-show/making-of `"Self"` credits with high popularity. Task 2 pins tests verifying duplicate `tmdbId` entries merge roles cleanly without duplicate cards, `"Self"` entries drop by default (falling back safely if someone has *only* documentary credits), and zero-ID rows are skipped.
3. **Vault Matching Across Mixed IDs (`tt...` vs `tmdb_<id>` vs `tmdbId`):** Vault films may carry `imdbID`, `tmdb_<id>`, numeric `tmdbId`, or title+year. Task 2 pins `annotateCreditsWithVaultState` + `computePersonVaultStats` tests using `findMatchingMovie` across numeric `tmdbId`, `"tmdb_123"` prefixed Vault rows, Watchlist entries, and unrated Watchlist exclusion from `averageVaultRating`.
4. **Rapid Switch Race Conditions, AbortSignal & HTTP `429` Handling:** Clicking Actor A then quickly closing or switching to Director B, or hitting rate limits, must abort stale fetches cleanly and never overwrite cache or crash with unhandled rejections. Task 2 tests `AbortError` suppression (without polluting cache) and non-`ok` (`429`) graceful `null` + `onHttpError` callback handling.
5. **Stacked `Escape` & Department Preservation Across Modal -> Full Profile -> Quick Rate:** Pressing `Escape` while `PersonFilmographyModal` or `QuickRateModal` is open on `/movie/:id` must close only the topmost dialog instead of navigating back out of `MovieDetails`; and clicking `"View Full Profile →"` while inspecting a Director tab must preserve `?dept=directing` on `/person/:id`. Task 2 tests `shouldCloseMovieDetailOnEscape`, `resolvePersonDefaultDepartment`, and `buildPersonProfileRoute`; Tasks 3–4 wire them cleanly at `z-index: 8500` (modal) below `<Modal>` (`9999`).

---

### Task 1: Proxy Allowlist for Person Endpoints + Structured Crew IDs

**Files:**
- Modify: `api/tmdb.js:3-5`
- Modify: `src/services/tmdbService.js:1155-1255`
- Modify: `tests/apiProxy.test.js`
- Create: `tests/personService.test.js`

**Interfaces:**
- Consumes: `ALLOWED_TMDB_PATH_RE` in `api/tmdb.js`, raw TMDB `credits.crew` inside `formatTmdbMovieDetails(data, userRegion)` in `src/services/tmdbService.js`.
- Produces:
  - `/api/tmdb?path=/3/person/<id>` (with `append_to_response=movie_credits,external_ids`), `/api/tmdb?path=/3/person/<id>/movie_credits`, and `/api/tmdb?path=/3/search/person` allowed through `api/tmdb.js`.
  - `formatTmdbMovieDetails` returns additive arrays `directorDetails`, `writerDetails`, `cinematographerDetails`, `composerDetails` (`Array<{ id: number, name: string, job: string, department: string }>`), deduplicated by numeric `id`, preserving all existing fields unchanged.

- [ ] **Step 1: Write failing tests for `/api/tmdb` person endpoints and `formatTmdbMovieDetails` crew arrays**

In `tests/apiProxy.test.js`: add test `"api/tmdb handler allows safe /3/person/:id and /3/search/person paths while blocking non-numeric or person trending paths"` asserting:
- `GET /api/tmdb?path=/3/person/71580&append_to_response=movie_credits` -> `200` and forwards `api_key=SERVER_TMDB_SECRET`.
- `GET /api/tmdb?path=/3/person/71580/movie_credits` -> `200`.
- `GET /api/tmdb?path=/3/search/person&query=Morten%20Tyldum` -> `200`.
- `GET /api/tmdb?path=/3/person/not-a-number` -> `400`.
- `GET /api/tmdb?path=/3/trending/person/week` -> `400`.

In `tests/personService.test.js`: add initial test `"formatTmdbMovieDetails preserves structured directorDetails, writerDetails, cinematographerDetails, and composerDetails IDs"`:
- Pass mock TMDB movie payload containing co-directors, duplicate writer credit (`Screenplay` + `Story` same `id`), `Director of Photography`, `Original Music Composer`, and verify exact `{ id, name, job, department }` entries while keeping scalar `director`, `writers`, `cinematographer`, `composer` intact.

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `node --test tests/apiProxy.test.js tests/personService.test.js`
Expected: FAIL (`400` on `/3/person/71580` & `/3/search/person`; `directorDetails` is `undefined`).

- [ ] **Step 3: Implement `ALLOWED_TMDB_PATH_RE` update in `api/tmdb.js` and `extractUniqueCrewPeople` helper in `src/services/tmdbService.js`**

- Update `ALLOWED_TMDB_PATH_RE` in [api/tmdb.js](../../../api/tmdb.js#L3-L4) to:
  `/^\/3\/(discover\/movie|search\/(?:movie|person)|trending\/movie\/(?:day|week)|movie\/\d+(?:\/(?:keywords|credits|watch\/providers|videos|release_dates|external_ids))?|person\/\d+(?:\/movie_credits)?|find\/[a-zA-Z0-9_-]+)$/;`
- In [src/services/tmdbService.js](../../../src/services/tmdbService.js), add a small internal helper `extractUniqueCrewPeople(crewList, jobs, department)` filtering valid `c?.id` and `c?.name`, deduplicating by `c.id`, capping writers at `3`, and include `directorDetails`, `writerDetails`, `cinematographerDetails`, `composerDetails` on the object returned by `formatTmdbMovieDetails`.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run: `node --test tests/apiProxy.test.js tests/personService.test.js`
Expected: PASS (0 failed).

- [ ] **Step 5: Commit Task 1**

```powershell
git add api/tmdb.js src/services/tmdbService.js tests/apiProxy.test.js tests/personService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(tmdb): allow person endpoints in /api/tmdb and preserve crew person IDs" }
```

---

### Task 2: Create `src/services/personService.js` (Fetch/Cache, Normalization, Vault Overlay, Filter/Sort & Keyboard/Route Helpers)

**Files:**
- Create: `src/services/personService.js`
- Modify: `tests/personService.test.js`

**Interfaces:**
- Consumes: `fetchTmdbJson` & `hasTmdbBackend` (`src/services/apiTransport.js`), `findMatchingMovie` (`src/services/movieIdentity.js`).
- Produces (`export` from `src/services/personService.js`):
  - `PERSON_DEPARTMENT_TABS` (`all`, `acting`, `directing`, `writing`, `crew`)
  - `extractMovieCreditPeople(movie)` -> `{ cast, directors, writers, cinematographers, composers }`
  - `resolvePersonDepartmentKey(roleOrDepartment)` -> `"acting" | "directing" | "writing" | "crew" | "all"`
  - `resolvePersonDefaultDepartment(roleHint, credits)` -> department tab ID
  - `normalizePersonCredits(rawMovieCredits, options)` -> deduplicated feature-film credit objects (`{ id, tmdbId, title, year, releaseDate, poster, backdrop, overview, voteAverage, voteCount, popularity, genreIds, departments, primaryDepartment, rolesLabel, character, jobs, castOrder, isSelfCredit }`)
  - `annotateCreditsWithVaultState(credits, watched, watchlist)` -> attaches `vaultStatus` (`"watched" | "watchlist" | "unseen"`), `userRating`, `watchedEntry`, `inWatchlist`
  - `computePersonVaultStats(annotatedCredits)` -> `{ totalCredits, watchedCount, watchlistCount, averageVaultRating, highestRatedFilm }`
  - `filterAndSortPersonCredits(annotatedCredits, filters)` -> sorted/filtered credits (`department`, `vaultFilter`: `"all" | "watched" | "unwatched" | "watchlist"`, `sortBy`: `"popular" | "top_rated" | "newest"`, `searchQuery`)
  - `buildPersonProfileRoute(personId, department)` -> route string (`/person/<id>[?dept=<tab>]`)
  - `shouldCloseMovieDetailOnEscape({ activePerson, hasOpenDialog })` -> `boolean`
  - `clearPersonCache()` -> clears session Map
  - `fetchPersonProfileAndCredits(target, options)` -> `Promise<{ person, rawMovieCredits, imdbUrl } | null>` (supporting `{ id, name, roleHint }` and `{ apiKey, forceProxy, fetchFn, signal, onHttpError, forceRefresh }`)

- [ ] **Step 1: Write comprehensive failing tests in `tests/personService.test.js`**

Add tests exercising all 5 Review Focus conditions plus core filtering/sorting contracts:
1. `"extractMovieCreditPeople extracts TMDB IDs when present and converts OMDb strings cleanly without synthetic numeric IDs"` — verify real numeric `id` preserved on TMDB credits, comma-separated OMDb Director/Writer fallback names emit `id: null`, and synthetic small-index fallback items cannot pretend to be real TMDB IDs.
2. `"normalizePersonCredits merges duplicate cast+crew credits per tmdbId and filters out Self/talk-show noise by default"` — include a movie appearing in both `cast` (`character: "Alan Turing"`) and `crew` (`job: "Executive Producer"`), another with `character: "Himself"` / `genre_ids: [99]`, and verify single merged row with `rolesLabel` combining both roles, `"Himself"` omitted when `includeSelfAppearances` is falsy, and preserved when person only has documentary/self credits or `includeSelfAppearances: true`.
3. `"annotateCreditsWithVaultState & computePersonVaultStats match mixed imdb/tmdb/title::year entries and exclude watchlist from rating average"` — match Vault items keyed with `"tmdb_205596"`, `"tt2084970"` (with matching title+year fallback when credit lacks `imdb_id`), plus an unrated Watchlist item; verify `watchedCount: 2`, `watchlistCount: 1`, exact `averageVaultRating`, and `highestRatedFilm`.
4. `"filterAndSortPersonCredits & resolvePersonDefaultDepartment filter by department, vault status, query, and sort modes"` — verify `"Directing"` role hint picks `"directing"` when count > 0, falls back cleanly when count === 0, filters `"unwatched"` / `"watched"` / `"watchlist"`, and sorts `"top_rated"` (with vote threshold tie-breaking), `"newest"`, and `"popular"`.
5. `"fetchPersonProfileAndCredits resolves name-only entries via /3/search/person, caches session responses, respects signal AbortError, and handles HTTP 429 cleanly"` — mock `fetchFn` with `forceProxy: true`:
   - Call with `{ id: null, name: "Morten Tyldum", roleHint: "Directing" }`: assert `/api/tmdb` first hits `/3/search/person`, then hits `/3/person/<resolvedId>` with `append_to_response=movie_credits,external_ids`.
   - Call again with `{ id: resolvedId }`: assert session cache serves result with **0 additional fetch calls**.
   - Clear cache and call with an already-aborted `AbortController.signal`: assert clean abort/rejection or non-cached return without poisoning cache.
   - Clear cache and mock HTTP `429`: assert `onHttpError(429)` fires and `null` returns cleanly without throwing uncaught error.
6. `"buildPersonProfileRoute and shouldCloseMovieDetailOnEscape preserve department tab and block background escape when dialog is open"` — assert `/person/57633?dept=directing`, `/person/71580` when `"all"`, `shouldCloseMovieDetailOnEscape({ activePerson: { name: "X" }, hasOpenDialog: false }) === false`, `shouldCloseMovieDetailOnEscape({ activePerson: null, hasOpenDialog: true }) === false`, and `shouldCloseMovieDetailOnEscape({ activePerson: null, hasOpenDialog: false }) === true`.

- [ ] **Step 2: Run `tests/personService.test.js` to confirm failure**

Run: `node --test tests/personService.test.js`
Expected: FAIL (`Cannot find module '../src/services/personService.js'`).

- [ ] **Step 3: Implement `src/services/personService.js`**

- Structure helper functions cleanly with shallow nesting:
  - Poster builder (`w342` for credits, `w185`/`h632` for portraits), department normalization (`Acting` -> `acting`, `Directing` -> `directing`, `Writing` -> `writing`, everything else -> `crew`), `"Self"` regex (`/\b(?:self|himself|herself|themselves|archive footage|uncredited cameo)\b/i`).
  - Match Vault rows via `findMatchingMovie(creditCandidate, list)` passing `{ id: c.tmdbId, tmdbId: c.tmdbId, imdbID: c.imdbId || null, title: c.title, year: c.year }`. Note on homonyms: because `findMatchingMovie` in `movieIdentity.js` checks exact IDs first and only uses `ty:` when IDs aren't conflicting, verify ID-bearing Vault entries don't false-match unrelated homonyms! (Actually pass `tmdbId: c.tmdbId` so two *distinct* `tmdbId`s from the same year NEVER collide!)
  - Maintain session cache `personSessionCache = new Map()` storing only resolved complete payloads (`id:<num>` + `name:<lower>`), skipping cache writes on `AbortError` or HTTP errors.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/personService.test.js`
Expected: PASS (all `personService` assertions green).

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/services/personService.js tests/personService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(person): add personService lookup, credit normalization, Vault stats, and escape guards" }
```

---

### Task 3: Editorial CSS (`src/styles/person.css`), Shared Explorer (`PersonFilmographyExplorer.jsx`), Modal Overlay (`PersonFilmographyModal.jsx`), and Full Profile Page (`PersonPage.jsx`)

**Files:**
- Create: `src/styles/person.css`
- Modify: `src/index.css:1-8` (add `@import "./styles/person.css";`)
- Create: `src/components/PersonFilmographyExplorer.jsx`
- Create: `src/components/PersonFilmographyModal.jsx`
- Create: `src/pages/PersonPage.jsx`

**Interfaces:**
- Consumes: `src/services/personService.js` exports, `Tabs` (`src/components/ui/Tabs.jsx`), `PosterImage` (`src/components/PosterImage.jsx`), `prepareWatchlistPayload` (`src/services/ratingTiers.js`), `useApp` (`src/context/AppContext.jsx`).
- Produces:
  - `PersonFilmographyExplorer`:
    Props: `{ credits = [], activeDepartment, onDepartmentChange, showSearch = false, watched = [], watchlist = [], onSelectMovie, onQuickRate, onAddToWatchlist }`
    Renders department `Tabs` with counts (`All Credits`, `Acting`, `Directing`, `Writing`, `Crew` — hiding empty non-`all` tabs), Vault filter pills (`All`, `In Vault`, `Unwatched`, `Watchlist`), Sort buttons/select (`Popular`, `Top Rated`, `Newest`), optional live title search input (`showSearch`), and responsive poster card grid with gold `Watched <r>★` badges (`var(--accent)`), `Watchlist` pills, 1-click `★ Rate` (`onQuickRate`) & `+ Watchlist` (`onAddToWatchlist`) buttons, plus click-through to `onSelectMovie(credit)`.
  - `PersonFilmographyModal`:
    Props: `{ personTarget, watched = [], watchlist = [], onClose, onSelectMovie, onQuickRate, onAddToWatchlist, onOpenFullProfile }`
    Renders portal modal (`zIndex: 8500`, strictly below `Modal.jsx` / `QuickRateModal` at `9999`), backdrop click + `Escape` close (only if no nested higher dialog such as `QuickRateModal` is open), compact portrait/name/known-for/1-line bio header, personal Vault Affinity bar (`Watched · Avg ★ · Watchlist`), `"View Full Profile →"` action button calling `onOpenFullProfile(resolvedPersonId, activeDepartment)` (when resolved TMDB `id` exists), loading state, retryable error banner, and `PersonFilmographyExplorer`.
  - `PersonPage`:
    Props: `{ onQuickRate }`
    Mounted at `/person/:id`; reads `:id` via `useParams()` and initial `?dept=` via `useSearchParams()`, updates URL `?dept=` cleanly when department tabs change (`replace: true`), renders `← Back`, full hero portrait + metadata (`knownForDepartment`, birthday/age/placeOfBirth, expandable Biography with `"Read more"` / `"Show less"`, IMDb external link if present), Vault Affinity Stats bar (`totalCredits`, `watchedCount`, `averageVaultRating`, `highestRatedFilm` clickable chip), and `PersonFilmographyExplorer` with `showSearch={true}`.

- [ ] **Step 1: Add scoped editorial styles in `src/styles/person.css` and import in `src/index.css`**

- Define CSS classes strictly using `tokens.css` variables (`--bg`, `--surface-1`, `--surface-2`, `--surface-3`, `--hairline`, `--hairline-strong`, `--text-1..3`, `--accent`, `--focus-ring`, `--r-sm`, `--r-lg`, `--sh-3`) plus mobile breakpoints cleanly aligned with `.page-rail`:
  - `.person-modal-backdrop` (`z-index: 8500`, centered responsive shell, scroll containment) and `.person-modal-dialog` (`max-width: 960px`, internal scrollable body `max-height: min(86vh, 780px)`).
  - `.person-credit-card`, `.person-credit-poster`, `.person-credit-actions`, `.person-vault-pill` (`border-color` gold highlight only when watched + rated), interactive clickable styles `.cast-actor-card--interactive` & `.credit-person-btn` for `MovieDetails.jsx` with `:focus-visible` ring (`var(--focus-ring)`).
  - `@import "./styles/person.css";` at line 7 of `src/index.css`.

- [ ] **Step 2: Create `src/components/PersonFilmographyExplorer.jsx`**

- Use `useMemo` over `normalizePersonCredits` + `annotateCreditsWithVaultState(credits, watched, watchlist)` + `filterAndSortPersonCredits`.
- Clicking a card's poster/title calls `onSelectMovie(credit)`; clicking `★ Rate` calls `e.stopPropagation(); onQuickRate?.(...)` with normalized candidate shape `{ imdbID: credit.imdbId || null, id: credit.tmdbId, tmdbId: credit.tmdbId, title: credit.title, Title: credit.title, year: credit.year, Year: credit.year, poster: credit.poster, Poster: credit.poster, imdbRating: credit.voteAverage, tmdbRating: credit.voteAverage }`; clicking `+ Save` calls `e.stopPropagation(); onAddToWatchlist?.(prepareWatchlistPayload(...))`.
- Render helpful empty-filter reset button (`"Show all credits"`) whenever a Vault filter or search yields 0 matches.

- [ ] **Step 3: Create `src/components/PersonFilmographyModal.jsx`**

- Manage fetch via `useEffect` + `AbortController` calling `fetchPersonProfileAndCredits(personTarget, { signal: controller.signal })`.
- Initialize `activeDepartment` via `resolvePersonDefaultDepartment(personTarget?.roleHint, normalizedCredits)` once credits arrive (respecting explicit user tab switches afterward).
- Register document `keydown` `Escape` listener that ignores `Escape` if a higher modal dialog (e.g., `QuickRateModal` inside `[data-quick-rate-modal]` or `aria-modal` stacked after it) is currently mounted in the DOM — specifically check if any element matching `.cv-quick-rate-dialog` / nested `Modal` exists, or give `PersonFilmographyModal` an explicit `data-person-modal="true"` attribute and close only when `!document.querySelector('[data-cv-modal="top"]')`! Wait — check `Modal.jsx`: adding `e.stopImmediatePropagation()` in `Modal.jsx`? Even simpler and zero-touch on `Modal.jsx`: give `PersonFilmographyModal` an attribute `data-person-modal` and only close on `Escape` when no `[role="dialog"]:not([data-person-modal])` exists in the DOM (since `QuickRateModal` / `SearchModal` render `[role="dialog"]` WITHOUT `data-person-modal`!).
- Verify `"View Full Profile"` button passes `resolvedId` and `activeDepartment` into `onOpenFullProfile(resolvedId, activeDepartment)`.

- [ ] **Step 4: Create `src/pages/PersonPage.jsx`**

- Reads `id` from `useParams()`, `[searchParams, setSearchParams]` from `useSearchParams()`, `{ watched, watchlist, addToWatchlist }` from `useApp()`.
- Scrolls top on `id` change (`window.scrollTo(0, 0)`), sets `document.title = "${person.name} | CinemaVault"`, handles invalid/non-numeric IDs or fetch failures with clean Error + Retry + `"Go Back"` controls.
- Full hero displays portrait (`w185`/`h632` with clean fallback), `knownForDepartment`, birthday / place of birth, expandable biography (collapses beyond 320 chars with accessible toggle button), optional IMDb link (`https://www.imdb.com/name/${imdbId}/`), and Vault Affinity Stats strip + clickable `highestRatedFilm` shortcut + `PersonFilmographyExplorer`.

- [ ] **Step 5: Verify JSX build cleanly**

Run: `npm run build`
Expected: PASS (`vite build` transforms all modules cleanly with 0 syntax/import errors).

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/styles/person.css src/index.css src/components/PersonFilmographyExplorer.jsx src/components/PersonFilmographyModal.jsx src/pages/PersonPage.jsx; if ($LASTEXITCODE -eq 0) { git commit -m "feat(ui): add PersonFilmographyExplorer, PersonFilmographyModal, and /person/:id PersonPage" }
```

---

### Task 4: Wire Clickable Credits in `MovieDetails`, Forward Quick Rate & Route `/person/:id` in `App.jsx`, Update Docs & Verify

**Files:**
- Modify: `src/components/MovieDetails.jsx:179-245, 272-285, 840-915`
- Modify: `src/pages/MoviePage.jsx:1-45`
- Modify: `src/App.jsx:1-25, 160-185`
- Modify: `README.md`, `ARCHITECTURE.md`, `SPEC.md`, `LOCAL_MODEL_GUIDE.md`, `summary.md`

**Interfaces:**
- Consumes: `PersonFilmographyModal` (`src/components/PersonFilmographyModal.jsx`), `PersonPage` (`src/pages/PersonPage.jsx`), `extractMovieCreditPeople`, `buildPersonProfileRoute`, `shouldCloseMovieDetailOnEscape` (`src/services/personService.js`).
- Produces:
  - Interactive Cast cards and Director / Writers / Cinematographer / Composer buttons inside `MovieDetails.jsx`.
  - Live route `/person/:id` in `App.jsx`.
  - Working Quick Rate overlay from BOTH `PersonFilmographyModal` and `PersonPage`.

- [ ] **Step 1: Wire `MovieDetails.jsx` clickable cast/credits, `id: null` OMDb guard, Escape guard, and `PersonFilmographyModal`**

- Fix line `181` in [src/components/MovieDetails.jsx](../../../src/components/MovieDetails.jsx#L181): change OMDb cast fallback from `id: i` to `id: null` (`key={actor.id || actor.name}`).
- Copy `directorDetails`, `writerDetails`, `cinematographerDetails`, `composerDetails` from `tmdbData` into `combinedData` inside `loadEnrichedMovieDetails`.
- Use `useNavigate()` inside `MovieDetails` plus `onQuickRate` prop from `MoviePage` so:
  - `activePerson` resets to `null` whenever `selectedId` changes.
  - `.cast-actor-card` renders as `<button type="button" className="cast-actor-card cast-actor-card--interactive" onClick={() => openPerson({ id: actor.id, name: actor.name, roleHint: "Acting", profile: actor.profile })}>`.
  - Creative Credits (`Director`, `Screenplay & Writers`, `Cinematography (DoP)`, `Original Score`) derive lists via `extractMovieCreditPeople(movie)` and render clickable `<button type="button" className="credit-person-btn">` chips separated cleanly by `", "`.
  - Update the document `Escape` listener (`lines 273-281`) to check `shouldCloseMovieDetailOnEscape({ activePerson, hasOpenDialog: Boolean(document.querySelector('[role="dialog"]')) })` before invoking `onCloseMovie()`.
  - Render `<PersonFilmographyModal>` passing `watched`, `watchlist`, `onClose={() => setActivePerson(null)}`, `onSelectMovie={(credit) => { setActivePerson(null); navigate(`/movie/${credit.tmdbId}`); }}`, `onQuickRate={onQuickRate}`, `onAddToWatchlist={handleAddToWatchlist}`, and `onOpenFullProfile={(personId, dept) => { setActivePerson(null); navigate(buildPersonProfileRoute(personId, dept)); }}`.

- [ ] **Step 2: Wire `MoviePage.jsx` and `App.jsx`**

- In [src/pages/MoviePage.jsx](../../../src/pages/MoviePage.jsx): accept `{ onQuickRate }` prop and pass `onQuickRate={onQuickRate}` to `<MovieDetails />`.
- In [src/App.jsx](../../../src/App.jsx): import `PersonPage`, pass `onQuickRate={(m) => setQuickRateTarget(m)}` to `<MoviePage />`, and add `<Route path="/person/:id" element={<PersonPage onQuickRate={(m) => setQuickRateTarget(m)} />} />` before the `*` catch-all route.

- [ ] **Step 3: Sync project documentation**

- Concisely document interactive Actor / Director / Crew click-through (`PersonFilmographyModal` + `/person/:id` `PersonPage`, `personService.js`, `api/tmdb.js` person allowlist, and updated test suite count) across [README.md](../../../README.md), [ARCHITECTURE.md](../../../ARCHITECTURE.md), [SPEC.md](../../../SPEC.md), [LOCAL_MODEL_GUIDE.md](../../../LOCAL_MODEL_GUIDE.md), and [summary.md](../../../summary.md) without disturbing existing sections.

- [ ] **Step 4: Run full automated test suite and production Vite build**

Run:
```powershell
npm test; if ($LASTEXITCODE -eq 0) { npm run build }
```
Expected: ALL unit tests pass (0 failed, 0 skipped) and `vite build` exits 0 cleanly.

- [ ] **Step 5: Live Dev Server Browser Smoke Test (Recommended End-to-End Check)**

- Start `npm start`, open `/movie/tt2084970` (*The Imitation Game*) in browser:
  1. Click **Benedict Cumberbatch** card -> verify `PersonFilmographyModal` opens with **Acting** active, Vault match/avg badges display accurately, and pressing `Escape` closes only the modal (does NOT exit *The Imitation Game*).
  2. Click **Morten Tyldum** under Director -> verify modal opens with **Directing** selected cleanly.
  3. Click `"View Full Profile →"` -> verify `/person/57633?dept=directing` renders full portrait, bio, Vault stats, and filmography cards with working Quick Rate / Watchlist / Movie card navigation.

- [ ] **Step 6: Commit Task 4**

```powershell
git add src/components/MovieDetails.jsx src/pages/MoviePage.jsx src/App.jsx README.md ARCHITECTURE.md SPEC.md LOCAL_MODEL_GUIDE.md summary.md; if ($LASTEXITCODE -eq 0) { git commit -m "feat(ui): make MovieDetails cast and credits clickable with modal and /person/:id route" }
```
