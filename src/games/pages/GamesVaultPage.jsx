import { useEffect, useMemo, useState } from "react";
import { Download, Upload, Cloud, Gamepad2 } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import GameCard from "../components/GameCard";

export default function GamesVaultPage() {
  const { played, backlog, syncStatus, exportVaultJson, importGamesFromText } = useGameVault();
  const [tab, setTab] = useState("played");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("rating");
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importFeedback, setImportFeedback] = useState("");

  useEffect(() => {
    document.title = "Game Vault | GameVault";
  }, []);

  const totalHours = useMemo(
    () => Math.round(played.reduce((sum, g) => sum + (Number(g.hoursPlayed) || 0), 0) * 10) / 10,
    [played]
  );

  const avgRating = useMemo(() => {
    const rated = played.filter((g) => Number(g.userRating) > 0);
    if (rated.length === 0) return "—";
    return (rated.reduce((s, g) => s + Number(g.userRating), 0) / rated.length).toFixed(1);
  }, [played]);

  const filteredPlayed = useMemo(() => {
    const list = played.filter((g) => (statusFilter === "all" ? true : String(g.status || "") === statusFilter));
    return [...list].sort((a, b) => {
      if (sortBy === "rating") return (b.userRating || 0) - (a.userRating || 0);
      if (sortBy === "hours") return (b.hoursPlayed || 0) - (a.hoursPlayed || 0);
      if (sortBy === "title") return String(a.title || "").localeCompare(String(b.title || ""));
      return (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0);
    });
  }, [played, statusFilter, sortBy]);

  async function handleRunImport(e) {
    e.preventDefault();
    if (!importText.trim()) return;
    setImportBusy(true);
    setImportFeedback("");
    try {
      const res = await importGamesFromText(importText);
      setImportFeedback(
        `Imported ${res.addedPlayed} played game(s) and ${res.addedBacklog} backlog game(s)` +
          (res.unresolvedSteamCount > 0 ? ` (${res.unresolvedSteamCount} Steam AppID(s) not in crosswalk)` : ".")
      );
      setImportText("");
    } catch {
      setImportFeedback("Import failed. Check your JSON, CSV, or Steam AppID list.");
    } finally {
      setImportBusy(false);
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result || ""));
    reader.readAsText(file);
  }

  return (
    <div className="gv-page page-rail">
      <div className="gv-section-header">
        <div>
          <span className="gv-kicker">
            <Gamepad2 size={13} /> Personal Gaming Library
          </span>
          <h1 className="gv-hero-title" style={{ fontSize: "clamp(2.4rem, 3.4vw, 3.4rem)" }}>
            Your Game Vault
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {syncStatus === "synced" && (
            <span className="gv-pill gv-pill-match">
              <Cloud size={13} /> Cloud Synced
            </span>
          )}
          <button type="button" className="gv-btn gv-btn-sm" onClick={exportVaultJson}>
            <Download size={14} /> Export JSON
          </button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="gv-stats-strip">
        <div className="gv-stat-box">
          <div className="gv-stat-val tabular-num">{played.length}</div>
          <div className="gv-stat-lbl">Games Logged</div>
        </div>
        <div className="gv-stat-box">
          <div className="gv-stat-val tabular-num">{avgRating}</div>
          <div className="gv-stat-lbl">Average Rating</div>
        </div>
        <div className="gv-stat-box">
          <div className="gv-stat-val tabular-num">{totalHours.toLocaleString()}h</div>
          <div className="gv-stat-lbl">Tracked Playtime</div>
        </div>
        <div className="gv-stat-box">
          <div className="gv-stat-val tabular-num">{backlog.length}</div>
          <div className="gv-stat-lbl">Backlog Queue</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="gv-filter-bar">
        <div className="gv-chip-group">
          <button type="button" className={`gv-chip ${tab === "played" ? "is-active" : ""}`} onClick={() => setTab("played")}>
            Played ({played.length})
          </button>
          <button type="button" className={`gv-chip ${tab === "backlog" ? "is-active" : ""}`} onClick={() => setTab("backlog")}>
            Backlog ({backlog.length})
          </button>
          <button type="button" className={`gv-chip ${tab === "import" ? "is-active" : ""}`} onClick={() => setTab("import")}>
            <Upload size={13} style={{ display: "inline", marginRight: "0.4rem" }} />
            Import / Steam AppIDs
          </button>
        </div>

        {tab === "played" && (
          <div className="flex flex-wrap items-center gap-3 ml-auto">
            <select
              aria-label="Filter status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="gv-input"
              style={{ width: "auto" }}
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="playing">Playing</option>
              <option value="dropped">Dropped</option>
            </select>

            <select
              aria-label="Sort vault"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="gv-input"
              style={{ width: "auto" }}
            >
              <option value="rating">Highest Rated</option>
              <option value="hours">Most Hours</option>
              <option value="recent">Recently Updated</option>
              <option value="title">A–Z</option>
            </select>
          </div>
        )}
      </div>

      {tab === "played" && (
        filteredPlayed.length === 0 ? (
          <div className="gv-panel text-center py-12">
            <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">No games logged yet</h3>
            <p className="text-[1.35rem] text-text-3">Search any PC, PlayStation, Nintendo, or Xbox game or import Steam AppIDs.</p>
          </div>
        ) : (
          <div className="gv-grid">
            {filteredPlayed.map((game) => (
              <GameCard key={game.igdbId} game={game} showMatch={false} />
            ))}
          </div>
        )
      )}

      {tab === "backlog" && (
        backlog.length === 0 ? (
          <div className="gv-panel text-center py-12">
            <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">Your backlog is empty</h3>
            <p className="text-[1.35rem] text-text-3">Bookmark games you want to play — they also feed light forward intent into EASE^R!</p>
          </div>
        ) : (
          <div className="gv-grid">
            {backlog.map((game) => (
              <GameCard key={game.igdbId} game={game} showMatch={false} />
            ))}
          </div>
        )
      )}

      {tab === "import" && (
        <section className="gv-panel">
          <h2 className="gv-section-title mb-2">Import Games (JSON, CSV, or Steam AppIDs)</h2>
          <p className="gv-section-sub mb-4">
            Paste a GameVault JSON backup, a CSV (`appid,rating,hours`), or a comma/line-separated list of Steam AppIDs or Steam Store URLs — mapped locally across 18,144 games via `game_steam_to_igdb.json`.
          </p>

          <form onSubmit={handleRunImport} className="flex flex-col gap-4">
            <input type="file" accept=".json,.csv,.txt" onChange={handleFileUpload} className="text-[1.3rem] text-text-2" />
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"Example Steam AppIDs:\n1245620, 292030, 367520, 1145360, 2379780\n\nOr paste GameVault JSON / CSV here..."}
              className="gv-textarea"
              style={{ minHeight: "14rem" }}
            />
            <div className="flex items-center gap-4">
              <button type="submit" disabled={importBusy || !importText.trim()} className="gv-btn gv-btn-primary">
                {importBusy ? "Resolving via IGDB..." : "Import Into Game Vault"}
              </button>
              {importFeedback && <span className="text-[1.3rem] text-match">{importFeedback}</span>}
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
