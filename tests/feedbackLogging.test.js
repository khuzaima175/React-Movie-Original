import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFeedbackEvent, recordRatedMovieConversion } from "../src/services/feedbackService.js";

test("normalizeFeedbackEvent preserves tmdbId, matchScoreAtTime, and upgrades watchlist_add to rated when user rates the film", () => {
  let log = [];
  log = normalizeFeedbackEvent(
    { title: "Drive", year: "2011", tmdbId: 64690, action: "added_watchlist", matchScoreAtTime: 93, sourceBucket: "CollabNN" },
    log
  );
  assert.equal(log.length, 1);
  assert.equal(log[0].tmdbId, 64690);
  assert.equal(log[0].matchScoreAtTime, 93);

  log = normalizeFeedbackEvent(
    { title: "Drive", year: "2011", tmdbId: 64690, action: "rated", userRating: 9 },
    log
  );
  assert.equal(log.length, 1, "updates existing movie entry or links conversion");
  assert.equal(log[0].action, "rated");
  assert.equal(log[0].userRating, 9);
  assert.equal(log[0].previousAction, "added_watchlist");
  assert.equal(log[0].matchScoreAtTime, 93, "retains original matchScoreAtTime for calibration training");
});

test("recordRatedMovieConversion logs rated conversion when movie matches aiRecommendations directly", () => {
  const recs = [
    { title: "Prisoners", year: "2013", tmdbId: 146233, matchScore: 94, sourceBucket: "Bucket A: Semantic" }
  ];
  const updatedLog = recordRatedMovieConversion(
    { title: "Prisoners", year: "2013", tmdbId: 146233, userRating: 9 },
    [],
    recs
  );
  assert.equal(updatedLog.length, 1);
  assert.equal(updatedLog[0].action, "rated");
  assert.equal(updatedLog[0].userRating, 9);
  assert.equal(updatedLog[0].matchScoreAtTime, 94);
  assert.equal(updatedLog[0].sourceBucket, "Bucket A: Semantic");
});

test("normalizeFeedbackEvent preserves sanitized feature snapshot for online weight learning", () => {
  const updated = normalizeFeedbackEvent(
    {
      title: "Dune",
      year: "2021",
      tmdbId: 438631,
      action: "dismissed",
      matchScoreAtTime: 91,
      features: { collabSim: 0.7, crewMatch: 1, keywordOverlap: 0.4, unknownField: 999 }
    },
    []
  );
  assert.equal(updated[0].features.collabSim, 0.7);
  assert.equal(updated[0].features.crewMatch, 1);
  assert.equal(updated[0].features.unknownField, undefined);
});

