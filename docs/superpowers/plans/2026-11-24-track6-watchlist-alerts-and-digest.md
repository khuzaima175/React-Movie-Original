# Track 6: Watchlist Availability Alerts & Weekly Email Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn CinemaVault from a reactive tool into an active weekly habit by detecting when watchlisted films arrive on a user's streaming services, surfacing an in-app notification bell, and delivering a weekly email digest.

**Architecture:** Add `watchlist_provider_snapshots` and `user_notifications` tables plus opt-in `alert_email_enabled` / `alert_frequency` columns on `profiles`. Add two `CRON_SECRET`-authenticated Vercel Cron endpoints (`api/cron-watchlist-alerts.js` daily and `api/cron-weekly-digest.js` weekly) that batch-deduplicate unique `(tmdb_id, region)` lookups against TMDB `watch/providers` to stay well inside rate limits, insert deduplicated `user_notifications` rows only on newly added providers, and send a clean HTML digest via Resend when `RESEND_API_KEY` is configured. Surface unread alerts via `NotificationBell.jsx` in `NavBar.jsx` and preference toggles in `AccountPage.jsx`.

**Tech Stack:** React 18, Vercel Serverless Functions + Vercel Cron (`vercel.json`), Supabase Postgres 17 + RLS + Service Role (server-side cron only), Resend HTTP API (zero SDK needed—native `fetch`), Node native test runner (`node --test`).

**Spec:** [docs/superpowers/specs/2026-11-24-weekly-product-roadmap-design.md](../specs/2026-11-24-weekly-product-roadmap-design.md)

## Global Constraints
- **Zero Duplicate Alerts:** Enforce a database-level `unique (user_id, type, tmdb_id, provider_id)` constraint (with `provider_id integer not null default 0` for non-provider alerts) so repeated cron runs can use clean Supabase `onConflict` upserts with `ignoreDuplicates: true` and never double-notify.
- **TMDB Rate-Limit Safety:** Deduplicate `(tmdb_id, region)` across all users before calling TMDB, cap concurrency to `5`, and honor `429 Retry-After` cleanly.
- **Strict Cron Auth:** Both `/api/cron-*` endpoints must verify `Authorization: Bearer ${process.env.CRON_SECRET}` using constant-time comparison and return `401` otherwise; never expose `SUPABASE_SERVICE_ROLE_KEY` to client code.
- **Graceful Email Opt-In:** Email digest is strictly opt-in (`alert_email_enabled default false`), includes a signed 1-click unsubscribe endpoint (`/api/unsubscribe-digest?token=...`), and cleanly skips sending if `RESEND_API_KEY` is not set.

## Review Focus
1. **Initial baseline snapshot (no alert storm on Day 1):** The very first time a watchlisted film is snapshotted (`previousProviders === null`), store its current providers **without** firing a "just arrived!" alert—alerts fire only on subsequent diffs (`nextProviders \ previousProviders`).
2. **Provider alias normalization:** Expanding TMDB aliases (e.g., Amazon Prime `9` vs `119`, Max `384` vs `1899` via `expandProviderIds` in `tmdbService.js`) must be consistent so users don't miss alerts or get duplicate alias notifications.
3. **Unauthorized cron invocation:** Requests to `/api/cron-watchlist-alerts` without a valid `CRON_SECRET` header must immediately return `401` before touching Supabase or TMDB.
4. **Empty digest suppression:** If a user has `0` unread availability alerts since `last_digest_sent_at`, do **not** send an empty email.
5. **1-click unsubscribe without login:** Clicking the unsubscribe link in an email must verify the HMAC-SHA256 token and flip `profiles.alert_email_enabled = false` immediately without requiring a browser session.

---

### Task 1: Supabase Schema for Snapshots, Notifications & Alert Preferences

**Files:**
- Create: `supabase/migrations/20261124000003_watchlist_alerts_and_notifications.sql`

**Interfaces:**
- Alters `public.profiles`:
  - `alert_email_enabled boolean not null default false`
  - `alert_frequency text not null default 'weekly' check (alert_frequency in ('weekly', 'off'))`
  - `last_digest_sent_at timestamptz`
- Creates `public.watchlist_provider_snapshots`:
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `tmdb_id integer not null`
  - `region text not null default 'US'`
  - `provider_ids integer[] not null default '{}'::integer[]`
  - `checked_at timestamptz not null default now()`
  - `primary key (user_id, tmdb_id, region)`
  - `revoke all from public, anon, authenticated` (service-role cron only)
- Creates `public.user_notifications`:
  - `id bigint generated always as identity primary key`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `type text not null check (type in ('watchlist_available', 'high_match_release'))`
  - `tmdb_id integer not null`
  - `title text not null`
  - `poster text`
  - `provider_id integer not null default 0`
  - `provider_name text`
  - `match_pct smallint`
  - `watch_link text`
  - `read_at timestamptz`
  - `emailed_at timestamptz`
  - `created_at timestamptz not null default now()`
  - `unique (user_id, type, tmdb_id, provider_id)`
  - Indexes:
    - `user_notifications_user_created_idx (user_id, created_at desc)`
    - `user_notifications_unread_idx (user_id) where read_at is null`
  - RLS: `select` and `update` (for `read_at`) granted to `authenticated` with `(select auth.uid()) = user_id`; `insert` reserved for service-role cron.

- [ ] **Step 1: Write `supabase/migrations/20261124000003_watchlist_alerts_and_notifications.sql`**
- [ ] **Step 2: Validate SQL syntax & RLS patterns against Supabase Postgres rules**
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261124000003_watchlist_alerts_and_notifications.sql
git commit -m "feat(db): add watchlist_provider_snapshots and user_notifications schema"
```

---

### Task 2: Pure Diffing, Digest HTML Builder & Unsubscribe Token Logic

**Files:**
- Create: `api/_alertHelpers.js`
- Test: `tests/alertHelpers.test.js`

**Interfaces:**
- Produces:
  ```js
  export function diffWatchlistProviders({
    previousProviderIds = null, // null = first-ever baseline snapshot
    currentProviderIds = [],
    userPreferredProviderIds = []
  })
  // returns { isBaseline: boolean, newlyAvailableIds: number[] }

  export function buildWeeklyDigestEmail({ displayName, notifications = [], siteUrl, unsubscribeUrl })
  // returns { subject: string, html: string, text: string } | null (null if notifications.length === 0)

  export function signUnsubscribeToken(userId, secret)
  export function verifyUnsubscribeToken(token, secret) // returns userId | null (constant-time HMAC-SHA256)
  ```

- [ ] **Step 1: Write failing tests in `tests/alertHelpers.test.js`**

Pin all 5 Review Focus cases:
1. First snapshot (`previousProviderIds: null`) returns `{ isBaseline: true, newlyAvailableIds: [] }` (no Day-1 storm).
2. Subsequent snapshot where Netflix (`8`) appears and user subscribes to Netflix (`[8, 337]`) returns `{ isBaseline: false, newlyAvailableIds: [8] }`.
3. Provider arriving that user does NOT subscribe to returns `newlyAvailableIds: []`.
4. `buildWeeklyDigestEmail` returns `null` when `notifications` is empty, and escapes HTML in movie titles when non-empty.
5. `signUnsubscribeToken` / `verifyUnsubscribeToken` round-trips valid tokens and rejects tampered tokens.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/alertHelpers.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement `api/_alertHelpers.js`**
- [ ] **Step 4: Run tests**

Run: `node --test tests/alertHelpers.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_alertHelpers.js tests/alertHelpers.test.js
git commit -m "feat(alerts): add provider diffing, digest builder, and HMAC unsubscribe helpers"
```

---

### Task 3: Cron Endpoints (`cron-watchlist-alerts`, `cron-weekly-digest`, `unsubscribe-digest`) & `vercel.json`

**Files:**
- Create: `api/cron-watchlist-alerts.js`
- Create: `api/cron-weekly-digest.js`
- Create: `api/unsubscribe-digest.js`
- Modify: `vercel.json` (add `crons` schedule: daily `0 6 * * *` and Fridays `0 15 * * 5`)
- Test: `tests/cronAlertsAuth.test.js`

**Interfaces:**
- Consumes: `api/_alertHelpers.js`, `process.env.CRON_SECRET`, `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`, `process.env.TMDB_API_KEY`, `process.env.RESEND_API_KEY`
- Produces:
  - `GET /api/cron-watchlist-alerts` → diffs active users' watchlists against TMDB `watch/providers` (batch-deduplicated by `(tmdb_id, region)`), upserts `watchlist_provider_snapshots`, inserts deduplicated `user_notifications`.
  - `GET /api/cron-weekly-digest` → queries un-emailed notifications for users with `alert_email_enabled = true`, posts HTML digest to `https://api.resend.com/emails`, marks `emailed_at = now()` and `profiles.last_digest_sent_at = now()`.
  - `GET /api/unsubscribe-digest?token=...` → verifies HMAC token, updates `profiles.alert_email_enabled = false`, returns clean confirmation HTML page.

- [ ] **Step 1: Write failing auth & handler tests in `tests/cronAlertsAuth.test.js`**

Verify missing/wrong `Authorization` header returns `401` on both cron handlers, and invalid token returns `400` on `unsubscribe-digest`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cronAlertsAuth.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement the three serverless endpoints and add `crons` to `vercel.json`**
- [ ] **Step 4: Run tests**

Run: `node --test tests/cronAlertsAuth.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/cron-watchlist-alerts.js api/cron-weekly-digest.js api/unsubscribe-digest.js vercel.json tests/cronAlertsAuth.test.js
git commit -m "feat(api): add watchlist availability cron, weekly email digest, and 1-click unsubscribe"
```

---

### Task 4: In-App `NotificationBell.jsx` & Account Alert Preferences UI

**Files:**
- Create: `src/services/notificationsService.js`
- Create: `src/components/NotificationBell.jsx`
- Modify: `src/components/NavBar.jsx:145-190` (render `NotificationBell` for signed-in users)
- Modify: `src/pages/AccountPage.jsx` (add "Watchlist Alerts & Weekly Digest" toggle card)
- Test: `tests/notificationsService.test.js`

**Interfaces:**
- Consumes: `getSupabaseClientAsync` (`supabaseClient.js`), `resolveProviderLaunchUrl` (Track 2 `watchLinkService.js`)
- Produces:
  - `fetchUserNotifications(userId, limit = 25)`
  - `markNotificationsRead(userId, notificationIds = [])`
  - `updateAlertPreferences(userId, { alertEmailEnabled, alertFrequency })`

- [ ] **Step 1: Write failing tests in `tests/notificationsService.test.js`**
- [ ] **Step 2: Implement `notificationsService.js`, `NotificationBell.jsx`, and wire into `NavBar.jsx` and `AccountPage.jsx`**
- [ ] **Step 3: Run full tests and production build**

Run: `npm test && npm run build`  
Expected: All tests PASS and Vite production build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/services/notificationsService.js src/components/NotificationBell.jsx src/components/NavBar.jsx src/pages/AccountPage.jsx tests/notificationsService.test.js
git commit -m "feat(ui): add in-app watchlist notification bell and weekly digest preferences"
```
