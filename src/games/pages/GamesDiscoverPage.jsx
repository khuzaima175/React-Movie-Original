import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Sparkles } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { discoverHomeRows, fetchGamesBatch } from "../services/igdbService";
import {
  applyFranchiseDiversityCap,
  buildGameRecommendationIds,
  filterDuplicateGameEditions,
  rankGameCandidates
} from "../services/gameRankerService";
import {
  PC_SPEC_TIERS,
  RIG_PLATFORM_CHOICES,
  getRigPlatformFamilies,
  isGameCompatibleWithRig
} from "../services/gameRigService";
import { STARTER_CALIBRATION_GAMES } from "../services/gameOracleService";
import ScrollRevealSection from "../../components/ScrollRevealSection";
import GameHeroBillboard from "../components/GameHeroBillboard";
import GameCarouselRow from "../components/GameCarouselRow";
import { EASE } from "../../motion";

export default function GamesDiscoverPage() {
  const {
    played,
    backlog,
    playedById,
    backlogIds,
    dismissedIds,
    models,
    modelsLoading,
    savePlayedGame,
    toggleBacklogGame,
    setRateTarget,
    openRoulette,
    rigProfile,
    setOnboardingOpen
  } = useGameVault();
  const [popularHits, setPopularHits] = useState([]);
  const [recentHits, setRecentHits] = useState([]);
  const [exclusives, setExclusives] = useState([]);
  const [topRated, setTopRated] = useState([]);
  const [forYouPicks, setForYouPicks] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingForYou, setLoadingForYou] = useState(false);
  const [skippedIds, setSkippedIds] = useState(() => new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Discover Games | GameVault";
    let active = true;
    setLoadingCatalog(true);
    setError("");
    discoverHomeRows()
      .then((bundle) => {
        if (!active) return;
        setPopularHits(bundle.popular || []);
        setRecentHits(bundle.recent_hits || []);
        setExclusives(bundle.exclusives || []);
        setTopRated(bundle.top_rated || []);
      })
      .catch(() => {
        if (active) setError("Could not reach IGDB proxy. Check IGDB_CLIENT_ID & IGDB_CLIENT_SECRET.");
      })
      .finally(() => {
        if (active) setLoadingCatalog(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Personalized local ML picks (deduped against played editions + dismissed games + optional rig spec filter)
  useEffect(() => {
    if (modelsLoading || played.length === 0 || (!models.easeIndex && !models.contentIndex)) {
      setForYouPicks([]);
      return undefined;
    }
    let active = true;
    setLoadingForYou(true);
    const rigPlatformFams = getRigPlatformFamilies(rigProfile);
    const { allIds, maps } = buildGameRecommendationIds(played, backlog, models, {
      warmLimit: 44,
      coldLimit: 18,
      dismissedIds,
      platformFamily: rigPlatformFams.length === 1 ? rigPlatformFams[0] : "all",
      rigProfile
    });
    fetchGamesBatch(allIds.slice(0, 42))
      .then((hydrated) => {
        if (!active) return;
        let clean = filterDuplicateGameEditions(hydrated, played, models?.editionAliases).filter(
          (g) => !dismissedIds.has(g.igdbId)
        );
        if (rigProfile?.completed && rigProfile?.respectRigLimits) {
          const rigFiltered = clean.filter((g) => isGameCompatibleWithRig(g, rigProfile).compatible);
          if (rigFiltered.length >= 6) clean = rigFiltered;
        }
        const ranked = applyFranchiseDiversityCap(
          rankGameCandidates(clean, played, backlog, models, maps, { dismissedIds }),
          { maxPerFranchise: 1, headWindow: 16 }
        );
        setForYouPicks(ranked.slice(0, 16));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingForYou(false);
      });
    return () => {
      active = false;
    };
  }, [played, backlog, dismissedIds, rigProfile, models, modelsLoading]);

  const starterCards = useMemo(() => {
    const fams = getRigPlatformFamilies(rigProfile);
    return STARTER_CALIBRATION_GAMES.filter((g) => {
      if (playedById.has(g.igdbId) || skippedIds.has(g.igdbId)) return false;
      if (fams.length > 0 && Array.isArray(g.platformFamilies) && !g.platformFamilies.some((f) => fams.includes(f))) {
        return false;
      }
      if (rigProfile?.completed && rigProfile?.respectRigLimits && !isGameCompatibleWithRig(g, rigProfile).compatible) {
        return false;
      }
      return true;
    }).slice(0, 12);
  }, [playedById, skippedIds, rigProfile]);

  const heroSlides = useMemo(() => {
    if (forYouPicks.length > 0) return forYouPicks.slice(0, 5);
    if (popularHits.length > 0) return popularHits.slice(0, 5);
    if (recentHits.length > 0) return recentHits.slice(0, 5);
    return topRated.slice(0, 5);
  }, [forYouPicks, popularHits, recentHits, topRated]);

  const rigSummary = useMemo(() => {
    if (!rigProfile?.completed) return "Tell GameVault your PC specs or console to tailor recommendations";
    const plats = (rigProfile.platforms || [])
      .map((id) => RIG_PLATFORM_CHOICES.find((p) => p.id === id)?.short || id)
      .join(" · ");
    const tierObj = PC_SPEC_TIERS.find((t) => t.id === rigProfile.pcSpecTier);
    return rigProfile.platforms?.includes("pc") && tierObj
      ? `${plats} — ${tierObj.label}${rigProfile.respectRigLimits ? " (Rig filter active)" : ""}`
      : plats;
  }, [rigProfile]);

  return (
    <div className="gv-page page-rail">
      {error && (
        <div className="gv-panel" style={{ borderColor: "var(--danger)" }}>
          <p className="text-[1.4rem] text-danger">{error}</p>
        </div>
      )}

      {/* Compact PC / Console Rig Strip */}
      <div className="gv-rig-strip">
        <div className="flex items-center gap-3 min-w-0">
          <Cpu size={15} className="text-accent shrink-0" aria-hidden="true" />
          <span className="text-[1.25rem] text-text-2 truncate">{rigSummary}</span>
        </div>
        <button
          type="button"
          className="gv-btn gv-btn-sm shrink-0"
          onClick={() => setOnboardingOpen(true)}
        >
          {rigProfile?.completed ? "Edit My Rig & Taste Deck" : "Set Up My Rig & Taste"}
        </button>
      </div>

      {/* Multi-Slide Rotating Editorial Hero Billboard with Ken Burns + Scroll Parallax */}
      <GameHeroBillboard
        slides={heroSlides}
        isPersonalized={forYouPicks.length > 0}
        playedById={playedById}
        backlogIds={backlogIds}
        onRate={setRateTarget}
        onToggleBacklog={toggleBacklogGame}
        onOpenRoulette={() => openRoulette(forYouPicks.length > 0 ? forYouPicks : recentHits)}
      />

      {/* Animated 1-Tap Taste Calibration Strip (when < 3 games rated) */}
      {played.length < 3 && starterCards.length > 0 && (
        <ScrollRevealSection className="gv-panel" delay={0.04}>
          <div className="gv-section-header" style={{ marginBottom: "1.4rem" }}>
            <div>
              <span className="gv-kicker">
                <Sparkles size={13} /> Instant Taste Calibration ({played.length} / 3)
              </span>
              <h2 className="gv-section-title">Tap a few games you know to unlock local ML picks</h2>
              <p className="gv-section-sub">
                Runs 100% locally in your browser across 24,439 PC, PlayStation, Nintendo &amp; Xbox games.
              </p>
            </div>
            <Link to="/games/vault" className="gv-btn gv-btn-sm">
              Import Steam IDs / JSON
            </Link>
          </div>

          <div className="gv-grid-compact">
            <AnimatePresence mode="popLayout">
              {starterCards.map((g) => (
                <motion.div
                  key={g.igdbId}
                  layout
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.88, y: -10 }}
                  transition={{ duration: 0.24, ease: EASE }}
                  className="gv-card"
                >
                  <Link to={`/game/${g.igdbId}`} className="gv-card-cover-wrap">
                    <img src={g.coverUrl} alt={g.title} loading="lazy" className="gv-card-cover" />
                    <div className="gv-card-sheen" aria-hidden="true" />
                  </Link>
                  <div className="gv-card-body">
                    <div className="gv-card-title">{g.title}</div>
                    <div className="gv-card-meta">{g.primaryGenre} · {g.year}</div>
                    <div className="gv-card-footer">
                      <button
                        type="button"
                        className="gv-card-action is-active"
                        onClick={() => savePlayedGame(g, { userRating: 9, status: "completed" })}
                      >
                        Love (9)
                      </button>
                      <button
                        type="button"
                        className="gv-card-action"
                        onClick={() => savePlayedGame(g, { userRating: 7, status: "played" })}
                      >
                        Like (7)
                      </button>
                      <button
                        type="button"
                        className="gv-card-action"
                        onClick={() => setSkippedIds((prev) => new Set([...prev, g.igdbId]))}
                        title="Skip"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </ScrollRevealSection>
      )}

      {/* Opt-In Smooth Horizontal Carousels */}
      {played.length > 0 && (
        <GameCarouselRow
          title="Games You'll Love"
          subtitle="Powered locally by EASE^R (K=80) + Spectral-EASE + Tag-Dropout BGE-large cold-start vectors."
          games={forYouPicks}
          showMatch
          loading={loadingForYou}
          seeAllTo="/games/explore"
          seeAllLabel="Open Taste Tuner"
        />
      )}

      <GameCarouselRow
        title="Popular Blockbusters"
        subtitle="The most-played franchises and flagship AAA hits across PC, PlayStation, Xbox & Nintendo."
        games={popularHits}
        showMatch={false}
        loading={loadingCatalog}
        seeAllTo="/games/explore"
        seeAllLabel="Browse Popular"
      />

      <GameCarouselRow
        title="2024–2026 Standouts"
        subtitle="Recent hits covered by our 24.4k neural cold-start embedding index."
        games={recentHits}
        showMatch={false}
        loading={loadingCatalog}
        seeAllTo="/games/explore?tab=catalog&sort=recent"
        seeAllLabel="Explore Recent"
      />

      <GameCarouselRow
        title="Console Exclusives & Icons"
        subtitle="PlayStation & Nintendo classics bridged seamlessly into your taste space."
        games={exclusives}
        showMatch={false}
        loading={loadingCatalog}
      />

      <GameCarouselRow
        title="All-Time Acclaimed"
        subtitle="Highest-rated canonical games across every generation."
        games={topRated}
        showMatch={false}
        loading={loadingCatalog}
      />
    </div>
  );
}
