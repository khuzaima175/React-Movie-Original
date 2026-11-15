import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_RANKER_WEIGHTS,
  DEFAULT_METADATA_DAMPING_FACTOR,
  DEFAULT_DISPLAY_TEMPERATURE,
  computeDisplayMatchScore,
  extractCandidateFeatures,
  scoreCandidate,
  rankCandidatePool,
  buildDiversifiedGeminiShortlist
} from "../src/services/rankerService.js";
import { extractTasteProfile } from "../src/services/tmdbService.js";

test("scoreCandidate produces calibrated probabilities and monotonic matchScore in [50, 99]", () => {
  const strongFeatures = {
    collabSim: 0.75,
    contentSim: 0.65,
    genreOverlap: 0.8,
    keywordOverlap: 0.5,
    crewMatch: 1,
    castMatch: 1,
    bayesianRatingNorm: 0.85,
    noveltyBonus: 0.4,
    negativeKeywordPenalty: 0,
    providerMatch: 1
  };
  const weakFeatures = {
    collabSim: -0.2,
    contentSim: 0.0,
    genreOverlap: 0.0,
    keywordOverlap: 0.0,
    crewMatch: 0,
    castMatch: 0,
    bayesianRatingNorm: 0.3,
    noveltyBonus: 0.1,
    negativeKeywordPenalty: 1,
    providerMatch: 0
  };

  const strong = scoreCandidate(strongFeatures);
  const weak = scoreCandidate(weakFeatures);

  assert.ok(strong.probability > 0.8, `expected strong probability > 0.8, got ${strong.probability}`);
  assert.ok(weak.probability < 0.3, `expected weak probability < 0.3, got ${weak.probability}`);
  assert.ok(strong.matchScore >= 90 && strong.matchScore <= 99);
  assert.ok(weak.matchScore >= 50 && weak.matchScore < 70);
});

test("rankCandidatePool ranks 300 candidates down to topK=30 and attaches calibrated matchScore", () => {
  const candidates = Array.from({ length: 300 }, (_, i) => ({
    id: i + 1,
    tmdbId: i + 1,
    title: `Movie ${i + 1}`,
    genre_ids: i === 42 ? [878, 53] : [35],
    vote_average: i === 42 ? 8.4 : 6.5,
    vote_count: i === 42 ? 1200 : 200
  }));

  const context = {
    profile: { lovedGenreIds: [878, 53], hatedKeywordIds: [], topCastIds: [], topCrewMemberId: null },
    collabSimMap: new Map([[43, 0.88]]),
    contentSimMap: new Map([[43, 0.72]])
  };

  const top30 = rankCandidatePool(candidates, context, undefined, 30);
  assert.equal(top30.length, 30);
  assert.equal(top30[0].tmdbId, 43);
  assert.ok(top30[0].matchScore > top30[29].matchScore);
  assert.ok(top30[0].rankerProbability > top30[29].rankerProbability);
});

test("extractCandidateFeatures handles null collabSimMap and contentSimMap safely", () => {
  const feats = extractCandidateFeatures(
    { id: 10, tmdbId: 10, genre_ids: [878], vote_average: 7.8, vote_count: 500 },
    { profile: { lovedGenreIds: [878] }, collabSimMap: null, contentSimMap: null }
  );
  assert.equal(feats.collabSim, 0);
  assert.equal(feats.contentSim, 0);
  assert.equal(feats.genreOverlap, 1);
});

test("extractCandidateFeatures sets providerMatch=1 when candidate.providerMatchedByQuery is true", () => {
  const feats = extractCandidateFeatures(
    { id: 55, tmdbId: 55, genre_ids: [878], vote_average: 7.5, vote_count: 400, providerMatchedByQuery: true },
    { profile: { lovedGenreIds: [878] }, userProviders: [8, 9] }
  );
  assert.equal(feats.providerMatch, 1);
});


test("extractCandidateFeatures wires repulsionMap, profile.lovedKeywordIds, and profile.topCrewIds", () => {
  const candidate = {
    id: 77,
    tmdbId: 77,
    tmdbGenreIds: [18],
    tmdbKeywords: [501, 502],
    crewPersonId: 9002,
    castIds: [301],
    vote_average: 8.0,
    vote_count: 1000
  };
  const profile = {
    lovedGenreIds: [18],
    lovedKeywordIds: [501, 502, 503],
    topCrewMemberId: 9001,
    topCrewIds: [9001, 9002, 9003],
    topCastIds: [301],
    hatedKeywordIds: []
  };
  const repulsionMap = new Map([[77, 0.6]]);

  const feats = extractCandidateFeatures(candidate, { profile, repulsionMap });
  assert.ok(feats.keywordOverlap > 0.6, `expected keywordOverlap > 0.6 from profile.lovedKeywordIds, got ${feats.keywordOverlap}`);
  assert.equal(feats.crewMatch, 1, "expected crewMatch=1 from secondary favorite director in topCrewIds");
  assert.equal(feats.repulsion, 0.6, "expected repulsion=0.6 from repulsionMap");

  const cleanScore = scoreCandidate({ ...feats, repulsion: 0 });
  const repulsedScore = scoreCandidate(feats);
  assert.ok(repulsedScore.probability < cleanScore.probability, "repulsion must reduce candidate probability");
});


test("fitRankerWeights learns L2-regularized pairwise weights from positive vs negative feature examples", async () => {
  const mod = await import("../src/services/rankerService.js");
  assert.equal(typeof mod.fitRankerWeights, "function");

  // User cares strongly about crewMatch and keywordOverlap
  const positives = Array.from({ length: 15 }, () => ({
    collabSim: 0.1,
    contentSim: 0,
    genreOverlap: 0.5,
    keywordOverlap: 0.9,
    crewMatch: 1,
    castMatch: 0,
    bayesianRatingNorm: 0.6,
    noveltyBonus: 0.1,
    negativeKeywordPenalty: 0,
    repulsion: 0,
    providerMatch: 0.5
  }));
  const negatives = Array.from({ length: 30 }, () => ({
    collabSim: 0.1,
    contentSim: 0,
    genreOverlap: 0.5,
    keywordOverlap: 0.1,
    crewMatch: 0,
    castMatch: 0,
    bayesianRatingNorm: 0.6,
    noveltyBonus: 0.5,
    negativeKeywordPenalty: 0,
    repulsion: 0,
    providerMatch: 0.5
  }));

  const learned = mod.fitRankerWeights(positives, negatives, mod.DEFAULT_RANKER_WEIGHTS, {
    iterations: 40,
    learningRate: 0.15,
    l2: 0.05
  });

  assert.ok(learned.crewMatch > mod.DEFAULT_RANKER_WEIGHTS.crewMatch, "crewMatch weight should increase");
  assert.ok(learned.keywordOverlap > mod.DEFAULT_RANKER_WEIGHTS.keywordOverlap, "keywordOverlap weight should increase");
  assert.ok(learned.noveltyBonus < mod.DEFAULT_RANKER_WEIGHTS.noveltyBonus, "noveltyBonus weight should decrease");
});

test("generateMatchReasons generates high-signal badges and attaches them in rankCandidatePool", async () => {
  const mod = await import("../src/services/rankerService.js");
  assert.equal(typeof mod.generateMatchReasons, "function");

  const auteurCultFeats = {
    collabSim: 0.32,
    crewMatch: 1,
    castMatch: 0,
    keywordOverlap: 0.5,
    noveltyBonus: 0.5,
    genreOverlap: 0.8,
    bayesianRatingNorm: 0.8
  };
  const badges = mod.generateMatchReasons(auteurCultFeats);
  assert.ok(badges.includes("🧬 High Taste-Twin Match"), "should have taste-twin match");
  assert.ok(badges.includes("🎬 Favorite Filmmaker"), "should have favorite filmmaker");
  assert.ok(badges.length <= 3, "badges should be capped at 3");

  const candidates = [
    { id: 1, tmdbId: 1, genre_ids: [18], vote_average: 8.2, vote_count: 500 }
  ];
  const ranked = mod.rankCandidatePool(candidates, {
    profile: { lovedGenreIds: [18] },
    collabSimMap: new Map([[1, 0.4]])
  }, undefined, 1);

  assert.equal(ranked.length, 1);
  assert.ok(Array.isArray(ranked[0].matchReasons), "candidate should have matchReasons array");
  assert.ok(ranked[0].matchReasons.length > 0, "candidate should have at least one badge");
});

test("scoreCandidate damps genreOverlap and bayesianRatingNorm when hasCollabSignal is true", () => {
  const withCollab = {
    collabSim: 0.8,
    genreOverlap: 1.0,
    bayesianRatingNorm: 0.8
  };
  const withoutCollab = {
    collabSim: 0.0,
    genreOverlap: 1.0,
    bayesianRatingNorm: 0.8
  };
  const weights = { bias: 0, collabSim: 0, genreOverlap: 2.0, bayesianRatingNorm: 2.0 };
  const scoreWith = scoreCandidate(withCollab, weights, { metadataDampingFactor: 0.25 });
  const scoreWithout = scoreCandidate(withoutCollab, weights, { metadataDampingFactor: 0.25 });

  // With collab, genre and rating should contribute (1.0*2 + 0.8*2)*0.25 = 0.9 logit
  assert.ok(Math.abs(scoreWith.logit - 0.9) < 1e-4, `expected 0.9, got ${scoreWith.logit}`);
  // Without collab, full strength: 1.0*2 + 0.8*2 = 3.6 logit
  assert.ok(Math.abs(scoreWithout.logit - 3.6) < 1e-4, `expected 3.6, got ${scoreWithout.logit}`);
});

test("rankCandidatePool normalizes collabSim pool-relatively and preserves rawCollabSim", () => {
  const candidates = [
    { id: 1, tmdbId: 1, collabSim: 0.15 },
    { id: 2, tmdbId: 2, collabSim: 0.30 },
    { id: 3, tmdbId: 3, collabSim: 0.0 }
  ];
  const ranked = rankCandidatePool(candidates, {}, undefined, 3);
  const top = ranked.find(c => c.tmdbId === 2);
  const mid = ranked.find(c => c.tmdbId === 1);
  const zero = ranked.find(c => c.tmdbId === 3);

  assert.equal(top.features.rawCollabSim, 0.30);
  assert.equal(top.features.collabSim, 1.0); // 0.30 / 0.30
  assert.equal(mid.features.rawCollabSim, 0.15);
  assert.equal(mid.features.collabSim, 0.5);  // 0.15 / 0.30
  assert.equal(zero.features.collabSim, 0.0);
});

test("DEFAULT_RANKER_WEIGHTS uses softened negativeKeywordPenalty=-0.5 so hated keywords still penalize but by less than -2.0", () => {
  assert.equal(DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty, -0.5);

  const context = {
    profile: {
      lovedGenreIds: [18],
      lovedKeywordIds: [501],
      hatedKeywordIds: [999]
    },
    collabSimMap: new Map([[1, 0.5], [2, 0.5]])
  };
  const withoutHated = { id: 1, tmdbId: 1, genre_ids: [18], tmdbKeywords: [501], vote_average: 7.5, vote_count: 500 };
  const withHated = { id: 2, tmdbId: 2, genre_ids: [18], tmdbKeywords: [501, 999], vote_average: 7.5, vote_count: 500 };

  const fWithout = extractCandidateFeatures(withoutHated, context);
  const fWith = extractCandidateFeatures(withHated, context);
  assert.equal(fWithout.negativeKeywordPenalty, 0);
  assert.equal(fWith.negativeKeywordPenalty, 1);

  const curWithout = scoreCandidate(fWithout);
  const curWith = scoreCandidate(fWith);

  const oldWeights = { ...DEFAULT_RANKER_WEIGHTS, negativeKeywordPenalty: -2.0 };
  const oldWithout = scoreCandidate(fWithout, oldWeights);
  const oldWith = scoreCandidate(fWith, oldWeights);

  const curLogitDrop = curWithout.logit - curWith.logit;
  const oldLogitDrop = oldWithout.logit - oldWith.logit;
  const curProbDrop = curWithout.probability - curWith.probability;
  const oldProbDrop = oldWithout.probability - oldWith.probability;

  assert.ok(curWith.probability < curWithout.probability, "hated-keyword candidate should score lower than identical clean candidate");
  assert.ok(Math.abs(curLogitDrop - 0.5) < 1e-12, `expected logit drop 0.5, got ${curLogitDrop}`);
  assert.ok(Math.abs(oldLogitDrop - 2.0) < 1e-12, `expected prior logit drop 2.0, got ${oldLogitDrop}`);
  assert.ok(curLogitDrop < oldLogitDrop, "current penalty logit drop should be smaller than previous -2.0 drop");
  assert.ok(curProbDrop < oldProbDrop, "current penalty probability drop should be smaller than previous -2.0 drop");
});

test("derivePersonalizedRankerWeights returns priorWeights below minimum threshold and enforces safety rails when active", async () => {
  const { derivePersonalizedRankerWeights } = await import("../src/services/onlineLearningService.js");
  const { DEFAULT_RANKER_WEIGHTS } = await import("../src/services/rankerService.js");

  // Below threshold (only 1 negative dismissal) -> must not drift from priorWeights
  const sparse = derivePersonalizedRankerWeights(
    [
      { action: "rated", userRating: 9, features: { collabSim: 0.8, crewMatch: 1, keywordOverlap: 0.9, repulsion: 0, negativeKeywordPenalty: 0 } },
      { action: "rated", userRating: 9, features: { collabSim: 0.7, crewMatch: 1, keywordOverlap: 0.8, repulsion: 0, negativeKeywordPenalty: 0 } },
      { action: "dismissed", features: { collabSim: 0.2, crewMatch: 0, keywordOverlap: 0.1, repulsion: 0.9, negativeKeywordPenalty: 1 } }
    ],
    [],
    DEFAULT_RANKER_WEIGHTS
  );
  assert.deepEqual(sparse, DEFAULT_RANKER_WEIGHTS);

  // Default threshold requires 10+ total events (>= 3 positives & >= 3 negatives); 6 events remain unchanged
  const posFeats = { collabSim: 0.8, crewMatch: 1, keywordOverlap: 0.9, bayesianRatingNorm: 0.6, noveltyBonus: 0.4, repulsion: 0, negativeKeywordPenalty: 0 };
  const negFeats = { collabSim: 0.1, crewMatch: 0, keywordOverlap: 0.0, bayesianRatingNorm: 0.8, noveltyBonus: 0.1, repulsion: 0.6, negativeKeywordPenalty: 1 };
  const sixEvents = [
    { action: "rated", userRating: 10, features: posFeats },
    { action: "rated", userRating: 9, features: posFeats },
    { action: "added_watchlist", features: posFeats },
    { action: "dismissed", features: negFeats },
    { action: "dismissed", features: negFeats },
    { action: "rated", userRating: 2, features: negFeats }
  ];
  assert.deepEqual(
    derivePersonalizedRankerWeights(sixEvents, [], DEFAULT_RANKER_WEIGHTS),
    DEFAULT_RANKER_WEIGHTS,
    "Default 10-event minimum blocks early weight swings on 6 events"
  );

  // Even 10 total events with fewer than 3 positives keeps prior unchanged
  const imbalancedTen = [
    { action: "rated", userRating: 10, features: posFeats },
    { action: "rated", userRating: 9, features: posFeats },
    ...Array.from({ length: 8 }, () => ({ action: "dismissed", features: negFeats }))
  ];
  assert.deepEqual(
    derivePersonalizedRankerWeights(imbalancedTen, [], DEFAULT_RANKER_WEIGHTS),
    DEFAULT_RANKER_WEIGHTS,
    "Requires at least 3 positives and 3 negatives"
  );

  // Explicit options.minEvents remains configurable, and 10+ balanced events activate regularized adaptation
  const active = derivePersonalizedRankerWeights(sixEvents, [], DEFAULT_RANKER_WEIGHTS, { minEvents: 6 });
  assert.ok(active.crewMatch > DEFAULT_RANKER_WEIGHTS.crewMatch);
  assert.ok(active.repulsion <= -1.0, "repulsion safety floor preserved");
  assert.ok(active.negativeKeywordPenalty <= -0.35, "negativeKeywordPenalty safety floor preserved");
  assert.ok(active.collabSim >= 3.5, "collabSim minimum preserved");
  assert.ok(Math.abs(active.crewMatch - DEFAULT_RANKER_WEIGHTS.crewMatch) <= 0.6 + 1e-9);

  const tenEvents = [
    ...sixEvents,
    { action: "rated", userRating: 9, features: posFeats },
    { action: "rated", userRating: 10, features: posFeats },
    { action: "dismissed", features: negFeats },
    { action: "rated", userRating: 3, features: negFeats }
  ];
  const activeDefault = derivePersonalizedRankerWeights(tenEvents, [], DEFAULT_RANKER_WEIGHTS);
  assert.ok(activeDefault.crewMatch > DEFAULT_RANKER_WEIGHTS.crewMatch);
  assert.ok(activeDefault.repulsion <= -1.0);
});



test("extractTasteProfile eliminates keyword self-collision via net polarity, filters meta tags, applies IDF, and shrinks cast/crew affinities", async () => {
  const watched = [
    // Multi-film auteur director 901 & actor 801 across 3 loved films
    {
      imdbID: "tt001", tmdbId: 1, title: "Love 1", year: "2020", userRating: 10,
      tmdbGenreIds: [9648, 878],
      tmdbKeywords: [818, 179430, 5001, 5002], // 818/179430 meta suppressed; 5001 shared across all films (higher DF)
      crewPersonId: 901, castIds: [801, 802, 803], dateWatched: "2026-10-01"
    },
    {
      imdbID: "tt002", tmdbId: 2, title: "Love 2", year: "2021", userRating: 9,
      tmdbGenreIds: [9648, 18],
      tmdbKeywords: [9663, 187056, 5001, 5002],
      crewPersonId: 901, castIds: [801, 804], dateWatched: "2026-10-02"
    },
    {
      imdbID: "tt003", tmdbId: 3, title: "Love 3", year: "2022", userRating: 9,
      tmdbGenreIds: [878],
      tmdbKeywords: [179431, 5001, 5003],
      crewPersonId: 902, castIds: [805], dateWatched: "2026-10-03"
    },
    // Disliked films carrying keyword 5003 heavily -> should flip 5003 net negative and keep loved/hated disjoint
    {
      imdbID: "tt004", tmdbId: 4, title: "Hate 1", year: "2022", userRating: 2,
      tmdbGenreIds: [27],
      tmdbKeywords: [5001, 5003, 6001],
      crewPersonId: 903, castIds: [806], dateWatched: "2026-10-04"
    },
    {
      imdbID: "tt005", tmdbId: 5, title: "Hate 2", year: "2023", userRating: 2,
      tmdbGenreIds: [27],
      tmdbKeywords: [5003, 6001],
      crewPersonId: 903, castIds: [806], dateWatched: "2026-10-05"
    }
  ];

  const profile = await extractTasteProfile(watched, [], { now: Date.parse("2026-11-01T00:00:00Z") });
  // Meta keyword IDs suppressed
  for (const metaId of [818, 179430, 179431, 187056, 9663]) {
    assert.equal(profile.lovedKeywordIds.includes(metaId), false);
    assert.equal(profile.hatedKeywordIds.includes(metaId), false);
  }
  // Zero overlap between lovedKeywordIds and hatedKeywordIds
  const lovedSet = new Set(profile.lovedKeywordIds);
  assert.ok(profile.hatedKeywordIds.every((id) => !lovedSet.has(id)), "lovedKeywordIds and hatedKeywordIds must be disjoint");
  assert.ok(profile.lovedKeywordIds.includes(5002), "clean loved keyword 5002 retained");
  assert.ok(profile.hatedKeywordIds.includes(6001), "hated keyword 6001 retained");
  assert.ok(profile.keywordAffinities[5002] > 0, "keywordAffinities populated continuously");

  // Bayesian shrinkage: 2-film director 901 beats 1-film director 902; lead actor 801 beats supporting/1-film actor 805
  assert.ok(profile.crewAffinities[901] > profile.crewAffinities[902], "multi-film director gets higher shrunk affinity than 1-film director");
  assert.ok(profile.castAffinities[801] > profile.castAffinities[805], "multi-film lead actor gets higher shrunk affinity than 1-film actor");
  assert.ok(profile.topCrewMemberId === 901 && Array.isArray(profile.topCastIds), "legacy Bucket A/C compatibility fields preserved");

  // Continuous feature extraction uses shrunk affinities
  const fMulti = extractCandidateFeatures({ id: 90, tmdbGenreIds: [9648], tmdbKeywords: [5002], crewPersonId: 901, castIds: [801] }, { profile });
  const fSingle = extractCandidateFeatures({ id: 91, tmdbGenreIds: [9648], tmdbKeywords: [5002], crewPersonId: 902, castIds: [805] }, { profile });
  assert.ok(fMulti.crewMatch > fSingle.crewMatch && fSingle.crewMatch > 0);
  assert.ok(fMulti.castMatch > fSingle.castMatch && fSingle.castMatch > 0);
});

test("Experiment 4 calibrated parameters: 0.35 damping, tau=1.45 order-preserving display calibration, and ranker_weights.json parity", () => {
  assert.equal(DEFAULT_METADATA_DAMPING_FACTOR, 0.35);
  assert.equal(DEFAULT_DISPLAY_TEMPERATURE, 1.45);

  const lowLogit = -0.2;
  const highLogit = 1.8;
  assert.ok(computeDisplayMatchScore(highLogit) > computeDisplayMatchScore(lowLogit), "temperature-scaled display score preserves strict order");
  assert.ok(computeDisplayMatchScore(highLogit) <= 99 && computeDisplayMatchScore(lowLogit) >= 50);

  const jsonPath = path.resolve(process.cwd(), "public/models/ranker_weights.json");
  const diskJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(diskJson._metadataDampingFactor, 0.35);
  assert.equal(diskJson._displayTemperature, 1.45);
  const diskWeights = Object.fromEntries(Object.entries(diskJson).filter(([k]) => !k.startsWith("_")));
  assert.deepEqual(diskWeights, DEFAULT_RANKER_WEIGHTS, "public/models/ranker_weights.json must match DEFAULT_RANKER_WEIGHTS exactly");
});

test("derivePersonalizedRankerWeights ignores already_seen actions and legacy Already seen dismissals", async () => {
  const { derivePersonalizedRankerWeights } = await import("../src/services/onlineLearningService.js");
  const { DEFAULT_RANKER_WEIGHTS } = await import("../src/services/rankerService.js");

  const posFeats = { collabSim: 0.85, crewMatch: 1, keywordOverlap: 0.8, bayesianRatingNorm: 0.7, noveltyBonus: 0.3, repulsion: 0, negativeKeywordPenalty: 0 };
  const negFeats = { collabSim: 0.1, crewMatch: 0, keywordOverlap: 0.0, bayesianRatingNorm: 0.7, noveltyBonus: 0.1, repulsion: 0.8, negativeKeywordPenalty: 1 };

  // 4 positives + 12 already_seen (both explicit action and legacy dismissed/reason="Already seen") -> never counts as negatives
  const events = [
    { action: "rated", userRating: 10, features: posFeats },
    { action: "rated", userRating: 9, features: posFeats },
    { action: "added_watchlist", features: posFeats },
    { action: "rated", userRating: 9, features: posFeats },
    ...Array.from({ length: 6 }, () => ({ action: "already_seen", reason: "Already seen", features: negFeats })),
    ...Array.from({ length: 6 }, () => ({ action: "dismissed", reason: "Already seen", features: negFeats }))
  ];

  const derived = derivePersonalizedRankerWeights(events, [], DEFAULT_RANKER_WEIGHTS);
  assert.deepEqual(derived, DEFAULT_RANKER_WEIGHTS, "already_seen must never supply negative training examples");
});

test("buildDiversifiedGeminiShortlist returns 39 stratified picks (25 core + 8 cold 2024-2026 + 6 diverse outliers) while rankCandidatePool stays pure math", () => {
  const coreNolan = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    tmdbId: i + 1,
    title: `Core SciFi ${i + 1}`,
    year: String(2010 + (i % 10)),
    release_date: `${2010 + (i % 10)}-06-01`,
    director: "Christopher Nolan",
    genre: "Sci-Fi",
    tmdbGenreIds: [878],
    genre_ids: [878],
    vote_average: 8.3,
    vote_count: 4500,
    collabSim: 0.9 - i * 0.01
  }));

  const coldRecent = Array.from({ length: 8 }, (_, i) => ({
    id: 31 + i,
    tmdbId: 31 + i,
    title: `Fresh Cold Gem ${i + 1}`,
    year: String(2024 + (i % 3)),
    release_date: `${2024 + (i % 3)}-05-01`,
    director: `Indie Director ${i + 1}`,
    genre: "Drama, Mystery",
    tmdbGenreIds: [18, 9648],
    genre_ids: [18, 9648],
    vote_average: 7.4,
    vote_count: 320,
    collabSim: 0
  }));

  const coldJunk = [
    {
      id: 39,
      tmdbId: 39,
      title: "Low Rated Cold Trash",
      year: "2025",
      release_date: "2025-03-01",
      director: "Bad Director",
      genre: "Thriller",
      tmdbGenreIds: [53],
      genre_ids: [53],
      vote_average: 4.5,
      vote_count: 800,
      collabSim: 0
    },
    {
      id: 40,
      tmdbId: 40,
      title: "Tiny Vote Cold Outlier",
      year: "2025",
      release_date: "2025-04-01",
      director: "Obscure Director",
      genre: "Drama",
      tmdbGenreIds: [18],
      genre_ids: [18],
      vote_average: 8.2,
      vote_count: 15,
      collabSim: 0
    }
  ];

  const diverseGenres = [16, 35, 10749, 36, 10402, 14, 37, 99, 80, 12];
  const diverseYears = ["1954", "1962", "1974", "1988", "1994", "2001", "1946", "1979", "1999", "2005"];
  const diverseOutliers = Array.from({ length: 10 }, (_, i) => ({
    id: 41 + i,
    tmdbId: 41 + i,
    title: `Diverse Classic ${i + 1}`,
    year: diverseYears[i],
    release_date: `${diverseYears[i]}-08-15`,
    director: `Auteur ${i + 1}`,
    genre: `Genre ${diverseGenres[i]}`,
    tmdbGenreIds: [diverseGenres[i]],
    genre_ids: [diverseGenres[i]],
    vote_average: 8.1,
    vote_count: 2000,
    collabSim: 0.15 - i * 0.005
  }));

  const pool = [...coreNolan, ...coldRecent, ...coldJunk, ...diverseOutliers];
  const context = {
    profile: { lovedGenreIds: [878], hatedKeywordIds: [] },
    collabSimMap: new Map(
      [...coreNolan, ...diverseOutliers, ...Array.from({ length: 15 }, (_, j) => ({ tmdbId: 500 + j, collabSim: 0.05 }))]
        .map((c) => [c.tmdbId, c.collabSim])
    )
  };

  const shortlist = buildDiversifiedGeminiShortlist(pool, context, DEFAULT_RANKER_WEIGHTS);
  assert.equal(shortlist.length, 39, "Default shortlist returns 39 diversified candidates");

  const ids = new Set(shortlist.map((c) => c.tmdbId));
  for (let id = 1; id <= 25; id++) {
    assert.ok(ids.has(id), `Expected core #${id} in first 25 slots`);
  }
  for (let id = 31; id <= 38; id++) {
    assert.ok(ids.has(id), `Expected quality cold 2024-2026 #${id} in shortlist`);
  }
  assert.equal(ids.has(39), false, "Must reject 4.5★ cold junk");
  assert.equal(ids.has(40), false, "Must reject <40-vote cold item");

  const outlierCount = shortlist.filter((c) => c.tmdbId >= 41 && c.tmdbId <= 50).length;
  assert.equal(outlierCount, 6, "Expected 6 diverse director/genre/decade outliers");

  const pureMathTop30 = rankCandidatePool(pool, context, DEFAULT_RANKER_WEIGHTS, 30);
  assert.deepEqual(
    pureMathTop30.map((c) => c.tmdbId),
    Array.from({ length: 30 }, (_, i) => i + 1),
    "rankCandidatePool remains pure mathematical ordering untouched"
  );
});

test("buildDiversifiedGeminiShortlist fires onDiagnostics at most once and never re-introduces mood-gate or provider-rejected items", () => {
  const comfortWarm = Array.from({ length: 28 }, (_, i) => ({
    id: 200 + i,
    tmdbId: 200 + i,
    title: `Warm Comedy ${i + 1}`,
    year: "2018",
    release_date: "2018-04-01",
    director: "Warm Director",
    genre: "Comedy, Family",
    tmdbGenreIds: [35, 10751],
    genre_ids: [35, 10751],
    vote_average: 7.5,
    vote_count: 900,
    streamProviders: [{ id: 8, name: "Netflix" }],
    collabSim: 0.4 - i * 0.005
  }));
  const rejectedColdHorror = {
    id: 301,
    tmdbId: 301,
    title: "Slasher 2025",
    year: "2025",
    release_date: "2025-05-01",
    director: "Scary Director",
    genre: "Horror, Thriller",
    tmdbGenreIds: [27, 53],
    genre_ids: [27, 53],
    vote_average: 8.0,
    vote_count: 600,
    streamProviders: [{ id: 8, name: "Netflix" }],
    collabSim: 0
  };
  const wrongProviderCold = {
    id: 302,
    tmdbId: 302,
    title: "Wrong Streamer 2025",
    year: "2025",
    release_date: "2025-05-01",
    director: "Other Director",
    genre: "Comedy",
    tmdbGenreIds: [35],
    genre_ids: [35],
    vote_average: 8.2,
    vote_count: 500,
    streamProviders: [{ id: 15, name: "Hulu" }],
    collabSim: 0
  };
  const validColdComedy = {
    id: 303,
    tmdbId: 303,
    title: "Cozy Cold 2025",
    year: "2025",
    release_date: "2025-05-01",
    director: "Cozy Auteur",
    genre: "Comedy, Family",
    tmdbGenreIds: [35, 10751],
    genre_ids: [35, 10751],
    vote_average: 7.7,
    vote_count: 450,
    streamProviders: [{ id: 8, name: "Netflix" }],
    collabSim: 0
  };

  let diagCalls = 0;
  let lastDiag = null;
  const shortlist = buildDiversifiedGeminiShortlist(
    [...comfortWarm, rejectedColdHorror, wrongProviderCold, validColdComedy],
    { mood: "comfort-watch", userProviders: [8], profile: { lovedGenreIds: [35] } },
    DEFAULT_RANKER_WEIGHTS,
    { onDiagnostics: (d) => { diagCalls++; lastDiag = d; } },
    null
  );

  assert.equal(diagCalls, 1, "onDiagnostics must fire at most once (fullRanked must not double-fire)");
  assert.equal(lastDiag?.targetCount, 25, "Diagnostic targetCount reflects core pass, not pool.length");
  assert.ok(!shortlist.some((c) => c.tmdbId === 301), "Must never re-introduce comfort-watch gate-rejected Horror film");
  assert.ok(!shortlist.some((c) => c.tmdbId === 302), "Must respect userProviders filtering cleanly");
  assert.ok(shortlist.some((c) => c.tmdbId === 303), "Includes valid cold comfort-watch film on matching provider");
});
