import test from "node:test";
import assert from "node:assert/strict";
import {
  isPersonalEdition,
  syncDebugFlagFromSearch,
  isDebugUiEnabled
} from "../src/services/debugFlags.js";

test("isPersonalEdition defaults to false and returns true only for personal mode or edition", () => {
  assert.equal(isPersonalEdition({}), false);
  assert.equal(isPersonalEdition({ mode: "production", edition: "public" }), false);
  assert.equal(isPersonalEdition({ mode: "development" }), false);
  assert.equal(isPersonalEdition({ mode: "personal" }), true);
  assert.equal(isPersonalEdition({ edition: "personal" }), true);
});

test("isDebugUiEnabled respects search flags, sticky storage, and personal edition without throwing", () => {
  assert.equal(isDebugUiEnabled({}), false);
  assert.equal(isDebugUiEnabled({ search: "?debug=1" }), true);
  assert.equal(
    isDebugUiEnabled({ search: "?debug=0", storage: { getItem: () => "1" } }),
    false
  );
  assert.equal(isDebugUiEnabled({ storage: { getItem: () => "1" } }), true);
  assert.equal(isDebugUiEnabled({ personal: true }), true);
  assert.equal(
    isDebugUiEnabled({
      storage: {
        getItem() {
          throw new Error("storage blocked");
        }
      }
    }),
    false
  );
});

test("syncDebugFlagFromSearch persists debug=1, clears debug=0, ignores unrelated queries, and survives throwing storage", () => {
  const store = new Map();
  const mockStorage = {
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };

  assert.equal(syncDebugFlagFromSearch({ search: "?tab=chat", storage: mockStorage }), null);
  assert.equal(store.has("cv_debug_ui"), false);

  assert.equal(syncDebugFlagFromSearch({ search: "?debug=1", storage: mockStorage }), true);
  assert.equal(store.get("cv_debug_ui"), "1");

  assert.equal(syncDebugFlagFromSearch({ search: "?debug=0", storage: mockStorage }), false);
  assert.equal(store.has("cv_debug_ui"), false);

  const throwingStorage = {
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("blocked");
    }
  };
  assert.equal(syncDebugFlagFromSearch({ search: "?debug=1", storage: throwingStorage }), true);
  assert.equal(syncDebugFlagFromSearch({ search: "?debug=0", storage: throwingStorage }), false);
});
