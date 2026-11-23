import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RECOMMENDATION_COUNT,
  MIN_VALID_CACHE_COUNT,
  MOOD_OPTIONS,
  getMoodPreset,
  normalizeMoodFilters,
  isExplicitMoodActive,
  parseFreeTextMoodFallback,
  buildMoodFilterHashSegment,
  extractGenreIdsFromCandidate,
  matchesMoodCandidateGate
} from "../src/services/moodPolicy.js";
import { expandProviderIds, matchesWatchProviders } from "../src/services/tmdbService.js";

test("constants and MOOD_OPTIONS define 20-pick defaults and distinct mood constraints", () => {
  assert.equal(DEFAULT_RECOMMENDATION_COUNT, 20);
  assert.equal(MIN_VALID_CACHE_COUNT, 14);
  assert.deepEqual(MOOD_OPTIONS.map((m) => m.id), [
    "any",
    "mind-bending",
    "dark-thriller",
    "fun-popcorn",
    "comfort-watch",
    "hidden-gem"
  ]);

  const hiddenGem = getMoodPreset("hidden-gem");
  assert.equal(hiddenGem.voteCountLte, 2000);
  assert.equal(hiddenGem.relaxCastLock, true);

  const comfort = getMoodPreset("comfort-watch");
  assert.ok(comfort.preferredGenreIds.includes(35));
  assert.ok(comfort.discouragedGenreIds.includes(53));
  assert.ok(comfort.withoutGenreIds.includes(27));
});

test("normalizeMoodFilters resolves genre names, clamps years, and builds deterministic hashes", () => {
  assert.equal(normalizeMoodFilters(null), null);
  assert.equal(normalizeMoodFilters({ moodId: "any" }), null);

  const a = normalizeMoodFilters({
    query: "like Drive but quieter",
    moodId: "dark-thriller",
    withGenres: ["Crime", "Sci-Fi"],
    withoutKeywords: ["Loud Explosions", "superhero"],
    minYear: 1995,
    maxYear: 2022
  });
  const b = normalizeMoodFilters({
    query: "like Drive but quieter",
    moodId: "dark-thriller",
    withGenres: ["Science Fiction", "crime"],
    withoutKeywords: ["superhero", "loud explosions"],
    minYear: 1995,
    maxYear: 2022
  });

  assert.deepEqual(a.withGenreIds, [80, 878]);
  assert.equal(buildMoodFilterHashSegment(a), buildMoodFilterHashSegment(b));
  assert.ok(isExplicitMoodActive("any", a));
  assert.equal(isExplicitMoodActive("any", null), false);
});

test("parseFreeTextMoodFallback extracts mood, decade, genres, and exclusions offline", () => {
  assert.equal(parseFreeTextMoodFallback("   "), null);

  const cozy90s = parseFreeTextMoodFallback("cozy 90s comedy with no horror");
  assert.equal(cozy90s.moodId, "comfort-watch");
  assert.ok(cozy90s.withGenres.includes("Comedy"));
  assert.equal(cozy90s.minYear, 1990);
  assert.equal(cozy90s.maxYear, 1999);
  assert.ok(cozy90s.withoutKeywords.some((k) => k.includes("horror")));

  const modernScifi = parseFreeTextMoodFallback("mind-bending sci-fi after 2015");
  assert.equal(modernScifi.moodId, "mind-bending");
  assert.equal(modernScifi.minYear, 2015);
  assert.ok(modernScifi.withGenreIds.includes(878));

  const spaceScifi = parseFreeTextMoodFallback("90s sci fi comedy");
  assert.ok(spaceScifi.withGenreIds.includes(878), "must recognize unhyphenated 'sci fi' offline");
  assert.ok(spaceScifi.withGenreIds.includes(35));
  assert.equal(spaceScifi.minYear, 1990);
});

test("matchesMoodCandidateGate strictly separates moods and rejects off-tone films", () => {
  const vForVendetta = { title: "V for Vendetta", genre_ids: [28, 53, 878], vote_average: 7.9, vote_count: 14500 };
  const wolfOfWallSt = { title: "The Wolf of Wall Street", genre_ids: [80, 18, 35], vote_average: 8.0, vote_count: 23000 };
  const amelie = { title: "Amélie", genre_ids: [35, 10749], vote_average: 7.9, vote_count: 11500 };

  assert.equal(matchesMoodCandidateGate(vForVendetta, "comfort-watch"), false);
  assert.equal(matchesMoodCandidateGate(wolfOfWallSt, "comfort-watch"), false);
  assert.equal(matchesMoodCandidateGate(amelie, "comfort-watch"), true);

  const theMartian = { title: "The Martian", tmdbGenreIds: [18, 12, 878], vote_average: 8.0, vote_count: 18000 };
  const edgeOfTomorrow = { title: "Edge of Tomorrow", tmdbGenreIds: [28, 878], vote_average: 7.9, vote_count: 15000 };
  const exMachina = { title: "Ex Machina", tmdbGenreIds: [18, 878, 9648], vote_average: 7.7, vote_count: 12000 };
  const prisoners = { title: "Prisoners", tmdbGenreIds: [80, 53, 18], vote_average: 8.1, vote_count: 11000 };

  assert.equal(matchesMoodCandidateGate(theMartian, "fun-popcorn"), true);
  assert.equal(matchesMoodCandidateGate(edgeOfTomorrow, "fun-popcorn"), true);
  assert.equal(matchesMoodCandidateGate(theMartian, "dark-thriller"), false);
  assert.equal(matchesMoodCandidateGate(edgeOfTomorrow, "dark-thriller"), false);

  assert.equal(matchesMoodCandidateGate(exMachina, "mind-bending"), true);
  assert.equal(matchesMoodCandidateGate(exMachina, "dark-thriller"), false);
  assert.equal(matchesMoodCandidateGate(exMachina, "fun-popcorn"), false);

  assert.equal(matchesMoodCandidateGate(prisoners, "dark-thriller"), true);
  assert.equal(matchesMoodCandidateGate(prisoners, "fun-popcorn"), false);
  assert.equal(matchesMoodCandidateGate(prisoners, "comfort-watch"), false);

  const moon = { title: "Moon", tmdbGenreIds: [878, 18], vote_count: 6155, vote_average: 7.6 };
  const coherence = { title: "Coherence", tmdbGenreIds: [53, 878], vote_count: 1450, vote_average: 7.4 };
  assert.equal(matchesMoodCandidateGate(moon, "hidden-gem"), false);
  assert.equal(matchesMoodCandidateGate(coherence, "hidden-gem"), true);
  assert.equal(extractGenreIdsFromCandidate({ genre: "Sci-Fi, Mystery" }).has(878), true);
});

test("expandProviderIds and matchesWatchProviders enforce family-aware streaming checks", () => {
  const expanded = expandProviderIds([8, 1899]);
  for (const id of [8, 1796, 1899, 384, 1825]) {
    assert.ok(expanded.includes(id), `Expected expanded provider IDs to include ${id}`);
  }

  const deadpool = {
    title: "Deadpool",
    streamProviders: [{ id: 337, name: "Disney Plus" }],
    providersHydrated: true
  };
  const netflixAdTier = {
    title: "Glass Onion",
    streamProviders: [{ id: 1796, name: "Netflix Standard with Ads" }],
    providersHydrated: true
  };
  const unhydratedQueryMatch = {
    title: "Query Matched",
    streamProviders: [],
    providersHydrated: false,
    providerMatchedByQuery: true
  };
  const unhydratedNoMatch = {
    title: "Embedding Neighbor",
    streamProviders: [],
    providersHydrated: false,
    providerMatchedByQuery: false
  };

  assert.equal(matchesWatchProviders(deadpool, [8, 1899]), false);
  assert.equal(matchesWatchProviders(netflixAdTier, [8]), true);
  assert.equal(matchesWatchProviders(unhydratedQueryMatch, [8, 1899]), true);
  assert.equal(matchesWatchProviders(unhydratedNoMatch, [8, 1899]), false);
});
