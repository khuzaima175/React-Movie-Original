import test from "node:test";
import assert from "node:assert/strict";
import {
  YEARLY_GOAL_STORAGE_KEY,
  normalizeWatchHistory,
  appendWatchHistoryEntry,
  buildMonthlyDiaryGroups,
  computeYearlyDiaryStats
} from "../src/services/diaryService.js";

test("normalizeWatchHistory derives backward-compatible entry from legacy dateWatched without duplicating", () => {
  assert.equal(YEARLY_GOAL_STORAGE_KEY, "cinemavault_yearly_goal_v1");
  const legacy = { title: "Heat", userRating: 9, dateWatched: "2026-03-14T12:00:00.000Z" };
  const entries = normalizeWatchHistory(legacy);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].watchedAt.slice(0, 10), "2026-03-14");
  assert.equal(entries[0].isRewatch, false);
});

test("appendWatchHistoryEntry logs rewatches, updates watchMeta.rewatchCount, and groups chronologically by month", () => {
  const base = {
    title: "Arrival",
    runtime: "116 min",
    genre: "Sci-Fi, Drama",
    userRating: 9,
    dateWatched: "2026-02-01T12:00:00.000Z"
  };
  const updated = appendWatchHistoryEntry(base, {
    date: "2026-11-10",
    format: "imax",
    rating: 10,
    note: "Even better on re-watch",
    isRewatch: true
  });
  assert.equal(updated.watchHistory.length, 2);
  assert.equal(updated.watchMeta.rewatchCount, 1);
  assert.equal(updated.userRating, 10);

  const groups = buildMonthlyDiaryGroups([updated], { year: 2026 });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].monthKey, "2026-11");

  const stats = computeYearlyDiaryStats([updated], 2026);
  assert.equal(stats.count, 2);
  assert.equal(stats.rewatchCount, 1);
  assert.equal(stats.totalMinutes, 232);
});
