import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Sparkles } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { discoverHomeRows, fetchGamesBatch } from "../services/igdbService";
import {
  applyCalibratedSlateRerank,
  buildGameRecommendationIds,
  filterDuplicateGameEditions,
  rankGameCandidates
} from "../services/gameRankerService";
import {
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

  // Personalized recommendations (deduped against played editions + dismissed games + optional rig spec filter)
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
        const ranked = applyCalibratedSlateRerank(
          rankGameCandidates(clean, played, backlog, models, maps, { dismissedIds }),
          played,
          models,
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

  return (
    <div className="gv-page gv-page-discover page-rail">
      {error && (
        <div className="gv-panel mt-4" style={{ borderColor: "var(--danger)" }}>
          <p className="text-[1.4rem] text-danger">{error}</p>
        </div>
      )}

      {/* Full-Bleed Mobile / Framed Desktop Rotating Spotlight */}
      <GameHeroBillboard
        slides={heroSlides}
        isPersonalized={forYouPicks.length > 0}
        playedById={playedById}
        backlogIds={backlogIds}
        onRate={setRateTarget}
        onToggleBacklog={toggleBacklogGame}
        onOpenRoulette={() => openRoulette(forYouPicks.length > 0 ? forYouPicks : recentHits)}
      />

      {/* Sleek Rig Onboarding Strip (shown cleanly below hero only until configured) */}
      {!rigProfile?.completed && (
        <div className="gv-rig-strip">
          <div className="flex items-center gap-3 min-w-0">
            <Cpu size={15} className="shrink-0" style={{ color: "var(--gv-accent)" }} aria-hidden="true" />
            <span className="text-[1.3rem] text-text-2 truncate">
              Set your PC specs or consoles to tailor playable recommendations.
            </span>
          </div>
          <button
            type="button"
            className="gv-btn gv-btn-sm shrink-0"
            onClick={() => setOnboardingOpen(true)}
          >
            Set Up My Rig
          </button>
        </div>
      )}

      {/* 1-Tap Starter Calibration Strip (only while < 3 games rated) */}
      {played.length < 3 && starterCards.length > 0 && (
        <ScrollRevealSection className="gv-panel" delay={0.04}>
          <div className="gv-section-header" style={{ marginBottom: "1.4rem" }}>
            <div>
              <span className="gv-kicker">
                <Sparkles size={13} /> Quick Calibration ({played.length} / 3)
              </span>
              <h2 className="gv-section-title">Tap a few iconic games you&apos;ve played</h2>
              <p className="gv-section-sub">
                Rate 3 titles to unlock tailored recommendations across PC, PlayStation, Nintendo &amp; Xbox.
              </p>
            </div>
            <Link to="/games/vault" className="gv-btn gv-btn-sm">
              Import Library
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
                  transition={{ duration: 0.22, ease: EASE }}
                  className="gv-card"
                >
                  <Link to={`/game/${g.igdbId}`} className="gv-card-cover-wrap">
                    <img src={g.coverUrl} alt={g.title} loading="lazy" className="gv-card-cover" />
                    <div className="gv-card-sheen" aria-hidden="true" />
                  </Link>
                  <div className="gv-card-body">
                    <div className="gv-card-title">{g.title}</div>
                    <div className="gv-card-meta-row">
                      <span className="truncate">{g.primaryGenre} · {g.year}</span>
                    </div>
                    <div className="gv-card-footer">
                      <button
                        type="button"
                        className="gv-card-action is-active"
                        onClick={() => savePlayedGame(g, { userRating: 9, status: "completed" })}
                      >
                        Love
                      </button>
                      <button
                        type="button"
                        className="gv-card-action"
                        onClick={() => savePlayedGame(g, { userRating: 7, status: "played" })}
                      >
                        Like
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

      {played.length > 0 && (
        <GameCarouselRow
          title="Games You'll Love"
          subtitle="Matched to your played library."
          games={forYouPicks}
          showMatch
          loading={loadingForYou}
          seeAllTo="/games/explore"
          seeAllLabel="Explore all"
        />
      )}

      <GameCarouselRow
        title="Popular Blockbusters"
        games={popularHits}
        showMatch={false}
        loading={loadingCatalog}
        seeAllTo="/games/explore?tab=catalog"
        seeAllLabel="See all"
      />

      <GameCarouselRow
        title="Recent Standouts"
        games={recentHits}
        showMatch={false}
        loading={loadingCatalog}
        seeAllTo="/games/explore?tab=catalog&sort=recent"
        seeAllLabel="See all"
      />

      <GameCarouselRow
        title="Console Icons"
        games={exclusives}
        showMatch={false}
        loading={loadingCatalog}
      />

      <GameCarouselRow
        title="All-Time Acclaimed"
        games={topRated}
        showMatch={false}
        loading={loadingCatalog}
      />
    </div>
  );
}
