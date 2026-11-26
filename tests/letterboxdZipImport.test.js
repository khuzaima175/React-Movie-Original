import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { parseLetterboxdListCsv, parseLetterboxdZipArchive } from "../src/services/letterboxdZipImport.js";

function buildZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const rawBuf = Buffer.from(entry.text, "utf8");
    const payload = deflateRawSync(rawBuf);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(rawBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(rawBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    localChunks.push(local, payload);
    centralChunks.push(central);
    offset += local.length + payload.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  const out = Buffer.concat([...localChunks, centralBuf, eocd]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

test("parseLetterboxdListCsv parses Letterboxd 3-line metadata header + blank line + list rows", () => {
  const csv = [
    "Letterboxd list export v7",
    "Date,Name,Tags,URL,Description",
    '2026-01-10,Late Night Neo-Noir,noir,https://boxd.it/123,"Rainy detective cinema, shadows"',
    "",
    "Position,Name,Year,URL,Description",
    "1,Blade Runner,1982,https://boxd.it/a,",
    "2,Chinatown,1974,https://boxd.it/b,"
  ].join("\n");
  const list = parseLetterboxdListCsv(csv, "fallback");
  assert.equal(list.name, "Late Night Neo-Noir");
  assert.equal(list.description, "Rainy detective cinema, shadows");
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].title, "Blade Runner");
  assert.equal(list.items[1].year, "1974");
});

test("parseLetterboxdZipArchive merges watched, ratings, reviews, diary, watchlist, and lists while ignoring deleted/", async () => {
  const mockZipBuffer = buildZip([
    {
      name: "watched.csv",
      text: "Date,Name,Year,Letterboxd URI\n2025-05-01,Arrival,2016,https://boxd.it/a1\n2025-06-01,Unrated Film,2020,https://boxd.it/u1\n"
    },
    {
      name: "ratings.csv",
      text: "Date,Name,Year,Letterboxd URI,Rating\n2025-05-01,Arrival,2016,https://boxd.it/a1,4.5\n"
    },
    {
      name: "reviews.csv",
      text: 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2025-05-01,Arrival,2016,https://boxd.it/a1,4.5,Yes,"A linguistic sci-fi masterpiece.",sci-fi,2025-05-01\n'
    },
    {
      name: "diary.csv",
      text: "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2025-01-10,Arrival,2016,https://boxd.it/a1,4.0,,first watch,2025-01-10\n2025-05-01,Arrival,2016,https://boxd.it/a1,4.5,Yes,rewatch,2025-05-01\n"
    },
    {
      name: "watchlist.csv",
      text: "Date,Name,Year,Letterboxd URI\n2025-08-01,Arrival,2016,https://boxd.it/a1\n2025-08-02,Dune: Part Two,2024,https://boxd.it/d2\n"
    },
    {
      name: "lists/top-scifi.csv",
      text: "Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2025-02-01,Top Sci-Fi,sci-fi,https://boxd.it/l1,Essential sci-fi\n\nPosition,Name,Year,URL,Description\n1,Arrival,2016,https://boxd.it/a1,\n"
    },
    {
      name: "deleted/old-list.csv",
      text: "Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2024-01-01,Deleted List,,https://boxd.it/old,\n\nPosition,Name,Year,URL,Description\n1,Old Film,2000,https://boxd.it/o,\n"
    }
  ]);

  const result = await parseLetterboxdZipArchive(mockZipBuffer);
  assert.equal(result.stats.listCount, 1);
  assert.equal(result.incomingWatchlist.length, 1);
  assert.equal(result.incomingWatchlist[0].title, "Dune: Part Two");

  const arrival = result.incomingWatched.find((m) => m.title === "Arrival");
  assert.ok(arrival);
  assert.equal(arrival.userRating, 9);
  assert.match(arrival.userNote, /masterpiece/i);
  assert.ok(arrival.dateWatched);
  assert.equal(Array.isArray(arrival.watchHistory) && arrival.watchHistory.length, 2);
});
