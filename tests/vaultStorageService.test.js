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
    async get(k) {
      return map.get(k);
    },
    async set(k, v) {
      if (failWrite) throw new Error("IDB write failed");
      map.set(k, v);
    },
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
  assert.equal(idb._map.get("watchlist").length, 1);
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
  const saved = await saveVaultSlice(
    "watchedMovies",
    [{ imdbID: "tt0111161", title: "Shawshank" }],
    {
      storage: ls,
      idbAdapter: null,
      indexedDB: null
    }
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.backend, "localStorage");
  assert.ok(ls.getItem("watchedMovies").includes("Shawshank"));
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
