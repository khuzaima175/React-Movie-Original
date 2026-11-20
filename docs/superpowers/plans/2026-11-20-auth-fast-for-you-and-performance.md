# CinemaVault v5.4 — Full Email Auth, Instant Progressive "Movies You'll Like" & Production Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver full email-and-password + magic-link authentication with dedicated `/auth` and `/account` pages (preserving zero-friction guest mode), cut Explore `"Movies You'll Like"` cold first paint from ~45–60s to ~1–2s via multi-wave progressive streaming + stale-while-revalidate caching, upgrade live Supabase schema (`profiles.taste_rules` + 250-item `user_explore_picks` cap), and optimize initial bundle weight, CSS loading, ML worker execution, and HTTP security headers.

**Architecture:**
1. **Guest-First Auth + Full Cloud Profile Sync:** Guests continue using `localStorage` + IndexedDB with zero login wall. Signed-in users authenticate via Supabase Auth (Email+Password signup/login, Magic Link, or Password Reset on `/auth`, plus `/account` management) and sync watched films, watchlist, region, streaming providers, taste rules, and their full 250-film Explore For You pool via RLS-protected Postgres tables (`profiles`, `user_vault_items`, `user_explore_picks`). Sample vault items (`isSample`) never sync to cloud.
2. **Sub-2-Second Progressive Explore `"Movies You'll Like"`:** Eliminates the 300+ sequential TMDB-call wall by immediately showing any recent local pool (stale-while-revalidate) or streaming **Wave 1** (~60–110 ranked poster cards from fast TMDB Discover + top 40 `CVEM v1` neighbors in ~1–2s) before expanding to **Wave 2** (~250 films, capped deep metadata enrichment on top 120) and polishing **Wave 3** (single Flash-Lite pass over top 100) silently in the background.
3. **Performance & Platform Hardening:** Splits the 893 KB monolithic entry chunk via Vite `manualChunks` + dynamic Supabase loading, scopes heavy route CSS to lazy-loaded pages, adds `image.tmdb.org` preconnect + PWA manifest + `vercel.json` security headers, and offloads `CVEM v1` binary decoding/scoring to a Web Worker with transparent main-thread fallback.

**Tech Stack:** React 18.3, Vite 5.4, React Router 6, Framer Motion 12, Tailwind CSS v4, `@supabase/supabase-js` v2, Supabase Postgres 17 + RLS (live project `xdmhejwhalliljsksvum`), Vercel Functions + `vercel.json`, Web Workers, `node --test`.

**Spec:** User requirements from 2026-11-20 session + existing design system in [SPEC.md](../../../SPEC.md) and architecture in [ARCHITECTURE.md](../../../ARCHITECTURE.md).

## Global Constraints

- **Guest Mode Remains First-Class:** No route (`/`, `/explore`, `/vault`, `/ai`, `/movie/:id`, `/compare`, `/person/:id`) may require sign-in. Signing out must never silently destroy local guest data unless the user explicitly chooses "Sign Out & Clear This Browser".
- **Sample Vault Isolation:** Items with `isSample: true` must never be written to `public.user_vault_items`, and sessions with `hasSampleData === true` must never read/write `public.user_explore_picks`.
- **Supabase RLS & Security Hygiene:** Every table in `public` must have RLS enabled, `anon`/`public` revoked, explicit `TO authenticated` per-operation policies using `(select auth.uid()) = user_id` (or `id`), `WITH CHECK` on updates/inserts, and zero `user_metadata` authorization checks.
- **Zero Native `<select>` & Editorial Visual Restraint:** All auth/account/Explore UI must follow CinemaVault's neutral charcoal palette (`#0b0b0c` / `#141416` / `#1c1d20`), brass accent (`#e2b13c`) for ratings/focus rings only, zero emoji icons, and honor `prefers-reduced-motion`.
- **Offline Test & Doc Hygiene:** Every service change ships with `node --test` coverage passing `fail 0` / `skipped 0`. Never hard-code test counts in top-level `.md` docs (`tests/docsHygiene.test.js`). Never commit secrets or expose `VITE_*` server API keys.
- **Windows PowerShell Compatibility:** All shell verification commands use `;` / `$LASTEXITCODE` (never `&&`) when run in Windows PowerShell 5.1.

## Review Focus

1. **Email confirmation pending on Sign Up:** When Supabase has email confirmation enabled, `signUp` returns `user` with `session: null` (or empty `identities: []` for an already-registered email). `AuthPage` must show a clear "Check your inbox to confirm your email" state without claiming the user is logged in or throwing an unhandled error.
2. **Stale Explore Wave overwriting a newer refresh or mode switch:** If the user switches away from `"Movies You'll Like"` or clicks `Refresh` while Wave 1/Wave 2/Wave 3 is in flight, `AbortSignal` + sequence guards (`forYouSeqRef`) must discard stale callbacks and cancel pending fetches cleanly without overwriting newer state or causing React state-update warnings.
3. **Sign-in with existing Guest Vault + Sample Vault:** Signing in when local `watched` contains real guest ratings merges them losslessly with cloud rows; signing in when `watched` contains `isSample` demo rows must exclude sample rows from cloud upserts and offer clearing sample data cleanly.
4. **Password Recovery redirect (`PASSWORD_RECOVERY` event):** Clicking a Supabase password reset email redirects back to `/auth?mode=reset` with recovery tokens in the URL hash/query; `AppContext` must detect `PASSWORD_RECOVERY` and keep the user in the "Set New Password" flow instead of redirecting them immediately to `/` before they change their password.
5. **Web Worker unavailable or blocked (Node tests / strict CSP / legacy browser):** `embeddingWorkerClient.js` must fall back silently and identically to the main-thread `embeddingService.js` functions with zero console errors or broken recommendations.

---

## File Structure

### New Files
- `supabase/migrations/20261120120000_profile_prefs_and_for_you_cap.sql` — Adds `profiles.taste_rules` JSONB column (capped `<= 8`) and raises `user_explore_picks.items` length constraint from `120` to `260`.
- `src/services/authService.js` — Pure auth form validation, Supabase Auth error normalization, and email/password, magic link, password reset, and profile update wrappers.
- `src/pages/AuthPage.jsx` — Editorial Sign In / Create Account / Magic Link / Forgot & Reset Password page (`/auth`, `/login`, `/signup`) with explicit "Continue as Guest" exit.
- `src/pages/AccountPage.jsx` — Dedicated signed-in Account & Sync Dashboard (`/account`) for display name, email, sync status, Vault/Explore cache summary, password update, and safe Sign Out options.
- `src/styles/auth.css` — Route-scoped editorial styles for `/auth` and `/account`.
- `src/workers/embeddingWorker.js` — Module Web Worker running `CVEM v1` binary decode + `buildCollabSimMapFromIndex` + `buildRepulsionMapFromIndex` + `retrieveAlignedEmbeddingNeighbors` off the main thread.
- `src/services/embeddingWorkerClient.js` — Promise-based worker client with automatic main-thread fallback (`embeddingService.js`) when `Worker` is unavailable.
- `public/manifest.json` — Lightweight PWA web app manifest.
- `tests/authService.test.js` — Unit tests for validation, error normalization, sign-up confirmation states, sign-in/reset flows, and profile preference merges.
- `tests/exploreForYouStreaming.test.js` — Unit tests for stale-while-revalidate local fallback, Wave 1 → Wave 2 → Wave 3 progressive emission order, `AbortSignal` cancellation, and 250-item cloud sync cap.
- `tests/embeddingWorkerClient.test.js` — Unit tests verifying fallback parity when `Worker` is absent and worker error recovery.

### Modified Files
- `src/services/supabaseClient.js` — Support lazy async client loader (`getSupabaseClientAsync`) while keeping synchronous `getSupabaseClient()` backward-compatible when already loaded.
- `src/services/vaultSyncService.js` — Add `mergeProfilePreferences` and `pullAndSyncProfilePreferences` (`display_name`, `user_region`, `preferred_providers`, `taste_rules`).
- `src/services/exploreForYouCache.js` — Raise `MAX_CLOUD_CACHED_ITEMS` from `120` to `250`, add `loadLatestLocalExploreForYouFallback()` for instant stale-while-revalidate painting.
- `src/services/exploreForYouService.js` — Refactor `generateExploreForYouPool` into 3-wave progressive pipeline (`Wave 1` fast paint ~1–2s, `Wave 2` full ~250 math pool with top-120 deep metadata cap, `Wave 3` Flash-Lite top-100 polish), add `onStageUpdate` and `signal` (`AbortSignal`), and wire optional `embeddingWorkerClient`.
- `src/context/AppContext.jsx` — Wire email/password auth actions, `PASSWORD_RECOVERY` handling, `cloudProfile`, automatic profile/taste-rules cloud sync, and optional `"clearLocal"` sign-out mode.
- `src/pages/ExplorePage.jsx` — Render stale-while-revalidate instant fallback + Wave 1 → Wave 2 → Wave 3 progressive status bar, cancel in-flight waves via `AbortController`, and save Wave 2 math pool immediately to cache.
- `src/components/NavBar.jsx` & `src/components/CloudSyncModal.jsx` & `src/App.jsx` — Add compact Guest `"Sign In"` / Signed-In Account button in NavBar, register lazy `/auth`, `/login`, `/signup`, `/account` routes, and link `CloudSyncModal` to `/auth` and `/account`.
- `vite.config.js`, `index.html`, `vercel.json`, `src/index.jsx`, `src/pages/AIPage.jsx`, `src/pages/ComparePage.jsx`, `src/pages/PersonPage.jsx` — Manual chunk splitting, route-scoped CSS imports, `image.tmdb.org` preconnect + manifest link, and production HTTP security headers.
- `README.md`, `ARCHITECTURE.md`, `SPEC.md`, `LOCAL_MODEL_GUIDE.md` — Document v5.4 auth, progressive For You streaming, and performance architecture.

---

### Task 1: Supabase Live Schema Upgrade (`profiles.taste_rules` + `user_explore_picks` 250-Item Cap) & Profile Preference Sync

**Files:**
- Create: `supabase/migrations/20261120120000_profile_prefs_and_for_you_cap.sql`
- Modify: `src/services/vaultSyncService.js`
- Modify: `src/services/exploreForYouCache.js:1-15`
- Test: `tests/vaultSyncService.test.js`, `tests/exploreForYouCache.test.js`

**Interfaces:**
- Consumes: `normalizeTasteRules` from `src/services/tasteRulesService.js`; existing `public.profiles` and `public.user_explore_picks` tables in Supabase project `xdmhejwhalliljsksvum`.
- Produces:
  - `mergeProfilePreferences({ local, cloud, lastSyncedAt }) -> { displayName, userRegion, userWatchProviders, tasteRules, shouldUpsertCloud }` in `src/services/vaultSyncService.js`
  - `pullAndSyncProfilePreferences(supabase, { userId, localPrefs, lastSyncedAt }) -> Promise<{ displayName, userRegion, userWatchProviders, tasteRules }>` in `src/services/vaultSyncService.js`
  - `MAX_CLOUD_CACHED_ITEMS = 250` in `src/services/exploreForYouCache.js`

- [ ] **Step 1: Write failing unit tests for profile preference merge and 250-item cloud cache cap**

Add to `tests/vaultSyncService.test.js`:
```js
test("mergeProfilePreferences preserves local non-default region/providers/tasteRules on first sign-in and adopts cloud values when local is default", () => {
  const firstSignIn = mergeProfilePreferences({
    local: { displayName: "", userRegion: "US", userWatchProviders: [8], tasteRules: [{ id: "r1", text: "No horror", polarity: "avoid", active: true }] },
    cloud: { display_name: "Alex", user_region: "GLOBAL", preferred_providers: [], taste_rules: [], updated_at: "2026-11-19T00:00:00Z" },
    lastSyncedAt: null
  });
  assert.equal(firstSignIn.displayName, "Alex");
  assert.equal(firstSignIn.userRegion, "US");
  assert.deepEqual(firstSignIn.userWatchProviders, [8]);
  assert.equal(firstSignIn.tasteRules.length, 1);
  assert.equal(firstSignIn.shouldUpsertCloud, true);

  const freshDevice = mergeProfilePreferences({
    local: { displayName: "", userRegion: "GLOBAL", userWatchProviders: [], tasteRules: [] },
    cloud: { display_name: "Alex", user_region: "GB", preferred_providers: [8, 9], taste_rules: [{ id: "r2", text: "Prefer neo-noir", polarity: "prefer", active: true }], updated_at: "2026-11-20T00:00:00Z" },
    lastSyncedAt: null
  });
  assert.equal(freshDevice.userRegion, "GB");
  assert.deepEqual(freshDevice.userWatchProviders, [8, 9]);
  assert.equal(freshDevice.tasteRules.length, 1);
  assert.equal(freshDevice.shouldUpsertCloud, false);
});
```

Add to `tests/exploreForYouCache.test.js`:
```js
test("saveExploreForYouCache upserts up to 250 items to Supabase user_explore_picks", async () => {
  let capturedPayload = null;
  const fakeSupabase = {
    from: () => ({
      upsert: async (payload) => {
        capturedPayload = payload;
        return { error: null };
      }
    })
  };
  const items = Array.from({ length: 260 }, (_, i) => ({ tmdbId: i + 1, title: `Film ${i + 1}`, forYouScore: 85 }));
  await saveExploreForYouCache({
    profileHash: "explore_fy_v3_cap250",
    items,
    source: "local-ranker",
    userId: "user-123",
    hasSampleData: false,
    supabaseClient: fakeSupabase
  });
  assert.equal(capturedPayload.items.length, 250);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/vaultSyncService.test.js tests/exploreForYouCache.test.js`
Expected: FAIL (`mergeProfilePreferences is not defined` and `120 !== 250`).

- [ ] **Step 3: Create and apply the Supabase migration (`20261120120000_profile_prefs_and_for_you_cap.sql`)**

Create `supabase/migrations/20261120120000_profile_prefs_and_for_you_cap.sql` with:
1. `alter table public.profiles add column if not exists taste_rules jsonb not null default '[]'::jsonb;`
2. Named check constraint `profiles_taste_rules_array_check`: `check (jsonb_typeof(taste_rules) = 'array' and jsonb_array_length(taste_rules) <= 8)` (dropped if exists first for idempotency).
3. Drop old `user_explore_picks_items_check` (locate exact constraint name on live DB via `execute_sql` if auto-named) and add `user_explore_picks_items_check` enforcing `jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 260`.

Apply directly to live Supabase project `xdmhejwhalliljsksvum` using `supabase_mcp` `apply_migration`, then verify with `list_tables` and `get_advisors` (`security` + `performance`).

- [ ] **Step 4: Implement `mergeProfilePreferences` & `pullAndSyncProfilePreferences` in `src/services/vaultSyncService.js` and bump `MAX_CLOUD_CACHED_ITEMS = 250` in `src/services/exploreForYouCache.js`**

- `mergeProfilePreferences({ local, cloud, lastSyncedAt })` resolves `displayName`, `userRegion`, `userWatchProviders`, `tasteRules` (capped to 8 valid items via `normalizeTasteRules` or safe normalizer), preserving non-default guest preferences on first sign-in while adopting cloud settings on a fresh device, and prefers cloud when `cloud.updated_at > lastSyncedAt` on returning devices.
- `pullAndSyncProfilePreferences(supabase, { userId, localPrefs, lastSyncedAt })` queries `profiles` by `id = userId`, merges via `mergeProfilePreferences`, and upserts back only if missing or `shouldUpsertCloud === true`.
- Update `MAX_CLOUD_CACHED_ITEMS = 250` in `src/services/exploreForYouCache.js`.

- [ ] **Step 5: Run tests to verify pass and commit**

Run: `node --test tests/vaultSyncService.test.js tests/exploreForYouCache.test.js`
Expected: PASS (`fail 0`).

```bash
git add supabase/migrations/20261120120000_profile_prefs_and_for_you_cap.sql src/services/vaultSyncService.js src/services/exploreForYouCache.js tests/vaultSyncService.test.js tests/exploreForYouCache.test.js
git commit -m "feat(supabase): sync profile taste rules and raise user_explore_picks cap to 250"
```

---

### Task 2: Auth Service (`authService.js`), Lazy Supabase Client & `AppContext` Email/Password + Recovery Wiring

**Files:**
- Create: `src/services/authService.js`
- Modify: `src/services/supabaseClient.js`
- Modify: `src/context/AppContext.jsx`
- Test: `tests/authService.test.js`

**Interfaces:**
- Consumes: `getSupabaseClient`, `getSupabaseClientAsync`, `hasSupabaseConfig` from `src/services/supabaseClient.js`; `pullAndSyncProfilePreferences` from `src/services/vaultSyncService.js`.
- Produces (from `src/services/authService.js`):
  - `validateAuthForm({ mode, email, password, confirmPassword, displayName }) -> { ok: boolean, fieldErrors: Record<string, string>, message: string }` (`mode` in `"signin" | "signup" | "magic" | "forgot" | "reset"`)
  - `normalizeAuthError(error) -> string`
  - `signUpWithEmailPassword(supabase, { email, password, displayName, emailRedirectTo }) -> Promise<{ ok, needsEmailConfirmation, alreadyRegistered, user, error }>`
  - `signInWithEmailPassword(supabase, { email, password }) -> Promise<{ ok, user, error }>`
  - `signInWithMagicLink(supabase, { email, emailRedirectTo }) -> Promise<{ ok, error }>`
  - `sendPasswordResetEmail(supabase, { email, redirectTo }) -> Promise<{ ok, error }>`
  - `updateAccountPassword(supabase, { newPassword }) -> Promise<{ ok, error }>`
  - `updateAccountProfile(supabase, { userId, displayName }) -> Promise<{ ok, displayName, error }>`
- Produces (added to `AppContext` value):
  - `cloudProfile` (`{ displayName }`), `isAuthLoading`, `isPasswordRecovery`, `clearPasswordRecovery`
  - `signUpWithPassword`, `signInWithPassword`, `signInWithEmailOtp`, `sendPasswordReset`, `updatePassword`, `updateDisplayName`, `signOutCloud({ clearLocal = false })`

- [ ] **Step 1: Write failing unit tests in `tests/authService.test.js`**

Write tests pinning:
1. `validateAuthForm`: rejects malformed email, password `< 8` chars on `signup`/`reset`, mismatched `confirmPassword` on `signup`/`reset`, and accepts valid `signin`, `signup`, `magic`, `forgot`, `reset` payloads.
2. `normalizeAuthError`: maps `"Invalid login credentials"`, `"Email not confirmed"`, `"User already registered"`, and `"over_email_send_rate_limit"` to clean, jargon-free copy.
3. `signUpWithEmailPassword`: returns `{ ok: true, needsEmailConfirmation: true, alreadyRegistered: false }` when `data.user` exists and `data.session` is `null` with non-empty `identities`; returns `{ ok: false, alreadyRegistered: true }` when `data.user.identities` is `[]` (Supabase obfuscated duplicate-email response).
4. `signInWithEmailPassword`, `sendPasswordResetEmail`, `updateAccountPassword`, `updateAccountProfile`: verify exact Supabase SDK calls and error normalization.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/authService.test.js`
Expected: FAIL (`Cannot find module '../src/services/authService.js'`).

- [ ] **Step 3: Implement `src/services/authService.js` and lazy-load Supabase in `src/services/supabaseClient.js`**

- In `src/services/supabaseClient.js`:
  - Replace static top-level `import { createClient } from "@supabase/supabase-js"` with dynamic `await import("@supabase/supabase-js")` inside `getSupabaseClientAsync()`, caching the created client singleton so synchronous `getSupabaseClient()` returns it once initialized (and `hasStoredSupabaseSession()` checks `localStorage` for `sb-*-auth-token` or URL auth hash/code so guest sessions with zero Supabase session never download the ~110 KB Supabase SDK on initial page load!).
- In `src/services/authService.js`:
  - Implement all exported pure helpers and auth wrappers cleanly with defensive null checks and 8-character minimum password policy.

- [ ] **Step 4: Wire new auth actions, `PASSWORD_RECOVERY` state, profile sync, and safe sign-out into `src/context/AppContext.jsx`**

- Boot Supabase auth listener lazily via `getSupabaseClientAsync()` when `hasSupabaseConfig()` and (`hasStoredSupabaseSession()` OR user triggers any auth action OR mounts `/auth` / `/account`).
- On `SIGNED_IN` / `INITIAL_SESSION`: run `pullAndSyncProfilePreferences` alongside `pullAndSyncCloudVault`, hydrate `cloudProfile`, `userRegion`, `userWatchProviders`, and `tasteRules`, and persist changes to `profiles` on debounced preference edits.
- On `PASSWORD_RECOVERY` event: set `isPasswordRecovery = true` without stripping recovery session.
- In `signOutCloud({ clearLocal = false } = {})`: call `supabase.auth.signOut()`, clear pending cloud refs; only wipe local `watched`/`watchlist`/`tasteRules`/For You cache when `clearLocal === true` (preserving guest vault by default!).

- [ ] **Step 5: Run tests to verify pass and commit**

Run: `node --test tests/authService.test.js tests/vaultSyncService.test.js`
Expected: PASS (`fail 0`).

```bash
git add src/services/authService.js src/services/supabaseClient.js src/context/AppContext.jsx tests/authService.test.js
git commit -m "feat(auth): add email+password, magic link, recovery, and lazy Supabase auth service"
```

---

### Task 3: Editorial `/auth` & `/account` Pages + NavBar Account Trigger

**Files:**
- Create: `src/pages/AuthPage.jsx`
- Create: `src/pages/AccountPage.jsx`
- Create: `src/styles/auth.css`
- Modify: `src/components/NavBar.jsx`
- Modify: `src/components/CloudSyncModal.jsx`
- Modify: `src/App.jsx`
- Test: `tests/navHelpers.test.js`

**Interfaces:**
- Consumes: `useApp()` auth & sync actions from Task 2; `validateAuthForm` from `src/services/authService.js`; `Button`, `Tabs` from `src/components/ui`; `useDocumentTitle` from `src/hooks/useDocumentTitle.js`.
- Produces:
  - Routes `/auth`, `/login` (defaults to `signin` tab), `/signup` (defaults to `signup` tab), `/account` in `src/App.jsx`.
  - Pure NavBar label helper `getAccountNavState({ hasCloudConfig, cloudUser, cloudProfile, cloudSyncStatus })` in `src/services/navHelpers.js`.

- [ ] **Step 1: Write failing test for `getAccountNavState` in `tests/navHelpers.test.js`**

```js
test("getAccountNavState returns guest sign-in state when signed out and user initial + sync status when signed in", () => {
  const guest = getAccountNavState({ hasCloudConfig: true, cloudUser: null, cloudSyncStatus: "idle" });
  assert.equal(guest.isSignedIn, false);
  assert.equal(guest.label, "Sign In");
  assert.equal(guest.to, "/auth");

  const authed = getAccountNavState({
    hasCloudConfig: true,
    cloudUser: { email: "khuzaima@example.com" },
    cloudProfile: { displayName: "Khuzaima" },
    cloudSyncStatus: "synced"
  });
  assert.equal(authed.isSignedIn, true);
  assert.equal(authed.initial, "K");
  assert.equal(authed.to, "/account");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/navHelpers.test.js`
Expected: FAIL (`getAccountNavState is not defined`).

- [ ] **Step 3: Implement `AuthPage.jsx`, `AccountPage.jsx`, `src/styles/auth.css`, and wire `NavBar.jsx`, `CloudSyncModal.jsx`, & `App.jsx`**

- **`AuthPage.jsx`:**
  - Respects `?mode=signin|signup|magic|forgot|reset` and `isPasswordRecovery` (auto-opens `"Set New Password"` panel when recovery link is visited).
  - Supports **Sign In** (Email + Password, "Forgot password?" link, subtle "Or sign in with Magic Link" switch), **Create Account** (optional Display Name, Email, Password with visibility toggle, Confirm Password), and **Continue as Guest** button (`navigate(returnTo)`).
  - Displays a calm local-vault summary banner if the guest already has local ratings/watchlist ("Your X ratings and Y watchlist films will merge automatically — sample demo films stay local").
  - Handles `needsEmailConfirmation` with a clear inbox-check card and `Resend` / `Switch to Sign In` controls.
  - When already signed in (and not in password recovery), redirects cleanly to `/account` (or `state.from`).
- **`AccountPage.jsx`:**
  - If signed out, renders a concise prompt card linking directly to `/auth` + "Continue as Guest".
  - When signed in: displays editable **Display Name** (saves to `public.profiles`), email address, live **Cloud Sync** status + `"Sync Now"` trigger + Watched / Watchlist / Taste Rules counts, **Change Password** form, and two explicit sign-out actions: **"Sign Out (Keep Local Copy)"** (default) and **"Sign Out & Clear Browser Data"** (with inline confirmation).
- **`NavBar.jsx` & `App.jsx`:**
  - Add compact `"Sign In"` button (guest) or circular initial + emerald/amber sync indicator button (signed-in) in `nav-actions-group` when `hasCloudConfig` is true.
  - Register lazy-loaded `/auth`, `/login`, `/signup`, `/account` routes in `src/App.jsx`.
  - Update `CloudSyncModal.jsx` so guests get a clean link to `/auth` (full Email+Password or Magic Link) and signed-in users get a shortcut to `/account`.

- [ ] **Step 4: Run tests and production build to verify pass**

Run: `node --test tests/navHelpers.test.js; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: PASS (`fail 0`) and clean Vite build exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/navHelpers.js src/pages/AuthPage.jsx src/pages/AccountPage.jsx src/styles/auth.css src/components/NavBar.jsx src/components/CloudSyncModal.jsx src/App.jsx tests/navHelpers.test.js
git commit -m "feat(auth): add editorial /auth and /account pages with NavBar account entry"
```

---

### Task 4: Instant Progressive Streaming (< 2s First Paint) & Stale-While-Revalidate for Explore `"Movies You'll Like"`

**Files:**
- Modify: `src/services/exploreForYouCache.js`
- Modify: `src/services/exploreForYouService.js`
- Modify: `src/pages/ExplorePage.jsx`
- Test: `tests/exploreForYouStreaming.test.js`

**Interfaces:**
- Consumes: `fetchCandidatePool`, `fetchEmbeddingCandidates`, `enrichCandidatePoolMetadata` from `src/services/tmdbService.js`; `rankCandidatePool` from `src/services/rankerService.js`.
- Produces:
  - `loadLatestLocalExploreForYouFallback({ maxAgeMs = EXPLORE_FOR_YOU_TTL_MS, now = Date.now() }) -> Promise<{ items, profileHash, source, generatedAt, from: "indexeddb-stale" } | null>` in `src/services/exploreForYouCache.js`
  - `generateExploreForYouPool({ ..., onPreliminaryReady, onStageUpdate, signal, fetchFastPoolFn, fetchEmbeddingFn, enrichPoolFn })` in `src/services/exploreForYouService.js` emitting progressive waves:
    - `stage: "wave1"` (~60–110 films, fires immediately after fast pool + top 40 neighbors, BEFORE full 250 expansion or 300-item deep enrichment)
    - `stage: "wave2"` (~250 math-ranked films, deep enrichment capped at top 120)
    - `stage: "wave3"` (Flash-Lite refined top 100 merged into full ~250 pool)

- [ ] **Step 1: Write failing unit tests in `tests/exploreForYouStreaming.test.js`**

Write tests pinning:
1. `loadLatestLocalExploreForYouFallback` returns the newest non-expired local pool even when the current `profileHash` changed (e.g., user rated 1 new movie), and returns `null` when expired or empty.
2. `generateExploreForYouPool` fires `onPreliminaryReady` with `stage: "wave1"` BEFORE Wave 2 expansion resolves (verified with a deferred Promise gate on Wave 2!), then fires `stage: "wave2"` with the expanded pool BEFORE Flash-Lite resolves, then returns the final Wave 3 merged result.
3. Passing an `AbortController` (`signal`) and aborting after Wave 1 stops Wave 2 and skips the Flash-Lite API call cleanly without throwing unhandled rejections.
4. Deep metadata enrichment (`enrichCandidatePoolMetadata`) is capped at `<= 120` candidates (`EXPLORE_FOR_YOU_ENRICH_LIMIT = 120`) instead of `300`, eliminating the 40-second cold bottleneck.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/exploreForYouStreaming.test.js`
Expected: FAIL (`loadLatestLocalExploreForYouFallback is not defined`, Wave 1 does not emit before Wave 2).

- [ ] **Step 3: Implement `loadLatestLocalExploreForYouFallback` in `src/services/exploreForYouCache.js`**

Scan the small (`<= 5` entries) local IndexedDB store (or `memoryFallbackStore` fallback), pick the newest record with `items.length > 0` and `now - generatedAt < maxAgeMs`, and return `{ ...record, from: "indexeddb-stale" }`.

- [ ] **Step 4: Refactor `generateExploreForYouPool` in `src/services/exploreForYouService.js` into 3-Wave Progressive Streaming**

- Export `EXPLORE_FOR_YOU_WAVE1_POOL_SIZE = 80`, `EXPLORE_FOR_YOU_WAVE1_NEIGHBORS = 40`, `EXPLORE_FOR_YOU_ENRICH_LIMIT = 120`.
- Run `extractTasteProfile` and `loadDefaultEmbeddingIndex` + `loadDefaultContentIndex` + `loadDefaultDnaIndex` in parallel (`Promise.all`).
- **Wave 1 (Fast First Paint):**
  - Launch `fetchCandidatePool(profile, "any", watched, watchlist, { poolSize: EXPLORE_FOR_YOU_WAVE1_POOL_SIZE, ... })` AND `fetchEmbeddingCandidates(aligned.slice(0, 60), ..., { maxNeighbors: EXPLORE_FOR_YOU_WAVE1_NEIGHBORS, maxScan: 60 })` **in parallel** (`Promise.all`).
  - Rank immediately (no 300-item `enrichCandidatePoolMetadata` block!) and invoke `onPreliminaryReady({ items: wave1Items, profileHash, source: "local-ranker", stage: "wave1", generatedAt: now })` + `onStageUpdate({ stage: "wave1", count: wave1Items.length, target: targetCount })`.
- **Wave 2 (Background Expansion to ~250 films):**
  - Check `signal?.aborted`. Fetch remaining embedding neighbors (`aligned.slice(60, 240)`, `maxNeighbors: 120`) and a wider TMDB page-2 discover supplement (`poolSize: 140`, `pageOffset: 1`) in parallel.
  - Dedupe with Wave 1, rank preliminary scores, and run `enrichCandidatePoolMetadata` **only on the top `120` candidates** (`EXPLORE_FOR_YOU_ENRICH_LIMIT = 120`) — cutting TMDB detail requests by ~60% while keeping full metadata for top flagship picks & Flash-Lite!
  - Re-rank full ~250 pool and emit `onPreliminaryReady({ items: wave2Items, profileHash, source: "local-ranker", stage: "wave2", generatedAt: now })`.
- **Wave 3 (Background AI Polish):**
  - Check `signal?.aborted`. Run the single Flash-Lite batch call over the top 100 flagship picks; merge and return final result.

- [ ] **Step 5: Update `src/pages/ExplorePage.jsx` for Instant Stale-While-Revalidate + Live Progressive Status Pill**

- Before starting a fresh build (when `!forceRefresh`), check `loadLatestLocalExploreForYouFallback()` if exact `profileHash` misses: if found, render those films immediately (filtered against current `watched`/`watchlist` via `isSameMovie`) with a subtle status pill `"Updating matches for your latest ratings..."` while the fresh 3-wave build runs in background!
- Pass an `AbortController` `signal` tied to the `useEffect` cleanup so switching modes or clicking Refresh cancels stale waves immediately.
- When `stage === "wave2"` lands, save it to local IndexedDB immediately so navigating away before Flash-Lite finishes still gives instant loads on return.
- Update the subtle status bar (`isForYouEnhancing`) to reflect the active stage (`"Expanding to 250 matches..."` vs `"Polishing top picks with AI..."`) while keeping the interactive grid fully usable.

- [ ] **Step 6: Run tests to verify pass and commit**

Run: `node --test tests/exploreForYouStreaming.test.js tests/exploreForYouService.test.js tests/exploreForYouCache.test.js`
Expected: PASS (`fail 0`).

```bash
git add src/services/exploreForYouCache.js src/services/exploreForYouService.js src/pages/ExplorePage.jsx tests/exploreForYouStreaming.test.js
git commit -m "perf(explore): stream Movies You'll Like in 3 progressive waves with stale-while-revalidate"
```

---

### Task 5: Bundle Splitting (`vite.config.js`), Route-Scoped CSS, `image.tmdb.org` Preconnect, PWA Manifest & Security Headers (`vercel.json`)

**Files:**
- Modify: `vite.config.js`
- Modify: `index.html`
- Modify: `vercel.json`
- Create: `public/manifest.json`
- Modify: `src/index.jsx`, `src/pages/AIPage.jsx`, `src/pages/ComparePage.jsx`, `src/pages/PersonPage.jsx`, `src/components/PersonFilmographyModal.jsx`
- Test: `tests/layoutRegression.test.js` (or new build-config assertions)

**Interfaces:**
- Consumes: Existing Vite 5.4 build pipeline and Tailwind v4 setup.
- Produces: Vendor-split Rollup chunks (`vendor-react`, `vendor-motion`, `vendor-supabase`, `vendor-genai`, `vendor-icons`), route-scoped CSS chunks, `public/manifest.json`, and hardened `vercel.json` headers.

- [ ] **Step 1: Inspect all CSS imports in `src/index.jsx` and confirm safe route scoping**

Verify which stylesheets are globally required (`index.css`, `styles/primitives.css`, `styles/nav-discover.css`) vs route-only (`styles/oracle.css`, `styles/person.css`, `styles/compare.css`, `styles/auth.css`). Move `oracle.css` into `AIPage.jsx`, `compare.css` into `ComparePage.jsx` + `CompareModal.jsx`, and `person.css` into `PersonFilmographyExplorer.jsx` (shared by `PersonPage` and `PersonFilmographyModal`).

- [ ] **Step 2: Configure `manualChunks` in `vite.config.js`**

Add `build.rollupOptions.output.manualChunks(id)` splitting:
- `node_modules/react/`, `node_modules/react-dom/`, `node_modules/react-router` -> `"vendor-react"`
- `node_modules/framer-motion/` -> `"vendor-motion"`
- `node_modules/@supabase/` -> `"vendor-supabase"`
- `node_modules/@google/genai/` -> `"vendor-genai"`
- `node_modules/lucide-react/` -> `"vendor-icons"`

- [ ] **Step 3: Add `image.tmdb.org` preconnect + PWA manifest (`public/manifest.json` & `index.html`) and HTTP security headers (`vercel.json`)**

- In `index.html`: add `<link rel="preconnect" href="https://image.tmdb.org" crossorigin />`, `<link rel="dns-prefetch" href="https://image.tmdb.org" />`, and `<link rel="manifest" href="/manifest.json" />`.
- Create `public/manifest.json` with CinemaVault name, `display: "standalone"`, `theme_color: "#0b0b0c"`, `background_color: "#0b0b0c"`, and icon pointing to `/og-image.png` / inline SVG icon.
- In `vercel.json`: add a `"/(.*)"` headers rule setting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()`, plus an `"/assets/(.*)"` `Cache-Control: public, max-age=31536000, immutable` rule.

- [ ] **Step 4: Run `npm run build` and verify chunk reduction + `npm test`**

Run: `npm run build; if ($LASTEXITCODE -eq 0) { Get-ChildItem build/assets -File | Sort-Object Length -Descending | Select-Object -First 12 Name, @{Name='KB';Expression={[math]::Round($_.Length/1KB,1)}} }; if ($LASTEXITCODE -eq 0) { npm test }`
Expected:
- Main entry JS chunk drops well below `893 KB` (target `< 400 KB` uncompressed) with `vendor-supabase` and `vendor-genai` isolated in separate lazy chunks.
- `npm test` exits `0` (`fail 0`).

- [ ] **Step 5: Commit**

```bash
git add vite.config.js index.html vercel.json public/manifest.json src/index.jsx src/pages/AIPage.jsx src/pages/ComparePage.jsx src/components/CompareModal.jsx src/components/PersonFilmographyExplorer.jsx
git commit -m "perf(build,security): split vendor chunks, scope route CSS, preconnect TMDB, and add security headers"
```

---

### Task 6: Off-Main-Thread Local ML Web Worker (`embeddingWorker.js`) with Main-Thread Fallback

**Files:**
- Create: `src/workers/embeddingWorker.js`
- Create: `src/services/embeddingWorkerClient.js`
- Modify: `src/services/exploreForYouService.js`
- Test: `tests/embeddingWorkerClient.test.js`

**Interfaces:**
- Consumes: `loadDefaultEmbeddingIndex`, `buildCollabSimMapFromIndex`, `buildRepulsionMapFromIndex`, `getCollabCatalogMax`, `retrieveAlignedEmbeddingNeighbors` from `src/services/embeddingService.js`.
- Produces:
  - `computeExploreEmbeddingSignals({ weightedRatings, excludeNumericIds, topK, repulsionWeight }) -> Promise<{ collabSimMap, repulsionMap, collabCatalogMax, alignedNeighbors, usedWorker }>` in `src/services/embeddingWorkerClient.js`

- [ ] **Step 1: Write failing unit tests in `tests/embeddingWorkerClient.test.js`**

Write tests pinning:
1. When `typeof Worker === "undefined"` (Node test environment), `computeExploreEmbeddingSignals` transparently falls back to main-thread `embeddingService.js` (`usedWorker: false`) and returns identical `collabSimMap` (`Map`), `repulsionMap` (`Map`), `collabCatalogMax`, and `alignedNeighbors`.
2. When a mock `Worker` throws or emits an error event, `computeExploreEmbeddingSignals` catches it once, disables worker mode for the session, and transparently returns valid main-thread results without throwing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/embeddingWorkerClient.test.js`
Expected: FAIL (`Cannot find module '../src/services/embeddingWorkerClient.js'`).

- [ ] **Step 3: Implement `src/workers/embeddingWorker.js` and `src/services/embeddingWorkerClient.js`**

- `embeddingWorker.js`: handles `onmessage` requests `{ id, type: "computeExploreSignals", payload }`, caches the decoded `CVEM v1` index inside the worker, computes `collabSimMap` (serialized as `[tmdbId, score]` pairs or `Float32Array` transferables), `repulsionMap`, `collabCatalogMax`, and `alignedNeighbors`, and posts back `{ id, ok: true, result }`.
- `embeddingWorkerClient.js`: creates `new Worker(new URL("../workers/embeddingWorker.js", import.meta.url), { type: "module" })` lazily in browsers; reconstructs `Map`s cleanly; falls back cleanly to main-thread `embeddingService.js` on error or unsupported environment.
- Wire `computeExploreEmbeddingSignals` into `generateExploreForYouPool` in `src/services/exploreForYouService.js` when no custom `injectedEmbeddingIndex` is provided.

- [ ] **Step 4: Run tests and build to verify pass**

Run: `node --test tests/embeddingWorkerClient.test.js tests/exploreForYouService.test.js tests/exploreForYouStreaming.test.js; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: PASS (`fail 0`) and clean Vite worker bundle emitted in `build/assets/`.

- [ ] **Step 5: Commit**

```bash
git add src/workers/embeddingWorker.js src/services/embeddingWorkerClient.js src/services/exploreForYouService.js tests/embeddingWorkerClient.test.js
git commit -m "perf(ml): offload CVEM v1 Explore embedding decode and neighbor scan to Web Worker"
```

---

### Task 7: Live Supabase Verification, End-to-End Browser QA, Documentation Sync & Manual Platform Checklist

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `SPEC.md`
- Modify: `LOCAL_MODEL_GUIDE.md`

**Interfaces:**
- Consumes: All completed Tasks 1–6; live Supabase MCP (`xdmhejwhalliljsksvum`).
- Produces: Verified production bundle, verified live browser flows, updated v5.4 docs, and final manual action checklist for Supabase Auth Dashboard + Vercel Dashboard.

- [ ] **Step 1: Verify live Supabase schema and security/performance advisors**

Run `supabase_mcp` `list_tables` (`verbose: true`) and `get_advisors` (`security` and `performance`) on `xdmhejwhalliljsksvum`. Confirm `profiles.taste_rules` and `user_explore_picks` `<= 260` check constraint are live with zero new RLS/index warnings.

- [ ] **Step 2: Run full offline test suite, secrets guard, and production build**

Run: `npm test; if ($LASTEXITCODE -eq 0) { npm run check:secrets }; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: All test suites PASS (`fail 0`, `skipped 0`), zero leaked secrets, clean production build with split vendor chunks.

- [ ] **Step 3: Live browser verification (Playwright via browser subagent)**

Start local dev server (`npm start` on `http://localhost:3000`) and verify:
1. Guest flow on `/` and `/explore`: NavBar shows clean `"Sign In"` entry; clicking navigates to `/auth`.
2. `/auth` tabs: Sign In (Email+Password + Magic Link switch), Create Account (validation + password visibility toggle), Forgot Password, and "Continue as Guest" button all render cleanly at `1440×900` and `390×844` with zero console errors.
3. `/explore?mode=for-you`: First paint renders Wave 1 poster cards in `< 3s` (no 60-second blank skeleton!) with live progressive expansion indicator to ~250 films, zero horizontal header shift, and instant Deep Filtering + Shuffle.

- [ ] **Step 4: Update top-level docs (`README.md`, `ARCHITECTURE.md`, `SPEC.md`, `LOCAL_MODEL_GUIDE.md`) and commit**

Document v5.4 Email+Password/Magic-Link `/auth` & `/account` pages, profile `taste_rules` + 250-item `user_explore_picks` sync, 3-wave progressive Explore `"Movies You'll Like"` streaming, Web Worker ML execution, and Vite vendor chunk splitting (observing `tests/docsHygiene.test.js` — no hard-coded test counts!).

Run: `npm test`
Expected: PASS (`fail 0`).

```bash
git add README.md ARCHITECTURE.md SPEC.md LOCAL_MODEL_GUIDE.md
git commit -m "docs: document v5.4 email auth, progressive Explore For You, and performance upgrades"
```

---

## Manual Dashboard Steps Required (Cannot Be Automated via Current CLI/MCP)

After execution completes, the user should verify/toggle these 3 dashboard settings manually (cannot be set via SQL/MCP or unauthenticated Vercel CLI):

1. **Supabase Dashboard → Authentication → Attack Protection / Password Security:**
   - Enable **Leaked Password Protection** (HaveIBeenPwned check) — flagged as a warning by live `supabase_mcp` security advisors on project `CinemaVault` (`xdmhejwhalliljsksvum`).
2. **Supabase Dashboard → Authentication → URL Configuration:**
   - Confirm **Site URL** is `https://react-movie-original.vercel.app`.
   - Ensure **Redirect URLs** include `https://react-movie-original.vercel.app/**` and `http://localhost:3000/**` so signup confirmation emails, magic links, and password reset links route back to `/auth` cleanly.
3. **Vercel Dashboard → Project Settings → Environment Variables (or run `vercel login` locally so CLI can inspect/set them):**
   - Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set for Production & Preview so the `/auth` and `/account` flows are active on `react-movie-original.vercel.app`.
   - Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set if you want durable cross-instance daily Gemini rate limits in Production.
