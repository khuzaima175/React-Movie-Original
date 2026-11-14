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
    applyVaultImportSnapshot,
    userRegion,
    setUserRegion,
    userWatchProviders,
    setUserWatchProviders
  } = useApp();

  const [activeTab, setActiveTab] = useState(initialTab);
  const [importMode, setImportMode] = useState("merge_update");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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
    setIsDragging(false);
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

    if (applyVaultImportSnapshot) {
      applyVaultImportSnapshot({
        mergedWatched: diffPreview.mergedWatched,
        mergedWatchlist: diffPreview.mergedWatchlist,
        replaceMode: importMode === "replace"
      });
    } else {
      setWatched(diffPreview.mergedWatched);
      setWatchlist(diffPreview.mergedWatchlist);
    }

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

  async function processSelectedFile(file) {
    if (!file) return;

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

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    await processSelectedFile(file);
  }

  async function handleFileDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;
    const file = e.dataTransfer?.files?.[0];
    await processSelectedFile(file);
  }

  const exportOptions = [
    {
      id: "json",
      icon: FileJson,
      badge: "Lossless",
      isPrimary: true,
      title: "CinemaVault JSON (v2)",
      description:
        "Lossless backup of all watched ratings, notes, TMDB/IMDb IDs, watchlist, and preferences.",
      buttonLabel: "Download JSON",
      buttonVariant: "accent",
      onClick: handleExportJson
    },
    {
      id: "csv-full",
      icon: FileSpreadsheet,
      badge: "Spreadsheet",
      isPrimary: false,
      title: "CinemaVault Full CSV",
      description:
        "Spreadsheet-friendly archive including IMDb & TMDB IDs, genres, runtime, and watched dates.",
      buttonLabel: "Download CSV",
      buttonVariant: "secondary",
      onClick: () => handleExportCsv("cinemavault")
    },
    {
      id: "csv-letterboxd",
      icon: Star,
      badge: "Portable",
      isPrimary: false,
      title: "Letterboxd Ratings CSV",
      description:
        "Clean rated-films export omitting unrated items for instant import into Letterboxd or Trakt.",
      buttonLabel: "Export Rated CSV",
      buttonVariant: "secondary",
      onClick: () => handleExportCsv("letterboxd")
    }
  ];

  const progressPercent =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isProcessing) onClose?.();
      }}
      title="Import & Export Vault"
      size="lg"
    >
      <div className="flex flex-col max-h-[76vh] overflow-y-auto">
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
            className={`flex items-start gap-[1.1rem] px-[1.6rem] py-[1.3rem] rounded-[1rem] border text-[1.35rem] leading-[1.45] mb-[2rem] ${
              resultMessage.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}
          >
            {resultMessage.type === "success" ? (
              <CheckCircle2 size={18} className="shrink-0 mt-[0.15rem]" aria-hidden="true" />
            ) : (
              <AlertCircle size={18} className="shrink-0 mt-[0.15rem]" aria-hidden="true" />
            )}
            <span>{resultMessage.text}</span>
          </div>
        )}

        {activeTab === "export" ? (
          <div className="flex flex-col gap-[1.8rem]">
            <div className="flex flex-wrap items-center justify-between gap-[1rem]">
              <p className="text-[1.3rem] text-[#9e9e99] m-0 leading-[1.45]">
                Choose a format to back up your Film Vault or migrate ratings elsewhere.
              </p>
              <div className="inline-flex items-center gap-[0.8rem] px-[1.2rem] py-[0.55rem] rounded-[0.8rem] bg-[#1c1d20] border border-white/10 text-[1.2rem] text-[#b6b6b2] tabular-nums">
                <span>
                  <strong className="text-[#f4f4f2] font-semibold">{watched.length}</strong> Watched
                </span>
                <span className="text-white/20" aria-hidden="true">·</span>
                <span>
                  <strong className="text-[#f4f4f2] font-semibold">{watchlist.length}</strong> Watchlist
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-[1.6rem]">
              {exportOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <div
                    key={option.id}
                    className={`flex flex-col justify-between gap-[2rem] p-[2rem] rounded-[1.2rem] border transition-colors ${
                      option.isPrimary
                        ? "bg-gradient-to-b from-[#201f1b] to-[#1c1d20] border-[#e2b13c]/30 hover:border-[#e2b13c]/50"
                        : "bg-[#1c1d20] border-white/10 hover:border-white/22"
                    }`}
                  >
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between gap-[1rem]">
                        <div className="w-[3.8rem] h-[3.8rem] rounded-[0.9rem] bg-[#e2b13c]/10 border border-[#e2b13c]/25 flex items-center justify-center text-[#e2b13c] shrink-0">
                          <Icon size={19} aria-hidden="true" />
                        </div>
                        <span
                          className={`text-[1.1rem] font-semibold px-[0.8rem] py-[0.3rem] rounded-[0.5rem] border ${
                            option.isPrimary
                              ? "bg-[#e2b13c]/12 text-[#e2b13c] border-[#e2b13c]/25"
                              : "bg-white/[0.04] text-[#9e9e99] border-white/10"
                          }`}
                        >
                          {option.badge}
                        </span>
                      </div>
                      <h3 className="text-[1.55rem] font-bold text-[#f4f4f2] leading-snug m-0 mt-[1.4rem]">
                        {option.title}
                      </h3>
                      <p className="text-[1.25rem] text-[#9e9e99] leading-[1.55] m-0 mt-[0.7rem]">
                        {option.description}
                      </p>
                    </div>
                    <Button
                      variant={option.buttonVariant}
                      size="md"
                      icon={Download}
                      className="w-full"
                      onClick={option.onClick}
                    >
                      {option.buttonLabel}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[2rem]">
            {/* Merge Mode Selector */}
            <div className="flex flex-col gap-[1rem]">
              <span className="text-[1.2rem] font-semibold uppercase tracking-[0.08em] text-[#9e9e99]">
                Import Strategy
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-[1.2rem]">
                {IMPORT_MODES.map((modeOption) => {
                  const isActive = importMode === modeOption.id;
                  return (
                    <button
                      key={modeOption.id}
                      type="button"
                      disabled={isProcessing}
                      onClick={() => setImportMode(modeOption.id)}
                      className={`flex flex-col items-start text-left p-[1.5rem] rounded-[1.1rem] border transition-all cursor-pointer ${
                        isActive
                          ? "bg-[#e2b13c]/12 border-[#e2b13c]/55 text-[#f4f4f2] shadow-[0_0_0_1px_rgba(226,177,60,0.18)]"
                          : "bg-[#1c1d20] border-white/10 text-[#b6b6b2] hover:border-white/25 hover:bg-[#212226]"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full gap-[0.8rem]">
                        <div className="flex items-center gap-[0.7rem] text-[1.4rem] font-bold">
                          <Layers
                            size={15}
                            className={isActive ? "text-[#e2b13c]" : "text-[#8a8a86]"}
                            aria-hidden="true"
                          />
                          <span>{modeOption.label}</span>
                        </div>
                        {isActive && (
                          <CheckCircle2 size={15} className="text-[#e2b13c] shrink-0" aria-hidden="true" />
                        )}
                      </div>
                      <p
                        className={`text-[1.25rem] leading-[1.45] m-0 mt-[0.7rem] ${
                          isActive ? "text-[#c8c8c3]" : "text-[#8a8a86]"
                        }`}
                      >
                        {modeOption.hint}
                      </p>
                    </button>
                  );
                })}
              </div>

              {importMode === "replace" && (
                <div className="flex items-center gap-[1rem] text-[1.25rem] leading-[1.45] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-[0.9rem] px-[1.4rem] py-[1rem] mt-[0.2rem]">
                  <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
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
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`flex flex-col items-center justify-center gap-[1.2rem] px-[2.4rem] py-[3.4rem] rounded-[1.4rem] border-2 border-dashed transition-colors cursor-pointer text-center ${
                  isDragging
                    ? "border-[#e2b13c] bg-[#e2b13c]/[0.06]"
                    : "border-white/15 bg-[#191a1d] hover:border-[#e2b13c]/50 hover:bg-[#1c1d21]"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="w-[5rem] h-[5rem] rounded-[1.2rem] bg-[#e2b13c]/10 border border-[#e2b13c]/25 flex items-center justify-center text-[#e2b13c]">
                  <FileUp size={24} aria-hidden="true" />
                </div>
                <div className="text-[1.6rem] font-bold text-[#f4f4f2]">
                  Choose or Drop a .JSON or .CSV File
                </div>
                <p className="text-[1.25rem] text-[#9e9e99] max-w-[52rem] m-0 leading-[1.55]">
                  Drag a backup file here or click to browse. We will compute a preview diff before modifying your Vault.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-[0.8rem] mt-[0.4rem]">
                  {["JSON v1 / v2", "CinemaVault CSV", "Letterboxd CSV", "IMDb CSV"].map((fmt) => (
                    <span
                      key={fmt}
                      className="text-[1.1rem] text-[#9e9e99] bg-white/[0.04] border border-white/10 px-[0.9rem] py-[0.35rem] rounded-[0.5rem]"
                    >
                      {fmt}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Enrichment Progress */}
            {isProcessing && (
              <div className="p-[2rem] rounded-[1.2rem] bg-[#1c1d20] border border-white/10 flex flex-col gap-[1.4rem]">
                <div className="flex items-center justify-between gap-[1.2rem] text-[1.4rem] text-[#f4f4f2]">
                  <span className="inline-flex items-center gap-[0.9rem] font-semibold">
                    <Loader2 size={17} className="animate-spin text-[#e2b13c]" aria-hidden="true" />
                    Resolving metadata ({progress.current}/{progress.total})
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      cancelRef.current = true;
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                <div className="w-full h-[0.65rem] rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full bg-[#e2b13c] transition-all duration-150"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-[1.25rem] text-[#9e9e99] m-0 truncate">{progress.title}</p>
              </div>
            )}

            {/* Pre-Commit Diff Preview */}
            {pendingImport && diffPreview && !isProcessing && (
              <div className="p-[2rem] rounded-[1.2rem] bg-[#1c1d20] border border-[#e2b13c]/35 flex flex-col gap-[1.8rem]">
                <div className="flex items-center justify-between gap-[1.2rem] flex-wrap">
                  <div className="flex flex-col gap-[0.3rem]">
                    <div className="text-[1.5rem] font-bold text-[#f4f4f2]">
                      Preview: {pendingImport.fileName}
                    </div>
                    <div className="text-[1.25rem] text-[#8a8a86]">
                      {pendingImport.formatLabel}
                      {pendingImport.droppedCount > 0
                        ? ` · ${pendingImport.droppedCount} blank rows skipped`
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[1.2rem]">
                  {[
                    {
                      label: "New Watched",
                      value: diffPreview.newWatchedCount,
                      tone: "text-[#e2b13c]"
                    },
                    {
                      label: "Scores Updated",
                      value: diffPreview.updatedRatingCount,
                      tone: "text-[#f4f4f2]"
                    },
                    {
                      label: "New Watchlist",
                      value: diffPreview.newWatchlistCount,
                      tone: "text-[#f4f4f2]"
                    },
                    {
                      label: "Unchanged / Skipped",
                      value: diffPreview.duplicatesSkipped,
                      tone: "text-[#8a8a86]"
                    }
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="p-[1.4rem] rounded-[1rem] bg-[#141416] border border-white/10"
                    >
                      <div className={`text-[2.2rem] font-bold tabular-nums leading-none ${stat.tone}`}>
                        {stat.value}
                      </div>
                      <div className="text-[1.2rem] text-[#9e9e99] mt-[0.5rem]">{stat.label}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-[1.2rem] pt-[0.4rem]">
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
