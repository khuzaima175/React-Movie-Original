import test from "node:test";
import assert from "node:assert/strict";
import { encodeEmbeddingBinary, parseEmbeddingBinary } from "../src/services/embeddingService.js";
import {
  normalizeCollectionTimeline,
  findEmbeddingNeighborsForMovie,
  buildHybridSimilarFilms
} from "../src/services/rabbitHoleService.js";

test("normalizeCollectionTimeline sorts parts chronologically, places TBA last, and tracks Vault completion", () => {
  const timeline = normalizeCollectionTimeline(
    {
      id: 528,
      name: "Terminator Collection",
      parts: [
        { tmdbId: 280, title: "T2", release_date: "1991-07-03", poster: "p2" },
        { tmdbId: 999, title: "Future Untitled", release_date: "", poster: null },
        { id: 218, title: "The Terminator", release_date: "1984-10-26", poster_path: "/p1.jpg" }
      ]
    },
    { tmdbId: 280 },
    [{ tmdbId: 218, userRating: 9 }],
    [{ tmdbId: 280 }]
  );

  assert.equal(timeline.id, 528);
  assert.equal(timeline.name, "Terminator Collection");
  assert.equal(timeline.parts[0].tmdbId, 218);
  assert.equal(timeline.parts[0].isWatched, true);
  assert.equal(timeline.parts[0].userRating, 9);
  assert.match(timeline.parts[0].poster, /\/p1\.jpg/);
  assert.equal(timeline.parts[1].tmdbId, 280);
  assert.equal(timeline.parts[1].isCurrent, true);
  assert.equal(timeline.parts[1].isWatchlist, true);
  assert.equal(timeline.parts[2].tmdbId, 999);
  assert.equal(timeline.watchedCount, 1);
  assert.equal(timeline.totalCount, 3);
});

test("findEmbeddingNeighborsForMovie finds closest cosine kin from CVEM binary and sub-unit shrunk vectors", () => {
  const buf = encodeEmbeddingBinary([
    { tmdbId: 10, vector: [0.6, 0.8, 0, 0] },
    { tmdbId: 20, vector: [0.3, 0.4, 0, 0] },
    { tmdbId: 30, vector: [0, 0, 1, 0] }
  ]);
  const index = parseEmbeddingBinary(buf);
  const neighbors = findEmbeddingNeighborsForMovie(10, index, { limit: 5 });

  assert.equal(neighbors[0].tmdbId, 20);
  assert.ok(neighbors[0].sim > 0.98);
  assert.ok(!neighbors.some((n) => n.tmdbId === 10));

  // Verify sub-unit shrunk vector [0.06, 0.08, 0, 0] (norm=0.1, true cosine=1.0) still beats unit distractor [0.6, 0, 0.8, 0]
  const shrunkIndex = {
    dim: 4,
    count: 3,
    ids: new Uint32Array([10, 20, 30]),
    vectors: new Float32Array([
      0.6, 0.8, 0, 0,
      0.06, 0.08, 0, 0,
      0.6, 0, 0.8, 0
    ]),
    idToIndex: new Map([[10, 0], [20, 1], [30, 2]])
  };
  const shrunkNeighbors = findEmbeddingNeighborsForMovie(10, shrunkIndex, { excludeIds: new Set([30]), limit: 5 });
  assert.equal(shrunkNeighbors.length, 1);
  assert.equal(shrunkNeighbors[0].tmdbId, 20);
  assert.ok(shrunkNeighbors[0].sim > 0.99);
});

test("buildHybridSimilarFilms deduplicates dual sources, prioritizes overlapping picks, preserves fresh TMDB recs, and excludes self", () => {
  const res = buildHybridSimilarFilms({
    currentMovie: { tmdbId: 100, imdbID: "tt0100" },
    embeddingNeighbors: [{ tmdbId: 200, sim: 0.91 }, { tmdbId: 300, sim: 0.85 }],
    hydratedEmbeddingCards: [
      { tmdbId: 200, imdbID: "tmdb_200", title: "Overlap Film" },
      { tmdbId: 300, imdbID: "tmdb_300", title: "Vector Film" }
    ],
    tmdbRecommendations: [
      { tmdbId: 100, imdbID: "tmdb_100", title: "Self" },
      { tmdbId: 200, imdbID: "tmdb_200", title: "Overlap Film" },
      { tmdbId: 400, imdbID: "tmdb_400", title: "New 2025 Release" }
    ],
    watched: [{ tmdbId: 300, userRating: 8 }],
    watchlist: [],
    limit: 10
  });

  assert.ok(!res.some((m) => m.tmdbId === 100));
  assert.equal(res[0].tmdbId, 200);
  assert.equal(res[0].matchOrigin, "hybrid");
  assert.equal(res.length, 3);
  assert.equal(res.find((m) => m.tmdbId === 300)?.userRating, 8);
  assert.equal(res.find((m) => m.tmdbId === 300)?.isWatched, true);
  assert.equal(res.find((m) => m.tmdbId === 300)?.matchOrigin, "vault-vector");
  assert.equal(res.find((m) => m.tmdbId === 400)?.matchOrigin, "tmdb");
});
