/**
 * Builds `public/models/games/game_edition_aliases.json` from live IGDB edition/remaster links.
 * Maps cold IGDB sibling IDs (Originals, Remasters, Definitive, Special, Enhanced, Director's Cut)
 * that sit outside `game_ease_k80.cvea` onto their canonical warm EASE^R neighbor ID.
 */
import fs from "node:fs";
import path from "node:path";
import { parseEaseBinary } from "../../src/services/easeService.js";

function loadEnvSecrets() {
  const envPath = path.join(process.cwd(), ".env");
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const cid = process.env.IGDB_CLIENT_ID || raw.match(/^IGDB_CLIENT_ID=(.+)$/m)?.[1]?.trim() || "";
  const csec = process.env.IGDB_CLIENT_SECRET || raw.match(/^IGDB_CLIENT_SECRET=(.+)$/m)?.[1]?.trim() || "";
  if (!cid || !csec) {
    throw new Error("Missing IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in environment or .env");
  }
  return { cid, csec };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queryIgdbBatch(cid, token, ids, attempt = 0) {
  const body = `fields id,name,game_type,parent_game,version_parent,remasters,remakes,expanded_games; where id = (${ids.join(",")}); limit 500;`;
  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": cid,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain"
    },
    body
  });
  if (res.status === 429 && attempt < 2) {
    await sleep(1100);
    return queryIgdbBatch(cid, token, ids, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`IGDB HTTP ${res.status}`);
  }
  return res.json();
}

async function main() {
  const { cid, csec } = loadEnvSecrets();
  const tokRes = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(csec)}&grant_type=client_credentials`,
    { method: "POST" }
  );
  if (!tokRes.ok) throw new Error(`Twitch OAuth HTTP ${tokRes.status}`);
  const { access_token: token } = await tokRes.json();

  const easePath = path.join(process.cwd(), "public/models/games/game_ease_k80.cvea");
  const buf = fs.readFileSync(easePath);
  const ease = parseEaseBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  const warmStrength = new Map();
  for (let idx = 0; idx < ease.count; idx++) {
    const id = ease.ids[idx];
    const base = idx * ease.K;
    let sum = 0;
    for (let k = 0; k < ease.K; k++) sum += Math.max(0, ease.nbrW[base + k] || 0);
    warmStrength.set(id, sum);
  }

  const warmIds = Array.from(ease.ids);
  const bestAlias = new Map(); // coldId -> { warmId, priority, strength }

  const consider = (coldId, warmId, priority) => {
    const cidNum = Number(coldId);
    if (!Number.isInteger(cidNum) || cidNum <= 0) return;
    if (ease.idToIndex.has(cidNum)) return; // never alias an ID already in warm graph
    const str = warmStrength.get(warmId) || 0;
    const prev = bestAlias.get(cidNum);
    if (!prev || priority > prev.priority || (priority === prev.priority && str > prev.strength)) {
      bestAlias.set(cidNum, { warmId, priority, strength: str });
    }
  };

  for (let i = 0; i < warmIds.length; i += 500) {
    const chunk = warmIds.slice(i, i + 500);
    const rows = await queryIgdbBatch(cid, token, chunk);
    for (const r of rows) {
      const w = Number(r?.id);
      if (!w || !ease.idToIndex.has(w)) continue;
      consider(r.parent_game, w, 4);
      consider(r.version_parent, w, 4);
      for (const s of r.expanded_games || []) consider(s, w, 3);
      for (const s of r.remasters || []) consider(s, w, 3);
      for (const s of r.remakes || []) consider(s, w, 2);
    }
    if (i + 500 < warmIds.length) await sleep(280);
  }

  const sortedEntries = [...bestAlias.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cidKey, val]) => [String(cidKey), val.warmId]);
  const outObj = Object.fromEntries(sortedEntries);
  const outPath = path.join(process.cwd(), "public/models/games/game_edition_aliases.json");
  fs.writeFileSync(outPath, JSON.stringify(outObj));

  console.log(`Built ${outPath} with ${sortedEntries.length} cold->warm edition aliases.`);
  const checks = [
    ["Skyrim (472)", "472", 19457],
    ["Dark Souls (2155)", "2155", 81085],
    ["Witcher 2 (478)", "478", 20740],
    ["Death Stranding (19564)", "19564", 152063],
    ["Divinity OS2 Def (103337)", "103337", 11800],
    ["L.A. Noire Remaster (59849)", "59849", 109]
  ];
  for (const [label, k, expected] of checks) {
    console.log(`  ${label.padEnd(28)} -> ${outObj[k] || "MISSING"} (expected ${expected})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
