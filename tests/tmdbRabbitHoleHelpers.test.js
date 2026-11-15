import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTmdbMovieDetails,
  normalizeTmdbItem,
  fetchCollectionTimeline,
  fetchTmdbMovieRecommendations,
  searchTmdbKeywords
} from "../src/services/tmdbService.js";

test("formatTmdbMovieDetails preserves keywordItems [{ id, name }] alongside tmdbKeywords and collection metadata", () => {
  const formatted = formatTmdbMovieDetails({
    id: 155,
    title: "The Dark Knight",
    release_date: "2008-07-16",
    genres: [{ id: 18, name: "Drama" }, { id: 28, name: "Action" }],
    belongs_to_collection: {
      id: 263,
      name: "The Dark Knight Collection"
    },
    keywords: {
      keywords: [
        { id: 4379, name: "time travel" },
        { id: null, name: "broken" },
        { id: 9882, name: "space" }
      ]
    },
    credits: { cast: [], crew: [] },
    external_ids: { imdb_id: "tt0468569" }
  });

  assert.equal(formatted.collectionId, 263);
  assert.equal(formatted.collectionName, "The Dark Knight Collection");
  assert.deepEqual(formatted.keywordItems, [
    { id: 4379, name: "time travel" },
    { id: 9882, name: "space" }
  ]);
  assert.deepEqual(formatted.tmdbKeywords, [4379, 9882]);
  assert.deepEqual(formatted.keywordNames, ["time travel", "space"]);
});

test("fetchCollectionTimeline fetches /3/collection/:id and handles invalid IDs cleanly", async () => {
  let called = 0;
  const blank = await fetchCollectionTimeline("", {
    apiKey: "test-tmdb-key",
    fetchFn: async () => {
      called += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    }
  });
  assert.equal(blank, null);
  assert.equal(called, 0);

  let requestedUrl = "";
  const timeline = await fetchCollectionTimeline(263, {
    apiKey: "test-tmdb-key",
    fetchFn: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 263,
          name: "The Dark Knight Collection",
          overview: "Christopher Nolan's Batman trilogy.",
          parts: [
            { id: 272, title: "Batman Begins", release_date: "2005-06-10", vote_average: 7.7 },
            { id: 155, title: "The Dark Knight", release_date: "2008-07-16", vote_average: 8.5 }
          ]
        })
      };
    }
  });

  assert.match(requestedUrl, /\/3\/collection\/263/);
  assert.equal(timeline.id, 263);
  assert.equal(timeline.name, "The Dark Knight Collection");
  assert.equal(timeline.parts.length, 2);
});

test("fetchTmdbMovieRecommendations falls back to /similar when /recommendations has fewer than 4 items and skips /similar otherwise", async () => {
  const seenUrls = [];
  const merged = await fetchTmdbMovieRecommendations(157336, {
    apiKey: "test-tmdb-key",
    fetchFn: async (url) => {
      const s = String(url);
      seenUrls.push(s);
      if (s.includes("/recommendations")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { id: 155, title: "The Dark Knight", release_date: "2008-07-16" },
              { id: 27205, title: "Inception", release_date: "2010-07-15" }
            ]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { id: 27205, title: "Inception", release_date: "2010-07-15" },
            { id: 62, title: "2001: A Space Odyssey", release_date: "1968-04-02" }
          ]
        })
      };
    }
  });

  assert.equal(seenUrls.length, 2);
  assert.match(seenUrls[0], /\/3\/movie\/157336\/recommendations/);
  assert.match(seenUrls[1], /\/3\/movie\/157336\/similar/);
  assert.deepEqual(
    merged.map((m) => m.id),
    [155, 27205, 62]
  );

  const recOnlyUrls = [];
  const recsOnly = await fetchTmdbMovieRecommendations(157336, {
    apiKey: "test-tmdb-key",
    fetchFn: async (url) => {
      recOnlyUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { id: 1, title: "One" },
            { id: 2, title: "Two" },
            { id: 3, title: "Three" },
            { id: 4, title: "Four" }
          ]
        })
      };
    }
  });

  assert.equal(recOnlyUrls.length, 1);
  assert.equal(recsOnly.length, 4);
});

test("searchTmdbKeywords skips blank queries and returns trimmed { id, name } results", async () => {
  let calls = 0;
  const empty = await searchTmdbKeywords("   ", {
    apiKey: "test-tmdb-key",
    fetchFn: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }
  });
  assert.deepEqual(empty, []);
  assert.equal(calls, 0);

  let requestedUrl = "";
  const results = await searchTmdbKeywords(" time travel ", {
    apiKey: "test-tmdb-key",
    fetchFn: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { id: 4379, name: "time travel" },
            { id: 99, name: "time loop" }
          ]
        })
      };
    }
  });

  assert.match(requestedUrl, /\/3\/search\/keyword/);
  assert.match(requestedUrl, /query=time\+travel|query=time%20travel/);
  assert.deepEqual(results, [
    { id: 4379, name: "time travel" },
    { id: 99, name: "time loop" }
  ]);
});

test("normalizeTmdbItem populates imdbRating from vote_average and Rabbit Hole helpers silence AbortError warnings", async () => {
  const card = normalizeTmdbItem({
    id: 155,
    title: "The Dark Knight",
    release_date: "2008-07-16",
    vote_average: 8.52
  });
  assert.equal(card.imdbRating, 8.5);
  assert.equal(card.vote_average, 8.5);

  const warned = [];
  const origWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    const failingFetch = async () => {
      throw abortErr;
    };
    const [col, recs, kws] = await Promise.all([
      fetchCollectionTimeline(263, { apiKey: "test-tmdb-key", fetchFn: failingFetch }),
      fetchTmdbMovieRecommendations(155, { apiKey: "test-tmdb-key", fetchFn: failingFetch }),
      searchTmdbKeywords("time", { apiKey: "test-tmdb-key", fetchFn: failingFetch })
    ]);
    assert.equal(col, null);
    assert.deepEqual(recs, []);
    assert.deepEqual(kws, []);
    assert.equal(warned.length, 0, "AbortError must not pollute console.warn");
  } finally {
    console.warn = origWarn;
  }
});
