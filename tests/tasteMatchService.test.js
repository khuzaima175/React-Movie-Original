import test from "node:test";
import assert from "node:assert/strict";
import {
  TASTE_MATCH_MIN_RATED,
  calibratePredictedRating,
  buildTasteMatchContext,
  predictMovieMatch
} from "../src/services/tasteMatchService.js";

import { encodeEaseBinary, parseEaseBinary } from "../src/services/easeService.js";

function makeTinyEmbeddingIndex() {
  const dim = 4;
  // 10 & 11 = loved sci-fi thrillers; 20 = close unseen match; 30 = hated horror; 31 = close to hated horror
  const ids = [10, 11, 20, 30, 31];
  const vecs = [
    [0.98, 0.2, 0, 0],
    [0.94, 0.34, 0, 0],
    [0.96, 0.28, 0, 0],
    [0, 0, 0.99, 0.14],
    [0, 0, 0.97, 0.24]
  ];
  const vectors = new Float32Array(ids.length * dim);
  const idToIndex = new Map();
  ids.forEach((id, i) => {
    idToIndex.set(id, i);
    for (let d = 0; d < dim; d += 1) {
      vectors[i * dim + d] = vecs[i][d];
    }
  });
  return { dim, count: ids.length, ids: new Uint32Array(ids), vectors, idToIndex };
}

test("predictMovieMatch returns insufficient confidence when fewer than 3 rated films exist", () => {
  assert.equal(TASTE_MATCH_MIN_RATED, 3);
  const res = predictMovieMatch({
    movie: { tmdbId: 20, title: "Arrival", tmdbGenreIds: [878, 18], vote_average: 7.9, vote_count: 15000 },
    watched: [
      { tmdbId: 10, title: "Inception", userRating: 10 },
      { tmdbId: 11, title: "Interstellar", userRating: 9 }
    ],
    embeddingIndex: makeTinyEmbeddingIndex()
  });
  assert.equal(res.available, false);
  assert.equal(res.confidence, "insufficient");
  assert.equal(res.matchPct, null);
  assert.equal(res.predictedRating, null);
});

test("predictMovieMatch scores indexed CVEM neighbors high, penalizes disliked repulsion neighbors, and calibrates Est. Rating", () => {
  const index = makeTinyEmbeddingIndex();
  const watched = [
    { tmdbId: 10, title: "Inception", userRating: 10, genre: "Sci-Fi, Thriller", director: "Christopher Nolan", tmdbGenreIds: [878, 53] },
    { tmdbId: 11, title: "Interstellar", userRating: 9, genre: "Sci-Fi, Drama", director: "Christopher Nolan", tmdbGenreIds: [878, 18] },
    { tmdbId: 30, title: "Slasher X", userRating: 3, genre: "Horror", director: "Unknown", tmdbGenreIds: [27] }
  ];

  const ctx = buildTasteMatchContext({ watched, embeddingIndex: index });

  const highMatch = predictMovieMatch({
    movie: {
      tmdbId: 20,
      title: "Tenet",
      genre: "Sci-Fi, Thriller",
      director: "Christopher Nolan",
      tmdbGenreIds: [878, 53],
      vote_average: 7.4,
      vote_count: 9000
    },
    cachedContext: ctx
  });

  const lowMatch = predictMovieMatch({
    movie: {
      tmdbId: 31,
      title: "Slasher Y",
      genre: "Horror",
      director: "Other",
      tmdbGenreIds: [27],
      vote_average: 5.5,
      vote_count: 400
    },
    cachedContext: ctx
  });

  assert.equal(highMatch.available, true);
  assert.equal(highMatch.confidence, "high");
  assert.ok(highMatch.matchPct >= 80, `Expected high match >= 80, got ${highMatch.matchPct}`);
  assert.ok(highMatch.predictedRating >= 7.5 && highMatch.predictedRating <= 9.9);
  assert.ok(highMatch.summary.length > 0);
  assert.ok(highMatch.anchorTitles.includes("Inception") || highMatch.anchorTitles.includes("Interstellar"));

  assert.equal(lowMatch.available, true);
  assert.ok(lowMatch.matchPct < highMatch.matchPct - 15, `Disliked neighbor (${lowMatch.matchPct}) must score well below loved neighbor (${highMatch.matchPct})`);
});

test("predictMovieMatch falls back cleanly to metadata confidence for unindexed 2025-2026 films without collapsing to 50%", () => {
  const index = makeTinyEmbeddingIndex();
  const watched = [
    { tmdbId: 10, title: "Inception", userRating: 10, genre: "Sci-Fi, Thriller", director: "Christopher Nolan", tmdbGenreIds: [878, 53] },
    { tmdbId: 11, title: "Interstellar", userRating: 9, genre: "Sci-Fi, Drama", director: "Christopher Nolan", tmdbGenreIds: [878, 18] },
    { tmdbId: 30, title: "Slasher X", userRating: 4, genre: "Horror", director: "Other", tmdbGenreIds: [27] }
  ];

  const recentUnindexed = predictMovieMatch({
    movie: {
      tmdbId: 999999,
      title: "The Odyssey",
      year: "2026",
      genre: "Sci-Fi, Drama",
      director: "Christopher Nolan",
      tmdbGenreIds: [878, 18],
      vote_average: 8.4,
      vote_count: 2500
    },
    watched,
    embeddingIndex: index
  });

  assert.equal(recentUnindexed.available, true);
  assert.equal(recentUnindexed.confidence, "metadata");
  assert.ok(recentUnindexed.matchPct >= 70, `Strong director+genre unindexed film should score >= 70, got ${recentUnindexed.matchPct}`);
  assert.match(recentUnindexed.summary, /Christopher Nolan|Sci-Fi/i);
});

test("calibratePredictedRating maps matchPct cleanly onto user rating distribution in [4.5, 9.9]", () => {
  const watched = [
    { userRating: 10 },
    { userRating: 9 },
    { userRating: 8 },
    { userRating: 7 }
  ];
  const high = calibratePredictedRating({ matchPct: 95, watched });
  const mid = calibratePredictedRating({ matchPct: 72, watched });
  const low = calibratePredictedRating({ matchPct: 52, watched });

  assert.ok(high > mid && mid > low);
  assert.ok(high <= 9.9 && low >= 4.5);
});


test("predictMovieMatch honors Prefer vs Avoid taste rules properly and matches OMDb genre names against TMDB candidates", () => {
  const watched = [
    { tmdbId: 10, title: "Inception", userRating: 10, genre: "Sci-Fi, Thriller", director: "Christopher Nolan" },
    { tmdbId: 11, title: "Interstellar", userRating: 9, genre: "Sci-Fi, Drama", director: "Christopher Nolan" },
    { tmdbId: 30, title: "Slasher X", userRating: 3, genre: "Horror", director: "Other" }
  ];
  const candidate = {
    tmdbId: 500001,
    title: "Arrival",
    genre: "Science Fiction, Drama",
    tmdbGenreIds: [878, 18],
    vote_average: 7.9,
    vote_count: 15000
  };

  const baseline = predictMovieMatch({ movie: candidate, watched, tasteRules: [] });
  const withPrefer = predictMovieMatch({
    movie: candidate,
    watched,
    tasteRules: [{ id: "r1", text: "Prefer science fiction", polarity: "prefer", active: true }]
  });
  const withAvoid = predictMovieMatch({
    movie: candidate,
    watched,
    tasteRules: [{ id: "r2", text: "Avoid science fiction", polarity: "avoid", active: true }]
  });

  assert.ok(withPrefer.matchPct >= baseline.matchPct, `Prefer rule must not penalize (${withPrefer.matchPct} vs ${baseline.matchPct})`);
  assert.ok(withAvoid.matchPct < baseline.matchPct - 10, `Avoid rule must penalize (${withAvoid.matchPct} vs ${baseline.matchPct})`);
});

test("buildTasteMatchContext blends EASE^R graph neighbors and predicts 2024-2026 cold-start films via 128-D content embeddings", () => {
  const embeddingIndex = makeTinyEmbeddingIndex();
  // Cold film 901 (2025 sci-fi aligned with Inception/Interstellar), Cold film 902 (2025 orthogonal romantic comedy)
  const contentIds = [10, 11, 30, 901, 902];
  const contentDim = 4;
  const contentVecs = [
    [0.95, 0.3, 0, 0],
    [0.92, 0.38, 0, 0],
    [0, 0, 0.98, 0.2],
    [0.94, 0.34, 0, 0],
    [0, 0, 0.1, 0.99]
  ];
  const contentVectors = new Float32Array(contentIds.length * contentDim);
  const contentIdToIndex = new Map();
  contentIds.forEach((id, i) => {
    contentIdToIndex.set(id, i);
    for (let d = 0; d < contentDim; d += 1) {
      contentVectors[i * contentDim + d] = contentVecs[i][d];
    }
  });
  const contentIndex = {
    dim: contentDim,
    count: contentIds.length,
    ids: new Uint32Array(contentIds),
    vectors: contentVectors,
    idToIndex: contentIdToIndex
  };

  // EASE graph strongly connects Inception(10) -> Cold/Warm item 20 & item 31 stays isolated
  const easeBuf = encodeEaseBinary(
    [
      { tmdbId: 10, neighbors: [{ index: 1, weight: 0.9 }, { index: 2, weight: 0.01 }] },
      { tmdbId: 20, neighbors: [{ index: 0, weight: 0.9 }, { index: 2, weight: 0.01 }] },
      { tmdbId: 30, neighbors: [{ index: 0, weight: 0.01 }, { index: 1, weight: 0.01 }] }
    ],
    2
  );
  const easeIndex = parseEaseBinary(easeBuf);

  const watched = [
    { tmdbId: 10, title: "Inception", userRating: 10, genre: "Sci-Fi, Thriller", tmdbGenreIds: [878, 53] },
    { tmdbId: 11, title: "Interstellar", userRating: 9, genre: "Sci-Fi, Drama", tmdbGenreIds: [878, 18] },
    { tmdbId: 30, title: "Slasher X", userRating: 3, genre: "Horror", tmdbGenreIds: [27] }
  ];

  const ctx = buildTasteMatchContext({ watched, embeddingIndex, easeIndex, contentIndex });
  assert.equal(ctx.hasEaseBlend, true);

  const warmEaseMatch = predictMovieMatch({
    movie: { tmdbId: 20, title: "Tenet", genre: "Sci-Fi, Thriller", tmdbGenreIds: [878, 53], vote_average: 7.4, vote_count: 8000 },
    cachedContext: ctx
  });
  assert.equal(warmEaseMatch.confidence, "high");

  const coldAligned = predictMovieMatch({
    movie: { tmdbId: 901, title: "Nebula Rising", year: "2025", genre: "Drama", vote_average: 7.4, vote_count: 500 },
    cachedContext: ctx
  });
  const coldOrthogonal = predictMovieMatch({
    movie: { tmdbId: 902, title: "Wedding Chaos", year: "2025", genre: "Comedy", vote_average: 7.4, vote_count: 500 },
    cachedContext: ctx
  });

  assert.equal(coldAligned.confidence, "semantic");
  assert.equal(coldOrthogonal.confidence, "semantic");
  assert.ok(coldAligned.matchPct > coldOrthogonal.matchPct + 10, `Semantic cold-start match (${coldAligned.matchPct}) should outscore orthogonal film (${coldOrthogonal.matchPct})`);
  assert.ok(coldAligned.anchorTitles.includes("Inception") || coldAligned.anchorTitles.includes("Interstellar"));
});
