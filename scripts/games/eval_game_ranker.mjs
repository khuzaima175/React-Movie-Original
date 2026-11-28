/**
 * Offline Verification & Evaluation Harness for GameVault's Browser ML Ranker.
 * Loads real trained models + `game_edition_aliases.json` and runs:
 *   1. Edition Alias Resolution audit (1,034 split IGDB editions -> warm EASE IDs)
 *   2. Leave-One-Out ranking evaluation across 4 realistic gamer archetypes
 *   3. Franchise Diversity Cap audit, Dismissal Repulsion delta & `Est. X.X/10` calibration spread
 */
import fs from "node:fs";
import path from "node:path";
import { parseEaseBinary } from "../../src/services/easeService.js";
import { parseEmbeddingBinary } from "../../src/services/embeddingService.js";
import {
  applyFranchiseDiversityCap,
  applyGameTuner,
  buildGameRecommendationIds,
  extractGameFranchiseKey,
  predictGameRating,
  rankGameCandidates,
  resolveWarmGameId
} from "../../src/games/services/gameRankerService.js";
import { GAME_ORACLE_MOODS } from "../../src/games/services/gameOracleService.js";

function loadModels() {
  const dir = path.join(process.cwd(), "public/models/games");
  const toAb = (f) => {
    const b = fs.readFileSync(path.join(dir, f));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  return {
    easeIndex: parseEaseBinary(toAb("game_ease_k80.cvea")),
    collabIndex: parseEmbeddingBinary(toAb("game_embeddings_f16.bin")),
    contentIndex: parseEmbeddingBinary(toAb("game_content_f16.bin")),
    tunerAxes: JSON.parse(fs.readFileSync(path.join(dir, "game_tuner_axes.json"), "utf8")),
    weights: JSON.parse(fs.readFileSync(path.join(dir, "game_ranker_weights.json"), "utf8")),
    editionAliases: JSON.parse(fs.readFileSync(path.join(dir, "game_edition_aliases.json"), "utf8"))
  };
}

const ARCHETYPES = [
  {
    name: "Action-RPG / Souls / Story Fan",
    games: [
      { igdbId: 1942, title: "The Witcher 3: Wild Hunt", userRating: 10, year: 2015, rating10: 9.4, ratingCount: 4100, genres: ["Role-playing (RPG)", "Adventure"] },
      { igdbId: 119133, title: "Elden Ring", userRating: 10, year: 2022, rating10: 9.5, ratingCount: 2400, genres: ["Role-playing (RPG)", "Adventure"] },
      { igdbId: 76882, title: "Sekiro: Shadows Die Twice", userRating: 9, year: 2019, rating10: 9.0, ratingCount: 1800, genres: ["Adventure"] },
      { igdbId: 11133, title: "Dark Souls III", userRating: 9, year: 2016, rating10: 8.7, ratingCount: 2027, genres: ["Role-playing (RPG)"] },
      { igdbId: 103337, title: "Divinity: Original Sin II - Definitive Edition", userRating: 10, year: 2018, rating10: 9.3, ratingCount: 159, genres: ["Role-playing (RPG)", "Strategy"] },
      { igdbId: 119171, title: "Baldur's Gate III", userRating: 10, year: 2023, rating10: 9.5, ratingCount: 1400, genres: ["Role-playing (RPG)", "Strategy"] },
      { igdbId: 472, title: "The Elder Scrolls V: Skyrim", userRating: 9, year: 2011, rating10: 8.8, ratingCount: 4400, genres: ["Role-playing (RPG)", "Adventure"] },
      { igdbId: 2155, title: "Dark Souls", userRating: 9, year: 2011, rating10: 8.8, ratingCount: 1758, genres: ["Role-playing (RPG)"] }
    ]
  },
  {
    name: "Cinematic Narrative / Open-World",
    games: [
      { igdbId: 25076, title: "Red Dead Redemption 2", userRating: 10, year: 2018, rating10: 9.3, ratingCount: 3500, genres: ["Shooter", "Adventure"] },
      { igdbId: 19560, title: "God of War", userRating: 10, year: 2018, rating10: 9.4, ratingCount: 3682, genres: ["Role-playing (RPG)", "Adventure"] },
      { igdbId: 1009, title: "The Last of Us", userRating: 9, year: 2013, rating10: 9.2, ratingCount: 3660, genres: ["Shooter", "Adventure"] },
      { igdbId: 7331, title: "Uncharted 4: A Thief's End", userRating: 9, year: 2016, rating10: 9.0, ratingCount: 2200, genres: ["Shooter", "Adventure"] },
      { igdbId: 14362, title: "Detroit: Become Human", userRating: 9, year: 2018, rating10: 8.3, ratingCount: 1100, genres: ["Adventure"] },
      { igdbId: 1877, title: "Cyberpunk 2077", userRating: 9, year: 2020, rating10: 8.4, ratingCount: 1900, genres: ["Role-playing (RPG)", "Shooter"] },
      { igdbId: 19564, title: "Death Stranding", userRating: 9, year: 2019, rating10: 8.5, ratingCount: 931, genres: ["Adventure"] }
    ]
  },
  {
    name: "Indie / Roguelike / Cozy-Precision",
    games: [
      { igdbId: 14593, title: "Hollow Knight", userRating: 10, year: 2017, rating10: 9.2, ratingCount: 2600, genres: ["Platform", "Adventure", "Indie"] },
      { igdbId: 113112, title: "Hades", userRating: 10, year: 2020, rating10: 9.1, ratingCount: 1700, genres: ["Hack and slash/Beat 'em up", "Indie"] },
      { igdbId: 26845, title: "Ori and the Will of the Wisps", userRating: 9, year: 2020, rating10: 8.9, ratingCount: 900, genres: ["Platform", "Adventure"] },
      { igdbId: 7344, title: "Ori and the Blind Forest", userRating: 9, year: 2015, rating10: 8.6, ratingCount: 1560, genres: ["Platform", "Adventure"] },
      { igdbId: 17000, title: "Stardew Valley", userRating: 9, year: 2016, rating10: 8.9, ratingCount: 1400, genres: ["Simulator", "Indie"] },
      { igdbId: 251833, title: "Balatro", userRating: 9, year: 2024, rating10: 9.0, ratingCount: 520, genres: ["Card & Board Game", "Indie"] },
      { igdbId: 228525, title: "Hades II", userRating: 9, year: 2025, rating10: 9.0, ratingCount: 185, genres: ["Hack and slash/Beat 'em up", "Indie"] }
    ]
  },
  {
    name: "FPS / Action Sandbox",
    games: [
      { igdbId: 1020, title: "Grand Theft Auto V", userRating: 9, year: 2013, rating10: 8.9, ratingCount: 4200, genres: ["Shooter", "Adventure"] },
      { igdbId: 18320, title: "Battlefield 1", userRating: 8, year: 2016, rating10: 8.0, ratingCount: 1200, genres: ["Shooter"] },
      { igdbId: 545, title: "Call of Duty: Black Ops", userRating: 9, year: 2010, rating10: 8.2, ratingCount: 1100, genres: ["Shooter"] },
      { igdbId: 103298, title: "DOOM Eternal", userRating: 9, year: 2020, rating10: 8.7, ratingCount: 1250, genres: ["Shooter"] },
      { igdbId: 72, title: "Portal 2", userRating: 10, year: 2011, rating10: 9.2, ratingCount: 3800, genres: ["Puzzle", "Shooter"] },
      { igdbId: 9630, title: "Fallout 4", userRating: 8, year: 2015, rating10: 8.2, ratingCount: 1780, genres: ["Role-playing (RPG)", "Shooter"] }
    ]
  }
];

function main() {
  const models = loadModels();
  const aliasCount = Object.keys(models.editionAliases || {}).length;
  console.log(`Loaded GameVault ML Bundle | EASE=${models.easeIndex.count}x${models.easeIndex.K} | Collab=${models.collabIndex.count}x${models.collabIndex.dim} | Content=${models.contentIndex.count}x${models.contentIndex.dim} | EditionAliases=${aliasCount}`);

  // 1. Edition Alias verification
  const expectedAliases = [[472, 19457], [2155, 81085], [478, 20740], [19564, 152063], [103337, 11800], [59849, 109]];
  const aliasHits = expectedAliases.filter(([c, w]) => resolveWarmGameId(c, models.editionAliases) === w).length;
  console.log(`Edition Alias Checks: ${aliasHits}/${expectedAliases.length} resolved accurately.`);

  // 2. Leave-one-out retrieval evaluation across all archetype ratings
  let totalLoo = 0;
  let hitsTop20 = 0;
  let hitsTop50 = 0;
  for (const arch of ARCHETYPES) {
    let archHit20 = 0;
    for (let i = 0; i < arch.games.length; i++) {
      const target = arch.games[i];
      const train = arch.games.filter((_, idx) => idx !== i);
      const { allIds } = buildGameRecommendationIds(train, [], models, { warmLimit: 50, coldLimit: 20 });
      const targetWarm = resolveWarmGameId(target.igdbId, models.editionAliases);
      const idx = allIds.findIndex((id) => id === target.igdbId || id === targetWarm);
      if (idx >= 0 && idx < 20) { hitsTop20++; archHit20++; }
      if (idx >= 0 && idx < 50) hitsTop50++;
      totalLoo++;
    }
    console.log(`  Archetype "${arch.name}": LOO HR@20 = ${archHit20}/${arch.games.length}`);
  }
  console.log(`Overall Leave-One-Out Retrieval: HR@20=${((hitsTop20 / totalLoo) * 100).toFixed(1)}% (${hitsTop20}/${totalLoo}), HR@50=${((hitsTop50 / totalLoo) * 100).toFixed(1)}% (${hitsTop50}/${totalLoo})`);

  // 3. Dismissal Repulsion Check
  const vault = ARCHETYPES[0].games;
  const candidatePool = [
    { igdbId: 7334, title: "Bloodborne", year: 2015, rating10: 9.2, ratingCount: 2500, genres: ["Role-playing (RPG)"] },
    { igdbId: 17000, title: "Stardew Valley", year: 2016, rating10: 8.9, ratingCount: 1400, genres: ["Simulator", "Indie"] }
  ];
  const baseRank = rankGameCandidates(candidatePool, vault, [], models);
  const dismissedRank = rankGameCandidates(candidatePool, vault, [], models, null, { dismissedIds: new Set([2368, 81085]) });
  const bbBase = baseRank.find((g) => g.igdbId === 7334)?.rankerLogit || 0;
  const bbAfter = dismissedRank.find((g) => g.igdbId === 7334)?.rankerLogit || 0;
  console.log(`Dismissal Repulsion Delta (Bloodborne after dismissing DS2 + DS1R): ${(bbAfter - bbBase).toFixed(3)} logit`);

  // 4. Est. Rating Calibration Spread for High Rater (mean 9.2)
  const highVault = [10, 10, 10, 10, 9, 9, 9, 9, 9, 8, 8, 8].map((userRating) => ({ userRating }));
  console.log("Est. Rating Spread (9.2-avg player):", [60, 72, 82, 90, 96].map((m) => `${m}%->${predictGameRating(m, highVault)}`).join(" | "));

  // 5. Franchise Diversity Cap + Neural Mood Steering Check
  const cozyBias = GAME_ORACLE_MOODS.find((m) => m.id === "cozy")?.tunerBias;
  const cozyRanked = applyGameTuner(
    rankGameCandidates([...ARCHETYPES[2].games, ...ARCHETYPES[0].games.slice(0, 3)], ARCHETYPES[2].games.slice(0, 3), [], models),
    cozyBias,
    { contentIndex: models.contentIndex, tunerAxes: models.tunerAxes, editionAliases: models.editionAliases, played: ARCHETYPES[2].games }
  );
  console.log(`Oracle "Cozy" Neural Bias Top 2: ${cozyRanked.slice(0, 2).map((g) => `${g.title} (delta=${g.tunerDelta})`).join(", ")}`);
  const capped = applyFranchiseDiversityCap([
    { igdbId: 1, title: "Dark Souls III" },
    { igdbId: 2, title: "Dark Souls II" },
    { igdbId: 3, title: "Dark Souls: Remastered" },
    { igdbId: 4, title: "Witcher 3" }
  ], { maxPerFranchise: 1, headWindow: 3 });
  console.log("Franchise Cap Top 3:", capped.slice(0, 3).map((g) => `${g.title} [${extractGameFranchiseKey(g.title)}]`).join(", "));
}

main();
