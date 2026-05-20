import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "../context/AppContext";

const getOmdbKey = () => {
    const key = import.meta.env.VITE_OMDB_KEY;
    if (!key || key === "undefined" || key === "null" || key.trim() === "") {
        return "b78bdecd";
    }
    return key.trim();
};
const KEY = getOmdbKey();

export default function BackupManagerModal({ isOpen, onClose }) {
  const { watched, watchlist, setWatched, setWatchlist } = useApp();
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
    // Unicode stars check (e.g. ★★★★½)
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
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(
      JSON.stringify({ watched, watchlist }, null, 2)
    );
    triggerDownload(dataStr, "cinemavault_backup.json");
  }

  function exportGeneralCSV() {
    const headers = ["Title", "Year", "IMDb ID", "IMDb Rating", "Runtime", "My Rating", "Notes", "Genres", "Director", "Type"];
    const rows = [
      ...watched.map(m => [m.title, m.year, m.imdbID, m.imdbRating, m.runtime, m.userRating, m.userNote || "", m.genre || "", m.director || "", "Watched"]),
      ...watchlist.map(m => [m.title, m.year, m.imdbID, m.imdbRating, m.runtime, "", "", "", "", "Watchlist"])
    ];
    
    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "cinemavault_collection.csv");
  }

  function exportLetterboxdCSV() {
    // Letterboxd import template requires: Title, Year, Rating10
    const headers = ["Title", "Year", "Rating10"];
    const rows = watched.map(m => [m.title, m.year, m.userRating]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
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
        setResultMessage({ type: "error", text: "Unsupported file type. Please upload a .json or .csv file." });
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
          text: `Success! Vault overwritten with ${newWatchedList.length} rated films and ${newWatchlistList.length} watchlist titles.`
        });
      } else {
        // Merge
        setWatched(prev => {
          const existingIds = new Set(prev.map(m => m.imdbID));
          const filteredNew = newWatchedList.filter(m => !existingIds.has(m.imdbID));
          return [...prev, ...filteredNew];
        });
        setWatchlist(prev => {
          const existingIds = new Set(prev.map(m => m.imdbID));
          const filteredNew = newWatchlistList.filter(m => !existingIds.has(m.imdbID));
          return [...prev, ...filteredNew];
        });
        
        setResultMessage({
          type: "success",
          text: `Success! Merged data. Added newly found items.`
        });
      }
    } catch (err) {
      setResultMessage({ type: "error", text: `JSON Parse Error: ${err.message}` });
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleCSVImport(content) {
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length <= 1) {
      setResultMessage({ type: "error", text: "CSV is empty or missing data." });
      setIsProcessing(false);
      return;
    }

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/["']/g, ""));
    
    // Column Index Mapping
    const titleIdx = headers.findIndex(h => h.includes("title") || h.includes("name"));
    const yearIdx = headers.findIndex(h => h.includes("year") || h.includes("released"));
    const ratingIdx = headers.findIndex(h => h.includes("rating") || h.includes("userrating") || h.includes("stars"));
    const noteIdx = headers.findIndex(h => h.includes("note") || h.includes("review") || h.includes("comment"));
    const typeIdx = headers.findIndex(h => h.includes("type") || h.includes("list"));
    const imdbIdIdx = headers.findIndex(h => h.includes("imdb") || h.includes("id"));

    // Fallbacks if headers are completely generic
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
        imdbId: finalImdbIdIdx !== -1 && cols[finalImdbIdIdx] ? cols[finalImdbIdIdx].trim() : ""
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

      const fallbackMovie = (reason) => {
        const tempId = row.imdbId || `csv-${Math.random().toString(36).substr(2, 9)}`;
        const isWatchlist = row.type.toLowerCase().includes("watchlist") || (!row.rating && row.type.toLowerCase() !== "watched");
        
        if (isWatchlist) {
          resolvedWatchlist.push({
            imdbID: tempId,
            title: row.title,
            year: row.year || "N/A",
            poster: "https://via.placeholder.com/300x450/374151/9ca3af?text=No+Poster",
            imdbRating: 0,
            runtime: 0,
          });
        } else {
          resolvedWatched.push({
            imdbID: tempId,
            title: row.title,
            year: row.year || "N/A",
            poster: "https://via.placeholder.com/300x450/374151/9ca3af?text=No+Poster",
            imdbRating: 0,
            runtime: 0,
            userRating: row.rating || 5,
            userNote: row.note || "",
            director: "Unknown",
            writer: "Unknown",
            genre: "Unknown",
            shortPlot: "Imported via CSV backup."
          });
        }
      };

      try {
        let fetchUrl = "";
        if (row.imdbId && row.imdbId.startsWith("tt")) {
          fetchUrl = `https://www.omdbapi.com/?apikey=${KEY}&i=${row.imdbId}`;
        } else {
          fetchUrl = `https://www.omdbapi.com/?apikey=${KEY}&t=${encodeURIComponent(row.title)}${row.year ? `&y=${row.year}` : ""}`;
        }

        let res = await fetch(fetchUrl);
        
        // Retry with default key on network issue or unauthorized (401)
        if (!res.ok || res.status === 401) {
          if (KEY !== "b78bdecd") {
            let fallbackUrl = "";
            if (row.imdbId && row.imdbId.startsWith("tt")) {
              fallbackUrl = `https://www.omdbapi.com/?apikey=b78bdecd&i=${row.imdbId}`;
            } else {
              fallbackUrl = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(row.title)}${row.year ? `&y=${row.year}` : ""}`;
            }
            res = await fetch(fallbackUrl);
          }
        }

        if (!res.ok) throw new Error("Network issues");
        let data = await res.json();

        // Retry with default key if response shows credential issues
        if (data.Response === "False" && data.Error && (data.Error.includes("key") || data.Error.includes("credential")) && KEY !== "b78bdecd") {
          let fallbackUrl = "";
          if (row.imdbId && row.imdbId.startsWith("tt")) {
            fallbackUrl = `https://www.omdbapi.com/?apikey=b78bdecd&i=${row.imdbId}`;
          } else {
            fallbackUrl = `https://www.omdbapi.com/?apikey=b78bdecd&t=${encodeURIComponent(row.title)}${row.year ? `&y=${row.year}` : ""}`;
          }
          const fallbackRes = await fetch(fallbackUrl);
          if (fallbackRes.ok) {
            data = await fallbackRes.json();
          }
        }

        if (data.Response === "True") {
          // If rating isn't present but row type isn't specified, watchlist is empty rating
          const isWatchlist = row.type.toLowerCase().includes("watchlist") || (row.rating === null && !row.type);
          
          if (isWatchlist) {
            resolvedWatchlist.push({
              imdbID: data.imdbID,
              title: data.Title,
              year: data.Year,
              poster: data.Poster !== "N/A" ? data.Poster : "https://via.placeholder.com/300x450/374151/9ca3af?text=No+Poster",
              imdbRating: Number(data.imdbRating) || 0,
              runtime: Number(data.Runtime?.split(" ")[0] || 0),
            });
          } else {
            resolvedWatched.push({
              imdbID: data.imdbID,
              title: data.Title,
              year: data.Year,
              poster: data.Poster !== "N/A" ? data.Poster : "https://via.placeholder.com/300x450/374151/9ca3af?text=No+Poster",
              imdbRating: Number(data.imdbRating) || 0,
              runtime: Number(data.Runtime?.split(" ")[0] || 0),
              userRating: row.rating || 7,
              userNote: row.note || "",
              director: data.Director || "Unknown",
              writer: data.Writer || "Unknown",
              genre: data.Genre || "Unknown",
              shortPlot: data.Plot ? data.Plot.split(" ").slice(0, 15).join(" ") + "..." : "",
            });
          }
        } else {
          fallbackMovie("Not found in OMDb");
        }
      } catch (err) {
        fallbackMovie(err.message);
      }

      // Add a tiny delay to avoid hitting API rate limits
      await new Promise(r => setTimeout(r, 120));
    }

    if (cancelRef.current) {
      setResultMessage({ type: "warning", text: "Import cancelled mid-way. No collections were saved." });
      setIsProcessing(false);
      return;
    }

    // Apply Changes
    if (importMode === "overwrite") {
      setWatched(resolvedWatched);
      setWatchlist(resolvedWatchlist);
    } else {
      setWatched(prev => {
        const existingIds = new Set(prev.map(m => m.imdbID));
        const filteredNew = resolvedWatched.filter(m => !existingIds.has(m.imdbID));
        return [...prev, ...filteredNew];
      });
      setWatchlist(prev => {
        const existingIds = new Set(prev.map(m => m.imdbID));
        const filteredNew = resolvedWatchlist.filter(m => !existingIds.has(m.imdbID));
        return [...prev, ...filteredNew];
      });
    }

    setResultMessage({
      type: "success",
      text: `Import Completed! Successfully resolved and processed ${resolvedWatched.length} watched films and ${resolvedWatchlist.length} watchlist items.`
    });
    setIsProcessing(false);
  }

  function cancelImport() {
    cancelRef.current = true;
  }

  return (
    <AnimatePresence>
      <div className="backup-modal-overlay" onClick={isProcessing ? undefined : onClose}>
        <motion.div
          className="backup-modal-container"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: "spring", duration: 0.4 }}
        >
          {/* Header */}
          <div className="backup-modal-header">
            <h3>⚙️ Vault Manager</h3>
            <button className="backup-close-btn" onClick={onClose} disabled={isProcessing}>✕</button>
          </div>

          {/* Tabs */}
          {!isProcessing && (
            <div className="backup-modal-tabs">
              <button
                className={`backup-tab-btn ${activeTab === "export" ? "active" : ""}`}
                onClick={() => setActiveTab("export")}
              >
                📤 Export Backup
              </button>
              <button
                className={`backup-tab-btn ${activeTab === "import" ? "active" : ""}`}
                onClick={() => setActiveTab("import")}
              >
                📥 Import Backup
              </button>
            </div>
          )}

          {/* Content */}
          <div className="backup-modal-body">
            {isProcessing ? (
              <div className="backup-processing-screen">
                <div className="spinner-glow"></div>
                <h4>Syncing collections with OMDb API...</h4>
                <p className="resolving-title">Resolving: {progress.title || "Initializing..."}</p>
                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                  ></div>
                </div>
                <p className="progress-numbers">
                  Processed {progress.current} of {progress.total} items
                </p>
                <button className="btn-cancel-import" onClick={cancelImport}>
                  Cancel Import
                </button>
              </div>
            ) : (
              <>
                {activeTab === "export" ? (
                  <div className="backup-export-section">
                    <p className="section-description">
                      Download local copies of your CinemaVault collections. Use them to migrate between devices, share lists, or back up reviews.
                    </p>
                    <div className="export-options-grid">
                      <button className="export-card" onClick={exportJSON}>
                        <span className="card-icon">📁</span>
                        <div>
                          <h5>Full JSON Backup</h5>
                          <p>Complete data dump of ratings, watchlist, and notes. Perfect for full CinemaVault restoration.</p>
                        </div>
                      </button>
                      <button className="export-card" onClick={exportGeneralCSV}>
                        <span className="card-icon">📄</span>
                        <div>
                          <h5>General CSV Export</h5>
                          <p>Standard spreadsheet-friendly table containing key stats, user notes, and metadata.</p>
                        </div>
                      </button>
                      <button className="export-card" onClick={exportLetterboxdCSV}>
                        <span className="card-icon">🌟</span>
                        <div>
                          <h5>Letterboxd Import CSV</h5>
                          <p>Special CSV format (Title, Year, Rating10) tailored specifically for importing ratings into Letterboxd.</p>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="backup-import-section">
                    <p className="section-description">
                      Upload `.json` or `.csv` files to populate your lists. CinemaVault supports its own JSON backups and standard Letterboxd CSV tables.
                    </p>
                    
                    {/* Settings */}
                    <div className="import-settings-row">
                      <span className="settings-label">Import Mode:</span>
                      <div className="import-mode-toggle">
                        <button
                          className={`mode-toggle-btn ${importMode === "merge" ? "active" : ""}`}
                          onClick={() => setImportMode("merge")}
                        >
                          🔗 Merge (Keep current data)
                        </button>
                        <button
                          className={`mode-toggle-btn ${importMode === "overwrite" ? "active" : ""}`}
                          onClick={() => setImportMode("overwrite")}
                        >
                          ⚠️ Overwrite (Clear current data)
                        </button>
                      </div>
                    </div>

                    {/* Drag and drop zone */}
                    <div
                      className="import-dropzone"
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
                      <span className="dropzone-icon">📥</span>
                      <p>Drag & Drop a backup file here, or <strong>click to browse</strong></p>
                      <span className="dropzone-sub">Supports .json backups and .csv exports</span>
                    </div>

                    {/* Result message */}
                    {resultMessage && (
                      <div className={`import-alert ${resultMessage.type}`}>
                        {resultMessage.type === "success" ? "✅" : resultMessage.type === "warning" ? "⚠️" : "❌"} {resultMessage.text}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
