import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { ZIP_LIMITS, extractZipTextFiles } from "../src/services/zipReader.js";

function buildTestZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const payload = entry.data;
    const method = entry.method ?? 0;
    const uncompSize = entry.declaredSize ?? entry.uncompressedSize ?? payload.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncompSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
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
  eocd.writeUInt16LE(0, 20);

  const out = Buffer.concat([...localChunks, centralBuf, eocd]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

test("extractZipTextFiles extracts stored (method 0) and deflated (method 8) UTF-8 text files", async () => {
  const raw = Buffer.from("Name,Year,Rating\nArrival,2016,4.5\n", "utf8");
  const ab = buildTestZip([
    { name: "ratings.csv", data: raw, method: 0 },
    { name: "lists/sci-fi.csv", data: deflateRawSync(raw), method: 8, uncompressedSize: raw.length }
  ]);
  const files = await extractZipTextFiles(ab);
  assert.equal(files.size, 2);
  assert.match(files.get("ratings.csv"), /Arrival,2016,4\.5/);
  assert.match(files.get("lists/sci-fi.csv"), /Arrival,2016,4\.5/);
});

test("extractZipTextFiles rejects path traversal, excessive entries, and ZIP bombs exceeding maxUncompressedBytes", async () => {
  const traversal = buildTestZip([{ name: "../etc/passwd", data: Buffer.from("x"), method: 0 }]);
  await assert.rejects(() => extractZipTextFiles(traversal), /unsafe path/i);

  const oversized = buildTestZip([
    { name: "bomb.csv", data: Buffer.from("a"), method: 0, declaredSize: ZIP_LIMITS.maxUncompressedBytes + 1 }
  ]);
  await assert.rejects(() => extractZipTextFiles(oversized), /size limit/i);

  const manyEntries = buildTestZip(
    Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({
      name: `f${i}.csv`,
      data: Buffer.from("a"),
      method: 0
    }))
  );
  await assert.rejects(() => extractZipTextFiles(manyEntries), /entry limit/i);
});

test("extractZipTextFiles rejects encrypted entries and central directory entries extending past declared cdSize", async () => {
  const validBuf = buildTestZip([{ name: "ratings.csv", data: Buffer.from("a,b\n"), method: 0 }]);
  const encryptedBytes = new Uint8Array(validBuf.slice(0));
  const view = new DataView(encryptedBytes.buffer);
  // Central directory starts right after 30 + "ratings.csv".length (11) + 4 = 45
  const cdStart = 30 + 11 + 4;
  view.setUint16(cdStart + 8, 1, true); // set bit 0 general purpose flag (encrypted)
  await assert.rejects(() => extractZipTextFiles(encryptedBytes.buffer), /encrypted/i);

  const oobBytes = new Uint8Array(validBuf.slice(0));
  const oobView = new DataView(oobBytes.buffer);
  const eocdOffset = oobBytes.byteLength - 22;
  oobView.setUint32(eocdOffset + 12, 50, true); // shrink declared cdSize below 46 + nameLen
  await assert.rejects(() => extractZipTextFiles(oobBytes.buffer), /out of bounds/i);
});
