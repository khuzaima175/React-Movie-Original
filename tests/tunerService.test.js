import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TUNER_STATE,
  isTunerNeutral,
  extractDominantUserGenres,
  computeCandidateAxes,
  applyTunerToPool
} from "../src/services/tunerService.js";

test("isTunerNeutral returns true for DEFAULT_TUNER_STATE and applyTunerToPool preserves exact order", () => {
  assert.equal(isTunerNeutral(DEFAULT_TUNER_STATE), true);
  assert.equal(isTunerNeutral({ ...DEFAULT_TUNER_STATE, era: 0.25 }), false);
  assert.equal(isTunerNeutral({ ...DEFAULT_TUNER_STATE, antiBubble: true }), false);

  const items = [
    { tmdbId: 1, title: "Film A", matchScore: 91, release_date: "1974-01-01" },
    { tmdbId: 2, title: "Film B", matchScore: 84, release_date: "2024-01-01" }
  ];
  const out = applyTunerToPool(items, DEFAULT_TUNER_STATE);
  assert.deepEqual(out.map((x) => x.tmdbId), [1, 2]);
  assert.deepEqual(out.map((x) => x.matchScore), [91, 84]);
});

test("era slider promotes classic vs modern films cleanly", () => {
  const items = [
    { tmdbId: 1, title: "Modern Film", matchScore: 85, release_date: "2024-05-01" },
    { tmdbId: 2, title: "Classic Film", matchScore: 85, release_date: "1968-04-01" }
  ];
  const classicFirst = applyTunerToPool(items, { ...DEFAULT_TUNER_STATE, era: -1 });
  assert.equal(classicFirst[0].tmdbId, 2);

  const modernFirst = applyTunerToPool(items, { ...DEFAULT_TUNER_STATE, era: 1 });
  assert.equal(modernFirst[0].tmdbId, 1);
});

test("familiarity slider promotes hidden gems (+1) vs crowd-pleasers (-1)", () => {
  const items = [
    { tmdbId: 1, title: "Blockbuster", matchScore: 86, vote_count: 25000 },
    { tmdbId: 2, title: "Indie Gem", matchScore: 86, vote_count: 220 }
  ];
  const gemsFirst = applyTunerToPool(items, { ...DEFAULT_TUNER_STATE, familiarity: 1 });
  assert.equal(gemsFirst[0].tmdbId, 2);

  const crowdFirst = applyTunerToPool(items, { ...DEFAULT_TUNER_STATE, familiarity: -1 });
  assert.equal(crowdFirst[0].tmdbId, 1);
});

test("pacing and tone sliders rank genre/keyword profiles accurately and incorporate 128-D semantic axes", () => {
  const items = [
    { tmdbId: 10, title: "Meditative Drama", matchScore: 82, tmdbGenreIds: [18, 36] },
    { tmdbId: 20, title: "Kinetic Action Thriller", matchScore: 82, tmdbGenreIds: [28, 53] },
    { tmdbId: 30, title: "Warm Family Comedy", matchScore: 82, tmdbGenreIds: [35, 10751, 16] },
    { tmdbId: 40, title: "Bleak Horror Crime", matchScore: 82, tmdbGenreIds: [27, 80] }
  ];

  const fastFirst = applyTunerToPool(items, { ...DEFAULT_TUNER_STATE, pacing: 1 });
  assert.equal(fastFirst[0].tmdbId, 20);

  const warmFirst = applyTunerToPool(items, { ...DEFAULT_TUNER_STATE, tone: 1 });
  assert.equal(warmFirst[0].tmdbId, 30);

  const bleakFirst = applyTunerToPool(items, { ...DEFAULT_TUNER_STATE, tone: -1 });
  assert.equal(bleakFirst[0].tmdbId, 40);

  // Verify semantic projection via contentIndex + tunerAxes
  const fakeContentIndex = {
    dim: 2,
    idToIndex: new Map([[99, 0]]),
    vectors: new Float32Array([1, 0])
  };
  const fakeAxes = { dim: 2, pacingVec: [1, 0], toneVec: [0, 1] };
  const axes = computeCandidateAxes(
    { tmdbId: 99, title: "Unknown Metadata Film" },
    { contentIndex: fakeContentIndex, tunerAxes: fakeAxes }
  );
  assert.ok(axes.pacing > 0.3, `Expected positive semantic pacing, got ${axes.pacing}`);
  assert.equal(Number.isNaN(axes.era), false);
});

test("extractDominantUserGenres and antiBubble suppress dominant genre while elevating cross-genre thematic twins", () => {
  const watched = [
    { tmdbId: 1, title: "Hero 1", userRating: 9, tmdbGenreIds: [28, 878] },
    { tmdbId: 2, title: "Hero 2", userRating: 9, tmdbGenreIds: [28, 878] },
    { tmdbId: 3, title: "Hero 3", userRating: 8, tmdbGenreIds: [28, 12] },
    { tmdbId: 4, title: "Drama 1", userRating: 8, tmdbGenreIds: [18] }
  ];
  const dominant = extractDominantUserGenres(watched, 2);
  assert.deepEqual(dominant, [28, 878]);

  const pool = [
    { tmdbId: 101, title: "Another Superhero Sequel", matchScore: 88, tmdbGenreIds: [28, 878], collabSim: 0.7 },
    { tmdbId: 102, title: "1970s Japanese Crime Drama", matchScore: 85, tmdbGenreIds: [80, 18], collabSim: 0.75 }
  ];

  const busted = applyTunerToPool(
    pool,
    { ...DEFAULT_TUNER_STATE, antiBubble: true },
    { watched }
  );
  assert.equal(busted[0].tmdbId, 102);
  for (const item of busted) {
    assert.ok(item.matchScore >= 50 && item.matchScore <= 99);
  }
});
