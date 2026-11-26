import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAwardsSummary,
  normalizeWikidataAwardsClaims
} from "../src/services/awardsService.js";
import awardsHandler from "../api/awards.js";

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

test("normalizeWikidataAwardsClaims deduplicates won+nominated overlap, prioritizes Oscars, and formats recipients", () => {
  const wonClaims = [
    {
      mainsnak: { datavalue: { value: { id: "Q102427" } } },
      qualifiers: {
        P585: [{ datavalue: { value: { time: "+2004-02-29T00:00:00Z" } } }],
        P805: [{ datavalue: { value: { id: "Q429309" } } }],
        P1346: [{ datavalue: { value: { id: "Q4465" } } }]
      }
    },
    {
      mainsnak: { datavalue: { value: { id: "Q103360" } } },
      qualifiers: {
        P585: [{ datavalue: { value: { time: "+2004-02-29T00:00:00Z" } } }],
        P805: [{ datavalue: { value: { id: "Q429309" } } }],
        P1346: [{ datavalue: { value: { id: "Q4465" } } }]
      }
    }
  ];
  // Duplicate nomination for Best Director (same year) + a pure BAFTA nomination
  const nominatedClaims = [
    {
      mainsnak: { datavalue: { value: { id: "Q103360" } } },
      qualifiers: {
        P585: [{ datavalue: { value: { time: "+2004-02-29T00:00:00Z" } } }],
        P805: [{ datavalue: { value: { id: "Q429309" } } }],
        P2453: [{ datavalue: { value: { id: "Q4465" } } }]
      }
    },
    {
      mainsnak: { datavalue: { value: { id: "Q787131" } } },
      qualifiers: {
        P585: [{ datavalue: { value: { time: "+2004-02-15T00:00:00Z" } } }],
        P805: [{ datavalue: { value: { id: "Q161920" } } }]
      }
    }
  ];
  const labels = {
    Q102427: "Academy Award for Best Picture",
    Q103360: "Academy Award for Best Director",
    Q429309: "76th Academy Awards",
    Q4465: "Peter Jackson",
    Q787131: "BAFTA Award for Best Film",
    Q161920: "57th British Academy Film Awards"
  };

  const out = normalizeWikidataAwardsClaims({ wonClaims, nominatedClaims, labels });
  assert.equal(out.totalWins, 2);
  assert.equal(out.totalNominations, 1);
  assert.equal(out.groups.length, 2);
  assert.equal(out.groups[0].title, "76th Academy Awards");
  assert.equal(out.groups[0].isOscar, true);
  assert.equal(out.groups[0].year, 2004);
  assert.deepEqual(
    out.groups[0].items.map((i) => ({ category: i.category, outcome: i.outcome, recipients: i.recipients })),
    [
      { category: "Best Director", outcome: "won", recipients: ["Peter Jackson"] },
      { category: "Best Picture", outcome: "won", recipients: ["Peter Jackson"] }
    ]
  );
  assert.equal(out.groups[1].title, "57th British Academy Film Awards");
  assert.equal(out.groups[1].items[0].category, "Best Film");
  assert.equal(out.groups[1].items[0].outcome, "nominated");
});

test("api/awards handler rejects invalid params and returns cached normalized Wikidata awards", async () => {
  function makeRes() {
    const headers = {};
    let statusCode = 200;
    let body = null;
    return {
      setHeader(k, v) { headers[k] = v; },
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; },
      get result() { return { statusCode, headers, body }; }
    };
  }

  const badRes = makeRes();
  await awardsHandler({ method: "GET", query: { imdb: "bad-id" }, headers: {} }, badRes);
  assert.equal(badRes.result.statusCode, 400);

  const mockFetch = async (url) => {
    if (url.includes("list=search")) {
      return { ok: true, json: async () => ({ query: { search: [{ title: "Q131074" }] } }) };
    }
    if (url.includes("property=P166")) {
      return {
        ok: true,
        json: async () => ({
          claims: {
            P166: [
              {
                mainsnak: { datavalue: { value: { id: "Q102427" } } },
                qualifiers: {
                  P585: [{ datavalue: { value: { time: "+2004-02-29T00:00:00Z" } } }],
                  P805: [{ datavalue: { value: { id: "Q429309" } } }]
                }
              }
            ]
          }
        })
      };
    }
    if (url.includes("property=P1411")) {
      return { ok: true, json: async () => ({ claims: {} }) };
    }
    return {
      ok: true,
      json: async () => ({
        entities: {
          Q102427: { labels: { en: { value: "Academy Award for Best Picture" } } },
          Q429309: { labels: { en: { value: "76th Academy Awards" } } }
        }
      })
    };
  };

  const okRes = makeRes();
  await awardsHandler(
    { method: "GET", query: { imdb: "tt0167260" }, headers: {}, fetchFn: mockFetch },
    okRes
  );
  assert.equal(okRes.result.statusCode, 200);
  assert.match(okRes.result.headers["Cache-Control"] || "", /s-maxage=604800/);
  assert.equal(okRes.result.body.status, "ok");
  assert.equal(okRes.result.body.totalWins, 1);
  assert.equal(okRes.result.body.groups[0].items[0].category, "Best Picture");
});
