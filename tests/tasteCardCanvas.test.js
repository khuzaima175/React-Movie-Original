import test from "node:test";
import assert from "node:assert/strict";
import { TASTE_CARD_ASPECTS, buildTasteCardData } from "../src/services/tasteCardCanvas.js";

test("buildTasteCardData computes Top 4 posters, screen time hours, avg rating, and handle", () => {
  const watched = [
    {
      title: "Arrival",
      year: "2016",
      genre: "Sci-Fi, Drama",
      runtime: "116 min",
      userRating: 10,
      poster: "https://x/1.jpg",
      dateWatched: "2026-05-01"
    },
    {
      title: "Heat",
      year: "1995",
      genre: "Crime, Drama",
      runtime: "170 min",
      userRating: 9,
      poster: "https://x/2.jpg",
      dateWatched: "2026-06-01"
    }
  ];
  const data = buildTasteCardData({ watched, profile: { username: "khuzaima" }, year: 2026 });
  assert.equal(TASTE_CARD_ASPECTS.story.width, 1080);
  assert.equal(TASTE_CARD_ASPECTS.story.height, 1920);
  assert.equal(TASTE_CARD_ASPECTS.wide.width, 1200);
  assert.equal(TASTE_CARD_ASPECTS.wide.height, 630);
  assert.equal(data.handle, "@khuzaima");
  assert.equal(data.filmCount, 2);
  assert.equal(data.topFilms.length, 2);
  assert.equal(data.topGenre, "Drama");
  assert.ok(data.hoursWatched >= 4);
  assert.equal(data.avgRating, 9.5);
});
