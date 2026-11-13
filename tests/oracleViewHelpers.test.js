import test from "node:test";
import assert from "node:assert/strict";
import { AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS } from "../src/services/tmdbService.js";
import { formatStreamingSummary } from "../src/services/oracleViewHelpers.js";

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
