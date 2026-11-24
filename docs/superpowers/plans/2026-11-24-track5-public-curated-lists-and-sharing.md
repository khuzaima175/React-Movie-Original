# Track 5: Curated Public Lists, Bookmarks & Social Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver full custom user lists, Canon Checklists, and Schema v3 portability—extending the existing Phase 4 private-lists blueprint with public shareable `/list/:slug` pages, list bookmarking/cloning, and live viewer Taste Match % overlays.

**Architecture:** Execute the private custom-lists core from [2026-11-15-phase4-custom-lists-checklists-and-sync.md](./2026-11-15-phase4-custom-lists-checklists-and-sync.md) (`src/services/listsService.js`, `vaultPortability.js` v3, `AppContext.jsx` stored via Track 1's IndexedDB `saveVaultSlice("customLists", ...)`), and extend `public.user_lists` with `is_public`, `slug`, `bookmark_count`, plus `public.user_list_bookmarks` and a `public_lists_select` RLS policy. Surface curated lists on `/list/:slug` (`PublicListPage.jsx`) and `PublicProfilePage.jsx` so guests and signed-in users alike can browse human-curated collections with personalized Taste Match % on every title.

**Tech Stack:** React 18, Supabase Postgres 17 + RLS, IndexedDB (`vaultStorageService.js`), existing `tasteMatchService.js`, Node native test runner (`node --test`).

**Spec:** [docs/superpowers/specs/2026-11-24-weekly-product-roadmap-design.md](../specs/2026-11-24-weekly-product-roadmap-design.md)  
**Prerequisite Blueprint Extended:** [docs/superpowers/plans/2026-11-15-phase4-custom-lists-checklists-and-sync.md](./2026-11-15-phase4-custom-lists-checklists-and-sync.md)

## Global Constraints
- Follow all 4 Global Constraints from Phase 4 (zero fabricated Canon Checklist IDs, backward-compatible Schema v1/v2 → v3 JSON backup imports, graceful degradation if migration isn't applied yet, strict `(select auth.uid())` RLS).
- Public lists are strictly **opt-in** (`is_public boolean not null default false`); private lists must never be readable by `anon` or other users.
- Persist `customLists` locally in Track 1's IndexedDB `vaultStorageService` (never bloating `localStorage`).
- Slugs must be URL-safe, lowercase, and collision-resistant (`<slugified-name>-<6-char-id>`).

## Review Focus
1. **Private-by-default RLS:** Querying `user_lists` as `anon` or User B must return `0` rows for any list with `is_public = false` or `deleted_at is not null`.
2. **Slug collisions & special characters:** Two users creating `"Rainy Tuesday Movies (1997)"` must generate distinct valid URL slugs without violating the unique constraint.
3. **Bookmark count integrity:** Bookmarking/unbookmarking a public list must atomically update `bookmark_count` via trigger without allowing a user to double-bookmark or directly overwrite `bookmark_count`.
4. **Live Taste Match % for guests & signed-in viewers:** Opening `/list/:slug` with a local guest vault (`>= 3` rated films) must compute personal Taste Match % badges on-device without requiring login; with `< 3` rated films it degrades cleanly without showing fake percentages.
5. **Cloning a shared list:** Clicking `"Clone to My Vault"` creates an independent private copy (`isPublic: false`, fresh `id`) in the viewer's local/cloud lists without mutating the curator's list.

---

### Task 1: Execute Core Custom Lists + Public Slug/Clone Extensions in `listsService.js`

**Files:**
- Create: `src/services/listsService.js`
- Modify: `src/services/vaultPortability.js:90-140` (Schema v3 `customLists` export/import)
- Test: `tests/listsService.test.js`

**Interfaces:**
- Produces all Phase 4 exports (`CANON_CHECKLISTS`, `createCustomList`, `renameCustomList`, `deleteCustomList`, `toggleMovieInList`, `getActiveCustomLists`, `getListsContainingMovie`, `computeChecklistProgress`, `mergeCustomListsByTimestamp`) **plus**:
  ```js
  export function generateListSlug(name = "", uniqueSuffix = "")
  export function setListVisibility(lists = [], listId, { isPublic, slug }, nowIso)
  export function clonePublicListToLocal(lists = [], publicList, nowIso)
  // returns { lists, clonedList } with isPublic: false and fresh local id
  ```

- [ ] **Step 1: Write failing tests in `tests/listsService.test.js`**

Include all Phase 4 tests (CRUD, `isSameMovie` dedupe, soft-delete conflict merge, Canon progress) **plus**:
1. `generateListSlug("Rainy Tuesday (1997)!!", "a1b2c3")` → `"rainy-tuesday-1997-a1b2c3"`.
2. `setListVisibility` toggles `isPublic` and stamps a deterministic slug if missing.
3. `clonePublicListToLocal` produces an independent private copy with `isPublic: false` and preserves all film items.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/listsService.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement `src/services/listsService.js` and Schema v3 in `src/services/vaultPortability.js`**
- [ ] **Step 4: Run tests**

Run: `node --test tests/listsService.test.js && npm test`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/listsService.js src/services/vaultPortability.js tests/listsService.test.js
git commit -m "feat(lists): implement custom lists, canon checklists, slugs, cloning, and Schema v3 portability"
```

---

### Task 2: Supabase Migration (`user_lists` + `user_list_bookmarks`) & Sync Service

**Files:**
- Create: `supabase/migrations/20261124000002_user_lists_and_public_sharing.sql`
- Create: `src/services/publicListsService.js`
- Modify: `src/services/vaultSyncService.js` (add `pullAndSyncCloudLists` / `pushCloudListUpsert`)
- Test: `tests/publicListsService.test.js`

**Interfaces:**
- SQL Schema (`20261124000002_user_lists_and_public_sharing.sql`):
  - `public.user_lists`:
    - `id text primary key` (client ULID/time-prefixed ID for offline-first creation)
    - `user_id uuid not null references auth.users(id) on delete cascade`
    - `name text not null check (char_length(name) between 1 and 80)`
    - `description text not null default '' check (char_length(description) <= 300)`
    - `items jsonb not null default '[]'::jsonb`
    - `source_checklist_id text`
    - `is_public boolean not null default false`
    - `slug text unique check (slug is null or slug ~ '^[a-z0-9-]{4,96}$')`
    - `bookmark_count integer not null default 0 check (bookmark_count >= 0)`
    - `deleted_at timestamptz`
    - `updated_at timestamptz not null default now()`
  - Indexes: `user_lists_user_id_idx (user_id, updated_at desc)`, partial index `user_lists_public_slug_idx (slug) where is_public = true and deleted_at is null`.
  - RLS on `public.user_lists`:
    - `select` for `anon, authenticated`: `(is_public = true and deleted_at is null) or (select auth.uid()) = user_id`
    - `insert, update, delete` for `authenticated`: `(select auth.uid()) = user_id`
  - `public.user_list_bookmarks`:
    - `user_id uuid not null references auth.users(id) on delete cascade`
    - `list_id text not null references public.user_lists(id) on delete cascade`
    - `created_at timestamptz not null default now()`
    - `primary key (user_id, list_id)` + index `user_list_bookmarks_list_id_idx (list_id)`
    - Trigger (`security definer`, `set search_path = ''`) keeping `user_lists.bookmark_count` synchronized on insert/delete.
- JS Client (`src/services/publicListsService.js`):
  - `fetchPublicListBySlug(slug, viewerUserId)` (joins curator handle/display_name from `public_profiles`)
  - `fetchPublicListsByUsername(username)`
  - `toggleBookmarkPublicList({ userId, listId, currentlyBookmarked })`

- [ ] **Step 1: Write failing tests in `tests/publicListsService.test.js`**
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/publicListsService.test.js`  
Expected: FAIL.

- [ ] **Step 3: Create migration, `publicListsService.js`, and `vaultSyncService.js` list sync helpers**
- [ ] **Step 4: Run tests**

Run: `node --test tests/publicListsService.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261124000002_user_lists_and_public_sharing.sql src/services/publicListsService.js src/services/vaultSyncService.js tests/publicListsService.test.js
git commit -m "feat(lists): add user_lists and bookmark schema with public sharing RLS"
```

---

### Task 3: Vault Lists UI, `AddToListPopover`, Shareable `/list/:slug` Page & Profile Showcase

**Files:**
- Create: `src/components/AddToListPopover.jsx`
- Create: `src/components/VaultListsPanel.jsx`
- Create: `src/pages/PublicListPage.jsx`
- Create: `src/styles/lists.css`
- Modify: `src/context/AppContext.jsx` (wire `customLists` via Track 1 `saveVaultSlice("customLists", ...)` + cloud sync)
- Modify: `src/pages/VaultPage.jsx` (add `Lists` & `Checklists` sub-views)
- Modify: `src/components/MovieDetails.jsx` (mount `AddToListPopover`)
- Modify: `src/pages/PublicProfilePage.jsx` (show curator's public lists grid)
- Modify: `src/App.jsx` (add lazy route `/list/:slug`)

**Interfaces:**
- Consumes: `listsService.js`, `publicListsService.js`, `tasteMatchService.js`
- Produces:
  - In-vault creation, editing, public/private toggle + 1-click copy share link (`/list/:slug`).
  - `/list/:slug` public editorial page with curator header, bookmark button, `"Clone to My Vault"`, and live per-film Taste Match % badges computed locally from the viewer's vault.

- [ ] **Step 1: Wire `customLists` state + IndexedDB/Supabase sync in `AppContext.jsx`**
- [ ] **Step 2: Build `AddToListPopover.jsx`, `VaultListsPanel.jsx`, `PublicListPage.jsx`, and `src/styles/lists.css`**
- [ ] **Step 3: Integrate into `VaultPage.jsx`, `MovieDetails.jsx`, `PublicProfilePage.jsx`, and `App.jsx`**
- [ ] **Step 4: Run full tests and production build**

Run: `npm test && npm run build`  
Expected: All tests PASS and Vite production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/AddToListPopover.jsx src/components/VaultListsPanel.jsx src/pages/PublicListPage.jsx src/styles/lists.css src/context/AppContext.jsx src/pages/VaultPage.jsx src/components/MovieDetails.jsx src/pages/PublicProfilePage.jsx src/App.jsx
git commit -m "feat(ui): add custom lists, public /list/:slug pages, bookmarking, and Taste Match overlays"
```
