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
  buildMoodFilterHashSegment
} from "../src/services/moodPolicy.js";

test("constants and MOOD_OPTIONS define 10-pick defaults and distinct mood constraints", () => {
  assert.equal(DEFAULT_RECOMMENDATION_COUNT, 10);
  assert.equal(MIN_VALID_CACHE_COUNT, 7);
  assert.deepEqual(MOOD_OPTIONS.map((m) => m.id), [
    "any",
    "mind-bending",
    "dark-thriller",
    "fun-popcorn",
    "comfort-watch",
    "hidden-gem"
  ]);

  const hiddenGem = getMoodPreset("hidden-gem");
  assert.equal(hiddenGem.voteCountLte, 1500);
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
