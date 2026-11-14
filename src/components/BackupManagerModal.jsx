import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  FileUp,
  Layers,
  Loader2,
  Star,
  Upload
} from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  fetchOmdbJson,
  fetchTmdbJson,
  hasOmdbBackend,
  hasTmdbBackend
} from "../services/apiTransport";
import { parseCSVImport } from "../services/csvImport";
import { mapTmdbSearchItem } from "../services/searchService";
import {
  buildBackupJsonPayload,
  buildRatingsCsv,
  parseJsonBackupContent,
  resolveCsvRowFallbackRecord,
  summarizeImportDiff
} from "../services/vaultPortability";
import { Modal } from "./ui/Modal";
import { Tabs } from "./ui/Tabs";
import { Button } from "./ui/Button";

const IMPORT_MODES = [
  {
    id: "merge_update",
    label: "Merge & Update",
    hint: "Add new films and update existing entries if incoming scores changed."
  },
  {
    id: "add_new",
    label: "Add New Only",
    hint: "Preserve all current vault scores and append only unseen films."
  },
  {
    id: "replace",
    label: "Replace Vault",
    hint: "Wipe current local lists and replace with the imported snapshot."
  }
];

function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function enrichCsvRowMetadata(row, apiKey) {
  const alreadyHasRichMetadata = Boolean(
    row.imdbId &&
    row.poster &&
    row.poster !== "N/A" &&
    row.director
  );
  if (alreadyHasRichMetadata) {
    return row;
  }

  let omdbData = null;
  if (hasOmdbBackend({ apiKey }) || Boolean(apiKey)) {
    try {
      const omdbQuery = row.imdbId && /^tt\d+$/i.test(row.imdbId)
        ? { i: row.imdbId }
        : { t: row.title, ...(row.year ? { y: row.year } : {}) };
      const res = await fetchOmdbJson({
        ...omdbQuery,
        ...(apiKey ? { apikey: apiKey } : {})
      });
      if (res && res.Response === "True") {
        omdbData = res;
      }
    } catch {
      omdbData = null;
    }
  }

  if (omdbData) {
    return {
      ...row,
      imdbId: row.imdbId || omdbData.imdbID,
      poster: omdbData.Poster && omdbData.Poster !== "N/A" ? omdbData.Poster : (row.poster || "N/A"),
      director: row.director || (omdbData.Director && omdbData.Director !== "N/A" ? omdbData.Director : "Imported"),
      genre: row.genre || (omdbData.Genre && omdbData.Genre !== "N/A" ? omdbData.Genre : "Drama"),
      runtime: row.runtime || (omdbData.Runtime && omdbData.Runtime !== "N/A" ? omdbData.Runtime : "N/A"),
      imdbRating: row.imdbRating || (omdbData.imdbRating && omdbData.imdbRating !== "N/A" ? omdbData.imdbRating : null),
      year: row.year || omdbData.Year || ""
    };
  }

  if (hasTmdbBackend()) {
    try {
      const tmdbPayload = await fetchTmdbJson("/3/search/movie", {
        query: row.title,
        ...(row.year ? { primary_release_year: row.year } : {}),
        include_adult: false,
        language: "en-US"
      });
      const firstHit = Array.isArray(tmdbPayload?.results) ? tmdbPayload.results[0] : null;
      if (firstHit) {
        const mapped = mapTmdbSearchItem(firstHit);
        return {
          ...row,
          imdbId: row.imdbId || mapped.imdbID,
          tmdbId: row.tmdbId || mapped.tmdbId,
          poster: mapped.Poster && mapped.Poster !== "N/A" ? mapped.Poster : (row.poster || "N/A"),
          genre: row.genre || mapped.genre || "Drama",
          imdbRating: row.imdbRating || mapped.imdbRating || null,
          year: row.year || mapped.Year || ""
        };
      }
    } catch {
      // fall back safely to CSV row metadata
    }
  }

  return row;
}

export default function BackupManagerModal({
  isOpen,
  initialTab = "export",
  onClose
}) {
  const {
    apiKey,
    watched = [],
    watchlist = [],
    setWatched,
    setWatchlist,
    userRegion,
    setUserRegion,
    userWatchProviders,
    setUserWatchProviders
  } = useApp();

  const [activeTab, setActiveTab] = useState(initialTab);
  const [importMode, setImportMode] = useState("merge_update");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, title: "" });
  const [pendingImport, setPendingImport] = useState(null);
  const [resultMessage, setResultMessage] = useState(null);

  const fileInputRef = useRef(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab || "export");
    setResultMessage(null);
    setPendingImport(null);
    setIsProcessing(false);
  }, [isOpen, initialTab]);

  const diffPreview = useMemo(() => {
    if (!pendingImport) return null;
    return summarizeImportDiff({
      existingWatched: watched,
      existingWatchlist: watchlist,
      incomingWatched: pendingImport.incomingWatched,
      incomingWatchlist: pendingImport.incomingWatchlist,
      mode: importMode
    });
  }, [pendingImport, watched, watchlist, importMode]);

  function handleExportJson() {
    const payload = buildBackupJsonPayload({
      watched,
      watchlist,
      userRegion,
      userWatchProviders
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const dateStamp = new Date().toISOString().slice(0, 10);
    triggerFileDownload(blob, `cinemavault-backup-${dateStamp}.json`);
    setResultMessage({
      type: "success",
      text: `Exported ${watched.length} watched films and ${watchlist.length} watchlist items as JSON (Schema v2).`
    });
  }

  function handleExportCsv(format) {
    const csvString = buildRatingsCsv({ watched, watchlist, format });
    const blob = new Blob([`\uFEFF${csvString}`], {
      type: "text/csv;charset=utf-8;"
    });
    const dateStamp = new Date().toISOString().slice(0, 10);
    const suffix = format === "letterboxd" ? "letterboxd" : "full";
    triggerFileDownload(blob, `cinemavault-${suffix}-${dateStamp}.csv`);
    setResultMessage({
      type: "success",
      text:
        format === "letterboxd"
          ? "Exported rated films in Letterboxd CSV format (unrated entries omitted)."
          : `Exported full CinemaVault CSV (${watched.length + watchlist.length} titles).`
    });
  }

  function handleApplyPendingImport() {
    if (!pendingImport || !diffPreview) return;

    setWatched(diffPreview.mergedWatched);
    setWatchlist(diffPreview.mergedWatchlist);

    if (pendingImport.preferences) {
      if (pendingImport.preferences.userRegion && setUserRegion) {
        setUserRegion(pendingImport.preferences.userRegion);
      }
      if (Array.isArray(pendingImport.preferences.userWatchProviders) && setUserWatchProviders) {
        setUserWatchProviders(pendingImport.preferences.userWatchProviders);
      }
    }

    const parts = [];
    if (diffPreview.newWatchedCount > 0) parts.push(`${diffPreview.newWatchedCount} watched added`);
    if (diffPreview.updatedRatingCount > 0) parts.push(`${diffPreview.updatedRatingCount} ratings updated`);
    if (diffPreview.newWatchlistCount > 0) parts.push(`${diffPreview.newWatchlistCount} watchlisted`);
    if (diffPreview.duplicatesSkipped > 0) parts.push(`${diffPreview.duplicatesSkipped} skipped`);

    setResultMessage({
      type: "success",
      text: parts.length > 0
        ? `Import complete: ${parts.join(", ")}.`
        : "No new changes needed; your Vault already contains every entry."
    });
    setPendingImport(null);
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setResultMessage(null);
    setPendingImport(null);
    cancelRef.current = false;

    const lowerName = file.name.toLowerCase();
    try {
      const content = await file.text();

      if (lowerName.endsWith(".json")) {
        const parsed = parseJsonBackupContent(content);
        setPendingImport({
          fileName: file.name,
          formatLabel: "JSON Backup",
          incomingWatched: parsed.watched,
          incomingWatchlist: parsed.watchlist,
          preferences: parsed.preferences || null,
          droppedCount: 0
        });
        return;
      }

      if (lowerName.endsWith(".csv")) {
        const parsedCsv = parseCSVImport(content);
        if (!parsedCsv.rows.length) {
          setResultMessage({
            type: "error",
            text: "No readable movie rows found in this CSV file."
          });
          return;
        }

        setIsProcessing(true);
        setProgress({ current: 0, total: parsedCsv.rows.length, title: "Preparing CSV rows..." });

        const incomingWatched = [];
        const incomingWatchlist = [];

        for (let i = 0; i < parsedCsv.rows.length; i += 1) {
          if (cancelRef.current) break;
          const row = parsedCsv.rows[i];
          setProgress({
            current: i + 1,
            total: parsedCsv.rows.length,
            title: row.title
          });

          const enriched = await enrichCsvRowMetadata(row, apiKey);
          const resolved = resolveCsvRowFallbackRecord(enriched);
          if (resolved.status === "watched") {
            incomingWatched.push(resolved.record);
          } else {
            incomingWatchlist.push(resolved.record);
          }

          if (i < parsedCsv.rows.length - 1 && !row.poster) {
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
        }

        setIsProcessing(false);
        if (cancelRef.current) {
          setResultMessage({
            type: "error",
            text: "CSV processing was cancelled before applying changes."
          });
          return;
        }

        setPendingImport({
          fileName: file.name,
          formatLabel: "CSV Import",
          incomingWatched,
          incomingWatchlist,
          preferences: null,
          droppedCount: parsedCsv.droppedRows?.length || 0
        });
        return;
      }

      setResultMessage({
        type: "error",
        text: "Unsupported file extension. Please upload a .json or .csv file."
      });
    } catch (err) {
      setIsProcessing(false);
      setResultMessage({
        type: "error",
        text: err?.message || "Failed to parse the selected file."
      });
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isProcessing) onClose?.();
      }}
      title="Import & Export Vault"
      size="lg"
    >
      <div className="p-6 sm:p-8 flex flex-col gap-6 max-h-[82vh] overflow-y-auto">
        <Tabs
          tabs={[
            { id: "export", label: "Export Data", icon: Download },
            { id: "import", label: "Import Data", icon: Upload }
          ]}
          activeTab={activeTab}
          onChange={(nextTab) => {
            if (!isProcessing) {
              setActiveTab(nextTab);
              setResultMessage(null);
            }
          }}
        />

        {resultMessage && (
          <div
            className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${
              resultMessage.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}
          >
            {resultMessage.type === "success" ? (
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <AlertCircle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span>{resultMessage.text}</span>
          </div>
        )}

        {activeTab === "export" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col justify-between gap-4 p-5 rounded-xl bg-[#1c1d20] border border-white/10">
                <div className="flex flex-col gap-2">
                  <FileJson size={22} className="text-[#e2b13c]" aria-hidden="true" />
                  <h3 className="text-base font-bold text-[#f4f4f2] m-0">CinemaVault JSON (v2)</h3>
                  <p className="text-xs text-[#9e9e99] leading-relaxed m-0">
                    Lossless backup of all watched ratings, notes, TMDB/IMDb IDs, watchlist, and preferences.
                  </p>
                </div>
                <Button variant="accent" icon={Download} onClick={handleExportJson}>
                  Download JSON
                </Button>
              </div>

              <div className="flex flex-col justify-between gap-4 p-5 rounded-xl bg-[#1c1d20] border border-white/10">
                <div className="flex flex-col gap-2">
                  <FileSpreadsheet size={22} className="text-[#e2b13c]" aria-hidden="true" />
                  <h3 className="text-base font-bold text-[#f4f4f2] m-0">CinemaVault Full CSV</h3>
                  <p className="text-xs text-[#9e9e99] leading-relaxed m-0">
                    Spreadsheet-friendly archive including IMDb &amp; TMDB IDs, genres, runtime, and watched dates.
                  </p>
                </div>
                <Button variant="secondary" icon={Download} onClick={() => handleExportCsv("cinemavault")}>
                  Download CSV
                </Button>
              </div>

              <div className="flex flex-col justify-between gap-4 p-5 rounded-xl bg-[#1c1d20] border border-white/10">
                <div className="flex flex-col gap-2">
                  <Star size={22} className="text-[#e2b13c]" aria-hidden="true" />
                  <h3 className="text-base font-bold text-[#f4f4f2] m-0">Letterboxd Ratings CSV</h3>
                  <p className="text-xs text-[#9e9e99] leading-relaxed m-0">
                    Clean rated-films export omitting unrated items for instant import into Letterboxd or Trakt.
                  </p>
                </div>
                <Button variant="secondary" icon={Download} onClick={() => handleExportCsv("letterboxd")}>
                  Export Rated CSV
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Merge Mode Selector */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#9e9e99]">
                Import Strategy
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {IMPORT_MODES.map((modeOption) => {
                  const isActive = importMode === modeOption.id;
                  return (
                    <button
                      key={modeOption.id}
                      type="button"
                      disabled={isProcessing}
                      onClick={() => setImportMode(modeOption.id)}
                      className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? "bg-[#e2b13c]/12 border-[#e2b13c]/50 text-[#f4f4f2]"
                          : "bg-[#1c1d20] border-white/10 text-[#b6b6b2] hover:border-white/25"
                      }`}
                    >
                      <div className="text-sm font-bold flex items-center gap-1.5">
                        <Layers size={14} className={isActive ? "text-[#e2b13c]" : "text-[#8a8a86]"} aria-hidden="true" />
                        <span>{modeOption.label}</span>
                      </div>
                      <p className="text-xs text-[#8a8a86] mt-1 mb-0 leading-snug">
                        {modeOption.hint}
                      </p>
                    </button>
                  );
                })}
              </div>

              {importMode === "replace" && (
                <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mt-1">
                  <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
                  <span>Replace Vault clears your existing local lists when you apply the previewed import.</span>
                </div>
              )}
            </div>

            {/* File Drop / Picker */}
            {!pendingImport && !isProcessing && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-white/15 bg-[#191a1d] hover:border-[#e2b13c]/50 transition-colors cursor-pointer text-center"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <FileUp size={28} className="text-[#e2b13c]" aria-hidden="true" />
                <div className="text-base font-bold text-[#f4f4f2]">
                  Choose a .JSON or .CSV File
                </div>
                <p className="text-xs text-[#8a8a86] max-w-md m-0 leading-relaxed">
                  Supports CinemaVault JSON (v1/v2 or bare ratings array), CinemaVault CSV, Letterboxd ratings/diary/watchlist CSV, and IMDb CSV exports.
                </p>
              </div>
            )}

            {/* Enrichment Progress */}
            {isProcessing && (
              <div className="p-5 rounded-xl bg-[#1c1d20] border border-white/10 flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm text-[#f4f4f2]">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <Loader2 size={16} className="animate-spin text-[#e2b13c]" aria-hidden="true" />
                    Resolving metadata ({progress.current}/{progress.total})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      cancelRef.current = true;
                    }}
                    className="text-xs text-red-400 hover:underline bg-transparent border-0 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-xs text-[#9e9e99] m-0 truncate">{progress.title}</p>
              </div>
            )}

            {/* Pre-Commit Diff Preview */}
            {pendingImport && diffPreview && !isProcessing && (
              <div className="p-5 rounded-2xl bg-[#1c1d20] border border-[#e2b13c]/35 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-bold text-[#f4f4f2]">
                      Preview: {pendingImport.fileName}
                    </div>
                    <div className="text-xs text-[#8a8a86]">
                      {pendingImport.formatLabel}
                      {pendingImport.droppedCount > 0
                        ? ` • ${pendingImport.droppedCount} blank rows skipped`
                        : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingImport(null)}
                  >
                    Choose Another File
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-[#141416] border border-white/8">
                    <div className="text-xl font-bold text-[#e2b13c]">{diffPreview.newWatchedCount}</div>
                    <div className="text-xs text-[#9e9e99]">New Watched</div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141416] border border-white/8">
                    <div className="text-xl font-bold text-[#f4f4f2]">{diffPreview.updatedRatingCount}</div>
                    <div className="text-xs text-[#9e9e99]">Scores Updated</div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141416] border border-white/8">
                    <div className="text-xl font-bold text-[#f4f4f2]">{diffPreview.newWatchlistCount}</div>
                    <div className="text-xs text-[#9e9e99]">New Watchlist</div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141416] border border-white/8">
                    <div className="text-xl font-bold text-[#8a8a86]">{diffPreview.duplicatesSkipped}</div>
                    <div className="text-xs text-[#9e9e99]">Unchanged / Skipped</div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setPendingImport(null)}>
                    Cancel
                  </Button>
                  <Button variant="accent" icon={CheckCircle2} onClick={handleApplyPendingImport}>
                    Confirm &amp; Apply Import
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
