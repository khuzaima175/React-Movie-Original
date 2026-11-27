import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("igdbService normalizes IGDB records with covers, screenshots, platforms, studios, and trailers", async () => {
  const { normalizeIgdbGame, buildIgdbImageUrl, extractPlatformFamilies } = await import("../src/games/services/igdbService.js");
  assert.equal(buildIgdbImageUrl("co4jni", "cover_big_2x"), "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg");
  assert.equal(buildIgdbImageUrl("", "cover_big_2x"), "");

  const raw = {
    id: 119133,
    name: "Elden Ring",
    first_release_date: 1645747200,
    total_rating: 94.6,
    total_rating_count: 2373,
    hypes: 120,
    cover: { image_id: "co4jni" },
    artworks: [{ image_id: "ar123" }],
    screenshots: [{ image_id: "sc1" }, { image_id: "sc2" }],
    videos: [{ video_id: "E3Huy2cdih0", name: "Official Launch Trailer" }],
    genres: [{ id: 12, name: "Role-playing (RPG)" }, { id: 31, name: "Adventure" }],
    themes: [{ id: 1, name: "Action" }, { id: 17, name: "Fantasy" }],
    platforms: [{ id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" }, { id: 167, name: "PlayStation 5", abbreviation: "PS5" }],
    involved_companies: [
      { company: { id: 1012, name: "FromSoftware" }, developer: true, publisher: false },
      { company: { id: 248, name: "Bandai Namco Entertainment" }, developer: false, publisher: true }
    ],
    similar_games: [7334, 11133],
    summary: "Rise, Tarnished, and be guided by grace."
  };

  const game = normalizeIgdbGame(raw);
  assert.equal(game.igdbId, 119133);
  assert.equal(game.title, "Elden Ring");
  assert.equal(game.year, 2022);
  assert.equal(game.rating10, 9.5);
  assert.match(game.coverUrl, /t_cover_big_2x\/co4jni\.jpg/);
  assert.match(game.backdropUrl, /t_1080p\/ar123\.jpg/);
  assert.equal(game.trailerKey, "E3Huy2cdih0");
  assert.deepEqual(game.developers, ["FromSoftware"]);
  assert.deepEqual(game.publishers, ["Bandai Namco Entertainment"]);
  assert.deepEqual(extractPlatformFamilies(raw.platforms), ["pc", "playstation"]);
  assert.equal(game.isExclusive, false);
});

test("gameRankerService scores warm EASE+Spectral and cold-start 128-D exclusives on REAL trained models", async () => {
  const { parseEaseBinary } = await import("../src/services/easeService.js");
  const { parseEmbeddingBinary } = await import("../src/services/embeddingService.js");
  const {
    buildWeightedGameRatings,
    buildGameRecommendationIds,
    rankGameCandidates,
    applyGameTuner,
    findSimilarGameIds
  } = await import("../src/games/services/gameRankerService.js");

  const modelsDir = path.join(process.cwd(), "public/models/games");
  const toAb = (file) => {
    const b = fs.readFileSync(path.join(modelsDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };

  const models = {
    easeIndex: parseEaseBinary(toAb("game_ease_k80.cvea")),
    collabIndex: parseEmbeddingBinary(toAb("game_embeddings_f16.bin")),
    contentIndex: parseEmbeddingBinary(toAb("game_content_f16.bin")),
    tunerAxes: JSON.parse(fs.readFileSync(path.join(modelsDir, "game_tuner_axes.json"), "utf8")),
    weights: JSON.parse(fs.readFileSync(path.join(modelsDir, "game_ranker_weights.json"), "utf8"))
  };

  const played = [
    { igdbId: 119133, title: "Elden Ring", userRating: 10, hoursPlayed: 140, status: "completed", genres: ["Role-playing (RPG)"], themes: ["Fantasy", "Action"], developers: ["FromSoftware"] },
    { igdbId: 14593, title: "Hollow Knight", userRating: 10, hoursPlayed: 55, status: "completed", genres: ["Adventure", "Indie"], themes: ["Action", "Fantasy"], developers: ["Team Cherry"] },
    { igdbId: 113112, title: "Hades", userRating: 9, hoursPlayed: 60, status: "completed", genres: ["Hack and slash/Beat 'em up", "Indie"], themes: ["Action"], developers: ["Supergiant Games"] },
    { igdbId: 7334, title: "Bloodborne", userRating: 10, hoursPlayed: 80, status: "completed", genres: ["Role-playing (RPG)"], themes: ["Action", "Horror"], developers: ["FromSoftware"] }
  ];
  const backlog = [{ igdbId: 1942, title: "The Witcher 3: Wild Hunt" }];

  const weighted = buildWeightedGameRatings(played);
  assert.equal(weighted.length, 4);
  assert.ok(weighted[0].weight > 0);

  const recIds = buildGameRecommendationIds(played, backlog, models, { warmLimit: 24, coldLimit: 12 });
  assert.ok(recIds.warmIds.length >= 15);
  assert.ok(recIds.coldIds.length >= 8);
  // None of the already played games should appear
  for (const id of recIds.allIds) {
    assert.equal(played.some((p) => p.igdbId === id), false);
  }
  // Dark Souls III (11133) or Sekiro (76882) should rank high for this FromSoftware/Hollow Knight vault
  assert.ok(recIds.warmIds.slice(0, 10).includes(11133) || recIds.warmIds.slice(0, 10).includes(76882));

  // Rank candidates including a warm Souls game and a cold 2025 game (Hades II = 228525)
  const candidates = [
    { igdbId: 11133, title: "Dark Souls III", year: 2016, rating10: 8.9, ratingCount: 1600, genres: ["Role-playing (RPG)"], themes: ["Action", "Fantasy"], developers: ["FromSoftware"], platformFamilies: ["pc", "playstation"] },
    { igdbId: 228525, title: "Hades II", year: 2025, rating10: 9.0, ratingCount: 185, genres: ["Hack and slash/Beat 'em up", "Indie"], themes: ["Action"], developers: ["Supergiant Games"], platformFamilies: ["pc"] }
  ];
  const ranked = rankGameCandidates(candidates, played, backlog, models);
  assert.equal(ranked.length, 2);
  for (const r of ranked) {
    assert.ok(r.matchScore >= 50 && r.matchScore <= 99, `matchScore out of range: ${r.matchScore}`);
    assert.ok(Array.isArray(r.matchReasons) && r.matchReasons.length >= 1);
  }

  // Tuner re-ranking works cleanly in <5ms: era=+1.0 lifts 2025 Hades II above 2016 Dark Souls III
  const tuned = applyGameTuner(ranked, { era: 1.0, familiarity: 0, pacing: 0, tone: 0, antiBubble: false }, { contentIndex: models.contentIndex, tunerAxes: models.tunerAxes, played });
  assert.equal(tuned.length, 2);
  const tunedH2 = tuned.find((g) => g.igdbId === 228525);
  const tunedDs3 = tuned.find((g) => g.igdbId === 11133);
  assert.ok(tunedH2.tunerDelta > tunedDs3.tunerDelta, "era=+1.0 should apply higher boost to 2025 Hades II than 2016 Dark Souls III");
  assert.equal(tuned[0].igdbId, 228525, "calibrated cold-start + era=+1.0 should lift 2025 Hades II to #1");

  // Hybrid similar games works on BOTH warm (Elden Ring) and 100%-cold exclusive (Bloodborne)
  const simCold = findSimilarGameIds(7334, models, { limit: 6 });
  assert.equal(simCold.length, 6);
  assert.equal(simCold.includes(7334), false);
});

test("gameVaultStorage imports JSON, CSV, and Steam AppID lists mapped via game_steam_to_igdb.json", async () => {
  const { parseGameImport, buildGameExportPayload } = await import("../src/games/services/gameVaultStorage.js");
  const steamMap = { "292030": 1942, "1245620": 119133, "2379780": 251833 };

  // Steam AppID list import
  const steamImport = parseGameImport("292030, 1245620\n2379780", { steamMap });
  assert.deepEqual(steamImport.resolvedIgdbIds, [1942, 119133, 251833]);

  // JSON round-trip export -> import
  const exported = buildGameExportPayload({
    played: [{ igdbId: 119133, title: "Elden Ring", userRating: 10, hoursPlayed: 120, status: "completed" }],
    backlog: [{ igdbId: 7334, title: "Bloodborne" }]
  });
  const parsed = parseGameImport(JSON.stringify(exported), { steamMap });
  assert.equal(parsed.played.length, 1);
  assert.equal(parsed.played[0].igdbId, 119133);
  assert.equal(parsed.backlog.length, 1);
});

test("gameOracleService builds offline math picks deterministically and locks matchScores on Gemini merge", async () => {
  const { curateGamesWithOracle, STARTER_CALIBRATION_GAMES } = await import("../src/games/services/gameOracleService.js");
  assert.ok(STARTER_CALIBRATION_GAMES.length >= 12);

  const candidates = [
    { igdbId: 11133, title: "Dark Souls III", year: 2016, matchScore: 95, matchReasons: ["Strong Taste Match"], genres: ["RPG"], platforms: ["PC", "PS4"], summary: "Dark fantasy action RPG." },
    { igdbId: 228525, title: "Hades II", year: 2025, matchScore: 91, matchReasons: ["2024–2026 Cold-Start Match"], genres: ["Action", "Indie"], platforms: ["PC"], summary: "Mythic roguelike sequel." }
  ];
  const played = [{ igdbId: 119133, title: "Elden Ring", userRating: 10 }];

  // Offline fallback (no Gemini backend)
  const offline = await curateGamesWithOracle({
    played,
    candidates,
    vibe: "dark atmospheric challenge",
    platformFamily: "all",
    useGemini: false
  });
  assert.equal(offline.source, "local-ml");
  assert.equal(offline.picks.length, 2);
  assert.equal(offline.picks[0].matchScore, 95);

  // Mock Gemini response cannot override locked mathematical matchScore
  const withAi = await curateGamesWithOracle({
    played,
    candidates,
    vibe: "dark atmospheric challenge",
    useGemini: true,
    geminiCaller: async () => JSON.stringify({
      picks: [
        { igdbId: 228525, matchScore: 99, anchorTitles: ["Elden Ring"], pitch: "Fast mythic action built on tight combat loops." }
      ]
    })
  });
  assert.equal(withAi.source, "gemini");
  const h2 = withAi.picks.find((p) => p.igdbId === 228525);
  assert.equal(h2.matchScore, 91, "must keep locked mathematical matchScore, never Gemini hallucinated 99");
  assert.deepEqual(h2.anchorTitles, ["Elden Ring"]);
});

test("gameSyncService maps local games <-> Supabase user_games rows and merges cloud state cleanly", async () => {
  const { mapLocalGameToDbRow, mapDbRowToLocalGame, mergeGameListsByUpdatedAt } = await import("../src/games/services/gameSyncService.js");
  const local = {
    igdbId: 119133,
    title: "Elden Ring",
    year: 2022,
    coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg",
    userRating: 10,
    hoursPlayed: 145.5,
    status: "completed",
    userNote: "Masterpiece",
    updatedAt: "2026-11-27T10:00:00.000Z"
  };

  const row = mapLocalGameToDbRow("user-uuid-1", local, "played");
  assert.equal(row.user_id, "user-uuid-1");
  assert.equal(row.igdb_id, 119133);
  assert.equal(row.status, "completed");
  assert.equal(row.user_rating, 10);
  assert.equal(row.hours_played, 145.5);

  const restored = mapDbRowToLocalGame(row);
  assert.equal(restored.igdbId, 119133);
  assert.equal(restored.userRating, 10);
  assert.equal(restored.hoursPlayed, 145.5);

  const merged = mergeGameListsByUpdatedAt(
    [{ igdbId: 119133, title: "Elden Ring", userRating: 9, updatedAt: "2026-11-26T00:00:00Z" }],
    [{ igdbId: 119133, title: "Elden Ring", userRating: 10, updatedAt: "2026-11-27T00:00:00Z" }, { igdbId: 7334, title: "Bloodborne", userRating: 10, updatedAt: "2026-11-27T00:00:00Z" }]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((g) => g.igdbId === 119133).userRating, 10);
});
