import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMovieCardsFromText,
  parseChatMessageBlocks,
  buildCompanionStarterPrompts,
  buildCompanionFollowUpPrompts,
  partitionChatMovieCards
} from "../src/services/chatCardHelpers.js";

test("parseMovieCardsFromText extracts up to 8 unique bold or quoted films with years", () => {
  const reply = [
    "Here are 5 picks:",
    "1. **Arrival** (2016) — slow-burn tension.",
    "2. **Source Code** (2011) — crisp sci-fi thriller.",
    "3. \"Coherence\" (2013) — dinner-party puzzle box.",
    "4. **Tenet** (2020) — temporal espionage.",
    "5. **Dark City** (1998) — neo-noir mystery.",
    "6. **Arrival** (2016) — duplicate mention ignored.",
    "7. **Memento** (2000) — memory noir."
  ].join("\n");

  const cards = parseMovieCardsFromText(reply);
  assert.equal(cards.length, 6);
  assert.deepEqual(
    cards.map((c) => `${c.title} (${c.year})`),
    [
      "Arrival (2016)",
      "Source Code (2011)",
      "Coherence (2013)",
      "Tenet (2020)",
      "Dark City (1998)",
      "Memento (2000)"
    ]
  );

  assert.equal(parseMovieCardsFromText(reply, 5).length, 5);
});

test("parseChatMessageBlocks separates paragraphs, headings, bullet lists, and numbered lists cleanly", () => {
  const text = [
    "### Top Picks",
    "",
    "Based on your 10/10 for Interstellar:",
    "",
    "1. **Arrival** (2016) — contemplative sci-fi",
    "2. **Contact** (1997) — grounded first contact",
    "",
    "- Both avoid hollow action.",
    "- Both center human grief."
  ].join("\n");

  const blocks = parseChatMessageBlocks(text);
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].text, "Top Picks");
  assert.equal(blocks[1].type, "paragraph");
  assert.equal(blocks[2].type, "ol");
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].type, "ul");
  assert.equal(blocks[3].items.length, 2);
});

test("buildCompanionStarterPrompts personalizes starters to watched favorites and watchlist without emoji", () => {
  const watched = [
    { title: "Interstellar", userRating: 10 },
    { title: "Parasite", userRating: 9 },
    { title: "The Dark Knight", userRating: 9 }
  ];
  const watchlist = [{ title: "Arrival" }, { title: "Se7en" }];
  const prompts = buildCompanionStarterPrompts({ watched, watchlist });

  assert.equal(prompts.length, 4);
  assert.ok(prompts.some((p) => p.includes("Interstellar")));
  assert.ok(prompts.some((p) => p.includes("Watchlist")));
  for (const p of prompts) {
    assert.equal(/\p{Extended_Pictographic}/u.test(p), false);
  }
});

test("buildCompanionFollowUpPrompts adapts follow-up chips cleanly", () => {
  const chips = buildCompanionFollowUpPrompts({
    watchedCount: 10,
    watchlistCount: 3,
    hasFocusedMovie: false
  });
  assert.ok(chips.length >= 2 && chips.length <= 4);
  assert.ok(chips.some((c) => /Watchlist/i.test(c)));
});

test("partitionChatMovieCards separates already-watched references into compact chips and keeps unseen films as recommendation cards", () => {
  const parsed = [
    { title: "Inception", year: "2010" },
    { title: "The Departed", year: "2006" },
    { title: "Catch Me If You Can", year: "2002" },
    { title: "Blood Diamond", year: "2006" }
  ];
  const watched = [
    { title: "Inception", year: "2010", imdbID: "tt1375666", userRating: 9 },
    { title: "The Departed", year: "2006", imdbID: "tt0407887", userRating: 8 }
  ];
  const { referenceChips, recommendedCards } = partitionChatMovieCards(parsed, watched, []);
  assert.deepEqual(referenceChips.map((c) => c.title), ["Inception", "The Departed"]);
  assert.equal(referenceChips[0].userRating, 9);
  assert.equal(referenceChips[0].imdbID, "tt1375666");
  assert.deepEqual(recommendedCards.map((c) => c.title), ["Catch Me If You Can", "Blood Diamond"]);
});
