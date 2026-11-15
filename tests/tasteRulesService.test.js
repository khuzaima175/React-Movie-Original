import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_TASTE_RULES,
  MAX_RULE_TEXT_LENGTH,
  normalizeTasteRules,
  extractRuleSignals,
  compileActiveTasteRules,
  candidateMatchesAvoidRule,
  candidateMatchesPreferRule,
  buildTasteRulesHashSegment,
  draftTasteRulesFallback,
  draftTasteRulesWithGemini
} from "../src/services/tasteRulesService.js";

test("normalizeTasteRules rejects blanks, dedupes case-insensitively, truncates to 140 chars, and caps at 8 rules", () => {
  const longText = "Prefer taut philosophical sci-fi mysteries " + "x".repeat(200);
  const raw = [
    { id: "r1", text: "   ", polarity: "avoid" },
    { id: "r2", text: "No horror", polarity: "avoid", pinned: true, active: true },
    { id: "r2_dup", text: "  no horror  ", polarity: "avoid" },
    { id: "r2_same_diff_polarity", text: "No horror", polarity: "prefer" },
    { id: "r3", text: longText, polarity: "prefer", pinned: true, active: false },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `extra_${i}`, text: `Rule ${i + 1}`, polarity: "prefer" }))
  ];

  const normalized = normalizeTasteRules(raw);
  assert.equal(normalized.length, MAX_TASTE_RULES, "Caps normalized rules at 8");
  assert.equal(normalized[0].text, "No horror");
  assert.equal(normalized[0].pinned, true);
  assert.equal(normalized[0].active, true);
  assert.equal(normalized[1].text, "No horror");
  assert.equal(normalized[1].polarity, "prefer", "Different polarity counts as separate rule");
  assert.equal(normalized[2].text.length, MAX_RULE_TEXT_LENGTH, "Truncates rule text to 140 chars");
  assert.equal(normalized[2].active, false, "Preserves active=false flag");
  assert.equal(normalized.filter((r) => r.text.toLowerCase() === "no horror" && r.polarity === "avoid").length, 1);
});

test("extractRuleSignals prevents broad genre blacklist trap on qualified negations while extracting unqualified genres", () => {
  // Guardrail 2: qualified negations MUST NOT blacklist Drama (18) or Action (28) or War (10752)
  const slowPeriodDrama = extractRuleSignals("No slow-burn period dramas", "avoid");
  assert.equal(slowPeriodDrama.genreIds.includes(18), false, "Qualified 'No slow-burn period dramas' must NOT add Drama (18) to avoidGenreIds");
  assert.ok(slowPeriodDrama.keywords.includes("slow-burn period drama") || slowPeriodDrama.keywords.includes("period drama"));

  const cheesyAction = extractRuleSignals("Avoid cheesy action", "avoid");
  assert.equal(cheesyAction.genreIds.includes(28), false, "Qualified 'Avoid cheesy action' must NOT add Action (28) to avoidGenreIds");
  assert.ok(cheesyAction.keywords.includes("cheesy action"));

  // Unqualified negations MUST populate avoidGenreIds
  const unqualified = extractRuleSignals("No horror or musicals, avoid documentaries, skip westerns", "avoid");
  assert.deepEqual(unqualified.genreIds.sort((a, b) => a - b), [27, 37, 99, 10402]);

  const mixed = extractRuleSignals("No horror or gore", "avoid");
  assert.deepEqual(mixed.genreIds, [27]);
  assert.ok(mixed.keywords.includes("gore"));

  // Prefer rules safely extract genres alongside modifiers
  const preferSignals = extractRuleSignals("Prefer cyberpunk sci-fi thrillers", "prefer");
  assert.ok(preferSignals.genreIds.includes(878));
  assert.ok(preferSignals.keywords.length > 0);
});

test("candidateMatchesAvoidRule matches period dramas & war films via word boundaries without false-positiving Star Wars or award", () => {
  const [periodRule] = normalizeTasteRules([{ id: "a1", text: "No slow-burn period dramas", polarity: "avoid", active: true }]);
  const [warRule] = normalizeTasteRules([{ id: "a2", text: "Avoid war", polarity: "avoid", active: true }]);
  const { avoidRules } = compileActiveTasteRules([periodRule, warRule]);

  const periodMatch = candidateMatchesAvoidRule(
    {
      title: "A Slow Period Drama",
      genre: "History, Drama",
      tmdbGenreIds: [36, 18],
      plot: "A courtly slow-burn period drama set in 18th-century Vienna."
    },
    avoidRules
  );
  assert.equal(periodMatch.matched, true);
  assert.equal(periodMatch.matchedRuleText, "No slow-burn period dramas");

  // Contemporary drama should NOT be flagged by "No slow-burn period dramas"
  const modernDrama = candidateMatchesAvoidRule(
    {
      title: "City Shadows",
      genre: "Drama",
      tmdbGenreIds: [18],
      plot: "A modern courtroom thriller about journalists."
    },
    avoidRules
  );
  assert.equal(modernDrama.matched, false);

  // Word-boundary \bwar\b must NOT match "Wars" or "award" (both via rule text and direct keyword matching)
  const starWarsPayload = {
    title: "Star Wars: A New Hope",
    genre: "Adventure, Sci-Fi",
    tmdbGenreIds: [12, 878],
    plot: "An award-winning space opera following rebels in the galaxy."
  };
  assert.equal(candidateMatchesAvoidRule(starWarsPayload, avoidRules).matched, false, "\\bwar\\b must not match 'Star Wars' or 'award'");
  assert.equal(
    candidateMatchesAvoidRule(starWarsPayload, [{ id: "kw_war", text: "Avoid war scenes", polarity: "avoid", keywords: ["war"], genreIds: [], active: true }]).matched,
    false,
    "Keyword 'war' must strictly respect word boundaries vs 'Wars' and 'award'"
  );
  assert.equal(
    candidateMatchesAvoidRule(
      { title: "1917", genre: "Drama", tmdbGenreIds: [18], plot: "Two soldiers cross enemy lines during the war." },
      [{ id: "kw_war", text: "Avoid war scenes", polarity: "avoid", keywords: ["war"], genreIds: [], active: true }]
    ).matched,
    true,
    "Keyword 'war' must still match exact word 'war'"
  );

  const preferRules = normalizeTasteRules([{ id: "p1", text: "Prefer cyberpunk noir", polarity: "prefer", active: true }]);
  const preferHit = candidateMatchesPreferRule(
    { title: "Blade Runner 2049", genre: "Sci-Fi", plot: "A rain-slicked cyberpunk noir mystery." },
    preferRules
  );
  assert.equal(preferHit.matched, true);
});

test("buildTasteRulesHashSegment emits empty string when inactive and invalidates on edits/toggles", () => {
  assert.equal(buildTasteRulesHashSegment([]), "");
  assert.equal(buildTasteRulesHashSegment([{ id: "r1", text: "No horror", polarity: "avoid", active: false }]), "");

  const h1 = buildTasteRulesHashSegment([{ id: "r1", text: "No horror", polarity: "avoid", active: true }]);
  const h2 = buildTasteRulesHashSegment([{ id: "r1", text: "No horror", polarity: "avoid", active: true }]);
  const h3 = buildTasteRulesHashSegment([{ id: "r1", text: "No musicals", polarity: "avoid", active: true }]);
  assert.ok(h1.length > 0);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test("draftTasteRulesFallback and draftTasteRulesWithGemini work deterministically offline and avoid static circular geminiService imports", async () => {
  const source = fs.readFileSync(path.resolve("src/services/tasteRulesService.js"), "utf8");
  const topLevelImports = source
    .split("\n")
    .filter((line) => /^\s*import\s+/.test(line))
    .join("\n");
  assert.equal(/geminiService/.test(topLevelImports), false, "tasteRulesService must NOT statically import geminiService at top level");

  const watched = [
    {
      tmdbId: 10,
      title: "Ghost in the Shell",
      userRating: 10,
      userNote: "Loved cerebral cyberpunk philosophy and atmospheric animation",
      tmdbGenreIds: [878, 16],
      keywordNames: ["cyberpunk", "philosophy"]
    },
    {
      tmdbId: 11,
      title: "Akira",
      userRating: 9,
      userNote: "Intense sci-fi animation with cyberpunk worldbuilding",
      tmdbGenreIds: [878, 16],
      keywordNames: ["cyberpunk"]
    },
    {
      tmdbId: 12,
      title: "Gory Slasher",
      userRating: 2,
      userNote: "Way too much gore and cheap jumpscares",
      tmdbGenreIds: [27],
      keywordNames: ["gore", "slasher"]
    },
    {
      tmdbId: 13,
      title: "Torture Trap",
      userRating: 3,
      userNote: "Bleak gore torture horror",
      tmdbGenreIds: [27],
      keywordNames: ["gore", "bleak"]
    }
  ];

  const fallbackDrafts = draftTasteRulesFallback(
    watched,
    { lovedGenreNames: ["Sci-Fi", "Animation"] },
    [{ status: "dismissed", reason: "Too bleak", genres: "Horror" }]
  );
  assert.ok(fallbackDrafts.length >= 2, "Fallback synthesizer should produce at least 2 concrete rules");
  assert.ok(fallbackDrafts.some((r) => r.polarity === "prefer"));
  assert.ok(fallbackDrafts.some((r) => r.polarity === "avoid"));

  // Offline / null Gemini client falls back cleanly without throwing
  const offlineDrafts = await draftTasteRulesWithGemini(null, {
    watched,
    profile: { lovedGenreNames: ["Sci-Fi", "Animation"] },
    existingRules: [{ id: "pin1", text: "Prefer tight pacing under 130m", polarity: "prefer", pinned: true, active: true }]
  });
  assert.equal(offlineDrafts[0].id, "pin1", "Pinned existing rule is preserved first");
  assert.ok(offlineDrafts.length >= 2);

  // Mock Gemini runner produces structured validated rules while keeping pinned rules
  const mockedDrafts = await draftTasteRulesWithGemini(
    { models: { generateContent: async () => ({}) } },
    {
      watched,
      profile: { lovedGenreNames: ["Sci-Fi"] },
      existingRules: [{ id: "pin1", text: "Prefer tight pacing", polarity: "prefer", pinned: true, active: true }],
      geminiDeps: {
        executeCascade: async () => ({
          text: JSON.stringify({
            rules: [
              { text: "Prefer cyberpunk neo-noir mysteries", polarity: "prefer" },
              { text: "Avoid torture gore horror", polarity: "avoid" }
            ]
          })
        }),
        sanitizeAndParseJSON: (t) => JSON.parse(t),
        FAST_INTERACTIVE_CASCADE: ["mock-fast"],
        Type: { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING" }
      }
    }
  );
  assert.equal(mockedDrafts[0].id, "pin1");
  assert.ok(mockedDrafts.some((r) => r.text === "Prefer cyberpunk neo-noir mysteries" && r.polarity === "prefer"));
  assert.ok(mockedDrafts.some((r) => r.text === "Avoid torture gore horror" && r.polarity === "avoid"));
});
