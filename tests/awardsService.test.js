import test from "node:test";
import assert from "node:assert/strict";
import { parseAwardsSummary } from "../src/services/awardsService.js";

test("parseAwardsSummary returns null for missing, blank, or N/A inputs", () => {
  assert.equal(parseAwardsSummary(null), null);
  assert.equal(parseAwardsSummary(undefined), null);
  assert.equal(parseAwardsSummary(""), null);
  assert.equal(parseAwardsSummary("   "), null);
  assert.equal(parseAwardsSummary("N/A"), null);
  assert.equal(parseAwardsSummary("n/a"), null);
});

test("parseAwardsSummary extracts Oscar wins alongside total wins and nominations", () => {
  const res = parseAwardsSummary("Won 7 Oscars. 92 wins & 143 nominations total");
  assert.deepEqual(res, {
    raw: "Won 7 Oscars. 92 wins & 143 nominations total",
    oscarWins: 7,
    oscarNominations: 0,
    hasOscars: true,
    isOscarWinner: true,
    oscarLabel: "Won 7 Oscars",
    prestigeLabel: null,
    wins: 92,
    nominations: 143,
    totalLabel: "92 wins · 143 nominations",
    headline: null
  });
});

test("parseAwardsSummary handles singular Oscar win/nomination and legacy 'Another' phrasing", () => {
  const singleWin = parseAwardsSummary("Won 1 Oscar. 43 wins & 56 nominations total");
  assert.equal(singleWin.oscarWins, 1);
  assert.equal(singleWin.oscarLabel, "Won 1 Oscar");
  assert.equal(singleWin.totalLabel, "43 wins · 56 nominations");

  const singleNom = parseAwardsSummary("Nominated for 1 Oscar. Another 4 wins & 7 nominations.");
  assert.equal(singleNom.isOscarWinner, false);
  assert.equal(singleNom.hasOscars, true);
  assert.equal(singleNom.oscarNominations, 1);
  assert.equal(singleNom.oscarLabel, "1 Oscar nomination");
  assert.equal(singleNom.wins, 4);
  assert.equal(singleNom.nominations, 7);
  assert.equal(singleNom.totalLabel, "4 wins · 7 nominations");
});

test("parseAwardsSummary parses Golden Globe / BAFTA prestige headers and non-Oscar festival tallies", () => {
  const globes = parseAwardsSummary("Won 2 Golden Globes. 12 wins & 18 nominations total");
  assert.equal(globes.hasOscars, false);
  assert.equal(globes.prestigeLabel, "Won 2 Golden Globes");
  assert.equal(globes.totalLabel, "12 wins · 18 nominations");

  const general = parseAwardsSummary("3 wins & 12 nominations");
  assert.equal(general.hasOscars, false);
  assert.equal(general.oscarLabel, null);
  assert.equal(general.totalLabel, "3 wins · 12 nominations");

  const custom = parseAwardsSummary("Cannes Palme d'Or Winner");
  assert.equal(custom.headline, "Cannes Palme d'Or Winner");
});
