import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXPLORE_FILTERS,
  buildExploreRoute,
  buildExploreSearchParams,
  parseExploreSearchParams,
  buildTmdbDiscoverParams,
  filterExploreResults,
  getActiveFilterChips,
  deriveExploreViewState,
  mergeYearDraftIntoFilters
} from "../src/services/exploreService.js";

test("buildExploreRoute and parseExploreSearchParams round-trip complex multi-facet filters including special keyword characters", () => {
  const route = buildExploreRoute({
    genres: [878, 53],
    genreMode: "or",
    withoutGenres: [27],
    yearFrom: "2010",
    yearTo: "2024",
    runtimeMin: 90,
    runtimeMax: 150,
    minImdb: 7.5,
    minVotes: 500,
    language: "ko",
    country: "KR",
    keywords: [
      { id: 4344, name: "time loop" },
      { id: 9912, name: "father, son & sci-fi-2" }
    ],
    person: { id: 525, name: "Christopher Nolan" },
    providers: [8, 9],
    region: "GB",
    sortBy: "vote_average.desc",
    hideWatched: true,
    page: 3
  });

  assert.equal(/%2520/.test(route), false, "route query must not double-encode spaces as %2520");

  const parsed = parseExploreSearchParams(route.split("?")[1], "US");
  assert.deepEqual(parsed.genres, [878, 53]);
  assert.equal(parsed.genreMode, "or");
  assert.deepEqual(parsed.withoutGenres, [27]);
  assert.equal(parsed.yearFrom, "2010");
  assert.equal(parsed.yearTo, "2024");
  assert.equal(parsed.runtimeMin, 90);
  assert.equal(parsed.runtimeMax, 150);
  assert.equal(parsed.minImdb, 7.5);
  assert.equal(parsed.minVotes, 500);
  assert.equal(parsed.language, "ko");
  assert.equal(parsed.country, "KR");
  assert.deepEqual(parsed.keywords, [
    { id: 4344, name: "time loop" },
    { id: 9912, name: "father, son & sci-fi-2" }
  ]);
  assert.deepEqual(parsed.person, { id: 525, name: "Christopher Nolan" });
  assert.deepEqual(parsed.providers, [8, 9]);
  assert.equal(parsed.region, "GB");
  assert.equal(parsed.sortBy, "vote_average.desc");
  assert.equal(parsed.hideWatched, true);
  assert.equal(parsed.page, 3);
});

test("buildTmdbDiscoverParams enforces vote floor on vote_average.desc, handles GLOBAL watch_region fallback, and expands provider families", () => {
  const params = buildTmdbDiscoverParams({
    genres: [878, 53],
    genreMode: "or",
    withoutGenres: [27],
    yearFrom: "2015",
    yearTo: "2020",
    runtimeMin: 95,
    runtimeMax: 160,
    minImdb: 7,
    minVotes: 0,
    language: "ja",
    country: "JP",
    keywords: [{ id: 4344, name: "time loop" }],
    person: { id: 525, name: "Christopher Nolan" },
    sortBy: "vote_average.desc",
    providers: [8],
    region: "GLOBAL",
    page: 2
  });

  assert.equal(params.with_genres, "878|53");
  assert.equal(params.without_genres, "27");
  assert.equal(params["primary_release_date.gte"], "2015-01-01");
  assert.equal(params["primary_release_date.lte"], "2020-12-31");
  assert.equal(params["with_runtime.gte"], "95");
  assert.equal(params["with_runtime.lte"], "160");
  assert.equal(params["vote_average.gte"], "7");
  assert.ok(Number(params["vote_count.gte"]) >= 150);
  assert.equal(params.with_original_language, "ja");
  assert.equal(params.with_origin_country, "JP");
  assert.equal(params.with_keywords, "4344");
  assert.equal(params.with_people, "525");
  assert.match(params.with_watch_providers, /^8(\||$)/);
  assert.equal(params.with_watch_monetization_types, "flatrate|free|ads");
  assert.equal(params.watch_region, "US");
  assert.equal(params.page, 2);
});

test("filterExploreResults annotates Vault state and strips watched entries when hideWatched is active", () => {
  const movies = [
    { tmdbId: 100, imdbID: "tmdb_100", title: "Seen Film", year: "2020" },
    { tmdbId: 200, imdbID: "tmdb_200", title: "Fresh Film", year: "2021" }
  ];
  const watched = [{ tmdbId: 100, title: "Seen Film", userRating: 9, dateWatched: "2026-10-01" }];
  const watchlist = [{ tmdbId: 200, title: "Fresh Film" }];

  const all = filterExploreResults(movies, watched, watchlist, { hideWatched: false });
  assert.equal(all.length, 2);
  assert.equal(all[0].userRating, 9);
  assert.equal(all[0]._watched, true);
  assert.equal(all[1]._inWatchlist, true);

  const hidden = filterExploreResults(movies, watched, watchlist, { hideWatched: true });
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].tmdbId, 200);
});

test("getActiveFilterChips generates removable chip summaries for non-default filters", () => {
  const chips = getActiveFilterChips({
    ...DEFAULT_EXPLORE_FILTERS,
    genres: [878],
    yearFrom: "1990",
    yearTo: "1999",
    keywords: [{ id: 4379, name: "time travel" }],
    hideWatched: true
  });

  assert.ok(chips.some((c) => /Sci-Fi/i.test(c.label)));
  assert.ok(chips.some((c) => /1990/.test(c.label)));
  assert.ok(chips.some((c) => /time travel/i.test(c.label)));
  assert.ok(chips.some((c) => c.key === "hideWatched" && c.clearPatch.hideWatched === false));
});

test("buildExploreSearchParams preserves explicit region=US for non-US defaults and deriveExploreViewState prevents stale grids/flashes", () => {
  const sp = buildExploreSearchParams(
    { ...DEFAULT_EXPLORE_FILTERS, region: "US", genres: [878] },
    { defaultRegion: "GB" }
  );
  assert.equal(sp.get("region"), "US");
  assert.equal(parseExploreSearchParams(sp.toString(), "GB").region, "US");

  // Stale signature when switching filters must suppress old items & counts
  const staleDuringSwitch = deriveExploreViewState({
    rawPagesState: { signature: "genres=28", items: [{ tmdbId: 1 }], loadedPage: 1, totalResults: 500, totalPages: 25 },
    filterSignature: "genres=878",
    filteredResults: [{ tmdbId: 1 }],
    isLoading: true,
    isLoadingMore: false,
    errorMsg: ""
  });
  assert.equal(staleDuringSwitch.hasFreshData, false);
  assert.equal(staleDuringSwitch.visibleItems.length, 0);
  assert.equal(staleDuringSwitch.displayTotalResults, 0);
  assert.equal(staleDuringSwitch.showSkeleton, true);
  assert.equal(staleDuringSwitch.showEmptyState, false);

  // Auto-advancing page 2 while hideWatched cleared page 1 must show skeleton, not empty-state flash
  const autoAdvancing = deriveExploreViewState({
    rawPagesState: { signature: "hideWatched=1", items: [{ tmdbId: 1 }], loadedPage: 1, totalResults: 100, totalPages: 5 },
    filterSignature: "hideWatched=1",
    filteredResults: [],
    isLoading: false,
    isLoadingMore: true,
    errorMsg: ""
  });
  assert.equal(autoAdvancing.showSkeleton, true);
  assert.equal(autoAdvancing.showEmptyState, false);

  // Debounced year commit merges onto latest filter snapshot (not stale genres)
  const merged = mergeYearDraftIntoFilters(
    { ...DEFAULT_EXPLORE_FILTERS, genres: [878] },
    "2010",
    "2019"
  );
  assert.deepEqual(merged.genres, [878]);
  assert.equal(merged.yearFrom, "2010");
  assert.equal(merged.yearTo, "2019");

  // Initial default load (signature: null vs filterSignature: "") must not look fresh prematurely
  const initialDefault = deriveExploreViewState({
    rawPagesState: { signature: null, items: [], loadedPage: 0, totalResults: 0, totalPages: 1 },
    filterSignature: "",
    filteredResults: [],
    isLoading: true,
    isLoadingMore: false,
    errorMsg: ""
  });
  assert.equal(initialDefault.hasFreshData, false);
  assert.equal(initialDefault.showSkeleton, true);

  // Pre-effect commit when hideWatched cleared page 1 must suppress empty-state flash & flag auto-advance
  const preAutoAdvance = deriveExploreViewState({
    rawPagesState: { signature: "hideWatched=1", items: [{ tmdbId: 1 }], loadedPage: 1, totalResults: 100, totalPages: 5 },
    filterSignature: "hideWatched=1",
    filteredResults: [],
    isLoading: false,
    isLoadingMore: false,
    errorMsg: "",
    hideWatched: true,
    page: 1
  });
  assert.equal(preAutoAdvance.shouldAutoAdvance, true);
  assert.equal(preAutoAdvance.showSkeleton, true);
  assert.equal(preAutoAdvance.showEmptyState, false);

  // Load-More pagination error preserves fresh loaded page 1 grid below the Retry alert
  const loadMoreFailed = deriveExploreViewState({
    rawPagesState: { signature: "genres=878", items: [{ tmdbId: 1 }], loadedPage: 1, totalResults: 100, totalPages: 5 },
    filterSignature: "genres=878",
    filteredResults: [{ tmdbId: 1 }],
    isLoading: false,
    isLoadingMore: false,
    errorMsg: "Failed to fetch matching films from TMDB.",
    hideWatched: false,
    page: 2
  });
  assert.equal(loadMoreFailed.showGrid, true);
  assert.equal(loadMoreFailed.showEmptyState, false);

  // Filter-switch error never leaks stale previous grid
  const switchFailed = deriveExploreViewState({
    rawPagesState: { signature: "genres=28", items: [{ tmdbId: 1 }], loadedPage: 1, totalResults: 100, totalPages: 5 },
    filterSignature: "genres=878",
    filteredResults: [{ tmdbId: 1 }],
    isLoading: false,
    isLoadingMore: false,
    errorMsg: "Failed to fetch matching films from TMDB.",
    hideWatched: false,
    page: 1
  });
  assert.equal(switchFailed.showGrid, false);
});
