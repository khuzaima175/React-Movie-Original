import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Cloud, Cpu, Dices, Download, Gamepad2, Search, Sparkles, Trophy, Upload } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { computeGameVaultStats } from "../services/gameVaultStorage";
import { normalizeGameBaseTitle, rankBacklogForNextPlay } from "../services/gameRankerService";
import { Select } from "../../components/ui/Select";
import ScrollRevealSection from "../../components/ScrollRevealSection";
import GameCard from "../components/GameCard";
import { EASE, springSnappy } from "../../motion";

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "completed", label: "Completed" },
  { value: "platinum", label: "100% Platinum" },
  { value: "playing", label: "Playing" },
  { value: "on_hold", label: "Unfinished / Paused" },
  { value: "tried_bored", label: "Tried — Got Bored" },
  { value: "dropped", label: "Dropped" },
  { value: "played", label: "Played" }
];

const SORT_VAULT_OPTIONS = [
  { value: "rating", label: "Highest Rated" },
  { value: "hours", label: "Most Hours" },
  { value: "recent", label: "Recently Updated" },
  { value: "title", label: "A–Z" }
];

export default function GamesVaultPage() {
  const {
    played,
    backlog,
    models,
    syncStatus,
    exportVaultJson,
    importGamesFromText,
    openRoulette,
    removePlayedGame,
    setOnboardingOpen
  } = useGameVault();
  const [tab, setTab] = useState("played");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("rating");
  const [searchQuery, setSearchQuery] = useState("");
  const [rankBacklogMl, setRankBacklogMl] = useState(true);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importFeedback, setImportFeedback] = useState("");

  useEffect(() => {
    document.title = "Game Vault | GameVault";
  }, []);

  const stats = useMemo(() => computeGameVaultStats(played, backlog), [played, backlog]);

  // Detect duplicate sibling editions (e.g. Divinity: Original Sin II + Definitive Edition)
  const duplicateEditionPairs = useMemo(() => {
    const groups = new Map();
    for (const g of played) {
      const base = normalizeGameBaseTitle(g.title);
      if (base.length < 4) continue;
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base).push(g);
    }
    return [...groups.values()].filter((arr) => arr.length > 1);
  }, [played]);

  async function handleMergeDuplicates() {
    for (const group of duplicateEditionPairs) {
      const sorted = [...group].sort(
        (a, b) =>
          (Number(b.userRating || 0) - Number(a.userRating || 0)) ||
          (Number(b.hoursPlayed || 0) - Number(a.hoursPlayed || 0)) ||
          (Number(b.ratingCount || 0) - Number(a.ratingCount || 0))
      );
      for (const dup of sorted.slice(1)) {
        await removePlayedGame(dup.igdbId);
      }
    }
  }

  const filteredPlayed = useMemo(() => {
    const cleanQ = searchQuery.trim().toLowerCase();
    const list = played.filter((g) => {
      if (statusFilter !== "all" && String(g.status || "") !== statusFilter) return false;
      if (cleanQ) {
        const hay = `${g.title || ""} ${(g.genres || []).join(" ")} ${g.platformPlayed || ""}`.toLowerCase();
        if (!hay.includes(cleanQ)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      if (sortBy === "rating") return (b.userRating || 0) - (a.userRating || 0);
      if (sortBy === "hours") return (b.hoursPlayed || 0) - (a.hoursPlayed || 0);
      if (sortBy === "title") return String(a.title || "").localeCompare(String(b.title || ""));
      return (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0);
    });
  }, [played, statusFilter, sortBy, searchQuery]);

  const displayedBacklog = useMemo(() => {
    const cleanQ = searchQuery.trim().toLowerCase();
    const base = rankBacklogMl && played.length > 0
      ? rankBacklogForNextPlay(backlog, played, models)
      : backlog;
    if (!cleanQ) return base;
    return base.filter((g) => `${g.title || ""} ${(g.genres || []).join(" ")}`.toLowerCase().includes(cleanQ));
  }, [backlog, played, models, rankBacklogMl, searchQuery]);

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
      <ScrollRevealSection className="gv-section-header">
        <div>
          <span className="gv-kicker">
            <Gamepad2 size={13} /> Personal Gaming Library
          </span>
          <h1 className="gv-hero-title" style={{ fontSize: "clamp(2.4rem, 3.4vw, 3.6rem)" }}>
            Your Game Vault
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {syncStatus === "synced" && (
            <span className="gv-pill gv-pill-match">
              <Cloud size={13} /> Cloud Synced
            </span>
          )}
          {(backlog.length > 0 || played.length > 0) && (
            <button type="button" className="gv-btn gv-btn-sm" onClick={() => openRoulette(displayedBacklog)}>
              <Dices size={14} /> Spin Roulette
            </button>
          )}
          <button type="button" className="gv-btn gv-btn-sm" onClick={() => setOnboardingOpen(true)}>
            <Cpu size={14} /> My Rig &amp; Setup
          </button>
          <button type="button" className="gv-btn gv-btn-sm" onClick={exportVaultJson}>
            <Download size={14} /> Export JSON
          </button>
        </div>
      </ScrollRevealSection>

      {duplicateEditionPairs.length > 0 && (
        <div className="gv-rig-strip" style={{ borderColor: "rgba(226, 177, 60, 0.35)" }}>
          <span className="text-[1.25rem] text-text-2">
            Found <strong>{duplicateEditionPairs.length}</strong> duplicate edition pair(s) in your Vault (e.g.{" "}
            {duplicateEditionPairs[0].map((g) => g.title).join(" & ")}).
          </span>
          <button type="button" className="gv-btn gv-btn-sm" onClick={handleMergeDuplicates}>
            Clean Up Duplicate Editions
          </button>
        </div>
      )}

      {/* Editorial Gaming DNA Banner with Animated Rating Spread & Genre Bars */}
      <ScrollRevealSection className="gv-dna-banner" delay={0.04}>
        <div className="gv-dna-kpis">
          <div className="gv-stat-box">
            <div className="gv-stat-val tabular-num">{stats.totalLogged}</div>
            <div className="gv-stat-lbl">Games Logged</div>
          </div>
          <div className="gv-stat-box">
            <div className="gv-stat-val tabular-num text-accent">{stats.avgRating ?? "—"}</div>
            <div className="gv-stat-lbl">Average Rating</div>
          </div>
          <div className="gv-stat-box">
            <div className="gv-stat-val tabular-num">{stats.totalHours.toLocaleString()}h</div>
            <div className="gv-stat-lbl">Tracked Playtime</div>
          </div>
          <div className="gv-stat-box">
            <div className="gv-stat-val tabular-num flex items-center gap-2">
              <span>{stats.completionRate}%</span>
              {stats.platinumCount > 0 && (
                <span className="text-[1.2rem] font-semibold text-accent inline-flex items-center gap-1">
                  <Trophy size={13} /> {stats.platinumCount}
                </span>
              )}
            </div>
            <div className="gv-stat-lbl">Completion Rate · {stats.backlogCount} Backlog</div>
          </div>
        </div>

        {/* 1-10 Rating Distribution Sparkline */}
        <div className="gv-dna-chart-card">
          <div className="flex items-center justify-between">
            <span className="text-[1.22rem] font-semibold text-text-1">Rating Spread (1–10)</span>
            <span className="text-[1.12rem] text-text-3 tabular-num">{stats.ratedCount} scored</span>
          </div>
          <div className="gv-hist-bars" aria-label="1 to 10 rating distribution">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((bucket) => {
              const cnt = stats.histogram[bucket] || 0;
              const pct = cnt > 0 ? Math.max(12, Math.round((cnt / stats.maxHistCount) * 100)) : 4;
              return (
                <div key={bucket} className="gv-hist-col" title={`${bucket}/10: ${cnt} game(s)`}>
                  <motion.div
                    className={`gv-hist-bar ${cnt === 0 ? "is-empty" : ""}`}
                    style={{ height: `${pct}%` }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.45, delay: bucket * 0.03, ease: EASE }}
                  />
                  <span className="gv-hist-lbl tabular-num">{bucket}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Genres Gaming DNA */}
        <div className="gv-dna-chart-card">
          <div className="flex items-center justify-between">
            <span className="text-[1.22rem] font-semibold text-text-1">Gaming Genre DNA</span>
            <span className="text-[1.12rem] text-text-3">Top affinities</span>
          </div>
          {stats.topGenres.length > 0 ? (
            <div className="gv-genre-dna-list">
              {stats.topGenres.slice(0, 4).map((g, i) => (
                <div key={g.name} className="gv-genre-dna-row">
                  <div className="gv-genre-dna-head">
                    <span className="truncate">{g.name}</span>
                    <span className="text-text-3 tabular-num">{g.count} ({g.pct}%)</span>
                  </div>
                  <div className="gv-genre-dna-track">
                    <motion.div
                      className="gv-genre-dna-fill"
                      style={{ width: `${Math.max(8, g.pct)}%` }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.5, delay: 0.08 + i * 0.06, ease: EASE }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[1.25rem] text-text-3 my-auto">Log games to visualize your genre DNA.</p>
          )}
        </div>
      </ScrollRevealSection>

      {/* Spring Sliding Tabs + Portaled Select Controls + Search */}
      <div className="gv-filter-bar">
        <div className="gv-segmented-bar" role="tablist" aria-label="Vault sections">
          {[
            { id: "played", label: `Played (${played.length})`, icon: null },
            { id: "backlog", label: `Backlog (${backlog.length})`, icon: null },
            { id: "import", label: "Import / Steam AppIDs", icon: Upload }
          ].map((item) => {
            const active = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`gv-segmented-btn ${active ? "is-active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {active && (
                  <motion.span layoutId="gv-vault-tab-pill" className="gv-segmented-bg" transition={springSnappy} />
                )}
                <span className="gv-segmented-label">
                  {Icon && <Icon size={13} aria-hidden="true" />}
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {(tab === "played" || tab === "backlog") && (
          <div className="flex flex-wrap items-center gap-3 ml-auto">
            <div className="gv-inline-search">
              <Search size={14} className="text-text-3 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your vault..."
                aria-label="Search your game vault"
              />
            </div>

            {tab === "played" && (
              <>
                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={STATUS_FILTER_OPTIONS}
                  ariaLabel="Filter status"
                  size="sm"
                />
                <Select
                  value={sortBy}
                  onChange={setSortBy}
                  options={SORT_VAULT_OPTIONS}
                  ariaLabel="Sort vault"
                  size="sm"
                />
              </>
            )}

            {tab === "backlog" && played.length > 0 && (
              <button
                type="button"
                className={`gv-chip gv-chip-sm ${rankBacklogMl ? "is-active" : ""}`}
                onClick={() => setRankBacklogMl((v) => !v)}
              >
                <Sparkles size={12} style={{ display: "inline", marginRight: "0.35rem" }} />
                Sort by ML Play-Next
              </button>
            )}
          </div>
        )}
      </div>

      {tab === "played" && (
        filteredPlayed.length === 0 ? (
          <div className="gv-panel text-center py-12">
            <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">
              {played.length === 0 ? "No games logged yet" : "No logged games match that filter"}
            </h3>
            <p className="text-[1.35rem] text-text-3">
              Search any PC, PlayStation, Nintendo, or Xbox game or import Steam AppIDs.
            </p>
          </div>
        ) : (
          <div className="gv-grid">
            {filteredPlayed.map((game, idx) => (
              <GameCard key={game.igdbId} game={game} showMatch={false} index={idx} revealIndex={idx} animateOnScroll />
            ))}
          </div>
        )
      )}

      {tab === "backlog" && (
        displayedBacklog.length === 0 ? (
          <div className="gv-panel text-center py-12">
            <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">Your backlog is empty</h3>
            <p className="text-[1.35rem] text-text-3">
              Bookmark games you want to play — they also feed light forward intent into EASE^R!
            </p>
          </div>
        ) : (
          <div className="gv-grid">
            {displayedBacklog.map((game, idx) => (
              <GameCard
                key={game.igdbId}
                game={game}
                showMatch={rankBacklogMl && played.length > 0}
                index={idx}
                revealIndex={idx}
                animateOnScroll
              />
            ))}
          </div>
        )
      )}

      {tab === "import" && (
        <ScrollRevealSection className="gv-panel">
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
        </ScrollRevealSection>
      )}
    </div>
  );
}
