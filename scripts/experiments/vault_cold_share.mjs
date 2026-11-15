import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const { parseEmbeddingBinary } = await imp("src/services/embeddingService.js");
const { getRecentReleaseDateFloor } = await imp("src/services/tmdbService.js");
const {
  RECENT_RELEASE_RESERVE_COUNT,
  RECENT_RELEASE_RESERVE_MONTHS,
  RECENT_RELEASE_MIN_PROB_PERCENTILE
} = await imp("src/services/geminiService.js");
const { parseJsonBackupContent } = await imp("src/services/vaultPortability.js");

export const DEFAULT_INDEX_PATH = "public/models/item_embeddings_f16.bin";
export const DEFAULT_INDEX_CUTOFF_DATE = "2023-10-13";
export const INDEX_CUTOFF_PROVENANCE =
  "MovieLens 32M (.data/ml-32m.zip -> ratings.csv max rating timestamp 2023-10-13T02:29:07+00:00 UTC; README.txt states ratings span Jan 09, 1995 to Oct 12, 2023 and the dataset was generated Oct 13, 2023). Cross-checking public/models/item_embeddings_f16.bin (25,000 TMDB IDs) against .data/ml-32m/links.csv shows max release year 2023 (142 titles in 2023, 0 in >=2024).";

// Mirrors Bucket D & recent-release reserve constants in
// src/services/tmdbService.js, src/services/geminiService.js, and src/services/rankerService.js
export const BUCKET_D_CONSTANTS = Object.freeze({
  windowMonths: 18,
  sortBy: "popularity.desc",
  voteCountGte: 150,
  voteAverageGte: 7.0,
  includeAdult: false,
  maxResults: 12,
  topLovedGenresLimit: 3,
  source: "src/services/tmdbService.js (buildBucketDParams, fetchBucketD, getRecentReleaseDateFloor)"
});

export const RESERVE_CONSTANTS = Object.freeze({
  count: RECENT_RELEASE_RESERVE_COUNT,
  windowMonths: RECENT_RELEASE_RESERVE_MONTHS,
  minProbabilityPercentile: RECENT_RELEASE_MIN_PROB_PERCENTILE,
  absMinProbability: 0.54,
  sortCriterion: "computeReserveQualityScore (ranker logit with noveltyBonus = 0)",
  source: "src/services/geminiService.js & src/services/rankerService.js (selectWithReserve)"
});

export function extractNumericTmdbId(movie = {}) {
  const direct = Number(movie?.tmdbId);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const rawId = movie?.id;
  if (typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0) return rawId;
  const m = String(rawId ?? "").trim().match(/^(?:tmdb_)?(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

export function extractWatchYear(movie = {}) {
  const candidates = [movie?.dateWatched, movie?.addedAt, movie?.watchedDate, movie?.createdAt];
  for (const raw of candidates) {
    if (!raw) continue;
    const str = String(raw).trim();
    const ym = str.match(/^(\d{4})/);
    if (ym) {
      const y = Number(ym[1]);
      if (y >= 1900 && y <= 2100) return String(y);
    }
    const ts = Date.parse(str);
    if (Number.isFinite(ts)) {
      return String(new Date(ts).getUTCFullYear());
    }
  }
  return "Unknown";
}

/**
 * Determines whether a film was released strictly after `cutoffDate` (`YYYY-MM-DD`).
 * Falls back to release year when month/day are absent: `year > cutoffYear` -> true,
 * `year < cutoffYear` -> false, same year without month/day -> ambiguous (returns false, marked ambiguous).
 */
export function classifyReleaseVsCutoff(movie = {}, cutoffDate = DEFAULT_INDEX_CUTOFF_DATE) {
  const cutoffYear = Number(String(cutoffDate).slice(0, 4));
  const rawFull = String(movie?.release_date ?? movie?.releaseDate ?? "").trim();
  const fullMatch = rawFull.match(/^(\d{4}-\d{2}-\d{2})/);
  if (fullMatch) {
    return {
      isPostCutoff: fullMatch[1] > cutoffDate,
      hasReleaseInfo: true,
      ambiguousSameYearNoDay: false
    };
  }

  const rawYear = movie?.year ?? movie?.Year ?? rawFull;
  const yearMatch = String(rawYear ?? "").match(/\b(\d{4})\b/);
  if (yearMatch) {
    const yr = Number(yearMatch[1]);
    if (yr > cutoffYear) {
      return { isPostCutoff: true, hasReleaseInfo: true, ambiguousSameYearNoDay: false };
    }
    if (yr < cutoffYear) {
      return { isPostCutoff: false, hasReleaseInfo: true, ambiguousSameYearNoDay: false };
    }
    return { isPostCutoff: false, hasReleaseInfo: true, ambiguousSameYearNoDay: true };
  }

  return { isPostCutoff: false, hasReleaseInfo: false, ambiguousSameYearNoDay: false };
}

export function computeColdUncoveredWindow({
  today = new Date().toISOString().slice(0, 10),
  cutoffDate = DEFAULT_INDEX_CUTOFF_DATE,
  bucketDMonths = BUCKET_D_CONSTANTS.windowMonths,
  reserveMonths = RESERVE_CONSTANTS.windowMonths
} = {}) {
  const parsedToday = Date.parse(`${today}T00:00:00Z`);
  const todayMs = Number.isFinite(parsedToday) ? parsedToday : Date.now();
  const todayIso = new Date(todayMs).toISOString().slice(0, 10);
  const bucketDFloor = getRecentReleaseDateFloor(bucketDMonths, todayMs);
  const reserveFloor = getRecentReleaseDateFloor(reserveMonths, todayMs);
  const effectiveCoveredFloor = bucketDFloor <= reserveFloor ? bucketDFloor : reserveFloor;

  const startMs = Date.parse(`${cutoffDate}T00:00:00Z`);
  const endMs = Date.parse(`${effectiveCoveredFloor}T00:00:00Z`);
  const gapDays =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? Math.round((endMs - startMs) / 86400000)
      : 0;

  return {
    today: todayIso,
    indexCutoffDate: cutoffDate,
    bucketDFloorDate: bucketDFloor,
    reserveFloorDate: reserveFloor,
    uncoveredAfterDate: cutoffDate,
    uncoveredBeforeDate: effectiveCoveredFloor,
    uncoveredIntervalNotation: `(${cutoffDate}, ${effectiveCoveredFloor})`,
    uncoveredApproxDays: gapDays,
    uncoveredApproxMonths: Number((gapDays / 30.4375).toFixed(1))
  };
}

/**
 * Analyzes a parsed (or raw) Schema v2 vault export and reports, by watch year,
 * the fraction of >=minRating watched films that are NOT in `indexIds` OR
 * were released strictly after `cutoffDate`.
 */
export function analyzeVaultColdShare(
  vaultInput,
  indexIds = new Set(),
  options = {}
) {
  const {
    minRating = 8,
    cutoffDate = DEFAULT_INDEX_CUTOFF_DATE,
    today = new Date().toISOString().slice(0, 10)
  } = options;

  let watched = [];
  if (typeof vaultInput === "string") {
    watched = parseJsonBackupContent(vaultInput).watched;
  } else if (vaultInput && Array.isArray(vaultInput.watched)) {
    watched = vaultInput.watched;
  } else if (Array.isArray(vaultInput)) {
    watched = vaultInput;
  } else {
    throw new Error("Vault payload must be a Schema v2 JSON export ({ watched: [...] }).");
  }

  const byYearMap = new Map();
  let totalWatched = watched.length;
  let totalRatedQualified = 0;
  let totalColdUnion = 0;
  let totalNotInIndex = 0;
  let totalPostCutoff = 0;
  let missingTmdbIdCount = 0;
  let missingReleaseInfoCount = 0;
  let ambiguousSameYearCount = 0;

  for (const movie of watched) {
    const rating = Number(movie?.userRating ?? movie?.UserRating ?? movie?.rating ?? 0);
    if (!Number.isFinite(rating) || rating < minRating) continue;

    totalRatedQualified++;
    const watchYear = extractWatchYear(movie);
    if (!byYearMap.has(watchYear)) {
      byYearMap.set(watchYear, {
        watchYear,
        count: 0,
        coldCount: 0,
        notInIndexCount: 0,
        postCutoffCount: 0,
        missingTmdbIdCount: 0
      });
    }
    const bucket = byYearMap.get(watchYear);
    bucket.count++;

    const tmdbId = extractNumericTmdbId(movie);
    const inIndex = tmdbId !== null && indexIds.has(tmdbId);
    const notInIndex = !inIndex;
    if (tmdbId === null) {
      missingTmdbIdCount++;
      bucket.missingTmdbIdCount++;
    }

    const relClass = classifyReleaseVsCutoff(movie, cutoffDate);
    if (!relClass.hasReleaseInfo) missingReleaseInfoCount++;
    if (relClass.ambiguousSameYearNoDay) ambiguousSameYearCount++;

    const isPostCutoff = relClass.isPostCutoff;
    const isCold = notInIndex || isPostCutoff;

    if (notInIndex) {
      totalNotInIndex++;
      bucket.notInIndexCount++;
    }
    if (isPostCutoff) {
      totalPostCutoff++;
      bucket.postCutoffCount++;
    }
    if (isCold) {
      totalColdUnion++;
      bucket.coldCount++;
    }
  }

  const byWatchYear = [...byYearMap.values()]
    .sort((a, b) => {
      if (a.watchYear === "Unknown") return 1;
      if (b.watchYear === "Unknown") return -1;
      return Number(a.watchYear) - Number(b.watchYear);
    })
    .map(row => ({
      ...row,
      coldFraction: row.count > 0 ? row.coldCount / row.count : 0,
      notInIndexFraction: row.count > 0 ? row.notInIndexCount / row.count : 0,
      postCutoffFraction: row.count > 0 ? row.postCutoffCount / row.count : 0
    }));

  return {
    schemaVersionDetected: vaultInput?.schemaVersion ?? null,
    minRating,
    indexSize: indexIds.size,
    cutoffDate,
    cutoffProvenance: INDEX_CUTOFF_PROVENANCE,
    bucketD: BUCKET_D_CONSTANTS,
    reserve: RESERVE_CONSTANTS,
    uncoveredWindow: computeColdUncoveredWindow({ today, cutoffDate }),
    summary: {
      totalWatched,
      totalQualified: totalRatedQualified,
      coldCount: totalColdUnion,
      coldFraction: totalRatedQualified > 0 ? totalColdUnion / totalRatedQualified : 0,
      notInIndexCount: totalNotInIndex,
      notInIndexFraction: totalRatedQualified > 0 ? totalNotInIndex / totalRatedQualified : 0,
      postCutoffCount: totalPostCutoff,
      postCutoffFraction: totalRatedQualified > 0 ? totalPostCutoff / totalRatedQualified : 0,
      missingTmdbIdCount,
      missingReleaseInfoCount,
      ambiguousSameYearCount
    },
    byWatchYear
  };
}

export function formatVaultColdReport(report, vaultPath = null) {
  const lines = [
    "# Schema v2 Vault Cold-Item Share & Recent-Window Analysis",
    "",
    `- Index Cutoff Date Assumed: \`${report.cutoffDate}\``,
    `- Cutoff Provenance: ${report.cutoffProvenance}`,
    `- Embedding Index Entries Loaded: \`${report.indexSize}\``,
    `- Bucket D Constants (\`${report.bucketD.source}\`): window = \`${report.bucketD.windowMonths}\` months (\`primary_release_date.gte = ${report.uncoveredWindow.bucketDFloorDate}\` as of \`${report.uncoveredWindow.today}\`), \`sort_by = ${report.bucketD.sortBy}\`, \`vote_count.gte = ${report.bucketD.voteCountGte}\`, \`vote_average.gte = ${report.bucketD.voteAverageGte}\`, \`maxResults = ${report.bucketD.maxResults}\`, top \`${report.bucketD.topLovedGenresLimit}\` loved genres OR`,
    `- Reserve Window Constants (\`${report.reserve.source}\`): \`RECENT_RELEASE_RESERVE_COUNT = ${report.reserve.count}\`, \`RECENT_RELEASE_RESERVE_MONTHS = ${report.reserve.windowMonths}\` (\`minReleaseDate = ${report.uncoveredWindow.reserveFloorDate}\` as of \`${report.uncoveredWindow.today}\`), \`RECENT_RELEASE_MIN_PROB_PERCENTILE = ${report.reserve.minProbabilityPercentile}\`, \`absMinProbability = ${report.reserve.absMinProbability}\``,
    `- Implied Cold-but-Uncovered Release Window (as of \`${report.uncoveredWindow.today}\`): \`${report.uncoveredWindow.uncoveredIntervalNotation}\` (~${report.uncoveredWindow.uncoveredApproxDays} days / ~${report.uncoveredWindow.uncoveredApproxMonths} months — released after the \`${report.cutoffDate}\` ML-32M cutoff yet before the \`${report.uncoveredWindow.uncoveredBeforeDate}\` 18-month Bucket D / Reserve floor).`
  ];

  if (vaultPath) {
    lines.push(`- Vault File: \`${vaultPath}\` (total watched: \`${report.summary.totalWatched}\`, \`>=${report.minRating}★\` films: \`${report.summary.totalQualified}\`)`);
  }
  lines.push("");

  if (report.summary.totalQualified > 0 || vaultPath) {
    lines.push(
      `## \`>=${report.minRating}★\` Cold Share by Watch Year (Not in Index OR Release Date > \`${report.cutoffDate}\`)`,
      "",
      "| Watch Year | `>=8★` Films | Not in `.bin` | Released > Cutoff | Combined Cold | Cold Share | Missing TMDB ID |",
      "| :--- | :---: | :---: | :---: | :---: | :---: | :---: |"
    );
    for (const r of report.byWatchYear) {
      lines.push(
        `| ${r.watchYear} | ${r.count} | ${r.notInIndexCount} (${(r.notInIndexFraction * 100).toFixed(1)}%) | ${r.postCutoffCount} (${(r.postCutoffFraction * 100).toFixed(1)}%) | ${r.coldCount} | **${(r.coldFraction * 100).toFixed(1)}%** | ${r.missingTmdbIdCount} |`
      );
    }
    const s = report.summary;
    lines.push(
      `| **ALL** | **${s.totalQualified}** | **${s.notInIndexCount} (${(s.notInIndexFraction * 100).toFixed(1)}%)** | **${s.postCutoffCount} (${(s.postCutoffFraction * 100).toFixed(1)}%)** | **${s.coldCount}** | **${(s.coldFraction * 100).toFixed(1)}%** | **${s.missingTmdbIdCount}** |`
    );
    if (s.missingReleaseInfoCount > 0 || s.ambiguousSameYearCount > 0) {
      lines.push(
        "",
        `- Notes: \`${s.missingReleaseInfoCount}\` film(s) lacked release date/year metadata; \`${s.ambiguousSameYearCount}\` film(s) had cutoff year \`${report.cutoffDate.slice(0, 4)}\` without month/day.`
      );
    }
  } else {
    lines.push("Pass `--vault <path-to-schema-v2-export.json>` to compute per-watch-year cold fractions on a Schema v2 vault export.");
  }

  lines.push("");
  return lines.join("\n");
}

function parseCliArgs(argv = []) {
  const opts = {
    vaultPath: null,
    binPath: DEFAULT_INDEX_PATH,
    cutoffDate: DEFAULT_INDEX_CUTOFF_DATE,
    today: new Date().toISOString().slice(0, 10),
    minRating: 8,
    json: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault" && argv[i + 1]) opts.vaultPath = argv[++i];
    else if (a === "--bin" && argv[i + 1]) opts.binPath = argv[++i];
    else if (a === "--cutoff" && argv[i + 1]) opts.cutoffDate = argv[++i];
    else if (a === "--today" && argv[i + 1]) opts.today = argv[++i];
    else if (a === "--min-rating" && argv[i + 1]) opts.minRating = Number(argv[++i]);
    else if (a === "--json") opts.json = true;
    else if (!a.startsWith("-") && !opts.vaultPath) opts.vaultPath = a;
  }
  return opts;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const resolvedBin = path.resolve(ROOT, opts.binPath);
  const binBuf = fs.readFileSync(resolvedBin);
  const emb = parseEmbeddingBinary(binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength));
  const indexIds = new Set(Array.from(emb.ids));

  let report;
  let resolvedVault = null;
  if (opts.vaultPath) {
    resolvedVault = path.resolve(process.cwd(), opts.vaultPath);
    const rawContent = fs.readFileSync(resolvedVault, "utf8");
    const parsedJson = JSON.parse(rawContent);
    report = analyzeVaultColdShare(
      { ...parsedJson, watched: parseJsonBackupContent(rawContent).watched },
      indexIds,
      {
        minRating: opts.minRating,
        cutoffDate: opts.cutoffDate,
        today: opts.today
      }
    );
  } else {
    report = analyzeVaultColdShare({ watched: [] }, indexIds, {
      minRating: opts.minRating,
      cutoffDate: opts.cutoffDate,
      today: opts.today
    });
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatVaultColdReport(report, resolvedVault));
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}
