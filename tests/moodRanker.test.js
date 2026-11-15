import test from "node:test";
import assert from "node:assert/strict";
import { buildBucketAParams, fetchCandidatePool } from "../src/services/tmdbService.js";
import {
  DEFAULT_RANKER_WEIGHTS,
  rankCandidatePool,
  buildDiversifiedGeminiShortlist,
  computeMoodScoreAdjustment
} from "../src/services/rankerService.js";

test("buildBucketAParams keeps legacy any behavior while liberating explicit moods and custom filters", () => {
  const darkProfile = {
    lovedGenreIds: [53, 80, 18, 878], // Thriller, Crime, Drama, Sci-Fi
    watchlistGenreIds: [9648],
    hatedKeywordIds: [999],
    topCastIds: [3894, 500] // e.g., Christian Bale, Tom Cruise
  };

  // Legacy "any": preserves lovedGenreIds + watchlistGenreIds and with_cast
  const anyParams = buildBucketAParams(darkProfile, "any", {}, "test-key");
  assert.equal(anyParams.get("with_cast"), "3894|500");
  assert.ok(anyParams.get("with_genres").includes("53"));
  assert.equal(anyParams.get("vote_count.lte"), null);

  // "comfort-watch": drops with_cast, focuses Comedy/Family/Romance/Animation, drops Thriller/Crime/Horror
  const comfortParams = buildBucketAParams(darkProfile, "comfort-watch", {}, "test-key");
  assert.equal(comfortParams.get("with_cast"), null);
  assert.equal(comfortParams.get("with_genres"), "35|10751|10749|16");
  assert.ok(comfortParams.get("without_genres").includes("27"));

  // "hidden-gem": adds vote_count.lte ceiling and relaxes with_cast
  const gemParams = buildBucketAParams(darkProfile, "hidden-gem", {}, "test-key");
  assert.equal(gemParams.get("with_cast"), null);
  assert.equal(gemParams.get("vote_count.lte"), "2000");

  // Custom moodFilters + pagination
  const customParams = buildBucketAParams(
    darkProfile,
    "any",
    {
      page: 2,
      moodFilters: {
        query: "90s comedy",
        withGenreIds: [35],
        minYear: 1990,
        maxYear: 1999
      }
    },
    "test-key"
  );
  assert.equal(customParams.get("with_cast"), null);
  assert.equal(customParams.get("with_genres"), "35");
  assert.equal(customParams.get("primary_release_date.gte"), "1990-01-01");
  assert.equal(customParams.get("primary_release_date.lte"), "1999-12-31");
  assert.equal(customParams.get("page"), "2");
});

test("fetchCandidatePool promotes Bucket A quota under explicit mood and filters excludeIds", async () => {
  const makeItems = (prefix, count, baseId) =>
    Array.from({ length: count }, (_, i) => ({
      id: baseId + i,
      title: `${prefix} Movie ${i + 1}`,
      overview: `Overview for ${prefix} ${i + 1}`,
      release_date: "2018-05-01",
      vote_average: 7.6,
      vote_count: 800,
      genre_ids: prefix === "A" ? [35, 10751] : (i % 2 === 0 ? [35, 10749] : [80, 53])
    }));

  const fetcher = async (url) => {
    const parsed = new URL(url);
    const body = (() => {
      if (parsed.pathname.includes("/keywords") || parsed.pathname.endsWith("/movie/55")) {
        return { keywords: { keywords: [{ id: 101 }] }, credits: { crew: [] } };
      }
      if (parsed.searchParams.has("with_keywords")) return { results: makeItems("B", 20, 2000) };
      if (parsed.searchParams.has("with_crew")) return { results: makeItems("C", 15, 3000) };
      if (parsed.searchParams.has("primary_release_date.gte") && !parsed.searchParams.has("with_watch_providers")) {
        return { results: makeItems("D", 5, 4000) };
      }
      return { results: makeItems("A", 30, 1000) };
    })();
    return { ok: true, status: 200, json: async () => body };
  };

  const profile = {
    anchorTmdbId: 55,
    topCrewMemberId: 77,
    lovedGenreIds: [80, 53],
    watchlistGenreIds: [],
    hatedKeywordIds: [],
    topCastIds: [99]
  };
  const watched = [1, 2, 3, 4].map((i) => ({ id: `w${i}`, title: `Watched ${i}`, userRating: 9 }));

  const comfortPool = await fetchCandidatePool(profile, "comfort-watch", watched, [], {
    apiKey: "test-key",
    poolSize: 20,
    excludeIds: [1000, "1001"],
    fetchFn: fetcher
  });

  const bucketACount = comfortPool.filter((c) => c.sourceBucket?.startsWith("Bucket A")).length;
  const bucketBCount = comfortPool.filter((c) => c.sourceBucket?.startsWith("Bucket B")).length;
  const bucketCCount = comfortPool.filter((c) => c.sourceBucket?.startsWith("Bucket C")).length;
  assert.ok(bucketBCount > 0 && bucketBCount <= 4, `Expected capped Bucket B (1..4), got ${bucketBCount}`);
  assert.ok(bucketCCount > 0 && bucketCCount <= 2, `Expected capped Bucket C (1..2), got ${bucketCCount}`);
  assert.ok(bucketACount >= 14, `Expected Bucket A >= 14/20 under explicit mood, got ${bucketACount}`);
  assert.ok(!comfortPool.some((c) => c.tmdbId === 1000 || c.tmdbId === 1001), "excludeIds must be filtered");
  assert.ok(comfortPool.every((c) => !c.genre_ids.includes(80)), "off-mood Crime/Thriller items from Bucket B/C must be filtered out");
});

test("rankCandidatePool preserves exact baseline on any and reorders distinctly per mood", () => {
  const darkProfile = { lovedGenreIds: [80, 53, 18] };
  const candidates = [
    {
      tmdbId: 101,
      title: "Grim Dark Thriller",
      tmdbGenreIds: [80, 53, 18],
      vote_average: 8.2,
      vote_count: 22000,
      collabSim: 0.65,
      year: "2013",
      overview: "A brutal detective hunt in the rain."
    },
    {
      tmdbId: 102,
      title: "Warm Comfort Comedy",
      tmdbGenreIds: [35, 10751],
      vote_average: 7.7,
      vote_count: 2500,
      collabSim: 0.2,
      year: "1998",
      overview: "A heartwarming family comedy about second chances."
    },
    {
      tmdbId: 103,
      title: "Small Cult Mystery Gem",
      tmdbGenreIds: [9648, 18],
      vote_average: 7.9,
      vote_count: 650,
      collabSim: 0.15,
      year: "2011",
      overview: "An enigmatic slow-burn indie puzzle."
    },
    {
      tmdbId: 104,
      title: "Cerebral Sci-Fi Twist",
      tmdbGenreIds: [878, 9648],
      vote_average: 8.0,
      vote_count: 6000,
      collabSim: 0.35,
      year: "2016",
      overview: "Nonlinear time-loop paradox thriller."
    }
  ];

  // 1. "any" invariance
  assert.equal(computeMoodScoreAdjustment(candidates[0], "any", null), 0);
  const baseRanked = rankCandidatePool(candidates, { profile: darkProfile }, DEFAULT_RANKER_WEIGHTS, 4);
  const anyRanked = rankCandidatePool(candidates, { profile: darkProfile, mood: "any" }, DEFAULT_RANKER_WEIGHTS, 4);
  assert.deepEqual(anyRanked.map((c) => c.tmdbId), baseRanked.map((c) => c.tmdbId));
  assert.deepEqual(anyRanked.map((c) => c.rankerLogit), baseRanked.map((c) => c.rankerLogit));

  // 2. Comfort Watch beats Grim Dark Thriller despite lower collabSim
  const comfortRanked = rankCandidatePool(
    candidates,
    { profile: darkProfile, mood: "comfort-watch" },
    DEFAULT_RANKER_WEIGHTS,
    4
  );
  assert.equal(comfortRanked[0].tmdbId, 102);

  // 3. Hidden Gem beats 22k-vote Dark Thriller
  const gemRanked = rankCandidatePool(
    candidates,
    { profile: darkProfile, mood: "hidden-gem" },
    DEFAULT_RANKER_WEIGHTS,
    4
  );
  assert.equal(gemRanked[0].tmdbId, 103);

  // 4. Mind-Bending favors Sci-Fi/Mystery over Grim Crime
  const mindRanked = rankCandidatePool(
    candidates,
    { profile: darkProfile, mood: "mind-bending" },
    DEFAULT_RANKER_WEIGHTS,
    4
  );
  assert.equal(mindRanked[0].tmdbId, 104);

  // 5. Custom filter + excludeIds enforces strict mood gate without leaking rejected items
  let shortfallDiag = null;
  const filtered = rankCandidatePool(
    candidates,
    {
      profile: darkProfile,
      mood: "any",
      excludeIds: [101, "103"],
      moodFilters: {
        withGenreIds: [35],
        withoutKeywords: ["paradox"],
        minYear: 1995,
        maxYear: 2005
      }
    },
    DEFAULT_RANKER_WEIGHTS,
    4,
    { onDiagnostics: (diag) => { shortfallDiag = diag; } }
  );
  assert.deepEqual(filtered.map((c) => c.tmdbId), [102]);
  assert.equal(filtered.some((c) => c.tmdbId === 104), false, "strict mood gate must not pad with gateRejected items");
  assert.deepEqual(shortfallDiag?.moodShortfall, { requested: 4, available: 1 });
});

test("rankCandidatePool strictly excludes hydrated non-selected streaming providers when userProviders is active", () => {
  const profile = { lovedGenreIds: [28, 35, 878] };
  const makeOnNetflixOrMax = (id, title, provId, provName, collabSim) => ({
    tmdbId: id,
    title,
    tmdbGenreIds: [28, 878],
    vote_average: 7.7,
    vote_count: 5000,
    collabSim,
    year: "2020",
    streamProviders: [{ id: provId, name: provName }],
    providersHydrated: true,
    providerMatchedByQuery: true
  });

  const pool = [
    {
      tmdbId: 293660,
      title: "Deadpool",
      tmdbGenreIds: [28, 12, 35],
      vote_average: 8.0,
      vote_count: 30000,
      collabSim: 0.99,
      year: "2016",
      streamProviders: [{ id: 337, name: "Disney Plus" }],
      providersHydrated: true,
      providerMatchedByQuery: false
    },
    ...Array.from({ length: 10 }, (_, i) =>
      makeOnNetflixOrMax(
        500 + i,
        `Valid Pick ${i + 1}`,
        i % 2 === 0 ? 1796 : 384,
        i % 2 === 0 ? "Netflix Standard with Ads" : "HBO Max",
        0.25 - i * 0.01
      )
    )
  ];

  const ranked = rankCandidatePool(
    pool,
    { profile, mood: "any", userProviders: [8, 1899] },
    DEFAULT_RANKER_WEIGHTS,
    10
  );

  assert.equal(ranked.length, 10);
  assert.equal(ranked.some((c) => c.tmdbId === 293660), false, "Disney+ Deadpool must be excluded for Netflix/Max");
});

test("rankCandidatePool separates all 5 explicit moods on a shared pool even when off-mood blockbusters have 3x collabSim", () => {
  const darkProfile = { lovedGenreIds: [28, 18, 878] };
  const pool = [
    // Off-mood high-collab blockbuster traps
    { tmdbId: 1, title: "V for Vendetta", tmdbGenreIds: [28, 53, 878], vote_average: 7.9, vote_count: 14500, collabSim: 0.96, year: "2006" },
    { tmdbId: 2, title: "The Martian", tmdbGenreIds: [18, 12, 878], vote_average: 8.0, vote_count: 19500, collabSim: 0.94, year: "2015" },
    { tmdbId: 3, title: "Edge of Tomorrow", tmdbGenreIds: [28, 878], vote_average: 7.9, vote_count: 13500, collabSim: 0.92, year: "2014" },
    // Mind-Bending pure cerebral puzzle
    { tmdbId: 10, title: "Ex Machina", tmdbGenreIds: [18, 878, 9648], vote_average: 7.7, vote_count: 12000, collabSim: 0.30, year: "2015" },
    // Dark Thriller neo-noir
    { tmdbId: 11, title: "Prisoners", tmdbGenreIds: [80, 53, 18], vote_average: 8.1, vote_count: 11000, collabSim: 0.28, year: "2013" },
    // Fun Popcorn
    { tmdbId: 12, title: "Mad Max: Fury Road", tmdbGenreIds: [28, 12], vote_average: 7.6, vote_count: 21000, collabSim: 0.28, year: "2015" },
    // Comfort Watch
    { tmdbId: 13, title: "Paddington 2", tmdbGenreIds: [12, 35, 10751], vote_average: 7.8, vote_count: 2300, collabSim: 0.22, year: "2017" },
    // Hidden Gem
    { tmdbId: 14, title: "Coherence", tmdbGenreIds: [53, 878], vote_average: 7.4, vote_count: 1450, collabSim: 0.20, year: "2013" }
  ];

  const top1For = (mood) => rankCandidatePool(pool, { profile: darkProfile, mood }, DEFAULT_RANKER_WEIGHTS, 3)[0];

  assert.equal(top1For("mind-bending").title, "Ex Machina");
  assert.equal(top1For("dark-thriller").title, "Prisoners");
  assert.equal(top1For("comfort-watch").title, "Paddington 2");
  assert.equal(top1For("hidden-gem").title, "Coherence");
  const funTop = rankCandidatePool(pool, { profile: darkProfile, mood: "fun-popcorn" }, DEFAULT_RANKER_WEIGHTS, 3);
  assert.ok([2, 3, 12].includes(funTop[0].tmdbId));
  assert.equal(funTop.some((c) => c.title === "Prisoners"), false);
});

test("buildBucketAParams applies only unqualified avoidGenreIds from tasteRules and leaves qualified dramas unbanned", () => {
  const baseProfile = { lovedGenreIds: [18, 878], watchlistGenreIds: [], hatedKeywordIds: [], topCastIds: [] };

  const horrorAvoidParams = buildBucketAParams(
    baseProfile,
    "any",
    {
      tasteRules: [
        { id: "r1", text: "No horror or musicals", polarity: "avoid", active: true },
        { id: "r2", text: "No westerns", polarity: "avoid", active: false }
      ]
    },
    "test-key"
  );
  const withoutHorror = (horrorAvoidParams.get("without_genres") || "").split(",").filter(Boolean);
  assert.ok(withoutHorror.includes("27"), "Unqualified 'No horror' must exclude 27");
  assert.ok(withoutHorror.includes("10402"), "Unqualified 'musicals' must exclude 10402");
  assert.equal(withoutHorror.includes("37"), false, "Inactive western rule must not exclude 37");

  const periodDramaParams = buildBucketAParams(
    baseProfile,
    "any",
    {
      tasteRules: [{ id: "r3", text: "No slow-burn period dramas", polarity: "avoid", active: true }]
    },
    "test-key"
  );
  const withoutPeriod = (periodDramaParams.get("without_genres") || "").split(",").filter(Boolean);
  assert.equal(withoutPeriod.includes("18"), false, "Qualified 'No slow-burn period dramas' must NOT ban Drama (18)");
});

test("rankCandidatePool applies -3.5 avoid penalty, +0.6 prefer boost, 0 delta when empty, and filters shortlist cold/outlier avoid hits", () => {
  const profile = { lovedGenreIds: [18, 878] };
  const pool = [
    {
      id: 901,
      tmdbId: 901,
      title: "Courtly Period Drama",
      year: "2020",
      release_date: "2020-04-01",
      genre: "History, Drama",
      tmdbGenreIds: [36, 18],
      vote_average: 7.8,
      vote_count: 2000,
      collabSim: 0.7,
      overview: "A restrained slow-burn period drama in 18th century France."
    },
    {
      id: 902,
      tmdbId: 902,
      title: "Neon Cyberpunk Mystery",
      year: "2021",
      release_date: "2021-05-01",
      genre: "Sci-Fi, Thriller",
      tmdbGenreIds: [878, 53],
      vote_average: 7.6,
      vote_count: 2000,
      collabSim: 0.55,
      overview: "A sleek cyberpunk noir detective thriller."
    },
    {
      id: 903,
      tmdbId: 903,
      title: "Neutral Drama",
      year: "2021",
      release_date: "2021-06-01",
      genre: "Drama",
      tmdbGenreIds: [18],
      vote_average: 7.6,
      vote_count: 2000,
      collabSim: 0.55,
      overview: "A grounded contemporary courtroom story."
    }
  ];

  const baseRanked = rankCandidatePool(pool, { profile }, DEFAULT_RANKER_WEIGHTS, 10);
  const emptyRuleRanked = rankCandidatePool(pool, { profile, tasteRules: [] }, DEFAULT_RANKER_WEIGHTS, 10);
  assert.deepEqual(
    emptyRuleRanked.map((c) => [c.tmdbId, c.rankerLogit, c.matchScore]),
    baseRanked.map((c) => [c.tmdbId, c.rankerLogit, c.matchScore]),
    "Empty tasteRules must produce bit-for-bit identical logits and scores"
  );

  const tasteRules = [
    { id: "a1", text: "No slow-burn period dramas", polarity: "avoid", active: true },
    { id: "p1", text: "Prefer cyberpunk noir", polarity: "prefer", active: true }
  ];
  const steeredRanked = rankCandidatePool(pool, { profile, tasteRules }, DEFAULT_RANKER_WEIGHTS, 10);
  const byId = (arr, id) => arr.find((c) => c.tmdbId === id);

  assert.ok(
    Math.abs((byId(steeredRanked, 901).rankerLogit - byId(baseRanked, 901).rankerLogit) - (-3.5)) < 1e-6,
    "Avoid match must receive -3.5 logit penalty"
  );
  assert.ok(
    Math.abs((byId(steeredRanked, 902).rankerLogit - byId(baseRanked, 902).rankerLogit) - 0.6) < 1e-6,
    "Prefer match must receive +0.6 logit boost"
  );
  assert.ok(
    Math.abs(byId(steeredRanked, 903).rankerLogit - byId(baseRanked, 903).rankerLogit) < 1e-6,
    "Unrelated Drama must receive 0 logit change"
  );

  // buildDiversifiedGeminiShortlist rejects avoid-rule matches in Slice 2 (cold 2024-2026) and Slice 3 (outliers)
  const coreMovies = Array.from({ length: 26 }, (_, i) => ({
    id: 1000 + i,
    tmdbId: 1000 + i,
    title: `Core Pick ${i}`,
    year: "2018",
    release_date: "2018-03-01",
    director: `Dir ${i}`,
    genre: "Sci-Fi",
    tmdbGenreIds: [878],
    vote_average: 8.2,
    vote_count: 5000,
    collabSim: 0.9 - i * 0.01,
    overview: "Crisp futuristic thriller."
  }));
  const avoidedCold = {
    id: 2001,
    tmdbId: 2001,
    title: "Cold Period Romance 2025",
    year: "2025",
    release_date: "2025-02-01",
    director: "Period Dir",
    genre: "Drama, History",
    tmdbGenreIds: [18, 36],
    vote_average: 8.6,
    vote_count: 3000,
    collabSim: 0,
    overview: "A quiet slow-burn period drama in 19th-century England."
  };
  const avoidedOutlier = {
    id: 2002,
    tmdbId: 2002,
    title: "Outlier Period Saga",
    year: "1995",
    release_date: "1995-05-01",
    director: "Outlier Dir",
    genre: "History, Drama",
    tmdbGenreIds: [36, 18],
    vote_average: 8.8,
    vote_count: 4500,
    collabSim: 0.05,
    overview: "An aristocratic slow-burn period drama."
  };
  const cleanExtras = Array.from({ length: 20 }, (_, i) => ({
    id: 3000 + i,
    tmdbId: 3000 + i,
    title: `Clean Extra ${i}`,
    year: i < 10 ? "2025" : "2012",
    release_date: i < 10 ? "2025-04-01" : "2012-04-01",
    director: `Clean Dir ${i}`,
    genre: "Thriller",
    tmdbGenreIds: [53],
    vote_average: 7.7,
    vote_count: 1500,
    collabSim: i < 10 ? 0 : 0.1,
    overview: "Fast-paced investigation."
  }));

  const shortlist = buildDiversifiedGeminiShortlist(
    [...coreMovies, avoidedCold, avoidedOutlier, ...cleanExtras],
    { profile, tasteRules: [{ id: "a1", text: "No slow-burn period dramas", polarity: "avoid", active: true }] },
    DEFAULT_RANKER_WEIGHTS,
    { shortlistLimit: 39 }
  );

  assert.equal(shortlist.some((c) => c.tmdbId === 2001), false, "Shortlist Slice 2 cold slots must reject avoid-rule matches");
  assert.equal(shortlist.some((c) => c.tmdbId === 2002), false, "Shortlist Slice 3 outlier slots must reject avoid-rule matches");
});

test("rankCandidatePool excludes avoidRules matches from explicit mood gatePassed and updates diagnostics accurately", () => {
  const profile = { lovedGenreIds: [878, 9648] };
  const pool = [
    {
      id: 951,
      tmdbId: 951,
      title: "Clean Cerebral Puzzle",
      year: "2020",
      genre: "Sci-Fi, Mystery",
      tmdbGenreIds: [878, 9648],
      vote_average: 7.9,
      vote_count: 2500,
      collabSim: 0.7,
      overview: "A tight time-paradox investigation inside a research station."
    },
    {
      id: 952,
      tmdbId: 952,
      title: "Amnesia Twist Mystery",
      year: "2021",
      genre: "Sci-Fi, Mystery",
      tmdbGenreIds: [878, 9648],
      vote_average: 8.1,
      vote_count: 3500,
      collabSim: 0.85,
      overview: "An investigator uncovers an amnesia twist after a lab accident."
    }
  ];

  let diag = null;
  const ranked = rankCandidatePool(
    pool,
    {
      profile,
      mood: "mind-bending",
      tasteRules: [{ id: "a_amnesia", text: "Avoid amnesia twist", polarity: "avoid", active: true }]
    },
    DEFAULT_RANKER_WEIGHTS,
    2,
    {
      onDiagnostics: (d) => {
        diag = d;
      }
    }
  );

  assert.equal(ranked.length, 1, "Explicit mood gate must exclude avoid-rule match even when mood genre gates pass");
  assert.equal(ranked[0].tmdbId, 951);
  assert.equal(diag?.gatePassedCount, 1);
  assert.equal(diag?.gateRejectedCount, 1);
  assert.deepEqual(diag?.moodShortfall, { requested: 2, available: 1 });
});
