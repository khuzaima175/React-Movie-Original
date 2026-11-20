import test from "node:test";
import assert from "node:assert/strict";
import { AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS } from "../src/services/tmdbService.js";
import {
  formatStreamingSummary,
  formatRecBadgeSummary,
  buildOracleLoadingSteps,
  describePipelineNotice,
  selectStudioBackdropPoster,
  resolveRecommendationAnchors,
  sanitizeOracleReason,
  formatActiveVibeNote,
  nextRefreshExcludeState,
  shouldAutoRefreshOnDrawerClose,
  summarizeOraclePreferences,
  ORACLE_TONIGHT_PRESETS,
  splitOracleSpotlightAndGrid,
  rankWatchlistForTonight
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
  const fresh = formatRecBadgeSummary({ model: null, pipeline: "local-ranker" }, false, null, { debug: true });
  assert.equal(fresh.modelLabel, "Local Ranker");
  assert.equal(fresh.freshnessLabel, "Fresh Picks");
  assert.equal(fresh.freshnessTone, "stale");
  assert.match(fresh.tooltip, /Offline Fallback|local-ranker/i);

  const cached = formatRecBadgeSummary(null, true, null, { debug: true });
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
    true,
    null,
    { debug: true }
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
    false,
    null,
    { debug: true }
  );
  assert.equal(summary.modelLabel, "Fallback: Gemini 3.5 Flash-Lite");
  assert.equal(summary.freshnessLabel, "Fresh Picks");
});

test("formatRecBadgeSummary default mode never leaks model slugs, token counts or cache jargon", () => {
  const summary = formatRecBadgeSummary(
    {
      model: "gemini-4-hydrogen",
      isFallback: true,
      pipeline: "gemini-curation",
      fromCache: true,
      usageMetadata: { totalTokenCount: 1420 },
      cooldownModels: [{ model: "gemini-3.5-flash-lite", reason: "429" }]
    },
    true
  );

  assert.equal(summary.modelLabel, "AI Curated");
  assert.equal(summary.freshnessLabel, "Saved Picks");
  assert.equal(/gemini|\d{4}|429|500KB/i.test(summary.modelLabel + " " + summary.tooltip), false);
});

test("formatRecBadgeSummary default mode without a model labels On-Device Engine", () => {
  const summary = formatRecBadgeSummary({ model: null, pipeline: "ranker-fallback" }, false);
  assert.equal(summary.modelLabel, "On-Device Engine");
  assert.match(summary.tooltip, /Ranked on-device from your taste profile/);
});

test("buildOracleLoadingSteps switches final step copy by debug mode and queued model", () => {
  const publicAiSteps = buildOracleLoadingSteps({ watchedCount: 12, queuedModel: "gemini-3.5-flash-lite" });
  assert.equal(publicAiSteps.length, 4);
  assert.equal(publicAiSteps[3], "Curating your final 10 picks...");

  const offlineSteps = buildOracleLoadingSteps({ watchedCount: 2, queuedModel: null });
  assert.equal(offlineSteps[3], "Ranking your final picks on-device...");

  const debugSteps = buildOracleLoadingSteps({
    watchedCount: 12,
    queuedModel: "gemini-4-hydrogen",
    debug: true
  });
  assert.equal(debugSteps[3], "Curating final picks via Gemini 4 Hydrogen...");
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
  const withoutCov = formatRecBadgeSummary({ model: "gemini-4-hydrogen", pipeline: "gemini-curation" }, false, null, { debug: true });
  assert.equal(withoutCov.hydrationLabel, null);

  const withCov = formatRecBadgeSummary(
    {
      model: "gemini-4-hydrogen",
      pipeline: "gemini-curation",
      hydrationCoverage: { hydrated: 78, total: 80, ratio: 0.975, percent: 98 }
    },
    false,
    null,
    { debug: true }
  );
  assert.equal(withCov.hydrationLabel, "78/80 films hydrated (98%)");
  assert.match(withCov.tooltip, /Metadata: 78\/80 films hydrated \(98%\)/);
});

test("describePipelineNotice explains capacity fallback only when pipeline is ranker-fallback", () => {
  assert.equal(
    describePipelineNotice({ pipeline: "ranker-fallback", model: null }),
    "Shared AI curation is at capacity, so these picks come from your on-device taste model."
  );
  assert.equal(describePipelineNotice({ pipeline: "gemini-curation", model: "gemini-3.5-flash-lite" }), null);
  assert.equal(describePipelineNotice(null), null);
});

test("selectStudioBackdropPoster returns highest-rated film poster ignoring N/A posters", () => {
  const watched = [
    { imdbID: "tt1", title: "Top No Poster", userRating: 10, dateWatched: "2026-11-10T00:00:00Z", poster: "N/A" },
    { imdbID: "tt2", title: "Older Nine", userRating: 9, dateWatched: "2025-01-01T00:00:00Z", poster: "https://img/older9.jpg" },
    { imdbID: "tt3", title: "Newer Nine", userRating: 9, dateWatched: "2026-11-01T00:00:00Z", poster: "https://img/newer9.jpg" },
    { imdbID: "tt4", title: "Eight", userRating: 8, dateWatched: "2026-11-12T00:00:00Z", poster: "https://img/eight.jpg" }
  ];
  assert.equal(selectStudioBackdropPoster(watched), "https://img/newer9.jpg");
});

test("selectStudioBackdropPoster returns null for empty or posterless watched arrays", () => {
  assert.equal(selectStudioBackdropPoster([]), null);
  assert.equal(selectStudioBackdropPoster(null), null);
  assert.equal(
    selectStudioBackdropPoster([{ imdbID: "tt1", userRating: 10, poster: "N/A" }]),
    null
  );
});


test("summarizeOraclePreferences returns default label and zero badge when no filters or rules are active", () => {
  const result = summarizeOraclePreferences({
    userRegion: "GLOBAL",
    userWatchProviders: [],
    tasteRules: [{ id: "r1", text: "Paused rule", polarity: "avoid", active: false }],
    usingOwnKey: false
  });
  assert.deepEqual(result, {
    badgeCount: 0,
    summaryText: "Filters & Rules"
  });
});

test("summarizeOraclePreferences counts active region, streaming platforms, active rules, and personal key without emojis or model slugs", () => {
  const result = summarizeOraclePreferences({
    userRegion: "US",
    userWatchProviders: [8, 1899],
    tasteRules: [
      { id: "r1", text: "No horror", polarity: "avoid", active: true },
      { id: "r2", text: "Paused", polarity: "prefer", active: false }
    ],
    usingOwnKey: false
  });

  assert.equal(result.badgeCount, 3);
  assert.equal(result.summaryText, "US · 2 platforms · 1 rule");
  assert.equal(/gemini-/i.test(result.summaryText), false);
  assert.equal(/\p{Extended_Pictographic}/u.test(result.summaryText), false);

  const withKey = summarizeOraclePreferences({
    userRegion: "GLOBAL",
    userWatchProviders: [8],
    tasteRules: [
      { id: "r1", text: "Prefer noir", polarity: "prefer", active: true },
      { id: "r2", text: "Avoid musicals", polarity: "avoid", active: true }
    ],
    usingOwnKey: true
  });
  assert.equal(withKey.badgeCount, 4);
  assert.equal(withKey.summaryText, "1 platform · 2 rules · Personal key");
});

test("ORACLE_TONIGHT_PRESETS provides 4 emoji-free starter scenarios including instant Watchlist chooser", () => {
  assert.equal(ORACLE_TONIGHT_PRESETS.length, 4);
  for (const preset of ORACLE_TONIGHT_PRESETS) {
    assert.ok(preset.id && preset.title && preset.subtitle);
    assert.ok(preset.actionType === "curate" || preset.actionType === "watchlist");
    assert.equal(/\p{Extended_Pictographic}/u.test(`${preset.title} ${preset.subtitle}`), false);
  }
  assert.ok(ORACLE_TONIGHT_PRESETS.some((p) => p.actionType === "watchlist"));
});

test("splitOracleSpotlightAndGrid isolates Pick #1 as spotlight and Picks #2..N as gridPicks", () => {
  assert.deepEqual(splitOracleSpotlightAndGrid([]), { spotlight: null, gridPicks: [] });
  const split = splitOracleSpotlightAndGrid([{ title: "A" }, { title: "B" }, { title: "C" }]);
  assert.equal(split.spotlight.title, "A");
  assert.deepEqual(split.gridPicks.map((p) => p.title), ["B", "C"]);
});

test("rankWatchlistForTonight ranks unseen watchlist items by on-device taste match and excludes already watched", () => {
  const watched = [
    { tmdbId: 10, title: "Inception", userRating: 10, genre: "Sci-Fi, Thriller", director: "Christopher Nolan", tmdbGenreIds: [878, 53] },
    { tmdbId: 11, title: "Interstellar", userRating: 9, genre: "Sci-Fi, Drama", director: "Christopher Nolan", tmdbGenreIds: [878, 18] },
    { tmdbId: 12, title: "Slasher X", userRating: 3, genre: "Horror", director: "Other", tmdbGenreIds: [27] }
  ];
  const watchlist = [
    { tmdbId: 10, title: "Inception", genre: "Sci-Fi" }, // already watched -> excluded
    { tmdbId: 201, title: "Dunkirk", genre: "Drama, Sci-Fi", director: "Christopher Nolan", vote_average: 7.9, vote_count: 15000, tmdbGenreIds: [18, 878] },
    { tmdbId: 202, title: "Generic Slasher", genre: "Horror", director: "Random", vote_average: 5.2, vote_count: 200, tmdbGenreIds: [27] }
  ];

  const ranked = rankWatchlistForTonight({ watchlist, watched, limit: 5 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].title, "Dunkirk");
  assert.ok(ranked[0].matchPct > ranked[1].matchPct);
  assert.ok(ranked[0].predictedRating > 0);
});


test("formatActiveVibeNote gracefully falls back to MOOD_OPTIONS when moodOptions arg is non-array", () => {
  const note = formatActiveVibeNote({ moodId: "dark-thriller", withGenres: ["Thriller"] }, "not-an-array");
  assert.match(note, /Dark Thriller/);
});
