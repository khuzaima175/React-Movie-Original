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

    const BATCH_SIZE = 4;
    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      const batch = parsedRows.slice(i, i + BATCH_SIZE);
      setProgress({ current: Math.min(i + batch.length, total), total, title: batch[0].title });

      await Promise.all(
        batch.map(async (row) => {
          if (cancelRef.current) return;

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

            let res = await fetch(fetchUrl, { cache: "no-store" });

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
                res = await fetch(fallbackUrl, { cache: "no-store" });
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
              const fallbackRes = await fetch(fallbackUrl, { cache: "no-store" });
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
        })
      );

      await new Promise((r) => setTimeout(r, 40));
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
      <div style={{ display: "flex", flexDirection: "column", gap: "2.4rem" }}>
        {/* Navigation Tabs */}
        {!isProcessing && (
          <Tabs
            tabs={modalTabs}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
        )}

        {/* Modal Body */}
        {isProcessing ? (
          <div style={{ padding: "3.6rem 0", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.8rem" }}>
              <Sparkles size={38} style={{ color: "#e2b13c" }} className="spin-icon" aria-hidden="true" />
            </div>
            <div>
              <h4 style={{ fontSize: "1.8rem", fontWeight: 700, color: "#f4f4f2" }}>Syncing with OMDb API...</h4>
              <p style={{ fontSize: "1.35rem", color: "#8a8a86", marginTop: "0.8rem" }}>
                Resolving: <strong style={{ color: "#f4f4f2" }}>{progress.title || "Initializing..."}</strong>
              </p>
            </div>

            <div style={{ width: "100%", maxWidth: "460px", margin: "2.4rem auto 1.2rem", background: "#242528", borderRadius: "9999px", height: "0.8rem", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div
                style={{
                  background: "#e2b13c",
                  height: "100%",
                  transition: "all 150ms ease",
                  borderRadius: "9999px",
                  width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`,
                }}
              />
            </div>

            <p style={{ fontSize: "1.25rem", fontFamily: "monospace", color: "#8a8a86" }}>
              Processed {progress.current} of {progress.total} films
            </p>

            <div style={{ marginTop: "2rem" }}>
              <Button variant="ghost" size="sm" onClick={cancelImport}>
                Cancel Import
              </Button>
            </div>
          </div>
        ) : (
          <>
            {activeTab === "export" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.8rem" }}>
                <p style={{ fontSize: "1.4rem", color: "#8a8a86", lineHeight: 1.6 }}>
                  Download local copies of your CinemaVault collections. Use them to migrate between devices, share ratings, or maintain off-site backups.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.6rem", paddingTop: "0.4rem" }}>
                  {/* Full JSON */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      padding: "2.4rem 2rem",
                      borderRadius: "1.4rem",
                      border: "1px solid rgba(255, 255, 255, 0.09)",
                      background: "#18191c",
                      textAlign: "left",
                      transition: "all 0.25s ease"
                    }}
                    className="hover:border-[#e2b13c]/50 hover:bg-[#1e1f23] group"
                  >
                    <div>
                      <div style={{ width: "4.6rem", height: "4.6rem", borderRadius: "1rem", background: "rgba(226, 177, 60, 0.14)", border: "1px solid rgba(226, 177, 60, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#e2b13c", marginBottom: "1.6rem" }}>
                        <FileJson size={22} />
                      </div>
                      <h5 style={{ fontSize: "1.6rem", fontWeight: 700, color: "#f4f4f2" }}>
                        Full JSON Backup
                      </h5>
                      <p style={{ fontSize: "1.3rem", color: "#8a8a86", marginTop: "0.6rem", lineHeight: 1.5 }}>
                        Complete data dump with ratings, watchlists, notes, and metadata.
                      </p>
                    </div>
                    <button
                      onClick={exportJSON}
                      style={{
                        fontSize: "1.35rem",
                        fontWeight: 600,
                        color: "#e2b13c",
                        marginTop: "2rem",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.6rem",
                        padding: "0.9rem 1.4rem",
                        borderRadius: "0.8rem",
                        background: "rgba(226, 177, 60, 0.12)",
                        border: "1px solid rgba(226, 177, 60, 0.3)",
                        cursor: "pointer",
                        width: "100%",
                        transition: "all 0.2s ease"
                      }}
                      className="hover:bg-[#e2b13c] hover:text-[#0b0b0c]"
                    >
                      <Download size={15} /> Download .json
                    </button>
                  </div>

                  {/* General CSV */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      padding: "2.4rem 2rem",
                      borderRadius: "1.4rem",
                      border: "1px solid rgba(255, 255, 255, 0.09)",
                      background: "#18191c",
                      textAlign: "left",
                      transition: "all 0.25s ease"
                    }}
                    className="hover:border-white/20 hover:bg-[#1e1f23] group"
                  >
                    <div>
                      <div style={{ width: "4.6rem", height: "4.6rem", borderRadius: "1rem", background: "#242528", border: "1px solid rgba(255, 255, 255, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#b6b6b2", marginBottom: "1.6rem" }}>
                        <FileSpreadsheet size={22} />
                      </div>
                      <h5 style={{ fontSize: "1.6rem", fontWeight: 700, color: "#f4f4f2" }}>
                        General CSV Export
                      </h5>
                      <p style={{ fontSize: "1.3rem", color: "#8a8a86", marginTop: "0.6rem", lineHeight: 1.5 }}>
                        Spreadsheet-friendly table containing ratings, genres, and directors.
                      </p>
                    </div>
                    <button
                      onClick={exportGeneralCSV}
                      style={{
                        fontSize: "1.35rem",
                        fontWeight: 600,
                        color: "#b6b6b2",
                        marginTop: "2rem",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.6rem",
                        padding: "0.9rem 1.4rem",
                        borderRadius: "0.8rem",
                        background: "#242528",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        cursor: "pointer",
                        width: "100%",
                        transition: "all 0.2s ease"
                      }}
                      className="hover:bg-white/10 hover:text-[#f4f4f2]"
                    >
                      <Download size={15} /> Download .csv
                    </button>
                  </div>

                  {/* Letterboxd CSV */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      padding: "2.4rem 2rem",
                      borderRadius: "1.4rem",
                      border: "1px solid rgba(255, 255, 255, 0.09)",
                      background: "#18191c",
                      textAlign: "left",
                      transition: "all 0.25s ease"
                    }}
                    className="hover:border-[#e2b13c]/50 hover:bg-[#1e1f23] group"
                  >
                    <div>
                      <div style={{ width: "4.6rem", height: "4.6rem", borderRadius: "1rem", background: "#242528", border: "1px solid rgba(255, 255, 255, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#e2b13c", marginBottom: "1.6rem" }}>
                        <Star size={22} />
                      </div>
                      <h5 style={{ fontSize: "1.6rem", fontWeight: 700, color: "#f4f4f2" }}>
                        Letterboxd CSV
                      </h5>
                      <p style={{ fontSize: "1.3rem", color: "#8a8a86", marginTop: "0.6rem", lineHeight: 1.5 }}>
                        Formatted (Title, Year, Rating10) for importing ratings into Letterboxd.
                      </p>
                    </div>
                    <button
                      onClick={exportLetterboxdCSV}
                      style={{
                        fontSize: "1.35rem",
                        fontWeight: 600,
                        color: "#e2b13c",
                        marginTop: "2rem",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.6rem",
                        padding: "0.9rem 1.4rem",
                        borderRadius: "0.8rem",
                        background: "rgba(226, 177, 60, 0.12)",
                        border: "1px solid rgba(226, 177, 60, 0.3)",
                        cursor: "pointer",
                        width: "100%",
                        transition: "all 0.2s ease"
                      }}
                      className="hover:bg-[#e2b13c] hover:text-[#0b0b0c]"
                    >
                      <Download size={15} /> Download .csv
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.8rem" }}>
                <p style={{ fontSize: "1.35rem", color: "#8a8a86", lineHeight: 1.6 }}>
                  Upload <code style={{ color: "#f4f4f2", background: "#242528", padding: "0.2rem 0.6rem", borderRadius: "0.4rem" }}>.json</code> or <code style={{ color: "#f4f4f2", background: "#242528", padding: "0.2rem 0.6rem", borderRadius: "0.4rem" }}>.csv</code> files. Supports CinemaVault JSON backups and Letterboxd CSV exports.
                </p>

                {/* Mode Selector */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.4rem 1.8rem", borderRadius: "1rem", border: "1px solid rgba(255, 255, 255, 0.1)", background: "#1c1d20" }}>
                  <span style={{ fontSize: "1.3rem", fontWeight: 600, color: "#b6b6b2", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: "0.8rem" }}>
                    <Layers size={16} style={{ color: "#e2b13c" }} /> Import Mode
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
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
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "3.6rem 2rem",
                    borderRadius: "1.4rem",
                    border: "2px dashed rgba(255, 255, 255, 0.16)",
                    background: "rgba(28, 29, 32, 0.35)",
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "all 0.2s ease"
                  }}
                  className="hover:border-[#e2b13c]/50 hover:bg-[#1c1d20]/50"
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
                  <div style={{ width: "5.2rem", height: "5.2rem", borderRadius: "50%", background: "#242528", display: "flex", alignItems: "center", justifyContent: "center", color: "#e2b13c", marginBottom: "1.4rem" }}>
                    <FileUp size={24} />
                  </div>
                  <p style={{ fontSize: "1.5rem", fontWeight: 500, color: "#f4f4f2" }}>
                    Drag & Drop backup file here, or <span style={{ color: "#e2b13c", textDecoration: "underline", textUnderlineOffset: "4px" }}>browse</span>
                  </p>
                  <span style={{ fontSize: "1.25rem", color: "#8a8a86", marginTop: "0.6rem" }}>
                    Supported: CinemaVault .json backup, Letterboxd .csv export
                  </span>
                </div>

                {/* Result alerts */}
                {resultMessage && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "1.2rem",
                      padding: "1.4rem 1.6rem",
                      borderRadius: "0.8rem",
                      fontSize: "1.3rem",
                      background: resultMessage.type === "success"
                        ? "rgba(70, 211, 105, 0.1)"
                        : resultMessage.type === "warning"
                        ? "rgba(226, 177, 60, 0.1)"
                        : "rgba(229, 72, 77, 0.1)",
                      border: resultMessage.type === "success"
                        ? "1px solid rgba(70, 211, 105, 0.3)"
                        : resultMessage.type === "warning"
                        ? "1px solid rgba(226, 177, 60, 0.3)"
                        : "1px solid rgba(229, 72, 77, 0.3)",
                      color: resultMessage.type === "success"
                        ? "#46d369"
                        : resultMessage.type === "warning"
                        ? "#e2b13c"
                        : "#e5484d"
                    }}
                  >
                    {resultMessage.type === "success" && <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: "0.2rem" }} />}
                    {resultMessage.type === "warning" && <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "0.2rem" }} />}
                    {resultMessage.type === "error" && <AlertCircle size={18} style={{ flexShrink: 0, marginTop: "0.2rem" }} />}
                    <span style={{ lineHeight: 1.5 }}>{resultMessage.text}</span>
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
