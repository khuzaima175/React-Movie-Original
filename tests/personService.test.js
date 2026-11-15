import test from "node:test";
import assert from "node:assert/strict";
import { formatTmdbMovieDetails } from "../src/services/tmdbService.js";
import {
  extractMovieCreditPeople,
  resolvePersonDefaultDepartment,
  normalizePersonCredits,
  annotateCreditsWithVaultState,
  computePersonVaultStats,
  filterAndSortPersonCredits,
  buildPersonProfileRoute,
  shouldCloseMovieDetailOnEscape,
  fetchPersonProfileAndCredits,
  clearPersonCache
} from "../src/services/personService.js";

test("formatTmdbMovieDetails preserves structured directorDetails, writerDetails, cinematographerDetails, and composerDetails IDs", () => {
  const rawTmdbMovie = {
    id: 205596,
    title: "The Imitation Game",
    release_date: "2014-11-14",
    runtime: 114,
    genres: [{ id: 18, name: "Drama" }, { id: 36, name: "History" }],
    credits: {
      cast: [
        { id: 71580, name: "Benedict Cumberbatch", character: "Alan Turing", profile_path: "/abc.jpg" },
        { id: 116, name: "Keira Knightley", character: "Joan Clarke", profile_path: "/def.jpg" }
      ],
      crew: [
        { id: 57633, name: "Morten Tyldum", job: "Director", department: "Directing" },
        { id: 57634, name: "Second Director", job: "Director", department: "Directing" },
        { id: 1384805, name: "Graham Moore", job: "Screenplay", department: "Writing" },
        { id: 1384805, name: "Graham Moore", job: "Story", department: "Writing" },
        { id: 6001, name: "Andrew Hodges", job: "Story", department: "Writing" },
        { id: 59553, name: "Óscar Faura", job: "Director of Photography", department: "Camera" },
        { id: 2949, name: "Alexandre Desplat", job: "Original Music Composer", department: "Sound" }
      ]
    }
  };

  const formatted = formatTmdbMovieDetails(rawTmdbMovie, "US");
  assert.equal(formatted.director, "Morten Tyldum");
  assert.equal(formatted.crewPersonId, 57633);
  assert.equal(formatted.writers, "Graham Moore, Graham Moore, Andrew Hodges");
  assert.equal(formatted.cinematographer, "Óscar Faura");
  assert.equal(formatted.composer, "Alexandre Desplat");

  assert.deepEqual(formatted.directorDetails, [
    { id: 57633, name: "Morten Tyldum", job: "Director", department: "Directing" },
    { id: 57634, name: "Second Director", job: "Director", department: "Directing" }
  ]);
  assert.deepEqual(formatted.writerDetails, [
    { id: 1384805, name: "Graham Moore", job: "Screenplay", department: "Writing" },
    { id: 6001, name: "Andrew Hodges", job: "Story", department: "Writing" }
  ]);
  assert.deepEqual(formatted.cinematographerDetails, [
    { id: 59553, name: "Óscar Faura", job: "Director of Photography", department: "Camera" }
  ]);
  assert.deepEqual(formatted.composerDetails, [
    { id: 2949, name: "Alexandre Desplat", job: "Original Music Composer", department: "Sound" }
  ]);
});

test("extractMovieCreditPeople preserves TMDB IDs and parses OMDb fallback strings with id: null", () => {
  const omdbOnlyMovie = {
    director: "Morten Tyldum, Co Director",
    writers: "Graham Moore, Andrew Hodges",
    cinematographer: "N/A",
    composer: "Alexandre Desplat",
    castDetails: [
      { id: null, name: "Benedict Cumberbatch", character: "Starring", profile: null },
      { id: undefined, name: "Keira Knightley", character: "Starring", profile: null }
    ]
  };
  const extracted = extractMovieCreditPeople(omdbOnlyMovie);
  assert.deepEqual(extracted.directors, [
    { id: null, name: "Morten Tyldum", job: "Director", department: "Directing", roleHint: "Directing" },
    { id: null, name: "Co Director", job: "Director", department: "Directing", roleHint: "Directing" }
  ]);
  assert.equal(extracted.writers.length, 2);
  assert.equal(extracted.writers[0].id, null);
  assert.equal(extracted.writers[0].roleHint, "Writing");
  assert.equal(extracted.cinematographers.length, 0);
  assert.deepEqual(extracted.composers, [
    { id: null, name: "Alexandre Desplat", job: "Composer", department: "Sound", roleHint: "Crew" }
  ]);
  assert.deepEqual(
    extracted.cast.map((c) => ({ id: c.id, name: c.name, roleHint: c.roleHint })),
    [
      { id: null, name: "Benedict Cumberbatch", roleHint: "Acting" },
      { id: null, name: "Keira Knightley", roleHint: "Acting" }
    ]
  );

  const tmdbMovie = {
    castDetails: [{ id: 71580, name: "Benedict Cumberbatch", character: "Alan Turing", profile: "https://image.tmdb.org/p.jpg" }],
    directorDetails: [{ id: 57633, name: "Morten Tyldum", job: "Director", department: "Directing" }]
  };
  const extractedTmdb = extractMovieCreditPeople(tmdbMovie);
  assert.equal(extractedTmdb.cast[0].id, 71580);
  assert.equal(extractedTmdb.directors[0].id, 57633);
});

test("normalizePersonCredits merges duplicate cast+crew entries per tmdbId and filters Self/talk-show noise cleanly", () => {
  const rawCredits = {
    cast: [
      {
        id: 205596,
        title: "The Imitation Game",
        release_date: "2014-11-14",
        character: "Alan Turing",
        popularity: 42,
        vote_average: 8.0,
        vote_count: 16000,
        poster_path: "/ig.jpg",
        genre_ids: [18, 36]
      },
      {
        id: 999111,
        title: "Late Night Talk Show Special",
        release_date: "2020-05-01",
        character: "Himself - Guest",
        popularity: 85,
        vote_average: 7.1,
        vote_count: 120,
        poster_path: "/talk.jpg",
        genre_ids: [99]
      },
      { id: 0, title: "Broken Zero Id", release_date: "2021-01-01" }
    ],
    crew: [
      {
        id: 205596,
        title: "The Imitation Game",
        release_date: "2014-11-14",
        job: "Executive Producer",
        department: "Production",
        popularity: 42,
        vote_average: 8.0,
        vote_count: 16000
      },
      {
        id: 888222,
        title: "Behind The Scenes Making Of",
        release_date: "2015-01-01",
        job: "Self",
        department: "Crew",
        genre_ids: [99],
        popularity: 50
      }
    ]
  };

  const normalized = normalizePersonCredits(rawCredits);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].tmdbId, 205596);
  assert.match(normalized[0].rolesLabel, /Alan Turing/);
  assert.match(normalized[0].rolesLabel, /Executive Producer/);
  assert.equal(normalized[0].departments.includes("acting"), true);
  assert.equal(normalized[0].departments.includes("crew"), true);

  const includingSelf = normalizePersonCredits(rawCredits, { includeSelfAppearances: true });
  assert.equal(includingSelf.some((c) => c.tmdbId === 999111), true);

  const docOnlyCredits = normalizePersonCredits({
    cast: [{ id: 777, title: "Pure Nature Doc", release_date: "2022-01-01", character: "Narrator (Himself)", genre_ids: [99] }],
    crew: []
  });
  assert.equal(docOnlyCredits.length, 1, "falls back cleanly when person only has documentary/self credits");
});

test("annotateCreditsWithVaultState & computePersonVaultStats match mixed IDs and exclude unrated watchlist from average", () => {
  const credits = [
    { id: 205596, tmdbId: 205596, title: "The Imitation Game", year: "2014", releaseDate: "2014-11-14", popularity: 50, voteAverage: 8.0, voteCount: 16000, departments: ["acting"], primaryDepartment: "acting" },
    { id: 530915, tmdbId: 530915, title: "1917", year: "2019", releaseDate: "2019-12-25", popularity: 45, voteAverage: 8.0, voteCount: 12000, departments: ["acting"], primaryDepartment: "acting" },
    { id: 1001, tmdbId: 1001, title: "Power of the Dog", year: "2021", releaseDate: "2021-11-17", popularity: 30, voteAverage: 6.8, voteCount: 4000, departments: ["acting"], primaryDepartment: "acting" },
    { id: 9002, tmdbId: 9002, title: "Same Name Remade Film", year: "2021", releaseDate: "2021-01-01", popularity: 12, voteAverage: 6.1, voteCount: 50, departments: ["acting"], primaryDepartment: "acting" }
  ];
  const watched = [
    { imdbID: "tmdb_205596", title: "The Imitation Game", year: "2014", userRating: 9 },
    { imdbID: "tt8579674", Title: "1917", Year: "2019", userRating: 8 },
    { imdbID: "tmdb_999999", title: "Same Name Remade Film", year: "2021", userRating: 4 }
  ];
  const watchlist = [
    { imdbID: "tmdb_1001", title: "Power of the Dog", year: "2021" }
  ];

  const annotated = annotateCreditsWithVaultState(credits, watched, watchlist);
  assert.equal(annotated[0].vaultStatus, "watched");
  assert.equal(annotated[0].userRating, 9);
  assert.equal(annotated[1].vaultStatus, "watched");
  assert.equal(annotated[1].userRating, 8);
  assert.equal(annotated[2].vaultStatus, "watchlist");
  assert.equal(annotated[2].inWatchlist, true);
  assert.equal(annotated[3].vaultStatus, "unseen", "distinct tmdbId prevents same-year title collision");

  const stats = computePersonVaultStats(annotated);
  assert.deepEqual(stats, {
    totalCredits: 4,
    watchedCount: 2,
    watchlistCount: 1,
    averageVaultRating: 8.5,
    highestRatedFilm: annotated[0]
  });

  const tiedStats = computePersonVaultStats([
    { tmdbId: 10, title: "Lesser Tie", vaultStatus: "watched", userRating: 9, popularity: 12, voteCount: 400 },
    { tmdbId: 20, title: "Canonical Tie", vaultStatus: "watched", userRating: 9, popularity: 68, voteCount: 15000 }
  ]);
  assert.equal(tiedStats.highestRatedFilm.tmdbId, 20, "tied ratings break deterministically by popularity/votes");
});

test("filterAndSortPersonCredits & resolvePersonDefaultDepartment filter by department, vault status, query, and sort order", () => {
  const credits = [
    { tmdbId: 1, title: "Alpha Film", year: "2020", releaseDate: "2020-05-01", popularity: 20, voteAverage: 7.2, voteCount: 500, departments: ["directing"], vaultStatus: "unseen", userRating: null },
    { tmdbId: 2, title: "Beta Masterwork", year: "2014", releaseDate: "2014-11-14", popularity: 60, voteAverage: 8.4, voteCount: 8000, departments: ["acting", "directing"], vaultStatus: "watched", userRating: 9 },
    { tmdbId: 3, title: "Gamma Obscure HighAvg", year: "2024", releaseDate: "2024-03-10", popularity: 10, voteAverage: 9.5, voteCount: 3, departments: ["acting"], vaultStatus: "watchlist", userRating: null }
  ];

  assert.equal(resolvePersonDefaultDepartment("Directing", credits), "directing");
  assert.equal(resolvePersonDefaultDepartment("Writing", credits), "all");

  assert.deepEqual(
    filterAndSortPersonCredits(credits, { department: "directing", sortBy: "popular" }).map((c) => c.tmdbId),
    [2, 1]
  );
  assert.deepEqual(
    filterAndSortPersonCredits(credits, { vaultFilter: "unwatched" }).map((c) => c.tmdbId),
    [3, 1].reverse() // popular desc -> Alpha(20), Gamma(10)
  );
  assert.deepEqual(
    filterAndSortPersonCredits(credits, { sortBy: "top_rated" }).map((c) => c.tmdbId),
    [2, 1, 3],
    "top_rated deprioritizes tiny <50-vote inflation behind solidly rated films"
  );
  assert.deepEqual(
    filterAndSortPersonCredits(credits, { sortBy: "newest" }).map((c) => c.tmdbId),
    [3, 1, 2]
  );
  assert.deepEqual(
    filterAndSortPersonCredits(credits, { searchQuery: "beta" }).map((c) => c.tmdbId),
    [2]
  );
});

test("fetchPersonProfileAndCredits resolves name-only targets via /3/search/person, caches session lookups, honors AbortSignal, and handles HTTP 429 cleanly", async () => {
  clearPersonCache();
  let calls = [];
  const prevKey = process.env.VITE_TMDB_KEY;
  delete process.env.VITE_TMDB_KEY;

  try {
    const mockFetch = async (url) => {
      const s = decodeURIComponent(String(url));
      calls.push(s);
      if (s.includes("/3/search/person")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { id: 999, name: "Morten Tyldum Lookalike", known_for_department: "Acting", popularity: 1 },
              { id: 57633, name: "Morten Tyldum", known_for_department: "Directing", popularity: 12 }
            ]
          })
        };
      }
      if (s.includes("/3/person/57633")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 57633,
            name: "Morten Tyldum",
            biography: "Norwegian film director.",
            known_for_department: "Directing",
            profile_path: "/mt.jpg",
            external_ids: { imdb_id: "nm0878756" },
            movie_credits: {
              cast: [],
              crew: [{ id: 205596, title: "The Imitation Game", job: "Director", department: "Directing" }]
            }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const byName = await fetchPersonProfileAndCredits(
      { id: null, name: "Morten Tyldum", roleHint: "Directing" },
      { forceProxy: true, fetchFn: mockFetch }
    );
    assert.equal(byName.person.id, 57633);
    assert.equal(byName.person.imdbUrl, "https://www.imdb.com/name/nm0878756/");
    assert.equal(calls.length, 2);

    // Repeat fetch by numeric id hits warm cache with 0 network calls
    const fromCache = await fetchPersonProfileAndCredits(
      { id: 57633 },
      { forceProxy: true, fetchFn: mockFetch }
    );
    assert.equal(fromCache.person.name, "Morten Tyldum");
    assert.equal(calls.length, 2);

    // Aborted request returns null without caching
    clearPersonCache();
    const ac = new AbortController();
    ac.abort();
    const aborted = await fetchPersonProfileAndCredits(
      { id: 71580 },
      {
        forceProxy: true,
        signal: ac.signal,
        fetchFn: async (_url, init) => {
          if (init?.signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          return { ok: true, status: 200, json: async () => ({ id: 71580 }) };
        }
      }
    );
    assert.equal(aborted, null);

    // HTTP 429 triggers onHttpError cleanly and returns null
    let rateLimitedStatus = null;
    const rateLimited = await fetchPersonProfileAndCredits(
      { id: 71580 },
      {
        forceProxy: true,
        onHttpError: (status) => { rateLimitedStatus = status; },
        fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) })
      }
    );
    assert.equal(rateLimitedStatus, 429);
    assert.equal(rateLimited, null);
  } finally {
    if (prevKey !== undefined) process.env.VITE_TMDB_KEY = prevKey;
    clearPersonCache();
  }
});

test("buildPersonProfileRoute and shouldCloseMovieDetailOnEscape preserve department tab and prevent premature Escape close", () => {
  assert.equal(buildPersonProfileRoute(57633, "directing"), "/person/57633?dept=directing");
  assert.equal(buildPersonProfileRoute(71580, "all"), "/person/71580");
  assert.equal(buildPersonProfileRoute(null, "acting"), null);

  assert.equal(shouldCloseMovieDetailOnEscape({ activePerson: { name: "Benedict" }, hasOpenDialog: false }), false);
  assert.equal(shouldCloseMovieDetailOnEscape({ activePerson: null, hasOpenDialog: true }), false);
  assert.equal(shouldCloseMovieDetailOnEscape({ activePerson: null, hasOpenDialog: false }), true);
});
