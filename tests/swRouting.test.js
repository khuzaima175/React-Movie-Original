import test from "node:test";
import assert from "node:assert/strict";
import { classifySwRequest } from "../src/services/swRegistration.js";

test("classifySwRequest bypasses /api/*, Supabase REST/auth, and non-GET requests", () => {
  assert.equal(classifySwRequest("https://cinemavault.app/api/tmdb?path=movie/1", "GET"), "bypass");
  assert.equal(classifySwRequest("https://xyz.supabase.co/rest/v1/user_vault_items", "GET"), "bypass");
  assert.equal(classifySwRequest("https://cinemavault.app/models/item_ease_k64.cvea", "POST"), "bypass");
});

test("classifySwRequest uses cache-first for /models/*, /assets/*, and /icons/*", () => {
  assert.equal(
    classifySwRequest("https://cinemavault.app/models/item_ease_k64.cvea", "GET"),
    "cache-first-model"
  );
  assert.equal(
    classifySwRequest("https://cinemavault.app/models/ranker_weights.json", "GET"),
    "cache-first-model"
  );
  assert.equal(
    classifySwRequest("https://cinemavault.app/assets/index-abc123.js", "GET"),
    "cache-first-asset"
  );
  assert.equal(
    classifySwRequest("https://cinemavault.app/icons/icon-192.png", "GET"),
    "cache-first-asset"
  );
});

test("classifySwRequest uses network-first for navigation routes", () => {
  assert.equal(classifySwRequest("https://cinemavault.app/vault", "GET"), "network-first-nav");
  assert.equal(classifySwRequest("https://cinemavault.app/", "GET"), "network-first-nav");
});
