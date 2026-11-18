import test from "node:test";
import assert from "node:assert/strict";
import { CORE_TASTE_DECK } from "../src/services/tasteDeckService.js";
import { computeZScoredWeights } from "../src/services/scoringUtils.js";
import {
  SAMPLE_VAULT_MIN_WATCHED,
  buildSampleVault,
  isSampleItem,
  mergeSampleVault
} from "../src/services/sampleVaultService.js";

test("buildSampleVault returns >=14 rated films with integer ratings 1-10 and at least two <= 4", () => {
  const { watched } = buildSampleVault({ now: Date.UTC(2026, 10, 18) });
  assert.ok(watched.length >= SAMPLE_VAULT_MIN_WATCHED);
  assert.ok(watched.length >= 14);
  const lowRated = watched.filter((m) => m.userRating <= 4);
  assert.ok(lowRated.length >= 2);
  for (const m of watched) {
    assert.equal(Number.isInteger(m.userRating), true);
    assert.ok(m.userRating >= 1 && m.userRating <= 10);
  }
});

test("buildSampleVault includes at least three userNotes and >=6 disjoint watchlist films", () => {
  const { watched, watchlist } = buildSampleVault({ now: Date.UTC(2026, 10, 18) });
  const noted = watched.filter((m) => typeof m.userNote === "string" && m.userNote.trim().length > 0);
  assert.ok(noted.length >= 3);

  assert.ok(watchlist.length >= 6);
  const watchedIds = new Set(watched.map((m) => m.imdbID));
  for (const item of watchlist) {
    assert.equal(watchedIds.has(item.imdbID), false);
    assert.equal(isSampleItem(item), true);
  }
});

test("buildSampleVault stamps isSample: true from unique CORE_TASTE_DECK entries across >365 days before now", () => {
  const now = Date.UTC(2026, 10, 18);
  const deckIds = new Set(CORE_TASTE_DECK.map((m) => m.imdbID));
  const { watched, watchlist } = buildSampleVault({ now });
  const seen = new Set();

  let minDate = Infinity;
  let maxDate = -Infinity;
  for (const m of watched) {
    assert.equal(isSampleItem(m), true);
    assert.equal(deckIds.has(m.imdbID), true);
    assert.equal(seen.has(m.imdbID), false);
    seen.add(m.imdbID);

    const parsed = Date.parse(m.dateWatched);
    assert.equal(Number.isFinite(parsed), true);
    assert.ok(parsed < now);
    if (parsed < minDate) minDate = parsed;
    if (parsed > maxDate) maxDate = parsed;
  }

  for (const item of watchlist) {
    assert.equal(deckIds.has(item.imdbID), true);
    assert.equal(seen.has(item.imdbID), false);
    seen.add(item.imdbID);
  }

  assert.ok((maxDate - minDate) / 86400000 > 365);
});

test("computeZScoredWeights on the sample is non-degenerate and isSampleItem is false for ordinary records", () => {
  const now = Date.UTC(2026, 10, 18);
  const { watched } = buildSampleVault({ now });
  const weights = computeZScoredWeights(watched, { now });
  assert.equal(weights.some((w) => w.weight > 0), true);
  assert.equal(weights.some((w) => w.weight < 0), true);

  assert.equal(isSampleItem({ imdbID: "tt0133093", title: "The Matrix" }), false);
  assert.equal(isSampleItem(null), false);
});

test("mergeSampleVault preserves overlapping real user ratings and watchlist entries so clear keeps them intact", () => {
  const realWatched = [
    { imdbID: "tt0816692", title: "Interstellar", userRating: 6, userNote: "My real note" }
  ];
  const realWatchlist = [
    { imdbID: "tt0114369", title: "Se7en" }
  ];

  const { watched, watchlist } = mergeSampleVault({
    currentWatched: realWatched,
    currentWatchlist: realWatchlist,
    now: Date.UTC(2026, 10, 18)
  });

  const interstellar = watched.find((m) => m.imdbID === "tt0816692");
  assert.equal(interstellar.userRating, 6);
  assert.equal(interstellar.userNote, "My real note");
  assert.equal(isSampleItem(interstellar), false);

  const seven = watchlist.find((m) => m.imdbID === "tt0114369");
  assert.ok(seven);
  assert.equal(isSampleItem(seven), false);

  const remainingWatchedAfterClear = watched.filter((m) => !isSampleItem(m));
  const remainingWatchlistAfterClear = watchlist.filter((m) => !isSampleItem(m));
  assert.equal(remainingWatchedAfterClear.length, 1);
  assert.equal(remainingWatchedAfterClear[0].userRating, 6);
  assert.equal(remainingWatchlistAfterClear.length, 1);
  assert.equal(remainingWatchlistAfterClear[0].imdbID, "tt0114369");
});
