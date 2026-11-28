import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Cpu, Dices, EyeOff, RotateCcw, Search, Shuffle, SlidersHorizontal, Sparkles } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import {
  GAME_GENRES,
  GAME_PLATFORM_FAMILIES,
  discoverGames,
  fetchGamesBatch,
  searchGames
} from "../services/igdbService";
import {
  DEFAULT_GAME_TUNER_STATE,
  applyCalibratedSlateRerank,
  applyGameTuner,
  buildGameRecommendationIds,
  filterDuplicateGameEditions,
  rankGameCandidates
} from "../services/gameRankerService";
import { getDefaultPlatformFocus, isGameCompatibleWithRig } from "../services/gameRigService";
import { Select } from "../../components/ui/Select";
import ScrollRevealSection from "../../components/ScrollRevealSection";
import GameCard from "../components/GameCard";
import { springSnappy } from "../../motion";

const TUNER_PRESETS = [
  { id: "dark-challenge", label: "Dark Challenge", state: { pacing: 0.8, tone: -0.8, era: 0, familiarity: 0, antiBubble: false } },
  { id: "cozy", label: "Cozy Night", state: { pacing: -0.8, tone: 0.8, era: 0, familiarity: 0.2, antiBubble: false } },
  { id: "hidden", label: "Hidden Gems", state: { pacing: 0, tone: 0, era: 0, familiarity: 0.9, antiBubble: true } },
  { id: "fresh", label: "2024–2026 Fresh", state: { pacing: 0, tone: 0, era: 1.0, familiarity: 0, antiBubble: false } }
];

const GENRE_OPTIONS = [
  { value: "", label: "All Genres" },
  ...GAME_GENRES.map((g) => ({ value: String(g.id), label: g.name }))
];

const MODE_FILTER_OPTIONS = [
  { id: "all", label: "All Modes" },
  { id: "solo", label: "Solo" },
  { id: "coop", label: "Co-op" },
  { id: "multiplayer", label: "Multiplayer" }
];

const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "rating", label: "Highest Rated (180+ votes)" },
  { value: "recent", label: "Newest Releases" },
  { value: "hypes", label: "Most Hyped" }
];

export default function GamesExplorePage() {
  const {
    played,
    backlog,
    playedById,
    dismissedIds,
    models,
    modelsLoading,
    openRoulette,
    rigProfile,
    setOnboardingOpen
  } = useGameVault();
  const [mode, setMode] = useState(() => (played.length > 0 ? "for-you" : "catalog"));
  const [platformFamily, setPlatformFamily] = useState(() => getDefaultPlatformFocus(rigProfile));
  const [modeFilter, setModeFilter] = useState("all");
  const [recentKick, setRecentKick] = useState(false);
  const [genreId, setGenreId] = useState("");
  const [sort, setSort] = useState("popular");
  const [hidePlayed, setHidePlayed] = useState(false);
  const [rigOnly, setRigOnly] = useState(() => Boolean(rigProfile?.completed && rigProfile?.respectRigLimits && rigProfile?.pcSpecTier === "entry"));
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [tuner, setTuner] = useState(DEFAULT_GAME_TUNER_STATE);
  const [forYouPool, setForYouPool] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [liveSearchItems, setLiveSearchItems] = useState([]);
  const [liveSearching, setLiveSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    document.title = "Explore Games | GameVault";
  }, []);

  // Load For-You ML pool (pre-filtered across 24.4k CVGM v3 sidecar by platform, play mode, genre, rig, Recent Kick & Break-My-Bubble!)
  useEffect(() => {
    if (mode !== "for-you") return undefined;
    if (modelsLoading || played.length === 0) return undefined;
    let active = true;
    setLoading(true);
    const { allIds, maps } = buildGameRecommendationIds(played, backlog, models, {
      warmLimit: 54,
      coldLimit: 22,
      dismissedIds,
      platformFamily,
      modeFilter,
      genreId: genreId ? Number(genreId) : null,
      rigProfile: rigOnly ? rigProfile : null,
      antiBubble: tuner.antiBubble,
      recentKick
    });
    fetchGamesBatch(allIds)
      .then((hydrated) => {
        if (!active) return;
        const deduped = filterDuplicateGameEditions(hydrated, played, models?.editionAliases).filter(
          (g) => !dismissedIds.has(g.igdbId)
        );
        const ranked = applyCalibratedSlateRerank(
          rankGameCandidates(deduped, played, backlog, models, maps, { dismissedIds, recentKick }),
          played,
          models,
          { maxPerFranchise: 2, headWindow: 24, skipCalibration: Boolean(genreId || tuner.antiBubble) }
        );
        setForYouPool(ranked);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, played, backlog, dismissedIds, platformFamily, modeFilter, genreId, rigOnly, rigProfile, tuner.antiBubble, recentKick, models, modelsLoading]);

  // Reset page when catalog filters change
  useEffect(() => {
    setPage(1);
  }, [platformFamily, genreId, sort, mode]);

  // Load IGDB Catalog when in catalog mode
  useEffect(() => {
    if (mode !== "catalog") return undefined;
    let active = true;
    if (page === 1) setLoading(true);
    else setLoadingMore(true);

    discoverGames({
      preset: "catalog",
      platformFamily,
      genreId: genreId ? Number(genreId) : null,
      sort,
      page,
      limit: 36
    })
      .then((items) => {
        if (!active) return;
        const enriched = played.length > 0 && (models.easeIndex || models.contentIndex)
          ? rankGameCandidates(items, played, backlog, models, null, { dismissedIds, pointLookup: true })
          : items;
        setCatalogItems((prev) => {
          if (page === 1) return enriched;
          const seen = new Set(prev.map((x) => x.igdbId));
          return [...prev, ...enriched.filter((x) => !seen.has(x.igdbId))];
        });
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setLoadingMore(false);
        }
      });
    return () => {
      active = false;
    };
  }, [mode, platformFamily, genreId, sort, page, played, backlog, models]);

  // Live IGDB search when typing >=2 chars in Catalog mode (finds Call of Duty, Battlefield, FIFA, etc. across full IGDB!)
  useEffect(() => {
    const cleanQ = searchTerm.trim();
    if (mode !== "catalog" || cleanQ.length < 2) {
      setLiveSearchItems([]);
      setLiveSearching(false);
      return undefined;
    }
    const ctrl = new AbortController();
    let active = true;
    setLiveSearching(true);
    const timer = window.setTimeout(() => {
      searchGames(cleanQ, { limit: 32, signal: ctrl.signal })
        .then((items) => {
          if (!active) return;
          if (played.length > 0 && (models.easeIndex || models.contentIndex) && items.length > 0) {
            // Enrich with personal Match % while PRESERVING search relevance & popularity order!
            const ranked = rankGameCandidates(items, played, backlog, models, null, { dismissedIds, pointLookup: true });
            const scoreById = new Map(ranked.map((r) => [r.igdbId, r]));
            setLiveSearchItems(
              items.map((g) => {
                const scored = scoreById.get(g.igdbId);
                return scored ? { ...g, ...scored } : g;
              })
            );
          } else {
            setLiveSearchItems(items);
          }
        })
        .catch((err) => {
          if (active && err?.name !== "AbortError") setLiveSearchItems([]);
        })
        .finally(() => {
          if (active) setLiveSearching(false);
        });
    }, 240);
    return () => {
      active = false;
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [mode, searchTerm, played, backlog, dismissedIds, models]);

  const isCatalogLiveSearch = mode === "catalog" && searchTerm.trim().length >= 2;

  const displayedItems = useMemo(() => {
    const base = mode === "for-you"
      ? forYouPool
      : (isCatalogLiveSearch ? liveSearchItems : catalogItems);
    const cleanQ = searchTerm.trim().toLowerCase();
    const filtered = base.filter((g) => {
      if (hidePlayed && playedById.has(g.igdbId)) return false;
      if (rigOnly && rigProfile?.completed && !isGameCompatibleWithRig(g, rigProfile).compatible) return false;
      if (mode === "for-you" || isCatalogLiveSearch) {
        if (platformFamily !== "all" && !(g.platformFamilies || []).includes(platformFamily)) return false;
        if (genreId && !(g.genreIds || []).includes(Number(genreId))) return false;
      }
      if (modeFilter !== "all") {
        const metaIdx = models?.catalogMeta?.idToIndex?.get(g.igdbId);
        if (metaIdx !== undefined && models?.catalogMeta?.modeMask) {
          const mMask = models.catalogMeta.modeMask[metaIdx];
          if (mMask !== 0) {
            if (modeFilter === "solo" && (mMask & 1) === 0) return false;
            if (modeFilter === "multiplayer" && (mMask & 2) === 0) return false;
            if (modeFilter === "coop" && (mMask & 4) === 0) return false;
          }
        }
      }
      if (cleanQ && !isCatalogLiveSearch) {
        const hay = `${g.title || ""} ${(g.genres || []).join(" ")} ${(g.developers || []).join(" ")}`.toLowerCase();
        if (!hay.includes(cleanQ)) return false;
      }
      return true;
    });
    const tuned = applyGameTuner(filtered, tuner, {
      contentIndex: models.contentIndex,
      tunerAxes: models.tunerAxes,
      editionAliases: models.editionAliases,
      played
    });
    if (shuffleSeed === 0) return tuned;
    return [...tuned].sort((a, b) => {
      const ha = Math.sin((a.igdbId + shuffleSeed * 97) * 12.9898) * 43758.5453;
      const hb = Math.sin((b.igdbId + shuffleSeed * 97) * 12.9898) * 43758.5453;
      return (ha - Math.floor(ha)) - (hb - Math.floor(hb));
    });
  }, [mode, isCatalogLiveSearch, forYouPool, catalogItems, liveSearchItems, platformFamily, modeFilter, genreId, searchTerm, hidePlayed, playedById, rigOnly, rigProfile, tuner, models, played, shuffleSeed]);

  const tunerIsNeutral =
    tuner.era === 0 && tuner.familiarity === 0 && tuner.pacing === 0 && tuner.tone === 0 && !tuner.antiBubble;

  return (
    <div className="gv-page page-rail">
      <ScrollRevealSection className="gv-section-header">
        <div>
          <span className="gv-kicker">
            <SlidersHorizontal size={13} /> Game Explore Workbench
          </span>
          <h1 className="gv-hero-title" style={{ fontSize: "clamp(2.4rem, 3.4vw, 3.6rem)" }}>
            {mode === "for-you" ? "Games Matched To Your Taste" : "Explore IGDB Catalog"}
          </h1>
          <p className="gv-section-sub">
            Re-rank instantaneously in your browser with popularity-decorrelated Intensity &amp; Tone neural axes.
          </p>
        </div>

        {/* Spring Sliding Segmented Toggle */}
        <div className="gv-segmented-bar" role="tablist" aria-label="Explore mode">
          {[
            { id: "for-you", label: `For You (${played.length > 0 ? forYouPool.length || "ML" : "Rate 1+"})`, icon: Sparkles },
            { id: "catalog", label: "IGDB Catalog", icon: null }
          ].map((tab) => {
            const active = mode === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`gv-segmented-btn ${active ? "is-active" : ""}`}
                onClick={() => setMode(tab.id)}
              >
                {active && (
                  <motion.span
                    layoutId="gv-explore-mode-pill"
                    className="gv-segmented-bg"
                    transition={springSnappy}
                  />
                )}
                <span className="gv-segmented-label">
                  {Icon && <Icon size={13} aria-hidden="true" />}
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollRevealSection>

      {/* Platform + Portaled Editorial Select + Instant Search + Shuffle Toolbar */}
      <ScrollRevealSection className="gv-filter-bar" delay={0.04}>
        <div className="gv-chip-group">
          {GAME_PLATFORM_FAMILIES.map((pf) => (
            <button
              key={pf.id}
              type="button"
              className={`gv-chip ${platformFamily === pf.id ? "is-active" : ""}`}
              onClick={() => setPlatformFamily(pf.id)}
            >
              {pf.label}
            </button>
          ))}
        </div>

        <div className="gv-chip-group">
          {MODE_FILTER_OPTIONS.map((mf) => (
            <button
              key={mf.id}
              type="button"
              className={`gv-chip gv-chip-sm ${modeFilter === mf.id ? "is-active" : ""}`}
              onClick={() => setModeFilter(mf.id)}
            >
              {mf.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 ml-auto">
          <div className="gv-inline-search">
            <Search size={14} className="text-text-3 shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={mode === "catalog" ? "Search entire IGDB catalog (e.g. Call of Duty)..." : "Filter For You matches..."}
              aria-label="Search or filter games"
            />
          </div>

          <Select
            value={genreId}
            onChange={setGenreId}
            options={GENRE_OPTIONS}
            ariaLabel="Filter by genre"
            size="sm"
          />

          {mode === "catalog" && (
            <>
              <Select
                value={sort}
                onChange={setSort}
                options={SORT_OPTIONS}
                ariaLabel="Sort catalog"
                size="sm"
              />
              {played.length > 0 && (
                <button
                  type="button"
                  className={`gv-chip gv-chip-sm ${hidePlayed ? "is-active" : ""}`}
                  onClick={() => setHidePlayed((v) => !v)}
                >
                  <EyeOff size={12} style={{ display: "inline", marginRight: "0.35rem" }} />
                  Hide Played
                </button>
              )}
            </>
          )}

          {rigProfile?.completed && rigProfile?.pcSpecTier === "entry" && (
            <button
              type="button"
              className={`gv-chip gv-chip-sm ${rigOnly ? "is-active" : ""}`}
              onClick={() => setRigOnly((v) => !v)}
              title="Filter out heavy modern AAA games for Entry PCs"
            >
              <Cpu size={12} style={{ display: "inline", marginRight: "0.35rem" }} />
              Runs on My PC
            </button>
          )}

          <button
            type="button"
            className="gv-btn gv-btn-sm"
            onClick={() => setOnboardingOpen(true)}
            title="Configure your PC specs or consoles"
          >
            <Cpu size={13} /> My Rig
          </button>

          <button
            type="button"
            className="gv-btn gv-btn-sm"
            onClick={() => setShuffleSeed((s) => s + 1)}
            title="Shuffle current games"
          >
            <Shuffle size={13} /> Shuffle
          </button>

          {displayedItems.length > 0 && (
            <button
              type="button"
              className="gv-btn gv-btn-sm"
              onClick={() => openRoulette(displayedItems.slice(0, 20))}
              title="Pick a random game from these matches"
            >
              <Dices size={13} /> Roulette
            </button>
          )}
        </div>
      </ScrollRevealSection>

      {/* Live <1ms Neural Taste Tuner Panel */}
      <ScrollRevealSection className="gv-panel" delay={0.07}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[1.6rem] font-semibold text-text-1">Live Neural Taste Tuner</h2>
            <p className="text-[1.2rem] text-text-3">
              Adjust dials or tap a quick preset to steer picks in &lt;1 ms using 128-D Intensity (AUC 0.968) &amp; Tone (AUC 0.996).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {TUNER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="gv-hour-pill"
                onClick={() => {
                  setShuffleSeed(0);
                  setTuner(p.state);
                }}
              >
                {p.label}
              </button>
            ))}
            {mode === "for-you" && played.length >= 2 && (
              <button
                type="button"
                className={`gv-chip gv-chip-sm ${recentKick ? "is-active" : ""}`}
                onClick={() => setRecentKick((v) => !v)}
                title="Focus recommendations on your last 3-5 played games (21-day half-life)"
              >
                Recent Kick
              </button>
            )}
            <button
              type="button"
              className={`gv-chip gv-chip-sm ${tuner.antiBubble ? "is-active" : ""}`}
              onClick={() => setTuner((prev) => ({ ...prev, antiBubble: !prev.antiBubble }))}
            >
              Break My Bubble
            </button>
            {(!tunerIsNeutral || shuffleSeed > 0) && (
              <button
                type="button"
                className="gv-btn gv-btn-sm"
                onClick={() => {
                  setShuffleSeed(0);
                  setTuner(DEFAULT_GAME_TUNER_STATE);
                }}
              >
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </div>
        </div>

        <div className="gv-tuner-grid">
          <div className="gv-slider-box">
            <div className="gv-slider-title">
              <span>Intensity</span>
              <span className="text-accent tabular-num">{tuner.pacing > 0 ? `+${tuner.pacing}` : tuner.pacing}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.2"
              value={tuner.pacing}
              onChange={(e) => {
                setShuffleSeed(0);
                setTuner((p) => ({ ...p, pacing: Number(e.target.value) }));
              }}
              className="gv-range"
            />
            <div className="gv-slider-labels">
              <span>Cozy / Chill</span>
              <span>High-Octane Action</span>
            </div>
          </div>

          <div className="gv-slider-box">
            <div className="gv-slider-title">
              <span>Tone</span>
              <span className="text-accent tabular-num">{tuner.tone > 0 ? `+${tuner.tone}` : tuner.tone}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.2"
              value={tuner.tone}
              onChange={(e) => {
                setShuffleSeed(0);
                setTuner((p) => ({ ...p, tone: Number(e.target.value) }));
              }}
              className="gv-range"
            />
            <div className="gv-slider-labels">
              <span>Dark / Horror</span>
              <span>Warm / Playful</span>
            </div>
          </div>

          <div className="gv-slider-box">
            <div className="gv-slider-title">
              <span>Era</span>
              <span className="text-accent tabular-num">{tuner.era > 0 ? `+${tuner.era}` : tuner.era}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.2"
              value={tuner.era}
              onChange={(e) => {
                setShuffleSeed(0);
                setTuner((p) => ({ ...p, era: Number(e.target.value) }));
              }}
              className="gv-range"
            />
            <div className="gv-slider-labels">
              <span>Retro / Classics</span>
              <span>2024–2026 New</span>
            </div>
          </div>

          <div className="gv-slider-box">
            <div className="gv-slider-title">
              <span>Familiarity</span>
              <span className="text-accent tabular-num">{tuner.familiarity > 0 ? `+${tuner.familiarity}` : tuner.familiarity}</span>
            </div>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.2"
              value={tuner.familiarity}
              onChange={(e) => {
                setShuffleSeed(0);
                setTuner((p) => ({ ...p, familiarity: Number(e.target.value) }));
              }}
              className="gv-range"
            />
            <div className="gv-slider-labels">
              <span>Blockbusters</span>
              <span>Hidden Gems</span>
            </div>
          </div>
        </div>
      </ScrollRevealSection>

      {/* Results Grid with Smooth Layout Re-Ordering */}
      {mode === "for-you" && played.length === 0 ? (
        <div className="gv-panel text-center py-12">
          <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">Rate at least 1 game to unlock For You</h3>
          <p className="text-[1.35rem] text-text-3 mb-5">
            Switch to IGDB Catalog above or calibrate 3 starter games on Discover.
          </p>
          <button type="button" className="gv-btn gv-btn-primary" onClick={() => setMode("catalog")}>
            Browse IGDB Catalog
          </button>
        </div>
      ) : (loading || liveSearching) ? (
        <div className="gv-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="gv-skeleton" style={{ aspectRatio: "3/4.8" }} />
          ))}
        </div>
      ) : displayedItems.length === 0 ? (
        <div className="gv-panel text-center py-10 flex flex-col items-center gap-4">
          <p className="text-[1.45rem] text-text-2">
            No games matched those exact filters. Try clearing Genre, Platform, or search.
          </p>
          {mode === "for-you" && searchTerm.trim().length >= 2 && (
            <button
              type="button"
              className="gv-btn gv-btn-primary"
              onClick={() => setMode("catalog")}
            >
              Search entire IGDB catalog for &ldquo;{searchTerm.trim()}&rdquo;
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="gv-grid">
            {displayedItems.map((game, idx) => (
              <GameCard
                key={game.igdbId}
                game={game}
                showMatch={played.length > 0}
                index={idx}
                revealIndex={idx}
                animateOnScroll
              />
            ))}
          </div>

          {mode === "catalog" && !isCatalogLiveSearch && (
            <div className="flex justify-center mt-10">
              <button
                type="button"
                disabled={loadingMore}
                className="gv-btn"
                onClick={() => setPage((p) => p + 1)}
              >
                {loadingMore ? "Loading more games..." : "Load More Games"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
