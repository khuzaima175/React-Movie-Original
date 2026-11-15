import test from "node:test";
import assert from "node:assert/strict";
import { formatTmdbMovieDetails } from "../src/services/tmdbService.js";

test("formatTmdbMovieDetails preserves structured directorDetails, writerDetails, cinematographerDetails, and composerDetails IDs", () => {
  const rawTmdbMovie = {
    id: 205596,
    title: "The Imitation Game",
    release_date: "2014-11-14",
    runtime: 114,
    genres: [{ id: 18, name: "Drama" }, { id: 36, name: "History" }],
    credits: {
      cast: [
        { id: 71580, name: "Benedict Cumberbatch", character: "Alan Turing", profile_path: "/abc.jpg" },
        { id: 116, name: "Keira Knightley", character: "Joan Clarke", profile_path: "/def.jpg" }
      ],
      crew: [
        { id: 57633, name: "Morten Tyldum", job: "Director", department: "Directing" },
        { id: 57634, name: "Second Director", job: "Director", department: "Directing" },
        { id: 1384805, name: "Graham Moore", job: "Screenplay", department: "Writing" },
        { id: 1384805, name: "Graham Moore", job: "Story", department: "Writing" },
        { id: 6001, name: "Andrew Hodges", job: "Story", department: "Writing" },
        { id: 59553, name: "Óscar Faura", job: "Director of Photography", department: "Camera" },
        { id: 2949, name: "Alexandre Desplat", job: "Original Music Composer", department: "Sound" }
      ]
    }
  };

  const formatted = formatTmdbMovieDetails(rawTmdbMovie, "US");
  assert.equal(formatted.director, "Morten Tyldum");
  assert.equal(formatted.crewPersonId, 57633);
  assert.equal(formatted.writers, "Graham Moore, Graham Moore, Andrew Hodges");
  assert.equal(formatted.cinematographer, "Óscar Faura");
  assert.equal(formatted.composer, "Alexandre Desplat");

  assert.deepEqual(formatted.directorDetails, [
    { id: 57633, name: "Morten Tyldum", job: "Director", department: "Directing" },
    { id: 57634, name: "Second Director", job: "Director", department: "Directing" }
  ]);
  assert.deepEqual(formatted.writerDetails, [
    { id: 1384805, name: "Graham Moore", job: "Screenplay", department: "Writing" },
    { id: 6001, name: "Andrew Hodges", job: "Story", department: "Writing" }
  ]);
  assert.deepEqual(formatted.cinematographerDetails, [
    { id: 59553, name: "Óscar Faura", job: "Director of Photography", department: "Camera" }
  ]);
  assert.deepEqual(formatted.composerDetails, [
    { id: 2949, name: "Alexandre Desplat", job: "Original Music Composer", department: "Sound" }
  ]);
});
