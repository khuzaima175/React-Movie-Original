import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_TASTE_DECK,
  buildTasteDeck,
  shouldAutoShowTasteOnboarding
} from "../src/services/tasteDeckService.js";

test("CORE_TASTE_DECK covers at least 8 distinct genres with 30 valid poster records", () => {
  assert.equal(CORE_TASTE_DECK.length, 30);
  const genres = new Set(CORE_TASTE_DECK.map((m) => m.primaryGenre));
  assert.ok(genres.size >= 8);
  assert.ok(CORE_TASTE_DECK.every((m) => m.imdbID && m.title && m.poster));
});

test("buildTasteDeck excludes watched films, interleaves genres, and tops up from livePool", () => {
  const watched = CORE_TASTE_DECK.slice(0, 5).map((m) => ({ imdbID: m.imdbID, title: m.title }));
  const livePool = Array.from({ length: 10 }, (_, idx) => ({
    imdbID: `tmdb_${9000 + idx}`,
    tmdbId: 9000 + idx,
    title: `Live Film ${idx}`,
    year: "2024",
    poster: `https://image.tmdb.org/t/p/w500/live${idx}.jpg`,
    genre: idx % 2 === 0 ? "Drama" : "Sci-Fi",
    imdbRating: "7.8"
  }));
  const deck = buildTasteDeck({ watched, watchlist: [], livePool, deckSize: 30 });
  assert.equal(deck.length, 30);
  const watchedIds = new Set(watched.map((w) => w.imdbID));
  assert.equal(deck.some((m) => watchedIds.has(m.imdbID)), false);
  const firstGenres = new Set(deck.slice(0, 3).map((m) => m.primaryGenre));
  assert.ok(firstGenres.size >= 2);
});

test("shouldAutoShowTasteOnboarding triggers only for new users (< 3 watched) who have not dismissed", () => {
  assert.equal(shouldAutoShowTasteOnboarding({ watchedCount: 0, dismissedFlag: null }), true);
  assert.equal(shouldAutoShowTasteOnboarding({ watchedCount: 2, dismissedFlag: "false" }), true);
  assert.equal(shouldAutoShowTasteOnboarding({ watchedCount: 3, dismissedFlag: null }), false);
  assert.equal(shouldAutoShowTasteOnboarding({ watchedCount: 0, dismissedFlag: "true" }), false);
});
