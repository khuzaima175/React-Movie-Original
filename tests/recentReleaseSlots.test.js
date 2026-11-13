import test from "node:test";
import assert from "node:assert/strict";

test("buildBucketDParams sets 18-month release floor, top 3 loved genres, hated keywords, region/providers, and no with_cast", async () => {
  const { buildBucketDParams, getRecentReleaseDateFloor } = await import("../src/services/tmdbService.js");
  assert.equal(typeof getRecentReleaseDateFloor, "function");
  assert.equal(typeof buildBucketDParams, "function");

  const fixedNow = Date.UTC(2026, 10, 13); // 2026-11-13 -> 2025-05-13
  assert.equal(getRecentReleaseDateFloor(18, fixedNow), "2025-05-13");
  // End-of-month clamping: 2026-08-31 minus 18 months -> Feb 2025 (28 days), not March rollover
  assert.equal(getRecentReleaseDateFloor(18, Date.UTC(2026, 7, 31)), "2025-02-28");

  const params = buildBucketDParams(
    {
      lovedGenreIds: [18, 80, 53, 35], // top 3 only -> 18|80|53
      hatedKeywordIds: [901, 902],
      topCastIds: [500, 600] // must be ignored (NO with_cast)
    },
    { userRegion: "GB", userProviders: ["netflix", "criterion"], now: fixedNow },
    "TEST_KEY"
  );

  assert.equal(params.get("primary_release_date.gte"), "2025-05-13");
  assert.equal(params.get("sort_by"), "popularity.desc");
  assert.equal(params.get("vote_count.gte"), "150");
  assert.equal(params.get("vote_average.gte"), "7.0");
  assert.equal(params.get("include_adult"), "false");
  assert.equal(params.get("with_genres"), "18|80|53");
  assert.equal(params.get("without_keywords"), "901|902");
  assert.equal(params.has("with_cast"), false);
  assert.equal(params.get("with_watch_providers"), "8|258");
  assert.equal(params.get("watch_region"), "GB");
});

test("fetchBucketD caps at 2 pages and 12 candidates after dedupe/collision filtering tagged sourceBucket 'D'", async () => {
  const { fetchBucketD } = await import("../src/services/tmdbService.js");
  assert.equal(typeof fetchBucketD, "function");

  const requestedUrls = [];
  const makeMovie = (id, title = `Recent ${id}`) => ({
    id,
    title,
    overview: "Recent overview.",
    release_date: "2025-11-01",
    vote_average: 7.4,
    vote_count: 250,
    popularity: 80 - id,
    genre_ids: [18]
  });

  // Page 1 returns 10 items (2 watched/existing collisions -> 8 valid)
  // Page 2 returns 10 items (1 intra-D duplicate -> must stop at total 12!)
  // Page 3 exists but must never be fetched
  const page1 = [
    makeMovie(1, "Already Watched"),
    makeMovie(2, "Existing In Pool"),
    ...Array.from({ length: 8 }, (_, i) => makeMovie(100 + i))
  ];
  const page2 = [
    makeMovie(100, "Recent 100"), // duplicate within Bucket D
    ...Array.from({ length: 10 }, (_, i) => makeMovie(200 + i))
  ];
  const page3 = [makeMovie(300)];

  const fakeFetch = async (url) => {
    requestedUrls.push(String(url));
    const parsed = new URL(String(url));
    const p = Number(parsed.searchParams.get("page") || 1);
    const results = p === 1 ? page1 : p === 2 ? page2 : page3;
    return { ok: true, json: async () => ({ results }) };
  };

  const prevKey = process.env.VITE_TMDB_KEY;
  process.env.VITE_TMDB_KEY = "FAKE_KEY";
  try {
    const out = await fetchBucketD(
      { lovedGenreIds: [18, 53], hatedKeywordIds: [] },
      { fetchFn: fakeFetch, now: Date.UTC(2026, 10, 13) },
      {
        watchedIdSet: new Set(["1"]),
        watchedTitleSet: new Set(),
        watchlistTitleSet: new Set()
      },
      new Set([2])
    );

    assert.equal(requestedUrls.length, 2, "must fetch at most 2 pages");
    assert.equal(out.length, 12, "must cap at 12 candidates after filtering");
    assert.ok(out.every(c => c.sourceBucket === "D"), "every Bucket D item must have sourceBucket === 'D'");
    const ids = out.map(c => c.tmdbId);
    assert.equal(new Set(ids).size, 12, "no duplicates");
    assert.equal(ids.includes(1), false);
    assert.equal(ids.includes(2), false);
  } finally {
    if (prevKey === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevKey;
  }
});

test("fetchCandidatePool appends Bucket D after basePool without changing other buckets' counts", async () => {
  const { fetchCandidatePool } = await import("../src/services/tmdbService.js");
  const prevKey = process.env.VITE_TMDB_KEY;
  const prevFetch = globalThis.fetch;
  process.env.VITE_TMDB_KEY = "FAKE_KEY";

  const makeItem = (id, rd = "2020-01-01") => ({
    id,
    title: `Film ${id}`,
    overview: "Overview text.",
    release_date: rd,
    vote_average: 7.5,
    vote_count: 600,
    popularity: 50,
    genre_ids: [18]
  });

  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/discover/movie")) {
      const sp = u.searchParams;
      if (sp.has("primary_release_date.gte")) {
        // Bucket D: return 5 new recent items + 1 colliding item from Bucket B (1001)
        return {
          ok: true,
          json: async () => ({
            results: [
              makeItem(1001, "2025-10-01"),
              makeItem(9001, "2025-10-01"),
              makeItem(9002, "2025-11-01"),
              makeItem(9003, "2026-01-01"),
              makeItem(9004, "2026-02-01"),
              makeItem(9005, "2026-03-01")
            ]
          })
        };
      }
      if (sp.has("with_keywords")) {
        // Bucket B (target 8)
        return { ok: true, json: async () => ({ results: Array.from({ length: 8 }, (_, i) => makeItem(1001 + i)) }) };
      }
      if (sp.has("with_crew")) {
        // Bucket C (target 4)
        return { ok: true, json: async () => ({ results: Array.from({ length: 4 }, (_, i) => makeItem(2001 + i)) }) };
      }
      // Bucket A (fills remaining 8 of poolSize=20)
      return { ok: true, json: async () => ({ results: Array.from({ length: 12 }, (_, i) => makeItem(3001 + i)) }) };
    }
    if (u.pathname.includes("/keywords") || u.pathname.endsWith("/movie/777")) {
      return { ok: true, json: async () => ({ keywords: { keywords: [{ id: 10 }] }, credits: { crew: [] } }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  try {
    const watched = [
      { id: 50, tmdbId: 50, title: "W1", userRating: 9 },
      { id: 51, tmdbId: 51, title: "W2", userRating: 9 },
      { id: 52, tmdbId: 52, title: "W3", userRating: 9 }
    ];
    const profile = {
      lovedGenreIds: [18, 80, 53],
      hatedKeywordIds: [],
      topCastIds: [],
      topCrewMemberId: 888,
      anchorTmdbId: 777
    };

    const pool = await fetchCandidatePool(profile, "any", watched, [], { poolSize: 20 });
    const countB = pool.filter(c => c.sourceBucket?.includes("Bucket B")).length;
    const countC = pool.filter(c => c.sourceBucket?.includes("Bucket C")).length;
    const countA = pool.filter(c => c.sourceBucket?.includes("Bucket A")).length;
    const countD = pool.filter(c => c.sourceBucket === "D").length;

    assert.equal(countB, 8);
    assert.equal(countC, 4);
    assert.equal(countA, 8);
    assert.equal(countB + countC + countA, 20, "base pool buckets remain intact at poolSize=20");
    assert.equal(countD, 5, "Bucket D appends only non-colliding recent items");
    assert.equal(pool.length, 25);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevKey;
  }
});

test("rankCandidatePool reserve fills qualifying recent slots, obeys percentile floor, does nothing when empty, and never duplicates", async () => {
  const { rankCandidatePool } = await import("../src/services/rankerService.js");

  // 30 candidates:
  // - Classics 1..10 have strong collabSim -> occupy top 10.
  // - Top non-collab classics 11..13 (collabSim=0, crewMatch=1, vote_average=8.8) anchor the top >=90th percentile of nonCollab.
  // - Qualifying recent 26..28 (collabSim=0, vote_average=7.8, genre=[18]) beat the 50th percentile of nonCollab and >= 0.54.
  // - Lower non-collab classics 14..25 & weak recent 29..30 sit below them.
  const candidates = [];
  const collabSimMap = new Map();

  for (let i = 1; i <= 10; i++) {
    candidates.push({
      id: i,
      tmdbId: i,
      title: `Top Classic ${i}`,
      release_date: "1995-05-01",
      genre_ids: [18],
      vote_average: 8.2,
      vote_count: 1500
    });
    collabSimMap.set(i, 0.98 - (i - 1) * 0.03); // 0.98 down to 0.71
  }
  for (let i = 11; i <= 13; i++) {
    candidates.push({
      id: i,
      tmdbId: i,
      title: `Top NonCollab Classic ${i}`,
      release_date: "1995-05-01",
      genre_ids: [18],
      crewPersonId: 999,
      vote_average: 8.8,
      vote_count: 2000
    });
  }
  for (const [idx, tid] of [[0, 26], [1, 27], [2, 28]]) {
    candidates.push({
      id: tid,
      tmdbId: tid,
      title: `Qualifying Recent ${idx}`,
      release_date: "2025-10-01",
      genre_ids: [18],
      vote_average: 7.8,
      vote_count: 800
    });
  }
  for (let i = 14; i <= 25; i++) {
    candidates.push({
      id: i,
      tmdbId: i,
      title: `Lower Classic ${i}`,
      release_date: "1995-05-01",
      genre_ids: [99],
      vote_average: 6.2,
      vote_count: 1000
    });
  }
  for (const [idx, tid] of [[0, 29], [1, 30]]) {
    candidates.push({
      id: tid,
      tmdbId: tid,
      title: `Weak Recent ${idx}`,
      release_date: "2026-02-01",
      genre_ids: [99],
      vote_average: 5.5,
      vote_count: 60
    });
  }

  const ctx = {
    profile: { lovedGenreIds: [18], hatedKeywordIds: [], topCrewMemberId: 999 },
    collabSimMap
  };

  // Baseline without reserve (top 10 must be classics 1..10)
  const baselineTop10 = rankCandidatePool(candidates, ctx, undefined, 10);
  assert.equal(baselineTop10.length, 10);
  assert.deepEqual(baselineTop10.map(c => c.tmdbId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  // 1. Reserve fills all 3 slots with qualifying recent films (26, 27, 28) and sorts by rankerProbability
  const withReserve = rankCandidatePool(
    candidates,
    ctx,
    undefined,
    10,
    {},
    { count: 3, minReleaseDate: "2025-05-13", minProbabilityPercentile: 0.5 }
  );
  assert.equal(withReserve.length, 10);
  const resIds = withReserve.map(c => c.tmdbId);
  assert.equal(new Set(resIds).size, 10, "never duplicates");
  assert.ok(resIds.includes(26) && resIds.includes(27) && resIds.includes(28), "qualifying recent candidates must fill 3 slots");
  for (let i = 1; i < withReserve.length; i++) {
    assert.ok(withReserve[i - 1].rankerProbability >= withReserve[i].rankerProbability, "must remain sorted by rankerProbability");
  }

  // 2. Respects percentile floor strictly: with minProbabilityPercentile=0.90, 26/27/28 (and 29/30) fail floor -> normal order
  const highFloor = rankCandidatePool(
    candidates,
    ctx,
    undefined,
    10,
    {},
    { count: 3, minReleaseDate: "2025-05-13", minProbabilityPercentile: 0.90 }
  );
  assert.deepEqual(highFloor.map(c => c.tmdbId), baselineTop10.map(c => c.tmdbId));

  // 3. Partial qualification: only 1 qualifying recent above 50th percentile (drop 27, 28) -> promotes 26, never 29/30, fills remaining from classics 8, 9
  const partialPool = candidates.filter(c => c.tmdbId !== 27 && c.tmdbId !== 28);
  const partialRes = rankCandidatePool(
    partialPool,
    ctx,
    undefined,
    10,
    {},
    { count: 3, minReleaseDate: "2025-05-13", minProbabilityPercentile: 0.5 }
  );
  assert.equal(partialRes.length, 10);
  const partialIds = partialRes.map(c => c.tmdbId);
  assert.ok(partialIds.includes(26));
  assert.equal(partialIds.includes(29), false, "below-percentile recent release must not be reserved");
  assert.equal(partialIds.includes(30), false, "below-percentile recent release must not be reserved");
  assert.ok(partialIds.includes(8) && partialIds.includes(9));

  // 4. Does nothing when no candidate satisfies minReleaseDate
  const noneRecent = rankCandidatePool(
    candidates,
    ctx,
    undefined,
    10,
    {},
    { count: 3, minReleaseDate: "2027-01-01", minProbabilityPercentile: 0.5 }
  );
  assert.deepEqual(noneRecent.map(c => c.tmdbId), baselineTop10.map(c => c.tmdbId));

  // 5. Never duplicates even if top-(topK-count) already contains a qualifying recent candidate or input has duplicates
  const dupPool = [
    { ...candidates[0], release_date: "2026-01-01" }, // #1 classic updated to recent
    { ...candidates[0], release_date: "2026-01-01" }, // duplicate row of #1
    ...candidates.slice(1)
  ];
  const noDupRes = rankCandidatePool(
    dupPool,
    ctx,
    undefined,
    10,
    {},
    { count: 3, minReleaseDate: "2025-05-13", minProbabilityPercentile: 0.5 }
  );
  assert.equal(noDupRes.length, 10);
  assert.equal(new Set(noDupRes.map(c => c.tmdbId)).size, 10, "reserved output must never contain duplicate IDs");
});

test("geminiService exports heuristic recent-release reserve constants", async () => {
  const mod = await import("../src/services/geminiService.js");
  assert.equal(mod.RECENT_RELEASE_RESERVE_COUNT, 2);
  assert.equal(mod.RECENT_RELEASE_RESERVE_MONTHS, 18);
  assert.equal(mod.RECENT_RELEASE_MIN_PROB_PERCENTILE, 0.5);
});

test("reserve computes minProbabilityPercentile over non-collaborative candidates, enforces minProbability and genreOverlap, with fallbacks", async () => {
  const { rankCandidatePool } = await import("../src/services/rankerService.js");

  // 15 high-collab classics (~0.97) dominate >50% of the whole pool, which used to starve cold-start recent releases.
  const candidates = [];
  const collabSimMap = new Map();
  for (let i = 1; i <= 15; i++) {
    candidates.push({
      id: i,
      tmdbId: i,
      title: `Collab Classic ${i}`,
      release_date: "1998-01-01",
      genre_ids: [18],
      vote_average: 8.1,
      vote_count: 1500
    });
    collabSimMap.set(i, 0.95 - i * 0.01);
  }
  // 4 non-collab filler classics (~0.40) + 1 cold-start qualifying recent release (~0.72 >= 0.54)
  for (let i = 16; i <= 19; i++) {
    candidates.push({
      id: i,
      tmdbId: i,
      title: `Low NonCollab ${i}`,
      release_date: "2002-01-01",
      genre_ids: [99],
      vote_average: 6.2,
      vote_count: 400
    });
  }
  candidates.push({
    id: 801,
    tmdbId: 801,
    title: "Cold-Start Recent Hit",
    release_date: "2026-01-15",
    genre_ids: [18],
    vote_average: 7.9,
    vote_count: 600
  });

  const ctx = {
    profile: { lovedGenreIds: [18], hatedKeywordIds: [], lovedKeywordIds: [701, 702] },
    collabSimMap
  };

  // Non-collab percentile lets 801 pass even though whole-pool 50th percentile is ~0.95
  const out = rankCandidatePool(candidates, ctx, undefined, 10, {}, {
    count: 3,
    minReleaseDate: "2025-05-13",
    minProbabilityPercentile: 0.5
  });
  assert.ok(out.some(c => c.tmdbId === 801), "non-collab percentile floor must allow qualifying cold-start recent release");

  // Absolute floor >= 0.54 rejects weak non-collab recent film even at minProbabilityPercentile=0
  const lowProbCandidates = candidates.map(c =>
    c.tmdbId === 801 ? { ...c, genre_ids: [99], vote_average: 5.4, vote_count: 200 } : c
  );
  const blockedByAbsFloor = rankCandidatePool(lowProbCandidates, ctx, undefined, 10, {}, {
    count: 3,
    minReleaseDate: "2025-05-13",
    minProbabilityPercentile: 0
  });
  assert.equal(blockedByAbsFloor.some(c => c.tmdbId === 801), false, "default 0.54 minProbability must block weak recent film");

  // Overriding minProbability allows it
  const customFloor = rankCandidatePool(lowProbCandidates, ctx, undefined, 10, {}, {
    count: 3,
    minReleaseDate: "2025-05-13",
    minProbabilityPercentile: 0,
    minProbability: 0.2
  });
  assert.ok(customFloor.some(c => c.tmdbId === 801));

  // GenreOverlap > 0 preference + fallback when none match loved genres:
  // 802 has keywordOverlap (0 genre match) + high prob; 801 has genre match -> 801 must beat 802 for reserve count=1
  const withGenreAndNonGenre = [
    ...candidates,
    {
      id: 802,
      tmdbId: 802,
      title: "Recent Wrong-Genre High-KW",
      release_date: "2026-02-01",
      genre_ids: [99],
      tmdbKeywords: [701, 702],
      crewPersonId: undefined,
      vote_average: 8.5,
      vote_count: 1500
    }
  ];
  const genrePreferred = rankCandidatePool(withGenreAndNonGenre, ctx, undefined, 10, {}, {
    count: 1,
    minReleaseDate: "2025-05-13",
    minProbabilityPercentile: 0
  });
  assert.ok(genrePreferred.some(c => c.tmdbId === 801));
  assert.equal(genrePreferred.some(c => c.tmdbId === 802), false);

  // Fallback when ZERO qualifying recent candidates match loved genres
  const noGenreRecentOnly = withGenreAndNonGenre.filter(c => c.tmdbId !== 801);
  const genreFallback = rankCandidatePool(noGenreRecentOnly, ctx, undefined, 10, {}, {
    count: 1,
    minReleaseDate: "2025-05-13",
    minProbabilityPercentile: 0
  });
  assert.ok(genreFallback.some(c => c.tmdbId === 802), "must fall back to non-matching recent candidate when none match loved genres");

  // All-collab pool fallback when zero non-collab candidates exist
  const allCollab = candidates.slice(0, 15).map((c, idx) =>
    idx === 14 ? { ...c, tmdbId: 999, id: 999, release_date: "2026-01-10" } : c
  );
  collabSimMap.set(999, 0.25); // below top 14 (0.94..0.81), so passes percentile 0 and fails 0.9
  const allCollabRes = rankCandidatePool(allCollab, ctx, undefined, 10, {}, {
    count: 1,
    minReleaseDate: "2025-05-13",
    minProbabilityPercentile: 0.9
  });
  assert.equal(allCollabRes.some(c => c.tmdbId === 999), false, "all-collab fallback uses whole-pool percentile");
});

test("computeReserveQualityScore aligns with ranker weights with noveltyBonus neutralized so Favorite Filmmaker and >4000-vote acclaimed picks win cleanly", async () => {
  const {
    rankCandidatePool,
    scoreCandidate,
    computeReserveQualityScore,
    DEFAULT_RANKER_WEIGHTS
  } = await import("../src/services/rankerService.js");

  const candidates = [];
  const collabSimMap = new Map();
  for (let i = 1; i <= 8; i++) {
    candidates.push({
      id: i,
      tmdbId: i,
      title: `Head Classic ${i}`,
      release_date: "1999-01-01",
      genre_ids: [18, 53],
      vote_average: 8.2,
      vote_count: 2000
    });
    collabSimMap.set(i, 0.9 - i * 0.02);
  }

  // Pick 901: Favorite Filmmaker (crewMatch=1, 7.5 rating, 1203 votes) -> higher rankerProbability (~85% matchScore)
  candidates.push({
    id: 901,
    tmdbId: 901,
    title: "Favorite Filmmaker Recent",
    release_date: "2026-02-01",
    genre_ids: [18],
    crewPersonId: 555,
    vote_average: 7.5,
    vote_count: 1203
  });

  // Pick 902: Higher vote_average (9.0 / 1440 votes) without crew match -> lower rankerProbability (~80% matchScore)
  candidates.push({
    id: 902,
    tmdbId: 902,
    title: "High-Rating Non-Crew Recent",
    release_date: "2026-02-01",
    genre_ids: [18],
    vote_average: 9.0,
    vote_count: 1440
  });

  const ctx = {
    profile: { lovedGenreIds: [18, 53, 80], hatedKeywordIds: [], topCrewMemberId: 555 },
    collabSimMap
  };

  // Without reserve: unchanged classics 1..8
  const noReserve = rankCandidatePool(candidates, ctx, undefined, 8, {}, null);
  assert.deepEqual(noReserve.map(c => c.tmdbId), [1, 2, 3, 4, 5, 6, 7, 8]);

  // Direct equality with scoreCandidate({ ...features, noveltyBonus: 0 })
  const scored901 = rankCandidatePool(candidates, ctx, undefined, candidates.length, {}, null).find(c => c.tmdbId === 901);
  const scored902 = rankCandidatePool(candidates, ctx, undefined, candidates.length, {}, null).find(c => c.tmdbId === 902);
  assert.equal(
    computeReserveQualityScore(scored901, DEFAULT_RANKER_WEIGHTS),
    scoreCandidate({ ...scored901.features, noveltyBonus: 0 }, DEFAULT_RANKER_WEIGHTS).logit
  );
  assert.ok(scored901.matchScore > scored902.matchScore);
  assert.ok(computeReserveQualityScore(scored901) > computeReserveQualityScore(scored902));

  // Reserve count=1 must pick 901 (higher rankerProbability / Favorite Filmmaker) over 902
  const reservedCrewWin = rankCandidatePool(candidates, ctx, undefined, 8, {}, {
    count: 1,
    minReleaseDate: "2025-05-13",
    minProbabilityPercentile: 0
  });
  assert.equal(reservedCrewWin.length, 8);
  assert.ok(reservedCrewWin.some(c => c.tmdbId === 901), "Favorite Filmmaker pick with higher rankerProbability must outrank higher-vote non-crew pick");
  assert.equal(reservedCrewWin.some(c => c.tmdbId === 902), false);

  // Novelty neutralization: >4,000-vote acclaimed hit (8.4 / 6500 votes, noveltyBonus=0.1) beats
  // same-genre mid-vote lower-rated film (8.1 / 1500 votes, noveltyBonus=0.5) even though raw prob includes novelty step
  const noveltyCandidates = candidates.slice(0, 8).concat([
    {
      id: 903,
      tmdbId: 903,
      title: "Acclaimed Blockbuster Recent",
      release_date: "2025-11-01",
      genre_ids: [18],
      vote_average: 8.4,
      vote_count: 6500
    },
    {
      id: 904,
      tmdbId: 904,
      title: "Mid-Vote Lower-Rated Recent",
      release_date: "2025-11-01",
      genre_ids: [18],
      vote_average: 8.1,
      vote_count: 1500
    }
  ]);
  const fullNovelty = rankCandidatePool(noveltyCandidates, ctx, undefined, noveltyCandidates.length, {}, null);
  const c903 = fullNovelty.find(c => c.tmdbId === 903);
  const c904 = fullNovelty.find(c => c.tmdbId === 904);
  assert.ok(c904.rankerProbability > c903.rankerProbability, "raw rankerProbability gives 904 an edge purely via noveltyBonus");
  assert.ok(computeReserveQualityScore(c903) > computeReserveQualityScore(c904), "neutralizing noveltyBonus makes 8.4 >4000-vote hit outscore 8.1 mid-vote film");

  const reservedNovelty = rankCandidatePool(noveltyCandidates, ctx, undefined, 8, {}, {
    count: 1,
    minReleaseDate: "2025-05-13",
    minProbabilityPercentile: 0
  });
  assert.ok(reservedNovelty.some(c => c.tmdbId === 903));
  assert.equal(reservedNovelty.some(c => c.tmdbId === 904), false);
});
