# Track 4: Watch Together (Two-Player Taste Merge & Swipe Room) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Solve the two-player movie-night problem by blending two users' taste profiles with Nash-welfare joint ranking, excluding both users' watched vaults and dealbreakers, and supporting both `@username` friend pairing and 1-click shareable guest swipe rooms (`/together/:code`).

**Architecture:** Build pure joint-ranking math in `src/services/watchTogetherService.js` that combines User A's and User B's scores (`EASE^R`/`SVD-64` or 64-D `taste_vector`), applies damped harmonic mean scoring + minimum-satisfaction floor, and hard-filters `watchedA ∪ watchedB` and `avoidRulesA ∪ avoidRulesB`. Add a lightweight, 48-hour-expiring `public.watch_sessions` Supabase table + room sync helper so a partner without an account can open `/together/:code`, tap 5–8 quick films (reusing `TasteDeckModal` curation), and swipe through the merged Top 15 until a mutual match fires.

**Tech Stack:** React 18, Supabase Postgres 17 + RLS + Realtime (or lightweight polling), existing `embeddingService.js` / `easeService.js` / `communityService.js`, Node native test runner (`node --test`).

**Spec:** [docs/superpowers/specs/2026-11-24-weekly-product-roadmap-design.md](../specs/2026-11-24-weekly-product-roadmap-design.md)

## Global Constraints
- Guest-compatible: Host can create a `/together/:code` room and Guest can join and swipe without creating an account (room access scoped strictly by unguessable 8-char alphanumeric `room_code` + 48h TTL).
- Never expose full `user_vault_items` rows in a session room; store only compact `tmdb_id` integer arrays (`watched_tmdb_ids`), 64-D `real[]` `taste_vector`, sanitized `avoid_rules`, and swipe vote maps.
- Follow Supabase Postgres best practices: `bigint generated always as identity` PK, explicit index on `room_code` and `expires_at`, RLS enabled, `set search_path = ''` on helper functions.
- Re-use `tasteRulesService.js` (`compileActiveTasteRules`, `candidateMatchesAvoidRule`) for joint dealbreaker filtering.

## Review Focus
1. **Asymmetric veto protection:** A film scoring `0.98` for Partner A and `0.15` for Partner B must rank *below* a film scoring `0.78` for both Partners (harmonic mean + `< 0.35` floor penalty).
2. **Joint exclusion across ID formats:** If Partner A logged `"Inception"` with `imdbID: "tt1375666"` and Partner B has `tmdbId: 27205`, it must be excluded from the merged shortlist.
3. **Joint dealbreaker union:** If Partner A has `avoid: "horror"` and Partner B has `avoid: "musicals"`, candidates matching *either* rule are dropped.
4. **Expired or unknown room code:** Navigating to `/together/INVALID9` or an expired (>48h) room must display a clear recovery CTA ("Create a new Movie Night room") rather than hanging or crashing.
5. **Mutual match detection & tie-breaking:** When both partners swipe `"yes"` on the same `tmdbId`, the match modal triggers immediately; if the 15-card deck ends with 0 mutual `"yes"` votes, show the top 3 highest joint-score "Best Compromises".

---

### Task 1: Pure `watchTogetherService.js` — Nash-Welfare Joint Ranker & Swipe State

**Files:**
- Create: `src/services/watchTogetherService.js`
- Test: `tests/watchTogetherService.test.js`

**Interfaces:**
- Consumes: `computeTasteTwinCompatibility` (`communityService.js`), `compileActiveTasteRules`, `candidateMatchesAvoidRule` (`tasteRulesService.js`), `isSameMovie` (`movieIdentity.js`)
- Produces:
  ```js
  export function scoreJointCandidate(scoreA, scoreB, options = {})
  // scoreA, scoreB in [0, 1]; returns { jointScore, minScore, balanceLabel }

  export function rankWatchTogetherCandidates({
    candidates = [],
    scoresA = new Map(),
    scoresB = new Map(),
    watchedA = [],
    watchedB = [],
    tasteRulesA = [],
    tasteRulesB = [],
    userProviders = [],
    limit = 20
  })

  export function buildPartnerScoreMapFromVector(partnerVector64, embeddingIndex, candidateIds = [])
  // computes [0, 1] normalized cosine affinity for a partner who only shared a 64-D taste_vector

  export function evaluateSwipeRound({ deck = [], votesA = {}, votesB = {} })
  // returns { mutualMatches: Array, hostLikes: Array, guestLikes: Array, fallbackCompromises: Array }

  export function generateRoomCode(length = 8)
  ```

- [ ] **Step 1: Write failing tests in `tests/watchTogetherService.test.js`**

Pin all 5 Review Focus cases:
1. `scoreJointCandidate(0.78, 0.78).jointScore > scoreJointCandidate(0.98, 0.15).jointScore`.
2. `rankWatchTogetherCandidates` excludes movies present in `watchedA` or `watchedB` across `tmdbId` / `imdbID`.
3. `rankWatchTogetherCandidates` drops candidates matching either `tasteRulesA` or `tasteRulesB` avoid rules.
4. `buildPartnerScoreMapFromVector` maps cosine `[-1, 1]` cleanly to `[0, 1]` without `NaN`.
5. `evaluateSwipeRound` surfaces mutual `"yes"` matches in joint-score order and returns top-3 `fallbackCompromises` when zero mutual likes exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/watchTogetherService.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement `src/services/watchTogetherService.js`**

Use damped harmonic mean `H = (2 * a * b) / (a + b + 1e-6)` multiplied by a smooth penalty (`0.45`) whenever `Math.min(a, b) < 0.35`, plus joint watched/rule filtering and provider preference boost.

- [ ] **Step 4: Run tests**

Run: `node --test tests/watchTogetherService.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/watchTogetherService.js tests/watchTogetherService.test.js
git commit -m "feat(together): add Nash-welfare two-player ranker and swipe evaluator"
```

---

### Task 2: Supabase `watch_sessions` Migration & Room Sync Client

**Files:**
- Create: `supabase/migrations/20261124000001_watch_together_sessions.sql`
- Create: `src/services/watchSessionClient.js`
- Test: `tests/watchSessionClient.test.js`

**Interfaces:**
- Produces SQL table `public.watch_sessions`:
  - `id bigint generated always as identity primary key`
  - `room_code text unique not null check (room_code ~ '^[A-Z0-9]{8}$')`
  - `host_user_id uuid references auth.users(id) on delete set null`
  - `host_name text not null default 'Host'`
  - `host_vector real[] check (host_vector is null or cardinality(host_vector) = 64)`
  - `host_watched_ids integer[] not null default '{}'::integer[]`
  - `host_avoid_rules jsonb not null default '[]'::jsonb`
  - `guest_name text`
  - `guest_vector real[] check (guest_vector is null or cardinality(guest_vector) = 64)`
  - `guest_watched_ids integer[] not null default '{}'::integer[]`
  - `guest_avoid_rules jsonb not null default '[]'::jsonb`
  - `deck_items jsonb not null default '[]'::jsonb`
  - `host_votes jsonb not null default '{}'::jsonb`
  - `guest_votes jsonb not null default '{}'::jsonb`
  - `region text not null default 'US'`
  - `provider_ids integer[] not null default '{}'::integer[]`
  - `expires_at timestamptz not null default (now() + interval '48 hours')`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
- Security model: Lock table from direct `anon` table scans (`revoke all on public.watch_sessions from public, anon, authenticated`) and expose minimal `security definer` RPCs (`create_watch_session`, `get_watch_session_by_code`, `join_watch_session`, `submit_watch_session_vote`) with `set search_path = ''` that strictly scope access to the exact `room_code` and reject expired rooms (`expires_at < now()`).
- Produces JS client in `src/services/watchSessionClient.js`: `createWatchSession`, `fetchWatchSession`, `joinWatchSession`, `submitWatchVote` (with graceful local-only fallback when Supabase isn't configured).

- [ ] **Step 1: Write failing tests in `tests/watchSessionClient.test.js`**

Test room code validation, expired-room handling (`status: "expired"`), vote payload merging, and graceful degradation when Supabase is unconfigured.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/watchSessionClient.test.js`  
Expected: FAIL.

- [ ] **Step 3: Create migration `20261124000001_watch_together_sessions.sql` and `src/services/watchSessionClient.js`**

Include explicit indexes on `host_user_id` (`where host_user_id is not null`) and `expires_at` for efficient cleanup and lookups.

- [ ] **Step 4: Run tests**

Run: `node --test tests/watchSessionClient.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261124000001_watch_together_sessions.sql src/services/watchSessionClient.js tests/watchSessionClient.test.js
git commit -m "feat(together): add watch_sessions schema, room RPCs, and session client"
```

---

### Task 3: `/together` & `/together/:code` Page, Partner Quick-Pick & Swipe Deck UI

**Files:**
- Create: `src/pages/WatchTogetherPage.jsx`
- Create: `src/components/WatchTogetherSwipeDeck.jsx`
- Create: `src/styles/together.css`
- Modify: `src/App.jsx:20-35` and `src/App.jsx:260-275` (lazy route `/together` and `/together/:code`)
- Modify: `src/pages/PublicProfilePage.jsx` (add `"Watch Together with @handle"` button linking to `/together?partner=<username>`)
- Modify: `src/components/NavBar.jsx` (add `"Watch Together"` item in utility menu / mobile discover entry)

**Interfaces:**
- Consumes: `watchTogetherService.js`, `watchSessionClient.js`, `embeddingService.js`, `easeService.js`, `communityService.js`
- Produces: Complete 2-player flow:
  1. **Mode 1 (`@username` Direct Blend):** Instant merged Top-20 grid with dual match badges (`You 89% · @partner 86%`) and streaming filters.
  2. **Mode 2 (Shareable Room `/together/:code`):** Host clicks `"Create Movie Night Link"` → copies link → Partner opens link, either connects their local vault or picks 5–8 loved films from a quick calibration grid → merged 15-film swipe deck (`Watch / Pass`) with live polling/realtime sync and mutual-match celebration card with 1-tap streaming launch (from Track 2).

- [ ] **Step 1: Build `WatchTogetherSwipeDeck.jsx`, `WatchTogetherPage.jsx`, and `src/styles/together.css`**
- [ ] **Step 2: Wire routes in `App.jsx`, button in `PublicProfilePage.jsx`, and link in `NavBar.jsx`**
- [ ] **Step 3: Run tests and production build**

Run: `npm test && npm run build`  
Expected: All tests PASS and Vite production build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/WatchTogetherPage.jsx src/components/WatchTogetherSwipeDeck.jsx src/styles/together.css src/App.jsx src/pages/PublicProfilePage.jsx src/components/NavBar.jsx
git commit -m "feat(ui): launch Watch Together two-player taste merge and swipe room"
```
