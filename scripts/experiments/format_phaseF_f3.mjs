import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const report = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/phaseF_f3_e2e_report.json"), "utf8"));

console.log("Key presence:", JSON.stringify(report.keyPresence));
console.log("Embedding index:", JSON.stringify(report.embeddingIndex));
console.log("Generated at:", report.generatedAt);

for (const v of report.vaults) {
  const b = v.baselineLiked;
  console.log(
    `\n================================================================================\nVAULT ${v.name}: watched=${b.watchedCount}, liked(>=8)=${b.likedCount}, pre1980=${b.pre1980Count}/${b.validYearCount} (${(b.pre1980Share * 100).toFixed(1)}%), >=2024=${b.ge2024Count}`
  );
  for (const r of v.runs) {
    const u = r.usageMetadata || {};
    console.log(
      `\n--- ${v.name} | ${r.setting} #${r.repeat} | model=${r.model} | latency=${r.latencyMs}ms | reserve=${JSON.stringify(r.reserveResolved)} ---`
    );
    console.log(
      `Tokens: prompt=${u.promptTokenCount}, candidates=${u.candidatesTokenCount}, thoughts=${u.thoughtsTokenCount}, total=${u.totalTokenCount}`
    );
    console.log(`Pool (${r.poolTotal}): ${JSON.stringify(r.poolByBucket)}`);
    console.log(
      `Top 15 summary: >=2024=${r.top15Ge2024Count}, <1980=${r.top15Lt1980Count}/${r.top15ValidYearCount} (${(r.top15Lt1980Share * 100).toFixed(1)}%), buckets=${JSON.stringify(r.top15ByBucket)}`
    );
    for (const item of r.top15) {
      console.log(
        `  #${String(item.rank).padStart(2)} | ${item.year ?? "N/A"} | ${item.sourceBucket} | p=${item.rankerProbability} | ${item.title}`
      );
    }
    console.log(`Final 6 (>=2024=${r.final6Ge2024Count}, <1980=${r.final6Lt1980Count}):`);
    for (const pick of r.final6) {
      console.log(
        `  F#${pick.rank} | ${pick.year ?? "N/A"} | ${pick.sourceBucket} | match=${pick.matchScore} | ${pick.title}`
      );
    }
  }
}
