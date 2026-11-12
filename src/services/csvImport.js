const MS_PER_DAY = 86400000;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Splits a single CSV line handling quoted fields and escaped quotes ("").
 */
export function parseCSVLine(line) {
  if (typeof line !== "string") return [];
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses star glyphs (★/½) or numeric ratings (<=5 scaled to 10-point scale).
 */
export function parseRating(val) {
  if (!val) return 0;
  if (typeof val === "string") {
    const stars = (val.match(/★/g) || []).length;
    const half = val.includes("½") ? 0.5 : 0;
    if (stars > 0 || half > 0) {
      return (stars + half) * 2;
    }
  }
  const num = parseFloat(val);
  if (!isNaN(num)) {
    if (num <= 5) return Math.round(num * 2);
    return Math.round(num);
  }
  return 0;
}

function isValidCalendarYMD(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/**
 * Strictly parses an import date string (YYYY-MM-DD or ISO-8601 datetime),
 * rejecting calendar rollovers (e.g. 2026-02-30) and timestamps > now + 24h.
 */
export function parseImportDate(rawDate, now = Date.now()) {
  if (typeof rawDate !== "string") return null;
  const trimmed = rawDate.trim();
  if (!trimmed) return null;

  const refNow = Number.isFinite(now) ? now : Date.now();
  const maxAllowedTs = refNow + MS_PER_DAY;

  const dateOnlyMatch = trimmed.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (!isValidCalendarYMD(year, month, day)) return null;

    const utcMs = Date.UTC(year, month - 1, day);
    if (utcMs > maxAllowedTs) return null;
    return new Date(utcMs).toISOString();
  }

  const dtMatch = trimmed.match(ISO_DATETIME_RE);
  if (dtMatch) {
    const year = Number(dtMatch[1]);
    const month = Number(dtMatch[2]);
    const day = Number(dtMatch[3]);
    const hour = Number(dtMatch[4]);
    const minute = Number(dtMatch[5]);
    const second = dtMatch[6] !== undefined ? Number(dtMatch[6]) : 0;
    const tz = dtMatch[8] || "";

    if (!isValidCalendarYMD(year, month, day)) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    if (tz && tz.toUpperCase() !== "Z") {
      const tzDigits = tz.slice(1).replace(":", "");
      const tzHours = Number(tzDigits.slice(0, 2));
      const tzMins = Number(tzDigits.slice(2, 4));
      if (tzHours > 23 || tzMins > 59) return null;
    }

    const parsedTs = Date.parse(trimmed);
    if (!Number.isFinite(parsedTs)) return null;
    if (parsedTs > maxAllowedTs) return null;
    return new Date(parsedTs).toISOString();
  }

  return null;
}

function resolveDateFields(cols, watchedDateIdx, loggedDateIdx, now) {
  const watchedRaw =
    watchedDateIdx !== -1 && cols[watchedDateIdx] !== undefined
      ? String(cols[watchedDateIdx]).trim()
      : "";
  const loggedRaw =
    loggedDateIdx !== -1 && cols[loggedDateIdx] !== undefined
      ? String(cols[loggedDateIdx]).trim()
      : "";

  if (watchedRaw !== "") {
    const iso = parseImportDate(watchedRaw, now);
    if (!iso) return null;
    return { dateWatched: iso, dateSource: "watched" };
  }

  if (loggedRaw !== "") {
    const iso = parseImportDate(loggedRaw, now);
    if (!iso) return null;
    return { dateWatched: iso, dateSource: "logged" };
  }

  return null;
}

/**
 * Parses CSV import content into normalized row entries and dropped-row records.
 * Prioritizes "Watched Date" ("watched") over "Date" ("logged"), keeps positional
 * fallbacks for headerless CSVs, and avoids mapping Letterboxd URIs into notes.
 */
export function parseCSVImport(content, options = {}) {
  const { now = Date.now() } = options;
  const lines =
    typeof content === "string"
      ? content.split(/\r?\n/).filter((line) => line.trim() !== "")
      : [];

  if (lines.length <= 1) {
    return {
      lineCount: lines.length,
      rows: [],
      droppedRows: [],
      hasRecognizedHeader: false
    };
  }

  const headers = parseCSVLine(lines[0]).map((h) =>
    h.replace(/^\uFEFF/, "").toLowerCase().replace(/["']/g, "").trim()
  );

  const titleIdx = headers.findIndex((h) => h.includes("title") || h.includes("name"));
  const yearIdx = headers.findIndex((h) => h.includes("year") || h.includes("released"));
  const ratingIdx = headers.findIndex(
    (h) => h.includes("rating") || h.includes("userrating") || h.includes("stars")
  );
  const noteIdx = headers.findIndex(
    (h) => h.includes("note") || h.includes("review") || h.includes("comment")
  );
  const typeIdx = headers.findIndex((h) => h.includes("type") || h.includes("list"));
  const imdbIdIdx = headers.findIndex((h) => h.includes("imdb") || h.includes("id"));
  const watchedDateIdx = headers.findIndex(
    (h) => h === "watched date" || h === "date watched" || h === "datewatched"
  );
  const loggedDateIdx = headers.findIndex((h) => h === "date");

  const hasRecognizedHeader = titleIdx !== -1 || ratingIdx !== -1;
  const getColIdx = (idx, fallback) => (idx !== -1 ? idx : fallback);

  const finalTitleIdx = getColIdx(titleIdx, 0);
  const finalYearIdx = getColIdx(yearIdx, 1);
  const finalRatingIdx = getColIdx(ratingIdx, 2);
  const finalNoteIdx = noteIdx !== -1 ? noteIdx : (hasRecognizedHeader ? -1 : 3);
  const finalTypeIdx = getColIdx(typeIdx, -1);
  const finalImdbIdIdx = getColIdx(imdbIdIdx, -1);

  const rows = [];
  const droppedRows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length <= finalTitleIdx || !cols[finalTitleIdx]) {
      droppedRows.push({ lineNumber: i + 1, raw: lines[i], reason: "missing_title" });
      continue;
    }

    const title = cols[finalTitleIdx].replace(/^["']|["']$/g, "");
    if (!title) {
      droppedRows.push({ lineNumber: i + 1, raw: lines[i], reason: "empty_title" });
      continue;
    }

    const row = {
      title,
      year: cols[finalYearIdx] ? cols[finalYearIdx].replace(/\D/g, "") : "",
      rating: cols[finalRatingIdx] ? parseRating(cols[finalRatingIdx]) : null,
      note: finalNoteIdx !== -1 ? (cols[finalNoteIdx] || "") : "",
      type: finalTypeIdx !== -1 && cols[finalTypeIdx] ? cols[finalTypeIdx].trim() : "",
      imdbId: finalImdbIdIdx !== -1 && cols[finalImdbIdIdx] ? cols[finalImdbIdIdx].trim() : ""
    };

    if (hasRecognizedHeader) {
      const dateInfo = resolveDateFields(cols, watchedDateIdx, loggedDateIdx, now);
      if (dateInfo) {
        row.dateWatched = dateInfo.dateWatched;
        row.dateSource = dateInfo.dateSource;
      }
    }

    rows.push(row);
  }

  return {
    lineCount: lines.length,
    rows,
    droppedRows,
    hasRecognizedHeader
  };
}

/**
 * Normalizes a MovieCard quick-add entry into a watched record, stamping dateWatched
 * when userRating > 0 and no dateWatched already exists.
 */
export function buildQuickAddWatchedMovie(movie, now = Date.now()) {
  if (!movie) return null;
  const id = movie.imdbID || movie.id;
  const title = movie.Title || movie.title || "Movie";
  const poster = movie.Poster || movie.poster;
  const year = movie.Year || movie.year;
  const imdbRating = movie.imdbRating || movie.rating;
  const numericUserRating = Number(movie.userRating) || 0;

  const record = {
    ...movie,
    imdbID: id,
    title,
    year,
    poster: poster !== "N/A" ? poster : "",
    imdbRating: Number(imdbRating) || 8.0,
    runtime: parseInt(movie.runtime, 10) || 120,
    userRating: numericUserRating
  };

  if (movie.dateWatched) {
    record.dateWatched = movie.dateWatched;
  } else if (numericUserRating > 0) {
    record.dateWatched = new Date(now).toISOString();
  }

  return record;
}

/**
 * Prepares a watchlist item being bulk-moved to watched by stamping dateWatched
 * when absent.
 */
export function buildBulkMoveWatchedItem(item, now = Date.now()) {
  if (!item) return null;
  return {
    ...item,
    dateWatched: item.dateWatched || new Date(now).toISOString()
  };
}

/**
 * Attaches validated import date metadata (dateWatched, dateSource) onto a
 * resolved watched movie record only when present on the parsed CSV row.
 */
export function buildWatchedRecordFromImport(baseFields, row) {
  const record = { ...baseFields };
  if (row?.dateWatched) {
    record.dateWatched = row.dateWatched;
    if (row.dateSource) {
      record.dateSource = row.dateSource;
    }
  }
  return record;
}
