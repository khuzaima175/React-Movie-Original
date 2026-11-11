import test from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd, createSpendTracker } from "../src/services/aiSpendTracker.js";

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const usage = { promptTokenCount: 1_000_000, candidatesTokenCount: 500_000, thoughtsTokenCount: 500_000 };

test("argon intro price counts thinking tokens as output", () => {
  // 1M in * $2 + (0.5M+0.5M) out * $10 = 12
  assert.equal(estimateCostUsd("gemini-4-argon", usage, new Date("2026-11-20T00:00:00Z")), 12);
});

test("argon price doubles after Nov 30", () => {
  assert.equal(estimateCostUsd("gemini-4-argon", usage, new Date("2026-12-01T12:00:00Z")), 24);
});

test("flash pricing and missing usage", () => {
  assert.equal(estimateCostUsd("gemini-3.8-flash", usage), 0.75 + 3.75);
  assert.equal(estimateCostUsd("gemini-4-argon", undefined), 0);
});

test("cap blocks argon once reached and persists", () => {
  const storage = mem();
  const t = createSpendTracker({ storage, capUsd: 6, now: () => new Date("2026-11-20T00:00:00Z") });
  assert.equal(t.canUseArgon(), true);
  t.record("gemini-4-argon", { promptTokenCount: 1_000_000, candidatesTokenCount: 400_000 }); // 6.00
  assert.equal(t.canUseArgon(), false);
  const t2 = createSpendTracker({ storage, capUsd: 6 });
  assert.equal(t2.canUseArgon(), false);
  assert.equal(t2.spent(), 6);
});

test("403/429 marks argon unavailable for the session only", () => {
  const storage = mem();
  const t = createSpendTracker({ storage });
  t.markArgonUnavailable();
  assert.equal(t.canUseArgon(), false);
  assert.equal(createSpendTracker({ storage }).canUseArgon(), true);
});
