import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = "g:/Important Projects/movie-ratings";

console.log("Loading ml-latest-small ratings...");
const ratingsLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8").split("\n").filter(Boolean).slice(1);
const userRatings = new Map();
const benchmarkUserIds = new Set(["89", "263", "409", "561"]);

ratingsLines.forEach(l => {
  const [uid, mid, r, ts] = l.trim().split(",");
  if (benchmarkUserIds.has(uid)) return;
  if (!userRatings.has(uid)) userRatings.set(uid, []);
  userRatings.get(uid).push({ mid, r, ts: Number(ts) });
});

const eligibleUsers = [];
for (const [uid, list] of userRatings.entries()) {
  if (list.length < 60) continue;
  list.sort((a, b) => a.ts - b.ts);
  const pos = list.filter(x => Number(x.r) * 2 >= 8);
  if (pos.length >= 15) eligibleUsers.push(uid);
}
eligibleUsers.sort((a, b) => Number(a) - Number(b));
console.log(`Eligible users: ${eligibleUsers.length}`);

// Index tuples: movieId:rating:timestamp -> array of uids
const tupleToUsers = new Map();
let totalRatings = 0;
for (const uid of eligibleUsers) {
  const list = userRatings.get(uid);
  totalRatings += list.length;
  for (const item of list) {
    const key = `${item.mid}:${item.r}:${item.ts}`;
    if (!tupleToUsers.has(key)) tupleToUsers.set(key, []);
    tupleToUsers.get(key).push(uid);
  }
}
console.log(`Unique rating tuples to search: ${tupleToUsers.size} across ${totalRatings} total ratings.`);

const start = Date.now();
console.log("Streaming .data/ml-32m/ratings.csv...");
const fileStream = fs.createReadStream(path.join(root, ".data/ml-32m/ratings.csv"));
const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

let lineIdx = 0;
let matchedRatings = 0;
const matchedUsers = new Map(); // uid -> count of matched ratings

for await (const line of rl) {
  lineIdx++;
  if (lineIdx === 1) continue; // header
  const firstComma = line.indexOf(",");
  const rest = line.slice(firstComma + 1); // movieId,rating,timestamp
  const [mid, r, ts] = rest.split(",");
  const lookupKey = `${mid}:${r}:${ts}`;
  const uids = tupleToUsers.get(lookupKey);
  if (uids) {
    matchedRatings++;
    for (const uid of uids) {
      matchedUsers.set(uid, (matchedUsers.get(uid) || 0) + 1);
    }
  }
}

const elapsed = (Date.now() - start) / 1000;
console.log(`Scanned ${lineIdx} lines in ${elapsed.toFixed(1)}s.`);
console.log(`Matched ratings in 32M: ${matchedRatings}`);
console.log(`Matched users: ${matchedUsers.size} / ${eligibleUsers.length} (${(matchedUsers.size / eligibleUsers.length * 100).toFixed(2)}%)`);

// Save overlap classification to .data/overlap_users.json
const overlapData = {
  totalEligible: eligibleUsers.length,
  totalRatings,
  matchedUsersCount: matchedUsers.size,
  matchedRatingsCount: matchedRatings,
  overlapUserIds: Array.from(matchedUsers.keys()),
  noOverlapUserIds: eligibleUsers.filter(uid => !matchedUsers.has(uid)),
  matchedPerUser: Object.fromEntries(matchedUsers.entries())
};
fs.writeFileSync(path.join(root, ".data/overlap_users.json"), JSON.stringify(overlapData, null, 2));
console.log("Saved overlap data to .data/overlap_users.json");
