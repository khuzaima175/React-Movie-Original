import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_PURGE_ORDER, safeSetStorageItem } from "../src/services/storageEviction.js";

test("STORAGE_PURGE_ORDER includes home feeds and working model caches ahead of critical failure", () => {
  const required = [
    "cinemavault_smart_cache_v4",
    "cinemavault_smart_cache_v3",
    "cinemavault_home_feeds_v2",
    "cinemavault_working_model_curation_v1",
    "cinemavault_working_model_fast_v1",
    "cinemavault_explanations_v1",
    "cinemavault_recs_model_v1",
    "cinemavault_recs_v1",
    "cinemavault_recs_hash_v1",
    "cinemavault_feedback_v1"
  ];

  for (const key of required) {
    assert.ok(STORAGE_PURGE_ORDER.includes(key), `Expected ${key} in STORAGE_PURGE_ORDER`);
  }
});

test("safeSetStorageItem evicts cinemavault_home_feeds_v2 and recovers on QuotaExceededError", () => {
  const store = new Map([
    ["cinemavault_home_feeds_v2", "x".repeat(5000)],
    ["watchedMovies", JSON.stringify([{ imdbID: "tt1", title: "Heat", userRating: 9 }])]
  ]);
  const removed = [];

  const mockStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    removeItem: (k) => {
      removed.push(k);
      store.delete(k);
    },
    setItem: (k, v) => {
      // Simulate quota exceeded until home feeds cache is evicted
      if (store.has("cinemavault_home_feeds_v2")) {
        const err = new Error("Quota exceeded");
        err.name = "QuotaExceededError";
        throw err;
      }
      store.set(k, String(v));
    }
  };

  const ok = safeSetStorageItem("watchlist", [{ imdbID: "tt2", title: "Thief" }], {
    storage: mockStorage,
    logger: { warn() {}, log() {}, error() {} }
  });

  assert.equal(ok, true);
  assert.ok(removed.includes("cinemavault_home_feeds_v2"));
  assert.equal(store.has("cinemavault_home_feeds_v2"), false);
  assert.ok(store.get("watchlist").includes("Thief"));
});
