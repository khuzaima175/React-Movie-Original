import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Cloud,
  Cpu,
  Dices,
  Download,
  MoreHorizontal,
  Search,
  Sparkles,
  Star,
  Trophy,
  Upload
} from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { computeGameVaultStats } from "../services/gameVaultStorage";
import { normalizeGameBaseTitle, rankBacklogForNextPlay } from "../services/gameRankerService";
import { Select } from "../../components/ui/Select";
import { Tabs } from "../../components/ui/Tabs";
import { Menu } from "../../components/ui/Menu";
import GameCard from "../components/GameCard";
import { EASE } from "../../motion";

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
  const [ratingFilter, setRatingFilter] = useState(null);
  const [sortBy, setSortBy] = useState("rating");
  const [searchQuery, setSearchQuery] = useState("");
  const [showInsights, setShowInsights] = useState(false);
  const [rankBacklogMl, setRankBacklogMl] = useState(true);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importFeedback, setImportFeedback] = useState("");

  useEffect(() => {
    document.title = "My Game Vault | GameVault";
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
      if (ratingFilter !== null && Number(g.userRating) !== ratingFilter) return false;
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
  }, [played, statusFilter, ratingFilter, sortBy, searchQuery]);

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
          (res.unresolvedSteamCount > 0 ? ` (${res.unresolvedSteamCount} Steam AppID(s) unresolved)` : ".")
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
      {/* Compact Single-Panel Editorial Vault Header (Mirrors CinemaVault My Vault) */}
      <section className="gv-vault-hero" aria-label="Game Vault Summary">
        <div className="gv-vault-hero-left">
          <div>
            <h1 className="gv-page-title">My Game Vault</h1>
            <p className="gv-page-subtitle">
              Your personal ledger of logged games and backlog.
            </p>
          </div>

          <div className="gv-vault-stats-strip">
            <div className="gv-vault-stat-item">
              <span className="gv-vault-stat-val tabular-num">{stats.totalLogged}</span>
              <span className="gv-vault-stat-lbl">Games logged</span>
            </div>

            <div className="gv-vault-stat-item">
              <span className="gv-vault-stat-val tabular-num">
                <Star size={16} fill="currentColor" style={{ color: "var(--accent)" }} aria-hidden="true" />
                {stats.avgRating ?? "—"}
              </span>
              <span className="gv-vault-stat-lbl">Average rating</span>
            </div>

            <div className="gv-vault-stat-item">
              <span className="gv-vault-stat-val tabular-num">{stats.totalHours.toLocaleString()}h</span>
              <span className="gv-vault-stat-lbl">Playtime</span>
            </div>

            <div className="gv-vault-stat-item">
              <span className="gv-vault-stat-val tabular-num">
                {stats.completionRate}%
                {stats.platinumCount > 0 && (
                  <span className="text-[1.25rem] font-semibold inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                    <Trophy size={13} aria-hidden="true" />
                    {stats.platinumCount}
                  </span>
                )}
              </span>
              <span className="gv-vault-stat-lbl">Completion</span>
            </div>
          </div>
        </div>

        {/* Clickable 1-10 Rating Spread Mini-Histogram */}
        <div className="gv-mini-histogram" aria-label="Rating spread filter">
          <div className="gv-mini-hist-head">
            <span className="gv-mini-hist-title">Rating Spread</span>
            {ratingFilter !== null ? (
              <button
                type="button"
                className="gv-mini-hist-clear"
                onClick={() => setRatingFilter(null)}
              >
                ★ {ratingFilter} · Clear
              </button>
            ) : (
              <span className="text-[1.1rem] text-text-3 tabular-num">{stats.ratedCount} rated</span>
            )}
          </div>

          <div className="gv-mini-hist-bars">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((bucket) => {
              const cnt = stats.histogram[bucket] || 0;
              const pct = cnt > 0 ? Math.max(16, Math.round((cnt / stats.maxHistCount) * 100)) : 0;
              const isSelected = ratingFilter === bucket;
              return (
                <button
                  key={bucket}
                  type="button"
                  disabled={cnt === 0}
                  className={`gv-mini-hist-bar ${cnt === 0 ? "is-empty" : ""} ${isSelected ? "is-active" : ""}`}
                  onClick={() => {
                    if (cnt === 0) return;
                    setTab("played");
                    setRatingFilter((prev) => (prev === bucket ? null : bucket));
                  }}
                  title={`${bucket}/10: ${cnt} game(s)`}
                >
                  <span className="gv-mini-hist-track">
                    {cnt > 0 && (
                      <span
                        className={`gv-mini-hist-fill ${bucket >= 8 ? "is-gold" : ""}`}
                        style={{ height: `${pct}%` }}
                      />
                    )}
                  </span>
                  <span className="gv-mini-hist-num tabular-num">{bucket}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Clean Header Actions (Insights toggle + Tools Dropdown) */}
        <div className="gv-vault-hero-actions">
          {syncStatus === "synced" && (
            <span className="gv-pill gv-pill-match">
              <Cloud size={12} aria-hidden="true" /> Synced
            </span>
          )}

          <button
            type="button"
            className={`gv-btn gv-btn-sm ${showInsights ? "gv-btn-accent" : ""}`}
            onClick={() => setShowInsights((v) => !v)}
          >
            <BarChart3 size={14} aria-hidden="true" />
            Insights
          </button>

          <Menu>
            <Menu.Trigger className="gv-btn gv-btn-sm" aria-label="Vault tools">
              <MoreHorizontal size={15} aria-hidden="true" />
              Tools
            </Menu.Trigger>
            <Menu.Panel align="right">
              <Menu.Label>Library Tools</Menu.Label>
              {(backlog.length > 0 || played.length > 0) && (
                <Menu.Item icon={Dices} onClick={() => openRoulette(displayedBacklog)}>
                  Spin Game Roulette
                </Menu.Item>
              )}
              <Menu.Item icon={Cpu} onClick={() => setOnboardingOpen(true)}>
                My Rig &amp; Taste Setup
              </Menu.Item>
              <Menu.Item icon={Download} onClick={exportVaultJson}>
                Export JSON Backup
              </Menu.Item>
              <Menu.Item icon={Upload} onClick={() => setTab("import")}>
                Import Steam / JSON / CSV
              </Menu.Item>
            </Menu.Panel>
          </Menu>
        </div>
      </section>

      {/* Expandable Genre DNA Insights Drawer (Hidden by default for clean above-the-fold library) */}
      {showInsights && (
        <div className="gv-insights-drawer">
          <div className="gv-dna-chart-card">
            <div className="flex items-center justify-between">
              <span className="text-[1.3rem] font-semibold text-text-1">Top Genre Affinities</span>
              <span className="text-[1.15rem] text-text-3">Share of logged library</span>
            </div>
            {stats.topGenres.length > 0 ? (
              <div className="gv-genre-dna-list">
                {stats.topGenres.slice(0, 5).map((g, i) => (
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
                        transition={{ duration: 0.45, delay: 0.05 + i * 0.05, ease: EASE }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[1.28rem] text-text-3">Log a few games to visualize your top genres.</p>
            )}
          </div>

          <div className="gv-dna-chart-card justify-between">
            <div>
              <div className="text-[1.3rem] font-semibold text-text-1 mb-1">Vault Highlights</div>
              <p className="text-[1.25rem] text-text-2 leading-relaxed">
                {stats.totalLogged > 0
                  ? `You've logged ${stats.totalLogged} games totaling ${stats.totalHours.toLocaleString()} hours, with ${stats.backlogCount} queued in your backlog.`
                  : "Start logging games you have played or finished to unlock insights."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 pt-2">
              {(backlog.length > 0 || played.length > 0) && (
                <button type="button" className="gv-btn gv-btn-sm" onClick={() => openRoulette(displayedBacklog)}>
                  <Dices size={13} aria-hidden="true" /> Spin Roulette
                </button>
              )}
              <button type="button" className="gv-btn gv-btn-sm" onClick={() => setOnboardingOpen(true)}>
                <Cpu size={13} aria-hidden="true" /> Configure Rig
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateEditionPairs.length > 0 && (
        <div className="gv-rig-strip" style={{ borderColor: "rgba(229, 184, 75, 0.35)" }}>
          <span className="text-[1.25rem] text-text-2">
            Found <strong>{duplicateEditionPairs.length}</strong> duplicate edition pair(s) (e.g.{" "}
            {duplicateEditionPairs[0].map((g) => g.title).join(" & ")}).
          </span>
          <button type="button" className="gv-btn gv-btn-sm" onClick={handleMergeDuplicates}>
            Clean Up Duplicate Editions
          </button>
        </div>
      )}

      {/* Editorial Underline Tabs + Search + Status / Sort */}
      <div className="gv-toolbar-row mb-6">
        <Tabs
          layoutIdPrefix="gv-vault"
          activeTab={tab}
          onChange={setTab}
          tabs={[
            { id: "played", label: "Played", count: played.length },
            { id: "backlog", label: "Backlog", count: backlog.length },
            { id: "import", label: "Import", icon: Upload }
          ]}
        />

        {(tab === "played" || tab === "backlog") && (
          <div className="gv-vault-controls">
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
              <div className="gv-vault-selects">
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
              </div>
            )}

            {tab === "backlog" && played.length > 0 && (
              <button
                type="button"
                className={`gv-btn gv-btn-sm ${rankBacklogMl ? "gv-btn-accent" : ""}`}
                onClick={() => setRankBacklogMl((v) => !v)}
              >
                <Sparkles size={13} aria-hidden="true" />
                Best Next Play
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
              Search any PC, PlayStation, Nintendo, or Xbox game or import your library.
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
              Bookmark games you want to play next from Discover or Explore.
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
        <div className="gv-panel">
          <h2 className="gv-section-title mb-2">Import Games (JSON, CSV, or Steam AppIDs)</h2>
          <p className="gv-section-sub mb-4">
            Paste a GameVault JSON backup, a CSV (appid,rating,hours), or a list of Steam AppIDs or Store URLs.
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
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" disabled={importBusy || !importText.trim()} className="gv-btn gv-btn-primary">
                {importBusy ? "Importing..." : "Import Into Game Vault"}
              </button>
              {importFeedback && <span className="text-[1.3rem]" style={{ color: "var(--gv-accent)" }}>{importFeedback}</span>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
