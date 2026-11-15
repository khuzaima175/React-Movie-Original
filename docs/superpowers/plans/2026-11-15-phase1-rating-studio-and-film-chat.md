# Phase 1: Studio Rating UI & Movie-Aware AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `/movie/:id` Rating Module into a precision studio instrument with live Vault calibration and optional craft/log depth, and wire a "Discuss This Film" trigger into a movie-aware Gemini Film Companion session.

**Architecture:** Extract all Vault calibration math, craft breakdown normalization, watch session metadata handling, movie chat context serialization, spoiler-guard prompt rules, and session focus URL/cache coordination into pure ESM services (`ratingStudioService.js`, `filmChatService.js`, `geminiChatService.js`) covered by `node --test` suites before touching React components (`MovieDetails.jsx`, `AIPage.jsx`, `AIChat.jsx`) or editorial styling (`src/index.css`, `src/styles/oracle.css`).

**Tech Stack:** React 18, React Router v6 (`useSearchParams`, `useNavigate`), Lucide icons, `@google/genai` via `geminiChatService.js`, Node ESM native test runner (`node --test`), Vite.

---

### Spec & Global Constraints
- **Design Spec:** [docs/superpowers/specs/2026-11-15-research-hub-and-studio-design.md](../specs/2026-11-15-research-hub-and-studio-design.md)
- **Constraint 1 (Node ESM Test Boundary):** `npm test` runs `node --test` without a JSX loader. Pure calculation, payload, prompt-building, and URL helper functions must stay strictly inside `.js` files under `src/services/` with zero `.jsx` imports.
- **Constraint 2 (Editorial Token Discipline):** Gold (`var(--accent)`) is strictly reserved for active rating scores, filled stars, and focus rings (`src/styles/tokens.css`). Remove neon colored `box-shadow` glow overrides from `.rating-tier-banner` and score buttons; use surface contrast (`--surface-1`/`--surface-2`), hairlines (`--hairline`), and `.tabular-num` typography.
- **Constraint 3 (Backward-Compatible Persistence):** `ratingBreakdown` and `watchMeta` must be omitted (not stored as empty nulls) unless the user actively sets craft scores or watch metadata, ensuring zero schema bloat on simple 1–10 ratings and automatic JSONB pass-through in `vaultSyncService.js` (`mapLocalMovieToDbRow` places non-core fields into `metadata`).
- **Constraint 4 (Prompt & UI Resilience):** `sendChatMessage(userMessage, chatHistory, watchedMovies, tasteRules, activeMovieContext, chatOptions)` must preserve full backward compatibility when called with 3 or 4 arguments.

---

### Review Focus (5 Failure Modes Pinned by Tests)
1. **Unrated / Sparse Vault Edge Cases:** `computeVaultCalibration()` must never divide by zero or crash when `watched` is empty or has only unrated (`0`) entries; it must return crisp fallback labels without crashing or emitting `NaN%`.
2. **Preserve Rating Craft & Watch Meta Across Re-edits:** Re-saving only a rating number or note in `MovieDetails.jsx` must never silently wipe existing `ratingBreakdown` / `watchMeta` from `watchedItem`, and clearing all craft aspects back to `0` must cleanly drop empty `ratingBreakdown`.
3. **XSS / Prompt Injection & Size Caps on Movie Chat Dossier:** `serializeFilmDossierForPrompt()` must sanitize control chars/excess whitespace, cap plot/notes lengths, and gracefully handle thin stubs missing director/keywords/cast.
4. **Refresh Resilience on `/ai?tab=chat`:** Deep-linking directly to `/ai?tab=chat&tmdbId=157336` (or after browser reload when navigation state is lost) must read `sessionStorage` first and cleanly fall back to TMDB/OMDb hydration via URL query params without flashing wrong picks or losing `Recs`.
5. **Spoiler Guard Enforcement:** When `spoilerSafe: true` (default for unwatched/unrated focused films), system prompt must explicitly instruct Gemini NOT to reveal endings or late-act plot twists unless the user toggles "Allow Spoilers".

---

### Task 1: Pure `ratingStudioService.js` — Calibration, Anchors, Breakdown & Watch Log

**Files:**
- Create: `src/services/ratingStudioService.js`
- Test: `tests/ratingStudioService.test.js`

**Interfaces:**
```js
export const CRAFT_ASPECTS = [
  { id: "story", label: "Story & Script" },
  { id: "direction", label: "Direction" },
  { id: "acting", label: "Performances" },
  { id: "visuals", label: "Visuals & Score" }
];

export const WATCH_FORMATS = [
  { id: "streaming", label: "Streaming" },
  { id: "theater", label: "Theater" },
  { id: "imax", label: "IMAX / Dolby" },
  { id: "physical", label: "4K / Blu-ray" }
];

export function computeVaultCalibration(watched = [], targetRating = 0, excludeMovie = null)
// returns { ratedCount, sameScoreCount, topPercentile, anchorMovies: [{ imdbID, tmdbId, title, year, userRating }], summaryText }

export function normalizeRatingBreakdown(raw)
// returns null if empty/all zero; else object containing only integer keys in 1..5

export function computeCraftAverage(breakdown)
// returns null if empty; else number formatted to 1 decimal (e.g. 4.3)

export function normalizeWatchMeta(raw)
// returns null if empty default; else { format?, rewatchCount?, containsSpoilers? }

export function buildWatchedRatingPayload({ movie, baseWatchedItem, userRating, userNote, ratingBreakdown, watchMeta, nowIso })
// merges movie identity + tier/note/breakdown/watchMeta while cleaning cleared optional sub-objects
```

- [ ] **Step 1: Write the failing test**
  Create `tests/ratingStudioService.test.js`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import {
    computeVaultCalibration,
    normalizeRatingBreakdown,
    computeCraftAverage,
    normalizeWatchMeta,
    buildWatchedRatingPayload
  } from "../src/services/ratingStudioService.js";

  test("computeVaultCalibration handles empty or unrated vaults cleanly", () => {
    const res = computeVaultCalibration([], 8);
    assert.equal(res.ratedCount, 0);
    assert.deepEqual(res.anchorMovies, []);
    assert.equal(res.topPercentile, null);
    assert.match(res.summaryText, /first|rate/i);
  });

  test("computeVaultCalibration finds exact-score anchors, excludes self, and falls back to nearest score", () => {
    const watched = [
      { imdbID: "tt01", title: "Alpha", year: "2020", userRating: 9 },
      { imdbID: "tt02", title: "Beta", year: "2021", userRating: 9 },
      { imdbID: "tt03", title: "Self", year: "2022", userRating: 9 },
      { imdbID: "tt04", title: "Gamma", year: "2019", userRating: 7 },
      { imdbID: "tt05", title: "Delta", year: "2018", userRating: 6 }
    ];
    const exact = computeVaultCalibration(watched, 9, { imdbID: "tt03" });
    assert.equal(exact.ratedCount, 4); // excludes self cleanly if excluded before/during compare, wait: Vault percentile against OTHER rated films or total rated
    assert.equal(exact.anchorMovies.length, 2);
    assert.ok(exact.anchorMovies.every((m) => m.imdbID !== "tt03"));
    assert.ok(exact.topPercentile >= 1 && exact.topPercentile <= 100);

    const nearest = computeVaultCalibration(watched, 8, { imdbID: "tt03" });
    assert.ok(nearest.anchorMovies.length > 0);
    assert.ok(nearest.anchorMovies.some((m) => m.userRating === 9 || m.userRating === 7));
  });

  test("normalizeRatingBreakdown strips zeros/out-of-range and returns null when blank", () => {
    assert.equal(normalizeRatingBreakdown({ story: 0, direction: 0 }), null);
    assert.deepEqual(
      normalizeRatingBreakdown({ story: 5, direction: 4.4, acting: 99, visuals: 3, unknown: 5 }),
      { story: 5, direction: 4, acting: 5, visuals: 3 }
    );
    assert.equal(computeCraftAverage({ story: 5, direction: 4 }), 4.5);
    assert.equal(computeCraftAverage(null), null);
  });

  test("normalizeWatchMeta preserves legitimate values and omits default-empty state", () => {
    assert.equal(normalizeWatchMeta({ format: "", rewatchCount: 0, containsSpoilers: false }), null);
    assert.deepEqual(
      normalizeWatchMeta({ format: "theater", rewatchCount: 2, containsSpoilers: true }),
      { format: "theater", rewatchCount: 2, containsSpoilers: true }
    );
  });

  test("buildWatchedRatingPayload strips empty breakdown/watchMeta when cleared", () => {
    const saved = buildWatchedRatingPayload({
      movie: { imdbID: "tt0133093", tmdbId: 603, title: "The Matrix", year: "1999" },
      baseWatchedItem: { imdbID: "tt0133093", ratingBreakdown: { story: 5 }, watchMeta: { format: "theater" } },
      userRating: 9,
      userNote: "Rewatched!",
      ratingBreakdown: { story: 0 },
      watchMeta: { format: "", rewatchCount: 0, containsSpoilers: false },
      nowIso: "2026-11-15T12:00:00.000Z"
    });
    assert.equal(saved.userRating, 9);
    assert.equal("ratingBreakdown" in saved, false);
    assert.equal("watchMeta" in saved, false);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/ratingStudioService.test.js`
  Expected: FAIL (`Cannot find module '../src/services/ratingStudioService.js'`).

- [ ] **Step 3: Write `src/services/ratingStudioService.js`**
  Implement cleanly:
  - Use `isSameMovie()` from `./movieIdentity.js` to exclude the currently inspected film from calibration anchors/peer calculations.
  - Filter `watched` to valid rated entries (`Number(userRating) >= 1 && <= 10`).
  - Compute exact-score matches sorted most-recent-first (`dateWatched || updatedAt`); if zero exact matches, pick up to 2 nearest-score matches (`Math.abs(r - target)` tie-broken higher rating / more recent).
  - Compute percentile (`topPercentile` = percentage of peers strictly below OR top `%` bracket — clearly expose e.g. `topPercentile: Math.max(1, Math.round(((peersHigherOrEqual) / ratedPeers.length) * 100))` or `higherThanPct: Math.round((strictlyLower / ratedPeers.length) * 100)` so UI strings are crystal clear: e.g., `"Top 18% of your Vault · Matches Whiplash, Blade Runner 2049"`).
  - Clamp craft scores strictly integer `1..5` (ignoring `0`/non-finite); return `null` when no aspect has a score `>= 1`.
  - Validate `watchMeta.format` against `WATCH_FORMATS`, clamp `rewatchCount` integer `>= 1` (`0` omitted), boolean `containsSpoilers` (omitted when `false`); return `null` if all absent.
  - Ensure `buildWatchedRatingPayload()` spreads base fields cleanly, strips stale `ratingBreakdown` / `watchMeta` keys via `delete` when normalized to `null`, preserves existing `imdbID`/`tmdbId`/`dateWatched` (`baseWatchedItem?.dateWatched || nowIso`), and stamps `updatedAt: nowIso`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/ratingStudioService.test.js`
  Expected: PASS (all 5 tests green).

- [ ] **Step 5: Commit**
  `git add src/services/ratingStudioService.js tests/ratingStudioService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(rating): add ratingStudioService for Vault calibration, craft breakdown, and watch meta" }`

---

### Task 2: Pure `filmChatService.js` + `geminiChatService.js` Contextual Chat Support

**Files:**
- Create: `src/services/filmChatService.js`
- Modify: `src/services/geminiChatService.js`
- Test: `tests/filmChatService.test.js`

**Interfaces:**
```js
// src/services/filmChatService.js
export const FILM_CHAT_CACHE_PREFIX = "cinemavault_film_chat_focus_v1:";

export function buildFilmChatRoute(movieOrId)
// returns "/ai?tab=chat&movie=<canonicalId>&tmdbId=<id>&title=<encodedTitle>"

export function parseAiPageParams(searchString)
// returns { tab: "recs" | "chat", movieKey: string | null, tmdbId: number | null, imdbID: string | null, title: string }

export function serializeFilmDossierForPrompt(movie, vaultEntry = null, watchlistEntry = null, options = { spoilerSafe: true })
// returns sanitized concise text block for Gemini system prompt

export function buildMovieChatStarterPrompts(movie, { isWatched = false, spoilerSafe = true } = {})
// returns array of 4 tailored starter prompt strings referencing movie.title / director

export function saveFilmFocusCache(movie, storage = globalThis?.sessionStorage)
export function loadFilmFocusCache(movieKey, storage = globalThis?.sessionStorage)
```

```js
// src/services/geminiChatService.js (backward-compatible extension)
export function buildChatPromptPayload(
  userMessage,
  chatHistory = [],
  watchedMovies = [],
  tasteRules = [],
  activeMovieContext = null,
  chatOptions = {}
)
export const sendChatMessage = async (
  userMessage,
  chatHistory,
  watchedMovies,
  tasteRules = [],
  activeMovieContext = null,
  chatOptions = {}
)
```

- [ ] **Step 1: Write the failing test**
  Create `tests/filmChatService.test.js`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import {
    buildFilmChatRoute,
    parseAiPageParams,
    serializeFilmDossierForPrompt,
    buildMovieChatStarterPrompts,
    saveFilmFocusCache,
    loadFilmFocusCache
  } from "../src/services/filmChatService.js";
  import { buildChatPromptPayload } from "../src/services/geminiChatService.js";

  test("buildFilmChatRoute and parseAiPageParams round-trip imdb and tmdb identities cleanly", () => {
    const route = buildFilmChatRoute({ imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar", year: "2014" });
    assert.match(route, /^\/ai\?/);
    const parsed = parseAiPageParams(route.split("?")[1]);
    assert.equal(parsed.tab, "chat");
    assert.equal(parsed.imdbID, "tt0816692");
    assert.equal(parsed.tmdbId, 157336);
    assert.equal(parsed.title, "Interstellar");
  });

  test("serializeFilmDossierForPrompt injects user score and enforces spoiler guard when spoilerSafe is true", () => {
    const dossier = serializeFilmDossierForPrompt(
      {
        title: "Arrival",
        year: "2016",
        director: "Denis Villeneuve",
        cast: ["Amy Adams", "Jeremy Renner"],
        genre: "Sci-Fi, Drama",
        plot: "A linguist works with the military to communicate with alien lifeforms.",
        keywords: ["linguistics", "non-linear timeline"]
      },
      { userRating: 10, userNote: "Shattering ending." },
      null,
      { spoilerSafe: true }
    );
    assert.match(dossier, /Arrival \(2016\)/);
    assert.match(dossier, /Denis Villeneuve/);
    assert.match(dossier, /10\/10/);
    assert.match(dossier, /SPOILER-SAFE/i);
  });

  test("buildChatPromptPayload remains backward compatible without activeMovieContext and adds focus block when provided", () => {
    const plain = buildChatPromptPayload("Suggest a thriller", [], [{ title: "Se7en", userRating: 9 }], []);
    assert.match(plain, /Se7en \(9\/10\)/);
    assert.doesNotMatch(plain, /FOCUSED FILM DOSSIER/);

    const focused = buildChatPromptPayload(
      "Analyze the cinematography",
      [],
      [{ title: "Se7en", userRating: 9 }],
      [],
      { title: "Blade Runner 2049", year: "2017", director: "Denis Villeneuve", isWatched: false },
      { spoilerSafe: true }
    );
    assert.match(focused, /FOCUSED FILM DOSSIER/);
    assert.match(focused, /Blade Runner 2049/);
    assert.match(focused, /do not reveal major endings or twists/i);
  });

  test("buildMovieChatStarterPrompts tailors prompts for watched vs unwatched films", () => {
    const unwatched = buildMovieChatStarterPrompts({ title: "Sicario", director: "Denis Villeneuve" }, { isWatched: false, spoilerSafe: true });
    const watched = buildMovieChatStarterPrompts({ title: "Sicario", director: "Denis Villeneuve" }, { isWatched: true, spoilerSafe: false });
    assert.equal(unwatched.length, 4);
    assert.equal(watched.length, 4);
    assert.ok(unwatched.some((p) => /should i watch|my vault/i.test(p)));
    assert.ok(watched.some((p) => /ending|symbolism|trivia/i.test(p)));
  });

  test("saveFilmFocusCache and loadFilmFocusCache gracefully survive missing or corrupt storage", () => {
    const mem = new Map();
    const mockStorage = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => mem.set(k, v)
    };
    saveFilmFocusCache({ imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar" }, mockStorage);
    const loaded = loadFilmFocusCache("tt0816692", mockStorage);
    assert.equal(loaded.title, "Interstellar");
    assert.equal(loadFilmFocusCache("missing", mockStorage), null);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/filmChatService.test.js`
  Expected: FAIL (`Cannot find module '../src/services/filmChatService.js'`).

- [ ] **Step 3: Implement `src/services/filmChatService.js` and extend `src/services/geminiChatService.js`**
  - In `filmChatService.js`:
    - Resolve canonical key using `getCanonicalMovieKey` / `extractTmdbNumericId` so both `tt...` and `tmdb_...` work identically.
    - Sanitize all string fields (`replace(/[\r\n\t]+/g, " ").trim()`), truncating `plot` (`<= 500` chars) and `userNote` (`<= 280` chars) to protect Gemini prompt budgets.
    - Store compact JSON snapshot in `sessionStorage` keyed by both canonical `movieKey` and `tmdb_<id>` if both exist so reload lookups never miss.
  - In `geminiChatService.js`:
    - Extract pure `buildChatPromptPayload(...)` helper exported cleanly alongside `sendChatMessage(...)`.
    - When `activeMovieContext` is present, insert the serialized `FOCUSED FILM DOSSIER` block after `tasteRules` and add explicit spoiler directive based on `chatOptions.spoilerSafe` (defaults to `!activeMovieContext.isWatched`).
    - Relax topic restriction slightly *around the focused movie* so questions about soundtracks, cinematography techniques, box office, or production trivia related to that film always answer richly while off-topic non-cinema queries still redirect politely.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/filmChatService.test.js`
  Expected: PASS (all 5 tests green).

- [ ] **Step 5: Commit**
  `git add src/services/filmChatService.js src/services/geminiChatService.js tests/filmChatService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(chat): add filmChatService and movie-aware prompt building in geminiChatService" }`

---

### Task 3: Rating Studio UI Upgrade (`MovieDetails.jsx` + CSS)

**Files:**
- Modify: `src/components/MovieDetails.jsx`
- Modify: `src/index.css`

**Design Details:**
- Replace the redundant `.glowing-stars-bar` + `.rating-numeric-dial` dual widget inside `.interactive-rating-module` (`MovieDetails.jsx`) with ONE unified **Segmented 1–10 Rating Rail** + live large tabular score readout (`8 / 10` in gold `--accent` when hovered/active) + crisp Obsidian editorial Tier Bar (title, 1-line descriptor, NO inline `boxShadow` glow).
- Add keyboard arrow support (`ArrowLeft`/`ArrowRight`/`1..9`/`0` for 10) on the segmented rail with clear `--focus-ring` focus indicator.
- Directly below the segmented rail, render **Vault Calibration Strip** (`computeVaultCalibration(watched, activeDisplayRating, movie)`):
  - Displays Vault percentile (e.g., `Top 15% in your Vault`) + clickable anchor links/chips for 1–2 films the user scored similarly (clicking opens `/movie/...`), or crisp guidance on empty vaults.
- Replace the 16-tag wall with progressive disclosure:
  - Always show 6 contextual quick tags via `getContextualQuickTags(activeDisplayRating)`.
  - Render subtle `"More tags (+10)"` / `"Hide extra tags"` toggle button inline next to the tags label to reveal the remaining `QUICK_REVIEW_TAGS`.
- Add 2 clean, collapsed-by-default studio accordion pills directly above Save:
  1. **"Craft Breakdown"** (`ratingBreakdown`): 4 compact rows (`Story`, `Direction`, `Performances`, `Visuals & Score`), each with 5 clickable pips + 1-click clear. Shows average pill when populated (e.g. `4.5 / 5 Craft`).
  2. **"Watch Log"** (`watchMeta` + `dateWatched`): Date watched input (`type="date"` defaulting cleanly), Format pills (`Streaming`, `Theater`, `IMAX`, `4K/Blu-ray`), Rewatch counter (`1st watch` / `+1 rewatch`), and `"Note contains spoilers"` checkbox toggle.
- When `isWatched && !isEditing` (Saved Vault Status View):
  - Display saved star score pill cleanly, any populated **Craft Breakdown** mini-bars + **Watch Log** badges (`IMAX · Rewatch #2`), and **"Update Rating & Notes"** / **"Discuss This Film"** action cluster!

- [ ] **Step 1: Verify Rating Studio integration points & add pure state round-trip test**
  Ensure existing `tests/ratingTiers.test.mjs` & `tests/quickReviewTags.test.mjs` still run cleanly:
  Run: `node --test tests/ratingTiers.test.js tests/quickReviewTags.test.js`

- [ ] **Step 2: Update `src/components/MovieDetails.jsx`**
  - Import `CRAFT_ASPECTS`, `WATCH_FORMATS`, `computeVaultCalibration`, `normalizeRatingBreakdown`, `computeCraftAverage`, `normalizeWatchMeta`, `buildWatchedRatingPayload` from `../services/ratingStudioService`.
  - Import `saveFilmFocusCache`, `buildFilmChatRoute` from `../services/filmChatService`.
  - Add component state: `ratingBreakdown`, `watchMeta`, `dateWatched`, `showAllTags`, `openDrawer` (`null | "craft" | "log"`), initialized in the `watchedItem` sync `useEffect`.
  - Update `handleSave()` to use `buildWatchedRatingPayload(...)` cleanly so `ratingBreakdown`, `watchMeta`, `dateWatched`, `tmdbKeywords`, `collectionId`, `collectionName` all persist consistently.
  - Also pass `collectionId: tmdbData?.collectionId ?? null`, `collectionName: tmdbData?.collectionName ?? null`, `keywordItems: tmdbData?.keywordItems || []` inside `combinedData` (preparing cleanly for Phase 2 too, optional null-safe).
  - Replace dual star/number widgets with the unified **Segmented 1–10 Rating Rail**, calibration strip, progressive tags, and optional collapsible Craft & Watch Log panels.
  - Add crisp `"Discuss This Film"` action button in both saved state and unrated Rating Studio footer (plus right below synopsis/header action bar) calling `saveFilmFocusCache(combinedContext)` then `navigate(buildFilmChatRoute(...))`.

- [ ] **Step 3: Style Rating Studio cleanly in `src/index.css`**
  - Override/replace legacy `.rating-tier-banner`, `.glowing-stars-bar`, `.rating-numeric-dial` styles cleanly with `.rating-studio-dial`, `.rating-studio-cell`, `.rating-calibration-bar`, `.studio-disclosure-toggle`, `.craft-breakdown-grid`, `.craft-pip-btn`, `.watch-log-grid`, `.btn-discuss-film`.
  - Enforce `tokens.css` variables (`--surface-1`, `--surface-2`, `--hairline`, `--hairline-strong`, `--accent`, `--text-1`, `--text-2`, `--r-sm`, `--r-lg`), zero neon glows, and tabular numbers.

- [ ] **Step 4: Run test suite + build check**
  Run: `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
  Expected: All existing tests pass and Vite builds cleanly.

- [ ] **Step 5: Commit**
  `git add src/components/MovieDetails.jsx src/index.css; if ($LASTEXITCODE -eq 0) { git commit -m "feat(ui): upgrade MovieDetails rating module into calibrated Rating Studio with Discuss button" }`

---

### Task 4: Movie-Aware AI Chat Wiring (`AIPage.jsx` + `AIChat.jsx` + Styling)

**Files:**
- Modify: `src/pages/AIPage.jsx`
- Modify: `src/components/AIChat.jsx`
- Modify: `src/styles/oracle.css`

- [ ] **Step 1: Wire URL search params & focus resolution in `src/pages/AIPage.jsx`**
  - Replace static `useState("recs")` with `useSearchParams()`:
    - Read `parseAiPageParams(searchParams)` on mount and whenever `searchParams` changes.
    - When `tab=chat`, activate `"chat"` tab cleanly; switching tabs updates URL params (`tab=recs` or `tab=chat` while preserving or clearing `movie` intentionally).
    - Resolve `focusedMovie`: first check `loadFilmFocusCache(parsed.imdbID || (parsed.tmdbId ? "tmdb_" + parsed.tmdbId : parsed.movieKey))`; if cache missed (e.g. shared URL / cold tab reload) AND `parsed.tmdbId || parsed.imdbID` exists, fetch asynchronously (`findTmdbByImdbId` + `fetchTmdbMovieDetails(tmdbId, userRegion)` + optional `fetchOmdbJson`) and merge Vault status (`findMatchingMovie(watched, ...)`, `findMatchingMovie(watchlist, ...)`), saving back to session cache once loaded.
  - Pass `focusedMovie`, `onClearFocusedMovie`, and `watchlist` cleanly to `<AIChat />`.

- [ ] **Step 2: Upgrade `src/components/AIChat.jsx` with Focus Header, Spoiler Guard & Dynamic Prompts**
  - When `focusedMovie` is set:
    - Render a crisp **Focused Film Context Bar** at top of chat panel (poster thumb via `PosterImage`, `title`, `year`, `director`, Vault score badge if rated or `In Watchlist`, **Spoiler-Safe Toggle** defaulting to `true` when unwatched and `false` when watched/rated, link back to `/movie/:id`, and `"Clear Focus"` button).
    - When `focusedMovie` switches to a new film ID, prepend/reset thread cleanly with a welcome message specific to that film (without wiping unrelated manual general chats if user merely clears focus unless confirmed or starts fresh per film ID).
    - Compute 4 starter prompt chips dynamically using `buildMovieChatStarterPrompts(focusedMovie, { isWatched, spoilerSafe })`.
    - Pass `activeMovieContext` (merged movie + `isWatched` + `userRating` + `userNote`) and `{ spoilerSafe }` into `sendChatMessage(...)`.
  - When `focusedMovie` is `null`: preserve exact existing `Film Companion` behavior, generic `SUGGESTED_PROMPTS`, and `<InlineMovieCard />`.

- [ ] **Step 3: Style Focus Header & Spoiler Switch in `src/styles/oracle.css`**
  - Add compact `.chat-focus-banner`, `.chat-focus-poster`, `.chat-spoiler-toggle`, `.chat-clear-focus` matching Oracle's Obsidian/hairline cards (`tokens.css`) cleanly across desktop and mobile (`<= 768px`).

- [ ] **Step 4: Run tests & production build**
  Run: `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
  Expected: All unit tests pass; production bundle compiles cleanly with zero unused imports or JSX errors.

- [ ] **Step 5: Commit**
  `git add src/pages/AIPage.jsx src/components/AIChat.jsx src/styles/oracle.css; if ($LASTEXITCODE -eq 0) { git commit -m "feat(chat): connect Discuss This Film deep-link, hydration, and spoiler-safe AIChat UI" }`

---

### Task 5: Phase 1 Verification & Live Smoke Test

- [ ] **Step 1: Run full unit test suite**
  Run: `npm test`
  Expected: Every suite passes (`0` failures).
- [ ] **Step 2: Run production Vite build**
  Run: `npm run build`
  Expected: Zero build warnings/errors.
- [ ] **Step 3: Manual or Browser Subagent Walkthrough Check**
  - Open `/movie/tt0816692` -> verify single 1–10 segmented rating rail (no duplicate star+number bar clutter), hover calibration preview + same-score anchors, expandable `"More tags"` & `"Craft Breakdown"` / `"Watch Log"`, save persistence across reload.
  - Click `"Discuss This Film"` -> verify route transitions to `/ai?tab=chat&...`, Focused Film Context Bar appears with poster/rating/spoiler toggle & 4 contextual prompts, reload page on `/ai?tab=chat&...` and confirm context survives reload cleanly.
