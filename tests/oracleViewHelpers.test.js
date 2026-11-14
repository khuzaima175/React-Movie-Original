import test from "node:test";
import assert from "node:assert/strict";
import { AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS } from "../src/services/tmdbService.js";
import {
  formatStreamingSummary,
  formatRecBadgeSummary,
  resolveRecommendationAnchors,
  sanitizeOracleReason,
  formatActiveVibeNote,
  nextRefreshExcludeState,
  shouldAutoRefreshOnDrawerClose
} from "../src/services/oracleViewHelpers.js";

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

test("resolveRecommendationAnchors prioritizes explicit IDs/titles, prose mentions, then genre-aligned fallback", () => {
  const watched = [
    { imdbID: "tt0133093", title: "The Matrix", year: "1999", genre: "Action, Sci-Fi", userRating: 10, poster: "/m.jpg" },
    { imdbID: "tt0468569", title: "The Dark Knight", year: "2008", genre: "Action, Crime, Drama", userRating: 9, poster: "/dk.jpg" },
    { imdbID: "tt1375666", title: "Inception", year: "2010", genre: "Action, Sci-Fi, Thriller", userRating: 9, poster: "/inc.jpg" },
    { imdbID: "tt0110912", title: "Pulp Fiction", year: "1994", genre: "Crime, Drama", userRating: 6, poster: "/pf.jpg" }
  ];

  const anchors = resolveRecommendationAnchors(
    {
      genre: "Sci-Fi, Action",
      anchorIds: ["tt0133093"],
      anchorTitles: ["The Matrix"],
      reason: "Shares the grounded kinetic stakes you enjoyed in The Dark Knight."
    },
    watched,
    3
  );

  assert.deepEqual(
    anchors.map((a) => a.title),
    ["The Matrix", "The Dark Knight", "Inception"]
  );
  assert.equal(anchors.some((a) => a.title === "Pulp Fiction"), false);
});

test("resolveRecommendationAnchors returns empty array when inputs are empty", () => {
  assert.deepEqual(resolveRecommendationAnchors(null, []), []);
  assert.deepEqual(resolveRecommendationAnchors({ title: "Dune" }, []), []);
});

test("sanitizeOracleReason strips legacy taste-twin and bullseye buzzwords cleanly", () => {
  assert.equal(
    sanitizeOracleReason(
      "Written and produced by the Wachowskis and earning a High Taste-Twin Match, Core Theme Match, and Genre Bullseye, this dystopian thriller fuses rebellion with masked grit."
    ),
    "Written and produced by the Wachowskis, this dystopian thriller fuses rebellion with masked grit."
  );

  assert.equal(
    sanitizeOracleReason(
      "A 98% High Taste-Twin Match that channels the razor-sharp dialogue of Fight Club into a visceral quest."
    ),
    "Channels the razor-sharp dialogue of Fight Club into a visceral quest."
  );

  assert.equal(
    sanitizeOracleReason("Taut sci-fi neo-noir with kinetic chase choreography."),
    "Taut sci-fi neo-noir with kinetic chase choreography."
  );
});

test("formatActiveVibeNote summarizes mood preset, genres, era bounds, and excluded elements", () => {
  assert.equal(formatActiveVibeNote(null), "");

  const note = formatActiveVibeNote({
    moodId: "comfort-watch",
    withGenres: ["Comedy", "Animation"],
    withoutKeywords: ["horror", "gore"],
    maxYear: 2000
  });
  assert.match(note, /Comfort Watch/);
  assert.match(note, /Comedy, Animation/);
  assert.match(note, /Through 2000|Before 2000|<= 2000|–2000/i);
  assert.match(note, /Avoiding: horror, gore/i);

  const rangeNote = formatActiveVibeNote({
    moodId: "any",
    withGenres: ["Sci-Fi"],
    minYear: 1990,
    maxYear: 1999
  });
  assert.match(rangeNote, /Sci-Fi/);
  assert.match(rangeNote, /1990–1999/);
});

test("nextRefreshExcludeState accumulates shown IDs up to 120, cycles TMDB pages 1..5, and resets cleanly", () => {
  const recBatch1 = [{ tmdbId: 10 }, { id: 20 }, { imdbID: "tt0030" }];
  const s1 = nextRefreshExcludeState({ seenIds: [], page: 1 }, recBatch1, true);
  assert.deepEqual(s1.seenIds, ["10", "20", "tt0030"]);
  assert.deepEqual(s1.excludeIds, ["10", "20", "tt0030"]);
  assert.equal(s1.page, 2);

  // Cycles pages 2 -> 3 -> 4 -> 5 -> 1
  const s5 = nextRefreshExcludeState({ seenIds: ["10"], page: 5 }, [{ tmdbId: 99 }], true);
  assert.equal(s5.page, 1);
  assert.deepEqual(s5.seenIds, ["10", "99"]);

  // Caps accumulation at 120 unique IDs
  const existing118 = Array.from({ length: 118 }, (_, i) => `old_${i}`);
  const batch5 = Array.from({ length: 5 }, (_, i) => ({ tmdbId: `new_${i}` }));
  const capped = nextRefreshExcludeState({ seenIds: existing118, page: 1 }, batch5, true);
  assert.equal(capped.seenIds.length, 120);
  assert.ok(capped.seenIds.includes("new_4"));

  // Resets when forceRefresh is false
  const reset = nextRefreshExcludeState(capped, batch5, false);
  assert.deepEqual(reset, { seenIds: [], excludeIds: [], page: 1 });
});

test("shouldAutoRefreshOnDrawerClose refreshes only when closing drawer with stale hash while idle", () => {
  assert.equal(shouldAutoRefreshOnDrawerClose(true, "hash_new", "hash_old", false), true);
  assert.equal(shouldAutoRefreshOnDrawerClose(true, "hash_same", "hash_same", false), false);
  assert.equal(shouldAutoRefreshOnDrawerClose(true, "hash_new", "", false), false);
  assert.equal(shouldAutoRefreshOnDrawerClose(true, "", "hash_old", false), false);
  assert.equal(shouldAutoRefreshOnDrawerClose(true, "hash_new", "hash_old", true), false);
  assert.equal(shouldAutoRefreshOnDrawerClose(false, "hash_new", "hash_old", false), false);
});

test("formatRecBadgeSummary formats hydrationCoverage when present and returns null hydrationLabel otherwise", () => {
  const withoutCov = formatRecBadgeSummary({ model: "gemini-4-hydrogen", pipeline: "gemini-curation" }, false);
  assert.equal(withoutCov.hydrationLabel, null);

  const withCov = formatRecBadgeSummary(
    {
      model: "gemini-4-hydrogen",
      pipeline: "gemini-curation",
      hydrationCoverage: { hydrated: 78, total: 80, ratio: 0.975, percent: 98 }
    },
    false
  );
  assert.equal(withCov.hydrationLabel, "78/80 films hydrated (98%)");
  assert.match(withCov.tooltip, /Metadata: 78\/80 films hydrated \(98%\)/);
});
