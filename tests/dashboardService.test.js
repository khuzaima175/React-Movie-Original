import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSeenCollisionSet,
  excludeSeenAndPlaced,
  toDashboardCardItem,
  buildHeroSlides,
  loadHomeDiscoveryFeeds,
  shouldShowCarouselArrows,
  collectCatalogMosaic
} from "../src/services/dashboardService.js";

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
}

test("excludeSeenAndPlaced strips watched/watchlist by id/imdb/tmdb/title::year and deduplicates across rows", () => {
  const watched = [
    { imdbID: "tt1375666", tmdbId: 27205, title: "Inception", year: "2010", userRating: 9 }
  ];
  const watchlist = [
    { id: 157336, title: "Interstellar", year: "2014" }
  ];
  const seen = buildSeenCollisionSet(watched, watchlist);
  const placed = new Set();

  const row1 = excludeSeenAndPlaced(
    [
      { imdbID: "tt1375666", tmdbId: 27205, title: "Inception", year: "2010" },
      { tmdbId: 999999, imdbID: "tmdb_999999", title: "Fresh Film A", year: "2024" },
      { tmdbId: 888888, imdbID: "tmdb_888888", title: "Interstellar", year: "2014" }
    ],
    seen,
    placed
  );
  assert.deepEqual(row1.map((m) => m.title), ["Fresh Film A"]);

  const row2 = excludeSeenAndPlaced(
    [
      { tmdbId: 999999, imdbID: "tmdb_999999", title: "Fresh Film A", year: "2024" },
      { tmdbId: 777777, imdbID: "tmdb_777777", title: "Fresh Film B", year: "2025" }
    ],
    seen,
    placed
  );
  assert.deepEqual(row2.map((m) => m.title), ["Fresh Film B"]);
});

test("buildHeroSlides prioritizes unwatched TMDB-backdrop slides and avoids unsplash.com URLs", () => {
  const watched = [{ imdbID: "tmdb_10", tmdbId: 10, title: "Seen Movie", year: "2020" }];
  const watchlist = [
    {
      imdbID: "tmdb_20",
      tmdbId: 20,
      title: "Saved Unwatched Film",
      year: "2024",
      backdrop: "https://image.tmdb.org/t/p/original/abc.jpg"
    }
  ];
  const liveRows = [
    {
      key: "trending",
      movies: [
        toDashboardCardItem({
          id: 10,
          tmdbId: 10,
          title: "Seen Movie",
          year: "2020",
          backdrop: "https://image.tmdb.org/t/p/original/seen.jpg"
        }),
        toDashboardCardItem({
          id: 30,
          tmdbId: 30,
          title: "Fresh Backdrop Hit",
          year: "2025",
          vote_average: 8.1,
          backdrop: "https://image.tmdb.org/t/p/original/fresh.jpg"
        })
      ]
    }
  ];

  const slides = buildHeroSlides(liveRows, watchlist, watched, [], 5);
  assert.equal(slides.length, 2);
  assert.equal(slides.some((s) => s.title === "Seen Movie"), false);
  assert.equal(slides[0].backdrop, "https://image.tmdb.org/t/p/w1280/fresh.jpg");
  assert.equal(slides[1].backdrop, "https://image.tmdb.org/t/p/w1280/abc.jpg");
  for (const s of slides) {
    assert.doesNotMatch(String(s.backdrop || ""), /unsplash\.com/i);
  }
});

test("loadHomeDiscoveryFeeds offline mode returns >= 3 disjoint rows excluding watched and watchlist", async () => {
  const watched = [{ imdbID: "tt6751668", title: "Parasite", year: "2019", userRating: 9 }];
  const watchlist = [{ imdbID: "tt0245429", title: "Spirited Away", year: "2003" }];

  const result = await loadHomeDiscoveryFeeds({
    watched,
    watchlist,
    hasBackend: false,
    storage: createMemoryStorage()
  });

  assert.equal(result.isLive, false);
  assert.equal(result.rows.length >= 3, true);
  assert.equal(result.heroSlides.length >= 1, true);

  const seenTitles = new Set();
  for (const row of result.rows) {
    assert.equal(row.movies.length > 0, true);
    for (const m of row.movies) {
      assert.notEqual(m.title, "Parasite");
      assert.notEqual(m.title, "Spirited Away");
      const key = `${m.title.toLowerCase()}::${m.year}`;
      assert.equal(seenTitles.has(key), false, `Duplicate movie across offline rows: ${m.title}`);
      seenTitles.add(key);
    }
  }
});

test("loadHomeDiscoveryFeeds live mode deduplicates overlapping TMDB rows, sets tmdb_<id>, and caches in storage", async () => {
  const storage = createMemoryStorage();
  const watched = [
    { imdbID: "tt0111161", title: "The Shawshank Redemption", year: "1994", genre: "Drama, Crime", userRating: 10 },
    { imdbID: "tt0468569", title: "The Dark Knight", year: "2008", genre: "Action, Crime, Thriller", userRating: 9 }
  ];

  let fetchCount = 0;
  const fetchTmdb = async (path) => {
    fetchCount += 1;
    if (path === "/3/trending/movie/week") {
      return {
        results: [
          {
            id: 1001,
            title: "Shared Overlap Hit",
            release_date: "2025-05-01",
            vote_average: 7.9,
            genre_ids: [18, 53],
            poster_path: "/p1001.jpg",
            backdrop_path: "/b1001.jpg",
            overview: "A gripping drama."
          },
          {
            id: 1002,
            title: "Trending Original",
            release_date: "2026-01-12",
            vote_average: 7.6,
            genre_ids: [878],
            poster_path: "/p1002.jpg",
            backdrop_path: "/b1002.jpg",
            overview: "Sci-fi odyssey."
          }
        ]
      };
    }
    return {
      results: [
        {
          id: 1001,
          title: "Shared Overlap Hit",
          release_date: "2025-05-01",
          vote_average: 7.9,
          genre_ids: [18, 53],
          poster_path: "/p1001.jpg",
          backdrop_path: "/b1001.jpg",
          overview: "A gripping drama."
        },
        {
          id: 2001,
          title: "Curated Pick 2001",
          release_date: "2023-03-15",
          vote_average: 8.3,
          genre_ids: [18],
          poster_path: "/p2001.jpg",
          backdrop_path: "/b2001.jpg",
          overview: "Deep character piece."
        }
      ]
    };
  };

  const first = await loadHomeDiscoveryFeeds({
    watched,
    watchlist: [],
    userRegion: "US",
    hasBackend: true,
    fetchTmdb,
    now: Date.UTC(2026, 10, 14, 12, 0, 0),
    storage
  });

  assert.equal(first.isLive, true);
  assert.equal(fetchCount >= 3, true);

  const allCards = first.rows.flatMap((r) => r.movies);
  const idCounts = new Set(allCards.map((m) => m.tmdbId));
  assert.equal(idCounts.size, allCards.length, "Discovery rows must not repeat TMDB IDs");
  assert.equal(allCards[0].imdbID, `tmdb_${allCards[0].tmdbId}`);

  const callsAfterFirst = fetchCount;
  const second = await loadHomeDiscoveryFeeds({
    watched,
    watchlist: [],
    userRegion: "US",
    hasBackend: true,
    fetchTmdb,
    now: Date.UTC(2026, 10, 14, 12, 5, 0),
    storage
  });

  assert.equal(fetchCount, callsAfterFirst, "Second call within same day/profile should use cached feeds");
  assert.deepEqual(second.rows, first.rows);
});

test("shouldShowCarouselArrows returns true only when scrollWidth exceeds clientWidth beyond 4px tolerance", () => {
  assert.equal(shouldShowCarouselArrows(800, 1200), false);
  assert.equal(shouldShowCarouselArrows(1202, 1200), false);
  assert.equal(shouldShowCarouselArrows(1450, 1200), true);
  assert.equal(shouldShowCarouselArrows(0, 0), false);
});

test("loadHomeDiscoveryFeeds returns up to 8 live rows (~20 posters/row via page 1+2) with zero duplicates and populates mosaicPool", async () => {
  const watched = [{ imdbID: "tt9990001", tmdbId: 9990001, title: "Already Watched", year: "2020", genre: "Sci-Fi", userRating: 9 }];
  const watchlist = [{ imdbID: "tmdb_9990002", tmdbId: 9990002, title: "Already Watchlisted", year: "2022" }];

  let nextId = 100;
  const fetchTmdb = async (_path, params = {}) => {
    const page = Number(params.page || 1);
    const results = [];
    if (page === 1) {
      results.push({ id: 9990001, title: "Already Watched", release_date: "2020-01-01", vote_average: 8.4, genre_ids: [878], poster_path: "/watched.jpg" });
      results.push({ id: 9990002, title: "Already Watchlisted", release_date: "2022-01-01", vote_average: 7.9, genre_ids: [18], poster_path: "/watchlisted.jpg" });
    }
    for (let i = 0; i < 15; i += 1) {
      const id = nextId++;
      results.push({
        id,
        title: `Discovery Film ${id}`,
        release_date: "2024-04-10",
        vote_average: 7.5 + ((id % 15) * 0.1),
        genre_ids: [i % 2 === 0 ? 18 : 878],
        poster_path: `/poster_${id}.jpg`,
        backdrop_path: `/backdrop_${id}.jpg`,
        overview: "Cinematic plot."
      });
    }
    return { results };
  };

  const result = await loadHomeDiscoveryFeeds({
    watched,
    watchlist,
    userRegion: "US",
    hasBackend: true,
    fetchTmdb,
    now: Date.UTC(2026, 10, 14, 15, 0, 0),
    storage: createMemoryStorage()
  });

  assert.equal(result.isLive, true);
  assert.equal(result.rows.length, 8);
  assert.ok(result.rows[0].movies.length <= 20 && result.rows[0].movies.length >= 15);
  assert.ok(Array.isArray(result.mosaicPool) && result.mosaicPool.length >= 40);

  const flat = result.rows.flatMap((r) => r.movies);
  const uniqueIds = new Set(flat.map((m) => m.tmdbId));
  assert.equal(uniqueIds.size, flat.length);
  assert.equal(flat.some((m) => m.tmdbId === 9990001 || m.tmdbId === 9990002), false);
});

test("loadHomeDiscoveryFeeds offline fallback provides at least 36 unique posters across curated rows", async () => {
  const result = await loadHomeDiscoveryFeeds({
    watched: [],
    watchlist: [],
    hasBackend: false,
    storage: createMemoryStorage()
  });
  assert.equal(result.isLive, false);
  const all = result.rows.flatMap((r) => r.movies);
  assert.ok(all.length >= 36, `Expected >= 36 fallback posters, got ${all.length}`);
  const seen = new Set(all.map((m) => `${m.title.toLowerCase()}::${m.year}`));
  assert.equal(seen.size, all.length);
  assert.ok(Array.isArray(result.mosaicPool) && result.mosaicPool.length >= 36);
});

test("collectCatalogMosaic filters items by selectedGenre case-insensitively, preserves deduplication, and caps by limit", () => {
  const rows = [
    {
      key: "a",
      movies: [
        { imdbID: "tt1", title: "Alpha", year: "2020", genre: "Sci-Fi • Drama", poster: "p1.jpg" },
        { imdbID: "tt2", title: "Beta", year: "2021", genre: "Crime • Thriller", poster: "p2.jpg" }
      ]
    },
    {
      key: "b",
      movies: [
        { imdbID: "tt1", title: "Alpha", year: "2020", genre: "Sci-Fi • Drama", poster: "p1.jpg" },
        { imdbID: "tt3", title: "Gamma", year: "2022", genre: "sci-fi, Action", poster: "p3.jpg" }
      ]
    }
  ];

  const all = collectCatalogMosaic({ rows, selectedGenre: "All", limit: 2 });
  assert.equal(all.totalCount, 3);
  assert.equal(all.items.length, 2);
  assert.ok(all.availableGenres.includes("All"));
  assert.ok(all.availableGenres.includes("Sci-Fi"));

  const sciFi = collectCatalogMosaic({ rows, selectedGenre: "sci-fi", limit: 10 });
  assert.equal(sciFi.totalCount, 2);
  assert.deepEqual(sciFi.items.map((m) => m.title), ["Alpha", "Gamma"]);
});
