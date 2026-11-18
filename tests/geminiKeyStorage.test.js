import test from "node:test";
import assert from "node:assert/strict";
import {
  USER_GEMINI_KEY_STORAGE,
  getUserGeminiKey,
  setUserGeminiKey,
  hasUserGeminiKey,
  resolveGeminiKey
} from "../src/services/apiTransport.js";

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

test("setUserGeminiKey trims and saves; empty string removes key", () => {
  const storage = createMemoryStorage();
  assert.equal(hasUserGeminiKey(storage), false);

  const saved = setUserGeminiKey("  user-gemini-test-key-123  ", storage);
  assert.equal(saved, "user-gemini-test-key-123");
  assert.equal(storage.getItem(USER_GEMINI_KEY_STORAGE), "user-gemini-test-key-123");
  assert.equal(hasUserGeminiKey(storage), true);

  const cleared = setUserGeminiKey("   ", storage);
  assert.equal(cleared, "");
  assert.equal(storage.getItem(USER_GEMINI_KEY_STORAGE), null);
  assert.equal(hasUserGeminiKey(storage), false);
});

test("resolveGeminiKey prefers stored user key over VITE_GEMINI_KEY", () => {
  const storage = createMemoryStorage();
  setUserGeminiKey("user-override-key", storage);

  assert.equal(
    resolveGeminiKey({ storage, env: { VITE_GEMINI_KEY: "env-dev-key" } }),
    "user-override-key"
  );

  setUserGeminiKey("", storage);
  assert.equal(
    resolveGeminiKey({ storage, env: { VITE_GEMINI_KEY: "env-dev-key" } }),
    "env-dev-key"
  );
});

test("getUserGeminiKey returns empty string if storage throws", () => {
  const throwingStorage = {
    getItem() {
      throw new Error("storage disabled");
    }
  };
  assert.equal(getUserGeminiKey(throwingStorage), "");
  assert.equal(hasUserGeminiKey(throwingStorage), false);
});

test("clear/empty user key falls back cleanly without side effects", () => {
  const storage = createMemoryStorage();
  setUserGeminiKey("temporary-key", storage);
  setUserGeminiKey("", storage);
  assert.equal(getUserGeminiKey(storage), "");
  assert.equal(resolveGeminiKey({ storage, env: {} }), "");
});
