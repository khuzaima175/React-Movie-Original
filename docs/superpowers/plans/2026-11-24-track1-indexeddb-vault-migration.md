# Track 1: IndexedDB Vault Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate primary `watchedMovies` and `watchlist` persistence from 5 MB synchronous `localStorage` into a dedicated IndexedDB store (`cinemavault_vault_v1`) with lossless one-time migration and private-browsing fallback.

**Architecture:** Introduce a pure, dependency-free `src/services/vaultStorageService.js` matching the injection-friendly IndexedDB pattern in `src/services/exploreForYouCache.js`. On startup, `AppContext.jsx` migrates legacy `localStorage` vault arrays once into IndexedDB, frees the `localStorage` quota, and persists subsequent vault updates asynchronously with debounced writes and graceful fallback when IDB is unavailable.

**Tech Stack:** React 18, Browser IndexedDB API (zero new deps), Node native test runner (`node --test`).

**Spec:** [docs/superpowers/specs/2026-11-24-weekly-product-roadmap-design.md](../specs/2026-11-24-weekly-product-roadmap-design.md)

## Global Constraints
- Zero new npm dependencies; use native IndexedDB with injectable `indexedDB` / `storage` options for deterministic `node --test` unit tests.
- Lossless migration: never delete legacy `localStorage` keys (`watchedMovies`, `watchlist`) until the IndexedDB `tx.oncomplete` has committed and verified row counts match.
- Guest mode and private browsing (where `indexedDB.open` throws or rejects) must transparently fall back to `safeSetStorageItem` + in-memory state with zero uncaught errors.
- No compaction/truncation of `overview`, `cast`, or `streamProviders` when writing to IndexedDB (retaining full enriched movie objects for 10,000+ film vaults).

## Review Focus
1. **Crash mid-migration:** If the browser closes between reading `localStorage` and committing IDB, the next reload must re-read legacy `localStorage` cleanly without losing a single item.
2. **Race between hydration and user mutation:** If a user adds a rating before async IDB hydration finishes, hydration must merge rather than overwrite the new mutation.
3. **Private browsing / missing IDB:** When `indexedDB` is `undefined` or throws `SecurityError`, reads/writes must succeed via `localStorage`/memory fallback without crashing `AppProvider`.
4. **Empty migrated vault vs. unmigrated vault:** A user who legitimately clears their vault (`0` films) after migration must stay at `0` films and not re-import stale legacy keys.
5. **Large vault scale (5,000+ films):** Writing 5,000 full movie objects to IDB must not invoke `compactVaultListForStorage` aggressive field stripping or dispatch `storage-critical-error`.

---

### Task 1: Pure `vaultStorageService.js` — IDB Store, Migration & Fallback

**Files:**
- Create: `src/services/vaultStorageService.js`
- Test: `tests/vaultStorageService.test.js`

**Interfaces:**
- Consumes: `safeSetStorageItem` from `src/services/storageEviction.js`
- Produces:
  ```js
  export const VAULT_IDB_NAME = "cinemavault_vault_v1";
  export const VAULT_IDB_STORE = "kv";
  export const VAULT_MIGRATION_FLAG = "cinemavault_vault_idb_migrated_v1";

  export async function loadVaultFromStorage(options = {})
  // returns { watched: Array, watchlist: Array, source: "idb" | "migrated" | "localStorage" | "memory" }

  export async function saveVaultSlice(key, items, options = {})
  // key: "watchedMovies" | "watchlist" | "customLists"
  // returns { ok: boolean, backend: "idb" | "localStorage" | "memory" }

  export function mergeHydratedVaultSlice(currentItems = [], hydratedItems = [], dirtyBeforeHydration = false)
  // preserves mutations made before async IDB hydration resolves
  ```

- [ ] **Step 1: Write the failing tests in `tests/vaultStorageService.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  VAULT_MIGRATION_FLAG,
  loadVaultFromStorage,
  saveVaultSlice,
  mergeHydratedVaultSlice
} from "../src/services/vaultStorageService.js";

function createFakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

function createFakeIdbStore(initial = {}, { failWrite = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(k) { return map.get(k); },
    async set(k, v) { if (failWrite) throw new Error("IDB write failed"); map.set(k, v); },
    _map: map
  };
}

test("migrates legacy localStorage vault into IDB and frees legacy keys only after verified commit", async () => {
  const ls = createFakeStore({
    watchedMovies: JSON.stringify([{ imdbID: "tt0133093", title: "The Matrix", userRating: 9 }]),
    watchlist: JSON.stringify([{ imdbID: "tt0816692", title: "Interstellar" }])
  });
  const idb = createFakeIdbStore();

  const res = await loadVaultFromStorage({ storage: ls, idbAdapter: idb });
  assert.equal(res.source, "migrated");
  assert.equal(res.watched.length, 1);
  assert.equal(res.watchlist.length, 1);
  assert.equal(ls.getItem(VAULT_MIGRATION_FLAG), "1");
  assert.equal(ls.getItem("watchedMovies"), null);
  assert.equal(ls.getItem("watchlist"), null);
  assert.equal(idb._map.get("watchedMovies").length, 1);
});

test("keeps legacy localStorage untouched when IDB commit fails mid-migration", async () => {
  const ls = createFakeStore({
    watchedMovies: JSON.stringify([{ imdbID: "tt0133093", title: "The Matrix", userRating: 9 }])
  });
  const idb = createFakeIdbStore({}, { failWrite: true });

  const res = await loadVaultFromStorage({ storage: ls, idbAdapter: idb });
  assert.equal(res.source, "localStorage");
  assert.equal(res.watched.length, 1);
  assert.equal(ls.getItem(VAULT_MIGRATION_FLAG), null);
  assert.ok(ls.getItem("watchedMovies"));
});

test("falls back cleanly to localStorage when IDB is unavailable", async () => {
  const ls = createFakeStore();
  const saved = await saveVaultSlice("watchedMovies", [{ imdbID: "tt0111161", title: "Shawshank" }], {
    storage: ls,
    idbAdapter: null,
    indexedDB: null
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.backend, "localStorage");
});

test("does not re-import legacy data once migrated user intentionally clears vault to empty", async () => {
  const ls = createFakeStore({ [VAULT_MIGRATION_FLAG]: "1" });
  const idb = createFakeIdbStore({ watchedMovies: [], watchlist: [] });
  const res = await loadVaultFromStorage({ storage: ls, idbAdapter: idb });
  assert.equal(res.source, "idb");
  assert.deepEqual(res.watched, []);
  assert.deepEqual(res.watchlist, []);
});

test("mergeHydratedVaultSlice preserves pre-hydration user mutations without duplicates", () => {
  const preHydration = [{ imdbID: "tt0133093", title: "The Matrix", userRating: 10 }];
  const hydrated = [
    { imdbID: "tt0133093", title: "The Matrix", userRating: 8 },
    { imdbID: "tt0816692", title: "Interstellar", userRating: 9 }
  ];
  const merged = mergeHydratedVaultSlice(preHydration, hydrated, true);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((m) => m.imdbID === "tt0133093").userRating, 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/vaultStorageService.test.js`  
Expected: FAIL (`Cannot find module '../src/services/vaultStorageService.js'`).

- [ ] **Step 3: Implement `src/services/vaultStorageService.js`**

Implement native IDB open/get/set wrapper (mirroring `openExploreDb` in `src/services/exploreForYouCache.js`), injectable `idbAdapter` for tests, lossless one-time migration verifying persisted counts before removing `watchedMovies` and `watchlist` from `localStorage` and setting `VAULT_MIGRATION_FLAG = "1"`, memory/localStorage fallback, and `mergeHydratedVaultSlice` using `isSameMovie` from `src/services/movieIdentity.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/vaultStorageService.test.js`  
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/vaultStorageService.js tests/vaultStorageService.test.js
git commit -m "feat(storage): add IndexedDB vault storage service with lossless migration"
```

---

### Task 2: Wire `AppContext.jsx` to IndexedDB Vault Persistence & Hydration Guard

**Files:**
- Modify: `src/context/AppContext.jsx:68-90` and `src/context/AppContext.jsx:268-282`
- Modify: `src/services/storageEviction.js:1-16`
- Test: `tests/vaultStorageIntegration.test.js`

**Interfaces:**
- Consumes: `loadVaultFromStorage`, `saveVaultSlice`, `mergeHydratedVaultSlice`, `VAULT_MIGRATION_FLAG` from `src/services/vaultStorageService.js`
- Produces: `isVaultHydrated` boolean exposed on `AppContext` value (`useApp()`) so onboarding modals (`TasteDeckModal`) wait for IDB hydration before auto-opening on an empty-looking state.

- [ ] **Step 1: Write failing test in `tests/vaultStorageIntegration.test.js`**

Pin two critical behaviors:
1. `shouldAutoShowTasteOnboarding` does not trigger before `isVaultHydrated === true`.
2. Saving a 5,000-item mock array via `saveVaultSlice` stores full `overview` (> 300 chars) and `cast` (> 6 items) untouched in IDB without invoking `localStorage` compaction.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/vaultStorageIntegration.test.js`  
Expected: FAIL.

- [ ] **Step 3: Update `AppContext.jsx` and `App.jsx` onboarding check**
- In `AppContext.jsx`:
  - Add `const [isVaultHydrated, setIsVaultHydrated] = useState(() => !hasIndexedDbOrMigrated())` and `dirtySlicesRef = useRef({ watched: false, watchlist: false })`.
  - On mount, run `loadVaultFromStorage()`, merge via `mergeHydratedVaultSlice`, and mark `setIsVaultHydrated(true)`.
  - Replace `safeSetItem("watchedMovies", ...)` / `safeSetItem("watchlist", ...)` in the two `useEffect`s (lines 270–277) with debounced `saveVaultSlice("watchedMovies", ...)` / `saveVaultSlice("watchlist", ...)` (skipping the initial pre-hydration render so empty default state never wipes IDB!).
  - Expose `isVaultHydrated` in context value.
- In `src/App.jsx:86-98`: Gate the `shouldAutoShowTasteOnboarding` effect on `if (!isVaultHydrated || didCheckOnboardingRef.current) return;`.

- [ ] **Step 4: Run full test suite and build check**

Run: `node --test tests/vaultStorageService.test.js tests/vaultStorageIntegration.test.js && npm test`  
Expected: All existing and new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context/AppContext.jsx src/App.jsx src/services/storageEviction.js tests/vaultStorageIntegration.test.js
git commit -m "feat(vault): migrate watched and watchlist persistence to IndexedDB"
```
