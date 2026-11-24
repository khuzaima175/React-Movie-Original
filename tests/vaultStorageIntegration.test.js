import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoShowTasteOnboarding } from "../src/services/tasteDeckService.js";
import { saveVaultSlice } from "../src/services/vaultStorageService.js";

test("shouldAutoShowTasteOnboarding waits until IDB vault hydration completes", () => {
  assert.equal(
    shouldAutoShowTasteOnboarding({ watchedCount: 0, dismissedFlag: null, isVaultHydrated: false }),
    false
  );
  assert.equal(
    shouldAutoShowTasteOnboarding({ watchedCount: 0, dismissedFlag: null, isVaultHydrated: true }),
    true
  );
  assert.equal(
    shouldAutoShowTasteOnboarding({ watchedCount: 3, dismissedFlag: null, isVaultHydrated: true }),
    false
  );
});

test("saveVaultSlice stores 5,000 full movie objects in IDB without compaction or truncation", async () => {
  const longOverview = "A".repeat(420);
  const fullCast = ["Actor 1", "Actor 2", "Actor 3", "Actor 4", "Actor 5", "Actor 6", "Actor 7", "Actor 8"];
  const bigVault = Array.from({ length: 5000 }, (_, i) => ({
    imdbID: `tt${String(1000000 + i)}`,
    tmdbId: 1000 + i,
    title: `Film ${i}`,
    year: "2020",
    userRating: 8,
    overview: longOverview,
    cast: fullCast
  }));

  const stored = new Map();
  const fakeIdb = {
    async get(k) {
      return stored.get(k);
    },
    async set(k, v) {
      stored.set(k, v);
    }
  };
  const fakeLs = {
    getItem: () => null,
    setItem: () => {
      throw new Error("localStorage should not be used when IDB succeeds");
    }
  };

  const res = await saveVaultSlice("watchedMovies", bigVault, {
    idbAdapter: fakeIdb,
    storage: fakeLs
  });
  assert.equal(res.ok, true);
  assert.equal(res.backend, "idb");
  const persisted = stored.get("watchedMovies");
  assert.equal(persisted.length, 5000);
  assert.equal(persisted[4999].overview.length, 420);
  assert.equal(persisted[4999].cast.length, 8);
});
