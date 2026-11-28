import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Cpu, Dices, EyeOff, RotateCcw, Search, Shuffle, SlidersHorizontal, Sparkles, X } from "lucide-react";
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
import { Tabs } from "../../components/ui/Tabs";
import GameCard from "../components/GameCard";
import GameTasteTunerBar from "../components/GameTasteTunerBar";
import { EASE } from "../../motion";

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
  { value: "rating", label: "Highest Rated" },
  { value: "recent", label: "Newest Releases" },
  { value: "hypes", label: "Most Hyped" }
];

export default function GamesExplorePage() {
  const [searchParams] = useSearchParams();
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

  const initialTab = searchParams.get("tab") === "catalog" ? "catalog" : (played.length > 0 ? "for-you" : "catalog");
  const initialSort = SORT_OPTIONS.some((s) => s.value === searchParams.get("sort")) ? searchParams.get("sort") : "popular";

  const [mode, setMode] = useState(initialTab);
  const [platformFamily, setPlatformFamily] = useState(() => getDefaultPlatformFocus(rigProfile));
  const [modeFilter, setModeFilter] = useState("all");
  const [recentKick, setRecentKick] = useState(false);
  const [genreId, setGenreId] = useState("");
  const [sort, setSort] = useState(initialSort);
  const [hidePlayed, setHidePlayed] = useState(false);
  const [rigOnly, setRigOnly] = useState(() =>
    Boolean(rigProfile?.completed && rigProfile?.respectRigLimits && rigProfile?.pcSpecTier === "entry")
  );
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [tuner, setTuner] = useState(DEFAULT_GAME_TUNER_STATE);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [forYouPool, setForYouPool] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [liveSearchItems, setLiveSearchItems] = useState([]);
  const [liveSearching, setLiveSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    document.title = "Explore Games | GameVault";
  }, []);

  useEffect(() => {
    const paramTab = searchParams.get("tab");
    const paramSort = searchParams.get("sort");
    if (paramTab === "catalog" || paramTab === "for-you") setMode(paramTab);
    if (paramSort && SORT_OPTIONS.some((s) => s.value === paramSort)) setSort(paramSort);
  }, [searchParams]);

  // Body scroll lock for mobile Filter drawer
  useEffect(() => {
    if (!mobileFiltersOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") setMobileFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileFiltersOpen]);

  // Load For-You personalized pool
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

  // Load IGDB Catalog
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
  }, [mode, platformFamily, genreId, sort, page, played, backlog, dismissedIds, models]);

  // Live IGDB search when typing >= 2 chars in Catalog mode
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

  const activeFilterCount =
    (platformFamily !== "all" ? 1 : 0) +
    (modeFilter !== "all" ? 1 : 0) +
    (genreId ? 1 : 0) +
    (hidePlayed ? 1 : 0) +
    (rigOnly ? 1 : 0);

  function resetAllFilters() {
    setPlatformFamily("all");
    setModeFilter("all");
    setGenreId("");
    setHidePlayed(false);
    setRigOnly(false);
    setSearchTerm("");
    setShuffleSeed(0);
    setRecentKick(false);
    setTuner(DEFAULT_GAME_TUNER_STATE);
  }

  function renderFilterFacets() {
    return (
      <div className="gv-facet-stack">
        <div className="gv-facet-group">
          <span className="gv-facet-label">Platform</span>
          <div className="gv-facet-pills">
            {GAME_PLATFORM_FAMILIES.map((pf) => (
              <button
                key={pf.id}
                type="button"
                className={`gv-facet-btn ${platformFamily === pf.id ? "is-active" : ""}`}
                onClick={() => setPlatformFamily(pf.id)}
              >
                {pf.label}
              </button>
            ))}
          </div>
        </div>

        <div className="gv-facet-group">
          <span className="gv-facet-label">Play Mode</span>
          <div className="gv-facet-pills">
            {MODE_FILTER_OPTIONS.map((mf) => (
              <button
                key={mf.id}
                type="button"
                className={`gv-facet-btn ${modeFilter === mf.id ? "is-active" : ""}`}
                onClick={() => setModeFilter(mf.id)}
              >
                {mf.label}
              </button>
            ))}
          </div>
        </div>

        <div className="gv-facet-group">
          <span className="gv-facet-label">Genre</span>
          <Select
            value={genreId}
            onChange={setGenreId}
            options={GENRE_OPTIONS}
            ariaLabel="Filter by genre"
            size="sm"
            fullWidth
          />
        </div>

        <div className="gv-facet-group">
          <span className="gv-facet-label">Library &amp; Hardware</span>
          <div className="gv-facet-pills">
            {mode === "catalog" && played.length > 0 && (
              <button
                type="button"
                className={`gv-facet-btn ${hidePlayed ? "is-active" : ""}`}
                onClick={() => setHidePlayed((v) => !v)}
              >
                <EyeOff size={13} aria-hidden="true" />
                Hide Played
              </button>
            )}

            {rigProfile?.completed && rigProfile?.pcSpecTier === "entry" && (
              <button
                type="button"
                className={`gv-facet-btn ${rigOnly ? "is-active" : ""}`}
                onClick={() => setRigOnly((v) => !v)}
              >
                <Cpu size={13} aria-hidden="true" />
                Runs on My PC
              </button>
            )}

            <button
              type="button"
              className="gv-facet-btn"
              onClick={() => {
                setMobileFiltersOpen(false);
                setOnboardingOpen(true);
              }}
            >
              <Cpu size={13} aria-hidden="true" />
              {rigProfile?.completed ? "Edit My Rig" : "Set Up My Rig"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gv-page page-rail">
      <div className="gv-explore-layout">
        {/* Desktop Sticky Left Filter Sidebar (matches CinemaVault Explore) */}
        <aside className="gv-explore-sidebar" aria-label="Filters">
          <div className="gv-explore-sidebar-head">
            <h2 className="gv-explore-sidebar-title">
              <SlidersHorizontal size={15} aria-hidden="true" />
              Filters
            </h2>
            {activeFilterCount > 0 && (
              <button type="button" className="gv-tuner-reset" onClick={resetAllFilters}>
                <RotateCcw size={12} aria-hidden="true" />
                Reset
              </button>
            )}
          </div>
          {renderFilterFacets()}
        </aside>

        {/* Main Content Column */}
        <div className="gv-explore-main">
          <div className="gv-explore-head">
            <div>
              <span className="gv-eyebrow">Game Catalog</span>
              <h1 className="gv-page-title">
                {mode === "for-you" ? "Explore Games" : "All IGDB Games"}
              </h1>
              <p className="gv-page-subtitle tabular-num">
                {displayedItems.length} {displayedItems.length === 1 ? "game" : "games"}
                {mode === "for-you" ? " matched to your taste" : " shown"}
              </p>
            </div>

            <div className="gv-explore-actions">
              {mode === "catalog" && (
                <div className="hidden min-[961px]:block">
                  <Select
                    value={sort}
                    onChange={setSort}
                    options={SORT_OPTIONS}
                    ariaLabel="Sort catalog"
                    size="sm"
                  />
                </div>
              )}

              <button
                type="button"
                className="gv-btn gv-btn-sm"
                onClick={() => setShuffleSeed((s) => s + 1)}
                title="Shuffle games"
              >
                <Shuffle size={13} aria-hidden="true" />
                Shuffle
              </button>

              {displayedItems.length > 0 && (
                <button
                  type="button"
                  className="gv-btn gv-btn-sm"
                  onClick={() => openRoulette(displayedItems.slice(0, 20))}
                  title="Pick a random game from these matches"
                >
                  <Dices size={13} aria-hidden="true" />
                  Roulette
                </button>
              )}
            </div>
          </div>

          {/* Editorial Underline Tabs + Desktop Inline Search */}
          <div className="gv-toolbar-row">
            <Tabs
              layoutIdPrefix="gv-explore"
              activeTab={mode}
              onChange={setMode}
              tabs={[
                {
                  id: "for-you",
                  label: "For You",
                  count: played.length > 0 ? (forYouPool.length || undefined) : undefined,
                  icon: Sparkles
                },
                {
                  id: "catalog",
                  label: "All Catalog"
                }
              ]}
            />

            <div className="gv-inline-search gv-desktop-only-search">
              <Search size={14} className="text-text-3 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={mode === "catalog" ? "Search IGDB (e.g. Call of Duty)..." : "Filter matches..."}
                aria-label="Search or filter games"
              />
            </div>
          </div>

          {/* Mobile Compact Search + Filters Drawer Button + Sort */}
          <div className="gv-mobile-filter-bar">
            <div className="gv-inline-search">
              <Search size={15} className="text-text-3 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={mode === "catalog" ? "Search entire IGDB (e.g. Call of Duty)..." : "Filter matches..."}
                aria-label="Search or filter games on mobile"
              />
            </div>

            <button
              type="button"
              className="gv-btn gv-btn-sm flex-1"
              onClick={() => setMobileFiltersOpen(true)}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="gv-filter-count-badge tabular-num">{activeFilterCount}</span>
              )}
            </button>

            {mode === "catalog" && (
              <div className="flex-1">
                <Select
                  value={sort}
                  onChange={setSort}
                  options={SORT_OPTIONS}
                  ariaLabel="Sort catalog"
                  size="sm"
                  fullWidth
                />
              </div>
            )}
          </div>

          {/* Sleek Single-Line Collapsible Live Taste Tuner (Default Closed) */}
          <GameTasteTunerBar
            value={tuner}
            onChange={(next) => {
              setShuffleSeed(0);
              setTuner(next);
            }}
            onReset={() => {
              setShuffleSeed(0);
              setRecentKick(false);
            }}
            showRecentKick={mode === "for-you" && played.length >= 2}
            recentKick={recentKick}
            onToggleRecentKick={() => setRecentKick((v) => !v)}
          />

          {/* Results Grid */}
          {mode === "for-you" && played.length === 0 ? (
            <div className="gv-panel text-center py-12">
              <h3 className="text-[1.8rem] font-semibold text-text-1 mb-2">Rate at least 1 game to unlock For You</h3>
              <p className="text-[1.35rem] text-text-3 mb-5">
                Browse the All Catalog tab or tap 3 starter games on Discover.
              </p>
              <button type="button" className="gv-btn gv-btn-primary" onClick={() => setMode("catalog")}>
                Browse All Catalog
              </button>
            </div>
          ) : (loading || liveSearching) ? (
            <div className="gv-grid">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="gv-skeleton" style={{ aspectRatio: "3/4.4" }} />
              ))}
            </div>
          ) : displayedItems.length === 0 ? (
            <div className="gv-panel text-center py-10 flex flex-col items-center gap-4">
              <p className="text-[1.45rem] text-text-2">
                No games matched those filters. Try clearing genre, platform, or search.
              </p>
              <div className="flex flex-wrap gap-3 justify-center">
                {activeFilterCount > 0 && (
                  <button type="button" className="gv-btn gv-btn-sm" onClick={resetAllFilters}>
                    Reset Filters
                  </button>
                )}
                {mode === "for-you" && searchTerm.trim().length >= 2 && (
                  <button
                    type="button"
                    className="gv-btn gv-btn-primary gv-btn-sm"
                    onClick={() => setMode("catalog")}
                  >
                    Search IGDB catalog for &ldquo;{searchTerm.trim()}&rdquo;
                  </button>
                )}
              </div>
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
                <div className="flex justify-center mt-8">
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
      </div>

      {/* Portaled Mobile Filter Bottom Sheet */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {mobileFiltersOpen && (
              <motion.div
                className="gv-scope gv-sheet-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label="Filter Games"
                onClick={() => setMobileFiltersOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                <motion.div
                  className="gv-filter-sheet"
                  onClick={(e) => e.stopPropagation()}
                  initial={{ y: 36, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 36, opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE }}
                >
                  <div className="flex items-center justify-between pb-3 mb-4 border-b border-hairline">
                    <h2 className="text-[1.7rem] font-semibold text-text-1">Filters</h2>
                    <div className="flex items-center gap-2">
                      {activeFilterCount > 0 && (
                        <button type="button" className="gv-tuner-reset" onClick={resetAllFilters}>
                          <RotateCcw size={12} aria-hidden="true" />
                          Reset
                        </button>
                      )}
                      <button
                        type="button"
                        className="gv-btn gv-btn-sm"
                        onClick={() => setMobileFiltersOpen(false)}
                        aria-label="Close filters"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  {renderFilterFacets()}

                  <div className="mt-5 pt-4 border-t border-hairline">
                    <button
                      type="button"
                      className="gv-btn gv-btn-primary w-full"
                      onClick={() => setMobileFiltersOpen(false)}
                    >
                      Show {displayedItems.length} {displayedItems.length === 1 ? "Game" : "Games"}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
