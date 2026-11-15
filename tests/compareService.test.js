import test from "node:test";
import assert from "node:assert/strict";
import { encodeEmbeddingBinary, parseEmbeddingBinary } from "../src/services/embeddingService.js";
import {
  COMPARE_MAX_ITEMS,
  toCompareStub,
  toggleCompareItem,
  parseCurrencyUsd,
  parseRuntimeMins,
  buildCompareUrl,
  parseCompareUrlIds,
  computeCompareOverlap,
  buildCompareMatrix,
  parseStoredCompareItems,
  hydrateCompareMovieSlot,
  resolveExploreGenreId,
  dedupeHydratedMovies,
  addUrlCompareSlot,
  removeUrlCompareSlot
} from "../src/services/compareService.js";

test("toggleCompareItem deduplicates IMDb/TMDB identities and enforces 3-film limit", () => {
  let state = [];
  const first = toggleCompareItem(state, { imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar", year: "2014" });
  assert.equal(first.action, "added");
  state = first.items;
  assert.equal(state.length, 1);

  // Same movie by tmdbId alone removes cleanly instead of duplicating
  const removed = toggleCompareItem(state, { tmdbId: 157336, title: "Interstellar" });
  assert.equal(removed.action, "removed");
  assert.equal(removed.items.length, 0);

  // Fill 3 slots then block 4th cleanly
  for (const id of [1, 2, 3]) {
    state = toggleCompareItem(state, { tmdbId: id, title: `Movie ${id}`, year: "2020" }).items;
  }
  const fourth = toggleCompareItem(state, { tmdbId: 4, title: "Movie 4", year: "2021" });
  assert.equal(fourth.action, "full");
  assert.equal(fourth.items.length, COMPARE_MAX_ITEMS);
});

test("toCompareStub extracts compact normalized identity without polluting vault fields", () => {
  const stub = toCompareStub({
    imdbID: "tt0816692",
    tmdbId: "157336",
    title: "Interstellar",
    year: "2014-11-05",
    imdbRating: "8.7",
    runtime: "169 min"
  });
  assert.deepEqual(stub, {
    id: "tt0816692",
    imdbID: "tt0816692",
    tmdbId: 157336,
    title: "Interstellar",
    year: "2014",
    poster: null,
    imdbRating: "8.7",
    genre: null,
    runtime: "169 min"
  });
});

test("parseCurrencyUsd and parseRuntimeMins safely reject N/A and zero budgets", () => {
  assert.equal(parseCurrencyUsd("$165,000,000"), 165000000);
  assert.equal(parseCurrencyUsd("N/A"), null);
  assert.equal(parseCurrencyUsd("$0"), null);
  assert.equal(parseCurrencyUsd(0), null);
  assert.equal(parseRuntimeMins("169 min"), 169);
  assert.equal(parseRuntimeMins(148), 148);
  assert.equal(parseRuntimeMins("N/A"), null);
  assert.equal(parseRuntimeMins("0 min"), null);
});

test("computeCompareOverlap finds shared actors/crew with personIds, shared genres/keywords, and vector similarity", () => {
  const buf = encodeEmbeddingBinary([
    { tmdbId: 10, vector: [1, 0, 0] },
    { tmdbId: 20, vector: [0.8, 0.6, 0] },
    { tmdbId: 30, vector: [0.8, 0.6, 0] }
  ]);
  const idx = parseEmbeddingBinary(buf);
  // Shrink row for tmdbId 30 (sumSq = 0.25 < 0.98) to exercise non-unit magnitude normalization
  const row30 = idx.idToIndex.get(30) * idx.dim;
  for (let d = 0; d < idx.dim; d++) idx.vectors[row30 + d] *= 0.5;
  const overlap = computeCompareOverlap([
    {
      tmdbId: 10,
      title: "Film A",
      genre: "Sci-Fi, Thriller",
      directorDetails: [{ id: 525, name: "Christopher Nolan" }],
      composerDetails: [{ id: 947, name: "Hans Zimmer" }],
      castDetails: [{ id: 2037, name: "Cillian Murphy", character: "Fischer" }],
      keywords: ["dream", "heist"]
    },
    {
      tmdbId: 20,
      title: "Film B",
      genre: "Drama, Sci-Fi",
      directorDetails: [{ id: 525, name: "Christopher Nolan" }],
      composerDetails: [{ id: 947, name: "Hans Zimmer" }],
      castDetails: [{ id: 2037, name: "Cillian Murphy", character: "Oppenheimer" }],
      keywordItems: [{ id: 4379, name: "time travel" }, { id: 1568, name: "dream" }]
    },
    {
      tmdbId: 30,
      title: "Film C",
      genre: "Sci-Fi, Action",
      castDetails: [{ id: 2037, name: "Cillian Murphy", character: "Scarecrow" }],
      keywords: ["dream"]
    }
  ], idx);

  assert.equal(overlap.sharedCrew[0].id, 525);
  assert.ok(overlap.sharedCrew.some((p) => p.id === 947 && p.rolesByMovie.length === 2));
  assert.equal(overlap.sharedActors[0].id, 2037);
  assert.equal(overlap.sharedActors[0].rolesByMovie.length, 3);
  assert.deepEqual(overlap.sharedGenres, ["Sci-Fi"]);
  const dreamKw = overlap.sharedKeywords.find((k) => k.name.toLowerCase() === "dream");
  assert.ok(dreamKw);
  assert.equal(dreamKw.id, 1568);
  assert.equal(overlap.pairVectorSims.find((p) => p.aTitle === "Film A" && p.bTitle === "Film B").similarityPct, 80);
  assert.equal(overlap.pairVectorSims.find((p) => p.aTitle === "Film A" && p.bTitle === "Film C").similarityPct, 80);
});

test("buildCompareMatrix identifies column winners, preserves Vault metadata, computes Taste Fit, and handles missing financials", () => {
  const buf = encodeEmbeddingBinary([
    { tmdbId: 99, vector: [1, 0, 0] },
    { tmdbId: 10, vector: [0.8, 0.6, 0] },
    { tmdbId: 20, vector: [-0.2, 0.98, 0] }
  ]);
  const idx = parseEmbeddingBinary(buf);

  const matrix = buildCompareMatrix(
    [
      {
        tmdbId: 10,
        imdbID: "tt1375666",
        title: "Inception",
        imdbRating: "8.8",
        rottenTomatoes: "87%",
        metascore: "74",
        tmdbRating: 8.4,
        runtime: "148 min",
        budget: "$160,000,000",
        revenue: "$800,000,000"
      },
      {
        tmdbId: 20,
        title: "B",
        imdbRating: "8.1",
        rottenTomatoes: "92%",
        metascore: "74",
        tmdbRating: 7.9,
        runtime: "120 min",
        budget: "N/A",
        revenue: "$200,000,000"
      }
    ],
    {
      watched: [
        { tmdbId: 99, userRating: 10 },
        { imdbID: "tt1375666", userRating: 9, userNote: "Mind-bending favorite" }
      ],
      watchlist: [{ tmdbId: 20, title: "B" }],
      embeddingIndex: idx
    }
  );

  assert.deepEqual(matrix.leaders.imdb, [0]);
  assert.deepEqual(matrix.leaders.rt, [1]);
  assert.deepEqual(matrix.leaders.metascore, [0, 1]);
  assert.deepEqual(matrix.leaders.runtimeShortest, [1]);
  assert.deepEqual(matrix.leaders.revenue, [0]);
  assert.equal(matrix.items[0].roiLabel, "5.0×");
  assert.equal(matrix.items[1].roiLabel, "—");
  assert.equal(matrix.items[0].vaultRating, 9);
  assert.equal(matrix.items[0].vaultNote, "Mind-bending favorite");
  assert.equal(matrix.items[1].inWatchlist, true);
  assert.ok(Number.isInteger(matrix.items[0].vaultMatchPct));
  assert.ok(matrix.items[0].vaultMatchPct > matrix.items[1].vaultMatchPct);
  assert.deepEqual(matrix.leaders.vaultMatch, [0]);
});

test("buildCompareUrl and parseCompareUrlIds round-trip canonical IDs capped at 3 and ignore invalid tokens", () => {
  const url = buildCompareUrl([{ imdbID: "tt0816692" }, { tmdbId: 27205 }]);
  assert.equal(url, "/compare?ids=tt0816692%2Ctmdb_27205");
  assert.deepEqual(parseCompareUrlIds(url.split("?")[1]), ["tt0816692", "tmdb_27205"]);
  assert.deepEqual(parseCompareUrlIds("?ids=tt0816692,badToken,tmdb_27205,155,tt9999999"), [
    "tt0816692",
    "tmdb_27205",
    "tmdb_155"
  ]);
  assert.equal(buildCompareUrl([]), "/compare");
});

test("parseStoredCompareItems safely handles corrupt JSON, deduplicates identities, and caps at 3", () => {
  assert.deepEqual(parseStoredCompareItems("{not valid json"), []);
  assert.deepEqual(parseStoredCompareItems(null), []);
  const recovered = parseStoredCompareItems(
    JSON.stringify([
      { imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar" },
      { tmdbId: 157336, title: "Interstellar" },
      { tmdbId: 27205, title: "Inception" },
      { tmdbId: 155, title: "The Dark Knight" },
      { tmdbId: 999, title: "Overflow Fourth" }
    ])
  );
  assert.equal(recovered.length, COMPARE_MAX_ITEMS);
  assert.deepEqual(
    recovered.map((m) => m.tmdbId),
    [157336, 27205, 155]
  );
});

test("hydrateCompareMovieSlot hydrates lightweight stubs and bare URL IDs concurrently and resolveExploreGenreId maps genres", async () => {
  assert.equal(resolveExploreGenreId("Sci-Fi"), 878);
  assert.equal(resolveExploreGenreId("Drama"), 18);
  assert.equal(resolveExploreGenreId("MadeUpGenre"), null);

  // Stub from MovieCard (has imdbID but lacks tmdbId/runtime/budget/rt)
  const stubRes = await hydrateCompareMovieSlot(
    { id: "tt0816692", imdbID: "tt0816692", title: "Interstellar" },
    {
      userRegion: "US",
      findByImdb: async (imdbId) => (imdbId === "tt0816692" ? { tmdbId: 157336 } : null),
      fetchTmdbDetails: async (tmdbId) => ({
        tmdbId,
        imdbID: "tt0816692",
        title: "Interstellar",
        year: "2014",
        runtime: "169 min",
        budget: "$165,000,000",
        revenue: "$701,729,206",
        vote_average: 8.4,
        castDetails: [{ id: 10297, name: "Matthew McConaughey", character: "Cooper" }],
        directorDetails: [{ id: 525, name: "Christopher Nolan" }],
        keywordItems: [{ id: 4379, name: "time travel" }],
        streamProviders: [{ id: 8, name: "Netflix", logo: "/netflix.png" }]
      }),
      fetchOmdb: async () => ({
        Response: "True",
        imdbID: "tt0816692",
        imdbRating: "8.7",
        Metascore: "74",
        Ratings: [{ Source: "Rotten Tomatoes", Value: "73%" }]
      })
    }
  );
  assert.equal(stubRes.tmdbId, 157336);
  assert.equal(stubRes.rottenTomatoes, "73%");
  assert.equal(stubRes.metascore, "74");
  assert.equal(stubRes.budget, "$165,000,000");

  // Bare URL ID "tmdb_27205" with fresh sessionStorage
  const tmdbRes = await hydrateCompareMovieSlot("tmdb_27205", {
    userRegion: "US",
    fetchTmdbDetails: async (tmdbId) => ({
      tmdbId: Number(tmdbId),
      imdbID: "tt1375666",
      title: "Inception",
      year: "2010",
      runtime: "148 min",
      budget: "$160,000,000",
      revenue: "$836,800,000"
    }),
    fetchOmdb: async ({ i }) => ({
      Response: "True",
      imdbID: i,
      imdbRating: "8.8",
      Metascore: "74",
      Ratings: [{ Source: "Rotten Tomatoes", Value: "87%" }]
    })
  });
  assert.equal(tmdbRes.imdbID, "tt1375666");
  assert.equal(tmdbRes.title, "Inception");
  assert.equal(tmdbRes.rottenTomatoes, "87%");

  // Unresolvable bare URL ID returns _notFound flag cleanly
  const missing = await hydrateCompareMovieSlot("tt9999999", {
    findByImdb: async () => null,
    fetchTmdbDetails: async () => null,
    fetchOmdb: async () => ({ Response: "False" })
  });
  assert.equal(missing._notFound, true);

  // Local CSV/Vault stub with only title + year resolves via findByTitleYear fallback
  const localStubRes = await hydrateCompareMovieSlot(
    { id: "local_arrival_2016", title: "Arrival", year: "2016" },
    {
      findByTitleYear: async (title, year) =>
        title === "Arrival" && year === "2016" ? { tmdbId: 329865 } : null,
      fetchTmdbDetails: async (tmdbId) => ({
        tmdbId,
        imdbID: "tt2543164",
        title: "Arrival",
        year: "2016",
        runtime: "116 min",
        budget: "$47,000,000",
        revenue: "$203,388,186"
      }),
      fetchOmdb: async ({ i }) => ({
        Response: "True",
        imdbID: i,
        imdbRating: "7.9",
        Metascore: "81",
        Ratings: [{ Source: "Rotten Tomatoes", Value: "94%" }]
      })
    }
  );
  assert.equal(localStubRes.imdbID, "tt2543164");
  assert.equal(localStubRes.tmdbId, 329865);
  assert.equal(localStubRes.rottenTomatoes, "94%");
});

test("toCompareStub preserves uppercase OMDb Poster/Runtime, buildCompareMatrix renders 0% RT and 0 Metascore, and dedupeHydratedMovies collapses cross-scheme duplicates", () => {
  const omdbHit = toCompareStub({
    imdbID: "tt0068646",
    Title: "The Godfather",
    Year: "1972",
    Genre: "Crime, Drama",
    Poster: "https://example.com/godfather.jpg",
    Runtime: "175 min"
  });
  assert.equal(omdbHit.poster, "https://example.com/godfather.jpg");
  assert.equal(omdbHit.runtime, "175 min");

  const zeroMatrix = buildCompareMatrix([
    {
      imdbID: "tt0000001",
      title: "Zero Critic Film",
      rottenTomatoes: "0%",
      metascore: "0",
      imdbRating: "2.1"
    },
    {
      imdbID: "tt0000002",
      title: "Unrated Film",
      rottenTomatoes: "N/A",
      metascore: "N/A",
      imdbRating: "0"
    }
  ]);
  assert.equal(zeroMatrix.rows.rt[0], "0%");
  assert.equal(zeroMatrix.rows.metascore[0], "0");
  assert.equal(zeroMatrix.rows.rt[1], "—");
  assert.equal(zeroMatrix.rows.imdb[1], "—");

  const deduped = dedupeHydratedMovies([
    { id: "tt0816692", imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar" },
    { id: "tmdb_157336", imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar" },
    { id: "tmdb_27205", imdbID: "tt1375666", tmdbId: 27205, title: "Inception" }
  ]);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((m) => m.title), ["Interstellar", "Inception"]);

  // URL slot helpers deduplicate cross-scheme identities via resolvedSlots and remove _notFound tokens cleanly
  const resolved = [
    { _rawSlotKey: "tt0816692", id: "tt0816692", imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar" },
    { _rawSlotKey: "tt9999999", id: "tt9999999", _notFound: true }
  ];
  const dupAttempt = addUrlCompareSlot(
    ["tt0816692", "tt9999999"],
    resolved,
    { id: "tmdb_157336", tmdbId: 157336, title: "Interstellar" }
  );
  assert.equal(dupAttempt.action, "duplicate");
  assert.deepEqual(dupAttempt.ids, ["tt0816692", "tt9999999"]);

  const afterRemoveBroken = removeUrlCompareSlot(
    ["tt0816692", "tt9999999"],
    resolved,
    { id: "tt9999999", _notFound: true }
  );
  assert.deepEqual(afterRemoveBroken, ["tt0816692"]);

  const afterRemoveCrossScheme = removeUrlCompareSlot(
    ["tmdb_157336", "tmdb_27205"],
    [
      { _rawSlotKey: "tmdb_157336", id: "tt0816692", imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar" },
      { _rawSlotKey: "tmdb_27205", id: "tt1375666", imdbID: "tt1375666", tmdbId: 27205, title: "Inception" }
    ],
    { id: "tt0816692", imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar" }
  );
  assert.deepEqual(afterRemoveCrossScheme, ["tmdb_27205"]);
});
