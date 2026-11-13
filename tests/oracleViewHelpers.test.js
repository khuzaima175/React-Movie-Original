import test from "node:test";
import assert from "node:assert/strict";
import { AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS } from "../src/services/tmdbService.js";
import { formatStreamingSummary, formatRecBadgeSummary } from "../src/services/oracleViewHelpers.js";

test("formatStreamingSummary returns default summary with no custom filter for GLOBAL and empty providers", () => {
  const result = formatStreamingSummary("GLOBAL", [], AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS);
  assert.deepEqual(result, {
    summaryText: "All Regions • Any Platform",
    hasCustomFilter: false
  });
});

test("formatStreamingSummary names 1-2 selected providers alongside region name", () => {
  const result = formatStreamingSummary("US", [8, 1899], AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS);
  assert.deepEqual(result, {
    summaryText: "United States • Netflix, Max (HBO)",
    hasCustomFilter: true
  });
});

test("formatStreamingSummary summarizes 3+ selected providers as a count", () => {
  const result = formatStreamingSummary("GB", [8, 9, 337, 1899], AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS);
  assert.deepEqual(result, {
    summaryText: "United Kingdom • 4 streaming services",
    hasCustomFilter: true
  });
});

test("formatStreamingSummary marks region-only or provider-only selections as custom filters", () => {
  assert.deepEqual(formatStreamingSummary("US", [], AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS), {
    summaryText: "United States • Any Platform",
    hasCustomFilter: true
  });
  assert.deepEqual(formatStreamingSummary("GLOBAL", [8], AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS), {
    summaryText: "All Regions • Netflix",
    hasCustomFilter: true
  });
});

test("formatRecBadgeSummary returns Local Ranker and user-friendly freshness labels for keyless fallback", () => {
  const fresh = formatRecBadgeSummary({ model: null, pipeline: "local-ranker" }, false);
  assert.equal(fresh.modelLabel, "Local Ranker");
  assert.equal(fresh.freshnessLabel, "Fresh Picks");
  assert.equal(fresh.freshnessTone, "stale");
  assert.match(fresh.tooltip, /Offline Fallback|local-ranker/i);

  const cached = formatRecBadgeSummary(null, true);
  assert.equal(cached.modelLabel, "Local Ranker");
  assert.equal(cached.freshnessLabel, "Saved Picks");
  assert.equal(cached.freshnessTone, "cached");
});

test("formatRecBadgeSummary hides raw model slugs and LRU cache text from visible badges while preserving tooltip", () => {
  const summary = formatRecBadgeSummary(
    {
      model: "gemini-4-hydrogen",
      isFallback: false,
      pipeline: "gemini-curation",
      fromCache: true,
      usageMetadata: { totalTokenCount: 1420 },
      cooldownModels: [{ model: "gemini-3.5-flash-lite", reason: "429" }]
    },
    true
  );

  assert.equal(summary.modelLabel, "Gemini 4 Hydrogen");
  assert.equal(summary.freshnessLabel, "Saved Picks");
  assert.equal(summary.modelLabel.includes("gemini-4-hydrogen"), false);
  assert.equal(summary.freshnessLabel.includes("500KB"), false);
  assert.match(summary.tooltip, /gemini-4-hydrogen/);
  assert.match(summary.tooltip, /500KB LRU Cache/);
  assert.match(summary.tooltip, /1420/);
  assert.match(summary.tooltip, /gemini-3\.5-flash-lite \(429\)/);
});

test("formatRecBadgeSummary prefixes fallback models cleanly", () => {
  const summary = formatRecBadgeSummary(
    { model: "gemini-3.5-flash-lite", isFallback: true },
    false
  );
  assert.equal(summary.modelLabel, "Fallback: Gemini 3.5 Flash-Lite");
  assert.equal(summary.freshnessLabel, "Fresh Picks");
});
