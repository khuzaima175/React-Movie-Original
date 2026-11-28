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

test("gameRankerService penalizes low-acclaim flops (e.g. Gollum 4.3), deduplicates sibling editions, and calibrates Est. rating", async () => {
  const {
    rankGameCandidates,
    normalizeGameBaseTitle,
    filterDuplicateGameEditions,
    predictGameRating,
    rankBacklogForNextPlay
  } = await import("../src/games/services/gameRankerService.js");

  // Edition normalization & deduplication
  assert.equal(
    normalizeGameBaseTitle("Divinity: Original Sin II - Definitive Edition"),
    normalizeGameBaseTitle("Divinity: Original Sin II")
  );
  assert.equal(
    normalizeGameBaseTitle("The Elder Scrolls V: Skyrim - Anniversary Edition"),
    normalizeGameBaseTitle("The Elder Scrolls V: Skyrim")
  );

  const played = [
    { igdbId: 1942, title: "The Witcher 3: Wild Hunt", userRating: 10, genres: ["Role-playing (RPG)", "Adventure"], themes: ["Fantasy"], developers: ["CD Projekt RED"] },
    { igdbId: 20001, title: "Divinity: Original Sin II", userRating: 10, genres: ["Role-playing (RPG)", "Strategy"], themes: ["Fantasy"], developers: ["Larian Studios"] },
    { igdbId: 119171, title: "Baldur's Gate III", userRating: 9, genres: ["Role-playing (RPG)"], themes: ["Fantasy"], developers: ["Larian Studios"] }
  ];

  const deduped = filterDuplicateGameEditions(
    [
      { igdbId: 99901, title: "Divinity: Original Sin II - Definitive Edition", ratingCount: 500 },
      { igdbId: 11133, title: "Dark Souls III", ratingCount: 1600 },
      { igdbId: 11134, title: "Dark Souls III: The Fire Fades Edition", ratingCount: 120 }
    ],
    played
  );
  assert.deepEqual(deduped.map((g) => g.igdbId), [11133]);

  // Low-acclaim flop penalty: Gollum (4.3/10) must NOT score high even with matching Adventure/Fantasy metadata
  const mockContentIndex = {
    count: 2,
    dim: 2,
    ids: new Uint32Array([1942, 777777]),
    idToIndex: new Map([[1942, 0], [777777, 1]]),
    vectors: new Float32Array([1, 0, 0.72, 0.69]) // high cosine similarity for flop 777777
  };
  const ranked = rankGameCandidates(
    [
      { igdbId: 777777, title: "The Lord of the Rings: Gollum", year: 2023, rating10: 4.3, ratingCount: 140, genres: ["Adventure"], themes: ["Fantasy"] },
      { igdbId: 888888, title: "Acclaimed Fantasy RPG", year: 2023, rating10: 9.0, ratingCount: 400, genres: ["Role-playing (RPG)", "Adventure"], themes: ["Fantasy"] },
      { igdbId: 999999, title: "Unreleased Future Fantasy", year: new Date().getUTCFullYear() + 2, rating10: 0, ratingCount: 0, genres: ["Role-playing (RPG)", "Adventure"], themes: ["Fantasy"] }
    ],
    played,
    [],
    { contentIndex: mockContentIndex }
  );
  const gollum = ranked.find((g) => g.igdbId === 777777);
  const good = ranked.find((g) => g.igdbId === 888888);
  const unreleased = ranked.find((g) => g.igdbId === 999999);
  assert.ok(gollum.matchScore <= 68, `Expected Gollum (4.3/10 flop) <= 68% match, got ${gollum.matchScore}%`);
  assert.ok(good.matchScore > gollum.matchScore + 15, `Expected acclaimed RPG (${good.matchScore}%) well above flop (${gollum.matchScore}%)`);
  assert.ok(good.matchScore > unreleased.matchScore + 12, `Expected released RPG (${good.matchScore}%) well above unreleased future 0-vote game (${unreleased.matchScore}%)`);

  // Calibration spread for high raters (~9.2 avg): 60% Est should be well below 95% Est
  const highVault = [10, 10, 10, 10, 9, 9, 9, 9, 9, 8, 8, 8].map((r) => ({ userRating: r }));
  const estLow = predictGameRating(60, highVault);
  const estHigh = predictGameRating(95, highVault);
  assert.ok(estHigh - estLow >= 2.0, `Expected meaningful Est. rating spread (>=2.0), got ${estLow}..${estHigh}`);

  // Backlog Play Next ranker
  const backlogRanked = rankBacklogForNextPlay(
    [
      { igdbId: 888888, title: "Acclaimed Fantasy RPG", year: 2023, rating10: 9.0, ratingCount: 400, genres: ["Role-playing (RPG)"], themes: ["Fantasy"] },
      { igdbId: 777777, title: "Gollum", year: 2023, rating10: 4.3, ratingCount: 140, genres: ["Adventure"] }
    ],
    played,
    { contentIndex: mockContentIndex }
  );
  assert.equal(backlogRanked[0].igdbId, 888888);
});

test("gameRankerService v1.3: edition aliases, dismissal repulsion, franchise diversity cap, vault anchors & neural Oracle mood steering", async () => {
  const { parseEaseBinary } = await import("../src/services/easeService.js");
  const { parseEmbeddingBinary } = await import("../src/services/embeddingService.js");
  const {
    resolveWarmGameId,
    applyFranchiseDiversityCap,
    extractGameFranchiseKey,
    findTopVaultAnchorsForGame,
    findSimilarGameIds,
    rankGameCandidates,
    applyGameTuner
  } = await import("../src/games/services/gameRankerService.js");
  const { GAME_ORACLE_MOODS } = await import("../src/games/services/gameOracleService.js");

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
    weights: JSON.parse(fs.readFileSync(path.join(modelsDir, "game_ranker_weights.json"), "utf8")),
    editionAliases: JSON.parse(fs.readFileSync(path.join(modelsDir, "game_edition_aliases.json"), "utf8"))
  };

  // 1. Edition Alias Resolution maps split originals/definitive editions to warm graph IDs
  assert.equal(resolveWarmGameId(472, models.editionAliases), 19457);
  assert.equal(resolveWarmGameId(2155, models.editionAliases), 81085);
  assert.equal(resolveWarmGameId(19564, models.editionAliases), 152063);
  assert.equal(resolveWarmGameId(103337, models.editionAliases), 11800);

  // Ranking a cold split edition (Divinity OS2 Definitive = 103337) resolves to warm collab neighbors
  const playedSouls = [
    { igdbId: 1942, title: "The Witcher 3: Wild Hunt", userRating: 10, genres: ["Role-playing (RPG)"] },
    { igdbId: 119171, title: "Baldur's Gate III", userRating: 10, genres: ["Role-playing (RPG)"] },
    { igdbId: 472, title: "The Elder Scrolls V: Skyrim", userRating: 9, genres: ["Role-playing (RPG)"] }
  ];
  const dosRanked = rankGameCandidates(
    [{ igdbId: 103337, title: "Divinity: Original Sin II - Definitive Edition", year: 2018, rating10: 9.3, ratingCount: 159, genres: ["Role-playing (RPG)"] }],
    playedSouls,
    [],
    models
  );
  assert.ok(dosRanked[0].collabSim > 0, "Expected aliased Divinity OS2 Definitive to receive warm collabSim");
  assert.equal(dosRanked[0].isColdStart, false);

  // findSimilarGameIds uses edition alias EASE neighbors cleanly
  const skyrimSims = findSimilarGameIds(472, models, { limit: 6 });
  assert.equal(skyrimSims.length, 6);
  assert.equal(skyrimSims.includes(472) || skyrimSims.includes(19457), false);

  // 2. Dismissal repulsion lowers candidate logit when closely related games are dismissed
  const cand = [{ igdbId: 11133, title: "Dark Souls III", year: 2016, rating10: 8.7, ratingCount: 2027, genres: ["Role-playing (RPG)"] }];
  const baselineLogit = rankGameCandidates(cand, playedSouls, [], models)[0].rankerLogit;
  const afterDismissLogit = rankGameCandidates(cand, playedSouls, [], models, null, {
    dismissedIds: new Set([119133, 76882, 81085, 2368])
  })[0].rankerLogit;
  assert.ok(afterDismissLogit < baselineLogit, `Expected dismissal repulsion to reduce logit (${afterDismissLogit} < ${baselineLogit})`);

  // 3. Vault Anchor attribution finds real driving games ("Because you loved ...")
  const ds3Anchors = findTopVaultAnchorsForGame(11133, [
    { igdbId: 119133, title: "Elden Ring", userRating: 10 },
    { igdbId: 17000, title: "Stardew Valley", userRating: 9 }
  ], models, 1);
  assert.deepEqual(ds3Anchors, ["Elden Ring"]);

  // 4. Soft franchise diversity cap limits same-series crowding without dropping items
  const capped = applyFranchiseDiversityCap([
    { igdbId: 1, title: "Assassin's Creed Odyssey" },
    { igdbId: 2, title: "Assassin's Creed Shadows" },
    { igdbId: 3, title: "Assassin's Creed Mirage" },
    { igdbId: 4, title: "Dark Souls III" },
    { igdbId: 5, title: "The Witcher 3: Wild Hunt" }
  ], { maxPerFranchise: 1, headWindow: 3 });
  assert.equal(capped.length, 5);
  assert.equal(extractGameFranchiseKey("Assassin's Creed Mirage"), "assassin s creed");
  assert.equal(capped.slice(0, 3).filter((g) => extractGameFranchiseKey(g.title) === "assassin s creed").length, 1);

  // 5. Neural Oracle Mood tunerBias lifts Cozy games over intense Souls under "cozy"
  const cozyMood = GAME_ORACLE_MOODS.find((m) => m.id === "cozy");
  assert.ok(cozyMood?.tunerBias, "cozy mood should include neural tunerBias");
  const mixed = [
    { igdbId: 11133, title: "Dark Souls III", year: 2016, rating10: 8.7, ratingCount: 2027, matchScore: 90, rankerLogit: 1.5, genres: ["Role-playing (RPG)"] },
    { igdbId: 17000, title: "Stardew Valley", year: 2016, rating10: 8.9, ratingCount: 1400, matchScore: 90, rankerLogit: 1.5, genres: ["Simulator", "Indie"] }
  ];
  const cozySteered = applyGameTuner(mixed, cozyMood.tunerBias, {
    contentIndex: models.contentIndex,
    tunerAxes: models.tunerAxes,
    editionAliases: models.editionAliases,
    played: playedSouls
  });
  assert.equal(cozySteered[0].igdbId, 17000, "Cozy mood neural bias should lift Stardew Valley above Dark Souls III");
});

test("gameVaultStorage computes vault stats, calibration anchors, and preserves game craft breakdown + tags", async () => {
  const {
    compactGameRecord,
    computeGameVaultStats,
    computeGameVaultCalibration
  } = await import("../src/games/services/gameVaultStorage.js");

  const rec = compactGameRecord({
    igdbId: 119133,
    title: "Elden Ring",
    userRating: 10,
    hoursPlayed: 140,
    status: "platinum",
    ratingBreakdown: { gameplay: 5, story: 4, visuals: 5, audio: 5, replayability: 5 },
    quickTags: ["#PeakBossFights", "#Masterpiece"]
  });
  assert.equal(rec.status, "platinum");
  assert.equal(rec.ratingBreakdown.gameplay, 5);
  assert.deepEqual(rec.quickTags, ["#PeakBossFights", "#Masterpiece"]);

  const played = [
    rec,
    compactGameRecord({ igdbId: 1942, title: "The Witcher 3", userRating: 10, hoursPlayed: 95, status: "completed", genres: ["RPG"], platformPlayed: "PC" }),
    compactGameRecord({ igdbId: 14593, title: "Hollow Knight", userRating: 9, hoursPlayed: 45, status: "completed", genres: ["Metroidvania", "Indie"], platformPlayed: "PC" }),
    compactGameRecord({ igdbId: 7334, title: "Bloodborne", userRating: 8, hoursPlayed: 60, status: "playing", genres: ["RPG"], platformPlayed: "PS4" })
  ];

  const stats = computeGameVaultStats(played, [{ igdbId: 11133, title: "Dark Souls III" }]);
  assert.equal(stats.totalLogged, 4);
  assert.equal(stats.totalHours, 340);
  assert.equal(stats.platinumCount, 1);
  assert.equal(stats.completedCount, 3); // completed + platinum
  assert.equal(stats.histogram[10], 2);
  assert.equal(stats.histogram[9], 1);

  const cal = computeGameVaultCalibration(played, 10, 119133);
  assert.equal(cal.ratedCount, 3);
  assert.equal(cal.anchorMovies.length, 1);
  assert.equal(cal.anchorMovies[0].title, "The Witcher 3");
});

test("gameRigService classifies GPUs (GTX 750 Ti -> entry, RTX 4080 -> high) and filters heavy modern AAAs for entry PCs", async () => {
  const {
    classifyGpuRenderer,
    estimateGameSpecTier,
    isGameCompatibleWithRig,
    getDefaultPlatformFocus
  } = await import("../src/games/services/gameRigService.js");

  assert.equal(classifyGpuRenderer("ANGLE (NVIDIA, NVIDIA GeForce GTX 750 Ti Direct3D11)"), "entry");
  assert.equal(classifyGpuRenderer("Intel(R) UHD Graphics 630"), "entry");
  assert.equal(classifyGpuRenderer("NVIDIA GeForce RTX 3060"), "mid");
  assert.equal(classifyGpuRenderer("NVIDIA GeForce RTX 4080"), "high");

  const entryPcRig = { completed: true, platforms: ["pc"], pcSpecTier: "entry", respectRigLimits: true };
  assert.equal(getDefaultPlatformFocus(entryPcRig), "pc");

  const heavy2025 = { title: "Kingdom Come: Deliverance II", year: 2025, genres: ["Role-playing (RPG)", "Simulator"] };
  const indie2024 = { title: "Balatro", year: 2024, genres: ["Card & Board Game", "Indie"] };
  const classic2013 = { title: "Grand Theft Auto V", year: 2013, genres: ["Shooter", "Adventure"] };

  assert.equal(estimateGameSpecTier(heavy2025), "high");
  assert.equal(estimateGameSpecTier(indie2024), "entry");
  assert.equal(estimateGameSpecTier(classic2013), "entry");

  assert.equal(isGameCompatibleWithRig(heavy2025, entryPcRig).compatible, false);
  assert.equal(isGameCompatibleWithRig(indie2024, entryPcRig).compatible, true);
  assert.equal(isGameCompatibleWithRig(classic2013, entryPcRig).compatible, true);
});

test("gameRankerService v1.4: CVGM sidecar pre-filtering, Lowdin orthogonalization, LogSumExp multi-persona cold bridge, short-game playBoost & pointLookup", async () => {
  const { parseEaseBinary } = await import("../src/services/easeService.js");
  const { parseEmbeddingBinary } = await import("../src/services/embeddingService.js");
  const {
    parseGameCatalogMetaBinary,
    orthogonalizeTunerAxes
  } = await import("../src/games/services/gameModelService.js");
  const {
    buildWeightedGameRatings,
    buildGameRecommendationIds,
    matchesCatalogMetaFilter,
    rankGameCandidates,
    applyGameTuner
  } = await import("../src/games/services/gameRankerService.js");

  const modelsDir = path.join(process.cwd(), "public/models/games");
  const toAb = (file) => {
    const b = fs.readFileSync(path.join(modelsDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  const catalogMeta = parseGameCatalogMetaBinary(toAb("game_catalog_meta.bin"));
  assert.ok(catalogMeta, "game_catalog_meta.bin should parse cleanly");
  assert.equal(catalogMeta.count, 24439);

  const rawAxes = JSON.parse(fs.readFileSync(path.join(modelsDir, "game_tuner_axes.json"), "utf8"));
  const orthAxes = orthogonalizeTunerAxes(rawAxes);
  let dotUV = 0;
  let normU = 0;
  let normV = 0;
  for (let i = 0; i < orthAxes.intensityVec.length; i++) {
    dotUV += orthAxes.intensityVec[i] * orthAxes.toneVec[i];
    normU += orthAxes.intensityVec[i] ** 2;
    normV += orthAxes.toneVec[i] ** 2;
  }
  assert.ok(Math.abs(dotUV) < 1e-4, `Expected Lowdin orthogonalized axes |cos| < 1e-4, got ${dotUV}`);
  assert.ok(Math.abs(Math.sqrt(normU) - 1) < 1e-4 && Math.abs(Math.sqrt(normV) - 1) < 1e-4);

  const models = {
    easeIndex: parseEaseBinary(toAb("game_ease_k80.cvea")),
    collabIndex: parseEmbeddingBinary(toAb("game_embeddings_f16.bin")),
    contentIndex: parseEmbeddingBinary(toAb("game_content_f16.bin")),
    catalogMeta,
    tunerAxes: orthAxes,
    weights: JSON.parse(fs.readFileSync(path.join(modelsDir, "game_ranker_weights.json"), "utf8")),
    editionAliases: JSON.parse(fs.readFileSync(path.join(modelsDir, "game_edition_aliases.json"), "utf8"))
  };

  // 1. Dynamic releaseDay check (Trap B): a synthetic record released on day 9600 fails when todayDay=9500, passes when todayDay=9700
  const syntheticMeta = {
    idToIndex: new Map([[424242, 0]]),
    releaseDay: new Int16Array([9600]),
    ratingByte: new Uint8Array([85]),
    voteTier: new Uint8Array([0]),
    platformMask: new Uint8Array([1]),
    specAndFlags: new Uint8Array([1]),
    genreMask: new Uint16Array([1])
  };
  assert.equal(matchesCatalogMetaFilter(424242, syntheticMeta, { todayDay: 9500 }), false);
  assert.equal(matchesCatalogMetaFilter(424242, syntheticMeta, { todayDay: 9700 }), true);

  // 2. Pure console player (Bloodborne + Zelda BOTW -> zero warm Steam EASE items) auto-expands coldLimit to full pool!
  const pureConsoleVault = [
    { igdbId: 7334, title: "Bloodborne", userRating: 10, status: "completed", genres: ["Role-playing (RPG)"] },
    { igdbId: 7346, title: "The Legend of Zelda: Breath of the Wild", userRating: 10, status: "completed", genres: ["Adventure"] }
  ];
  const consoleRecs = buildGameRecommendationIds(pureConsoleVault, [], models, {
    warmLimit: 40,
    coldLimit: 18,
    platformFamily: "nintendo"
  });
  assert.ok(consoleRecs.coldIds.length >= 40, `Expected pure-console player cold pool auto-expanded >= 40, got ${consoleRecs.coldIds.length}`);
  for (const cid of consoleRecs.coldIds.slice(0, 15)) {
    const idx = catalogMeta.idToIndex.get(cid);
    assert.ok(idx !== undefined && (catalogMeta.platformMask[idx] & (1 << 5)) !== 0, `Expected Nintendo platform bit on pre-filtered id ${cid}`);
  }

  // 3. Short completed masterpiece playBoost fix (6h completed >= 0h completed, never penalized below 1.0!)
  const shortCompleted = buildWeightedGameRatings([
    { igdbId: 72, title: "Portal 2", userRating: 10, hoursPlayed: 6, status: "completed" },
    { igdbId: 71, title: "Portal", userRating: 10, hoursPlayed: 0, status: "completed" }
  ]);
  assert.ok(shortCompleted[0].weight >= shortCompleted[1].weight, "6h completed masterpiece must not weigh less than 0h completed");

  // 4. Same-year future releaseDate & TBA unreleased guard
  const tomorrow = new Date(Date.now() + 86_400_000 * 3).toISOString().slice(0, 10);
  const relRanked = rankGameCandidates(
    [
      { igdbId: 900001, title: "Released RPG", year: 2024, releaseDate: "2024-06-01", rating10: 8.5, ratingCount: 10, genres: ["Role-playing (RPG)"] },
      { igdbId: 900002, title: "Same-Year Future RPG", year: Number(tomorrow.slice(0, 4)), releaseDate: tomorrow, rating10: 0, ratingCount: 0, genres: ["Role-playing (RPG)"] },
      { igdbId: 900003, title: "TBA Vaporware RPG", year: null, releaseDate: "", rating10: 0, ratingCount: 0, genres: ["Role-playing (RPG)"] }
    ],
    pureConsoleVault,
    [],
    models
  );
  assert.equal(relRanked[0].igdbId, 900001);
  assert.ok(relRanked[0].rankerLogit > relRanked[1].rankerLogit + 1.5);
  assert.ok(relRanked[0].rankerLogit > relRanked[2].rankerLogit + 1.5);

  // 5. Age-normalized Familiarity slider: 2010 200-vote classic gets higher Hidden Gem delta than 2026 200-vote release
  const famTuned = applyGameTuner(
    [
      { igdbId: 1, title: "2026 New Launch", year: 2026, ratingCount: 200, rankerLogit: 1.5 },
      { igdbId: 2, title: "2010 Classic Gem", year: 2010, ratingCount: 200, rankerLogit: 1.5 }
    ],
    { era: 0, familiarity: 1.0, pacing: 0, tone: 0, antiBubble: false },
    {}
  );
  assert.equal(famTuned[0].igdbId, 2, "Age-normalized Familiarity should lift 2010 200-vote gem over 2026 200-vote launch");
});

test("gameSyncService v1.4: keyset pagination (>1,000 rows), strict page-error abort & delete tombstones prevent resurrection", async () => {
  const { pullAndSyncGameVault } = await import("../src/games/services/gameSyncService.js");

  // 1. Keyset pagination across 2 pages (1,000 + 250 = 1,250 cloud rows) + tombstone deletes 1 cloud row
  const allCloudRows = Array.from({ length: 1250 }, (_, i) => ({
    id: i + 1,
    user_id: "u1",
    igdb_id: 10000 + i,
    status: "completed",
    title: `Game ${i}`,
    user_rating: 8,
    hours_played: 10,
    updated_at: "2026-11-20T00:00:00.000Z",
    metadata: {}
  }));
  const deletedCloudIds = [];
  const upsertedChunks = [];

  const mockSupabase = {
    from() {
      return {
        select() {
          let afterId = 0;
          let lim = 1000;
          const chain = {
            eq() { return chain; },
            order() { return chain; },
            gt(_col, val) { afterId = val; return chain; },
            limit(n) { lim = n; return chain; },
            then(resolve) {
              const page = allCloudRows.filter((r) => r.id > afterId).slice(0, lim);
              resolve({ data: page, error: null });
            }
          };
          return chain;
        },
        delete() {
          let targetId = 0;
          const chain = {
            eq(col, val) { if (col === "igdb_id") targetId = val; return chain; },
            then(resolve) { deletedCloudIds.push(targetId); resolve({ error: null }); }
          };
          return chain;
        },
        async upsert(rows) {
          upsertedChunks.push(rows.length);
          return { error: null };
        }
      };
    }
  };

  const res = await pullAndSyncGameVault(mockSupabase, "u1", {
    played: [],
    backlog: [],
    deletedTombstones: { "10005": "2026-11-25T00:00:00.000Z" }
  });
  assert.equal(res.status, "synced");
  assert.equal(res.played.length, 1249, "1,250 cloud rows minus 1 tombstoned game = 1,249");
  assert.equal(res.played.some((g) => g.igdbId === 10005), false, "tombstoned game must NOT resurrect");
  assert.deepEqual(deletedCloudIds, [10005]);
  assert.ok(upsertedChunks.every((n) => n <= 250), "upserts must be chunked <= 250 rows");

  // 2. Mid-pagination error MUST abort cleanly without merging truncated page 1
  const failingSupabase = {
    from() {
      return {
        select() {
          let afterId = 0;
          const chain = {
            eq() { return chain; },
            order() { return chain; },
            gt(_col, val) { afterId = val; return chain; },
            limit() { return chain; },
            then(resolve) {
              if (afterId === 0) resolve({ data: allCloudRows.slice(0, 1000), error: null });
              else resolve({ data: null, error: { message: "network drop on page 2" } });
            }
          };
          return chain;
        }
      };
    }
  };
  const localOriginal = [{ igdbId: 7334, title: "Bloodborne", userRating: 10 }];
  const failedRes = await pullAndSyncGameVault(failingSupabase, "u1", { played: localOriginal, backlog: [] });
  assert.equal(failedRes.status, "error");
  assert.equal(failedRes.played.length, 1, "aborted sync must return untouched local vault");
});

test("gameRankerService v1.5: CVGM v2 typicalHours relative playtime, recency tilt, 5-aspect craft DNA & quick tags", async () => {
  const { parseGameCatalogMetaBinary } = await import("../src/games/services/gameModelService.js");
  const { parseEmbeddingBinary } = await import("../src/services/embeddingService.js");
  const {
    buildWeightedGameRatings,
    extractGameCraftAndTagProfile,
    lookupCatalogTypicalHours,
    rankGameCandidates
  } = await import("../src/games/services/gameRankerService.js");
  const { curateGamesWithOracle } = await import("../src/games/services/gameOracleService.js");

  const modelsDir = path.join(process.cwd(), "public/models/games");
  const toAb = (file) => {
    const b = fs.readFileSync(path.join(modelsDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  const catalogMeta = parseGameCatalogMetaBinary(toAb("game_catalog_meta.bin"));
  assert.equal(catalogMeta.version, 2, "game_catalog_meta.bin should be CVGM v2");
  const portalHrs = lookupCatalogTypicalHours(72, catalogMeta);
  const eldenHrs = lookupCatalogTypicalHours(119133, catalogMeta);
  assert.ok(portalHrs >= 5 && portalHrs <= 20, `Expected Portal 2 typical hours ~10h, got ${portalHrs}`);
  assert.ok(eldenHrs >= 60 && eldenHrs <= 160, `Expected Elden Ring typical hours ~117h, got ${eldenHrs}`);

  // 1. Relative playtime: 15h in Portal 2 (~10h game -> 1.5x length!) weighs MORE than 15h in Elden Ring (~117h game -> 0.13x!)
  const relWeights = buildWeightedGameRatings(
    [
      { igdbId: 72, title: "Portal 2", userRating: 9, hoursPlayed: 15, status: "completed" },
      { igdbId: 119133, title: "Elden Ring", userRating: 9, hoursPlayed: 15, status: "completed" }
    ],
    { catalogMeta }
  );
  assert.ok(relWeights[0].weight > relWeights[1].weight, `15h in Portal 2 (${relWeights[0].weight}) should outweigh 15h in Elden Ring (${relWeights[1].weight})`);

  // 2. Gentle recency tilt: game played this week outweighs identical game played 3 years ago
  const nowMs = Date.parse("2026-11-28T00:00:00Z");
  const recWeights = buildWeightedGameRatings(
    [
      { igdbId: 72, title: "Portal 2", userRating: 9, status: "completed", datePlayed: "2026-11-25" },
      { igdbId: 71, title: "Portal", userRating: 9, status: "completed", datePlayed: "2023-05-01" }
    ],
    { nowMs }
  );
  assert.ok(recWeights[0].weight > recWeights[1].weight * 1.15, "Recent game should receive gentle recency tilt over 3-year-old game");

  // 3. Craft Breakdown + Quick Tags profile steers candidate tie-breaks and flows into Oracle prompts
  const cozyPlayed = [
    {
      igdbId: 17000,
      title: "Stardew Valley",
      userRating: 10,
      status: "completed",
      genres: ["Simulator", "Indie"],
      ratingBreakdown: { gameplay: 4, story: 5, visuals: 5, audio: 5, replayability: 5 },
      quickTags: ["#CozyVibes", "#DeepStory", "#Masterpiece"]
    }
  ];
  const dna = extractGameCraftAndTagProfile(cozyPlayed);
  assert.equal(dna.hasSignals, true);
  assert.ok(dna.implicitToneBias > 0, "CozyVibes should create positive warm tone bias");
  assert.ok(dna.implicitPacingBias < 0, "CozyVibes + DeepStory should create lower intensity bias");
  assert.ok(dna.topCraftLabels.length >= 2);
  assert.ok(dna.topTags.includes("#CozyVibes"));

  const contentIndex = parseEmbeddingBinary(toAb("game_content_f16.bin"));
  const tunerAxes = JSON.parse(fs.readFileSync(path.join(modelsDir, "game_tuner_axes.json"), "utf8"));
  const rankedWithDna = rankGameCandidates(
    [
      { igdbId: 11133, title: "Dark Souls III", year: 2016, rating10: 8.8, ratingCount: 1500, genres: ["Hack and slash/Beat 'em up"] },
      { igdbId: 17001, title: "Cozy Story Sim", year: 2022, rating10: 8.8, ratingCount: 1500, genres: ["Simulator", "Adventure"] }
    ],
    cozyPlayed,
    [],
    { contentIndex, tunerAxes, catalogMeta }
  );
  assert.equal(rankedWithDna[0].igdbId, 17001, "Cozy + Story craft/tag DNA should lift matching cozy story sim");

  // Oracle prompt includes craft DNA and vault quick tags
  let capturedPrompt = "";
  await curateGamesWithOracle({
    played: cozyPlayed,
    candidates: [{ igdbId: 17001, title: "Cozy Story Sim", year: 2022, matchScore: 90, matchReasons: ["Story-Driven Fit"] }],
    useGemini: true,
    geminiCaller: async (p) => {
      capturedPrompt = p;
      return JSON.stringify({ picks: [{ igdbId: 17001, anchorTitles: ["Stardew Valley"], pitch: "Warm and relaxing." }] });
    }
  });
  assert.match(capturedPrompt, /#CozyVibes/);
  assert.match(capturedPrompt, /Story & World/);
});
