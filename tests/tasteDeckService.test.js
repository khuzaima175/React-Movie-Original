import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_TASTE_DECK,
  STARTER_GENRE_FILTERS,
  buildTasteDeck,
  shouldAutoShowTasteOnboarding,
  INLINE_ONBOARDING_DISMISSED_KEY,
  shouldShowInlineOnboardingBanner,
  selectInlineStarterFilms,
  retainRatedInlineStarters
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

test("shouldShowInlineOnboardingBanner shows only when hydrated, < 3 watched, and not dismissed", () => {
  assert.equal(INLINE_ONBOARDING_DISMISSED_KEY, "cinemavault_inline_onboarding_dismissed_v1");
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 0, dismissedFlag: null, isVaultHydrated: true }), true);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 2, dismissedFlag: "false", isVaultHydrated: true }), true);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 3, dismissedFlag: null, isVaultHydrated: true }), false);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 0, dismissedFlag: "true", isVaultHydrated: true }), false);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 0, dismissedFlag: null, isVaultHydrated: false }), false);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 0, dismissedFlag: null, isVaultHydrated: true, isAuthLoading: true }), false);
  assert.equal(shouldShowInlineOnboardingBanner({ watchedCount: 0, dismissedFlag: null, isVaultHydrated: true, isCloudSyncPending: true }), false);
});

test("selectInlineStarterFilms returns up to 8 genre-diverse unseen films", () => {
  const watched = [CORE_TASTE_DECK[0]];
  const starters = selectInlineStarterFilms({ watched, watchlist: [], limit: 8 });
  assert.equal(starters.length, 8);
  assert.equal(starters.some((m) => m.imdbID === CORE_TASTE_DECK[0].imdbID), false);
  const genres = new Set(starters.map((m) => m.primaryGenre));
  assert.ok(genres.size >= 6);
});

test("retainRatedInlineStarters preserves card positions of already-rendered starters after rating so checkmarks stay visible", () => {
  const initial = selectInlineStarterFilms({ watched: [], watchlist: [], limit: 8 });
  const ratedId = initial[1].imdbID;
  const skippedIds = new Set([initial[3].imdbID]);
  const next = retainRatedInlineStarters(initial, {
    justRatedIds: { [ratedId]: 9 },
    skippedIds,
    watched: [{ imdbID: ratedId, userRating: 9 }],
    watchlist: [],
    limit: 8
  });
  assert.equal(next[1].imdbID, ratedId);
  assert.equal(next.some((m) => m.imdbID === initial[3].imdbID), false);
});

test("selectInlineStarterFilms filters by preferredGenres and swaps unseen batches cleanly via excludeIds", () => {
  assert.ok(STARTER_GENRE_FILTERS.includes("Sci-Fi"));
  const scifiBatch = selectInlineStarterFilms({
    preferredGenres: ["Sci-Fi"],
    limit: 6
  });
  assert.equal(scifiBatch.length, 6);
  const firstBatchIds = new Set(scifiBatch.map((m) => m.imdbID));
  assert.ok(
    scifiBatch.slice(0, 3).every((m) => /sci-fi/i.test(`${m.primaryGenre} ${m.genre}`)),
    "Preferred genre items should appear first"
  );

  const swappedBatch = selectInlineStarterFilms({
    excludeIds: firstBatchIds,
    limit: 6
  });
  assert.equal(swappedBatch.length, 6);
  assert.equal(swappedBatch.some((m) => firstBatchIds.has(m.imdbID)), false);
});
