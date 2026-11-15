# Phase 4: Custom Research Lists, Canon Checklists, Schema v3 Portability & Supabase Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand CinemaVault's library beyond static Watched and Watchlist bins into user-curated Research Lists, auto-tracked Canon Checklists, Schema v3 JSON portability, and multi-device Supabase sync.

**Architecture:** Implement list CRUD, movie-membership toggles, soft-delete tombstone merging, and Canon Checklist completion calculations inside pure `src/services/listsService.js` (`node --test`). Extend `vaultPortability.js` to Schema v3 (preserving full v1/v2 backward compatibility), add an RLS-protected `public.user_lists` migration + resilient sync helpers in `vaultSyncService.js`, integrate list state in `AppContext.jsx` / `BackupManagerModal.jsx`, and surface UI via `AddToListPopover.jsx`, `VaultListsPanel.jsx`, `VaultBanner.jsx`, `VaultPage.jsx`, and `MovieDetails.jsx`.

**Tech Stack:** React 18, Supabase Postgres 17 + RLS, Node ESM native test runner (`node --test`), Vite.

---

### Spec & Global Constraints
- **Design Spec:** [docs/superpowers/specs/2026-11-15-research-hub-and-studio-design.md](../specs/2026-11-15-research-hub-and-studio-design.md)
- **Constraint 1 (Zero Fabricated Film IDs):** Any `tmdbId` / `imdbID` values bundled inside `CANON_CHECKLISTS` must either be omitted cleanly (relying on `isSameMovie()`'s normalized `ty:<title>::<year>` matcher + lazy `findTmdbByTitleAndYear` click navigation) OR verified live against TMDB before committing — never guess numeric IDs from memory.
- **Constraint 2 (Portability Backward Compatibility):** Schema v3 (`buildBackupJsonPayload`) must seamlessly import legacy arrays, Schema v1, and Schema v2 backups lacking `customLists` without throwing or wiping existing lists on `merge_update` / `add_new`.
- **Constraint 3 (Supabase Graceful Degradation):** `pullAndSyncCloudLists` must wrap `user_lists` queries cleanly so if an environment has not yet applied `20261115000000_add_user_lists.sql` (Postgres `42P01` or PostgREST `PGRST205`), `watched`/`watchlist` sync never fails; real auth/network/5xx errors still propagate loudly.
- **Constraint 4 (RLS Best Practices):** New Postgres table `public.user_lists` must lock out `public` & `anon`, grant strictly to `authenticated`, enable RLS, and use `(select auth.uid()) = user_id` in all 4 policies.

---

### Review Focus (5 Failure Modes Pinned by Tests)
1. **Duplicate List Membership & ID Matching:** Adding `"Interstellar"` via `tt0816692` and later checking or toggling `"tmdb_157336"` must match deterministically via `isSameMovie()` (`movieIdentity.js`), never inserting duplicate items inside the same list.
2. **Multi-Device Soft-Delete Conflict Resolution:** If Device A deletes `"Noir Picks"` (`deletedAt: T2`) while Device B had stale copy (`updatedAt: T1 < T2`), `mergeLocalAndCloudLists()` must preserve deletion rather than resurrecting the stale list; conversely, re-creating or editing newer (`T3 > T2`) wins cleanly.
3. **Canon Checklist Progress Counting Accuracy:** `computeChecklistProgress()` must match `watched` items reliably across IMDb, TMDB, and normalized `title+year` keys without double-counting duplicate imports or crashing on missing dates/years.
4. **Schema v1/v2 -> v3 Backup Safety:** Importing a Schema v2 JSON backup in `"merge_update"` mode must keep existing local `customLists` untouched (`[]` incoming does not delete local lists), whereas `"replace"` mode with a v3 backup cleanly replaces `customLists`.
5. **Popover Focus & Escape Behavior:** `AddToListPopover` inside `MovieDetails.jsx` must toggle with keyboard accessibility (`Escape` closes popover cleanly without triggering `MovieDetails` navigate-back!).

---

### Task 1: Pure `listsService.js` — Custom List CRUD, Canon Checklists & Merge Logic

**Files:**
- Create: `src/services/listsService.js`
- Test: `tests/listsService.test.js`

**Interfaces:**
```js
export const CUSTOM_LISTS_STORAGE_KEY = "cinemavault_custom_lists_v1";

export const CANON_CHECKLISTS = Object.freeze([
  // e.g. { id: "canon_21c_scifi", name: "21st Century Sci-Fi Milestones", description: "...", items: [{ title, year, director }] },
  // { id: "canon_noir_essentials", ... },
  // { id: "canon_crime_thrillers", ... },
  // { id: "canon_animation_greats", ... }
]);

export function normalizeListMovieItem(movie, nowIso)
export function normalizeCustomList(rawList, nowIso)

export function createCustomList(lists = [], { name, description = "", sourceChecklistId = null, initialItems = [] }, nowIso)
export function renameCustomList(lists = [], listId, { name, description }, nowIso)
export function deleteCustomList(lists = [], listId, nowIso) // sets deletedAt & updatedAt tombstone
export function toggleMovieInList(lists = [], listId, movie, nowIso)
// returns { lists, added: boolean }

export function getActiveCustomLists(lists = []) // excludes deletedAt != null
export function getListsContainingMovie(lists = [], movie) // active lists matching isSameMovie

export function computeChecklistProgress(checklist, watched = [], watchlist = [])
// returns { id, name, description, watchedCount, watchlistCount, totalCount, completionPct, entries: [{ ...item, isWatched, isWatchlist, userRating }] }

export function mergeCustomListsByTimestamp(baseLists = [], incomingLists = [], mode = "merge_update")
```

- [ ] **Step 1: Write the failing test**
  Create `tests/listsService.test.js`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import {
    CANON_CHECKLISTS,
    createCustomList,
    renameCustomList,
    deleteCustomList,
    toggleMovieInList,
    getActiveCustomLists,
    getListsContainingMovie,
    computeChecklistProgress,
    mergeCustomListsByTimestamp
  } from "../src/services/listsService.js";

  test("createCustomList, toggleMovieInList, renameCustomList, and soft-delete work cleanly", () => {
    const t1 = "2026-11-15T10:00:00.000Z";
    const t2 = "2026-11-15T11:00:00.000Z";
    let lists = createCustomList([], { name: "Weekend Noir" }, t1);
    assert.equal(lists.length, 1);
    const listId = lists[0].id;

    // Add by IMDb, then detect & toggle off by TMDB identity
    const added = toggleMovieInList(lists, listId, { imdbID: "tt0114369", tmdbId: 807, title: "Se7en", year: "1995" }, t1);
    assert.equal(added.added, true);
    assert.equal(getListsContainingMovie(added.lists, { tmdbId: 807 }).length, 1);

    const removed = toggleMovieInList(added.lists, listId, { tmdbId: 807, title: "Se7en" }, t2);
    assert.equal(removed.added, false);
    assert.equal(removed.lists[0].items.length, 0);

    const renamed = renameCustomList(removed.lists, listId, { name: "David Fincher Night" }, t2);
    assert.equal(renamed[0].name, "David Fincher Night");

    const deleted = deleteCustomList(renamed, listId, t2);
    assert.equal(getActiveCustomLists(deleted).length, 0);
    assert.ok(deleted[0].deletedAt);
  });

  test("computeChecklistProgress tracks watched coverage by canonical and title+year identity", () => {
    assert.ok(CANON_CHECKLISTS.length >= 3);
    const pack = CANON_CHECKLISTS[0];
    const first = pack.items[0];
    const progress = computeChecklistProgress(
      pack,
      [{ title: first.title, year: first.year, userRating: 9 }],
      []
    );
    assert.equal(progress.watchedCount, 1);
    assert.equal(progress.totalCount, pack.items.length);
    assert.equal(progress.entries[0].isWatched, true);
    assert.equal(progress.entries[0].userRating, 9);
  });

  test("mergeCustomListsByTimestamp respects newer tombstone and merge_update vs add_new vs replace", () => {
    const local = [
      { id: "l1", name: "Keep Local", updatedAt: "2026-11-15T12:00:00.000Z", deletedAt: null, items: [{ title: "Heat", year: "1995" }] },
      { id: "l2", name: "Deleted Newer", updatedAt: "2026-11-15T15:00:00.000Z", deletedAt: "2026-11-15T15:00:00.000Z", items: [] }
    ];
    const cloud = [
      { id: "l2", name: "Stale Resurrection Attempt", updatedAt: "2026-11-15T10:00:00.000Z", deletedAt: null, items: [{ title: "Memento", year: "2000" }] },
      { id: "l3", name: "Cloud Only", updatedAt: "2026-11-15T14:00:00.000Z", deletedAt: null, items: [] }
    ];
    const merged = mergeCustomListsByTimestamp(local, cloud, "merge_update");
    const active = getActiveCustomLists(merged);
    assert.equal(active.length, 2);
    assert.ok(active.some((l) => l.id === "l1"));
    assert.ok(active.some((l) => l.id === "l3"));
    assert.ok(!active.some((l) => l.id === "l2"));
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/listsService.test.js`
  Expected: FAIL (`Cannot find module '../src/services/listsService.js'`).

- [ ] **Step 3: Implement `src/services/listsService.js`**
  - Define 4–5 crisp curated `CANON_CHECKLISTS` packs (~10–12 landmark films each, using verified `{ title, year, director }` entries — verify against TMDB during authoring or omit unverified IDs cleanly so `isSameMovie()` matches by `title+year` cleanly without false IDs!).
  - Implement immutable CRUD helpers enforcing unique ID generation (`list_${Date.now()}_${rand}`) and deduplicated `items` array using `findMatchingMovie` / `isSameMovie`.
  - Implement timestamp-based `mergeCustomListsByTimestamp()` handling `"merge_update"` (newer `updatedAt` wins including tombstones; ties union items cleanly), `"add_new"` (only unseen list IDs appended), and `"replace"` (incoming active lists replace local active lists while updating tombstones if syncing).

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/listsService.test.js`
  Expected: PASS (all 3 tests green).

- [ ] **Step 5: Commit**
  `git add src/services/listsService.js tests/listsService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(lists): add listsService with custom lists CRUD, tombstones, and canon checklists" }`

---

### Task 2: Schema v3 JSON Portability (`vaultPortability.js`)

**Files:**
- Modify: `src/services/vaultPortability.js`
- Modify: `tests/vaultPortability.test.js` (or append Schema v3 cases cleanly)
- Modify: `src/components/BackupManagerModal.jsx`

**Interfaces:**
```js
// src/services/vaultPortability.js
export function buildBackupJsonPayload({
  watched = [],
  watchlist = [],
  userRegion = "US",
  userWatchProviders = [],
  tasteRules = [],
  customLists = [],
  now = Date.now()
} = {}) // returns schemaVersion: 3 with customLists: getActiveCustomLists(customLists)

// parseJsonBackupContent() returns:
// { watched, watchlist, preferences?, customLists? }

// summarizeImportDiff({
//   existingWatched, existingWatchlist, existingLists = [],
//   incomingWatched, incomingWatchlist, incomingLists = [],
//   mode = "merge_update"
// }) -> adds newListCount, updatedListCount, mergedLists to returned summary!
```

- [ ] **Step 1: Write failing Schema v3 portability tests in `tests/vaultPortability.test.js`**
  - Verify `buildBackupJsonPayload({ watched, customLists })` sets `schemaVersion: 3`, strips deleted tombstones from exported JSON, and serializes lists cleanly.
  - Verify `parseJsonBackupContent` handles legacy v2 payloads (`customLists` undefined -> safe skip/empty) AND v3 payloads cleanly.
  - Verify `summarizeImportDiff` merges `incomingLists` in `merge_update`, `add_new`, and `replace` modes without clobbering `existingLists` when importing a v2 snapshot (`incomingLists: undefined`).

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/vaultPortability.test.js`
  Expected: FAIL on Schema v3 assertions.

- [ ] **Step 3: Update `src/services/vaultPortability.js` and `src/components/BackupManagerModal.jsx`**
  - Update `buildBackupJsonPayload`, `parseJsonBackupContent`, and `summarizeImportDiff` cleanly reusing `getActiveCustomLists`, `normalizeCustomList`, `mergeCustomListsByTimestamp`.
  - In `BackupManagerModal.jsx`: pass `customLists` from `useApp()` into `buildBackupJsonPayload`, display custom list delta count in pre-import diff preview (`newListCount`), and pass `mergedLists` into `applyVaultImportSnapshot()`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/vaultPortability.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add src/services/vaultPortability.js src/components/BackupManagerModal.jsx tests/vaultPortability.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(backup): upgrade vaultPortability to Schema v3 with customLists support" }`

---

### Task 3: Supabase `user_lists` Migration, `vaultSyncService.js` & `AppContext.jsx` Integration

**Files:**
- Create: `supabase/migrations/20261115000000_add_user_lists.sql`
- Modify: `src/services/vaultSyncService.js`
- Modify: `tests/vaultSyncService.test.js`
- Modify: `src/context/AppContext.jsx`

**Interfaces:**
```sql
-- supabase/migrations/20261115000000_add_user_lists.sql
create table if not exists public.user_lists (
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id text not null,
  name text not null,
  description text,
  source_checklist_id text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, list_id)
);
```

```js
// src/services/vaultSyncService.js
export function mapLocalListToDbRow(list = {}, userId = "", nowIso = new Date().toISOString())
export function mapDbRowToLocalList(row = {})
export function mergeLocalAndCloudLists({ localLists = [], cloudRows = [], userId = "", nowIso = new Date().toISOString() })
export async function pullAndSyncCloudLists(client, { userId, localLists = [], nowIso, onMerged })
```

```js
// Added cleanly to AppContext value:
customLists,          // active lists (excludes tombstones!)
allCustomListsRaw,    // or internal ref synced to storage & cloud
createCustomListAction,
renameCustomListAction,
deleteCustomListAction,
toggleMovieInListAction,
cloneChecklistToCustomList
```

- [ ] **Step 1: Write failing cloud list sync unit tests in `tests/vaultSyncService.test.js`**
  - Test `mapLocalListToDbRow` / `mapDbRowToLocalList` round-trip (`name`, `description`, `sourceChecklistId`, `items`, `deletedAt`, `updatedAt`).
  - Test `mergeLocalAndCloudLists` handles newer cloud row winning, newer local delete tombstone pushing `deleted_at` to `toUpsertCloud`, and local-only list pushing to cloud.
  - Test `pullAndSyncCloudLists` catches missing-table error (`code: "42P01"` / `"PGRST205"`) gracefully (`skipped: true`) while re-throwing real Postgres/network errors!

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/vaultSyncService.test.js`
  Expected: FAIL on missing exported list sync helpers.

- [ ] **Step 3: Create SQL migration + implement `vaultSyncService.js` + wire `AppContext.jsx`**
  - Write `supabase/migrations/20261115000000_add_user_lists.sql`:
    - `create index if not exists user_lists_user_updated_idx on public.user_lists (user_id, updated_at desc);`
    - Reuse `public.touch_updated_at()` trigger on `before update`.
    - `alter table public.user_lists enable row level security;`
    - `revoke all on public.user_lists from public, anon;`
    - `grant select, insert, update, delete on public.user_lists to authenticated;`
    - 4 explicit RLS policies (`select`, `insert`, `update`, `delete`) using `(select auth.uid()) = user_id`.
  - Implement list mapping, merging, and `pullAndSyncCloudLists()` in `src/services/vaultSyncService.js`.
  - Wire `customListsState` (`cinemavault_custom_lists_v1` in `localStorage`) in `src/context/AppContext.jsx`:
    - Debounced flush (`scheduleCloudFlush`) upserts dirty lists (`pendingListUpsertsRef`) into `user_lists` (ignoring missing-table codes gracefully).
    - `syncVaultWithCloud()` calls `pullAndSyncCloudLists()` alongside `pullAndSyncCloudVault()`.
    - `applyVaultImportSnapshot()` merges or replaces `customLists` cleanly and stamps `updatedAt`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/vaultSyncService.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add supabase/migrations/20261115000000_add_user_lists.sql src/services/vaultSyncService.js src/context/AppContext.jsx tests/vaultSyncService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(sync): add Supabase user_lists migration, sync service, and AppContext state" }`

---

### Task 4: `AddToListPopover.jsx`, `VaultListsPanel.jsx`, `VaultPage` & `MovieDetails` UI Wiring

**Files:**
- Create: `src/components/AddToListPopover.jsx`
- Create: `src/components/VaultListsPanel.jsx`
- Modify: `src/components/VaultBanner.jsx`
- Modify: `src/pages/VaultPage.jsx`
- Modify: `src/components/MovieDetails.jsx`
- Modify: `src/styles/vault.css`
- Modify: `src/index.css`

- [ ] **Step 1: Build `AddToListPopover.jsx` (Reusable Quick-Save Menu)**
  - Accepts `movie`, renders crisp `+ Save to List` (`ListPlus` icon) button showing active badge count if in `>= 1` list.
  - Dropdown popover (`z-index: var(--z-menu)`) displays checkboxes for every active custom list (`getListsContainingMovie`) with live toggle (`toggleMovieInListAction`), click-outside close, `Escape` key handler (`e.stopPropagation()` so parent modals/details don't close!), AND an inline `"+ Create list..."` form directly inside the menu that creates the list and immediately adds `movie`!
  - Mount cleanly in `MovieDetails.jsx` hero/left action deck.

- [ ] **Step 2: Build `VaultListsPanel.jsx` & Expand `VaultBanner.jsx` + `VaultPage.jsx`**
  - Update `VaultBanner.jsx` `<Tabs>` to render 4 clean tabs:
    - `watched` (`Watched`)
    - `watchlist` (`Watchlist`)
    - `lists` (`Lists`, `count: customLists.length`)
    - `checklists` (`Checklists`, `count: CANON_CHECKLISTS.length`)
  - In `VaultPage.jsx`: sync `tab` URL param cleanly across all 4 tabs (`watched | watchlist | lists | checklists`) plus `?list=<listId>` detail drill-down.
  - Inside `VaultListsPanel.jsx`:
    - **`lists` view**: Header with `"New Research List"` modal/inline creator (name + description), cards showing 4-poster mosaic preview, watched completion progress (`X / Y seen`), film count, rename/delete controls, `"Compare Top Picks"` shortcut (`<= 3` items -> `/compare`), and detailed grid view when a list is selected (with remove-from-list + click -> `/movie/:id`).
    - **`checklists` view**: Renders `CANON_CHECKLISTS` pack overview cards (`0%–100%` progress ring/bar via `computeChecklistProgress`) -> expanding/selecting a pack displays numbered canonical table/grid with `[✓] Watched ★` / `"In Watchlist"` status, `All / Remaining / Watched` filter toggle, 1-click `+ Watchlist` on unseen entries, `"Clone as Editable List"` action, and smart navigation (reserving `/movie/tmdb_<id>` when known or calling `findTmdbByTitleAndYear(item.title, item.year)` -> `/movie/tmdb_<id>` cleanly!).

- [ ] **Step 3: Style Popover, Lists Grid, Checklists Progress Bars & Mobile Layout**
  - Add `.add-to-list-popover`, `.vault-lists-grid`, `.list-collage-thumb`, `.checklist-progress-bar`, `.checklist-row-item` cleanly in `src/styles/vault.css` and `src/index.css` strictly honoring `tokens.css` variables.

- [ ] **Step 4: Run Full Project Test Suite & Final Production Build**
  Run: `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
  Expected: All unit suites pass (`0` failures); Vite builds cleanly.

- [ ] **Step 5: Commit & Verify Live Flows**
  `git add src/components/AddToListPopover.jsx src/components/VaultListsPanel.jsx src/components/VaultBanner.jsx src/pages/VaultPage.jsx src/components/MovieDetails.jsx src/styles/vault.css src/index.css; if ($LASTEXITCODE -eq 0) { git commit -m "feat(lists): add custom lists UI, canon checklists, and AddToListPopover across Vault & MovieDetails" }`
