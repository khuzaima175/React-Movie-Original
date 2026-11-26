# CinemaVault Adoption, Retention & Growth Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove CinemaVault's top day-1 adoption walls (first-visit modal ambush, email-only signup, single-CSV import), unlock its viral social hooks (personalized Watch Together + dynamic OG link previews + Friends Feed/Community Directory), and add daily retention workflows (multi-entity `Cmd+K`, inline trailers, chronological Watch Diary, and shareable Taste Card PNGs).

**Architecture:** Four independent, shippable tracks (each testable via `node --test` and `npm run build`) adhering to CinemaVault's guest-first, zero-new-runtime-dependency discipline: native `DecompressionStream`/Node `zlib` for ZIP archives, existing `@supabase/supabase-js` for Google OAuth, pure Canvas 2D for Taste Cards, and crawler-only Vercel Serverless OG rewrites.

**Tech Stack:** React 18.3, Vite 5.4, Tailwind CSS v4, Framer Motion 12, Supabase Auth/Postgres RLS, Vercel Serverless Functions, Native Web APIs (`DecompressionStream`, Canvas 2D), `node --test`.

**Spec:** Derived from user-approved codebase audit (2026-11-26); no separate spec file yet (all interface contracts and constraints are locked below).

## Global Constraints

- Zero new npm runtime dependencies in `package.json` (use native browser APIs + existing packages).
- Guest Mode remains 100% unlocked and functional offline/without Supabase configured.
- Default movie ranking weights (`DEFAULT_RANKER_WEIGHTS`) and offline `NDCG@10/20` benchmarks must remain bit-identical.
- Every new Supabase table enables RLS, revokes `public`/`anon`/`authenticated` first, grants minimal privileges, uses `(select auth.uid())` caching in policies, and uses `security definer` with `set search_path = ''` for counter triggers.
- All `node --test` suites (`npm test`) and `npm run build` must pass after every track.

## Review Focus

- **ZIP bomb / malformed ZIP / path-traversal entries** (`../`, >200 entries, >25 MB uncompressed) in Letterboxd `.zip` uploads -> rejected safely with user-friendly error, never freezes tab (pinned in Task 1.3).
- **OAuth redirect losing guest vault or `returnTo` path** -> `returnTo` persisted in `sessionStorage` (`cv_auth_return_to`), local guest vault merges cleanly post-OAuth without overwriting or syncing `isSample` rows (pinned in Task 1.2).
- **Watch Together pair who have already watched the top 60 popular movies** -> neighbor-union candidate pool still yields >= 15 unseen, non-avoided films with streaming metadata hydrated via `getMovieDetailsBatch` (pinned in Task 2.1).
- **OG crawler HTML injection / XSS via malicious username, list title, or bio** -> all dynamic strings strictly XML/HTML-escaped in `api/_ogHelpers.js`, and non-public profiles/lists never leak metadata (pinned in Task 2.3).
- **Backward compatibility for legacy watched items without `watchHistory`** -> `normalizeWatchHistory` safely derives a single entry from `dateWatched` + `userRating` without duplicating entries or breaking existing `VaultPage` / `vaultSyncService` schemas (pinned in Task 4.3).

---

## File Structure Map

| Track | New Files | Modified Files | Tests |
| :--- | :--- | :--- | :--- |
| **Track 1: Onboarding, OAuth & Letterboxd `.zip`** | `src/components/FirstVisitOnboardingStrip.jsx`, `src/services/zipReader.js`, `src/services/letterboxdZipImport.js` | `src/services/tasteDeckService.js`, `src/App.jsx`, `src/pages/DashboardPage.jsx`, `src/services/authService.js`, `src/context/AppContext.jsx`, `src/pages/AuthPage.jsx`, `src/components/BackupManagerModal.jsx` | `tests/tasteDeckService.test.js`, `tests/authService.test.js`, `tests/zipReader.test.js`, `tests/letterboxdZipImport.test.js` |
| **Track 2: Watch Together + OG Previews** | `api/_ogHelpers.js`, `api/og-meta.js`, `api/og-image.js` | `src/services/watchTogetherService.js`, `src/pages/WatchTogetherPage.jsx`, `src/components/NavBar.jsx`, `src/styles/nav-discover.css`, `vercel.json` | `tests/watchTogetherService.test.js`, `tests/navHelpers.test.js`, `tests/ogMeta.test.js` |
| **Track 3: Social Loop & Community Hub** | `supabase/migrations/20261126000001_social_feed_and_review_likes.sql`, `src/pages/CommunityPage.jsx` | `src/services/communityService.js`, `src/services/publicListsService.js`, `src/components/MovieCommunitySection.jsx`, `src/App.jsx`, `src/components/NavBar.jsx`, `src/styles/community.css` | `tests/communityService.test.js`, `tests/publicListsService.test.js` |
| **Track 4: Search, Trailers, Diary & Taste Card** | `src/components/TrailerModal.jsx`, `src/services/diaryService.js`, `src/services/tasteCardCanvas.js`, `src/components/TasteCardModal.jsx` | `src/services/searchService.js`, `src/components/SearchModal.jsx`, `src/components/MovieDetails.jsx`, `src/services/ratingStudioService.js`, `src/pages/VaultPage.jsx`, `src/components/VaultBanner.jsx`, `src/pages/PublicProfilePage.jsx` | `tests/searchService.test.js`, `tests/trailerModal.test.js`, `tests/diaryService.test.js`, `tests/tasteCardCanvas.test.js` |

---

## Track 1: First-Visit Onboarding, 1-Tap Google OAuth & Letterboxd `.zip` Import

### Task 1.1: Non-Blocking Inline First-Visit Onboarding Strip

**Files:**
- Modify: `src/services/tasteDeckService.js:1-4,485-495`
- Create: `src/components/FirstVisitOnboardingStrip.jsx`
- Modify: `src/App.jsx:138-156`
- Modify: `src/pages/DashboardPage.jsx:1-35,140-155`
- Test: `tests/tasteDeckService.test.js`

**Interfaces:**
- Consumes: `CORE_TASTE_DECK`, `buildTasteDeck`, `prepareQuickRatePayload` (`src/services/ratingTiers.js`), `loadSampleVault` (`AppContext`).
- Produces:
  - `INLINE_ONBOARDING_DISMISSED_KEY = "cinemavault_inline_onboarding_dismissed_v1"`
  - `shouldShowInlineOnboardingBanner({ watchedCount = 0, dismissedFlag = null, isVaultHydrated = true } = {}) -> boolean`
  - `selectInlineStarterFilms({ watched = [], watchlist = [], limit = 8 } = {}) -> Array<StarterFilm>`

- [ ] **Step 1: Write the failing test in `tests/tasteDeckService.test.js`**

```js
import {
  INLINE_ONBOARDING_DISMISSED_KEY,
  shouldShowInlineOnboardingBanner,
  selectInlineStarterFilms
} from "../src/services/tasteDeckService.js";

test("shouldShowInlineOnboardingBanner shows only when hydrated, < 3 watched, and not dismissed", () => {
  assert.equal(INLINE_ONBOARDING_DISMISSED_KEY, "cinemavault_inline_onboarding_dismissed_v1");
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 0, dismissedFlag: null, isVaultHydrated: true }), true);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 2, dismissedFlag: "false", isVaultHydrated: true }), true);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 3, dismissedFlag: null, isVaultHydrated: true }), false);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 0, dismissedFlag: "true", isVaultHydrated: true }), false);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 0, dismissedFlag: null, isVaultHydrated: false }), false);
});

test("selectInlineStarterFilms returns up to 8 genre-diverse unseen films", () => {
  const watched = [CORE_TASTE_DECK[0]];
  const starters = selectInlineStarterFilms({ watched, watchlist: [], limit: 8 });
  assert.equal(starters.length, 8);
  assert.equal(starters.some((m) => m.imdbID === CORE_TASTE_DECK[0].imdbID), false);
  const genres = new Set(starters.map((m) => m.primaryGenre));
  assert.ok(genres.size >= 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tasteDeckService.test.js`
Expected: FAIL with `SyntaxError: The requested module '../src/services/tasteDeckService.js' does not provide an export named 'INLINE_ONBOARDING_DISMISSED_KEY'`.

- [ ] **Step 3: Implement helper exports in `src/services/tasteDeckService.js` and inline UI**
  - In `src/services/tasteDeckService.js`: export `INLINE_ONBOARDING_DISMISSED_KEY`, `shouldShowInlineOnboardingBanner(...)`, and `selectInlineStarterFilms({ watched, watchlist, limit = 8 })` delegating to `buildTasteDeck({ watched, watchlist, deckSize: limit })`. Keep `shouldAutoShowTasteOnboarding` exported so existing tests remain green.
  - In `src/App.jsx:138-156`: remove the auto-open `setIsTasteDeckOpen(true)` `useEffect` on first visit (keep `handleOpenTasteDeck` + `onOpenTasteDeck` props so users can still open the 30-film modal manually) and pass `onOpenImport={() => handleOpenBackup("import")}` to `DashboardPage`.
  - Create `src/components/FirstVisitOnboardingStrip.jsx`: editorial strip rendered directly below `HeroBillboard` on `DashboardPage.jsx` when `shouldShowInlineOnboardingBanner({ watchedCount: watched.length, dismissedFlag, isVaultHydrated })` is true. Displays progress (`ratedCount / 3 to unlock your Taste Profile`), 8 starter poster cards with 1-tap `Love (9)` / `Like (7)` / `Skip` actions, plus CTAs for `Import Letterboxd / CSV`, `Try Sample Vault`, `30-Film Calibration`, and a dismiss `×` button writing `INLINE_ONBOARDING_DISMISSED_KEY = "true"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tasteDeckService.test.js`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/services/tasteDeckService.js src/components/FirstVisitOnboardingStrip.jsx src/App.jsx src/pages/DashboardPage.jsx tests/tasteDeckService.test.js
git commit -m "feat: replace first-visit taste deck modal ambush with inline starter strip"
```

---

### Task 1.2: 1-Tap Google OAuth Sign-In

**Files:**
- Modify: `src/services/authService.js:1-15,205-242`
- Modify: `src/context/AppContext.jsx` (export `signInWithOAuth` in auth actions)
- Modify: `src/pages/AuthPage.jsx:42-130,490-530`
- Test: `tests/authService.test.js`

**Interfaces:**
- Consumes: `normalizeAuthError` (`src/services/authService.js`), `getSupabaseClientAsync` (`src/services/supabaseClient.js`).
- Produces:
  - `SUPPORTED_OAUTH_PROVIDERS = Object.freeze(["google"])`
  - `OAUTH_RETURN_TO_STORAGE_KEY = "cv_auth_return_to"`
  - `signInWithOAuthProvider(supabase, { provider = "google", redirectTo } = {}) -> Promise<{ ok: boolean, url: string | null, error: string | null }>`
  - `persistOAuthReturnPath(path, storage?) -> void`
  - `consumeOAuthReturnPath(storage?) -> string`

- [ ] **Step 1: Write the failing test in `tests/authService.test.js`**

```js
import {
  SUPPORTED_OAUTH_PROVIDERS,
  signInWithOAuthProvider,
  persistOAuthReturnPath,
  consumeOAuthReturnPath
} from "../src/services/authService.js";

test("signInWithOAuthProvider validates provider allowlist and forwards redirectTo", async () => {
  assert.deepEqual(SUPPORTED_OAUTH_PROVIDERS, ["google"]);
  const bad = await signInWithOAuthProvider({ auth: { signInWithOAuth: async () => ({}) } }, { provider: "github" });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unsupported/i);

  let captured = null;
  const mockSupabase = {
    auth: {
      signInWithOAuth: async (args) => {
        captured = args;
        return { data: { url: "https://accounts.google.com/o/oauth2/auth" }, error: null };
      }
    }
  };
  const ok = await signInWithOAuthProvider(mockSupabase, {
    provider: "google",
    redirectTo: "https://cinemavault.app/auth"
  });
  assert.equal(ok.ok, true);
  assert.equal(captured.provider, "google");
  assert.equal(captured.options.redirectTo, "https://cinemavault.app/auth");
});

test("persistOAuthReturnPath & consumeOAuthReturnPath only keep safe relative app paths and clear after read", () => {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  persistOAuthReturnPath("https://evil.example/phish", mockStorage);
  assert.equal(consumeOAuthReturnPath(mockStorage), "/account");

  persistOAuthReturnPath("/together/ABCD2345", mockStorage);
  assert.equal(consumeOAuthReturnPath(mockStorage), "/together/ABCD2345");
  assert.equal(consumeOAuthReturnPath(mockStorage), "/account");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/authService.test.js`
Expected: FAIL with missing export `signInWithOAuthProvider`.

- [ ] **Step 3: Implement OAuth helpers and AuthPage UI**
  - In `src/services/authService.js`: export `SUPPORTED_OAUTH_PROVIDERS`, `OAUTH_RETURN_TO_STORAGE_KEY`, `signInWithOAuthProvider`, `persistOAuthReturnPath` (rejecting non-`/` or `//` protocol-relative URLs to prevent open redirects), and `consumeOAuthReturnPath` (defaulting to `"/account"`).
  - In `src/context/AppContext.jsx`: expose `signInWithOAuth(provider = "google")` calling `signInWithOAuthProvider(client, { provider, redirectTo: `${window.location.origin}/auth` })` and ensuring existing `onAuthStateChange` vault merge runs cleanly (keeping `isSample` rows strictly local).
  - In `src/pages/AuthPage.jsx`: render a prominent `"Continue with Google"` button above the email/password tabs when `mode === "signin" || mode === "signup"`; call `persistOAuthReturnPath(returnTo)` before triggering `signInWithOAuth("google")` and use `consumeOAuthReturnPath()` in the post-login `cloudUser` redirect effect.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/authService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/authService.js src/context/AppContext.jsx src/pages/AuthPage.jsx tests/authService.test.js
git commit -m "feat: add 1-tap Google OAuth sign-in with safe return path preservation"
```

---

### Task 1.3: Zero-Dependency ZIP Reader (`zipReader.js`)

**Files:**
- Create: `src/services/zipReader.js`
- Test: `tests/zipReader.test.js`

**Interfaces:**
- Consumes: Browser `DecompressionStream("deflate-raw")` or Node `node:zlib` `inflateRawSync` fallback (no npm packages).
- Produces:
  - `ZIP_LIMITS = Object.freeze({ maxEntries: 200, maxUncompressedBytes: 25 * 1024 * 1024 })`
  - `extractZipTextFiles(arrayBuffer, options = {}) -> Promise<Map<string, string>>`

- [ ] **Step 1: Write the failing test in `tests/zipReader.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { ZIP_LIMITS, extractZipTextFiles } from "../src/services/zipReader.js";

// Build minimal valid ZIP in test helper supporting method 0 (store) and 8 (deflate)
function buildTestZip(entries) { /* EOCD + Central Dir + Local Headers */ }

test("extractZipTextFiles extracts stored (method 0) and deflated (method 8) UTF-8 text files", async () => {
  const raw = Buffer.from("Name,Year,Rating\nArrival,2016,4.5\n", "utf8");
  const buf = buildTestZip([
    { name: "ratings.csv", data: raw, method: 0 },
    { name: "lists/sci-fi.csv", data: deflateRawSync(raw), method: 8, uncompressedSize: raw.length }
  ]);
  const files = await extractZipTextFiles(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(files.size, 2);
  assert.match(files.get("ratings.csv"), /Arrival,2016,4\.5/);
  assert.match(files.get("lists/sci-fi.csv"), /Arrival,2016,4\.5/);
});

test("extractZipTextFiles rejects path traversal, excessive entries, and ZIP bombs exceeding maxUncompressedBytes", async () => {
  const traversal = buildTestZip([{ name: "../etc/passwd", data: Buffer.from("x"), method: 0 }]);
  await assert.rejects(() => extractZipTextFiles(traversal), /unsafe path/i);

  const oversized = buildTestZip([{ name: "bomb.csv", data: Buffer.from("a"), method: 0, declaredSize: ZIP_LIMITS.maxUncompressedBytes + 1 }]);
  await assert.rejects(() => extractZipTextFiles(oversized), /size limit/i);

  const manyEntries = buildTestZip(
    Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}.csv`, data: Buffer.from("a"), method: 0 }))
  );
  await assert.rejects(() => extractZipTextFiles(manyEntries), /entry limit/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/zipReader.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/services/zipReader.js`.

- [ ] **Step 3: Implement `src/services/zipReader.js`**
  - Locate End of Central Directory (`0x06054b50`) scanning backwards from buffer end (max 65 KB comment).
  - Enforce `entryCount <= maxEntries` and reject invalid signatures.
  - Walk Central Directory (`0x02014b50`) headers, normalize entry paths (`\` -> `/`), reject paths containing `..`, starting with `/`, or containing null bytes.
  - Accumulate `totalUncompressed` from both declared size and actual inflated byte length (aborting immediately if either exceeds `maxUncompressedBytes`).
  - Read Local File Header (`0x04034b50`) payload; support compression method `0` (stored) and `8` (deflate-raw via `DecompressionStream("deflate-raw")` if defined, else dynamic `import("node:zlib")` `inflateRawSync`), decoding UTF-8 via `TextDecoder` (skipping directory entries ending in `/`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/zipReader.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/zipReader.js tests/zipReader.test.js
git commit -m "feat: add zero-dependency ZIP archive reader with size and path-traversal guards"
```

---

### Task 1.4: Letterboxd `.zip` All-in-One Importer & `BackupManagerModal` Integration

**Files:**
- Create: `src/services/letterboxdZipImport.js`
- Modify: `src/components/BackupManagerModal.jsx:265-360,415-520`
- Test: `tests/letterboxdZipImport.test.js`

**Interfaces:**
- Consumes: `extractZipTextFiles` (`zipReader.js`), `parseCSVImport`, `parseCSVLine` (`csvImport.js`), `resolveCsvRowFallbackRecord` (`vaultPortability.js`), `createCustomList` (`listsService.js`).
- Produces:
  - `parseLetterboxdListCsv(csvText, fallbackName) -> { name: string, description: string, items: Array }`
  - `parseLetterboxdZipArchive(arrayBuffer, options = {}) -> Promise<{ incomingWatched: Array, incomingWatchlist: Array, incomingLists: Array, stats: { watchedCount, ratedCount, reviewCount, watchlistCount, listCount } }>`

- [ ] **Step 1: Write the failing test in `tests/letterboxdZipImport.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseLetterboxdListCsv, parseLetterboxdZipArchive } from "../src/services/letterboxdZipImport.js";

test("parseLetterboxdListCsv parses Letterboxd 3-line metadata header + blank line + list rows", () => {
  const csv = [
    "Letterboxd list export v7",
    "Date,Name,Tags,URL,Description",
    "2026-01-10,Late Night Neo-Noir,noir,https://boxd.it/123,Rainy detective cinema",
    "",
    "Position,Name,Year,URL,Description",
    "1,Blade Runner,1982,https://boxd.it/a,",
    "2,Chinatown,1974,https://boxd.it/b,"
  ].join("\n");
  const list = parseLetterboxdListCsv(csv, "fallback");
  assert.equal(list.name, "Late Night Neo-Noir");
  assert.equal(list.description, "Rainy detective cinema");
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].title, "Blade Runner");
});

test("parseLetterboxdZipArchive merges watched, ratings, reviews, diary, watchlist, and lists while ignoring deleted/", async () => {
  // Build ZIP with watched.csv, ratings.csv, reviews.csv, diary.csv, watchlist.csv, lists/top.csv, deleted/old.csv
  const result = await parseLetterboxdZipArchive(mockZipBuffer);
  assert.equal(result.stats.listCount, 1);
  assert.equal(result.incomingWatchlist.length, 1);
  const arrival = result.incomingWatched.find((m) => m.title === "Arrival");
  assert.equal(arrival.userRating, 9);
  assert.match(arrival.userNote, /masterpiece/i);
  assert.ok(arrival.dateWatched);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/letterboxdZipImport.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `src/services/letterboxdZipImport.js` & wire `BackupManagerModal.jsx`**
  - In `src/services/letterboxdZipImport.js`:
    - Ignore entries under `deleted/` or `orphaned/`.
    - Parse `watched.csv`, `ratings.csv`, `reviews.csv`, `diary.csv` via `parseCSVImport`; merge records by normalized `title::year` key (preferring rated score from `ratings.csv`/`diary.csv`, longest/non-empty review note from `reviews.csv`, newest `dateWatched` + bulk-import guard from `diary.csv`/`watched.csv`, preserving rewatch count when diary has multiple viewings of the same film).
    - Parse `watchlist.csv` into `incomingWatchlist` (excluding anything already in `incomingWatched`).
    - Parse `lists/*.csv` via `parseLetterboxdListCsv` into `incomingLists` via `createCustomList`.
  - In `src/components/BackupManagerModal.jsx`: accept `.zip` alongside `.json` and `.csv` in `<input accept=".json,.csv,.zip">` and `processSelectedFile`, calling `parseLetterboxdZipArchive(await file.arrayBuffer())` and feeding `setPendingImport` so the existing diff preview modal shows exact counts before applying (including `incomingLists`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/letterboxdZipImport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/letterboxdZipImport.js src/components/BackupManagerModal.jsx tests/letterboxdZipImport.test.js
git commit -m "feat: support drag-and-drop Letterboxd .zip archive imports with lists and reviews"
```

---

## Track 2: Watch Together Engine Upgrade, Nav Promotion & Dynamic OG Previews

### Task 2.1: Neighbor-Union Candidate Pool + Streaming Hydration for Watch Together

**Files:**
- Modify: `src/services/watchTogetherService.js:145-230`
- Modify: `src/pages/WatchTogetherPage.jsx:47-96,185-225,258-345`
- Test: `tests/watchTogetherService.test.js`

**Interfaces:**
- Consumes: `getMovieDetailsBatch` (`src/services/apiTransport.js`), `toDashboardCardItem` (`src/services/dashboardService.js`), `matchesWatchProviders` (`src/services/tmdbService.js`).
- Produces:
  - `buildJointCandidateIdPool({ scoresA = new Map(), scoresB = new Map(), fallbackIds = [], watchedA = [], watchedB = [], limit = 90 } = {}) -> number[]`
  - `rankWatchTogetherCandidates(..., { requireSelectedProviders = false })` (extends existing options object without breaking defaults).

- [ ] **Step 1: Write the failing test in `tests/watchTogetherService.test.js`**

```js
import { buildJointCandidateIdPool } from "../src/services/watchTogetherService.js";

test("buildJointCandidateIdPool interleaves top unseen neighbors from both partners even when top 60 popular films are watched", () => {
  const watchedA = Array.from({ length: 60 }, (_, i) => ({ tmdbId: i + 1 }));
  const watchedB = Array.from({ length: 30 }, (_, i) => ({ tmdbId: i + 40 }));
  const scoresA = new Map([[10, 0.99], [501, 0.92], [502, 0.88]]);
  const scoresB = new Map([[50, 0.99], [601, 0.94], [502, 0.85]]);

  const ids = buildJointCandidateIdPool({
    scoresA,
    scoresB,
    fallbackIds: [1, 2, 701, 702],
    watchedA,
    watchedB,
    limit: 5
  });

  assert.equal(ids.includes(10), false);
  assert.equal(ids.includes(50), false);
  assert.deepEqual(ids, [501, 601, 502, 701, 702]);
});

test("rankWatchTogetherCandidates filters to userProviders when requireSelectedProviders is true", () => {
  const candidates = [
    { tmdbId: 1, title: "On Netflix", streamProviders: [{ id: 8, name: "Netflix" }] },
    { tmdbId: 2, title: "Not Streaming", streamProviders: [{ id: 350, name: "Apple TV+" }] }
  ];
  const ranked = rankWatchTogetherCandidates({
    candidates,
    scoresA: new Map([[1, 0.8], [2, 0.9]]),
    scoresB: new Map([[1, 0.8], [2, 0.9]]),
    userProviders: [8],
    requireSelectedProviders: true
  });
  assert.deepEqual(ranked.map((c) => c.tmdbId), [1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/watchTogetherService.test.js`
Expected: FAIL with missing export `buildJointCandidateIdPool`.

- [ ] **Step 3: Implement neighbor-union pool & streaming hydration**
  - In `src/services/watchTogetherService.js`: implement `buildJointCandidateIdPool` (take top-ranked unseen entries from `scoresA` and `scoresB`, interleave `A[0], B[0], A[1], B[1]...`, deduplicate, exclude `watchedA ∪ watchedB`, top up from `fallbackIds` if under `limit`), and support `requireSelectedProviders` flag inside `rankWatchTogetherCandidates`.
  - In `src/pages/WatchTogetherPage.jsx`: keep `loadSharedCandidatePool` for fallback IDs, compute `buildJointCandidateIdPool({ scoresA, scoresB, fallbackIds, watchedA, watchedB, limit: 80 })`, hydrate up to 80 IDs in 2 parallel `getMovieDetailsBatch` batches (since `TMDB_BATCH_LIMIT` is 40) with `region` so every item gets `streamProviders` and `watchProviderLink`, and add a `"Only on my services"` toggle in the Watch Together UI.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/watchTogetherService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/watchTogetherService.js src/pages/WatchTogetherPage.jsx tests/watchTogetherService.test.js
git commit -m "feat: upgrade Watch Together candidate pool with EASE+SVD neighbor union and streaming hydration"
```

---

### Task 2.2: Promote Watch Together to Primary Navigation

**Files:**
- Modify: `src/components/NavBar.jsx:129-175`
- Modify: `src/styles/nav-discover.css`
- Test: `tests/navHelpers.test.js` (verify no regressions; add route label helper check if added to `navHelpers.js`)

**Interfaces:**
- Consumes: `NavTab` (`NavBar.jsx`), `/together` route (`App.jsx`).
- Produces: Visible top-level `Together` link in desktop nav + mobile top header shortcut button.

- [ ] **Step 1: Write the failing test in `tests/navHelpers.test.js`**

```js
import { getPrimaryNavDestinations } from "../src/services/navHelpers.js";

test("getPrimaryNavDestinations includes Watch Together at top level alongside Discover, Explore, Vault, and Oracle", () => {
  const links = getPrimaryNavDestinations();
  assert.deepEqual(links.map((l) => l.to), ["/", "/explore", "/vault", "/ai", "/together"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/navHelpers.test.js`
Expected: FAIL with missing export `getPrimaryNavDestinations`.

- [ ] **Step 3: Implement `getPrimaryNavDestinations` in `src/services/navHelpers.js` & wire `NavBar.jsx`**
  - Export `getPrimaryNavDestinations()` in `src/services/navHelpers.js`.
  - In `src/components/NavBar.jsx`: render `<NavTab to="/together" onPrefetch={() => onPrefetchRoute?.("/together")}>Together</NavTab>` in `.nav-links-desktop`, and add a compact `<NavLink to="/together" className="stream-together-mobile-btn">` in `.nav-actions-group` visible on mobile (`<= 900px`) via `src/styles/nav-discover.css`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/navHelpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/navHelpers.js src/components/NavBar.jsx src/styles/nav-discover.css tests/navHelpers.test.js
git commit -m "feat: promote Watch Together to primary desktop and mobile navigation"
```

---

### Task 2.3: Dynamic Open Graph Meta & SVG Social Cards for Shared Links

**Files:**
- Create: `api/_ogHelpers.js`
- Create: `api/og-meta.js`
- Create: `api/og-image.js`
- Modify: `vercel.json:17-22`
- Test: `tests/ogMeta.test.js`

**Interfaces:**
- Consumes: Public Supabase tables (`public_profiles`, `user_lists` with `is_public = true`, `watch_sessions` `room_code`/`host_name`), TMDB `/3/movie/{id}` summary, `VERCEL_PROJECT_PRODUCTION_URL` / request host.
- Produces:
  - `CRAWLER_UA_PATTERN`
  - `escapeHtmlAttr(value = "") -> string`
  - `buildOgDescriptor({ routeType, param, record = null, siteUrl = "" } = {}) -> { title, description, imageUrl, canonicalUrl, type }`
  - `renderOgHtml(descriptor) -> string`
  - `renderOgSvgCard({ title, subtitle, kicker, badges = [] }) -> string`

- [ ] **Step 1: Write the failing test in `tests/ogMeta.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  CRAWLER_UA_PATTERN,
  escapeHtmlAttr,
  buildOgDescriptor,
  renderOgHtml,
  renderOgSvgCard
} from "../api/_ogHelpers.js";

test("escapeHtmlAttr neutralizes quotes, angle brackets, and ampersands against XSS", () => {
  const dirty = `" onmouseover="alert(1)" <script>&`;
  const clean = escapeHtmlAttr(dirty);
  assert.equal(clean.includes("<"), false);
  assert.equal(clean.includes('"'), false);
  assert.match(clean, /&quot;.*&lt;script&gt;&amp;/);
});

test("buildOgDescriptor builds safe fallback when private/missing record and dynamic copy for public links", () => {
  const privateProfile = buildOgDescriptor({
    routeType: "profile",
    param: "secret_user",
    record: null,
    siteUrl: "https://cinemavault.app"
  });
  assert.match(privateProfile.title, /CinemaVault/);
  assert.equal(privateProfile.title.includes("secret_user"), false);

  const room = buildOgDescriptor({
    routeType: "together",
    param: "ABCD2345",
    record: { host_name: "Alex", region: "US" },
    siteUrl: "https://cinemavault.app"
  });
  assert.match(room.title, /Alex/);
  assert.match(room.imageUrl, /\/api\/og-image\?/);

  const html = renderOgHtml(room);
  assert.match(html, /property="og:title"/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
});

test("CRAWLER_UA_PATTERN matches major social bots and ignores normal browsers", () => {
  assert.equal(CRAWLER_UA_PATTERN.test("WhatsApp/2.23.20 A"), true);
  assert.equal(CRAWLER_UA_PATTERN.test("Discordbot/2.0"), true);
  assert.equal(CRAWLER_UA_PATTERN.test("Mozilla/5.0 Chrome/120.0.0.0"), false);
  const svg = renderOgSvgCard({ title: "Alex's Room", subtitle: "Swipe together", kicker: "Watch Together" });
  assert.match(svg, /^<svg /);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ogMeta.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `api/_ogHelpers.js`.

- [ ] **Step 3: Implement OG helpers, endpoints & `vercel.json` crawler rewrites**
  - Create `api/_ogHelpers.js` implementing strict XML/HTML escaping (`escapeHtmlAttr`), `CRAWLER_UA_PATTERN`, `buildOgDescriptor` (supporting `profile`, `list`, `together`, `movie`, with strict private-fallback when `record` is null), `renderOgHtml`, and `renderOgSvgCard` (1200×630 CinemaVault dark editorial SVG card).
  - Create `api/og-meta.js`: accepts `?type=profile|list|together|movie&id=...`, queries only public metadata (using `SUPABASE_URL` + anon/publishable key so Postgres RLS guarantees private lists/profiles are never read!), returns `200 text/html` from `renderOgHtml`.
  - Create `api/og-image.js`: accepts `?type=...&title=...&subtitle=...&kicker=...`, sets `Cache-Control: public, max-age=3600`, returns `200 image/svg+xml` from `renderOgSvgCard`.
  - Update `vercel.json` `rewrites` (before the catch-all `/index.html` rewrite) using `has: [{ type: "header", key: "user-agent", value: ".*(Twitterbot|facebookexternalhit|WhatsApp|Discordbot|Slackbot|LinkedInBot|TelegramBot|Applebot).*" }]` for `/u/:id`, `/list/:id`, `/together/:id`, and `/movie/:id`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ogMeta.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_ogHelpers.js api/og-meta.js api/og-image.js vercel.json tests/ogMeta.test.js
git commit -m "feat: add dynamic Open Graph meta tags and SVG cards for shared links"
```

---

## Track 3: Close the Social Loop (Friends Feed, Community Directory & Taste-Twin Reviews)

### Task 3.1: Supabase Migration for Review Likes & Feed Indexes

**Files:**
- Create: `supabase/migrations/20261126000001_social_feed_and_review_likes.sql`

**Interfaces:**
- Consumes: `public.community_ratings`, `public.public_profiles`, `public.user_lists` (`supabase/migrations/20261120140144_community_profiles_schema.sql`, `20261124000002_user_lists_and_public_sharing.sql`).
- Produces:
  - `public.community_ratings.like_count` (`integer not null default 0 check (like_count >= 0)`)
  - `public.community_review_likes` (`user_id`, `rating_id`, `created_at`, PK `(user_id, rating_id)`) + RLS + `sync_community_review_like_count()` trigger
  - Indexes `community_ratings_user_updated_idx`, `public_profiles_watched_count_idx`, `user_lists_public_popular_idx`

- [ ] **Step 1: Verify existing migration conventions**

Run: `node --test tests/docsHygiene.test.js` (and inspect `supabase/migrations/20261124000002_user_lists_and_public_sharing.sql` trigger pattern).
Expected: Existing migration naming and RLS structure confirmed.

- [ ] **Step 2: Author `supabase/migrations/20261126000001_social_feed_and_review_likes.sql`**
  - `alter table public.community_ratings add column if not exists like_count integer not null default 0 check (like_count >= 0);`
  - `create table if not exists public.community_review_likes (...)` with `rating_id bigint not null references public.community_ratings(id) on delete cascade`.
  - `alter table ... enable row level security; revoke all ... from public, anon, authenticated; grant select to anon, authenticated; grant insert, delete to authenticated;`
  - Policies using `(select auth.uid()) = user_id`.
  - Trigger `sync_community_review_like_count` (`security definer`, `set search_path = ''`) incrementing/decrementing `public.community_ratings.like_count` cleanly.
  - Create feed & directory indexes (`community_ratings_user_updated_idx`, `public_profiles_watched_count_idx`, `user_lists_public_popular_idx`).

- [ ] **Step 3: Verify migration syntax & check existing community tests**

Run: `node --test tests/communityService.test.js tests/publicListsService.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261126000001_social_feed_and_review_likes.sql
git commit -m "feat(db): add community review likes table, RLS policies, and social feed indexes"
```

---

### Task 3.2: Friends Feed, Community Directory & Taste-Twin Review Services

**Files:**
- Modify: `src/services/communityService.js:350-410`
- Modify: `src/services/publicListsService.js:90-121`
- Test: `tests/communityService.test.js`
- Test: `tests/publicListsService.test.js`

**Interfaces:**
- Consumes: `computeTasteTwinCompatibility`, `getSupabaseClientAsync` (`communityService.js`), `publicListsService.js`.
- Produces in `communityService.js`:
  - `sortCommunityReviews(reviews = [], { sortBy = "taste", viewerVector = null, profileVectorMap = new Map() } = {}) -> Array`
  - `fetchFriendsActivityFeed(viewerUserId, { limit = 30 } = {}, options = {}) -> Promise<{ status, items, error }>`
  - `fetchCommunityDirectory({ query = "", viewerVector = null, limit = 24 } = {}, options = {}) -> Promise<{ status, profiles, error }>`
  - `toggleReviewLike({ userId, ratingId, currentlyLiked = false } = {}, options = {}) -> Promise<{ ok, isLiked, error }>`
- Produces in `publicListsService.js`:
  - `fetchPublicListsDirectory({ query = "", sort = "popular", limit = 24 } = {}, options = {}) -> Promise<{ status, lists, error }>`

- [ ] **Step 1: Write the failing tests in `tests/communityService.test.js` & `tests/publicListsService.test.js`**

```js
// In tests/communityService.test.js:
import { sortCommunityReviews, fetchFriendsActivityFeed, fetchCommunityDirectory } from "../src/services/communityService.js";

test("sortCommunityReviews ranks higher Taste Match % first in 'taste' mode and highest likes first in 'likes' mode", () => {
  const viewerVec = [1, ...new Array(63).fill(0)];
  const profileVectorMap = new Map([
    ["u_twin", [0.95, ...new Array(63).fill(0)]],
    ["u_diff", [-0.8, ...new Array(63).fill(0)]]
  ]);
  const reviews = [
    { id: 1, user_id: "u_diff", user_note: "B", like_count: 10, updated_at: "2026-11-25T10:00:00Z" },
    { id: 2, user_id: "u_twin", user_note: "A", like_count: 1, updated_at: "2026-11-24T10:00:00Z" }
  ];
  const byTaste = sortCommunityReviews(reviews, { sortBy: "taste", viewerVector: viewerVec, profileVectorMap });
  assert.equal(byTaste[0].id, 2);
  assert.ok(byTaste[0].tasteMatchPct > byTaste[1].tasteMatchPct);

  const byLikes = sortCommunityReviews(reviews, { sortBy: "likes", viewerVector: viewerVec, profileVectorMap });
  assert.equal(byLikes[0].id, 1);
});

test("fetchFriendsActivityFeed returns followed users' recent ratings in descending order", async () => {
  // Mock supabaseClient returning user_follows -> ["u2"] and community_ratings rows
  const res = await fetchFriendsActivityFeed("u1", { limit: 10 }, { supabaseClient: mockSupabase });
  assert.equal(res.status, "ok");
  assert.equal(res.items.length, 1);
});
```

```js
// In tests/publicListsService.test.js:
import { fetchPublicListsDirectory } from "../src/services/publicListsService.js";

test("fetchPublicListsDirectory queries only public non-deleted lists and attaches curator handles", async () => {
  const res = await fetchPublicListsDirectory({ query: "noir", sort: "popular", limit: 12 }, { supabaseClient: mockSupabase });
  assert.equal(res.status, "ok");
  assert.equal(res.lists[0].curatorUsername, "alex");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/communityService.test.js tests/publicListsService.test.js`
Expected: FAIL with missing exports (`sortCommunityReviews`, `fetchFriendsActivityFeed`, `fetchPublicListsDirectory`).

- [ ] **Step 3: Implement service functions in `src/services/communityService.js` & `src/services/publicListsService.js`**
  - Add optional `options.supabaseClient` dependency injection (matching `publicListsService.js` pattern) to new functions so they are unit-testable offline.
  - `fetchMovieCommunityRatings` also queries `public_profiles` for `taste_vector` by reviewer `user_id`s (plus `like_count` and viewer's `community_review_likes` if signed in) so film pages can display & sort by Taste Match %.
  - `fetchCommunityDirectory` computes `tasteTwin` via `computeTasteTwinCompatibility(viewerVector, profile.taste_vector)` and sorts by compatibility descending when `viewerVector` is present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/communityService.test.js tests/publicListsService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/communityService.js src/services/publicListsService.js tests/communityService.test.js tests/publicListsService.test.js
git commit -m "feat: add friends feed, community directory, review likes, and taste-twin sorting services"
```

---

### Task 3.3: Community Hub Page (`/community`) & Taste-Twin Reviews on Film Pages

**Files:**
- Create: `src/pages/CommunityPage.jsx`
- Modify: `src/components/MovieCommunitySection.jsx:1-127`
- Modify: `src/App.jsx:21-45,320-342`
- Modify: `src/components/NavBar.jsx:129-145,202-239`
- Modify: `src/styles/community.css`

**Interfaces:**
- Consumes: `fetchFriendsActivityFeed`, `fetchCommunityDirectory`, `toggleFollowUser`, `toggleReviewLike`, `sortCommunityReviews` (`communityService.js`), `fetchPublicListsDirectory` (`publicListsService.js`), `loadDefaultEmbeddingIndex`, `computeProfileTasteVector`.
- Produces: Route `/community` (`CommunityPage`), updated `MovieCommunitySection` with sort tabs (`Taste Match % | Most Liked | Recent`), reviewer Taste Match % pills, and Like buttons.

- [ ] **Step 1: Verify `MovieCommunitySection` & `NavBar` integration points**

Run: `node --test tests/layoutRegression.test.js tests/navHelpers.test.js`
Expected: PASS (baseline clean).

- [ ] **Step 2: Build `src/pages/CommunityPage.jsx`, enhance `MovieCommunitySection.jsx` & wire `/community` route**
  - Create `src/pages/CommunityPage.jsx` with 3 tabs (`Following Feed`, `Public Lists`, `Taste Twins`):
    - **Following Feed:** shows recent ratings & spoiler-safe reviews from followed handles; if signed out or following nobody, renders a clean prompt linking to the `Taste Twins` tab.
    - **Public Lists:** searchable/sortable grid (`Most Bookmarked` / `Recently Updated`) of public lists with curator `@handle` links and `/list/:slug` navigation.
    - **Taste Twins:** searchable member cards showing 64-D `matchPct%` badge, `watched_count`, 1-click `Follow`/`Following`, and `Watch Together` shortcut (`/together?partner=...`).
  - Update `src/components/MovieCommunitySection.jsx`: load viewer's 64-D vector lazily (`watched.length >= 3`), add sort toggle (`Taste Match %`, `Most Liked`, `Recent`), render `tasteMatchPct%` pill on each review card, and add interactive Heart/Like button calling `toggleReviewLike`.
  - Wire lazy-loaded `/community` route in `src/App.jsx` and add `Community` link in `NavBar.jsx` (More Tools menu + Discover/Profile links).

- [ ] **Step 3: Build & run tests to verify**

Run: `npm run build && node --test tests/communityService.test.js tests/publicListsService.test.js`
Expected: Vite build succeeds with 0 errors and all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CommunityPage.jsx src/components/MovieCommunitySection.jsx src/App.jsx src/components/NavBar.jsx src/styles/community.css
git commit -m "feat: add /community hub page and Taste-Twin review sorting on movie pages"
```

---

## Track 4: Multi-Entity `Cmd+K` Search, Inline Trailer Player, Watch Diary & Shareable Taste Card

### Task 4.1: Multi-Entity Global Search (`Cmd+K`)

**Files:**
- Modify: `src/services/searchService.js:355-463`
- Modify: `src/components/SearchModal.jsx:25-185,200-450`
- Test: `tests/searchService.test.js`

**Interfaces:**
- Consumes: `searchCatalogMovies` (`searchService.js`), `fetchTmdbJson` (`/3/search/person`), `getSupabaseClientAsync` (`supabaseClient.js`).
- Produces:
  - `searchMultiEntity({ query = "", watched = [], watchlist = [], includeCommunity = true, signal = null } = {}, options = {}) -> Promise<{ movies: Array, people: Array, users: Array, lists: Array }>`

- [ ] **Step 1: Write the failing test in `tests/searchService.test.js`**

```js
import { searchMultiEntity } from "../src/services/searchService.js";

test("searchMultiEntity returns movies, people, public users, and public lists with graceful degradation", async () => {
  const res = await searchMultiEntity(
    { query: "villeneuve", watched: [], watchlist: [] },
    {
      searchMoviesFn: async () => [{ imdbID: "tt1856101", Title: "Blade Runner 2049", Year: "2017" }],
      fetchTmdbFn: async () => ({ results: [{ id: 137427, name: "Denis Villeneuve", known_for_department: "Directing" }] }),
      supabaseClient: mockSupabaseReturningUsersAndLists
    }
  );
  assert.equal(res.movies.length, 1);
  assert.equal(res.people[0].name, "Denis Villeneuve");
  assert.equal(res.users[0].username, "villeneuve_fan");
  assert.equal(res.lists[0].slug, "villeneuve-ranked-abc123");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/searchService.test.js`
Expected: FAIL with missing export `searchMultiEntity`.

- [ ] **Step 3: Implement `searchMultiEntity` and multi-entity tabs in `SearchModal.jsx`**
  - In `src/services/searchService.js`: run `searchCatalogMovies`, TMDB `/3/search/person` (slice top 4), and optional Supabase `public_profiles` + `user_lists` (`is_public = true`, `.ilike` sanitized `%` wildcards, top 3 each) via `Promise.allSettled`.
  - In `src/components/SearchModal.jsx`: add filter tabs (`All | Films | People | Community`), group People (`/person/:id`), `@users` (`/u/:username`), and Lists (`/list/:slug`) cleanly alongside film results with keyboard navigation support.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/searchService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/searchService.js src/components/SearchModal.jsx tests/searchService.test.js
git commit -m "feat: expand Cmd+K search to people, public profiles, and curated lists"
```

---

### Task 4.2: Inline Privacy-Enhanced YouTube Trailer Modal

**Files:**
- Create: `src/components/TrailerModal.jsx`
- Modify: `src/components/MovieDetails.jsx:761-780`
- Test: `tests/trailerModal.test.js`

**Interfaces:**
- Consumes: `Modal` (`src/components/ui/Modal.jsx`).
- Produces:
  - `buildTrailerEmbedUrl(trailerKey = "") -> string | null` (exported from `src/components/TrailerModal.jsx` or `src/services/tmdbService.js`; export pure helper from `src/services/navHelpers.js` or `src/services/trailerHelpers.js` so `node --test` runs without JSX transform!). Note: since `node --test` runs plain `.js` ESM without Vite JSX transform, place `buildTrailerEmbedUrl` in `src/services/tmdbService.js` (or `src/services/navHelpers.js`) and import it into `TrailerModal.jsx`!

- [ ] **Step 1: Write the failing test in `tests/trailerModal.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildTrailerEmbedUrl } from "../src/services/navHelpers.js";

test("buildTrailerEmbedUrl validates 11-char YouTube IDs and builds privacy-enhanced embed URL", () => {
  assert.equal(
    buildTrailerEmbedUrl("zSWdZVtXT7E"),
    "https://www.youtube-nocookie.com/embed/zSWdZVtXT7E?autoplay=1&rel=0"
  );
  assert.equal(buildTrailerEmbedUrl("https://evil.com/x"), null);
  assert.equal(buildTrailerEmbedUrl("short"), null);
  assert.equal(buildTrailerEmbedUrl(""), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/trailerModal.test.js`
Expected: FAIL with missing export `buildTrailerEmbedUrl`.

- [ ] **Step 3: Implement `buildTrailerEmbedUrl`, `TrailerModal.jsx`, and `MovieDetails.jsx` trigger**
  - Add `buildTrailerEmbedUrl(trailerKey)` in `src/services/navHelpers.js` validating `/^[A-Za-z0-9_-]{11}$/`.
  - Create `src/components/TrailerModal.jsx`: 16:9 responsive `<iframe>` using `buildTrailerEmbedUrl(trailerKey)`, Escape-to-close via `<Modal>`, plus secondary `"Open on YouTube"` external link.
  - In `src/components/MovieDetails.jsx:761-780`: when `buildTrailerEmbedUrl(movie.trailerKey)` is non-null, render a `<button>` opening `TrailerModal`; keep the YouTube search `<a>` fallback when `movie.trailerKey` is absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/trailerModal.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/navHelpers.js src/components/TrailerModal.jsx src/components/MovieDetails.jsx tests/trailerModal.test.js
git commit -m "feat: play official trailers inline via privacy-enhanced YouTube modal"
```

---

### Task 4.3: Chronological Watch Diary, Rewatch Entries & Yearly Goal

**Files:**
- Create: `src/services/diaryService.js`
- Modify: `src/services/ratingStudioService.js`
- Modify: `src/services/vaultSyncService.js`
- Modify: `src/components/MovieDetails.jsx:610-644`
- Modify: `src/pages/VaultPage.jsx:35-85,305-320`
- Modify: `src/components/VaultBanner.jsx:440-455`
- Test: `tests/diaryService.test.js`

**Interfaces:**
- Consumes: `buildWatchedRatingPayload` (`ratingStudioService.js`), `getCanonicalMovieKey` (`vaultSyncService.js`).
- Produces in `src/services/diaryService.js`:
  - `YEARLY_GOAL_STORAGE_KEY = "cinemavault_yearly_goal_v1"`
  - `normalizeWatchHistory(movie = {}) -> Array<{ id, watchedAt, format, rating, note, isRewatch }>`
  - `appendWatchHistoryEntry(movie, { date, format, rating, note, isRewatch } = {}) -> Object`
  - `buildMonthlyDiaryGroups(watched = [], { year = null } = {}) -> Array<{ monthKey, monthLabel, entries }>`
  - `computeYearlyDiaryStats(watched = [], year = new Date().getFullYear()) -> { year, count, rewatchCount, totalMinutes, avgRating, topGenre, monthlyCounts }`

- [ ] **Step 1: Write the failing test in `tests/diaryService.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWatchHistory,
  appendWatchHistoryEntry,
  buildMonthlyDiaryGroups,
  computeYearlyDiaryStats
} from "../src/services/diaryService.js";

test("normalizeWatchHistory derives backward-compatible entry from legacy dateWatched without duplicating", () => {
  const legacy = { title: "Heat", userRating: 9, dateWatched: "2026-03-14T12:00:00.000Z" };
  const entries = normalizeWatchHistory(legacy);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].watchedAt.slice(0, 10), "2026-03-14");
  assert.equal(entries[0].isRewatch, false);
});

test("appendWatchHistoryEntry logs rewatches, updates watchMeta.rewatchCount, and groups chronologically by month", () => {
  const base = { title: "Arrival", runtime: "116 min", genre: "Sci-Fi, Drama", userRating: 9, dateWatched: "2026-02-01T12:00:00.000Z" };
  const updated = appendWatchHistoryEntry(base, {
    date: "2026-11-10",
    format: "imax",
    rating: 10,
    note: "Even better on re-watch",
    isRewatch: true
  });
  assert.equal(updated.watchHistory.length, 2);
  assert.equal(updated.watchMeta.rewatchCount, 1);

  const groups = buildMonthlyDiaryGroups([updated], { year: 2026 });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].monthKey, "2026-11");

  const stats = computeYearlyDiaryStats([updated], 2026);
  assert.equal(stats.count, 2);
  assert.equal(stats.rewatchCount, 1);
  assert.equal(stats.totalMinutes, 232);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/diaryService.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `diaryService.js`, Rewatch logging, and Vault Diary Tab**
  - Implement `src/services/diaryService.js` preserving `watchHistory` inside existing `watched` items (so IndexedDB, Schema v3 JSON, and Supabase `user_vault_items` persist it without schema changes). Ensure `compactVaultMovieForStorage` in `vaultSyncService.js` does not strip `watchHistory`.
  - Add a `"Log Rewatch"` action in `MovieDetails.jsx` Rating Studio calling `appendWatchHistoryEntry` and saving via `onAddWatched`.
  - Add `"Diary"` tab (`id: "diary"`) in `VaultBanner.jsx` & `VaultPage.jsx` showing: editable Yearly Goal progress bar (`cinemavault_yearly_goal_v1`), year filter selector, and chronological month-by-month diary rows with format/rewatch badges.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/diaryService.test.js tests/vaultStorageService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/diaryService.js src/services/ratingStudioService.js src/services/vaultSyncService.js src/components/MovieDetails.jsx src/pages/VaultPage.jsx src/components/VaultBanner.jsx tests/diaryService.test.js
git commit -m "feat: add chronological Watch Diary, rewatch logging, and yearly film goal"
```

---

### Task 4.4: Shareable Taste Passport / Year-in-Review PNG Card

**Files:**
- Create: `src/services/tasteCardCanvas.js`
- Create: `src/components/TasteCardModal.jsx`
- Modify: `src/components/VaultBanner.jsx:260-315`
- Modify: `src/pages/PublicProfilePage.jsx:240-266`
- Test: `tests/tasteCardCanvas.test.js`

**Interfaces:**
- Consumes: `computeYearlyDiaryStats` (`diaryService.js`), `buildRatingHistogramBins` (`vaultStats.js`).
- Produces:
  - `TASTE_CARD_ASPECTS = Object.freeze({ story: { width: 1080, height: 1920 }, wide: { width: 1200, height: 630 } })`
  - `buildTasteCardData({ watched = [], profile = null, year = null } = {}) -> TasteCardModel`
  - `renderTasteCardToCanvas(canvas, model, { aspect = "story" } = {}) -> Promise<void>`

- [ ] **Step 1: Write the failing test in `tests/tasteCardCanvas.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { TASTE_CARD_ASPECTS, buildTasteCardData } from "../src/services/tasteCardCanvas.js";

test("buildTasteCardData computes Top 4 posters, screen time hours, avg rating, and handle", () => {
  const watched = [
    { title: "Arrival", year: "2016", genre: "Sci-Fi, Drama", runtime: "116 min", userRating: 10, poster: "https://x/1.jpg", dateWatched: "2026-05-01" },
    { title: "Heat", year: "1995", genre: "Crime, Drama", runtime: "170 min", userRating: 9, poster: "https://x/2.jpg", dateWatched: "2026-06-01" }
  ];
  const data = buildTasteCardData({ watched, profile: { username: "khuzaima" }, year: 2026 });
  assert.equal(TASTE_CARD_ASPECTS.story.width, 1080);
  assert.equal(data.handle, "@khuzaima");
  assert.equal(data.filmCount, 2);
  assert.equal(data.topFilms.length, 2);
  assert.equal(data.topGenre, "Drama");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tasteCardCanvas.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `tasteCardCanvas.js`, `TasteCardModal.jsx`, and share buttons**
  - In `src/services/tasteCardCanvas.js`: implement `buildTasteCardData` and `renderTasteCardToCanvas` using native HTML5 Canvas 2D (`#0d0e11` background, `#e2b13c` brass rating accents, Fraunces/Hanken Grotesk typography fallback, Top 4 posters loaded via `crossOrigin="anonymous"` with graceful monogram tile fallback if CORS fails, rating distribution sparkline, and `cinemavault` footer mark).
  - Create `src/components/TasteCardModal.jsx`: aspect toggle (`Story 9:16` / `Wide 16:9`), scope selector (`All Time` / current year), live `<canvas>` preview, `Download PNG`, and `Share` (`navigator.share` when supported).
  - Add `"Share Taste Card"` trigger in `VaultBanner.jsx` and `PublicProfilePage.jsx`.

- [ ] **Step 4: Run test & full verification suite**

Run: `node --test tests/tasteCardCanvas.test.js && npm test && npm run build`
Expected: All unit tests and production Vite build pass cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/services/tasteCardCanvas.js src/components/TasteCardModal.jsx src/components/VaultBanner.jsx src/pages/PublicProfilePage.jsx tests/tasteCardCanvas.test.js
git commit -m "feat: add shareable Canvas 2D Taste Passport and Year-in-Review PNG card"
```
