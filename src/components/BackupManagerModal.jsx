import { useState, useRef } from "react";
import { useApp } from "../context/AppContext";
import { Modal } from "./ui/Modal";
import { Tabs } from "./ui/Tabs";
import { Button } from "./ui/Button";
import {
  FileJson,
  FileSpreadsheet,
  Star,
  Upload,
  Download,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Layers,
  FileUp
} from "lucide-react";

const getOmdbKey = () => {
  const key = import.meta.env.VITE_OMDB_KEY;
  if (!key || key === "undefined" || key === "null" || key.trim() === "") {
    return "b78bdecd";
  }
  return key.trim();
};
const KEY = getOmdbKey();

export default function BackupManagerModal({ isOpen, onClose }) {
  const { watched = [], watchlist = [], setWatched, setWatchlist } = useApp();
  const [activeTab, setActiveTab] = useState("export"); // "export" | "import"
  const [importMode, setImportMode] = useState("merge"); // "merge" | "overwrite"

  // Import Status State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, title: "" });
  const [resultMessage, setResultMessage] = useState(null);

  const fileInputRef = useRef(null);
  const cancelRef = useRef(false);

  if (!isOpen) return null;

  // ── CSV PARSER ──
  function parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
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

  function parseRating(val) {
    if (!val) return 0;
    if (typeof val === "string") {
      const stars = (val.match(/★/g) || []).length;
      const half = val.includes("½") ? 0.5 : 0;
      if (stars > 0 || half > 0) {
        return (stars + half) * 2; // scale 5-star Unicode to 10-star
      }
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      if (num <= 5) return Math.round(num * 2); // Scale 5-star to 10-star
      return Math.round(num);
    }
    return 0;
  }

  // ── EXPORT ACTIONS ──
  function exportJSON() {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify({ watched, watchlist }, null, 2));
    triggerDownload(dataStr, "cinemavault_backup.json");
  }

  function exportGeneralCSV() {
    const headers = [
      "Title",
      "Year",
      "IMDb ID",
      "IMDb Rating",
      "Runtime",
      "My Rating",
      "Notes",
      "Genres",
      "Director",
      "Type",
    ];
    const rows = [
      ...watched.map((m) => [
        m.title,
        m.year,
        m.imdbID,
        m.imdbRating,
        m.runtime,
        m.userRating,
        m.userNote || "",
        m.genre || "",
        m.director || "",
        "Watched",
      ]),
      ...watchlist.map((m) => [
        m.title,
        m.year,
        m.imdbID,
        m.imdbRating,
        m.runtime,
        "",
        "",
        "",
        "",
        "Watchlist",
      ]),
    ];

    const csvContent = [
      headers.join(","),
      ...rows.map((e) =>
        e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "cinemavault_collection.csv");
  }

  function exportLetterboxdCSV() {
    const headers = ["Title", "Year", "Rating10"];
    const rows = watched.map((m) => [m.title, m.year, m.userRating]);

    const csvContent = [
      headers.join(","),
      ...rows.map((e) =>
        e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "letterboxd_ratings_import.csv");
  }

  function triggerDownload(url, filename) {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", url);
    anchor.setAttribute("download", filename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  // ── IMPORT ACTIONS ──
  const handleDragOver = (e) => e.preventDefault();

  const handleDrop = (e) => {
    e.preventDefault();
    if (isProcessing) return;
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
  };

  function processFile(file) {
    setIsProcessing(true);
    setResultMessage(null);
    cancelRef.current = false;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target.result;
      if (file.name.endsWith(".json")) {
        handleJSONImport(content);
      } else if (file.name.endsWith(".csv")) {
        await handleCSVImport(content);
      } else {
        setResultMessage({
          type: "error",
          text: "Unsupported file type. Please upload a .json or .csv file.",
        });
        setIsProcessing(false);
      }
    };
    reader.readAsText(file);
  }

  function handleJSONImport(content) {
    try {
      const data = JSON.parse(content);
      if (!data.watched && !data.watchlist) {
        throw new Error("Invalid backup format. Missing collections.");
      }

      const newWatchedList = Array.isArray(data.watched) ? data.watched : [];
      const newWatchlistList = Array.isArray(data.watchlist) ? data.watchlist : [];

      if (importMode === "overwrite") {
        setWatched(newWatchedList);
        setWatchlist(newWatchlistList);
        setResultMessage({
          type: "success",
          text: `Success! Vault overwritten with ${newWatchedList.length} rated films and ${newWatchlistList.length} watchlist titles.`,
        });
      } else {
        // Merge
        setWatched((prev) => {
          const existingIds = new Set(prev.map((m) => m.imdbID));
          const filteredNew = newWatchedList.filter((m) => !existingIds.has(m.imdbID));
          return [...prev, ...filteredNew];
        });
        setWatchlist((prev) => {
          const existingIds = new Set(prev.map((m) => m.imdbID));
          const filteredNew = newWatchlistList.filter((m) => !existingIds.has(m.imdbID));
          return [...prev, ...filteredNew];
        });

        setResultMessage({
          type: "success",
          text: `Success! Merged data. Added newly found items.`,
        });
      }
    } catch (err) {
      setResultMessage({ type: "error", text: `JSON Parse Error: ${err.message}` });
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleCSVImport(content) {
    const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
    if (lines.length <= 1) {
      setResultMessage({ type: "error", text: "CSV is empty or missing data." });
      setIsProcessing(false);
      return;
    }

    const headers = parseCSVLine(lines[0]).map((h) =>
      h.toLowerCase().replace(/["']/g, "")
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

    const getColIdx = (idx, fallback) => (idx !== -1 ? idx : fallback);
    const finalTitleIdx = getColIdx(titleIdx, 0);
    const finalYearIdx = getColIdx(yearIdx, 1);
    const finalRatingIdx = getColIdx(ratingIdx, 2);
    const finalNoteIdx = getColIdx(noteIdx, 3);
    const finalTypeIdx = getColIdx(typeIdx, -1);
    const finalImdbIdIdx = getColIdx(imdbIdIdx, -1);

    const parsedRows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length <= finalTitleIdx || !cols[finalTitleIdx]) continue;

      parsedRows.push({
        title: cols[finalTitleIdx].replace(/^["']|["']$/g, ""),
        year: cols[finalYearIdx] ? cols[finalYearIdx].replace(/\D/g, "") : "",
        rating: cols[finalRatingIdx] ? parseRating(cols[finalRatingIdx]) : null,
        note: cols[finalNoteIdx] || "",
        type: finalTypeIdx !== -1 && cols[finalTypeIdx] ? cols[finalTypeIdx].trim() : "",
        imdbId: finalImdbIdIdx !== -1 && cols[finalImdbIdIdx] ? cols[finalImdbIdIdx].trim() : "",
      });
    }

    if (parsedRows.length === 0) {
      setResultMessage({ type: "error", text: "No valid movie entries could be parsed." });
      setIsProcessing(false);
      return;
    }

    const resolvedWatched = [];
    const resolvedWatchlist = [];
    const total = parsedRows.length;

    for (let i = 0; i < total; i++) {
      if (cancelRef.current) break;
      const row = parsedRows[i];

      setProgress({ current: i + 1, total, title: row.title });

      const fallbackMovie = () => {
        const tempId = row.imdbId || `csv-${Math.random().toString(36).substr(2, 9)}`;
        const isWatchlist =
          row.type.toLowerCase().includes("watchlist") ||
          (!row.rating && row.type.toLowerCase() !== "watched");

        if (isWatchlist) {
          resolvedWatchlist.push({
            imdbID: tempId,
            title: row.title,
            year: row.year || "N/A",
            poster: "",
            imdbRating: 0,
            runtime: 0,
          });
        } else {
          resolvedWatched.push({
            imdbID: tempId,
            title: row.title,
            year: row.year || "N/A",
            poster: "",
            imdbRating: 0,
            runtime: 0,
            userRating: row.rating || 5,
            userNote: row.note || "",
            director: "Unknown",
            writer: "Unknown",
            genre: "Unknown",
            shortPlot: "Imported via CSV backup.",
          });
        }
      };

      try {
        let fetchUrl = "";
        if (row.imdbId && row.imdbId.startsWith("tt")) {
          fetchUrl = `https://www.omdbapi.com/?apikey=${KEY}&i=${row.imdbId}`;
        } else {
          fetchUrl = `https://www.omdbapi.com/?apikey=${KEY}&t=${encodeURIComponent(
            row.title
          )}${row.year ? `&y=${row.year}` : ""}`;
        }

        let res = await fetch(fetchUrl);

        if (!res.ok || res.status === 401) {
          if (KEY !== "b78bdecd") {
            let fallbackUrl = "";
            if (row.imdbId && row.imdbId.startsWith("tt")) {
              fallbackUrl = `https://www.omdbapi.com/?apikey=b78bdecd&i=${row.imdbId}`;
            } else {
              fallbackUrl = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(
                row.title
              )}${row.year ? `&y=${row.year}` : ""}`;
            }
            res = await fetch(fallbackUrl);
          }
        }

        if (!res.ok) throw new Error("Network issues");
        let data = await res.json();

        if (
          data.Response === "False" &&
          data.Error &&
          (data.Error.includes("key") || data.Error.includes("credential")) &&
          KEY !== "b78bdecd"
        ) {
          let fallbackUrl = "";
          if (row.imdbId && row.imdbId.startsWith("tt")) {
            fallbackUrl = `https://www.omdbapi.com/?apikey=b78bdecd&i=${row.imdbId}`;
          } else {
            fallbackUrl = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(
              row.title
            )}${row.year ? `&y=${row.year}` : ""}`;
          }
          const fallbackRes = await fetch(fallbackUrl);
          if (fallbackRes.ok) {
            data = await fallbackRes.json();
          }
        }

        if (data.Response === "True") {
          const isWatchlist =
            row.type.toLowerCase().includes("watchlist") ||
            (row.rating === null && !row.type);

          if (isWatchlist) {
            resolvedWatchlist.push({
              imdbID: data.imdbID,
              title: data.Title,
              year: data.Year,
              poster: data.Poster !== "N/A" ? data.Poster : "",
              imdbRating: Number(data.imdbRating) || 0,
              runtime: Number(data.Runtime?.split(" ")[0] || 0),
            });
          } else {
            resolvedWatched.push({
              imdbID: data.imdbID,
              title: data.Title,
              year: data.Year,
              poster: data.Poster !== "N/A" ? data.Poster : "",
              imdbRating: Number(data.imdbRating) || 0,
              runtime: Number(data.Runtime?.split(" ")[0] || 0),
              userRating: row.rating || 7,
              userNote: row.note || "",
              director: data.Director || "Unknown",
              writer: data.Writer || "Unknown",
              genre: data.Genre || "Unknown",
              shortPlot: data.Plot
                ? data.Plot.split(" ").slice(0, 15).join(" ") + "..."
                : "",
            });
          }
        } else {
          fallbackMovie();
        }
      } catch (err) {
        fallbackMovie();
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    if (cancelRef.current) {
      setResultMessage({
        type: "warning",
        text: "Import cancelled mid-way. No collections were saved.",
      });
      setIsProcessing(false);
      return;
    }

    if (importMode === "overwrite") {
      setWatched(resolvedWatched);
      setWatchlist(resolvedWatchlist);
    } else {
      setWatched((prev) => {
        const existingIds = new Set(prev.map((m) => m.imdbID));
        const filteredNew = resolvedWatched.filter((m) => !existingIds.has(m.imdbID));
        return [...prev, ...filteredNew];
      });
      setWatchlist((prev) => {
        const existingIds = new Set(prev.map((m) => m.imdbID));
        const filteredNew = resolvedWatchlist.filter((m) => !existingIds.has(m.imdbID));
        return [...prev, ...filteredNew];
      });
    }

    setResultMessage({
      type: "success",
      text: `Import Completed! Processed ${resolvedWatched.length} watched films and ${resolvedWatchlist.length} watchlist items.`,
    });
    setIsProcessing(false);
  }

  function cancelImport() {
    cancelRef.current = true;
  }

  const modalTabs = [
    { id: "export", label: "Export Vault", icon: Download },
    { id: "import", label: "Import Backup", icon: Upload },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={isProcessing ? () => {} : onClose}
      title="Vault Data Manager"
      size="lg"
    >
      <div className="space-y-6">
        {/* Navigation Tabs */}
        {!isProcessing && (
          <Tabs
            tabs={modalTabs}
            activeTab={activeTab}
            onChange={setActiveTab}
            layoutId="backup-modal-tabs"
          />
        )}

        {/* Modal Body */}
        {isProcessing ? (
          <div className="py-8 text-center space-y-4">
            <div className="flex justify-center">
              <Sparkles size={32} className="text-accent animate-spin" aria-hidden="true" />
            </div>
            <div>
              <h4 className="text-base font-semibold text-text-1">Syncing with OMDb API...</h4>
              <p className="text-xs text-text-3 mt-1 truncate max-w-md mx-auto">
                Resolving: <strong className="text-text-2">{progress.title || "Initializing..."}</strong>
              </p>
            </div>

            <div className="w-full max-w-md mx-auto bg-surface-3 rounded-full h-2 overflow-hidden border border-hairline">
              <div
                className="bg-accent h-full transition-all duration-150 rounded-full"
                style={{
                  width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`,
                }}
              />
            </div>

            <p className="text-xs font-mono text-text-3">
              Processed {progress.current} of {progress.total} films
            </p>

            <div className="pt-2">
              <Button variant="ghost" size="sm" onClick={cancelImport}>
                Cancel Import
              </Button>
            </div>
          </div>
        ) : (
          <>
            {activeTab === "export" ? (
              <div className="space-y-4">
                <p className="text-xs text-text-3 leading-relaxed">
                  Download local copies of your CinemaVault collections. Use them to migrate between devices, share ratings, or maintain backups.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  <button
                    onClick={exportJSON}
                    className="flex flex-col justify-between p-4 rounded-card border border-hairline bg-surface-2 hover:bg-surface-3 text-left transition-all hover:border-hairline-strong group"
                  >
                    <div>
                      <div className="w-9 h-9 rounded-control bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mb-3">
                        <FileJson size={18} />
                      </div>
                      <h5 className="text-sm font-semibold text-text-1 group-hover:text-accent transition-colors">
                        Full JSON Backup
                      </h5>
                      <p className="text-xs text-text-3 mt-1 leading-normal">
                        Complete data dump with ratings, watchlists, notes, and metadata.
                      </p>
                    </div>
                    <span className="text-xs font-medium text-accent mt-4 inline-flex items-center gap-1">
                      Download .json
                    </span>
                  </button>

                  <button
                    onClick={exportGeneralCSV}
                    className="flex flex-col justify-between p-4 rounded-card border border-hairline bg-surface-2 hover:bg-surface-3 text-left transition-all hover:border-hairline-strong group"
                  >
                    <div>
                      <div className="w-9 h-9 rounded-control bg-surface-3 border border-hairline flex items-center justify-center text-text-2 mb-3">
                        <FileSpreadsheet size={18} />
                      </div>
                      <h5 className="text-sm font-semibold text-text-1 group-hover:text-accent transition-colors">
                        General CSV Export
                      </h5>
                      <p className="text-xs text-text-3 mt-1 leading-normal">
                        Spreadsheet-friendly table containing ratings, genres, and directors.
                      </p>
                    </div>
                    <span className="text-xs font-medium text-text-2 mt-4 inline-flex items-center gap-1">
                      Download .csv
                    </span>
                  </button>

                  <button
                    onClick={exportLetterboxdCSV}
                    className="flex flex-col justify-between p-4 rounded-card border border-hairline bg-surface-2 hover:bg-surface-3 text-left transition-all hover:border-hairline-strong group"
                  >
                    <div>
                      <div className="w-9 h-9 rounded-control bg-surface-3 border border-hairline flex items-center justify-center text-text-2 mb-3">
                        <Star size={18} />
                      </div>
                      <h5 className="text-sm font-semibold text-text-1 group-hover:text-accent transition-colors">
                        Letterboxd CSV
                      </h5>
                      <p className="text-xs text-text-3 mt-1 leading-normal">
                        Formatted (Title, Year, Rating10) for importing ratings into Letterboxd.
                      </p>
                    </div>
                    <span className="text-xs font-medium text-text-2 mt-4 inline-flex items-center gap-1">
                      Download .csv
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-text-3 leading-relaxed">
                  Upload <code className="text-text-2 font-mono">.json</code> or <code className="text-text-2 font-mono">.csv</code> files. Supports CinemaVault JSON backups and Letterboxd CSV exports.
                </p>

                {/* Mode Selector */}
                <div className="flex items-center justify-between p-3 rounded-control border border-hairline bg-surface-2">
                  <span className="text-xs font-semibold text-text-2 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers size={14} /> Import Mode
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={importMode === "merge" ? "primary" : "ghost"}
                      onClick={() => setImportMode("merge")}
                    >
                      Merge (Keep Current)
                    </Button>
                    <Button
                      size="sm"
                      variant={importMode === "overwrite" ? "danger" : "ghost"}
                      onClick={() => setImportMode("overwrite")}
                    >
                      Overwrite
                    </Button>
                  </div>
                </div>

                {/* Dropzone */}
                <div
                  className="flex flex-col items-center justify-center p-8 rounded-card border-2 border-dashed border-hairline hover:border-accent/40 bg-surface-2/30 text-center cursor-pointer transition-colors"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    type="file"
                    accept=".json,.csv"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
                  <div className="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center text-text-2 mb-3">
                    <FileUp size={22} className="text-accent" />
                  </div>
                  <p className="text-sm font-medium text-text-1">
                    Drag & Drop backup file here, or <span className="text-accent underline underline-offset-4">browse</span>
                  </p>
                  <span className="text-xs text-text-3 mt-1">
                    Supported: CinemaVault .json backup, Letterboxd .csv export
                  </span>
                </div>

                {/* Result alerts */}
                {resultMessage && (
                  <div
                    className={`flex items-start gap-2.5 p-3 rounded-control border text-xs ${
                      resultMessage.type === "success"
                        ? "bg-match/10 border-match/30 text-match"
                        : resultMessage.type === "warning"
                        ? "bg-accent/10 border-accent/30 text-accent"
                        : "bg-danger/10 border-danger/30 text-danger"
                    }`}
                  >
                    {resultMessage.type === "success" && <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />}
                    {resultMessage.type === "warning" && <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />}
                    {resultMessage.type === "error" && <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />}
                    <span>{resultMessage.text}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
