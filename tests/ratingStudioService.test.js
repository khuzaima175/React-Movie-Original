import test from "node:test";
import assert from "node:assert/strict";
import { getRatingTier } from "../src/services/ratingTiers.js";
import {
  CRAFT_ASPECTS,
  WATCH_FORMATS,
  computeVaultCalibration,
  computeStarStageMetrics,
  normalizeRatingBreakdown,
  computeCraftAverage,
  normalizeWatchMeta,
  buildWatchedRatingPayload
} from "../src/services/ratingStudioService.js";
import { upsertMovieEntry } from "../src/services/movieIdentity.js";
import { extractTasteProfile } from "../src/services/tmdbService.js";

test("computeVaultCalibration handles empty or unrated vaults cleanly", () => {
  const res = computeVaultCalibration([], 8);
  assert.equal(res.ratedCount, 0);
  assert.deepEqual(res.anchorMovies, []);
  assert.equal(res.topPercentile, null);
  assert.match(res.summaryText, /first|rate/i);

  const unratedOnly = computeVaultCalibration([{ imdbID: "tt1", title: "X", userRating: 0 }], 7);
  assert.equal(unratedOnly.ratedCount, 0);
  assert.equal(unratedOnly.topPercentile, null);
});

test("computeVaultCalibration finds exact-score anchors, excludes self, and falls back to nearest score", () => {
  const watched = [
    { imdbID: "tt01", title: "Alpha", year: "2020", userRating: 9, dateWatched: "2026-11-10T00:00:00Z" },
    { imdbID: "tt02", title: "Beta", year: "2021", userRating: 9, dateWatched: "2026-11-12T00:00:00Z" },
    { imdbID: "tt03", title: "Self", year: "2022", userRating: 9 },
    { imdbID: "tt04", title: "Gamma", year: "2019", userRating: 7 },
    { imdbID: "tt05", title: "Delta", year: "2018", userRating: 6 }
  ];
  const exact = computeVaultCalibration(watched, 9, { imdbID: "tt03" });
  assert.equal(exact.ratedCount, 4);
  assert.equal(exact.sameScoreCount, 2);
  assert.equal(exact.anchorMovies.length, 2);
  assert.equal(exact.anchorMovies[0].imdbID, "tt02"); // most recent first
  assert.ok(exact.anchorMovies.every((m) => m.imdbID !== "tt03"));
  assert.ok(exact.topPercentile >= 1 && exact.topPercentile <= 100);

  const nearest = computeVaultCalibration(watched, 8, { imdbID: "tt03" });
  assert.equal(nearest.sameScoreCount, 0);
  assert.ok(nearest.anchorMovies.length > 0);
  assert.ok(nearest.anchorMovies.some((m) => m.userRating === 9 || m.userRating === 7));
});

test("normalizeRatingBreakdown strips zeros/out-of-range and returns null when blank", () => {
  assert.equal(CRAFT_ASPECTS.length, 4);
  assert.equal(normalizeRatingBreakdown({ story: 0, direction: 0 }), null);
  assert.equal(normalizeRatingBreakdown(null), null);
  assert.deepEqual(
    normalizeRatingBreakdown({ story: 5, direction: 4.4, acting: 99, visuals: 3, unknown: 5 }),
    { story: 5, direction: 4, acting: 5, visuals: 3 }
  );
  assert.equal(computeCraftAverage({ story: 5, direction: 4 }), 4.5);
  assert.equal(computeCraftAverage(null), null);
});

test("normalizeWatchMeta preserves legitimate values and omits default-empty state", () => {
  assert.equal(WATCH_FORMATS.length, 4);
  assert.equal(normalizeWatchMeta({ format: "", rewatchCount: 0, containsSpoilers: false }), null);
  assert.deepEqual(
    normalizeWatchMeta({ format: "theater", rewatchCount: 2, containsSpoilers: true }),
    { format: "theater", rewatchCount: 2, containsSpoilers: true }
  );
  assert.deepEqual(
    normalizeWatchMeta({ format: "invalid_fmt", rewatchCount: 1, containsSpoilers: false }),
    { rewatchCount: 1 }
  );
});

test("buildWatchedRatingPayload preserves base fields, merges breakdown/watchMeta, and strips cleared sub-objects", () => {
  const enriched = buildWatchedRatingPayload({
    movie: { imdbID: "tt0133093", tmdbId: 603, title: "The Matrix", year: "1999", genre: "Action, Sci-Fi", runtimeMinutes: 136 },
    userRating: 9,
    userNote: "Masterpiece #Masterpiece",
    ratingBreakdown: { story: 5, visuals: 5 },
    watchMeta: { format: "imax", rewatchCount: 3 },
    nowIso: "2026-11-15T12:00:00.000Z"
  });
  assert.deepEqual(enriched.ratingBreakdown, { story: 5, visuals: 5 });
  assert.deepEqual(enriched.watchMeta, { format: "imax", rewatchCount: 3 });
  assert.equal(enriched.runtime, 136);

  const cleared = buildWatchedRatingPayload({
    movie: { imdbID: "tt0133093", tmdbId: 603, title: "The Matrix", year: "1999" },
    baseWatchedItem: {
      imdbID: "tt0133093",
      dateWatched: "2025-01-01T00:00:00.000Z",
      ratingBreakdown: { story: 5 },
      watchMeta: { format: "theater" }
    },
    userRating: 9,
    userNote: "Rewatched!",
    ratingBreakdown: { story: 0 },
    watchMeta: { format: "", rewatchCount: 0, containsSpoilers: false },
    nowIso: "2026-11-15T12:00:00.000Z"
  });
  assert.equal(cleared.userRating, 9);
  assert.equal(cleared.dateWatched, "2025-01-01T00:00:00.000Z");
  assert.equal(cleared.updatedAt, "2026-11-15T12:00:00.000Z");
  assert.equal("ratingBreakdown" in cleared, false);
  assert.equal("watchMeta" in cleared, false);
});

test("buildWatchedRatingPayload({ markCleared: true }) clears existing ratingBreakdown and watchMeta across upsertMovieEntry", () => {
  const existingList = [
    {
      imdbID: "tt0133093",
      tmdbId: 603,
      title: "The Matrix",
      year: "1999",
      userRating: 9,
      ratingBreakdown: { story: 5, direction: 5 },
      watchMeta: { format: "imax", rewatchCount: 2, containsSpoilers: true },
      updatedAt: "2026-11-10T00:00:00.000Z"
    }
  ];

  const studioPayload = buildWatchedRatingPayload({
    movie: { imdbID: "tt0133093", tmdbId: 603, title: "The Matrix", year: "1999" },
    baseWatchedItem: existingList[0],
    userRating: 8,
    userNote: "Cleared craft & watch log",
    ratingBreakdown: null,
    watchMeta: null,
    markCleared: true,
    nowIso: "2026-11-15T14:00:00.000Z"
  });

  const nextList = upsertMovieEntry(existingList, studioPayload);
  assert.equal(nextList.length, 1);
  assert.equal(nextList[0].userRating, 8);
  assert.equal("ratingBreakdown" in nextList[0], false);
  assert.equal("watchMeta" in nextList[0], false);

  // Partial QuickRate update omitting those keys must still preserve them
  const partialList = upsertMovieEntry(existingList, {
    imdbID: "tt0133093",
    userRating: 10,
    updatedAt: "2026-11-15T15:00:00.000Z"
  });
  assert.deepEqual(partialList[0].ratingBreakdown, { story: 5, direction: 5 });
  assert.deepEqual(partialList[0].watchMeta, { format: "imax", rewatchCount: 2, containsSpoilers: true });
});

test("computeStarStageMetrics computes unrated, selected, and hover-override wave states and roving tabIndex", () => {
  const unrated = computeStarStageMetrics(0, 0);
  assert.equal(unrated.activeScore, 0);
  assert.equal(unrated.fillPercent, 0);
  assert.equal(unrated.isHovering, false);
  assert.equal(unrated.stars.length, 10);
  assert.equal(unrated.stars[0].tabIndex, 0);
  assert.ok(unrated.stars.slice(1).every((s) => s.tabIndex === -1));
  assert.ok(unrated.stars.every((s) => !s.isFilled && !s.isCurrent && !s.isWaveNeighbor));

  // Selected 7/10, hover 4/10 overrides activeScore and centers wave on 4 (neighbors 3 and 5)
  const hovered = computeStarStageMetrics(7, 4);
  assert.equal(hovered.activeScore, 4);
  assert.equal(hovered.selectedScore, 7);
  assert.equal(hovered.isHovering, true);
  assert.equal(hovered.fillPercent, 40);
  assert.equal(hovered.stars[3].isCurrent, true); // score 4
  assert.equal(hovered.stars[2].isWaveNeighbor, true); // score 3
  assert.equal(hovered.stars[4].isWaveNeighbor, true); // score 5
  assert.equal(hovered.stars[5].isFilled, false); // score 6 not filled while hovering 4
  assert.equal(hovered.stars[6].isSelected, true); // score 7 retains selected marker & roving tabIndex
  assert.equal(hovered.stars[6].tabIndex, 0);

  // Boundary wave at 10/10 only marks 9 as neighbor and clamps out-of-range inputs
  const boundaryTen = computeStarStageMetrics(14, 0);
  assert.equal(boundaryTen.activeScore, 10);
  assert.equal(boundaryTen.fillPercent, 100);
  assert.equal(boundaryTen.stars[9].isCurrent, true);
  assert.equal(boundaryTen.stars[8].isWaveNeighbor, true);

  const tier7 = getRatingTier(7);
  assert.equal(tier7.shortLabel, "Good Watch");
  assert.equal(tier7.tone, "cyan");
  assert.equal(getRatingTier(10).shortLabel, "Masterpiece");
  assert.equal(getRatingTier(0).tone, "unrated");
});

test("extractTasteProfile honors ratingBreakdown so high direction/visuals on a 5★ film does not penalize the director", async () => {
  const watched = [
    { tmdbId: 1, title: "A", userRating: 9, crewPersonId: 50, castIds: [11], tmdbGenreIds: [18] },
    { tmdbId: 2, title: "B", userRating: 9, crewPersonId: 60, castIds: [12], tmdbGenreIds: [18] },
    {
      tmdbId: 3, title: "Gorgeous Bad Script", userRating: 5, crewPersonId: 70, castIds: [13], tmdbGenreIds: [18],
      ratingBreakdown: { story: 1, direction: 5, acting: 3, visuals: 5 }
    }
  ];
  const profile = await extractTasteProfile(watched, []);
  assert.ok((profile.crewAffinities[70] || 0) > 0, "5/5 direction & visuals must yield positive crew affinity instead of negative");
  assert.equal(profile.castAffinities[13] || 0, 0, "3/5 acting must stay neutral (not penalized on a 5★ script)");

  // Compare two directors who each have one 9★ hit and one 5★ miss:
  // Director 81 had 5/5 direction & visuals on the 5★ film; Director 82 had 1/5 direction & visuals.
  // Also compare actors 91 (5/5 acting on 5★ miss) vs 92 (1/5 acting on 5★ miss).
  const mixedWatched = [
    { tmdbId: 10, title: "Hit 1", userRating: 9, crewPersonId: 81, castIds: [91], tmdbGenreIds: [18], dateWatched: "2026-11-01" },
    { tmdbId: 11, title: "Hit 2", userRating: 9, crewPersonId: 82, castIds: [92], tmdbGenreIds: [18], dateWatched: "2026-11-01" },
    {
      tmdbId: 12, title: "Visual Miss 1", userRating: 5, crewPersonId: 81, castIds: [91], tmdbGenreIds: [18], dateWatched: "2026-11-01",
      ratingBreakdown: { story: 1, direction: 5, acting: 5, visuals: 5 }
    },
    {
      tmdbId: 13, title: "Sloppy Miss 2", userRating: 5, crewPersonId: 82, castIds: [92], tmdbGenreIds: [18], dateWatched: "2026-11-01",
      ratingBreakdown: { story: 4, direction: 1, acting: 1, visuals: 1 }
    }
  ];
  const mixedProfile = await extractTasteProfile(mixedWatched, [], { now: Date.parse("2026-11-10T00:00:00Z") });
  assert.ok(
    (mixedProfile.crewAffinities[81] || 0) > (mixedProfile.crewAffinities[82] || 0),
    "High direction/visuals breakdown must elevate crewAffinities over poor craft breakdown"
  );
  assert.ok(
    (mixedProfile.castAffinities[91] || 0) > (mixedProfile.castAffinities[92] || 0),
    "High acting breakdown must elevate castAffinities over poor acting breakdown"
  );
});

test("extractTasteProfile applies 1.15x positive magnitude boost for >=8★ rewatches and IMAX/physical formats without altering plain vaults", async () => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  const watched = [
    {
      tmdbId: 1, title: "Plain Great", userRating: 8, dateWatched: "2026-11-01",
      tmdbGenreIds: [35], crewPersonId: 201, castIds: [301], tmdbKeywords: [401]
    },
    {
      tmdbId: 2, title: "IMAX Great", userRating: 8, dateWatched: "2026-11-01",
      tmdbGenreIds: [878], crewPersonId: 202, castIds: [302], tmdbKeywords: [402],
      watchMeta: { format: "imax" }
    },
    {
      tmdbId: 3, title: "Physical Great", userRating: 8, dateWatched: "2026-11-01",
      tmdbGenreIds: [18], crewPersonId: 203, castIds: [303], tmdbKeywords: [403],
      watchMeta: { format: "physical" }
    },
    {
      tmdbId: 4, title: "Rewatched Great", userRating: 8, dateWatched: "2026-11-01",
      tmdbGenreIds: [53], crewPersonId: 204, castIds: [304], tmdbKeywords: [404],
      watchMeta: { rewatchCount: 2 }
    },
    {
      tmdbId: 5, title: "Mediocre IMAX", userRating: 6, dateWatched: "2026-11-01",
      tmdbGenreIds: [27], crewPersonId: 205, castIds: [305], tmdbKeywords: [405],
      watchMeta: { format: "imax", rewatchCount: 3 }
    }
  ];

  const profile = await extractTasteProfile(watched, [], { now });
  const ratioImax = profile.genreAffinities[878] / profile.genreAffinities[35];
  const ratioPhys = profile.genreAffinities[18] / profile.genreAffinities[35];
  const ratioRewatch = profile.genreAffinities[53] / profile.genreAffinities[35];

  assert.ok(Math.abs(ratioImax - 1.15) < 1e-6, `Expected 1.15x IMAX genre boost, got ${ratioImax}`);
  assert.ok(Math.abs(ratioPhys - 1.15) < 1e-6, `Expected 1.15x physical genre boost, got ${ratioPhys}`);
  assert.ok(ratioRewatch >= 1.15 - 1e-6, `Expected >=1.15x rewatch genre boost, got ${ratioRewatch}`);
  assert.equal(profile.topCrewIds[0] === 201, false, "Boosted 8★ IMAX/physical/rewatched crew must outrank plain 8★ crew");
  assert.ok((profile.genreAffinities[27] || 0) === 0, "6★ IMAX rewatch must not receive positive boost");
});
