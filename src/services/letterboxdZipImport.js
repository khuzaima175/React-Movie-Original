import { extractZipTextFiles } from "./zipReader.js";
import { parseCSVImport, parseCSVLine, parseImportDate, parseRating } from "./csvImport.js";
import { createCustomList } from "./listsService.js";
import { resolveCsvRowFallbackRecord } from "./vaultPortability.js";

function normalizeFilmKey(title = "", year = "") {
  const cleanTitle = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleanYear = String(year || "").replace(/\D/g, "").slice(0, 4);
  if (!cleanTitle) return "";
  return cleanYear ? `${cleanTitle}::${cleanYear}` : cleanTitle;
}

function isIgnoredArchivePath(path = "") {
  const lower = String(path || "").toLowerCase();
  const parts = lower.split("/");
  return parts.includes("deleted") || parts.includes("orphaned") || parts.some((p) => p.startsWith("."));
}

function findArchiveEntry(filesMap, targetFilename) {
  const target = targetFilename.toLowerCase();
  for (const [entryPath, text] of filesMap.entries()) {
    if (isIgnoredArchivePath(entryPath)) continue;
    const lower = entryPath.toLowerCase();
    if (lower === target || lower.endsWith(`/${target}`)) {
      return text;
    }
  }
  return null;
}

function findListEntries(filesMap) {
  const out = [];
  for (const [entryPath, text] of filesMap.entries()) {
    if (isIgnoredArchivePath(entryPath)) continue;
    const lower = entryPath.toLowerCase();
    if (!lower.endsWith(".csv")) continue;
    if (lower.startsWith("lists/") || lower.includes("/lists/")) {
      const base = entryPath.split("/").pop().replace(/\.csv$/i, "");
      out.push({ path: entryPath, fallbackName: base, text });
    }
  }
  return out;
}

/**
 * Extracts raw diary watch events (preserving multiple rewatches per film) from Letterboxd `diary.csv`.
 */
function extractRawDiaryHistory(diaryCsvText = "", now = Date.now()) {
  const historyMap = new Map();
  if (!diaryCsvText) return historyMap;
  const lines = String(diaryCsvText).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length <= 1) return historyMap;

  const headers = parseCSVLine(lines[0]).map((h) => h.replace(/^\uFEFF/, "").toLowerCase().trim());
  const titleIdx = headers.findIndex((h) => h === "name" || h === "title");
  const yearIdx = headers.findIndex((h) => h === "year");
  const ratingIdx = headers.findIndex((h) => h === "rating");
  const rewatchIdx = headers.findIndex((h) => h === "rewatch");
  const watchedDateIdx = headers.findIndex((h) => h === "watched date" || h === "date watched");
  const dateIdx = headers.findIndex((h) => h === "date");
  if (titleIdx === -1) return historyMap;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCSVLine(lines[i]);
    const title = cols[titleIdx] ? cols[titleIdx].replace(/^["']|["']$/g, "").trim() : "";
    if (!title) continue;
    const year = yearIdx !== -1 && cols[yearIdx] ? cols[yearIdx].replace(/\D/g, "") : "";
    const key = normalizeFilmKey(title, year);
    if (!key) continue;

    const rawDate =
      (watchedDateIdx !== -1 && cols[watchedDateIdx] ? cols[watchedDateIdx].trim() : "") ||
      (dateIdx !== -1 && cols[dateIdx] ? cols[dateIdx].trim() : "");
    const watchedAt = parseImportDate(rawDate, now);
    if (!watchedAt) continue;

    const rating = ratingIdx !== -1 && cols[ratingIdx] ? parseRating(cols[ratingIdx]) : 0;
    const rewatchRaw = rewatchIdx !== -1 && cols[rewatchIdx] ? cols[rewatchIdx].trim().toLowerCase() : "";
    const isRewatch = rewatchRaw === "yes" || rewatchRaw === "true" || rewatchRaw === "1";

    if (!historyMap.has(key)) historyMap.set(key, []);
    historyMap.get(key).push({
      id: `lb_${key}_${watchedAt.slice(0, 10)}_${i}`,
      watchedAt,
      format: "streaming",
      rating: rating > 0 ? rating : null,
      note: "",
      isRewatch
    });
  }

  for (const [key, list] of historyMap.entries()) {
    list.sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt));
    historyMap.set(key, list);
  }
  return historyMap;
}

/**
 * Parses a Letterboxd list export CSV (metadata block + blank line + item rows).
 */
export function parseLetterboxdListCsv(csvText = "", fallbackName = "Imported List") {
  const rawLines = String(csvText || "").split(/\r?\n/);
  const cleanedFallback = String(fallbackName || "Imported List").replace(/[-_]+/g, " ").trim();

  let listName = cleanedFallback || "Imported List";
  let listDescription = "";
  let itemsHeaderIdx = -1;

  for (let i = 0; i < rawLines.length; i += 1) {
    const trimmed = rawLines[i].trim();
    if (!trimmed) continue;
    const cols = parseCSVLine(trimmed).map((c) => c.replace(/^\uFEFF/, "").toLowerCase().trim());

    if (cols.includes("name") && cols.includes("url") && cols.includes("description") && !cols.includes("position")) {
      const nextLine = rawLines[i + 1] ? rawLines[i + 1].trim() : "";
      if (nextLine) {
        const metaCols = parseCSVLine(nextLine);
        const nameColIdx = cols.indexOf("name");
        const descColIdx = cols.indexOf("description");
        if (nameColIdx !== -1 && metaCols[nameColIdx]) {
          listName = metaCols[nameColIdx].trim() || listName;
        }
        if (descColIdx !== -1 && metaCols[descColIdx]) {
          listDescription = metaCols[descColIdx].trim();
        }
      }
      continue;
    }

    if (cols.includes("position") && (cols.includes("name") || cols.includes("title"))) {
      itemsHeaderIdx = i;
      break;
    }
  }

  const itemsCsv =
    itemsHeaderIdx >= 0
      ? rawLines.slice(itemsHeaderIdx).filter((l) => l.trim() !== "").join("\n")
      : rawLines.filter((l) => l.trim() !== "").join("\n");

  const parsed = parseCSVImport(itemsCsv);
  const items = parsed.rows.map((row) => ({
    title: row.title,
    year: row.year || "",
    ...(row.imdbId ? { imdbID: row.imdbId } : {}),
    ...(row.tmdbId ? { tmdbId: row.tmdbId } : {})
  }));

  return {
    name: listName.slice(0, 80),
    description: listDescription.slice(0, 300),
    items
  };
}

/**
 * Parses a full Letterboxd `.zip` export archive into watched films (with merged ratings,
 * reviews, and diary watchHistory), watchlist films, and custom lists.
 */
export async function parseLetterboxdZipArchive(arrayBuffer, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const filesMap = await extractZipTextFiles(arrayBuffer, options);

  const watchedCsv = findArchiveEntry(filesMap, "watched.csv");
  const ratingsCsv = findArchiveEntry(filesMap, "ratings.csv");
  const reviewsCsv = findArchiveEntry(filesMap, "reviews.csv");
  const diaryCsv = findArchiveEntry(filesMap, "diary.csv");
  const watchlistCsv = findArchiveEntry(filesMap, "watchlist.csv");
  const listFiles = findListEntries(filesMap);

  const mergedByKey = new Map();

  const upsertRow = (row, sourcePriority) => {
    const key = normalizeFilmKey(row.title, row.year);
    if (!key) return;
    const existing = mergedByKey.get(key) || {
      title: row.title,
      year: row.year || "",
      rating: null,
      note: "",
      type: "watched",
      imdbId: row.imdbId || "",
      tmdbId: row.tmdbId || null,
      dateWatched: null,
      dateSource: null,
      isBulkImported: false,
      _datePriority: -1
    };

    if (!existing.year && row.year) existing.year = row.year;
    if (!existing.imdbId && row.imdbId) existing.imdbId = row.imdbId;
    if (!existing.tmdbId && row.tmdbId) existing.tmdbId = row.tmdbId;

    const nextRating = Number(row.rating);
    if (Number.isFinite(nextRating) && nextRating > 0 && (!existing.rating || sourcePriority >= 3)) {
      existing.rating = nextRating;
    }

    const nextNote = String(row.note || "").trim();
    if (nextNote && nextNote.length > existing.note.length) {
      existing.note = nextNote;
    }

    if (row.dateWatched && sourcePriority >= existing._datePriority) {
      existing.dateWatched = row.dateWatched;
      existing.dateSource = row.dateSource || existing.dateSource;
      existing._datePriority = sourcePriority;
    }
    if (row.isBulkImported && !existing.dateWatched) {
      existing.isBulkImported = true;
    }

    mergedByKey.set(key, existing);
  };

  if (watchedCsv) {
    for (const row of parseCSVImport(watchedCsv, { now }).rows) upsertRow(row, 1);
  }
  if (ratingsCsv) {
    for (const row of parseCSVImport(ratingsCsv, { now }).rows) upsertRow(row, 4);
  }
  if (diaryCsv) {
    for (const row of parseCSVImport(diaryCsv, { now }).rows) upsertRow(row, 3);
  }
  if (reviewsCsv) {
    for (const row of parseCSVImport(reviewsCsv, { now }).rows) upsertRow(row, 3);
  }

  const diaryHistoryByKey = extractRawDiaryHistory(diaryCsv || "", now);
  const incomingWatched = [];
  let ratedCount = 0;
  let reviewCount = 0;

  for (const [key, mergedRow] of mergedByKey.entries()) {
    const resolved = resolveCsvRowFallbackRecord({
      ...mergedRow,
      type: "watched"
    });
    const record = resolved.record;
    if (mergedRow.note) {
      record.userNote = mergedRow.note;
      reviewCount += 1;
    }
    if (Number(record.userRating) > 0) {
      ratedCount += 1;
    }
    const history = diaryHistoryByKey.get(key);
    if (history && history.length > 0) {
      record.watchHistory = history;
      if (history.length > 1) {
        record.watchMeta = {
          ...(record.watchMeta || {}),
          rewatchCount: history.length - 1
        };
      }
    }
    incomingWatched.push(record);
  }

  const incomingWatchlist = [];
  if (watchlistCsv) {
    for (const row of parseCSVImport(watchlistCsv, { now }).rows) {
      const key = normalizeFilmKey(row.title, row.year);
      if (!key || mergedByKey.has(key)) continue;
      const resolved = resolveCsvRowFallbackRecord({
        ...row,
        rating: null,
        type: "watchlist"
      });
      incomingWatchlist.push(resolved.record);
    }
  }

  let incomingLists = [];
  for (const lf of listFiles) {
    const parsedList = parseLetterboxdListCsv(lf.text, lf.fallbackName);
    if (parsedList.items.length === 0) continue;
    incomingLists = createCustomList(incomingLists, {
      name: parsedList.name,
      description: parsedList.description,
      initialItems: parsedList.items
    });
  }

  return {
    incomingWatched,
    incomingWatchlist,
    incomingLists,
    stats: {
      watchedCount: incomingWatched.length,
      ratedCount,
      reviewCount,
      watchlistCount: incomingWatchlist.length,
      listCount: incomingLists.length
    }
  };
}
