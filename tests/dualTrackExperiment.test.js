import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTieredVault,
  buildFullVaultPrompt,
  buildFullVaultResponseSchema,
  formatDossierBlock,
  buildDossierCurationPrompt,
  verifyGenerativePicks,
  computeArmMetrics,
  buildTwoPassBlindBallot,
  buildCombinedTwoPassBallot,
  scoreBlindBallot
} from "../scripts/experiments/dual_track_utils.mjs";

test("formatTieredVault groups movies by rating tier, sorts newest first, preserves directors & notes, separates series & watchlist", () => {
  const watched = [
    {
      tmdbId: 1,
      title: "Older Ten",
      year: "2003",
      director: "Bong Joon-ho",
      userRating: 10,
      dateWatched: "2024-08-10",
      userNote: "Masterpiece pacing",
      poster: "https://image.tmdb.org/t/p/w500/should_not_appear.jpg"
    },
    {
      tmdbId: 2,
      title: "Newer Ten",
      year: "2007",
      director: "Coen Brothers",
      userRating: 10,
      dateWatched: "2025-11-05",
      userNote: "Zero wasted dialogue"
    },
    {
      tmdbId: 3,
      title: "Great Nine",
      year: "2019",
      director: "Robert Eggers",
      userRating: 9,
      dateWatched: "2026-01-12"
    },
    {
      tmdbId: 4,
      title: "Solid Eight",
      year: "2014",
      director: "Denis Villeneuve",
      userRating: 8,
      dateWatched: "2025-05-01"
    },
    {
      tmdbId: 5,
      title: "Near Miss Seven",
      year: "2021",
      director: "Ridley Scott",
      userRating: 7,
      dateWatched: "2025-02-14",
      userNote: "Great visuals, thin third act"
    },
    {
      tmdbId: 6,
      title: "Disliked Five",
      year: "2022",
      director: "Some Director",
      userRating: 5,
      dateWatched: "2025-03-01"
    },
    {
      tmdbId: 7,
      title: "Dark",
      year: "2017",
      Type: "series",
      director: "Baran bo Odar",
      userRating: 10,
      dateWatched: "2025-07-20"
    }
  ];
  const watchlist = [
    { tmdbId: 8, title: "Target Film", year: "2024", poster: "https://image.tmdb.org/t/p/w500/bad.jpg" },
    { tmdbId: 9, title: "Target Series", year: "2023", Type: "series" }
  ];

  const { text, stats } = formatTieredVault(watched, watchlist, {
    userRegion: "PK",
    userWatchProviders: ["Netflix", "Amazon Prime Video"]
  });

  assert.equal(stats.movieCount, 6);
  assert.equal(stats.seriesCount, 1);
  assert.equal(stats.watchlistCount, 2);
  assert.ok(!text.includes("image.tmdb.org"), "Must strip poster URLs to save tokens");

  // Check section headers
  assert.ok(text.includes("=== MY STATS ==="));
  assert.ok(text.includes("Region: PK"));
  assert.ok(text.includes("Netflix, Amazon Prime Video"));
  assert.ok(text.includes("=== 10/10 MASTERPIECES ==="));
  assert.ok(text.includes("=== 9/10 FAVORITES ==="));
  assert.ok(text.includes("=== 8/10 GREAT ==="));
  assert.ok(text.includes("=== 6-7/10 NEAR MISSES"));
  assert.ok(text.includes("=== <=5/10 DISLIKED"));
  assert.ok(text.includes("=== LOVED SERIES / ANIME"));
  assert.ok(text.includes("=== WATCHLIST (Already planned — DO NOT recommend) ==="));

  // Newest-first sort within 10/10 tier
  const newerIdx = text.indexOf("Newer Ten (2007)");
  const olderIdx = text.indexOf("Older Ten (2003)");
  assert.ok(newerIdx > 0 && olderIdx > newerIdx, "Newer Ten [2025-11] must precede Older Ten [2024-08]");
  assert.ok(text.includes("Dir: Coen Brothers"), "Must include director metadata");
  assert.ok(text.includes("Zero wasted dialogue"), "Must include userNote");

  // Series separated from movie tiers
  const seriesSectionIdx = text.indexOf("=== LOVED SERIES / ANIME");
  const darkIdx = text.indexOf("Dark (2017)");
  assert.ok(darkIdx > seriesSectionIdx, "TV series must live in LOVED SERIES / ANIME, not movie tiers");
});

test("buildFullVaultPrompt and buildFullVaultResponseSchema include mood, rules, taste drift, blindspot & thesis schema", () => {
  const prompt = buildFullVaultPrompt({
    vaultText: "=== MY STATS ===\n6 movies rated",
    moodLabel: "Any Vibe",
    moodDirective: "Match core taste.",
    vibeConstraints: ['Vibe request: "quiet late-night detective mystery, pre-2010"'],
    tasteRules: [{ text: "No slasher gore", polarity: "avoid", pinned: true, active: true }],
    region: "GLOBAL",
    providers: [],
    excludeTitles: ["Zodiac (2007)"],
    requestedCount: 15,
    blindspotCount: 3
  });

  assert.ok(prompt.includes("quiet late-night detective mystery, pre-2010"));
  assert.ok(prompt.includes("[PINNED Avoid] No slasher gore"));
  assert.ok(prompt.includes("Zodiac (2007)"));
  assert.ok(prompt.includes("2024–2026") || prompt.includes("2024-2026"), "Must instruct tracking taste drift");
  assert.ok(prompt.includes("3") && prompt.toLowerCase().includes("blindspot"));
  assert.ok(prompt.includes("NEVER include internal system labels"), "Must share Track 1 anti-jargon rule");

  const schema = buildFullVaultResponseSchema({ includeThesis: true });
  assert.ok(schema.properties.tasteThesis, "Must request tasteThesis before recommendations");
  assert.deepEqual(
    Object.keys(schema.properties.tasteThesis.properties).sort(),
    ["dealbreakers", "hiddenAttractors", "nearMissTraps", "tasteDrift"]
  );
  assert.ok(schema.properties.recommendations.items.properties.isBlindspot);
});

test("formatDossierBlock and buildDossierCurationPrompt inject compact Taste Manifesto before candidates", () => {
  const dossier = formatDossierBlock({
    hiddenAttractors: ["Moral ambiguity under pressure", "Measured nocturnal pacing", "Procedural rigor"],
    nearMissTraps: ["Over-explained third acts", "Glossy studio pacing"],
    dealbreakers: ["Loud jump-scare horror", "Quippy Marvel-style dialogue"],
    tasteDrift: "Shifted from twist thrillers toward austere international realism in 2025-2026."
  });

  assert.ok(dossier.length > 50 && dossier.length <= 2800, "Dossier must stay compact (~<=700 tokens)");
  assert.ok(dossier.includes("Moral ambiguity under pressure"));
  assert.ok(dossier.includes("Over-explained third acts"));

  const basePrompt = "USER TASTE PROFILE:\n- Genres: Drama\n\nPRE-RANKED CANDIDATE MOVIES (Top 39):\nID: 10 | \"Cure\" (1997)\n\nTASK:\nSelect 10.";
  const injected = buildDossierCurationPrompt(basePrompt, {
    hiddenAttractors: ["Moral ambiguity"],
    nearMissTraps: ["Thin endings"],
    dealbreakers: ["Jumpscares"],
    tasteDrift: "Moving toward slow cinema."
  });

  const dossierIdx = injected.indexOf("HYDROGEN TASTE DOSSIER");
  const candIdx = injected.indexOf("PRE-RANKED CANDIDATE MOVIES");
  assert.ok(dossierIdx >= 0 && candIdx > dossierIdx, "Dossier block must be injected right before candidate list");
});


test("verifyGenerativePicks audits every pick disposition without truncating at 2 and preserves Track 1 pool overlaps", async () => {
  const watched = [
    { tmdbId: 101, title: "Already Watched", year: "2007" }
  ];
  const watchlist = [
    { tmdbId: 102, title: "On Watchlist", year: "2020" }
  ];
  const excludeIds = [103];
  const rawPicks = [
    { title: "Already Watched", year: "2007", reason: "Watched collision", anchorTitles: ["A"] },
    { title: "On Watchlist", year: "2020", reason: "Watchlist collision", anchorTitles: ["A"] },
    { title: "Prior Batch", year: "2015", reason: "Excluded batch", anchorTitles: ["A"] },
    { title: "Made Up Film", year: "2025", reason: "Hallucinated", anchorTitles: ["A"] },
    { title: "TV Show Pick", year: "2019", reason: "Series", anchorTitles: ["A"] },
    { title: "Valid Overlap With Track1", year: "1997", reason: "Good pick", anchorTitles: ["A"], isBlindspot: false },
    { title: "Valid Overlap With Track1", year: "1997", reason: "Duplicate in batch", anchorTitles: ["A"] },
    { title: "Wrong Streaming", year: "2001", reason: "Not on Netflix", anchorTitles: ["A"] },
    { title: "Post 2010 Film", year: "2018", reason: "Fails maxYear mood", anchorTitles: ["A"] },
    { title: "Gore Avoid Film", year: "2004", reason: "Fails avoid rule", anchorTitles: ["A"] },
    { title: "Valid Blindspot", year: "1976", reason: "Deep cut", anchorTitles: ["A"], isBlindspot: true },
    { title: "Valid Third Pick", year: "2005", reason: "Third survivor", anchorTitles: ["A"], isBlindspot: false }
  ];

  const stubMap = {
    "Already Watched": { tmdbId: 101, title: "Already Watched", year: "2007" },
    "On Watchlist": { tmdbId: 102, title: "On Watchlist", year: "2020" },
    "Prior Batch": { tmdbId: 103, title: "Prior Batch", year: "2015" },
    "Made Up Film": null,
    "TV Show Pick": { tmdbId: 104, title: "TV Show Pick", year: "2019", Type: "series" },
    "Valid Overlap With Track1": { tmdbId: 201, title: "Valid Overlap With Track1", year: "1997" },
    "Wrong Streaming": { tmdbId: 202, title: "Wrong Streaming", year: "2001" },
    "Post 2010 Film": { tmdbId: 203, title: "Post 2010 Film", year: "2018" },
    "Gore Avoid Film": { tmdbId: 204, title: "Gore Avoid Film", year: "2004" },
    "Valid Blindspot": { tmdbId: 205, title: "Valid Blindspot", year: "1976" },
    "Valid Third Pick": { tmdbId: 206, title: "Valid Third Pick", year: "2005" }
  };

  const detailMap = {
    201: { tmdbId: 201, title: "Valid Overlap With Track1", year: "1997", director: "Kiyoshi Kurosawa", genre: "Mystery, Thriller", tmdbGenreIds: [9648, 53], vote_count: 1400, vote_average: 7.5, streamProviders: [{ provider_id: 8, provider_name: "Netflix" }], overview: "Detective investigates strange crimes." },
    202: { tmdbId: 202, title: "Wrong Streaming", year: "2001", director: "Dir B", genre: "Mystery", tmdbGenreIds: [9648], vote_count: 800, vote_average: 7.2, streamProviders: [{ provider_id: 15, provider_name: "Hulu" }], overview: "Only on Hulu." },
    203: { tmdbId: 203, title: "Post 2010 Film", year: "2018", director: "Dir C", genre: "Mystery", tmdbGenreIds: [9648], vote_count: 900, vote_average: 7.6, streamProviders: [{ provider_id: 8, provider_name: "Netflix" }], overview: "Too recent." },
    204: { tmdbId: 204, title: "Gore Avoid Film", year: "2004", director: "Dir D", genre: "Mystery, Thriller", tmdbGenreIds: [9648, 53], keywordNames: ["slasher", "gore"], vote_count: 700, vote_average: 7.0, streamProviders: [{ provider_id: 8, provider_name: "Netflix" }], overview: "Brutal slasher gore." },
    205: { tmdbId: 205, title: "Valid Blindspot", year: "1976", director: "Francesco Rosi", genre: "Crime, Mystery", tmdbGenreIds: [80, 9648], vote_count: 350, vote_average: 7.7, streamProviders: [{ provider_id: 8, provider_name: "Netflix" }], overview: "Italian procedural." },
    206: { tmdbId: 206, title: "Valid Third Pick", year: "2005", director: "Dir E", genre: "Drama, Mystery", tmdbGenreIds: [18, 9648], vote_count: 2200, vote_average: 7.8, streamProviders: [{ provider_id: 8, provider_name: "Netflix" }], overview: "Slow-burn mystery." }
  };

  const report = await verifyGenerativePicks(
    rawPicks,
    {
      watched,
      watchlist,
      excludeIds,
      mood: "any",
      moodFilters: { query: "pre-2010 mystery", maxYear: 2009 },
      userProviders: [8],
      tasteRules: [{ text: "Avoid slasher gore", polarity: "avoid", active: true }],
      collabSimMap: new Map([[201, 0.82], [206, 0.45]])
    },
    {
      finder: async (title) => stubMap[title] ?? null,
      detailFetcher: async (id) => detailMap[id] ?? null
    }
  );

  assert.equal(report.survivors.length, 3, "Must keep all 3 valid survivors (never cap at 2)");
  assert.deepEqual(report.survivors.map((s) => s.tmdbId), [201, 205, 206]);
  assert.equal(report.survivors[0].collabSim, 0.82);
  assert.equal(report.survivors[1].collabSim, 0);
  assert.equal(report.survivors[1].isBlindspot, true);

  assert.equal(report.counts.collision_watched, 1);
  assert.equal(report.counts.collision_watchlist, 1);
  assert.equal(report.counts.collision_excluded, 1);
  assert.equal(report.counts.hallucinated_or_unmatched, 1);
  assert.equal(report.counts.tv_series, 1);
  assert.equal(report.counts.duplicate_within_batch, 1);
  assert.equal(report.counts.failed_provider, 1);
  assert.equal(report.counts.failed_mood, 1);
  assert.equal(report.counts.failed_avoid, 1);
  assert.equal(report.counts.survived, 3);

  const metrics = computeArmMetrics({
    armName: "arm2_fullvault_hydrogen",
    model: "gemini-4-hydrogen",
    rawCount: rawPicks.length,
    verifiedReport: report,
    finalPicks: report.survivors,
    track1FinalIds: new Set([999]),
    track1ShortlistIds: new Set([201, 999]),
    latencyMs: 12340,
    usageMetadata: { promptTokenCount: 3100, candidatesTokenCount: 900, totalTokenCount: 4000 }
  });

  assert.equal(metrics.overlapWithTrack1Final, 0);
  assert.equal(metrics.overlapWithTrack1Shortlist, 1);
  assert.equal(metrics.medianVoteCount, 1400);
  assert.equal(metrics.coldCollabCount, 1);
  assert.equal(metrics.meanCollabSimAll, Number(((0.82 + 0 + 0.45) / 3).toFixed(4)));
  assert.equal(metrics.totalTokens, 4000);
});


test("buildTwoPassBlindBallot deduplicates shared movies, strips arm/score leaks, and scoreBlindBallot unblinds accurately", () => {
  const arms = {
    track1_math_hydrogen: [
      {
        tmdbId: 501,
        title: "Cure",
        year: "1997",
        director: "Kiyoshi Kurosawa",
        genre: "Mystery, Thriller",
        plot: "A Tokyo detective investigates bizarre murders.",
        matchScore: 94,
        sourceBucket: "Embedding",
        reason: "Track 1 reason for Cure.",
        anchorTitles: ["Memories of Murder"]
      },
      {
        tmdbId: 502,
        title: "The Chaser",
        year: "2008",
        director: "Na Hong-jin",
        genre: "Crime, Thriller",
        plot: "An ex-detective hunts a killer.",
        matchScore: 91,
        sourceBucket: "TMDB",
        reason: "Track 1 reason for Chaser.",
        anchorTitles: ["Memories of Murder"]
      }
    ],
    arm2_fullvault_hydrogen: [
      {
        tmdbId: 501,
        title: "Cure",
        year: "1997",
        director: "Kiyoshi Kurosawa",
        genre: "Mystery, Thriller",
        overview: "A Tokyo detective investigates bizarre murders.",
        isBlindspot: false,
        reason: "Arm 2 reason for Cure.",
        anchorTitles: ["Memories of Murder", "Zodiac"]
      },
      {
        tmdbId: 503,
        title: "The Red Riding Trilogy: 1974",
        year: "2009",
        director: "Julian Jarrold",
        genre: "Crime, Mystery",
        overview: "Bleak Yorkshire investigation.",
        isBlindspot: true,
        reason: "Arm 2 blindspot reason.",
        anchorTitles: ["Zodiac"]
      }
    ]
  };

  const { markdown, key } = buildTwoPassBlindBallot({
    scenarioId: "poetic_vibe",
    scenarioLabel: "Poetic Vibe",
    arms,
    seed: 42
  });

  // Deduplication: 3 unique movies (501, 502, 503), not 4
  assert.equal(key.movies.length, 3);
  const movie501 = key.movies.find((m) => m.tmdbId === 501);
  assert.deepEqual(movie501.arms.slice().sort(), ["arm2_fullvault_hydrogen", "track1_math_hydrogen"]);
  assert.equal(movie501.pitches.length, 2, "Shared movie preserves both anonymized pitches in Pass 2");

  // No leakage of arm names, matchScore, or blindspot tags in ballot markdown
  assert.ok(!markdown.includes("track1_math_hydrogen"));
  assert.ok(!markdown.includes("arm2_fullvault_hydrogen"));
  assert.ok(!markdown.includes("94%"));
  assert.ok(!markdown.includes("isBlindspot"));
  assert.ok(!markdown.includes("Embedding"));

  // Pass 1 appears before Pass 2, and Pass 1 does not contain AI reasons
  const pass1Idx = markdown.indexOf("## PASS 1");
  const pass2Idx = markdown.indexOf("## PASS 2");
  assert.ok(pass1Idx >= 0 && pass2Idx > pass1Idx);
  const pass1Body = markdown.slice(pass1Idx, pass2Idx);
  assert.ok(!pass1Body.includes("Track 1 reason for Cure"));
  assert.ok(!pass1Body.includes("Arm 2 blindspot reason"));

  // Simulate user filling in scores in the markdown
  let filled = markdown;
  for (const m of key.movies) {
    const isCure = m.tmdbId === 501;
    const isChaser = m.tmdbId === 502;
    const exc = isCure ? "5/5" : isChaser ? "3/5" : "4/5";
    const disc = isCure ? "4/5" : isChaser ? "2/5" : "5/5";
    filled = filled
      .replace(`<!-- SCORE:M${m.num}:EXC -->`, exc)
      .replace(`<!-- SCORE:M${m.num}:DISC -->`, disc);
    for (const p of m.pitches) {
      const tasteScore = p.arm === "arm2_fullvault_hydrogen" ? "5/5" : "3/5";
      filled = filled.replace(`<!-- SCORE:M${m.num}:P${p.label}:TASTE -->`, tasteScore);
    }
  }

  const scored = scoreBlindBallot(filled, key);
  assert.equal(scored.parsedMovies, 3);
  assert.equal(scored.unparsedMovies, 0);

  // Track 1 has Cure (exc 5, disc 4, taste 3) + Chaser (exc 3, disc 2, taste 3) => avg exc 4.0, disc 3.0, taste 3.0
  assert.equal(scored.perArm.track1_math_hydrogen.avgExcitement, 4);
  assert.equal(scored.perArm.track1_math_hydrogen.avgDiscovery, 3);
  assert.equal(scored.perArm.track1_math_hydrogen.avgTaste, 3);

  // Arm 2 has Cure (exc 5, disc 4, taste 5) + Red Riding (exc 4, disc 5, taste 5) => avg exc 4.5, disc 4.5, taste 5.0
  assert.equal(scored.perArm.arm2_fullvault_hydrogen.avgExcitement, 4.5);
  assert.equal(scored.perArm.arm2_fullvault_hydrogen.avgDiscovery, 4.5);
  assert.equal(scored.perArm.arm2_fullvault_hydrogen.avgTaste, 5);
  assert.ok(scored.summaryMarkdown.includes("arm2_fullvault_hydrogen"));
});


test("buildCombinedTwoPassBallot numbers movies sequentially across scenarios and unblinds with scoreBlindBallot", () => {
  const { markdown, key } = buildCombinedTwoPassBallot([
    {
      scenarioId: "any_vibe",
      scenarioLabel: "Any Vibe",
      arms: {
        track1: [{ tmdbId: 1, title: "Film A", year: "2001", reason: "R1", anchorTitles: ["X"] }],
        arm2: [{ tmdbId: 2, title: "Film B", year: "2002", reason: "R2", anchorTitles: ["Y"] }]
      }
    },
    {
      scenarioId: "poetic_vibe",
      scenarioLabel: "Poetic Vibe",
      arms: {
        track1: [{ tmdbId: 3, title: "Film C", year: "1999", reason: "R3", anchorTitles: ["X"] }],
        arm2: [{ tmdbId: 4, title: "Film D", year: "2004", reason: "R4", anchorTitles: ["Y"] }]
      }
    }
  ]);

  assert.deepEqual(key.movies.map((m) => m.num), [1, 2, 3, 4]);
  let filled = markdown;
  for (const m of key.movies) {
    filled = filled
      .replace(`<!-- SCORE:M${m.num}:EXC -->`, "4")
      .replace(`<!-- SCORE:M${m.num}:DISC -->`, "5");
    for (const p of m.pitches) {
      filled = filled.replace(`<!-- SCORE:M${m.num}:P${p.label}:TASTE -->`, p.arm === "arm2" ? "5" : "3");
    }
  }
  const scored = scoreBlindBallot(filled, key);
  assert.equal(scored.parsedMovies, 4);
  assert.equal(scored.perArm.arm2.avgTaste, 5);
  assert.equal(scored.perArm.track1.avgTaste, 3);
});
